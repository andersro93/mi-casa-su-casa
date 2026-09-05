package api_test

import (
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"

	"github.com/andersro93/mi-casa-su-casa/server/internal/testrig"
)

// Ports test/integration/audit-log.test.ts, the owner-only half of
// tenant-isolation.test.ts, and the envelope cases of error-handling.test.ts:
// the household settings and audit routes, plus the guard every admin route
// shares.

func TestGetHouseholdSettingsIncludesTheInboundAddress(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)

	rec := app.Do(t, http.MethodGet, adminPath(slug, "/settings"), nil, testrig.WithCookie(cookie))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	household, _ := app.JSON(t, rec)["household"].(map[string]any)
	if household["slug"] != slug || household["displayName"] != testrig.OwnerHouseholdName {
		t.Errorf("household = %v", household)
	}
	// The address providers must be told to send codes to: the slug at the
	// installation's inbound domain.
	if got := household["emailAddress"]; got != slug+"@"+testrig.EmailDomain {
		t.Errorf("emailAddress = %v", got)
	}
}

func TestUpdateHouseholdSettingsRenamesAndRecordsIt(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)

	rec := app.Do(t, http.MethodPatch, adminPath(slug, "/settings"),
		map[string]any{"displayName": "  Casa Nueva  "}, testrig.WithCookie(cookie))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	household, _ := app.JSON(t, rec)["household"].(map[string]any)
	if household["displayName"] != "Casa Nueva" {
		t.Errorf("displayName = %v", household["displayName"])
	}
	// The slug is not settable: it is the local part of the inbound address,
	// so changing it would break every rule a provider was pointed at.
	if household["slug"] != slug || household["emailAddress"] != slug+"@"+testrig.EmailDomain {
		t.Errorf("household = %v", household)
	}
	if got := app.Count(t, "audit_events",
		`"action" = 'household.settings_updated' AND "details" ->> 'displayName' = 'Casa Nueva'`); got != 1 {
		t.Errorf("settings_updated audits = %d, want 1", got)
	}

	for _, tc := range []struct{ name, displayName, message string }{
		{"empty", "   ", "displayName is required"},
		{"too long", strings.Repeat("c", 81), "displayName must be at most 80 characters"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			refused := app.Do(t, http.MethodPatch, adminPath(slug, "/settings"),
				map[string]any{"displayName": tc.displayName}, testrig.WithCookie(cookie))
			if refused.Code != http.StatusBadRequest {
				t.Fatalf("status = %d %s", refused.Code, refused.Body.String())
			}
			fields, _ := app.JSON(t, refused)["fields"].(map[string]any)
			if got := fields["displayName"]; got != tc.message {
				t.Errorf("fields[displayName] = %v, want %q", got, tc.message)
			}
		})
	}
}

// The first case of audit-log.test.ts: every owner action lands in the trail
// with the actor and the household, and only owners may read it.
func TestAuditLogRecordsOwnerActionsWithActorAndHousehold(t *testing.T) {
	app := testrig.App(t)
	ownerCookie, slug := app.CompleteSetup(t)
	memberCookie := app.CreateMember(t, slug, memberEmail, "Member", "member")

	owner, err := app.Deps.Repo.FindUserByEmail(t.Context(), testrig.OwnerEmail)
	if err != nil || owner == nil {
		t.Fatalf("owner: %v", err)
	}
	member, err := app.Deps.Repo.FindUserByEmail(t.Context(), memberEmail)
	if err != nil || member == nil {
		t.Fatalf("member: %v", err)
	}
	household, err := app.Deps.Repo.GetHouseholdBySlug(t.Context(), slug)
	if err != nil || household == nil {
		t.Fatalf("household: %v", err)
	}

	netflix := createProvider(t, app, ownerCookie, slug, "netflix", "Netflix")
	if rec := createRule(t, app, ownerCookie, slug, netflix, "domain", "netflix.com"); rec.StatusCode != http.StatusCreated {
		t.Fatalf("rule: %d", rec.StatusCode)
	}
	if rec := app.Do(t, http.MethodPost, adminPath(slug, "/members/"+member.ID+"/provider-access"),
		map[string]any{"providerKey": "netflix"}, testrig.WithCookie(ownerCookie)); rec.Code != http.StatusOK {
		t.Fatalf("grant: %d %s", rec.Code, rec.Body.String())
	}
	if rec := app.Do(t, http.MethodPatch, adminPath(slug, "/members/"+member.ID+"/role"),
		map[string]any{"role": "owner"}, testrig.WithCookie(ownerCookie)); rec.Code != http.StatusOK {
		t.Fatalf("role: %d %s", rec.Code, rec.Body.String())
	}
	if rec := app.Do(t, http.MethodPatch, adminPath(slug, "/settings"),
		map[string]any{"displayName": "Casa 2"}, testrig.WithCookie(ownerCookie)); rec.Code != http.StatusOK {
		t.Fatalf("settings: %d %s", rec.Code, rec.Body.String())
	}

	rec := app.Do(t, http.MethodGet, adminPath(slug, "/audit"), nil, testrig.WithCookie(ownerCookie))
	if rec.Code != http.StatusOK {
		t.Fatalf("audit: %d %s", rec.Code, rec.Body.String())
	}
	events, _ := app.JSON(t, rec)["events"].([]any)

	var actions []string
	var providerCreated map[string]any
	for _, entry := range events {
		event, _ := entry.(map[string]any)
		actions = append(actions, event["action"].(string))
		if event["actorUserId"] != owner.ID {
			t.Errorf("actorUserId = %v, want the owner", event["actorUserId"])
		}
		if event["householdId"] != household.ID {
			t.Errorf("householdId = %v", event["householdId"])
		}
		if event["action"] == "provider.created" {
			providerCreated = event
		}
	}
	sort.Strings(actions)

	// The setup route's own installation event is filed against the household
	// too, so it is part of this trail.
	want := []string{
		"household.settings_updated",
		"installation.setup_completed",
		"member.provider_access_granted",
		"member.role_changed",
		"provider.created",
		"sender_rule.created",
	}
	if strings.Join(actions, ",") != strings.Join(want, ",") {
		t.Errorf("actions = %v, want %v", actions, want)
	}

	if providerCreated == nil {
		t.Fatal("no provider.created event")
	}
	if providerCreated["targetId"] != netflix || providerCreated["targetType"] != "provider" {
		t.Errorf("provider.created target = %v/%v", providerCreated["targetType"], providerCreated["targetId"])
	}
	details, _ := providerCreated["details"].(map[string]any)
	if details["providerKey"] != "netflix" {
		t.Errorf("details = %v", details)
	}

	// The member was promoted above, so demote them and check the denial —
	// the trail names who did what to whom, which is not a member's business.
	if err := app.Deps.Repo.SetMemberRole(t.Context(), household.ID, member.ID, "member"); err != nil {
		t.Fatalf("demote: %v", err)
	}
	denied := app.Do(t, http.MethodGet, adminPath(slug, "/audit"), nil, testrig.WithCookie(memberCookie))
	if denied.Code != http.StatusForbidden {
		t.Fatalf("member reading the audit log: %d %s", denied.Code, denied.Body.String())
	}
}

// An action with no details of its own stores none, and the response says
// null rather than omitting the key.
func TestAuditEventsWithoutDetailsAnswerNull(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)
	netflix := createProvider(t, app, cookie, slug, "netflix", "Netflix")
	if rec := app.Do(t, http.MethodDelete, adminPath(slug, "/providers/"+netflix), nil,
		testrig.WithCookie(cookie)); rec.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
	}

	rec := app.Do(t, http.MethodGet, adminPath(slug, "/audit"), nil, testrig.WithCookie(cookie))
	events, _ := app.JSON(t, rec)["events"].([]any)
	for _, entry := range events {
		event, _ := entry.(map[string]any)
		if event["action"] != "provider.deleted" {
			continue
		}
		value, present := event["details"]
		if !present || value != nil {
			t.Errorf("details = %v (present: %v), want null", value, present)
		}
		return
	}
	t.Fatalf("no provider.deleted event in %s", rec.Body.String())
}

// adminRequests is one representative request per admin route, used by the two
// guard tests below. Every one of them must be refused for the same reason,
// so listing them here keeps a future route from quietly missing the check.
func adminRequests(slug string) []struct {
	method, path string
	body         any
} {
	return []struct {
		method, path string
		body         any
	}{
		{http.MethodGet, adminPath(slug, "/audit"), nil},
		{http.MethodGet, adminPath(slug, "/settings"), nil},
		{http.MethodPatch, adminPath(slug, "/settings"), map[string]any{"displayName": "Taken"}},
		{http.MethodGet, adminPath(slug, "/providers"), nil},
		{http.MethodPost, adminPath(slug, "/providers"), map[string]any{"providerKey": "x", "displayName": "X"}},
		{http.MethodPatch, adminPath(slug, "/providers/pid"), map[string]any{"providerKey": "x", "displayName": "X"}},
		{http.MethodDelete, adminPath(slug, "/providers/pid"), nil},
		{http.MethodPost, adminPath(slug, "/provider-rules"),
			map[string]any{"providerId": "pid", "matchType": "domain", "matchValue": "x.example.com"}},
		{http.MethodPatch, adminPath(slug, "/provider-rules/rid"),
			map[string]any{"providerId": "pid", "matchType": "domain", "matchValue": "x.example.com"}},
		{http.MethodDelete, adminPath(slug, "/provider-rules/rid"), nil},
		{http.MethodGet, adminPath(slug, "/members"), nil},
		{http.MethodPost, adminPath(slug, "/members"), map[string]any{"email": "x@example.com", "name": "X"}},
		{http.MethodDelete, adminPath(slug, "/members/uid"), nil},
		{http.MethodPatch, adminPath(slug, "/members/uid/role"), map[string]any{"role": "owner"}},
		{http.MethodPost, adminPath(slug, "/members/uid/provider-access"), map[string]any{"providerKey": "x"}},
		{http.MethodDelete, adminPath(slug, "/members/uid/provider-access/x"), nil},
		{http.MethodGet, adminPath(slug, "/invitations"), nil},
		{http.MethodPost, adminPath(slug, "/invitations"), map[string]any{"email": "x@example.com", "name": "X"}},
		{http.MethodPost, adminPath(slug, "/invitations/iid/resend"), nil},
		{http.MethodDelete, adminPath(slug, "/invitations/iid"), nil},
	}
}

// A member of the household may not reach any admin route: the tier refuses
// before the handler runs, so nothing leaks about what exists.
func TestEveryAdminRouteIsOwnerOnly(t *testing.T) {
	app := testrig.App(t)
	_, slug := app.CompleteSetup(t)
	memberCookie := app.CreateMember(t, slug, memberEmail, "Member", "member")

	for _, tc := range adminRequests(slug) {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			rec := app.Do(t, tc.method, tc.path, tc.body, testrig.WithCookie(memberCookie))
			if rec.Code != http.StatusForbidden {
				t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
			}
			if got := app.JSON(t, rec)["error"]; got != "Forbidden" {
				t.Errorf("error = %q", got)
			}
		})
	}
}

// The owner-only half of tenant-isolation.test.ts, widened to every admin
// route: another household's owner is a stranger here, and gets the same 403 a
// stranger gets — never a 404 that would confirm the household exists.
func TestAdminRoutesRefuseAnotherHouseholdsOwner(t *testing.T) {
	app := testrig.App(t)
	_, slug := app.CompleteSetup(t)
	_, otherCookie := signUp(t, app, "other@example.com", "Other")
	if rec := createHousehold(t, app, otherCookie, "otra"); rec.StatusCode != http.StatusCreated {
		t.Fatalf("second household: %d", rec.StatusCode)
	}

	for _, tc := range adminRequests(slug) {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			rec := app.Do(t, tc.method, tc.path, tc.body, testrig.WithCookie(otherCookie))
			if rec.Code != http.StatusForbidden {
				t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
			}
		})
	}
	// Nothing of the other household was touched.
	if got := app.Count(t, "households", `"slug" = $1 AND "display_name" = $2`,
		slug, testrig.OwnerHouseholdName); got != 1 {
		t.Error("the other household was modified")
	}
}

func TestAdminRoutesRequireASession(t *testing.T) {
	app := testrig.App(t)
	_, slug := app.CompleteSetup(t)

	rec := app.Do(t, http.MethodGet, adminPath(slug, "/settings"), nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if got := app.JSON(t, rec)["error"]; got != "Unauthorized" {
		t.Errorf("error = %q", got)
	}
}

// The envelope half of error-handling.test.ts: a body that is not JSON is a
// 400 saying so, not a 500 and not a text/plain error from the decoder.
func TestAdminRoutesRejectAnInvalidJSONBody(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)

	req := httptest.NewRequest(http.MethodPatch, adminPath(slug, "/settings"),
		strings.NewReader("{not json"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", testrig.AppURL)
	req.Header.Set("Cookie", cookie)

	rec := app.DoRequest(req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); !strings.Contains(got, "application/json") {
		t.Errorf("content-type = %q", got)
	}
	if got := app.JSON(t, rec)["error"]; got != "Invalid JSON body" {
		t.Errorf("error = %q", got)
	}
}
