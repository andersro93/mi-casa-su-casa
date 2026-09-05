package repo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/andersro93/mi-casa-su-casa/server/internal/db/gen"
	"github.com/andersro93/mi-casa-su-casa/server/internal/domain"
)

// Ports src/server/db/repositories/messages.ts (REF, "Message storage" and
// "Retention job").

// RetentionDays is how long stored mail is kept. delete_after is written at
// insert time as received_at + this window, so the retention sweep is a
// single indexed comparison and never has to re-derive a policy.
const RetentionDays = 30

// PurgeBatchSize is the default bound on one retention DELETE.
const PurgeBatchSize = 500

// Message statuses (the schema's CHECK allows exactly these).
const (
	StatusNew     = "new"
	StatusUsed    = "used"
	StatusExpired = "expired"
)

// Quarantine review actions.
const (
	ReviewDismiss = "dismiss"
	ReviewRelease = "release"
)

// ParsedEmail is an inbound email after parsing, as far as storage is
// concerned. It mirrors the TypeScript ParsedIncomingEmail (REF, "Email
// parsing"); the parser that produces it arrives with the inbound route, and
// may well move this type into its own package then.
//
// DateHeader is kept for display only. It never becomes received_at: a
// sender that puts the year 2099 in its Date header would otherwise sit at
// the top of the inbox forever and outlive retention.
type ParsedEmail struct {
	EnvelopeFrom string
	EnvelopeTo   string
	// HouseholdSlug is nil when the recipient address carried none, which is
	// one of the reasons a message ends up quarantined.
	HouseholdSlug *string
	FromHeader    *string
	// FromAddress is the lower-cased address parsed out of the From header,
	// used as the first match candidate during classification.
	FromAddress *string
	// Authentication is what the receiving MTA asserted (nil when the message
	// carried no Authentication-Results header).
	Authentication *domain.Authentication
	Subject        *string
	// MessageID is the RFC 5322 Message-ID. When it is empty the row's own id
	// is stored instead, so the (household, message_id) uniqueness that makes
	// ingest idempotent still has something to work with.
	MessageID  string
	DateHeader *time.Time
	TextBody   string
	// TextBodyTruncated records that TextBody was cut at the parser's limit.
	TextBodyTruncated bool
	RawSize           int
}

// InboxMessage is one row of a provider's inbox. snake_case tags: these keys
// are what the SPA has read since the Workers deployment.
type InboxMessage struct {
	ID                  string    `json:"id"`
	HouseholdSlug       string    `json:"household_slug"`
	ProviderKey         string    `json:"provider_key"`
	ProviderDisplayName string    `json:"provider_display_name"`
	Subject             *string   `json:"subject"`
	FromHeader          *string   `json:"from_header"`
	TextBody            string    `json:"text_body"`
	ExtractedCode       *string   `json:"extracted_code"`
	Status              string    `json:"status"`
	ReceivedAt          time.Time `json:"received_at"`
}

// QuarantineMessage is one row of the needs-review queue. ProviderKey and
// ProviderDisplayName are the literals "quarantine"/"Quarantine" so the SPA
// can render it with the same component as an inbox row.
type QuarantineMessage struct {
	ID                  string    `json:"id"`
	HouseholdSlug       string    `json:"household_slug"`
	ProviderKey         string    `json:"provider_key"`
	ProviderDisplayName string    `json:"provider_display_name"`
	Subject             *string   `json:"subject"`
	FromHeader          *string   `json:"from_header"`
	EnvelopeFrom        string    `json:"envelope_from"`
	TextBody            string    `json:"text_body"`
	ExtractedCode       *string   `json:"extracted_code"`
	Status              string    `json:"status"`
	QuarantineReason    string    `json:"quarantine_reason"`
	ReceivedAt          time.Time `json:"received_at"`
}

// ProviderSummary is one provider's tile on the inbox landing page: counts
// plus a preview of the newest message. The Latest* fields are nil for a
// provider that has received nothing yet — null keys, not missing ones.
type ProviderSummary struct {
	HouseholdSlug    string     `json:"household_slug"`
	ProviderKey      string     `json:"provider_key"`
	DisplayName      string     `json:"display_name"`
	MessageCount     int        `json:"message_count"`
	NewCount         int        `json:"new_count"`
	LatestReceivedAt *time.Time `json:"latest_received_at"`
	LatestMessageID  *string    `json:"latest_message_id"`
	LatestSubject    *string    `json:"latest_subject"`
	LatestCode       *string    `json:"latest_code"`
	LatestStatus     *string    `json:"latest_status"`
}

// Review is the outcome of working through one needs-review row.
// ReleasedMessage is nil for a dismissal.
type Review struct {
	ReviewedAt      time.Time     `json:"reviewedAt"`
	ReleasedMessage *InboxMessage `json:"releasedMessage"`
}

// PurgeResult is what one retention sweep removed, and how many statements
// it took — the log line the operator reads to tell a healthy nightly run
// from a catch-up after an outage.
type PurgeResult struct {
	Messages   int `json:"messages"`
	Quarantine int `json:"quarantine"`
	Batches    int `json:"batches"`
}

// InsertMessage stores a classified message and returns its id.
//
// A redelivery of the same Message-ID within the same household is swallowed
// (ON CONFLICT DO NOTHING) rather than raised: the mail server may retry, and
// an ingest that failed on a duplicate would have it retry forever. The
// returned id is then the id that *would* have been used — the caller uses it
// only for logging, never to read the row back.
func (r *Repo) InsertMessage(
	ctx context.Context,
	parsed ParsedEmail,
	householdID, providerID string,
	code *string,
	reason string,
	now time.Time,
) (string, error) {
	id, err := newID()
	if err != nil {
		return "", err
	}
	receivedAt := now.UTC()
	if _, err := r.q.InsertMessage(ctx, gen.InsertMessageParams{
		ID:                   id,
		HouseholdID:          householdID,
		MessageID:            messageIDOr(parsed.MessageID, id),
		ProviderID:           providerID,
		EnvelopeFrom:         parsed.EnvelopeFrom,
		EnvelopeTo:           parsed.EnvelopeTo,
		FromHeader:           parsed.FromHeader,
		Subject:              parsed.Subject,
		TextBody:             parsed.TextBody,
		ExtractedCode:        code,
		ClassificationReason: reason,
		RawSize:              int32(parsed.RawSize),
		DateHeader:           tsPtr(parsed.DateHeader),
		ReceivedAt:           ts(receivedAt),
		DeleteAfter:          ts(deleteAfter(receivedAt)),
	}); err != nil {
		return "", fmt.Errorf("repo: insert message: %w", err)
	}
	return id, nil
}

// InsertQuarantine stores mail that could not be attributed to a provider,
// with the reason it could not. Duplicates are swallowed exactly as
// InsertMessage's are.
func (r *Repo) InsertQuarantine(
	ctx context.Context,
	parsed ParsedEmail,
	householdID string,
	code *string,
	reason string,
	now time.Time,
) (string, error) {
	id, err := newID()
	if err != nil {
		return "", err
	}
	receivedAt := now.UTC()
	if _, err := r.q.InsertQuarantineMessage(ctx, gen.InsertQuarantineMessageParams{
		ID:               id,
		HouseholdID:      householdID,
		MessageID:        messageIDOr(parsed.MessageID, id),
		EnvelopeFrom:     parsed.EnvelopeFrom,
		EnvelopeTo:       parsed.EnvelopeTo,
		FromHeader:       parsed.FromHeader,
		Subject:          parsed.Subject,
		TextBody:         parsed.TextBody,
		ExtractedCode:    code,
		QuarantineReason: reason,
		RawSize:          int32(parsed.RawSize),
		DateHeader:       tsPtr(parsed.DateHeader),
		ReceivedAt:       ts(receivedAt),
		DeleteAfter:      ts(deleteAfter(receivedAt)),
	}); err != nil {
		return "", fmt.Errorf("repo: insert quarantine message: %w", err)
	}
	return id, nil
}

// ListMessagesForProvider returns one page of a provider's inbox, newest
// first.
func (r *Repo) ListMessagesForProvider(ctx context.Context, householdID, providerKey string, page Page) (Paged[InboxMessage], error) {
	rows, err := r.q.ListMessagesForProvider(ctx, gen.ListMessagesForProviderParams{
		HouseholdID: householdID,
		ProviderKey: providerKey,
		Before:      tsPtr(page.Before),
		RowLimit:    int32(page.Limit + 1),
	})
	if err != nil {
		return Paged[InboxMessage]{}, fmt.Errorf("repo: list messages for provider: %w", err)
	}
	messages := make([]InboxMessage, 0, len(rows))
	for _, row := range rows {
		messages = append(messages, InboxMessage{
			ID:                  row.ID,
			HouseholdSlug:       row.HouseholdSlug,
			ProviderKey:         row.ProviderKey,
			ProviderDisplayName: row.ProviderDisplayName,
			Subject:             row.Subject,
			FromHeader:          row.FromHeader,
			TextBody:            row.TextBody,
			ExtractedCode:       row.ExtractedCode,
			Status:              row.Status,
			ReceivedAt:          fromTS(row.ReceivedAt),
		})
	}
	return toPage(messages, page.Limit, func(m InboxMessage) time.Time { return m.ReceivedAt }), nil
}

// ListQuarantine returns one page of the household's unreviewed quarantine,
// newest first.
func (r *Repo) ListQuarantine(ctx context.Context, householdID string, page Page) (Paged[QuarantineMessage], error) {
	rows, err := r.q.ListQuarantineMessages(ctx, gen.ListQuarantineMessagesParams{
		HouseholdID: householdID,
		Before:      tsPtr(page.Before),
		RowLimit:    int32(page.Limit + 1),
	})
	if err != nil {
		return Paged[QuarantineMessage]{}, fmt.Errorf("repo: list quarantine messages: %w", err)
	}
	messages := make([]QuarantineMessage, 0, len(rows))
	for _, row := range rows {
		messages = append(messages, QuarantineMessage{
			ID:                  row.ID,
			HouseholdSlug:       row.HouseholdSlug,
			ProviderKey:         row.ProviderKey,
			ProviderDisplayName: row.ProviderDisplayName,
			Subject:             row.Subject,
			FromHeader:          row.FromHeader,
			EnvelopeFrom:        row.EnvelopeFrom,
			TextBody:            row.TextBody,
			ExtractedCode:       row.ExtractedCode,
			Status:              row.Status,
			QuarantineReason:    row.QuarantineReason,
			ReceivedAt:          fromTS(row.ReceivedAt),
		})
	}
	return toPage(messages, page.Limit, func(m QuarantineMessage) time.Time { return m.ReceivedAt }), nil
}

// ListProviderSummariesForUser returns the inbox landing page for one user:
// every provider an owner may see, or only the granted ones for a member.
func (r *Repo) ListProviderSummariesForUser(ctx context.Context, householdID, userID string) ([]ProviderSummary, error) {
	rows, err := r.q.ListProviderSummariesForUser(ctx, gen.ListProviderSummariesForUserParams{
		UserID:      userID,
		HouseholdID: householdID,
	})
	if err != nil {
		return nil, fmt.Errorf("repo: list provider summaries: %w", err)
	}
	summaries := make([]ProviderSummary, 0, len(rows))
	for _, row := range rows {
		summaries = append(summaries, ProviderSummary{
			HouseholdSlug:    row.HouseholdSlug,
			ProviderKey:      row.ProviderKey,
			DisplayName:      row.DisplayName,
			MessageCount:     int(row.MessageCount),
			NewCount:         int(row.NewCount),
			LatestReceivedAt: fromTSPtr(row.LatestReceivedAt),
			LatestMessageID:  row.LatestMessageID,
			LatestSubject:    row.LatestSubject,
			LatestCode:       row.LatestCode,
			LatestStatus:     row.LatestStatus,
		})
	}
	return summaries, nil
}

// CountUnreviewedQuarantine backs both the needs-review badge and the ingest
// guard that stops accepting mail for a mailbox whose queue is full.
func (r *Repo) CountUnreviewedQuarantine(ctx context.Context, householdID string) (int, error) {
	total, err := r.q.CountUnreviewedQuarantine(ctx, householdID)
	if err != nil {
		return 0, fmt.Errorf("repo: count unreviewed quarantine: %w", err)
	}
	return int(total), nil
}

// UpdateMessageStatus marks a message new/used/expired and returns it as it
// now stands, or nil when this household has no such message.
func (r *Repo) UpdateMessageStatus(ctx context.Context, householdID, messageID, status string) (*InboxMessage, error) {
	if err := r.q.UpdateMessageStatus(ctx, gen.UpdateMessageStatusParams{
		Status:      status,
		HouseholdID: householdID,
		ID:          messageID,
	}); err != nil {
		return nil, fmt.Errorf("repo: update message status: %w", err)
	}
	return r.FindMessageByID(ctx, householdID, messageID)
}

// FindMessageByID returns nil when the id names no message of this
// household.
func (r *Repo) FindMessageByID(ctx context.Context, householdID, messageID string) (*InboxMessage, error) {
	row, err := r.q.FindMessageByID(ctx, gen.FindMessageByIDParams{
		HouseholdID: householdID,
		ID:          messageID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("repo: find message by id: %w", err)
	}
	message := InboxMessage{
		ID:                  row.ID,
		HouseholdSlug:       row.HouseholdSlug,
		ProviderKey:         row.ProviderKey,
		ProviderDisplayName: row.ProviderDisplayName,
		Subject:             row.Subject,
		FromHeader:          row.FromHeader,
		TextBody:            row.TextBody,
		ExtractedCode:       row.ExtractedCode,
		Status:              row.Status,
		ReceivedAt:          fromTS(row.ReceivedAt),
	}
	return &message, nil
}

// ReviewQuarantine dismisses or releases one needs-review row, returning nil
// when the household has no such row or it was reviewed already.
//
// A release copies the row into "messages" under the chosen provider and
// marks the quarantine row reviewed in one transaction, so a failure cannot
// leave a released message that is still queued for review (or a reviewed row
// whose message was never stored). The released message is then read back by
// (household, Message-ID): the insert may have done nothing because a message
// with that id already existed, and the response must show whichever row the
// household actually has.
func (r *Repo) ReviewQuarantine(ctx context.Context, householdID, messageID, action, providerID string) (*Review, error) {
	record, err := r.q.GetQuarantineMessage(ctx, gen.GetQuarantineMessageParams{
		HouseholdID: householdID,
		ID:          messageID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("repo: get quarantine message: %w", err)
	}
	if record.ReviewedAt.Valid {
		return nil, nil
	}

	reviewedAt := time.Now().UTC()

	if action != ReviewRelease {
		if err := r.q.MarkQuarantineReviewed(ctx, gen.MarkQuarantineReviewedParams{
			ReviewedAt:  ts(reviewedAt),
			HouseholdID: householdID,
			ID:          messageID,
		}); err != nil {
			return nil, fmt.Errorf("repo: mark quarantine reviewed: %w", err)
		}
		return &Review{ReviewedAt: reviewedAt}, nil
	}

	if providerID == "" {
		return nil, errors.New("repo: provider id is required to release a quarantined message")
	}

	releasedID, err := newID()
	if err != nil {
		return nil, err
	}
	if err := r.InTx(ctx, func(q *gen.Queries) error {
		if err := q.InsertReleasedMessage(ctx, gen.InsertReleasedMessageParams{
			ID:           releasedID,
			ProviderID:   providerID,
			HouseholdID:  householdID,
			QuarantineID: messageID,
		}); err != nil {
			return fmt.Errorf("repo: insert released message: %w", err)
		}
		if err := q.MarkQuarantineReviewed(ctx, gen.MarkQuarantineReviewedParams{
			ReviewedAt:  ts(reviewedAt),
			HouseholdID: householdID,
			ID:          messageID,
		}); err != nil {
			return fmt.Errorf("repo: mark quarantine reviewed: %w", err)
		}
		return nil
	}); err != nil {
		return nil, err
	}

	released, err := r.q.FindMessageByMessageID(ctx, gen.FindMessageByMessageIDParams{
		HouseholdID: householdID,
		MessageID:   record.MessageID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &Review{ReviewedAt: reviewedAt}, nil
		}
		return nil, fmt.Errorf("repo: find released message: %w", err)
	}
	return &Review{
		ReviewedAt: reviewedAt,
		ReleasedMessage: &InboxMessage{
			ID:                  released.ID,
			HouseholdSlug:       released.HouseholdSlug,
			ProviderKey:         released.ProviderKey,
			ProviderDisplayName: released.ProviderDisplayName,
			Subject:             released.Subject,
			FromHeader:          released.FromHeader,
			TextBody:            released.TextBody,
			ExtractedCode:       released.ExtractedCode,
			Status:              released.Status,
			ReceivedAt:          fromTS(released.ReceivedAt),
		},
	}, nil
}

// PurgeExpired deletes everything past its retention window, in batches.
//
// The batching is what keeps a catch-up run after a long cron outage from
// taking one enormous lock: each statement deletes at most batch rows, and
// the loop stops as soon as a batch comes back short. An empty table
// therefore still costs one statement, which is why Batches counts at least
// two for a run that removes nothing.
//
// It is deliberately unscoped by household: the retention job sweeps every
// household in one pass, and the delete_after index is built for exactly
// this.
func (r *Repo) PurgeExpired(ctx context.Context, now time.Time, batch int) (PurgeResult, error) {
	if batch <= 0 {
		batch = PurgeBatchSize
	}

	messages, messageBatches, err := purgeInBatches(ctx, now, batch, func(ctx context.Context, arg gen.PurgeMessagesParams) (int64, error) {
		return r.q.PurgeMessages(ctx, arg)
	})
	if err != nil {
		return PurgeResult{}, fmt.Errorf("repo: purge messages: %w", err)
	}

	quarantine, quarantineBatches, err := purgeInBatches(ctx, now, batch, func(ctx context.Context, arg gen.PurgeMessagesParams) (int64, error) {
		return r.q.PurgeQuarantineMessages(ctx, gen.PurgeQuarantineMessagesParams{
			Now:       arg.Now,
			BatchSize: arg.BatchSize,
		})
	})
	if err != nil {
		return PurgeResult{}, fmt.Errorf("repo: purge quarantine messages: %w", err)
	}

	return PurgeResult{
		Messages:   messages,
		Quarantine: quarantine,
		Batches:    messageBatches + quarantineBatches,
	}, nil
}

// purgeInBatches runs one table's bounded deletes until a batch comes back
// short, returning how many rows went and how many statements it took.
func purgeInBatches(
	ctx context.Context,
	now time.Time,
	batch int,
	del func(context.Context, gen.PurgeMessagesParams) (int64, error),
) (deleted, batches int, err error) {
	for {
		affected, err := del(ctx, gen.PurgeMessagesParams{
			Now:       ts(now),
			BatchSize: int32(batch),
		})
		if err != nil {
			return 0, 0, err
		}
		deleted += int(affected)
		batches++
		if int(affected) < batch {
			return deleted, batches, nil
		}
	}
}

// deleteAfter is the retention deadline for mail received at receivedAt.
func deleteAfter(receivedAt time.Time) time.Time {
	return receivedAt.AddDate(0, 0, RetentionDays)
}

// messageIDOr falls back to the row's own id when the email carried no
// Message-ID, so the per-household uniqueness that makes ingest idempotent
// still applies (and a message without one is never mistaken for a
// redelivery of another).
func messageIDOr(messageID, fallback string) string {
	if messageID == "" {
		return fallback
	}
	return messageID
}
