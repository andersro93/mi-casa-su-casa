package api

import (
	"context"
	"strings"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/gen"
	"github.com/andersro93/mi-casa-su-casa/server/internal/api/middleware"
	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
)

// Ports src/server/routes/inbox.ts (REF §A2, "Inbox"): reading the household's
// mail, and working through the mail that could not be filed.
//
// The tiers are not uniform across this file, and that is the design rather
// than an oversight (see routes.go):
//
//   - The three message routes are MEMBER routes with a per-provider check
//     inside them. An owner sees every provider; a member sees only what they
//     have been granted, because a household splits its mail per mailbox and
//     not per role.
//   - Both quarantine routes are OWNER routes. A quarantined message has no
//     provider — that is precisely why it is quarantined — so there is no
//     access grant that could scope it to a member.
//
// Two orderings are load-bearing:
//
//   - On the messages route the access check runs BEFORE the provider lookup,
//     so a member cannot tell "this provider exists but is not yours" (403)
//     from "no such provider" (404) and enumerate the household's mailboxes.
//   - On the status route the message lookup runs BEFORE the body is
//     validated, so a malformed status sent for a message the caller may not
//     read is answered 404 rather than 400.

// ListInboxProviders answers the inbox landing page.
func (s server) ListInboxProviders(ctx context.Context, _ gen.ListInboxProvidersRequestObject) (gen.ListInboxProvidersResponseObject, error) {
	viewer, household, ok := s.householdContext(ctx)
	if !ok {
		return gen.ListInboxProviders403JSONResponse(errorBody("Forbidden")), nil
	}

	// The per-provider filter is inside the query rather than applied here:
	// the same statement that counts a provider's messages decides whether
	// this caller may see it at all.
	summaries, err := s.Repo.ListProviderSummariesForUser(ctx, household.ID, viewer.UserID)
	if err != nil {
		return nil, err
	}
	return gen.ListInboxProviders200JSONResponse{Providers: providerSummaryBodies(summaries)}, nil
}

// ListProviderMessages answers one page of a provider's inbox.
func (s server) ListProviderMessages(ctx context.Context, request gen.ListProviderMessagesRequestObject) (gen.ListProviderMessagesResponseObject, error) {
	viewer, household, ok := s.householdContext(ctx)
	if !ok {
		return gen.ListProviderMessages403JSONResponse(errorBody("Forbidden")), nil
	}

	allowed, err := s.mayReadProvider(ctx, viewer.UserID, household, request.ProviderKey)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return gen.ListProviderMessages403JSONResponse(errorBody("Forbidden")), nil
	}

	provider, err := s.Repo.GetProviderByKey(ctx, household.ID, request.ProviderKey)
	if err != nil {
		return nil, err
	}
	if provider == nil {
		return gen.ListProviderMessages404JSONResponse(errorBody("Provider not found")), nil
	}

	page := pageFrom(request.Params.Limit, request.Params.Before)
	result, err := s.Repo.ListMessagesForProvider(ctx, household.ID, request.ProviderKey, page)
	if err != nil {
		return nil, err
	}

	return gen.ListProviderMessages200JSONResponse{
		Provider: gen.InboxProvider{
			ProviderKey: provider.ProviderKey,
			DisplayName: provider.DisplayName,
		},
		Messages: inboxMessageBodies(result.Items),
		Page:     gen.PageInfo{Limit: page.Limit, NextBefore: result.NextBefore},
	}, nil
}

// UpdateMessageStatus marks one message new, used or expired.
func (s server) UpdateMessageStatus(ctx context.Context, request gen.UpdateMessageStatusRequestObject) (gen.UpdateMessageStatusResponseObject, error) {
	viewer, household, ok := s.householdContext(ctx)
	if !ok {
		return gen.UpdateMessageStatus403JSONResponse(errorBody("Forbidden")), nil
	}

	// Scoped to the household, so a message id from somewhere else is a 404
	// and never a status this caller gets to change.
	existing, err := s.Repo.FindMessageByID(ctx, household.ID, request.MessageId)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return gen.UpdateMessageStatus404JSONResponse(errorBody("Message not found")), nil
	}

	allowed, err := s.mayReadProvider(ctx, viewer.UserID, household, existing.ProviderKey)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return gen.UpdateMessageStatus403JSONResponse(errorBody("Forbidden")), nil
	}

	status, problems := normalizeMessageStatus(request.Body.Status)
	if len(problems) > 0 {
		summary, fields := envelopeFor(problems)
		return gen.UpdateMessageStatus400JSONResponse(errorFieldsBody(summary, fields)), nil
	}

	message, err := s.Repo.UpdateMessageStatus(ctx, household.ID, request.MessageId, status)
	if err != nil {
		return nil, err
	}
	if message == nil {
		// The row went between the lookup above and the update — a retention
		// sweep, or the provider being deleted. The caller is told the same
		// thing they would have been told a moment earlier.
		return gen.UpdateMessageStatus404JSONResponse(errorBody("Message not found")), nil
	}

	return gen.UpdateMessageStatus200JSONResponse{Message: inboxMessageBody(*message)}, nil
}

// ListQuarantine answers one page of the needs-review queue.
func (s server) ListQuarantine(ctx context.Context, request gen.ListQuarantineRequestObject) (gen.ListQuarantineResponseObject, error) {
	_, household, ok := s.householdContext(ctx)
	if !ok {
		return gen.ListQuarantine403JSONResponse(errorBody("Forbidden")), nil
	}

	page := pageFrom(request.Params.Limit, request.Params.Before)
	result, err := s.Repo.ListQuarantine(ctx, household.ID, page)
	if err != nil {
		return nil, err
	}

	return gen.ListQuarantine200JSONResponse{
		Messages: quarantineMessageBodies(result.Items),
		Page:     gen.PageInfo{Limit: page.Limit, NextBefore: result.NextBefore},
	}, nil
}

// ReviewQuarantineMessage dismisses or releases one needs-review row.
func (s server) ReviewQuarantineMessage(ctx context.Context, request gen.ReviewQuarantineMessageRequestObject) (gen.ReviewQuarantineMessageResponseObject, error) {
	viewer, household, ok := s.householdContext(ctx)
	if !ok {
		return gen.ReviewQuarantineMessage403JSONResponse(errorBody("Forbidden")), nil
	}

	action, providerKey, problems := normalizeQuarantineReviewBody(request.Body.Action, request.Body.ProviderKey)
	if len(problems) > 0 {
		summary, fields := envelopeFor(problems)
		return gen.ReviewQuarantineMessage400JSONResponse(errorFieldsBody(summary, fields)), nil
	}

	var providerID string
	if action == repo.ReviewRelease {
		// Refused before the message is looked up: "release it, but nowhere"
		// is a broken request whatever row it names.
		if providerKey == "" {
			return gen.ReviewQuarantineMessage400JSONResponse(errorBody(
				"providerKey is required to release a message")), nil
		}
		provider, err := s.Repo.GetProviderByKey(ctx, household.ID, providerKey)
		if err != nil {
			return nil, err
		}
		if provider == nil {
			return gen.ReviewQuarantineMessage404JSONResponse(errorBody("Provider not found")), nil
		}
		providerID = provider.ID
	}

	// One 404 covers both "no such row in this household" and "somebody has
	// already reviewed it", which is what makes a double submit harmless
	// rather than a second copy in the provider's inbox.
	review, err := s.Repo.ReviewQuarantine(ctx, household.ID, request.MessageId, action, providerID)
	if err != nil {
		return nil, err
	}
	if review == nil {
		return gen.ReviewQuarantineMessage404JSONResponse(errorBody("Quarantine message not found")), nil
	}

	var details map[string]any
	if providerKey != "" {
		details = map[string]any{"providerKey": providerKey}
	}
	s.audit(ctx, viewer, household, "quarantine."+action, "quarantine_message", &request.MessageId, details)

	return gen.ReviewQuarantineMessage200JSONResponse{
		ReviewedAt:      review.ReviewedAt,
		ReleasedMessage: releasedMessageBody(review.ReleasedMessage),
	}, nil
}

// mayReadProvider is the per-provider access check the three message routes
// share: an owner may read every provider in their household, a member only
// the ones they have been granted.
//
// A provider key that names nothing is simply not granted, so a member asking
// after one is refused with the same 403 as a member asking after a real
// provider they may not read — which is the point.
func (s server) mayReadProvider(ctx context.Context, userID string, household *middleware.Household, providerKey string) (bool, error) {
	if household.Role == repo.RoleOwner {
		return true, nil
	}
	return s.Repo.UserHasProviderAccess(ctx, household.ID, userID, providerKey)
}

// messageStatuses is REF §A4's `messageStatus` enum, in the order its message
// names them.
var messageStatuses = []string{repo.StatusNew, repo.StatusUsed, repo.StatusExpired}

// normalizeMessageStatus applies REF §A4's `messageStatus` schema. The check
// is here rather than an OpenAPI enum for the reason the spec states: an enum
// violation cannot say "status must be new, used or expired", and that wording
// is what the SPA renders.
func normalizeMessageStatus(raw string) (status string, problems []problem) {
	status = strings.TrimSpace(raw)
	for _, known := range messageStatuses {
		if status == known {
			return status, nil
		}
	}
	return status, []problem{{
		field:   "status",
		message: "status must be new, used or expired",
	}}
}

// normalizeQuarantineReviewBody applies REF §A4's `quarantineReview` schema.
// The provider key is trimmed and lower-cased before its bounds are checked,
// so what is validated is what will be looked up.
//
// An absent providerKey is NOT a problem here even for a release: that
// refusal is the handler's, because its message names the field and the
// action together.
func normalizeQuarantineReviewBody(rawAction string, rawProviderKey *string) (action, providerKey string, problems []problem) {
	action = strings.TrimSpace(rawAction)
	switch action {
	case repo.ReviewDismiss, repo.ReviewRelease:
	default:
		problems = append(problems, problem{
			field:   "action",
			message: "action must be dismiss or release",
		})
	}

	if rawProviderKey != nil {
		providerKey = strings.ToLower(strings.TrimSpace(*rawProviderKey))
		problems = appendTextProblems(problems, "providerKey", providerKey, 40)
	}
	return action, providerKey, problems
}

// pageFrom turns the two optional query parameters into a normalised page.
//
// The clamping lives in Go rather than in the spec (see the PageLimit
// parameter): an out-of-range limit is clamped and an unparseable cursor is
// ignored, both carried over from the TypeScript's normalizePageOptions, so a
// client can never end up on a page it cannot navigate away from.
//
// The one wrinkle is `limit=0`. repo.NormalizePage reads 0 as "absent" and
// answers with the default 50, which is right for a caller that passed
// nothing — but a query parameter that IS present and says zero meant zero,
// and the TypeScript clamped that up to 1. Passing it on as a negative is how
// the two cases stay distinguishable through a single int.
func pageFrom(limit *gen.PageLimit, before *gen.PageBefore) repo.Page {
	value := 0
	if limit != nil {
		value = *limit
		if value == 0 {
			value = -1
		}
	}
	cursor := ""
	if before != nil {
		cursor = *before
	}
	return repo.NormalizePage(value, cursor)
}

// providerSummaryBodies maps the inbox landing page onto the wire shape,
// non-nil even when empty so the key marshals as `[]` rather than as null.
func providerSummaryBodies(summaries []repo.ProviderSummary) []gen.ProviderSummary {
	rows := make([]gen.ProviderSummary, 0, len(summaries))
	for _, summary := range summaries {
		rows = append(rows, gen.ProviderSummary{
			HouseholdSlug:    summary.HouseholdSlug,
			ProviderKey:      summary.ProviderKey,
			DisplayName:      summary.DisplayName,
			MessageCount:     summary.MessageCount,
			NewCount:         summary.NewCount,
			LatestReceivedAt: summary.LatestReceivedAt,
			LatestMessageId:  summary.LatestMessageID,
			LatestSubject:    summary.LatestSubject,
			LatestCode:       summary.LatestCode,
			LatestStatus:     summary.LatestStatus,
		})
	}
	return rows
}

// inboxMessageBody maps one inbox row onto the wire shape.
func inboxMessageBody(message repo.InboxMessage) gen.InboxMessage {
	return gen.InboxMessage{
		Id:                  message.ID,
		HouseholdSlug:       message.HouseholdSlug,
		ProviderKey:         message.ProviderKey,
		ProviderDisplayName: message.ProviderDisplayName,
		Subject:             message.Subject,
		FromHeader:          message.FromHeader,
		TextBody:            message.TextBody,
		ExtractedCode:       message.ExtractedCode,
		Status:              gen.InboxMessageStatus(message.Status),
		ReceivedAt:          message.ReceivedAt,
	}
}

func inboxMessageBodies(messages []repo.InboxMessage) []gen.InboxMessage {
	rows := make([]gen.InboxMessage, 0, len(messages))
	for _, message := range messages {
		rows = append(rows, inboxMessageBody(message))
	}
	return rows
}

// releasedMessageBody preserves nil: a dismissal answers with
// `releasedMessage: null` rather than omitting the key.
func releasedMessageBody(message *repo.InboxMessage) *gen.InboxMessage {
	if message == nil {
		return nil
	}
	body := inboxMessageBody(*message)
	return &body
}

func quarantineMessageBodies(messages []repo.QuarantineMessage) []gen.QuarantineMessage {
	rows := make([]gen.QuarantineMessage, 0, len(messages))
	for _, message := range messages {
		rows = append(rows, gen.QuarantineMessage{
			Id:                  message.ID,
			HouseholdSlug:       message.HouseholdSlug,
			ProviderKey:         message.ProviderKey,
			ProviderDisplayName: message.ProviderDisplayName,
			Subject:             message.Subject,
			FromHeader:          message.FromHeader,
			EnvelopeFrom:        message.EnvelopeFrom,
			TextBody:            message.TextBody,
			ExtractedCode:       message.ExtractedCode,
			Status:              message.Status,
			QuarantineReason:    message.QuarantineReason,
			ReceivedAt:          message.ReceivedAt,
		})
	}
	return rows
}
