package repo_test

import (
	"sort"
	"testing"
	"time"

	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
)

// Ports test/integration/invitations-repository.test.ts,
// invitation-expiry.test.ts and the invitation half of
// tenant-isolation.test.ts.

func inAWeek() time.Time { return time.Now().UTC().Add(7 * 24 * time.Hour) }

func TestCreateInvitationStoresItWithItsProviderScope(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	owner, household := ownedHousehold(t, r, rig, "owner@example.com", "casa")
	netflix, err := r.CreateProvider(c, household.ID, "netflix", "Netflix")
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}
	spotify, err := r.CreateProvider(c, household.ID, "spotify", "Spotify")
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}

	id, err := r.CreateInvitation(c, repo.CreateInvitationInput{
		HouseholdID:     household.ID,
		Email:           "kid@example.com",
		Name:            "Kid",
		Role:            repo.RoleMember,
		TokenHash:       "hash-1",
		InvitedByUserID: owner,
		ExpiresAt:       inAWeek(),
		ProviderIDs:     []string{netflix.ID, spotify.ID},
	})
	if err != nil {
		t.Fatalf("CreateInvitation: %v", err)
	}

	invitation, err := r.GetInvitationByTokenHash(c, "hash-1")
	if err != nil {
		t.Fatalf("GetInvitationByTokenHash: %v", err)
	}
	if invitation == nil || invitation.ID != id || invitation.Email != "kid@example.com" ||
		invitation.Status != "pending" || invitation.Role != repo.RoleMember ||
		invitation.HouseholdID != household.ID || invitation.InvitedByUserID != owner {
		t.Fatalf("invitation = %+v", invitation)
	}
	if invitation.AcceptedByUserID != nil || invitation.AcceptedAt != nil || invitation.CancelledAt != nil {
		t.Fatalf("a fresh invitation carries accepted/cancelled fields: %+v", invitation)
	}
	keys := providerKeys(invitation.Providers)
	if len(keys) != 2 || keys[0] != "netflix" || keys[1] != "spotify" {
		t.Fatalf("invitation providers = %v", keys)
	}

	// No provider scope is also valid.
	if _, err := r.CreateInvitation(c, repo.CreateInvitationInput{
		HouseholdID:     household.ID,
		Email:           "other@example.com",
		Name:            "Other",
		Role:            repo.RoleMember,
		TokenHash:       "hash-2",
		InvitedByUserID: owner,
		ExpiresAt:       inAWeek(),
	}); err != nil {
		t.Fatalf("CreateInvitation without providers: %v", err)
	}
	if got := countRows(t, rig, "household_invitations", ""); got != 2 {
		t.Fatalf("invitations = %d, want 2", got)
	}
	unscoped, err := r.GetInvitationByTokenHash(c, "hash-2")
	if err != nil || unscoped == nil {
		t.Fatalf("GetInvitationByTokenHash(hash-2) = %+v (%v)", unscoped, err)
	}
	if len(unscoped.Providers) != 0 {
		t.Fatalf("unscoped invitation providers = %+v, want none", unscoped.Providers)
	}
}

func TestCreateInvitationRollsBackWhenAProviderScopeFails(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	owner, household := ownedHousehold(t, r, rig, "owner@example.com", "casa")

	_, err := r.CreateInvitation(c, repo.CreateInvitationInput{
		HouseholdID:     household.ID,
		Email:           "kid@example.com",
		Name:            "Kid",
		Role:            repo.RoleMember,
		TokenHash:       "hash-1",
		InvitedByUserID: owner,
		ExpiresAt:       inAWeek(),
		ProviderIDs:     []string{"no-such-provider"},
	})
	if err == nil {
		t.Fatal("CreateInvitation with an unknown provider succeeded, want a foreign-key failure")
	}
	if got := countRows(t, rig, "household_invitations", ""); got != 0 {
		t.Fatalf("invitations after a failed create = %d, want 0 (the insert rolled back)", got)
	}
}

func TestListAndGetInvitationsAreHouseholdScoped(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	ownerA, casa := ownedHousehold(t, r, rig, "a@example.com", "casa-a")
	_, otra := ownedHousehold(t, r, rig, "b@example.com", "casa-b")
	provider, err := r.CreateProvider(c, casa.ID, "netflix", "Netflix")
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}

	first, err := r.CreateInvitation(c, repo.CreateInvitationInput{
		HouseholdID: casa.ID, Email: "kid@example.com", Name: "Kid", Role: repo.RoleMember,
		TokenHash: "h1", InvitedByUserID: ownerA, ExpiresAt: inAWeek(),
		ProviderIDs: []string{provider.ID},
	})
	if err != nil {
		t.Fatalf("CreateInvitation: %v", err)
	}
	second, err := r.CreateInvitation(c, repo.CreateInvitationInput{
		HouseholdID: casa.ID, Email: "kid2@example.com", Name: "Kid 2", Role: repo.RoleOwner,
		TokenHash: "h2", InvitedByUserID: ownerA, ExpiresAt: inAWeek(),
	})
	if err != nil {
		t.Fatalf("CreateInvitation: %v", err)
	}

	if found, err := r.GetInvitationByID(c, casa.ID, first); err != nil || found == nil {
		t.Fatalf("GetInvitationByID = %+v (%v)", found, err)
	}
	// Ports tenant-isolation.test.ts.
	if found, err := r.GetInvitationByID(c, otra.ID, first); err != nil || found != nil {
		t.Fatalf("GetInvitationByID(other household) = %+v (%v), want nil", found, err)
	}

	list, err := r.ListInvitations(c, casa.ID)
	if err != nil {
		t.Fatalf("ListInvitations: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("ListInvitations = %d invitations, want 2", len(list))
	}
	// Newest first.
	if list[0].ID != second || list[1].ID != first {
		t.Fatalf("ListInvitations order = %s, %s; want %s first", list[0].ID, list[1].ID, second)
	}
	if len(list[1].Providers) != 1 || list[1].Providers[0].ProviderKey != "netflix" {
		t.Fatalf("provider scope lost in the list: %+v", list[1].Providers)
	}
	if empty, err := r.ListInvitations(c, otra.ID); err != nil || len(empty) != 0 {
		t.Fatalf("ListInvitations(other household) = %+v (%v)", empty, err)
	}

	// Another household's owner cannot cancel this invitation.
	if err := r.CancelInvitation(c, otra.ID, first); err != nil {
		t.Fatalf("CancelInvitation (cross-tenant): %v", err)
	}
	if untouched, err := r.GetInvitationByID(c, casa.ID, first); err != nil ||
		untouched == nil || untouched.Status != "pending" {
		t.Fatalf("invitation after a cross-tenant cancel = %+v (%v), want pending", untouched, err)
	}

	if err := r.CancelInvitation(c, casa.ID, first); err != nil {
		t.Fatalf("CancelInvitation: %v", err)
	}
	cancelled, err := r.GetInvitationByID(c, casa.ID, first)
	if err != nil || cancelled == nil {
		t.Fatalf("GetInvitationByID: %+v (%v)", cancelled, err)
	}
	if cancelled.Status != "cancelled" || cancelled.CancelledAt == nil {
		t.Fatalf("cancelled invitation = %+v", cancelled)
	}
}

func TestAcceptInvitationCreatesMembershipMarksAcceptedAndCopiesScope(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	owner, household := ownedHousehold(t, r, rig, "owner@example.com", "casa")
	kid := insertUser(t, rig, "kid@example.com")
	netflix, err := r.CreateProvider(c, household.ID, "netflix", "Netflix")
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}

	id, err := r.CreateInvitation(c, repo.CreateInvitationInput{
		HouseholdID: household.ID, Email: "kid@example.com", Name: "Kid", Role: repo.RoleMember,
		TokenHash: "hash-1", InvitedByUserID: owner, ExpiresAt: inAWeek(),
		ProviderIDs: []string{netflix.ID},
	})
	if err != nil {
		t.Fatalf("CreateInvitation: %v", err)
	}

	if err := r.AcceptInvitation(c, repo.AcceptInvitationInput{
		InvitationID:     id,
		HouseholdID:      household.ID,
		AcceptedByUserID: kid,
		Role:             repo.RoleMember,
	}); err != nil {
		t.Fatalf("AcceptInvitation: %v", err)
	}

	membership, err := r.MembershipForSlug(c, kid, "casa")
	if err != nil || membership == nil || membership.Role != repo.RoleMember {
		t.Fatalf("MembershipForSlug = %+v (%v)", membership, err)
	}
	accepted, err := r.GetInvitationByTokenHash(c, "hash-1")
	if err != nil || accepted == nil {
		t.Fatalf("GetInvitationByTokenHash: %+v (%v)", accepted, err)
	}
	if accepted.Status != "accepted" || accepted.AcceptedByUserID == nil ||
		*accepted.AcceptedByUserID != kid || accepted.AcceptedAt == nil {
		t.Fatalf("accepted invitation = %+v", accepted)
	}
	// The invitation's provider scope became the membership's.
	if has, err := r.UserHasProviderAccess(c, household.ID, kid, "netflix"); err != nil || !has {
		t.Fatalf("UserHasProviderAccess after accept = %v (%v), want true", has, err)
	}

	// Re-accepting with a higher role upserts instead of failing, and does
	// not duplicate the access grant.
	if err := r.AcceptInvitation(c, repo.AcceptInvitationInput{
		InvitationID:     id,
		HouseholdID:      household.ID,
		AcceptedByUserID: kid,
		Role:             repo.RoleOwner,
	}); err != nil {
		t.Fatalf("AcceptInvitation (repeat): %v", err)
	}
	membership, err = r.MembershipForSlug(c, kid, "casa")
	if err != nil || membership == nil || membership.Role != repo.RoleOwner {
		t.Fatalf("MembershipForSlug after re-accept = %+v (%v)", membership, err)
	}
	if got := countRows(t, rig, "household_memberships", ""); got != 2 {
		t.Fatalf("memberships = %d, want 2 (owner and kid)", got)
	}
	if got := countRows(t, rig, "household_member_provider_access", ""); got != 1 {
		t.Fatalf("access rows = %d, want 1", got)
	}
}

func TestRefreshExpiredInvitations(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	owner, casa := ownedHousehold(t, r, rig, "owner@example.com", "casa")
	_, otra := ownedHousehold(t, r, rig, "other@example.com", "otra")

	now := time.Date(2026, 8, 20, 19, 0, 0, 0, time.UTC)
	earlierToday := time.Date(2026, 8, 20, 10, 0, 0, 0, time.UTC)
	tomorrow := time.Date(2026, 8, 21, 10, 0, 0, 0, time.UTC)

	expiring, err := r.CreateInvitation(c, repo.CreateInvitationInput{
		HouseholdID: casa.ID, Email: "kid@example.com", Name: "Kid", Role: repo.RoleMember,
		TokenHash: "expiring", InvitedByUserID: owner, ExpiresAt: earlierToday,
	})
	if err != nil {
		t.Fatalf("CreateInvitation: %v", err)
	}
	if _, err := r.CreateInvitation(c, repo.CreateInvitationInput{
		HouseholdID: casa.ID, Email: "kid2@example.com", Name: "Kid 2", Role: repo.RoleMember,
		TokenHash: "future", InvitedByUserID: owner, ExpiresAt: tomorrow,
	}); err != nil {
		t.Fatalf("CreateInvitation: %v", err)
	}
	otherOwner := insertUser(t, rig, "otherowner@example.com")
	addMembership(t, rig, otra.ID, otherOwner, repo.RoleOwner)
	if _, err := r.CreateInvitation(c, repo.CreateInvitationInput{
		HouseholdID: otra.ID, Email: "kid3@example.com", Name: "Kid 3", Role: repo.RoleMember,
		TokenHash: "other-household", InvitedByUserID: otherOwner, ExpiresAt: earlierToday,
	}); err != nil {
		t.Fatalf("CreateInvitation: %v", err)
	}

	// An invitation that expired earlier the same day is expired now, not
	// tomorrow — the bug the TypeScript's CURRENT_TIMESTAMP comparison had.
	invitation, err := r.GetInvitationByTokenHash(c, "expiring")
	if err != nil || invitation == nil {
		t.Fatalf("GetInvitationByTokenHash: %+v (%v)", invitation, err)
	}
	if !repo.IsInvitationExpired(*invitation, now) {
		t.Fatalf("IsInvitationExpired(%v) = false, want true", invitation.ExpiresAt)
	}

	// Scoped to one household, only that household's invitations flip.
	if _, err := r.RefreshExpiredInvitations(c, now, &casa.ID); err != nil {
		t.Fatalf("RefreshExpiredInvitations: %v", err)
	}
	if got := countRows(t, rig, "household_invitations", "status = 'expired'"); got != 1 {
		t.Fatalf("expired invitations = %d, want 1", got)
	}
	flipped, err := r.GetInvitationByID(c, casa.ID, expiring)
	if err != nil || flipped == nil || flipped.Status != "expired" {
		t.Fatalf("expiring invitation = %+v (%v)", flipped, err)
	}
	future, err := r.GetInvitationByTokenHash(c, "future")
	if err != nil || future == nil || future.Status != "pending" {
		t.Fatalf("future invitation = %+v (%v), want pending", future, err)
	}
	if repo.IsInvitationExpired(*future, now) {
		t.Fatalf("IsInvitationExpired(%v) = true, want false", future.ExpiresAt)
	}

	// Unscoped, every household's stale invitations flip.
	if _, err := r.RefreshExpiredInvitations(c, now, nil); err != nil {
		t.Fatalf("RefreshExpiredInvitations (all households): %v", err)
	}
	if got := countRows(t, rig, "household_invitations", "status = 'expired'"); got != 2 {
		t.Fatalf("expired invitations = %d, want 2", got)
	}
}

func providerKeys(providers []repo.InvitationProvider) []string {
	keys := make([]string, 0, len(providers))
	for _, provider := range providers {
		keys = append(keys, provider.ProviderKey)
	}
	sort.Strings(keys)
	return keys
}
