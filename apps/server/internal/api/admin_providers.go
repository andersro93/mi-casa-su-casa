package api

import (
	"context"
	"regexp"
	"strings"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/gen"
	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
)

// Ports src/server/routes/admin/providers.ts (REF §A2, "Admin"): the
// providers a household files mail into, and the sender rules that decide
// which mail goes where.
//
// The two are one screen and two tables. A provider is the mailbox ("Netflix")
// and a rule is a claim about who fills it ("anything from netflix.com"). They
// are separate so a provider can be renamed without touching what matches it,
// and so several rules — an exact address plus a domain — can point at one
// provider.
//
// Uniqueness is handled at two different layers, deliberately:
//
//   - A duplicate provider KEY is checked before the insert, because the
//     answer names the field ("Provider key already exists") and the same
//     check is needed on update to tell "unchanged" from "taken".
//   - A duplicate RULE is not checked at all. The unique index on (household,
//     match type, match value) is the authority — two owners can add the same
//     rule at the same moment and only the index sees both — and REF §A1 item
//     11's global mapping turns the violation into the 409 the SPA renders
//     (see responseErrorHandler and errors.go).

// providerKeyPattern is REF §A4's `providerKey` rule: a lower-case slug that
// starts with a letter or a digit. The key appears in URLs (the inbox route
// addresses a provider by it), which is what the character set is for.
var providerKeyPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)

// hostnamePattern is REF §A4's `senderRule` domain rule verbatim, minus the
// total-length lookahead Go's RE2 cannot express — that bound is checked
// separately in validateSenderRuleBody.
var hostnamePattern = regexp.MustCompile(`^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$`)

// leadingAts strips the `@` an owner naturally types in front of a domain.
var leadingAts = regexp.MustCompile(`^@+`)

// ListProviderConfigurations answers the provider settings screen: every
// provider with its rule count, and every rule.
func (s server) ListProviderConfigurations(ctx context.Context, _ gen.ListProviderConfigurationsRequestObject) (gen.ListProviderConfigurationsResponseObject, error) {
	_, household, ok := s.adminContext(ctx)
	if !ok {
		return gen.ListProviderConfigurations403JSONResponse(errorBody("Forbidden")), nil
	}

	providers, err := s.Repo.ListProviderConfigurations(ctx, household.ID)
	if err != nil {
		return nil, err
	}
	rules, err := s.Repo.ListSenderRules(ctx, household.ID)
	if err != nil {
		return nil, err
	}

	return gen.ListProviderConfigurations200JSONResponse{
		Providers: providerConfigurationBodies(providers),
		Rules:     senderRuleBodies(rules),
	}, nil
}

// CreateProvider adds a provider.
func (s server) CreateProvider(ctx context.Context, request gen.CreateProviderRequestObject) (gen.CreateProviderResponseObject, error) {
	viewer, household, ok := s.adminContext(ctx)
	if !ok {
		return gen.CreateProvider403JSONResponse(errorBody("Forbidden")), nil
	}

	providerKey, displayName, problems := normalizeProviderBody(request.Body.ProviderKey, request.Body.DisplayName)
	if len(problems) > 0 {
		summary, fields := envelopeFor(problems)
		return gen.CreateProvider400JSONResponse(errorFieldsBody(summary, fields)), nil
	}

	existing, err := s.Repo.GetProviderByKey(ctx, household.ID, providerKey)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return gen.CreateProvider409JSONResponse(errorBody("Provider key already exists")), nil
	}

	provider, err := s.Repo.CreateProvider(ctx, household.ID, providerKey, displayName)
	if err != nil {
		// The lookup above is not a lock; the unique index decides a race, and
		// REF §A1 item 11's mapping answers the loser with the same 409.
		return nil, err
	}

	s.audit(ctx, viewer, household, "provider.created", "provider", &provider.ID,
		map[string]any{"providerKey": providerKey, "displayName": displayName})

	return gen.CreateProvider201JSONResponse{Provider: providerBody(provider)}, nil
}

// UpdateProvider renames a provider or changes its key.
func (s server) UpdateProvider(ctx context.Context, request gen.UpdateProviderRequestObject) (gen.UpdateProviderResponseObject, error) {
	viewer, household, ok := s.adminContext(ctx)
	if !ok {
		return gen.UpdateProvider403JSONResponse(errorBody("Forbidden")), nil
	}

	providerKey, displayName, problems := normalizeProviderBody(request.Body.ProviderKey, request.Body.DisplayName)
	if len(problems) > 0 {
		summary, fields := envelopeFor(problems)
		return gen.UpdateProvider400JSONResponse(errorFieldsBody(summary, fields)), nil
	}

	existing, err := s.Repo.GetProviderByID(ctx, household.ID, request.ProviderId)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return gen.UpdateProvider404JSONResponse(errorBody("Provider not found")), nil
	}

	// Only a conflict with a DIFFERENT provider is one: renaming a provider
	// while leaving its key alone must not report the provider against itself.
	conflict, err := s.Repo.GetProviderByKey(ctx, household.ID, providerKey)
	if err != nil {
		return nil, err
	}
	if conflict != nil && conflict.ID != request.ProviderId {
		return gen.UpdateProvider409JSONResponse(errorBody("Provider key already exists")), nil
	}

	provider, err := s.Repo.UpdateProvider(ctx, household.ID, request.ProviderId, providerKey, displayName)
	if err != nil {
		return nil, err
	}
	if provider == nil {
		return gen.UpdateProvider404JSONResponse(errorBody("Provider not found")), nil
	}

	s.audit(ctx, viewer, household, "provider.updated", "provider", &request.ProviderId,
		map[string]any{"providerKey": providerKey, "displayName": displayName})

	return gen.UpdateProvider200JSONResponse{Provider: providerBody(*provider)}, nil
}

// DeleteProvider removes a provider and everything filed under it.
//
// The cascade is the point rather than a convenience: a provider's messages
// carry verification codes, and leaving them readable after the mailbox they
// belonged to was deleted would be the opposite of what the owner asked for.
func (s server) DeleteProvider(ctx context.Context, request gen.DeleteProviderRequestObject) (gen.DeleteProviderResponseObject, error) {
	viewer, household, ok := s.adminContext(ctx)
	if !ok {
		return gen.DeleteProvider403JSONResponse(errorBody("Forbidden")), nil
	}

	provider, err := s.Repo.GetProviderByID(ctx, household.ID, request.ProviderId)
	if err != nil {
		return nil, err
	}
	if provider == nil {
		return gen.DeleteProvider404JSONResponse(errorBody("Provider not found")), nil
	}

	if _, err := s.Repo.DeleteProvider(ctx, household.ID, request.ProviderId); err != nil {
		return nil, err
	}
	s.audit(ctx, viewer, household, "provider.deleted", "provider", &request.ProviderId, nil)

	return gen.DeleteProvider200JSONResponse(okBody()), nil
}

// CreateSenderRule points an address or a domain at a provider.
func (s server) CreateSenderRule(ctx context.Context, request gen.CreateSenderRuleRequestObject) (gen.CreateSenderRuleResponseObject, error) {
	viewer, household, ok := s.adminContext(ctx)
	if !ok {
		return gen.CreateSenderRule403JSONResponse(errorBody("Forbidden")), nil
	}

	rule, problems := normalizeSenderRuleBody(request.Body.ProviderId, request.Body.MatchType, request.Body.MatchValue)
	if len(problems) > 0 {
		summary, fields := envelopeFor(problems)
		return gen.CreateSenderRule400JSONResponse(errorFieldsBody(summary, fields)), nil
	}

	// The provider is looked up SCOPED to this household, which is what makes
	// a provider id from somebody else's household a 404 rather than a rule
	// that quietly files this household's mail into theirs.
	provider, err := s.Repo.GetProviderByID(ctx, household.ID, rule.providerID)
	if err != nil {
		return nil, err
	}
	if provider == nil {
		return gen.CreateSenderRule404JSONResponse(errorBody("Provider not found")), nil
	}

	created, err := s.Repo.CreateSenderRule(ctx, household.ID, rule.providerID, rule.matchType, rule.matchValue)
	if err != nil {
		// A duplicate rule arrives here as a unique violation and leaves as
		// the 409 REF §A1 item 11 describes. See errors.go.
		return nil, err
	}

	s.audit(ctx, viewer, household, "sender_rule.created", "sender_rule", &created.ID, map[string]any{
		"providerId": rule.providerID,
		"matchType":  rule.matchType,
		"matchValue": rule.matchValue,
	})

	return gen.CreateSenderRule201JSONResponse{Rule: senderRuleBody(created)}, nil
}

// UpdateSenderRule repoints a rule or changes what it matches.
func (s server) UpdateSenderRule(ctx context.Context, request gen.UpdateSenderRuleRequestObject) (gen.UpdateSenderRuleResponseObject, error) {
	viewer, household, ok := s.adminContext(ctx)
	if !ok {
		return gen.UpdateSenderRule403JSONResponse(errorBody("Forbidden")), nil
	}

	rule, problems := normalizeSenderRuleBody(request.Body.ProviderId, request.Body.MatchType, request.Body.MatchValue)
	if len(problems) > 0 {
		summary, fields := envelopeFor(problems)
		return gen.UpdateSenderRule400JSONResponse(errorFieldsBody(summary, fields)), nil
	}

	provider, err := s.Repo.GetProviderByID(ctx, household.ID, rule.providerID)
	if err != nil {
		return nil, err
	}
	if provider == nil {
		return gen.UpdateSenderRule404JSONResponse(errorBody("Provider not found")), nil
	}
	existing, err := s.Repo.GetSenderRuleByID(ctx, household.ID, request.RuleId)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return gen.UpdateSenderRule404JSONResponse(errorBody("Sender rule not found")), nil
	}

	updated, err := s.Repo.UpdateSenderRule(ctx, household.ID, request.RuleId, rule.providerID, rule.matchType, rule.matchValue)
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return gen.UpdateSenderRule404JSONResponse(errorBody("Sender rule not found")), nil
	}

	// No matchValue in the details, matching the TypeScript: the trail records
	// that the rule was repointed, and the rule itself carries where to.
	s.audit(ctx, viewer, household, "sender_rule.updated", "sender_rule", &request.RuleId, map[string]any{
		"providerId": rule.providerID,
		"matchType":  rule.matchType,
	})

	return gen.UpdateSenderRule200JSONResponse{Rule: senderRuleBody(*updated)}, nil
}

// DeleteSenderRule removes a rule. Messages already filed under its provider
// stay: the rule decided where new mail goes, not who owns what arrived.
func (s server) DeleteSenderRule(ctx context.Context, request gen.DeleteSenderRuleRequestObject) (gen.DeleteSenderRuleResponseObject, error) {
	viewer, household, ok := s.adminContext(ctx)
	if !ok {
		return gen.DeleteSenderRule403JSONResponse(errorBody("Forbidden")), nil
	}

	rule, err := s.Repo.GetSenderRuleByID(ctx, household.ID, request.RuleId)
	if err != nil {
		return nil, err
	}
	if rule == nil {
		return gen.DeleteSenderRule404JSONResponse(errorBody("Sender rule not found")), nil
	}

	if _, err := s.Repo.DeleteSenderRule(ctx, household.ID, request.RuleId); err != nil {
		return nil, err
	}
	s.audit(ctx, viewer, household, "sender_rule.deleted", "sender_rule", &request.RuleId, nil)

	return gen.DeleteSenderRule200JSONResponse(okBody()), nil
}

// normalizeProviderBody applies REF §A4's `provider` schema: the key is
// trimmed and lower-cased before its rules run, so what is checked is what
// will be stored.
func normalizeProviderBody(rawKey, rawName string) (providerKey, displayName string, problems []problem) {
	providerKey = strings.ToLower(strings.TrimSpace(rawKey))
	displayName = strings.TrimSpace(rawName)

	// The pattern check only runs on a key that survived the length rule, so
	// one empty input produces one message rather than two.
	if keyProblems := appendTextProblems(nil, "providerKey", providerKey, 40); len(keyProblems) > 0 {
		problems = append(problems, keyProblems...)
	} else if !providerKeyPattern.MatchString(providerKey) {
		problems = append(problems, problem{
			field:   "providerKey",
			message: "providerKey may only contain lowercase letters, numbers and hyphens",
		})
	}
	problems = appendTextProblems(problems, "displayName", displayName, 80)
	return providerKey, displayName, problems
}

// senderRuleInput is a validated rule body, normalised the way it will be
// stored.
type senderRuleInput struct {
	providerID string
	matchType  string
	matchValue string
}

// maxHostnameLength is the total-length bound REF §A4's hostname regex states
// as a lookahead. Go's RE2 has no lookahead, so it is checked here instead.
const maxHostnameLength = 253

// normalizeSenderRuleBody applies REF §A4's `senderRule` schema, including the
// two shape rules that depend on the match type: a domain rule drops any
// leading `@` and must then be a hostname, an exact rule must be a full
// address.
//
// `matchType` is validated here rather than as an OpenAPI enum for the reason
// stated in the spec: an enum violation cannot say "matchType must be exact or
// domain", and that wording is what the SPA renders next to the control.
func normalizeSenderRuleBody(rawProviderID, rawMatchType, rawMatchValue string) (rule senderRuleInput, problems []problem) {
	rule.providerID = strings.TrimSpace(rawProviderID)
	rule.matchType = rawMatchType
	rule.matchValue = strings.ToLower(strings.TrimSpace(rawMatchValue))

	problems = appendTextProblems(problems, "providerId", rule.providerID, 64)

	switch rule.matchType {
	case repo.MatchExact, repo.MatchDomain:
	default:
		problems = append(problems, problem{field: "matchType", message: "matchType must be exact or domain"})
	}

	valueProblems := appendTextProblems(nil, "matchValue", rule.matchValue, 254)
	problems = append(problems, valueProblems...)
	if len(valueProblems) > 0 {
		return rule, problems
	}

	switch rule.matchType {
	case repo.MatchDomain:
		rule.matchValue = leadingAts.ReplaceAllString(rule.matchValue, "")
		if len(rule.matchValue) > maxHostnameLength || !hostnamePattern.MatchString(rule.matchValue) {
			problems = append(problems, problem{
				field:   "matchValue",
				message: "matchValue must be a domain like netflix.com",
			})
		}
	case repo.MatchExact:
		if len(rule.matchValue) < 3 || !emailPattern.MatchString(rule.matchValue) {
			problems = append(problems, problem{
				field:   "matchValue",
				message: "matchValue must be a full email address",
			})
		}
	}

	return rule, problems
}

// providerBody maps a provider onto the wire shape. snake_case keys: it is
// what the TypeScript sent and what the SPA reads.
func providerBody(provider repo.Provider) gen.Provider {
	return gen.Provider{
		Id:          provider.ID,
		HouseholdId: provider.HouseholdID,
		ProviderKey: provider.ProviderKey,
		DisplayName: provider.DisplayName,
		CreatedAt:   provider.CreatedAt,
	}
}

// providerBodies maps a list, non-nil even when empty so the key marshals as
// `[]` rather than as null.
func providerBodies(providers []repo.Provider) []gen.Provider {
	rows := make([]gen.Provider, 0, len(providers))
	for _, provider := range providers {
		rows = append(rows, providerBody(provider))
	}
	return rows
}

func providerConfigurationBodies(providers []repo.ProviderConfiguration) []gen.ProviderConfiguration {
	rows := make([]gen.ProviderConfiguration, 0, len(providers))
	for _, provider := range providers {
		rows = append(rows, gen.ProviderConfiguration{
			Id:          provider.ID,
			HouseholdId: provider.HouseholdID,
			ProviderKey: provider.ProviderKey,
			DisplayName: provider.DisplayName,
			CreatedAt:   provider.CreatedAt,
			RuleCount:   provider.RuleCount,
		})
	}
	return rows
}

func senderRuleBody(rule repo.SenderRule) gen.SenderRule {
	return gen.SenderRule{
		Id:          rule.ID,
		HouseholdId: rule.HouseholdID,
		ProviderId:  rule.ProviderID,
		MatchType:   gen.SenderRuleMatchType(rule.MatchType),
		MatchValue:  rule.MatchValue,
		CreatedAt:   rule.CreatedAt,
	}
}

func senderRuleBodies(rules []repo.SenderRule) []gen.SenderRule {
	rows := make([]gen.SenderRule, 0, len(rules))
	for _, rule := range rules {
		rows = append(rows, senderRuleBody(rule))
	}
	return rows
}
