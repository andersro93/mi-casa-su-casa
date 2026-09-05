package repo_test

import (
	"testing"

	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
)

// Ports test/integration/households-repository.test.ts and the household
// halves of invitations-repository.test.ts and membership-removal.test.ts.

func TestCreateHouseholdInsertsHouseholdAndOwnerMembership(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	owner := insertUser(t, rig, "owner@example.com")

	household, err := r.CreateHousehold(c, "casa", "Casa", owner)
	if err != nil {
		t.Fatalf("CreateHousehold: %v", err)
	}
	if household.Slug != "casa" || household.DisplayName != "Casa" {
		t.Fatalf("CreateHousehold returned %+v", household)
	}
	if household.ID == "" {
		t.Fatal("CreateHousehold returned an empty id")
	}
	if household.CreatedAt.IsZero() || household.UpdatedAt.IsZero() {
		t.Fatalf("CreateHousehold left timestamps zero: %+v", household)
	}

	membership, err := r.MembershipForSlug(c, owner, "casa")
	if err != nil {
		t.Fatalf("MembershipForSlug: %v", err)
	}
	if membership == nil || membership.Role != "owner" || membership.HouseholdID != household.ID {
		t.Fatalf("MembershipForSlug = %+v, want owner of %s", membership, household.ID)
	}
	if got := countRows(t, rig, "households", ""); got != 1 {
		t.Fatalf("households rows = %d, want 1", got)
	}
	if got := countRows(t, rig, "household_memberships", ""); got != 1 {
		t.Fatalf("household_memberships rows = %d, want 1", got)
	}
}

func TestCreateHouseholdRollsBackOnDuplicateSlug(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	first := insertUser(t, rig, "first@example.com")
	second := insertUser(t, rig, "second@example.com")

	if _, err := r.CreateHousehold(c, "casa", "Casa", first); err != nil {
		t.Fatalf("CreateHousehold: %v", err)
	}

	_, err := r.CreateHousehold(c, "casa", "Casa Again", second)
	if err == nil {
		t.Fatal("CreateHousehold with a taken slug succeeded, want a unique violation")
	}
	if !repo.IsUniqueViolation(err) {
		t.Fatalf("CreateHousehold error = %v, want a unique violation", err)
	}
	// The membership half of the transaction must not survive the failure.
	if got := countRows(t, rig, "household_memberships", ""); got != 1 {
		t.Fatalf("household_memberships rows = %d, want 1 (the failed insert rolled back)", got)
	}
}

func TestMembershipLookupsAndRoleChanges(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	member := insertUser(t, rig, "member@example.com")
	owner, household := ownedHousehold(t, r, rig, "owner@example.com", "casa")

	found, err := r.MembershipForSlug(c, member, "casa")
	if err != nil {
		t.Fatalf("MembershipForSlug: %v", err)
	}
	if found != nil {
		t.Fatalf("MembershipForSlug for a non-member = %+v, want nil", found)
	}

	if err := r.SetMemberRole(c, household.ID, owner, "member"); err != nil {
		t.Fatalf("SetMemberRole: %v", err)
	}
	found, err = r.MembershipForSlug(c, owner, "casa")
	if err != nil {
		t.Fatalf("MembershipForSlug: %v", err)
	}
	if found == nil || found.Role != "member" || found.Slug != "casa" {
		t.Fatalf("MembershipForSlug after SetMemberRole = %+v", found)
	}

	byID, err := r.GetMembership(c, owner, household.ID)
	if err != nil {
		t.Fatalf("GetMembership: %v", err)
	}
	if byID == nil || byID.Role != "member" {
		t.Fatalf("GetMembership = %+v, want role member", byID)
	}

	summaries, err := r.ListHouseholdsForUser(c, owner)
	if err != nil {
		t.Fatalf("ListHouseholdsForUser: %v", err)
	}
	if len(summaries) != 1 || summaries[0].Slug != "casa" || summaries[0].Role != "member" {
		t.Fatalf("ListHouseholdsForUser = %+v", summaries)
	}
}

func TestListHouseholdsForUserOrdersByLowercasedDisplayName(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	user := insertUser(t, rig, "multi@example.com")

	for _, seed := range []struct{ slug, display string }{
		{"zulu", "alpha House"},
		{"alpha", "Zulu House"},
		{"bravo", "beta House"},
	} {
		if _, err := r.CreateHousehold(c, seed.slug, seed.display, user); err != nil {
			t.Fatalf("CreateHousehold %s: %v", seed.slug, err)
		}
	}

	summaries, err := r.ListHouseholdsForUser(c, user)
	if err != nil {
		t.Fatalf("ListHouseholdsForUser: %v", err)
	}
	var got []string
	for _, summary := range summaries {
		got = append(got, summary.DisplayName)
	}
	want := []string{"alpha House", "beta House", "Zulu House"}
	for i := range want {
		if i >= len(got) || got[i] != want[i] {
			t.Fatalf("ListHouseholdsForUser order = %v, want %v", got, want)
		}
	}
}

func TestGetHouseholdBySlugAndID(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	_, household := ownedHousehold(t, r, rig, "owner@example.com", "casa")

	bySlug, err := r.GetHouseholdBySlug(c, "casa")
	if err != nil {
		t.Fatalf("GetHouseholdBySlug: %v", err)
	}
	if bySlug == nil || bySlug.ID != household.ID {
		t.Fatalf("GetHouseholdBySlug = %+v", bySlug)
	}

	missing, err := r.GetHouseholdBySlug(c, "nope")
	if err != nil {
		t.Fatalf("GetHouseholdBySlug(nope): %v", err)
	}
	if missing != nil {
		t.Fatalf("GetHouseholdBySlug(nope) = %+v, want nil", missing)
	}

	byID, err := r.GetHouseholdByID(c, household.ID)
	if err != nil {
		t.Fatalf("GetHouseholdByID: %v", err)
	}
	if byID == nil || byID.Slug != "casa" {
		t.Fatalf("GetHouseholdByID = %+v", byID)
	}
}

func TestUpdateHouseholdDisplayName(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	_, household := ownedHousehold(t, r, rig, "owner@example.com", "casa")

	updated, err := r.UpdateHouseholdDisplayName(c, household.ID, "Casa Nueva")
	if err != nil {
		t.Fatalf("UpdateHouseholdDisplayName: %v", err)
	}
	if updated == nil || updated.DisplayName != "Casa Nueva" {
		t.Fatalf("UpdateHouseholdDisplayName = %+v", updated)
	}
	if !updated.UpdatedAt.After(household.UpdatedAt) && !updated.UpdatedAt.Equal(household.UpdatedAt) {
		t.Fatalf("updated_at went backwards: %v then %v", household.UpdatedAt, updated.UpdatedAt)
	}
}

func TestCountOwnersAndRemoveMember(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	_, household := ownedHousehold(t, r, rig, "owner@example.com", "casa")
	member := insertUser(t, rig, "member@example.com")
	addMembership(t, rig, household.ID, member, "member")

	owners, err := r.CountOwners(c, household.ID)
	if err != nil {
		t.Fatalf("CountOwners: %v", err)
	}
	if owners != 1 {
		t.Fatalf("CountOwners = %d, want 1", owners)
	}

	if err := r.SetMemberRole(c, household.ID, member, "owner"); err != nil {
		t.Fatalf("SetMemberRole: %v", err)
	}
	if owners, err = r.CountOwners(c, household.ID); err != nil || owners != 2 {
		t.Fatalf("CountOwners = %d (%v), want 2", owners, err)
	}

	if err := r.RemoveMember(c, household.ID, member); err != nil {
		t.Fatalf("RemoveMember: %v", err)
	}
	if got := countRows(t, rig, "household_memberships", "user_id = $1", member); got != 0 {
		t.Fatalf("membership rows after RemoveMember = %d, want 0", got)
	}
}

func TestProvidersBelong(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	_, casa := ownedHousehold(t, r, rig, "a@example.com", "casa-a")
	_, otra := ownedHousehold(t, r, rig, "b@example.com", "casa-b")

	netflix, err := r.CreateProvider(c, casa.ID, "netflix", "Netflix")
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}

	ok, err := r.ProvidersBelong(c, casa.ID, []string{netflix.ID})
	if err != nil || !ok {
		t.Fatalf("ProvidersBelong(own) = %v (%v), want true", ok, err)
	}
	// Ports tenant-isolation.test.ts: another household never sees the row.
	ok, err = r.ProvidersBelong(c, otra.ID, []string{netflix.ID})
	if err != nil || ok {
		t.Fatalf("ProvidersBelong(other household) = %v (%v), want false", ok, err)
	}
	// An empty selection is trivially inside the household.
	ok, err = r.ProvidersBelong(c, casa.ID, nil)
	if err != nil || !ok {
		t.Fatalf("ProvidersBelong(empty) = %v (%v), want true", ok, err)
	}
	ok, err = r.ProvidersBelong(c, casa.ID, []string{netflix.ID, "does-not-exist"})
	if err != nil || ok {
		t.Fatalf("ProvidersBelong(partly unknown) = %v (%v), want false", ok, err)
	}
}
