package repo_test

import (
	"testing"
	"time"
)

// Ports src/server/db/repositories/users.ts and settings.ts (the account
// settings screen: profile, households and devices).

func TestFindUserByEmailAndID(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	id := insertUser(t, rig, "owner@example.com")

	// Lookup normalises the address, so a typed-in " Owner@Example.com "
	// finds the same account the sign-up created.
	found, err := r.FindUserByEmail(c, "  Owner@Example.COM ")
	if err != nil || found == nil || found.ID != id {
		t.Fatalf("FindUserByEmail = %+v (%v)", found, err)
	}
	if found.Email != "owner@example.com" || found.Name != "owner" {
		t.Fatalf("user = %+v", found)
	}
	if missing, err := r.FindUserByEmail(c, "nobody@example.com"); err != nil || missing != nil {
		t.Fatalf("FindUserByEmail(unknown) = %+v (%v), want nil", missing, err)
	}

	byID, err := r.FindUserByID(c, id)
	if err != nil || byID == nil || byID.Email != "owner@example.com" {
		t.Fatalf("FindUserByID = %+v (%v)", byID, err)
	}
	if missing, err := r.FindUserByID(c, "no-such-user"); err != nil || missing != nil {
		t.Fatalf("FindUserByID(unknown) = %+v (%v), want nil", missing, err)
	}
}

func TestDeleteUserCascadesMemberships(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	owner, _ := ownedHousehold(t, r, rig, "owner@example.com", "casa")

	if err := r.DeleteUser(c, owner); err != nil {
		t.Fatalf("DeleteUser: %v", err)
	}
	if got := countRows(t, rig, "users", ""); got != 0 {
		t.Fatalf("users = %d, want 0", got)
	}
	if got := countRows(t, rig, "household_memberships", ""); got != 0 {
		t.Fatalf("memberships = %d, want 0 (they cascade)", got)
	}
	// The household itself survives its last member being deleted.
	if got := countRows(t, rig, "households", ""); got != 1 {
		t.Fatalf("households = %d, want 1", got)
	}
}

func TestGetAndUpdateUserProfile(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	owner, household := ownedHousehold(t, r, rig, "owner@example.com", "casa")

	profile, err := r.GetUserProfile(c, owner)
	if err != nil || profile == nil {
		t.Fatalf("GetUserProfile = %+v (%v)", profile, err)
	}
	if profile.ID != owner || profile.Email != "owner@example.com" || profile.TwoFactorEnabled {
		t.Fatalf("profile = %+v", profile)
	}
	if profile.Image != nil {
		t.Fatalf("image = %v, want nil", profile.Image)
	}
	if len(profile.Households) != 1 || profile.Households[0].Slug != household.Slug ||
		profile.Households[0].Role != "owner" {
		t.Fatalf("profile households = %+v", profile.Households)
	}

	updated, err := r.UpdateUserProfile(c, owner, "New Name", strptr("https://example.com/a.png"))
	if err != nil || updated == nil {
		t.Fatalf("UpdateUserProfile = %+v (%v)", updated, err)
	}
	if updated.Name != "New Name" || updated.Image == nil || *updated.Image != "https://example.com/a.png" {
		t.Fatalf("updated profile = %+v", updated)
	}
	// Clearing the image is a null, not an empty string.
	cleared, err := r.UpdateUserProfile(c, owner, "New Name", nil)
	if err != nil || cleared == nil || cleared.Image != nil {
		t.Fatalf("cleared profile = %+v (%v)", cleared, err)
	}

	if missing, err := r.GetUserProfile(c, "no-such-user"); err != nil || missing != nil {
		t.Fatalf("GetUserProfile(unknown) = %+v (%v), want nil", missing, err)
	}
}

func TestListAndDeleteUserSessions(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	owner := insertUser(t, rig, "owner@example.com")
	other := insertUser(t, rig, "other@example.com")

	insertSession(t, rig, "session-old", owner, "tok-old",
		time.Now().UTC().Add(-2*time.Hour),
		`{"ip_address":"digest-1","user_agent":"Firefox"}`)
	insertSession(t, rig, "session-new", owner, "tok-new",
		time.Now().UTC().Add(-time.Hour), "")
	insertSession(t, rig, "session-third", owner, "tok-third",
		time.Now().UTC().Add(-30*time.Minute), `{"unrelated":"value"}`)
	insertSession(t, rig, "session-other-user", other, "tok-other",
		time.Now().UTC(), "")

	sessions, err := r.ListUserSessions(c, owner)
	if err != nil {
		t.Fatalf("ListUserSessions: %v", err)
	}
	if len(sessions) != 3 {
		t.Fatalf("ListUserSessions = %d sessions, want 3 (never another user's)", len(sessions))
	}
	// Newest first.
	if sessions[0].ID != "session-third" || sessions[2].ID != "session-old" {
		t.Fatalf("session order = %s … %s", sessions[0].ID, sessions[2].ID)
	}
	oldest := sessions[2]
	if oldest.IPAddress == nil || *oldest.IPAddress != "digest-1" ||
		oldest.UserAgent == nil || *oldest.UserAgent != "Firefox" {
		t.Fatalf("session metadata = %+v", oldest)
	}
	if oldest.ExpiresAt.IsZero() || oldest.CreatedAt.IsZero() {
		t.Fatalf("session timestamps = %+v", oldest)
	}
	// Metadata that is absent, or present but carrying neither key, reads as
	// nil rather than an empty string.
	for _, session := range sessions[:2] {
		if session.IPAddress != nil || session.UserAgent != nil {
			t.Fatalf("session %s = %+v, want nil metadata fields", session.ID, session)
		}
	}

	// Deleting one session only touches this user's.
	if err := r.DeleteSession(c, owner, "session-other-user"); err != nil {
		t.Fatalf("DeleteSession: %v", err)
	}
	if got := countRows(t, rig, "sessions", "id = 'session-other-user'"); got != 1 {
		t.Fatalf("another user's session was deleted")
	}
	if err := r.DeleteSession(c, owner, "session-old"); err != nil {
		t.Fatalf("DeleteSession: %v", err)
	}
	if got := countRows(t, rig, "sessions", "user_id = $1", owner); got != 2 {
		t.Fatalf("owner sessions = %d, want 2", got)
	}

	if err := r.DeleteOtherSessions(c, owner, "session-new"); err != nil {
		t.Fatalf("DeleteOtherSessions: %v", err)
	}
	if got := countRows(t, rig, "sessions", "user_id = $1", owner); got != 1 {
		t.Fatalf("owner sessions after revoking the others = %d, want 1", got)
	}
	if got := countRows(t, rig, "sessions", "id = 'session-new'"); got != 1 {
		t.Fatalf("the current session was revoked along with the others")
	}
	if got := countRows(t, rig, "sessions", "id = 'session-other-user'"); got != 1 {
		t.Fatalf("another user's session was revoked")
	}
}
