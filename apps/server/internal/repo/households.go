package repo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/andersro93/mi-casa-su-casa/server/internal/db/gen"
)

// Ports src/server/db/repositories/households.ts and the membership half of
// src/server/db/repositories/member-access.ts.

// Roles a membership may hold. The schema's CHECK constraint allows exactly
// these two, so a typo at a call site fails loudly at the database rather
// than quietly creating a member nobody can act as.
const (
	RoleOwner  = "owner"
	RoleMember = "member"
)

// HouseholdSummary is one entry in the household switcher. camelCase tags:
// the SPA has read these keys since the Workers deployment.
type HouseholdSummary struct {
	ID          string `json:"id"`
	Slug        string `json:"slug"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
}

// Household is the settings view of a household.
type Household struct {
	ID          string    `json:"id"`
	Slug        string    `json:"slug"`
	DisplayName string    `json:"displayName"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// Membership is the answer to "may this user act on this household, and as
// what?" — the only thing the tenancy middleware needs.
type Membership struct {
	HouseholdID string `json:"householdId"`
	Slug        string `json:"slug"`
	Role        string `json:"role"`
}

// ListHouseholdsForUser returns every household the user belongs to, ordered
// by lower-cased display name.
func (r *Repo) ListHouseholdsForUser(ctx context.Context, userID string) ([]HouseholdSummary, error) {
	rows, err := r.q.ListHouseholdsForUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("repo: list households for user: %w", err)
	}
	summaries := make([]HouseholdSummary, 0, len(rows))
	for _, row := range rows {
		summaries = append(summaries, HouseholdSummary{
			ID:          row.ID,
			Slug:        row.Slug,
			DisplayName: row.DisplayName,
			Role:        row.Role,
		})
	}
	return summaries, nil
}

// GetHouseholdBySlug returns nil (and no error) when no household has that
// slug — an unknown slug is a 404 the route decides on, not a failure.
func (r *Repo) GetHouseholdBySlug(ctx context.Context, slug string) (*Household, error) {
	row, err := r.q.GetHouseholdBySlug(ctx, slug)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("repo: get household by slug: %w", err)
	}
	household := householdFromRow(row)
	return &household, nil
}

// GetHouseholdByID is GetHouseholdBySlug addressed by id; it also serves the
// TypeScript's getHouseholdSettings, which selected the same columns.
func (r *Repo) GetHouseholdByID(ctx context.Context, id string) (*Household, error) {
	row, err := r.q.GetHouseholdByID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("repo: get household by id: %w", err)
	}
	household := householdFromRow(row)
	return &household, nil
}

// CreateHousehold writes the household and its owner membership in one
// transaction.
//
// The D1 predecessor used `batch` here, which was atomic but not a
// transaction; the point is the same and now literal — a household without
// an owner is unreachable by anyone, so the two rows must appear together or
// not at all. A taken slug surfaces as a unique violation, which the route
// turns into 409 "Household slug already exists".
func (r *Repo) CreateHousehold(ctx context.Context, slug, displayName, ownerUserID string) (Household, error) {
	householdID, err := newID()
	if err != nil {
		return Household{}, err
	}
	membershipID, err := newID()
	if err != nil {
		return Household{}, err
	}

	var created Household
	err = r.InTx(ctx, func(q *gen.Queries) error {
		row, err := q.InsertHousehold(ctx, gen.InsertHouseholdParams{
			ID:          householdID,
			Slug:        slug,
			DisplayName: displayName,
		})
		if err != nil {
			return fmt.Errorf("repo: insert household: %w", err)
		}
		if err := q.InsertMembership(ctx, gen.InsertMembershipParams{
			ID:          membershipID,
			HouseholdID: householdID,
			UserID:      ownerUserID,
			Role:        RoleOwner,
		}); err != nil {
			return fmt.Errorf("repo: insert owner membership: %w", err)
		}
		created = householdFromRow(row)
		return nil
	})
	if err != nil {
		return Household{}, err
	}
	return created, nil
}

// UpdateHouseholdDisplayName renames a household and returns the row as it
// now stands, or nil when the id matched nothing.
func (r *Repo) UpdateHouseholdDisplayName(ctx context.Context, householdID, displayName string) (*Household, error) {
	row, err := r.q.UpdateHouseholdDisplayName(ctx, gen.UpdateHouseholdDisplayNameParams{
		ID:          householdID,
		DisplayName: displayName,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("repo: update household display name: %w", err)
	}
	household := householdFromRow(row)
	return &household, nil
}

// MembershipForSlug answers the tenancy question for a URL that names a
// household by slug. nil means "not a member" (or no such household), which
// the middleware answers with 403 either way — deliberately not
// distinguishing the two, so a stranger cannot probe which slugs exist.
func (r *Repo) MembershipForSlug(ctx context.Context, userID, slug string) (*Membership, error) {
	row, err := r.q.MembershipForSlug(ctx, gen.MembershipForSlugParams{
		UserID: userID,
		Slug:   slug,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("repo: membership for slug: %w", err)
	}
	return &Membership{HouseholdID: row.HouseholdID, Slug: row.Slug, Role: row.Role}, nil
}

// GetMembership is MembershipForSlug addressed by household id.
func (r *Repo) GetMembership(ctx context.Context, userID, householdID string) (*Membership, error) {
	row, err := r.q.GetMembership(ctx, gen.GetMembershipParams{
		UserID:      userID,
		HouseholdID: householdID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("repo: get membership: %w", err)
	}
	return &Membership{HouseholdID: row.HouseholdID, Slug: row.Slug, Role: row.Role}, nil
}

// CountOwners backs the "a household must keep at least one owner" rule.
func (r *Repo) CountOwners(ctx context.Context, householdID string) (int, error) {
	total, err := r.q.CountHouseholdOwners(ctx, householdID)
	if err != nil {
		return 0, fmt.Errorf("repo: count household owners: %w", err)
	}
	return int(total), nil
}

// RemoveMember deletes a membership; the member's provider access rows
// cascade with it.
func (r *Repo) RemoveMember(ctx context.Context, householdID, userID string) error {
	if err := r.q.DeleteMembership(ctx, gen.DeleteMembershipParams{
		HouseholdID: householdID,
		UserID:      userID,
	}); err != nil {
		return fmt.Errorf("repo: remove member: %w", err)
	}
	return nil
}

// SetMemberRole promotes or demotes a member within one household.
func (r *Repo) SetMemberRole(ctx context.Context, householdID, userID, role string) error {
	if err := r.q.SetMembershipRole(ctx, gen.SetMembershipRoleParams{
		HouseholdID: householdID,
		UserID:      userID,
		Role:        role,
	}); err != nil {
		return fmt.Errorf("repo: set member role: %w", err)
	}
	return nil
}

// ProvidersBelong reports whether every id in ids is a provider of this
// household. An empty selection is trivially inside it (an invitation with
// no provider scope is valid).
//
// The count is compared against len(ids) exactly as the TypeScript compared
// row count against the input length, so a list containing the same id twice
// is rejected rather than silently deduplicated: the caller sent something
// it did not mean.
func (r *Repo) ProvidersBelong(ctx context.Context, householdID string, ids []string) (bool, error) {
	if len(ids) == 0 {
		return true, nil
	}
	found, err := r.q.CountProvidersInHousehold(ctx, gen.CountProvidersInHouseholdParams{
		HouseholdID: householdID,
		ProviderIds: ids,
	})
	if err != nil {
		return false, fmt.Errorf("repo: count providers in household: %w", err)
	}
	return int(found) == len(ids), nil
}

func householdFromRow(row gen.Households) Household {
	return Household{
		ID:          row.ID,
		Slug:        row.Slug,
		DisplayName: row.DisplayName,
		CreatedAt:   fromTS(row.CreatedAt),
		UpdatedAt:   fromTS(row.UpdatedAt),
	}
}
