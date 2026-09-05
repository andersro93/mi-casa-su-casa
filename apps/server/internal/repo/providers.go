package repo

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/andersro93/mi-casa-su-casa/server/internal/db/gen"
	"github.com/andersro93/mi-casa-su-casa/server/internal/domain"
)

// Ports src/server/db/repositories/provider-rules.ts and
// src/server/db/repositories/member-access.ts.

// Provider is a service a household receives mail from. snake_case tags: the
// TypeScript returned the database row shape here and the SPA reads it.
type Provider struct {
	ID          string    `json:"id"`
	HouseholdID string    `json:"household_id"`
	ProviderKey string    `json:"provider_key"`
	DisplayName string    `json:"display_name"`
	CreatedAt   time.Time `json:"created_at"`
}

// ProviderConfiguration is Provider plus how many sender rules point at it,
// for the admin screen.
type ProviderConfiguration struct {
	ID          string    `json:"id"`
	HouseholdID string    `json:"household_id"`
	ProviderKey string    `json:"provider_key"`
	DisplayName string    `json:"display_name"`
	CreatedAt   time.Time `json:"created_at"`
	RuleCount   int       `json:"rule_count"`
}

// SenderRule maps a sender address (or a whole domain) onto a provider.
type SenderRule struct {
	ID          string    `json:"id"`
	HouseholdID string    `json:"household_id"`
	ProviderID  string    `json:"provider_id"`
	MatchType   string    `json:"match_type"`
	MatchValue  string    `json:"match_value"`
	CreatedAt   time.Time `json:"created_at"`
}

// Match types a sender rule may carry (the schema's CHECK allows these two).
const (
	MatchExact  = "exact"
	MatchDomain = "domain"
)

// Member is one row of the members screen.
//
// Role duplicates HouseholdRole. In the TypeScript, `role` was Better Auth's
// global role column on the user; there is no such concept here, and the SPA
// still reads the key, so both carry the household role (REF §A2, admin
// members row).
type Member struct {
	ID            string    `json:"id"`
	HouseholdRole string    `json:"householdRole"`
	Email         string    `json:"email"`
	Name          string    `json:"name"`
	Role          string    `json:"role"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

// MemberAccess is one (member, provider they may see) pair. A member with no
// provider scope appears once with the provider fields nil, so the members
// screen can list them without a second query.
type MemberAccess struct {
	ID                  string  `json:"id"`
	HouseholdRole       string  `json:"household_role"`
	Email               string  `json:"email"`
	Name                string  `json:"name"`
	Role                string  `json:"role"`
	ProviderKey         *string `json:"provider_key"`
	ProviderDisplayName *string `json:"provider_display_name"`
}

// Candidate is one sender address the classifier may match a rule against,
// together with where it was read from — which decides, later, which
// authentication mechanism has any bearing on it (domain.Verdict).
type Candidate struct {
	Address string
	Source  domain.Source
}

// Match is a rule hit: which provider in which household, and on what.
type Match struct {
	HouseholdID    string
	HouseholdSlug  string
	ProviderID     string
	ProviderKey    string
	MatchedAddress string
	MatchedSource  domain.Source
	MatchType      string
}

// FindProviderMatch is classification step 4 (REF §A3): the provider whose
// sender rule matches one of the candidate addresses, or nil.
//
// The two passes are deliberate and ordered. Every candidate is tried
// against exact-address rules first, and only when none matches does any
// candidate get tried against domain rules — so a household that has pinned
// one address of a domain to its own provider keeps that pin even though a
// broader domain rule would also have matched. Within each pass the
// candidates are tried in the order given, which is how the visible From
// address wins over the envelope sender.
//
// Addresses are trimmed, lower-cased and de-duplicated first, exactly as the
// TypeScript did: the same address arriving as both From and envelope sender
// must cost one query, not two.
func (r *Repo) FindProviderMatch(ctx context.Context, householdID string, candidates []Candidate) (*Match, error) {
	normalized := normalizeCandidates(candidates)

	for _, candidate := range normalized {
		row, err := r.q.FindExactSenderRule(ctx, gen.FindExactSenderRuleParams{
			HouseholdID: householdID,
			Address:     candidate.Address,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			return nil, fmt.Errorf("repo: find exact sender rule: %w", err)
		}
		return &Match{
			HouseholdID:    row.HouseholdID,
			HouseholdSlug:  row.HouseholdSlug,
			ProviderID:     row.ProviderID,
			ProviderKey:    row.ProviderKey,
			MatchedAddress: candidate.Address,
			MatchedSource:  candidate.Source,
			MatchType:      MatchExact,
		}, nil
	}

	for _, candidate := range normalized {
		_, host, found := strings.Cut(candidate.Address, "@")
		if !found || host == "" {
			continue
		}
		row, err := r.q.FindDomainSenderRule(ctx, gen.FindDomainSenderRuleParams{
			HouseholdID: householdID,
			Domain:      host,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			return nil, fmt.Errorf("repo: find domain sender rule: %w", err)
		}
		return &Match{
			HouseholdID:    row.HouseholdID,
			HouseholdSlug:  row.HouseholdSlug,
			ProviderID:     row.ProviderID,
			ProviderKey:    row.ProviderKey,
			MatchedAddress: candidate.Address,
			MatchedSource:  candidate.Source,
			MatchType:      MatchDomain,
		}, nil
	}

	return nil, nil
}

// normalizeCandidates trims, lower-cases, drops empties and keeps the first
// occurrence of each address.
func normalizeCandidates(candidates []Candidate) []Candidate {
	seen := make(map[string]bool, len(candidates))
	normalized := make([]Candidate, 0, len(candidates))
	for _, candidate := range candidates {
		address := strings.ToLower(strings.TrimSpace(candidate.Address))
		if address == "" || seen[address] {
			continue
		}
		seen[address] = true
		normalized = append(normalized, Candidate{Address: address, Source: candidate.Source})
	}
	return normalized
}

// UserHasProviderAccess reports whether a member has been granted this
// provider. Owners are not consulted here — the route lets them see
// everything — so a false answer for an owner is expected and harmless.
func (r *Repo) UserHasProviderAccess(ctx context.Context, householdID, userID, providerKey string) (bool, error) {
	allowed, err := r.q.UserHasProviderAccess(ctx, gen.UserHasProviderAccessParams{
		HouseholdID: householdID,
		UserID:      userID,
		ProviderKey: providerKey,
	})
	if err != nil {
		return false, fmt.Errorf("repo: user has provider access: %w", err)
	}
	return allowed, nil
}

// ListProviderConfigurations returns the household's providers with their
// rule counts, by display name.
func (r *Repo) ListProviderConfigurations(ctx context.Context, householdID string) ([]ProviderConfiguration, error) {
	rows, err := r.q.ListProviderConfigurations(ctx, householdID)
	if err != nil {
		return nil, fmt.Errorf("repo: list provider configurations: %w", err)
	}
	configurations := make([]ProviderConfiguration, 0, len(rows))
	for _, row := range rows {
		configurations = append(configurations, ProviderConfiguration{
			ID:          row.ID,
			HouseholdID: row.HouseholdID,
			ProviderKey: row.ProviderKey,
			DisplayName: row.DisplayName,
			CreatedAt:   fromTS(row.CreatedAt),
			RuleCount:   int(row.RuleCount),
		})
	}
	return configurations, nil
}

// ListProviders returns the household's providers by display name.
func (r *Repo) ListProviders(ctx context.Context, householdID string) ([]Provider, error) {
	rows, err := r.q.ListProviders(ctx, householdID)
	if err != nil {
		return nil, fmt.Errorf("repo: list providers: %w", err)
	}
	providers := make([]Provider, 0, len(rows))
	for _, row := range rows {
		providers = append(providers, providerFromRow(row))
	}
	return providers, nil
}

// ListSenderRules returns the household's rules oldest first.
func (r *Repo) ListSenderRules(ctx context.Context, householdID string) ([]SenderRule, error) {
	rows, err := r.q.ListSenderRules(ctx, householdID)
	if err != nil {
		return nil, fmt.Errorf("repo: list sender rules: %w", err)
	}
	rules := make([]SenderRule, 0, len(rows))
	for _, row := range rows {
		rules = append(rules, senderRuleFromRow(row))
	}
	return rules, nil
}

// GetProviderByKey returns nil when the household has no such provider.
func (r *Repo) GetProviderByKey(ctx context.Context, householdID, providerKey string) (*Provider, error) {
	row, err := r.q.GetProviderByKey(ctx, gen.GetProviderByKeyParams{
		HouseholdID: householdID,
		ProviderKey: providerKey,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("repo: get provider by key: %w", err)
	}
	provider := providerFromRow(row)
	return &provider, nil
}

// GetProviderByID returns nil when the id names no provider of this
// household — including one that exists but belongs to another.
func (r *Repo) GetProviderByID(ctx context.Context, householdID, providerID string) (*Provider, error) {
	row, err := r.q.GetProviderByID(ctx, gen.GetProviderByIDParams{
		HouseholdID: householdID,
		ID:          providerID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("repo: get provider by id: %w", err)
	}
	provider := providerFromRow(row)
	return &provider, nil
}

// CreateProvider adds a provider. A key already taken in this household
// comes back as a unique violation for the API to turn into a 409.
func (r *Repo) CreateProvider(ctx context.Context, householdID, providerKey, displayName string) (Provider, error) {
	id, err := newID()
	if err != nil {
		return Provider{}, err
	}
	row, err := r.q.InsertProvider(ctx, gen.InsertProviderParams{
		ID:          id,
		HouseholdID: householdID,
		ProviderKey: providerKey,
		DisplayName: displayName,
	})
	if err != nil {
		return Provider{}, fmt.Errorf("repo: create provider: %w", err)
	}
	return providerFromRow(row), nil
}

// UpdateProvider renames a provider, returning nil when the id names no
// provider of this household.
func (r *Repo) UpdateProvider(ctx context.Context, householdID, providerID, providerKey, displayName string) (*Provider, error) {
	row, err := r.q.UpdateProvider(ctx, gen.UpdateProviderParams{
		ID:          providerID,
		HouseholdID: householdID,
		ProviderKey: providerKey,
		DisplayName: displayName,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("repo: update provider: %w", err)
	}
	provider := providerFromRow(row)
	return &provider, nil
}

// DeleteProvider removes a provider and everything hanging off it (rules,
// messages, access grants cascade). false means nothing was deleted, which
// the route answers with 404.
func (r *Repo) DeleteProvider(ctx context.Context, householdID, providerID string) (bool, error) {
	affected, err := r.q.DeleteProvider(ctx, gen.DeleteProviderParams{
		ID:          providerID,
		HouseholdID: householdID,
	})
	if err != nil {
		return false, fmt.Errorf("repo: delete provider: %w", err)
	}
	return affected > 0, nil
}

// CreateSenderRule adds a rule. A duplicate (type, value) within the
// household comes back as a unique violation.
func (r *Repo) CreateSenderRule(ctx context.Context, householdID, providerID, matchType, matchValue string) (SenderRule, error) {
	id, err := newID()
	if err != nil {
		return SenderRule{}, err
	}
	row, err := r.q.InsertSenderRule(ctx, gen.InsertSenderRuleParams{
		ID:          id,
		HouseholdID: householdID,
		ProviderID:  providerID,
		MatchType:   matchType,
		MatchValue:  matchValue,
	})
	if err != nil {
		return SenderRule{}, fmt.Errorf("repo: create sender rule: %w", err)
	}
	return senderRuleFromRow(row), nil
}

// UpdateSenderRule repoints or rewrites a rule, returning nil when the id
// names no rule of this household.
func (r *Repo) UpdateSenderRule(ctx context.Context, householdID, ruleID, providerID, matchType, matchValue string) (*SenderRule, error) {
	row, err := r.q.UpdateSenderRule(ctx, gen.UpdateSenderRuleParams{
		ID:          ruleID,
		HouseholdID: householdID,
		ProviderID:  providerID,
		MatchType:   matchType,
		MatchValue:  matchValue,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("repo: update sender rule: %w", err)
	}
	rule := senderRuleFromRow(row)
	return &rule, nil
}

// DeleteSenderRule removes a rule; false means nothing matched.
func (r *Repo) DeleteSenderRule(ctx context.Context, householdID, ruleID string) (bool, error) {
	affected, err := r.q.DeleteSenderRule(ctx, gen.DeleteSenderRuleParams{
		ID:          ruleID,
		HouseholdID: householdID,
	})
	if err != nil {
		return false, fmt.Errorf("repo: delete sender rule: %w", err)
	}
	return affected > 0, nil
}

// GetSenderRuleByID returns nil when the id names no rule of this household.
func (r *Repo) GetSenderRuleByID(ctx context.Context, householdID, ruleID string) (*SenderRule, error) {
	row, err := r.q.GetSenderRuleByID(ctx, gen.GetSenderRuleByIDParams{
		ID:          ruleID,
		HouseholdID: householdID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("repo: get sender rule by id: %w", err)
	}
	rule := senderRuleFromRow(row)
	return &rule, nil
}

// ListMembers returns the household's members, oldest account first.
func (r *Repo) ListMembers(ctx context.Context, householdID string) ([]Member, error) {
	rows, err := r.q.ListMembers(ctx, householdID)
	if err != nil {
		return nil, fmt.Errorf("repo: list members: %w", err)
	}
	members := make([]Member, 0, len(rows))
	for _, row := range rows {
		members = append(members, Member{
			ID:            row.ID,
			HouseholdRole: row.HouseholdRole,
			Email:         row.Email,
			Name:          row.Name,
			Role:          row.HouseholdRole,
			CreatedAt:     fromTS(row.CreatedAt),
			UpdatedAt:     fromTS(row.UpdatedAt),
		})
	}
	return members, nil
}

// ListMemberProviderAccess returns one row per (member, granted provider),
// and one row with nil provider fields for a member granted nothing.
func (r *Repo) ListMemberProviderAccess(ctx context.Context, householdID string) ([]MemberAccess, error) {
	rows, err := r.q.ListMemberProviderAccess(ctx, householdID)
	if err != nil {
		return nil, fmt.Errorf("repo: list member provider access: %w", err)
	}
	access := make([]MemberAccess, 0, len(rows))
	for _, row := range rows {
		access = append(access, MemberAccess{
			ID:                  row.ID,
			HouseholdRole:       row.HouseholdRole,
			Email:               row.Email,
			Name:                row.Name,
			Role:                row.HouseholdRole,
			ProviderKey:         row.ProviderKey,
			ProviderDisplayName: row.ProviderDisplayName,
		})
	}
	return access, nil
}

// GrantProviderAccess lets a member see one provider's mail. It is
// idempotent, and a provider from another household is silently ignored
// rather than granted (the INSERT ... SELECT joins on the household).
func (r *Repo) GrantProviderAccess(ctx context.Context, householdID, userID, providerID string) error {
	id, err := newID()
	if err != nil {
		return err
	}
	if err := r.q.GrantProviderAccess(ctx, gen.GrantProviderAccessParams{
		ID:          id,
		ProviderID:  providerID,
		HouseholdID: householdID,
		UserID:      userID,
	}); err != nil {
		return fmt.Errorf("repo: grant provider access: %w", err)
	}
	return nil
}

// RevokeProviderAccess takes the grant away again.
func (r *Repo) RevokeProviderAccess(ctx context.Context, householdID, userID, providerID string) error {
	if err := r.q.RevokeProviderAccess(ctx, gen.RevokeProviderAccessParams{
		ProviderID:  providerID,
		HouseholdID: householdID,
		UserID:      userID,
	}); err != nil {
		return fmt.Errorf("repo: revoke provider access: %w", err)
	}
	return nil
}

func providerFromRow(row gen.Providers) Provider {
	return Provider{
		ID:          row.ID,
		HouseholdID: row.HouseholdID,
		ProviderKey: row.ProviderKey,
		DisplayName: row.DisplayName,
		CreatedAt:   fromTS(row.CreatedAt),
	}
}

func senderRuleFromRow(row gen.SenderRules) SenderRule {
	return SenderRule{
		ID:          row.ID,
		HouseholdID: row.HouseholdID,
		ProviderID:  row.ProviderID,
		MatchType:   row.MatchType,
		MatchValue:  row.MatchValue,
		CreatedAt:   fromTS(row.CreatedAt),
	}
}
