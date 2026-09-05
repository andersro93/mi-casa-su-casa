package api_test

import (
	"bytes"
	"net/http"
	"testing"

	applog "github.com/andersro93/mi-casa-su-casa/server/internal/log"
	"github.com/andersro93/mi-casa-su-casa/server/internal/testrig"
)

// Ports test/integration/membership-removal.test.ts (the admin-route half; the
// "leave" half is in households_test.go) and the owner-only assertions of
// tenant-isolation.test.ts.

func TestListMembersReturnsRolesProviderAccessAndTheProviderList(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)
	app.CreateMember(t, slug, memberEmail, "Member", "member")
	netflix := createProvider(t, app, cookie, slug, "netflix", "Netflix")
	createProvider(t, app, cookie, slug, "spotify", "Spotify")

	member, err := app.Deps.Repo.FindUserByEmail(t.Context(), memberEmail)
	if err != nil || member == nil {
		t.Fatalf("member: %v", err)
	}
	grant := app.Do(t, http.MethodPost, adminPath(slug, "/members/"+member.ID+"/provider-access"),
		map[string]any{"providerKey": "netflix"}, testrig.WithCookie(cookie))
	if grant.Code != http.StatusOK {
		t.Fatalf("grant: %d %s", grant.Code, grant.Body.String())
	}

	rec := app.Do(t, http.MethodGet, adminPath(slug, "/members"), nil, testrig.WithCookie(cookie))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	body := app.JSON(t, rec)

	members, _ := body["members"].([]any)
	if len(members) != 2 {
		t.Fatalf("members = %v", body["members"])
	}
	// Ordered by the account's created_at, so the owner (created by setup)
	// comes first.
	owner, _ := members[0].(map[string]any)
	invited, _ := members[1].(map[string]any)
	if owner["householdRole"] != "owner" || owner["email"] != testrig.OwnerEmail {
		t.Errorf("owner = %v", owner)
	}
	// `role` duplicates `householdRole`: the SPA reads both.
	if owner["role"] != owner["householdRole"] {
		t.Errorf("role = %v, householdRole = %v", owner["role"], owner["householdRole"])
	}
	if access, _ := owner["providerAccess"].([]any); len(access) != 0 {
		t.Errorf("owner providerAccess = %v, want []", access)
	}

	access, _ := invited["providerAccess"].([]any)
	if len(access) != 1 {
		t.Fatalf("member providerAccess = %v", invited["providerAccess"])
	}
	entry, _ := access[0].(map[string]any)
	if entry["providerKey"] != "netflix" || entry["displayName"] != "Netflix" {
		t.Errorf("access = %v", entry)
	}

	providers, _ := body["providers"].([]any)
	if len(providers) != 2 {
		t.Errorf("providers = %v", body["providers"])
	}
	if netflix == "" {
		t.Error("netflix was not created")
	}
}

// The first case of membership-removal.test.ts: an owner removes a member and
// the provider access goes with it; a member may not remove anybody.
func TestRemoveMemberCascadesAccessAndIsOwnerOnly(t *testing.T) {
	app := testrig.App(t)
	ownerCookie, slug := app.CompleteSetup(t)
	memberCookie := app.CreateMember(t, slug, memberEmail, "Member", "member")

	member, err := app.Deps.Repo.FindUserByEmail(t.Context(), memberEmail)
	if err != nil || member == nil {
		t.Fatalf("member: %v", err)
	}
	owner, err := app.Deps.Repo.FindUserByEmail(t.Context(), testrig.OwnerEmail)
	if err != nil || owner == nil {
		t.Fatalf("owner: %v", err)
	}
	createProvider(t, app, ownerCookie, slug, "netflix", "Netflix")
	if grant := app.Do(t, http.MethodPost, adminPath(slug, "/members/"+member.ID+"/provider-access"),
		map[string]any{"providerKey": "netflix"}, testrig.WithCookie(ownerCookie)); grant.Code != http.StatusOK {
		t.Fatalf("grant: %d %s", grant.Code, grant.Body.String())
	}
	if got := app.Count(t, "household_member_provider_access", "TRUE"); got != 1 {
		t.Fatalf("access rows = %d, want 1", got)
	}

	// A member reaching an admin route is refused by the tier, not by the
	// handler — so it never learns whether the target exists.
	forbidden := app.Do(t, http.MethodDelete, adminPath(slug, "/members/"+owner.ID), nil,
		testrig.WithCookie(memberCookie))
	if forbidden.Code != http.StatusForbidden {
		t.Fatalf("member removing owner: %d %s", forbidden.Code, forbidden.Body.String())
	}

	logs := &bytes.Buffer{}
	applog.SetOutput(logs)
	t.Cleanup(func() { applog.SetOutput(nil) })

	removed := app.Do(t, http.MethodDelete, adminPath(slug, "/members/"+member.ID), nil,
		testrig.WithCookie(ownerCookie))
	if removed.Code != http.StatusOK {
		t.Fatalf("remove: %d %s", removed.Code, removed.Body.String())
	}
	if got := app.JSON(t, removed)["ok"]; got != true {
		t.Errorf("body = %s", removed.Body.String())
	}
	if got := app.Count(t, "household_memberships", "TRUE"); got != 1 {
		t.Errorf("memberships = %d, want 1", got)
	}
	if got := app.Count(t, "household_member_provider_access", "TRUE"); got != 0 {
		t.Errorf("access rows = %d, want 0", got)
	}
	if !bytes.Contains(logs.Bytes(), []byte(`"event":"member_removed"`)) {
		t.Errorf("logs = %s, want a member_removed event", logs.String())
	}
	if got := app.Count(t, "audit_events", `"action" = 'member.removed'`); got != 1 {
		t.Errorf("member.removed audits = %d, want 1", got)
	}
}

// The second case: removing yourself through the admin route is refused, with
// the message that names the route which does do it.
func TestRemoveMemberRefusesSelfAndUnknownMembers(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)
	owner, err := app.Deps.Repo.FindUserByEmail(t.Context(), testrig.OwnerEmail)
	if err != nil || owner == nil {
		t.Fatalf("owner: %v", err)
	}

	self := app.Do(t, http.MethodDelete, adminPath(slug, "/members/"+owner.ID), nil, testrig.WithCookie(cookie))
	if self.Code != http.StatusBadRequest {
		t.Fatalf("self: %d %s", self.Code, self.Body.String())
	}
	if got := app.JSON(t, self)["error"]; got != "Use 'Leave household' to remove yourself." {
		t.Errorf("error = %q", got)
	}

	// A signed-in stranger who is not a member of this household is a 404 from
	// the handler — the tenancy guard already established the CALLER's right
	// to be here, so the only thing left to say is that the target is not.
	strangerID, _ := signUp(t, app, "stranger@example.com", "Stranger")
	unknown := app.Do(t, http.MethodDelete, adminPath(slug, "/members/"+strangerID), nil, testrig.WithCookie(cookie))
	if unknown.Code != http.StatusNotFound {
		t.Fatalf("unknown: %d %s", unknown.Code, unknown.Body.String())
	}
	if got := app.JSON(t, unknown)["error"]; got != "Member not found" {
		t.Errorf("error = %q", got)
	}
	if got := app.Count(t, "household_memberships", "TRUE"); got != 1 {
		t.Errorf("memberships = %d, want 1", got)
	}
}

func TestUpdateMemberRole(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)
	app.CreateMember(t, slug, memberEmail, "Member", "member")
	member, err := app.Deps.Repo.FindUserByEmail(t.Context(), memberEmail)
	if err != nil || member == nil {
		t.Fatalf("member: %v", err)
	}
	owner, err := app.Deps.Repo.FindUserByEmail(t.Context(), testrig.OwnerEmail)
	if err != nil || owner == nil {
		t.Fatalf("owner: %v", err)
	}

	promoted := app.Do(t, http.MethodPatch, adminPath(slug, "/members/"+member.ID+"/role"),
		map[string]any{"role": "owner"}, testrig.WithCookie(cookie))
	if promoted.Code != http.StatusOK {
		t.Fatalf("promote: %d %s", promoted.Code, promoted.Body.String())
	}
	if got := app.Count(t, "household_memberships", `"role" = 'owner'`); got != 2 {
		t.Errorf("owners = %d, want 2", got)
	}
	if got := app.Count(t, "audit_events", `"action" = 'member.role_changed'`); got != 1 {
		t.Errorf("role_changed audits = %d, want 1", got)
	}

	// REF §A4: `admin` is accepted and means owner, for clients written
	// against the Better Auth role names.
	if rec := app.Do(t, http.MethodPatch, adminPath(slug, "/members/"+member.ID+"/role"),
		map[string]any{"role": "admin"}, testrig.WithCookie(cookie)); rec.Code != http.StatusOK {
		t.Fatalf("admin role: %d %s", rec.Code, rec.Body.String())
	}

	// Changing your OWN role is refused before the body is even read, so the
	// answer is the same whatever role was asked for.
	self := app.Do(t, http.MethodPatch, adminPath(slug, "/members/"+owner.ID+"/role"),
		map[string]any{"role": "member"}, testrig.WithCookie(cookie))
	if self.Code != http.StatusForbidden {
		t.Fatalf("self: %d %s", self.Code, self.Body.String())
	}
	if got := app.JSON(t, self)["error"]; got != "Cannot change your own role. Ask another admin." {
		t.Errorf("error = %q", got)
	}

	badRole := app.Do(t, http.MethodPatch, adminPath(slug, "/members/"+member.ID+"/role"),
		map[string]any{"role": "superuser"}, testrig.WithCookie(cookie))
	if badRole.Code != http.StatusBadRequest {
		t.Fatalf("bad role: %d %s", badRole.Code, badRole.Body.String())
	}
	fields, _ := app.JSON(t, badRole)["fields"].(map[string]any)
	if got := fields["role"]; got != "role must be owner or member" {
		t.Errorf("fields[role] = %v", got)
	}

	strangerID, _ := signUp(t, app, "stranger@example.com", "Stranger")
	unknown := app.Do(t, http.MethodPatch, adminPath(slug, "/members/"+strangerID+"/role"),
		map[string]any{"role": "member"}, testrig.WithCookie(cookie))
	if unknown.Code != http.StatusNotFound || app.JSON(t, unknown)["error"] != "Member not found" {
		t.Errorf("unknown: %d %s", unknown.Code, unknown.Body.String())
	}
}

func TestGrantAndRevokeProviderAccess(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)
	app.CreateMember(t, slug, memberEmail, "Member", "member")
	member, err := app.Deps.Repo.FindUserByEmail(t.Context(), memberEmail)
	if err != nil || member == nil {
		t.Fatalf("member: %v", err)
	}
	createProvider(t, app, cookie, slug, "netflix", "Netflix")
	accessPath := adminPath(slug, "/members/"+member.ID+"/provider-access")

	// Granting twice is granting once: a double-click is not an error.
	for range 2 {
		rec := app.Do(t, http.MethodPost, accessPath,
			map[string]any{"providerKey": "netflix"}, testrig.WithCookie(cookie))
		if rec.Code != http.StatusOK {
			t.Fatalf("grant: %d %s", rec.Code, rec.Body.String())
		}
	}
	if got := app.Count(t, "household_member_provider_access", "TRUE"); got != 1 {
		t.Errorf("access rows = %d, want 1", got)
	}
	if got := app.Count(t, "audit_events", `"action" = 'member.provider_access_granted'`); got != 2 {
		t.Errorf("granted audits = %d, want 2", got)
	}

	unknownProvider := app.Do(t, http.MethodPost, accessPath,
		map[string]any{"providerKey": "spotify"}, testrig.WithCookie(cookie))
	if unknownProvider.Code != http.StatusNotFound || app.JSON(t, unknownProvider)["error"] != "Provider not found" {
		t.Errorf("unknown provider: %d %s", unknownProvider.Code, unknownProvider.Body.String())
	}

	strangerID, _ := signUp(t, app, "stranger@example.com", "Stranger")
	unknownMember := app.Do(t, http.MethodPost, adminPath(slug, "/members/"+strangerID+"/provider-access"),
		map[string]any{"providerKey": "netflix"}, testrig.WithCookie(cookie))
	if unknownMember.Code != http.StatusNotFound || app.JSON(t, unknownMember)["error"] != "Member not found" {
		t.Errorf("unknown member: %d %s", unknownMember.Code, unknownMember.Body.String())
	}

	// The key travels in the path on DELETE, and is lower-cased before the
	// lookup exactly as it is on the way in.
	revoked := app.Do(t, http.MethodDelete, accessPath+"/NetFlix", nil, testrig.WithCookie(cookie))
	if revoked.Code != http.StatusOK {
		t.Fatalf("revoke: %d %s", revoked.Code, revoked.Body.String())
	}
	if got := app.Count(t, "household_member_provider_access", "TRUE"); got != 0 {
		t.Errorf("access rows = %d, want 0", got)
	}
	if got := app.Count(t, "audit_events", `"action" = 'member.provider_access_revoked'`); got != 1 {
		t.Errorf("revoked audits = %d, want 1", got)
	}

	missing := app.Do(t, http.MethodDelete, accessPath+"/spotify", nil, testrig.WithCookie(cookie))
	if missing.Code != http.StatusNotFound || app.JSON(t, missing)["error"] != "Provider not found" {
		t.Errorf("revoke unknown: %d %s", missing.Code, missing.Body.String())
	}
}
