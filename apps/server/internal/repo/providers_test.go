package repo_test

import (
	"testing"

	"github.com/andersro93/mi-casa-su-casa/server/internal/domain"
	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
)

// Ports test/integration/provider-rules.test.ts and the provider-access half
// of test/integration/membership-removal.test.ts and tenant-isolation.test.ts.

func envelope(address string) []repo.Candidate {
	return []repo.Candidate{{Address: address, Source: domain.SourceEnvelope}}
}

func TestFindProviderMatchPrefersExactOverDomainAndIsCaseInsensitive(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	_, household := ownedHousehold(t, r, rig, "owner@example.com", "casa")

	netflix, err := r.CreateProvider(c, household.ID, "netflix", "Netflix")
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}
	generic, err := r.CreateProvider(c, household.ID, "generic", "Generic")
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}
	if _, err := r.CreateSenderRule(c, household.ID, generic.ID, "domain", "netflix.com"); err != nil {
		t.Fatalf("CreateSenderRule: %v", err)
	}
	if _, err := r.CreateSenderRule(c, household.ID, netflix.ID, "exact", "info@netflix.com"); err != nil {
		t.Fatalf("CreateSenderRule: %v", err)
	}

	exact, err := r.FindProviderMatch(c, household.ID, envelope("INFO@Netflix.com"))
	if err != nil {
		t.Fatalf("FindProviderMatch: %v", err)
	}
	if exact == nil || exact.ProviderKey != "netflix" || exact.MatchType != "exact" {
		t.Fatalf("FindProviderMatch(exact) = %+v", exact)
	}
	if exact.HouseholdSlug != "casa" || exact.HouseholdID != household.ID {
		t.Fatalf("FindProviderMatch did not report the household: %+v", exact)
	}

	byDomain, err := r.FindProviderMatch(c, household.ID, envelope("other@netflix.com"))
	if err != nil {
		t.Fatalf("FindProviderMatch: %v", err)
	}
	if byDomain == nil || byDomain.ProviderKey != "generic" || byDomain.MatchType != "domain" {
		t.Fatalf("FindProviderMatch(domain) = %+v", byDomain)
	}
}

func TestFindProviderMatchIgnoresLookAlikeDomainsAndOtherHouseholds(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	_, casa := ownedHousehold(t, r, rig, "a@example.com", "casa")
	_, otra := ownedHousehold(t, r, rig, "b@example.com", "otra")

	provider, err := r.CreateProvider(c, casa.ID, "netflix", "Netflix")
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}
	if _, err := r.CreateSenderRule(c, casa.ID, provider.ID, "domain", "netflix.com"); err != nil {
		t.Fatalf("CreateSenderRule: %v", err)
	}

	lookAlike, err := r.FindProviderMatch(c, casa.ID, envelope("x@notnetflix.com"))
	if err != nil {
		t.Fatalf("FindProviderMatch: %v", err)
	}
	if lookAlike != nil {
		t.Fatalf("notnetflix.com matched %+v, want no match", lookAlike)
	}

	crossTenant, err := r.FindProviderMatch(c, otra.ID, envelope("x@netflix.com"))
	if err != nil {
		t.Fatalf("FindProviderMatch: %v", err)
	}
	if crossTenant != nil {
		t.Fatalf("another household's rule matched: %+v", crossTenant)
	}
}

func TestFindProviderMatchPrefersTheMostSpecificDomainRule(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	_, household := ownedHousehold(t, r, rig, "owner@example.com", "casa")

	netflix, err := r.CreateProvider(c, household.ID, "netflix", "Netflix")
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}
	ses, err := r.CreateProvider(c, household.ID, "ses", "SES")
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}
	if _, err := r.CreateSenderRule(c, household.ID, netflix.ID, "domain", "netflix.com"); err != nil {
		t.Fatalf("CreateSenderRule: %v", err)
	}
	if _, err := r.CreateSenderRule(c, household.ID, ses.ID, "domain", "em.netflix.com"); err != nil {
		t.Fatalf("CreateSenderRule: %v", err)
	}

	for _, testCase := range []struct{ address, want string }{
		{"bounces@mail.netflix.com", "netflix"},
		{"x@em.netflix.com", "ses"},
	} {
		match, err := r.FindProviderMatch(c, household.ID, envelope(testCase.address))
		if err != nil {
			t.Fatalf("FindProviderMatch(%s): %v", testCase.address, err)
		}
		if match == nil || match.ProviderKey != testCase.want {
			t.Fatalf("FindProviderMatch(%s) = %+v, want provider %s", testCase.address, match, testCase.want)
		}
	}
}

func TestFindProviderMatchTriesTheHeaderAddressFirstAndReportsTheSource(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	_, household := ownedHousehold(t, r, rig, "owner@example.com", "casa")

	netflix, err := r.CreateProvider(c, household.ID, "netflix", "Netflix")
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}
	if _, err := r.CreateSenderRule(c, household.ID, netflix.ID, "domain", "netflix.com"); err != nil {
		t.Fatalf("CreateSenderRule: %v", err)
	}

	match, err := r.FindProviderMatch(c, household.ID, []repo.Candidate{
		{Address: "info@netflix.com", Source: domain.SourceHeader},
		{Address: "bounce+123@amazonses.com", Source: domain.SourceEnvelope},
	})
	if err != nil {
		t.Fatalf("FindProviderMatch: %v", err)
	}
	if match == nil || match.ProviderKey != "netflix" ||
		match.MatchedAddress != "info@netflix.com" ||
		match.MatchedSource != domain.SourceHeader ||
		match.MatchType != "domain" {
		t.Fatalf("FindProviderMatch = %+v", match)
	}

	envelopeOnly, err := r.FindProviderMatch(c, household.ID, []repo.Candidate{
		{Address: "someone@else.example", Source: domain.SourceHeader},
		{Address: "  Codes@Netflix.com ", Source: domain.SourceEnvelope},
	})
	if err != nil {
		t.Fatalf("FindProviderMatch: %v", err)
	}
	if envelopeOnly == nil || envelopeOnly.MatchedSource != domain.SourceEnvelope ||
		envelopeOnly.MatchedAddress != "codes@netflix.com" {
		t.Fatalf("FindProviderMatch(envelope fallback) = %+v", envelopeOnly)
	}
}

func TestCreateSenderRuleRejectsDuplicatesWithinAHousehold(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	_, household := ownedHousehold(t, r, rig, "owner@example.com", "casa")
	provider, err := r.CreateProvider(c, household.ID, "netflix", "Netflix")
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}

	if _, err := r.CreateSenderRule(c, household.ID, provider.ID, "domain", "netflix.com"); err != nil {
		t.Fatalf("CreateSenderRule: %v", err)
	}
	_, err = r.CreateSenderRule(c, household.ID, provider.ID, "domain", "netflix.com")
	if err == nil {
		t.Fatal("duplicate CreateSenderRule succeeded, want a unique violation")
	}
	if !repo.IsUniqueViolation(err) {
		t.Fatalf("CreateSenderRule error = %v, want a unique violation", err)
	}
	if got := repo.UniqueViolationConstraint(err); got != "sender_rules_household_match_unique" {
		t.Fatalf("UniqueViolationConstraint = %q", got)
	}
}

func TestProviderAndSenderRuleCrudIsHouseholdScoped(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	_, casa := ownedHousehold(t, r, rig, "a@example.com", "casa")
	_, otra := ownedHousehold(t, r, rig, "b@example.com", "otra")

	provider, err := r.CreateProvider(c, casa.ID, "netflix", "Netflix")
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}
	rule, err := r.CreateSenderRule(c, casa.ID, provider.ID, "domain", "netflix.com")
	if err != nil {
		t.Fatalf("CreateSenderRule: %v", err)
	}

	// Reads from the owning household succeed; the same ids read through
	// another household find nothing.
	byKey, err := r.GetProviderByKey(c, casa.ID, "netflix")
	if err != nil || byKey == nil {
		t.Fatalf("GetProviderByKey = %+v (%v)", byKey, err)
	}
	if other, err := r.GetProviderByKey(c, otra.ID, "netflix"); err != nil || other != nil {
		t.Fatalf("GetProviderByKey(other household) = %+v (%v), want nil", other, err)
	}
	if byID, err := r.GetProviderByID(c, otra.ID, provider.ID); err != nil || byID != nil {
		t.Fatalf("GetProviderByID(other household) = %+v (%v), want nil", byID, err)
	}
	if got, err := r.GetSenderRuleByID(c, otra.ID, rule.ID); err != nil || got != nil {
		t.Fatalf("GetSenderRuleByID(other household) = %+v (%v), want nil", got, err)
	}

	// Writes through the wrong household must not touch the row either.
	updated, err := r.UpdateProvider(c, otra.ID, provider.ID, "hijack", "Hijack")
	if err != nil || updated != nil {
		t.Fatalf("UpdateProvider(other household) = %+v (%v), want nil", updated, err)
	}
	deleted, err := r.DeleteProvider(c, otra.ID, provider.ID)
	if err != nil || deleted {
		t.Fatalf("DeleteProvider(other household) = %v (%v), want false", deleted, err)
	}
	ruleUpdated, err := r.UpdateSenderRule(c, otra.ID, rule.ID, provider.ID, "exact", "x@y.z")
	if err != nil || ruleUpdated != nil {
		t.Fatalf("UpdateSenderRule(other household) = %+v (%v), want nil", ruleUpdated, err)
	}
	ruleDeleted, err := r.DeleteSenderRule(c, otra.ID, rule.ID)
	if err != nil || ruleDeleted {
		t.Fatalf("DeleteSenderRule(other household) = %v (%v), want false", ruleDeleted, err)
	}

	// The owning household still sees the untouched rows, with the rule count.
	configurations, err := r.ListProviderConfigurations(c, casa.ID)
	if err != nil {
		t.Fatalf("ListProviderConfigurations: %v", err)
	}
	if len(configurations) != 1 || configurations[0].ProviderKey != "netflix" || configurations[0].RuleCount != 1 {
		t.Fatalf("ListProviderConfigurations = %+v", configurations)
	}
	if empty, err := r.ListProviderConfigurations(c, otra.ID); err != nil || len(empty) != 0 {
		t.Fatalf("ListProviderConfigurations(other household) = %+v (%v)", empty, err)
	}
	rules, err := r.ListSenderRules(c, casa.ID)
	if err != nil || len(rules) != 1 || rules[0].MatchValue != "netflix.com" {
		t.Fatalf("ListSenderRules = %+v (%v)", rules, err)
	}
	if empty, err := r.ListSenderRules(c, otra.ID); err != nil || len(empty) != 0 {
		t.Fatalf("ListSenderRules(other household) = %+v (%v)", empty, err)
	}

	// And the real update and delete do work.
	renamed, err := r.UpdateProvider(c, casa.ID, provider.ID, "netflix", "Netflix NO")
	if err != nil || renamed == nil || renamed.DisplayName != "Netflix NO" {
		t.Fatalf("UpdateProvider = %+v (%v)", renamed, err)
	}
	movedRule, err := r.UpdateSenderRule(c, casa.ID, rule.ID, provider.ID, "exact", "info@netflix.com")
	if err != nil || movedRule == nil || movedRule.MatchType != "exact" {
		t.Fatalf("UpdateSenderRule = %+v (%v)", movedRule, err)
	}
	if ok, err := r.DeleteSenderRule(c, casa.ID, rule.ID); err != nil || !ok {
		t.Fatalf("DeleteSenderRule = %v (%v), want true", ok, err)
	}
	if ok, err := r.DeleteProvider(c, casa.ID, provider.ID); err != nil || !ok {
		t.Fatalf("DeleteProvider = %v (%v), want true", ok, err)
	}
}

func TestMembersProviderAccessGrantRevokeAndCascade(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	owner, casa := ownedHousehold(t, r, rig, "owner@example.com", "casa")
	_, otra := ownedHousehold(t, r, rig, "other@example.com", "otra")
	member := insertUser(t, rig, "member@example.com")
	addMembership(t, rig, casa.ID, member, repo.RoleMember)

	netflix, err := r.CreateProvider(c, casa.ID, "netflix", "Netflix")
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}

	if has, err := r.UserHasProviderAccess(c, casa.ID, member, "netflix"); err != nil || has {
		t.Fatalf("UserHasProviderAccess before grant = %v (%v), want false", has, err)
	}
	if err := r.GrantProviderAccess(c, casa.ID, member, netflix.ID); err != nil {
		t.Fatalf("GrantProviderAccess: %v", err)
	}
	// Granting twice is a no-op rather than a unique violation.
	if err := r.GrantProviderAccess(c, casa.ID, member, netflix.ID); err != nil {
		t.Fatalf("GrantProviderAccess (repeat): %v", err)
	}
	if got := countRows(t, rig, "household_member_provider_access", ""); got != 1 {
		t.Fatalf("access rows = %d, want 1", got)
	}
	if has, err := r.UserHasProviderAccess(c, casa.ID, member, "netflix"); err != nil || !has {
		t.Fatalf("UserHasProviderAccess after grant = %v (%v), want true", has, err)
	}

	// Ports tenant-isolation.test.ts: granting another household's provider
	// is a silent no-op, never a cross-tenant grant.
	otherMember := insertUser(t, rig, "outsider@example.com")
	addMembership(t, rig, otra.ID, otherMember, repo.RoleMember)
	if err := r.GrantProviderAccess(c, otra.ID, otherMember, netflix.ID); err != nil {
		t.Fatalf("GrantProviderAccess (cross-tenant): %v", err)
	}
	if got := countRows(t, rig, "household_member_provider_access", ""); got != 1 {
		t.Fatalf("access rows after a cross-tenant grant = %d, want 1", got)
	}

	members, err := r.ListMembers(c, casa.ID)
	if err != nil {
		t.Fatalf("ListMembers: %v", err)
	}
	if len(members) != 2 {
		t.Fatalf("ListMembers = %+v, want 2 members", members)
	}
	var seenOwner bool
	for _, entry := range members {
		if entry.ID == owner {
			seenOwner = true
			if entry.HouseholdRole != repo.RoleOwner || entry.Role != repo.RoleOwner {
				t.Fatalf("owner entry = %+v, want householdRole and role owner", entry)
			}
			if entry.Email != "owner@example.com" || entry.CreatedAt.IsZero() {
				t.Fatalf("owner entry = %+v", entry)
			}
		}
	}
	if !seenOwner {
		t.Fatalf("ListMembers omitted the owner: %+v", members)
	}

	access, err := r.ListMemberProviderAccess(c, casa.ID)
	if err != nil {
		t.Fatalf("ListMemberProviderAccess: %v", err)
	}
	if len(access) != 2 {
		t.Fatalf("ListMemberProviderAccess = %+v, want one row per member", access)
	}
	var granted int
	for _, row := range access {
		if row.ProviderKey != nil && *row.ProviderKey == "netflix" {
			granted++
			if row.ID != member {
				t.Fatalf("access row belongs to %s, want %s", row.ID, member)
			}
		}
	}
	if granted != 1 {
		t.Fatalf("ListMemberProviderAccess granted rows = %d, want 1", granted)
	}

	providers, err := r.ListProviders(c, casa.ID)
	if err != nil || len(providers) != 1 || providers[0].ProviderKey != "netflix" {
		t.Fatalf("ListProviders = %+v (%v)", providers, err)
	}

	if err := r.RevokeProviderAccess(c, casa.ID, member, netflix.ID); err != nil {
		t.Fatalf("RevokeProviderAccess: %v", err)
	}
	if got := countRows(t, rig, "household_member_provider_access", ""); got != 0 {
		t.Fatalf("access rows after revoke = %d, want 0", got)
	}

	// Ports membership-removal.test.ts: access rows cascade with the
	// membership they hang off.
	if err := r.GrantProviderAccess(c, casa.ID, member, netflix.ID); err != nil {
		t.Fatalf("GrantProviderAccess: %v", err)
	}
	if got := countRows(t, rig, "household_member_provider_access", ""); got != 1 {
		t.Fatalf("access rows = %d, want 1", got)
	}
	if err := r.RemoveMember(c, casa.ID, member); err != nil {
		t.Fatalf("RemoveMember: %v", err)
	}
	if got := countRows(t, rig, "household_member_provider_access", ""); got != 0 {
		t.Fatalf("access rows after RemoveMember = %d, want 0 (they cascade)", got)
	}
}
