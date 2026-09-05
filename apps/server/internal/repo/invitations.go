package repo

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/andersro93/mi-casa-su-casa/server/internal/db/gen"
)

// Ports src/server/db/repositories/invitations.ts (REF §A3, "Invitations").

// Invitation statuses (the schema's CHECK allows exactly these).
const (
	InvitationPending   = "pending"
	InvitationAccepted  = "accepted"
	InvitationCancelled = "cancelled"
	InvitationExpired   = "expired"
)

// InvitationProvider is one provider an invitation is scoped to. snake_case
// keys inside a camelCase parent because that is what the TypeScript
// returned and the SPA reads.
type InvitationProvider struct {
	ID          string `json:"id"`
	ProviderKey string `json:"provider_key"`
	DisplayName string `json:"display_name"`
}

// Invitation is one pending (or settled) invitation with its provider scope.
type Invitation struct {
	ID               string               `json:"id"`
	HouseholdID      string               `json:"householdId"`
	Email            string               `json:"email"`
	Name             string               `json:"name"`
	Role             string               `json:"role"`
	Status           string               `json:"status"`
	InvitedByUserID  string               `json:"invitedByUserId"`
	AcceptedByUserID *string              `json:"acceptedByUserId"`
	ExpiresAt        time.Time            `json:"expiresAt"`
	AcceptedAt       *time.Time           `json:"acceptedAt"`
	CancelledAt      *time.Time           `json:"cancelledAt"`
	CreatedAt        time.Time            `json:"createdAt"`
	UpdatedAt        time.Time            `json:"updatedAt"`
	Providers        []InvitationProvider `json:"providers"`
}

// CreateInvitationInput is everything an invitation needs at birth. The
// token itself never appears here — only its hash, minted by
// security.NewInvitationToken.
type CreateInvitationInput struct {
	HouseholdID     string
	Email           string
	Name            string
	Role            string
	TokenHash       string
	InvitedByUserID string
	ExpiresAt       time.Time
	ProviderIDs     []string
}

// AcceptInvitationInput names the invitation, the user accepting it, and the
// role they get.
type AcceptInvitationInput struct {
	InvitationID     string
	HouseholdID      string
	AcceptedByUserID string
	Role             string
}

// CreateInvitation writes the invitation and its provider scope in one
// transaction, returning the new id.
//
// One INSERT per scoped provider rather than a multi-row VALUES: the list is
// short (a household's providers), and a per-row statement keeps the failure
// mode obvious — a provider id that does not exist fails its own insert and
// rolls the whole invitation back, rather than silently scoping the invite
// to fewer providers than the owner picked.
func (r *Repo) CreateInvitation(ctx context.Context, in CreateInvitationInput) (string, error) {
	invitationID, err := newID()
	if err != nil {
		return "", err
	}

	err = r.InTx(ctx, func(q *gen.Queries) error {
		if err := q.InsertInvitation(ctx, gen.InsertInvitationParams{
			ID:              invitationID,
			HouseholdID:     in.HouseholdID,
			Email:           in.Email,
			Name:            in.Name,
			Role:            in.Role,
			TokenHash:       in.TokenHash,
			InvitedByUserID: in.InvitedByUserID,
			ExpiresAt:       ts(in.ExpiresAt.UTC()),
		}); err != nil {
			return fmt.Errorf("repo: insert invitation: %w", err)
		}
		for _, providerID := range in.ProviderIDs {
			accessID, err := newID()
			if err != nil {
				return err
			}
			if err := q.InsertInvitationProvider(ctx, gen.InsertInvitationProviderParams{
				ID:           accessID,
				InvitationID: invitationID,
				ProviderID:   providerID,
			}); err != nil {
				return fmt.Errorf("repo: insert invitation provider: %w", err)
			}
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	return invitationID, nil
}

// ListInvitations returns the household's invitations, newest first.
func (r *Repo) ListInvitations(ctx context.Context, householdID string) ([]Invitation, error) {
	rows, err := r.q.ListInvitations(ctx, householdID)
	if err != nil {
		return nil, fmt.Errorf("repo: list invitations: %w", err)
	}
	joined := make([]invitationJoinRow, 0, len(rows))
	for _, row := range rows {
		joined = append(joined, invitationJoinRow(row))
	}
	return groupInvitationRows(joined), nil
}

// GetInvitationByTokenHash resolves an invite link. It is the one invitation
// read that is not household-scoped: the token is the credential, and the
// household it belongs to comes back with the row.
func (r *Repo) GetInvitationByTokenHash(ctx context.Context, tokenHash string) (*Invitation, error) {
	rows, err := r.q.GetInvitationByTokenHash(ctx, tokenHash)
	if err != nil {
		return nil, fmt.Errorf("repo: get invitation by token hash: %w", err)
	}
	joined := make([]invitationJoinRow, 0, len(rows))
	for _, row := range rows {
		joined = append(joined, invitationJoinRow(row))
	}
	return firstInvitation(groupInvitationRows(joined)), nil
}

// GetInvitationByID returns nil when the id names no invitation of this
// household.
func (r *Repo) GetInvitationByID(ctx context.Context, householdID, invitationID string) (*Invitation, error) {
	rows, err := r.q.GetInvitationByID(ctx, gen.GetInvitationByIDParams{
		ID:          invitationID,
		HouseholdID: householdID,
	})
	if err != nil {
		return nil, fmt.Errorf("repo: get invitation by id: %w", err)
	}
	joined := make([]invitationJoinRow, 0, len(rows))
	for _, row := range rows {
		joined = append(joined, invitationJoinRow(row))
	}
	return firstInvitation(groupInvitationRows(joined)), nil
}

// CancelInvitation marks an invitation cancelled. It takes the household as
// well as the id — the TypeScript passed the id alone and leaned on the
// route's earlier lookup — so a stale or guessed id cannot settle another
// household's invitation.
func (r *Repo) CancelInvitation(ctx context.Context, householdID, invitationID string) error {
	if err := r.q.CancelInvitation(ctx, gen.CancelInvitationParams{
		ID:          invitationID,
		HouseholdID: householdID,
	}); err != nil {
		return fmt.Errorf("repo: cancel invitation: %w", err)
	}
	return nil
}

// AcceptInvitation makes the invited user a member, marks the invitation
// accepted and copies its provider scope onto the new membership — one
// transaction, so an accept can never half-happen and leave someone with an
// accepted invitation but no membership.
//
// The membership is upserted rather than inserted: a user who is already a
// member accepting an invitation to a higher role gets the upgrade instead of
// a unique-violation error.
func (r *Repo) AcceptInvitation(ctx context.Context, in AcceptInvitationInput) error {
	membershipID, err := newID()
	if err != nil {
		return err
	}
	return r.InTx(ctx, func(q *gen.Queries) error {
		if err := q.UpsertMembership(ctx, gen.UpsertMembershipParams{
			ID:          membershipID,
			HouseholdID: in.HouseholdID,
			UserID:      in.AcceptedByUserID,
			Role:        in.Role,
		}); err != nil {
			return fmt.Errorf("repo: upsert membership: %w", err)
		}
		if err := q.MarkInvitationAccepted(ctx, gen.MarkInvitationAcceptedParams{
			AcceptedByUserID: &in.AcceptedByUserID,
			ID:               in.InvitationID,
			HouseholdID:      in.HouseholdID,
		}); err != nil {
			return fmt.Errorf("repo: mark invitation accepted: %w", err)
		}
		if err := q.CopyInvitationProviderAccess(ctx, gen.CopyInvitationProviderAccessParams{
			HouseholdID:      in.HouseholdID,
			AcceptedByUserID: in.AcceptedByUserID,
			InvitationID:     in.InvitationID,
		}); err != nil {
			return fmt.Errorf("repo: copy invitation provider access: %w", err)
		}
		return nil
	})
}

// RefreshExpiredInvitations flips pending invitations past their expiry and
// returns how many it flipped. householdID nil sweeps every household (the
// nightly job); a value scopes it to one (the admin screen, before it lists).
//
// The count exists for the job, which reports what a run did; the admin
// screens ignore it and only care that the sweep ran before they read.
func (r *Repo) RefreshExpiredInvitations(ctx context.Context, now time.Time, householdID *string) (int, error) {
	expired, err := r.q.RefreshExpiredInvitations(ctx, gen.RefreshExpiredInvitationsParams{
		Now:         ts(now.UTC()),
		HouseholdID: householdID,
	})
	if err != nil {
		return 0, fmt.Errorf("repo: refresh expired invitations: %w", err)
	}
	return int(expired), nil
}

// IsInvitationExpired reports whether the invitation's expiry has passed.
//
// The boundary is inclusive — an invitation expiring exactly now is expired —
// matching the TypeScript's `expiresAt <= now` and the SQL above, so the
// in-memory check and the sweep never disagree about a single instant.
func IsInvitationExpired(invitation Invitation, now time.Time) bool {
	return !invitation.ExpiresAt.After(now)
}

// invitationJoinRow is the shape all three invitation reads return: one
// invitation joined to at most one of its scoped providers. The generated row
// structs are identical but distinct types, so the wrappers convert into this
// one and share the grouping below.
type invitationJoinRow struct {
	ID                  string
	HouseholdID         string
	Email               string
	Name                string
	Role                string
	Status              string
	InvitedByUserID     string
	AcceptedByUserID    *string
	ExpiresAt           pgtype.Timestamptz
	AcceptedAt          pgtype.Timestamptz
	CancelledAt         pgtype.Timestamptz
	CreatedAt           pgtype.Timestamptz
	UpdatedAt           pgtype.Timestamptz
	ProviderID          *string
	ProviderKey         *string
	ProviderDisplayName *string
}

// groupInvitationRows folds the joined rows back into one Invitation per id,
// preserving the order the query returned them in.
func groupInvitationRows(rows []invitationJoinRow) []Invitation {
	invitations := make([]Invitation, 0, len(rows))
	index := make(map[string]int, len(rows))

	for _, row := range rows {
		position, seen := index[row.ID]
		if !seen {
			position = len(invitations)
			index[row.ID] = position
			invitations = append(invitations, Invitation{
				ID:               row.ID,
				HouseholdID:      row.HouseholdID,
				Email:            row.Email,
				Name:             row.Name,
				Role:             row.Role,
				Status:           row.Status,
				InvitedByUserID:  row.InvitedByUserID,
				AcceptedByUserID: row.AcceptedByUserID,
				ExpiresAt:        fromTS(row.ExpiresAt),
				AcceptedAt:       fromTSPtr(row.AcceptedAt),
				CancelledAt:      fromTSPtr(row.CancelledAt),
				CreatedAt:        fromTS(row.CreatedAt),
				UpdatedAt:        fromTS(row.UpdatedAt),
				Providers:        []InvitationProvider{},
			})
		}
		if row.ProviderID == nil || row.ProviderKey == nil || row.ProviderDisplayName == nil {
			continue
		}
		invitations[position].Providers = append(invitations[position].Providers, InvitationProvider{
			ID:          *row.ProviderID,
			ProviderKey: *row.ProviderKey,
			DisplayName: *row.ProviderDisplayName,
		})
	}
	return invitations
}

func firstInvitation(invitations []Invitation) *Invitation {
	if len(invitations) == 0 {
		return nil
	}
	return &invitations[0]
}
