package api_test

import (
	"bytes"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"

	applog "github.com/andersro93/mi-casa-su-casa/server/internal/log"
	"github.com/andersro93/mi-casa-su-casa/server/internal/testrig"
)

// Ports test/integration/invitation-service.test.ts and the route-level half
// of invitations-repository.test.ts: issuing, listing, reissuing and
// cancelling invitations through the owner's routes.

// inviteURLPattern is REF §A3's link shape: the app URL, /invite/, and the
// plaintext token — which is a UUID and appears nowhere else.
var inviteURLPattern = regexp.MustCompile(`^http://127\.0\.0\.1/invite/[0-9a-f-]{36}$`)

// (inviteeEmail is declared in invitations_public_test.go.)

func TestCreateInvitationMintsALinkMailsItAndKeepsTheProviderScope(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)
	netflix := createProvider(t, app, cookie, slug, "netflix", "Netflix")

	rec := app.Do(t, http.MethodPost, adminPath(slug, "/invitations"), map[string]any{
		"email": inviteeEmail, "name": "Kid", "role": "member", "providerIds": []string{netflix},
	}, testrig.WithCookie(cookie))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	body := app.JSON(t, rec)

	if body["emailSent"] != true {
		t.Errorf("emailSent = %v", body["emailSent"])
	}
	if _, present := body["emailError"]; present {
		t.Errorf("emailError = %v, want it absent on a successful delivery", body["emailError"])
	}
	inviteURL, _ := body["inviteUrl"].(string)
	if !inviteURLPattern.MatchString(inviteURL) {
		t.Errorf("inviteUrl = %q", inviteURL)
	}

	invitation, _ := body["invitation"].(map[string]any)
	if invitation["email"] != inviteeEmail || invitation["role"] != "member" || invitation["status"] != "pending" {
		t.Errorf("invitation = %v", invitation)
	}
	providers, _ := invitation["providers"].([]any)
	if len(providers) != 1 {
		t.Fatalf("providers = %v", invitation["providers"])
	}
	if scoped, _ := providers[0].(map[string]any); scoped["provider_key"] != "netflix" {
		t.Errorf("scoped provider = %v", providers[0])
	}
	// The invitation record carries neither the token nor its hash: only the
	// link does, and the database holds the SHA-256 alone.
	for _, key := range []string{"token", "tokenHash", "token_hash"} {
		if value, present := invitation[key]; present {
			t.Errorf("invitation[%q] = %v, want it absent", key, value)
		}
	}

	sent := app.Mail.Sent()
	if len(sent) != 1 || sent[0].To != inviteeEmail || !strings.Contains(sent[0].Subject, "invited") {
		t.Fatalf("sent = %+v", sent)
	}
	if !strings.Contains(sent[0].Text, inviteURL) {
		t.Errorf("mail body carried no invite link: %q", sent[0].Text)
	}

	if got := app.Count(t, "audit_events", `"action" = 'invitation.created'`); got != 1 {
		t.Errorf("invitation.created audits = %d, want 1", got)
	}
}

// REF §A3: a failed delivery is not a failed invitation. The record stands and
// the owner gets the link plus the reason, so they can share it by hand.
func TestCreateInvitationReportsAFailedDeliveryWithoutLosingTheInvitation(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)
	app.Mail.Fail = errors.New("binding down")

	logs := &bytes.Buffer{}
	applog.SetOutput(logs)
	t.Cleanup(func() { applog.SetOutput(nil) })

	rec := app.Do(t, http.MethodPost, adminPath(slug, "/invitations"),
		map[string]any{"email": inviteeEmail, "name": "Kid", "role": "owner"},
		testrig.WithCookie(cookie))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	body := app.JSON(t, rec)
	if body["emailSent"] != false || body["emailError"] != "binding down" {
		t.Errorf("delivery = %v / %v", body["emailSent"], body["emailError"])
	}
	if inviteURL, _ := body["inviteUrl"].(string); !inviteURLPattern.MatchString(inviteURL) {
		t.Errorf("inviteUrl = %q, want a usable link even so", inviteURL)
	}
	if got := app.Count(t, "household_invitations", "TRUE"); got != 1 {
		t.Errorf("invitations = %d, want 1", got)
	}
	if !bytes.Contains(logs.Bytes(), []byte(`"event":"invitation_email_failed"`)) {
		t.Errorf("logs = %s, want an invitation_email_failed event", logs.String())
	}
	// The trail records that the mail did not get out, which is the first
	// question when somebody says the invitation never arrived.
	if got := app.Count(t, "audit_events",
		`"action" = 'invitation.created' AND "details" ->> 'emailSent' = 'false'`); got != 1 {
		t.Errorf("audit did not record the failed delivery (%d rows)", got)
	}
}

func TestCreateInvitationRefusesProvidersFromAnotherHousehold(t *testing.T) {
	app := testrig.App(t)
	ownerCookie, slug := app.CompleteSetup(t)
	_, otherCookie := signUp(t, app, "other@example.com", "Other")
	if rec := createHousehold(t, app, otherCookie, "otra"); rec.StatusCode != http.StatusCreated {
		t.Fatalf("second household: %d", rec.StatusCode)
	}
	theirs := createProvider(t, app, otherCookie, "otra", "netflix", "Netflix")

	rec := app.Do(t, http.MethodPost, adminPath(slug, "/invitations"), map[string]any{
		"email": inviteeEmail, "name": "Kid", "providerIds": []string{theirs},
	}, testrig.WithCookie(ownerCookie))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	want := "One or more selected providers do not belong to this household"
	if got := app.JSON(t, rec)["error"]; got != want {
		t.Errorf("error = %q", got)
	}
	if got := app.Count(t, "household_invitations", "TRUE"); got != 0 {
		t.Errorf("invitations = %d, want 0", got)
	}
}

func TestCreateInvitationValidatesTheBody(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)

	for _, tc := range []struct {
		name, email, memberName, field, message string
	}{
		{"empty email", "  ", "Kid", "email", "email is required"},
		{"malformed email", "not-an-address", "Kid", "email", "email must be a valid email address"},
		{"empty name", inviteeEmail, "   ", "name", "name is required"},
		{"long name", inviteeEmail, strings.Repeat("k", 81), "name", "name must be at most 80 characters"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := app.Do(t, http.MethodPost, adminPath(slug, "/invitations"),
				map[string]any{"email": tc.email, "name": tc.memberName},
				testrig.WithCookie(cookie))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
			}
			fields, _ := app.JSON(t, rec)["fields"].(map[string]any)
			if got := fields[tc.field]; got != tc.message {
				t.Errorf("fields[%q] = %v, want %q", tc.field, got, tc.message)
			}
		})
	}
}

// "Add a member" is an invitation with no provider scope — not an account this
// route creates. Nobody is handed a password somebody else chose.
func TestCreateMemberIsAnInvitationWithNoProviderScope(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)
	createProvider(t, app, cookie, slug, "netflix", "Netflix")

	rec := app.Do(t, http.MethodPost, adminPath(slug, "/members"),
		map[string]any{"email": inviteeEmail, "name": "Kid"}, testrig.WithCookie(cookie))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	body := app.JSON(t, rec)
	invitation, _ := body["invitation"].(map[string]any)
	// The role defaults to member when the property is absent (REF §A4).
	if invitation["role"] != "member" || invitation["status"] != "pending" {
		t.Errorf("invitation = %v", invitation)
	}
	if providers, _ := invitation["providers"].([]any); len(providers) != 0 {
		t.Errorf("providers = %v, want none", providers)
	}
	if body["emailSent"] != true {
		t.Errorf("emailSent = %v", body["emailSent"])
	}
	// No account and no membership yet: the invitee makes both when they
	// accept.
	if got := app.Count(t, "household_memberships", "TRUE"); got != 1 {
		t.Errorf("memberships = %d, want 1", got)
	}
	if got := app.Count(t, "audit_events", `"action" = 'invitation.created'`); got != 1 {
		t.Errorf("invitation.created audits = %d, want 1", got)
	}
}

// The list marks stale invitations expired before it is read, so it never
// shows a pending invitation whose link has already stopped working.
func TestListInvitationsExpiresStaleOnesFirst(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)

	if rec := app.Do(t, http.MethodPost, adminPath(slug, "/invitations"),
		map[string]any{"email": inviteeEmail, "name": "Kid"}, testrig.WithCookie(cookie)); rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}

	fresh := app.Do(t, http.MethodGet, adminPath(slug, "/invitations"), nil, testrig.WithCookie(cookie))
	if fresh.Code != http.StatusOK {
		t.Fatalf("list: %d %s", fresh.Code, fresh.Body.String())
	}
	invitations, _ := app.JSON(t, fresh)["invitations"].([]any)
	if len(invitations) != 1 {
		t.Fatalf("invitations = %v", app.JSON(t, fresh)["invitations"])
	}
	if entry, _ := invitations[0].(map[string]any); entry["status"] != "pending" {
		t.Errorf("status = %v, want pending", entry["status"])
	}

	app.Advance(testrig.InvitationTTL + time.Hour)

	stale := app.Do(t, http.MethodGet, adminPath(slug, "/invitations"), nil, testrig.WithCookie(cookie))
	if stale.Code != http.StatusOK {
		t.Fatalf("list: %d %s", stale.Code, stale.Body.String())
	}
	expired, _ := app.JSON(t, stale)["invitations"].([]any)
	if entry, _ := expired[0].(map[string]any); entry["status"] != "expired" {
		t.Errorf("status = %v, want expired", entry["status"])
	}
}

func TestResendInvitationCancelsTheOldOneAndKeepsItsScope(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)
	netflix := createProvider(t, app, cookie, slug, "netflix", "Netflix")

	created := app.Do(t, http.MethodPost, adminPath(slug, "/invitations"), map[string]any{
		"email": inviteeEmail, "name": "Kid", "role": "member", "providerIds": []string{netflix},
	}, testrig.WithCookie(cookie))
	if created.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", created.Code, created.Body.String())
	}
	first, _ := app.JSON(t, created)["invitation"].(map[string]any)
	firstID, _ := first["id"].(string)
	firstURL, _ := app.JSON(t, created)["inviteUrl"].(string)

	rec := app.Do(t, http.MethodPost, adminPath(slug, "/invitations/"+firstID+"/resend"), nil,
		testrig.WithCookie(cookie))
	if rec.Code != http.StatusOK {
		t.Fatalf("resend: %d %s", rec.Code, rec.Body.String())
	}
	body := app.JSON(t, rec)
	second, _ := body["invitation"].(map[string]any)
	secondID, _ := second["id"].(string)
	if secondID == firstID || secondID == "" {
		t.Errorf("resend returned the same invitation: %v", second)
	}
	// A NEW token, so a link that went to the wrong inbox stops working —
	// which is the whole point of the button.
	if secondURL, _ := body["inviteUrl"].(string); secondURL == firstURL {
		t.Error("resend reused the old token")
	}
	if providers, _ := second["providers"].([]any); len(providers) != 1 {
		t.Errorf("providers = %v, want the original scope", second["providers"])
	}
	if second["email"] != inviteeEmail || second["role"] != "member" || second["name"] != "Kid" {
		t.Errorf("invitation = %v", second)
	}

	if got := app.Count(t, "household_invitations", `"status" = 'pending'`); got != 1 {
		t.Errorf("pending invitations = %d, want 1", got)
	}
	if got := app.Count(t, "household_invitations", `"id" = $1 AND "status" = 'cancelled'`, firstID); got != 1 {
		t.Error("the replaced invitation was not cancelled")
	}
	if sent := app.Mail.Sent(); len(sent) != 2 {
		t.Errorf("sent = %d messages, want 2", len(sent))
	}
	if got := app.Count(t, "audit_events",
		`"action" = 'invitation.resent' AND "details" ->> 'replaces' = $1`, firstID); got != 1 {
		t.Error("the trail does not name the invitation this one replaces")
	}

	// Resending the cancelled one is refused with the same message an unknown
	// id gets, so the route cannot be used to learn which ids exist.
	notPending := app.Do(t, http.MethodPost, adminPath(slug, "/invitations/"+firstID+"/resend"), nil,
		testrig.WithCookie(cookie))
	if notPending.Code != http.StatusNotFound {
		t.Fatalf("resend cancelled: %d %s", notPending.Code, notPending.Body.String())
	}
	if got := app.JSON(t, notPending)["error"]; got != "Invitation not found or not resendable" {
		t.Errorf("error = %q", got)
	}
	unknown := app.Do(t, http.MethodPost, adminPath(slug, "/invitations/nope/resend"), nil,
		testrig.WithCookie(cookie))
	if unknown.Code != http.StatusNotFound || app.JSON(t, unknown)["error"] != "Invitation not found or not resendable" {
		t.Errorf("resend unknown: %d %s", unknown.Code, unknown.Body.String())
	}
}

func TestCancelInvitation(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)

	created := app.Do(t, http.MethodPost, adminPath(slug, "/invitations"),
		map[string]any{"email": inviteeEmail, "name": "Kid"}, testrig.WithCookie(cookie))
	if created.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", created.Code, created.Body.String())
	}
	invitation, _ := app.JSON(t, created)["invitation"].(map[string]any)
	id, _ := invitation["id"].(string)

	rec := app.Do(t, http.MethodDelete, adminPath(slug, "/invitations/"+id), nil, testrig.WithCookie(cookie))
	if rec.Code != http.StatusOK {
		t.Fatalf("cancel: %d %s", rec.Code, rec.Body.String())
	}
	if got := app.JSON(t, rec)["ok"]; got != true {
		t.Errorf("body = %s", rec.Body.String())
	}
	if got := app.Count(t, "household_invitations", `"status" = 'cancelled'`); got != 1 {
		t.Errorf("cancelled invitations = %d, want 1", got)
	}
	if got := app.Count(t, "audit_events", `"action" = 'invitation.cancelled'`); got != 1 {
		t.Errorf("invitation.cancelled audits = %d, want 1", got)
	}

	unknown := app.Do(t, http.MethodDelete, adminPath(slug, "/invitations/nope"), nil, testrig.WithCookie(cookie))
	if unknown.Code != http.StatusNotFound || app.JSON(t, unknown)["error"] != "Invitation not found" {
		t.Errorf("cancel unknown: %d %s", unknown.Code, unknown.Body.String())
	}
}

// An invitation belongs to the household that issued it: another household's
// owner cannot see it, cancel it or resend it by id.
func TestInvitationRoutesAreScopedToTheHousehold(t *testing.T) {
	app := testrig.App(t)
	ownerCookie, slug := app.CompleteSetup(t)
	_, otherCookie := signUp(t, app, "other@example.com", "Other")
	if rec := createHousehold(t, app, otherCookie, "otra"); rec.StatusCode != http.StatusCreated {
		t.Fatalf("second household: %d", rec.StatusCode)
	}

	created := app.Do(t, http.MethodPost, adminPath(slug, "/invitations"),
		map[string]any{"email": inviteeEmail, "name": "Kid"}, testrig.WithCookie(ownerCookie))
	if created.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", created.Code, created.Body.String())
	}
	invitation, _ := app.JSON(t, created)["invitation"].(map[string]any)
	id, _ := invitation["id"].(string)

	// The other owner asks under THEIR OWN slug, where they are allowed to be,
	// with an id that is not theirs: a 404, and nothing changes.
	for _, tc := range []struct{ method, path string }{
		{http.MethodDelete, adminPath("otra", "/invitations/"+id)},
		{http.MethodPost, adminPath("otra", "/invitations/"+id+"/resend")},
	} {
		rec := app.Do(t, tc.method, tc.path, nil, testrig.WithCookie(otherCookie))
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s %s: %d %s", tc.method, tc.path, rec.Code, rec.Body.String())
		}
	}
	if got := app.Count(t, "household_invitations", `"status" = 'pending'`); got != 1 {
		t.Errorf("pending invitations = %d, want the original still pending", got)
	}
}
