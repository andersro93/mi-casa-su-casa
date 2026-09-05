package api_test

import (
	"net/http"
	neturl "net/url"
	"strconv"
	"testing"
	"time"

	"github.com/andersro93/mi-casa-su-casa/server/internal/mail"
	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
	"github.com/andersro93/mi-casa-su-casa/server/internal/testrig"
)

// Ports the inbox half of test/inbox-routes.test.ts, the route half of
// test/integration/pagination.test.ts, the release path of
// test/integration/messages-repository.test.ts and the visibility assertions
// of test/integration/provider-summaries.test.ts — against a real database
// and the whole handler chain.
//
// Messages are seeded through repo.InsertMessage/InsertQuarantine rather than
// over HTTP because the inbound endpoint belongs to a later phase: there is no
// route that creates a message yet.

// inboxPath builds an /api/inbox/{slug}/… URL.
func inboxPath(slug, suffix string) string { return "/api/inbox/" + slug + suffix }

// seedAt is the instant the seeded fixtures are dated from. Fixed rather than
// "now" so a cursor in an assertion is readable and the ordering is not at the
// mercy of how fast the test runs.
var seedAt = time.Date(2026, time.May, 10, 12, 0, 0, 0, time.UTC)

// householdID resolves a slug the way every seeding helper below needs it.
func householdID(t *testing.T, app *testrig.AppRig, slug string) string {
	t.Helper()
	household, err := app.Deps.Repo.GetHouseholdBySlug(t.Context(), slug)
	if err != nil || household == nil {
		t.Fatalf("household %q: %v", slug, err)
	}
	return household.ID
}

// parsedEmail is the minimum a stored message needs: the fields the inbox rows
// actually show, plus the envelope the quarantine rows show as well.
func parsedEmail(messageID, subject, from string) mail.Parsed {
	fromHeader := "Netflix <" + from + ">"
	return mail.Parsed{
		EnvelopeFrom: from,
		EnvelopeTo:   "casa@" + testrig.EmailDomain,
		FromHeader:   &fromHeader,
		Subject:      &subject,
		MessageID:    "<" + messageID + "@test>",
		TextBody:     "Body of " + messageID,
		RawSize:      len(messageID),
	}
}

// seedMessage stores one classified message and returns its id.
func seedMessage(t *testing.T, app *testrig.AppRig, hid, providerID, messageID, subject string, code *string, receivedAt time.Time) string {
	t.Helper()
	id, err := app.Deps.Repo.InsertMessage(t.Context(),
		parsedEmail(messageID, subject, "no-reply@netflix.com"),
		hid, providerID, code, "rule_match", receivedAt)
	if err != nil {
		t.Fatalf("seedMessage(%q): %v", messageID, err)
	}
	return id
}

// seedQuarantine stores one unattributed message and returns its id.
func seedQuarantine(t *testing.T, app *testrig.AppRig, hid, messageID, subject, reason string, receivedAt time.Time) string {
	t.Helper()
	id, err := app.Deps.Repo.InsertQuarantine(t.Context(),
		parsedEmail(messageID, subject, "unknown@example.com"),
		hid, nil, reason, receivedAt)
	if err != nil {
		t.Fatalf("seedQuarantine(%q): %v", messageID, err)
	}
	return id
}

// grantAccess gives a member one provider, through the owner's admin route.
func grantAccess(t *testing.T, app *testrig.AppRig, ownerCookie, slug, email, providerKey string) {
	t.Helper()
	member, err := app.Deps.Repo.FindUserByEmail(t.Context(), email)
	if err != nil || member == nil {
		t.Fatalf("member %q: %v", email, err)
	}
	rec := app.Do(t, http.MethodPost, adminPath(slug, "/members/"+member.ID+"/provider-access"),
		map[string]any{"providerKey": providerKey}, testrig.WithCookie(ownerCookie))
	if rec.Code != http.StatusOK {
		t.Fatalf("grant %q: %d %s", providerKey, rec.Code, rec.Body.String())
	}
}

// Ports provider-summaries.test.ts: the newest message's id, subject, code and
// status appear on the tile, and a provider that has received nothing has null
// latest fields rather than missing keys.
func TestListInboxProvidersSummarisesTheNewestMessage(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)
	hid := householdID(t, app, slug)
	netflix := createProvider(t, app, cookie, slug, "netflix", "Netflix")
	createProvider(t, app, cookie, slug, "spotify", "Spotify")

	// Dated from AFTER both providers were created, so the tile with mail
	// really is the more recently active one: the ordering key is
	// COALESCE(max(received_at), created_at), and an empty provider is sorted
	// by the moment it was made.
	activity := time.Now().UTC()
	old := seedMessage(t, app, hid, netflix, "old", "Old code", ptrTo("111111"), activity.Add(-24*time.Hour))
	seedMessage(t, app, hid, netflix, "middle", "New sign-in", nil, activity.Add(-12*time.Hour))
	newest := seedMessage(t, app, hid, netflix, "newest", "Your Netflix verification code",
		ptrTo("482913"), activity)
	if _, err := app.Deps.Repo.UpdateMessageStatus(t.Context(), hid, old, repo.StatusUsed); err != nil {
		t.Fatalf("mark used: %v", err)
	}

	rec := app.Do(t, http.MethodGet, inboxPath(slug, "/providers"), nil, testrig.WithCookie(cookie))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	providers, _ := app.JSON(t, rec)["providers"].([]any)
	if len(providers) != 2 {
		t.Fatalf("providers = %v, want both", providers)
	}

	// Ordered by latest activity first, so the provider with mail leads.
	n, _ := providers[0].(map[string]any)
	s, _ := providers[1].(map[string]any)

	if n["provider_key"] != "netflix" || n["display_name"] != "Netflix" || n["household_slug"] != slug {
		t.Fatalf("netflix tile = %v", n)
	}
	if n["message_count"] != float64(3) || n["new_count"] != float64(2) {
		t.Errorf("counts = %v/%v, want 3/2", n["message_count"], n["new_count"])
	}
	if n["latest_message_id"] != newest {
		t.Errorf("latest_message_id = %v, want %q", n["latest_message_id"], newest)
	}
	if n["latest_subject"] != "Your Netflix verification code" ||
		n["latest_code"] != "482913" || n["latest_status"] != "new" {
		t.Errorf("latest preview = %v", n)
	}
	if n["latest_received_at"] == nil {
		t.Error("latest_received_at is null for a provider with messages")
	}

	// Present and null, never missing: the SPA renders the empty tile from
	// these keys.
	if s["provider_key"] != "spotify" || s["message_count"] != float64(0) {
		t.Fatalf("spotify tile = %v", s)
	}
	for _, key := range []string{"latest_received_at", "latest_message_id", "latest_subject", "latest_code", "latest_status"} {
		value, present := s[key]
		if !present || value != nil {
			t.Errorf("spotify %s = %v (present %v), want a null", key, value, present)
		}
	}
}

// The first case of inbox-routes.test.ts: a member sees the providers they
// were granted and nothing else, while the owner sees the household's lot.
func TestListInboxProvidersOwnerSeesAllMemberSeesGranted(t *testing.T) {
	app := testrig.App(t)
	ownerCookie, slug := app.CompleteSetup(t)
	memberCookie := app.CreateMember(t, slug, memberEmail, "Member", "member")
	hid := householdID(t, app, slug)
	netflix := createProvider(t, app, ownerCookie, slug, "netflix", "Netflix")
	createProvider(t, app, ownerCookie, slug, "spotify", "Spotify")
	seedMessage(t, app, hid, netflix, "msg-1", "Your code", ptrTo("123456"), seedAt)
	grantAccess(t, app, ownerCookie, slug, memberEmail, "netflix")

	ownerRec := app.Do(t, http.MethodGet, inboxPath(slug, "/providers"), nil, testrig.WithCookie(ownerCookie))
	if ownerRec.Code != http.StatusOK {
		t.Fatalf("owner: %d %s", ownerRec.Code, ownerRec.Body.String())
	}
	if got, _ := app.JSON(t, ownerRec)["providers"].([]any); len(got) != 2 {
		t.Errorf("owner sees %d providers, want 2", len(got))
	}

	memberRec := app.Do(t, http.MethodGet, inboxPath(slug, "/providers"), nil, testrig.WithCookie(memberCookie))
	if memberRec.Code != http.StatusOK {
		t.Fatalf("member: %d %s", memberRec.Code, memberRec.Body.String())
	}
	providers, _ := app.JSON(t, memberRec)["providers"].([]any)
	if len(providers) != 1 {
		t.Fatalf("member sees %v, want only netflix", providers)
	}
	entry, _ := providers[0].(map[string]any)
	if entry["provider_key"] != "netflix" || entry["message_count"] != float64(1) {
		t.Errorf("member tile = %v", entry)
	}
}

// "denies inbox access across household boundaries": the tenancy guard answers
// before any handler runs, and it says nothing about whether the household or
// the provider exists.
func TestInboxRoutesRefuseAnotherHouseholdsSlug(t *testing.T) {
	app := testrig.App(t)
	ownerCookie, slug := app.CompleteSetup(t)
	createProvider(t, app, ownerCookie, slug, "netflix", "Netflix")

	_, otherCookie := signUp(t, app, "other@example.com", "Other")
	if rec := createHousehold(t, app, otherCookie, "otra"); rec.StatusCode != http.StatusCreated {
		t.Fatalf("second household: %d", rec.StatusCode)
	}

	for _, path := range []string{"/providers", "/providers/netflix", "/quarantine"} {
		t.Run(path, func(t *testing.T) {
			rec := app.Do(t, http.MethodGet, inboxPath(slug, path), nil, testrig.WithCookie(otherCookie))
			if rec.Code != http.StatusForbidden {
				t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
			}
			if got := app.JSON(t, rec)["error"]; got != "Forbidden" {
				t.Errorf("error = %q", got)
			}
		})
	}
}

// A member without access to a provider is refused before the provider is
// looked up, so 403 and 404 cannot be used to enumerate the household's
// mailboxes.
func TestListProviderMessagesAccessAndUnknownProvider(t *testing.T) {
	app := testrig.App(t)
	ownerCookie, slug := app.CompleteSetup(t)
	memberCookie := app.CreateMember(t, slug, memberEmail, "Member", "member")
	hid := householdID(t, app, slug)
	netflix := createProvider(t, app, ownerCookie, slug, "netflix", "Netflix")
	createProvider(t, app, ownerCookie, slug, "spotify", "Spotify")
	seedMessage(t, app, hid, netflix, "msg-1", "Your code", ptrTo("123456"), seedAt)
	grantAccess(t, app, ownerCookie, slug, memberEmail, "netflix")

	rec := app.Do(t, http.MethodGet, inboxPath(slug, "/providers/netflix"), nil, testrig.WithCookie(memberCookie))
	if rec.Code != http.StatusOK {
		t.Fatalf("granted provider: %d %s", rec.Code, rec.Body.String())
	}
	body := app.JSON(t, rec)
	provider, _ := body["provider"].(map[string]any)
	if provider["providerKey"] != "netflix" || provider["displayName"] != "Netflix" {
		t.Errorf("provider = %v", provider)
	}
	messages, _ := body["messages"].([]any)
	if len(messages) != 1 {
		t.Fatalf("messages = %v", body["messages"])
	}
	row, _ := messages[0].(map[string]any)
	if row["provider_display_name"] != "Netflix" || row["extracted_code"] != "123456" ||
		row["status"] != "new" || row["household_slug"] != slug {
		t.Errorf("message row = %v", row)
	}
	page, _ := body["page"].(map[string]any)
	if page["limit"] != float64(50) || page["nextBefore"] != nil {
		t.Errorf("page = %v, want limit 50 and a null cursor", page)
	}

	denied := app.Do(t, http.MethodGet, inboxPath(slug, "/providers/spotify"), nil, testrig.WithCookie(memberCookie))
	if denied.Code != http.StatusForbidden {
		t.Fatalf("ungranted provider: %d %s", denied.Code, denied.Body.String())
	}
	if got := app.JSON(t, denied)["error"]; got != "Forbidden" {
		t.Errorf("error = %q", got)
	}

	// An owner may see every provider, so for them an unknown key is a 404.
	missing := app.Do(t, http.MethodGet, inboxPath(slug, "/providers/nope"), nil, testrig.WithCookie(ownerCookie))
	if missing.Code != http.StatusNotFound {
		t.Fatalf("unknown provider: %d %s", missing.Code, missing.Body.String())
	}
	if got := app.JSON(t, missing)["error"]; got != "Provider not found" {
		t.Errorf("error = %q", got)
	}

	// A member without access to a provider that does not exist either is
	// still told 403, never 404.
	hidden := app.Do(t, http.MethodGet, inboxPath(slug, "/providers/nope"), nil, testrig.WithCookie(memberCookie))
	if hidden.Code != http.StatusForbidden {
		t.Errorf("unknown provider for a member: %d %s", hidden.Code, hidden.Body.String())
	}
}

// Ports pagination.test.ts's HTTP half: 60 messages come back as two keyset
// pages, and the cursor round-trips through the query string.
func TestProviderMessagesAndQuarantinePaginate(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)
	hid := householdID(t, app, slug)
	netflix := createProvider(t, app, cookie, slug, "netflix", "Netflix")

	for i := range 60 {
		at := seedAt.Add(time.Duration(i) * time.Minute)
		seedMessage(t, app, hid, netflix, "m-"+strconv.Itoa(i), "Code "+strconv.Itoa(i), nil, at)
		seedQuarantine(t, app, hid, "q-"+strconv.Itoa(i), "Review "+strconv.Itoa(i), "unknown_sender", at)
	}

	first := app.Do(t, http.MethodGet, inboxPath(slug, "/providers/netflix"), nil, testrig.WithCookie(cookie))
	if first.Code != http.StatusOK {
		t.Fatalf("page 1: %d %s", first.Code, first.Body.String())
	}
	body1 := app.JSON(t, first)
	messages1, _ := body1["messages"].([]any)
	if len(messages1) != 50 {
		t.Fatalf("page 1 = %d messages, want the default 50", len(messages1))
	}
	page1, _ := body1["page"].(map[string]any)
	if page1["limit"] != float64(50) {
		t.Errorf("page 1 limit = %v", page1["limit"])
	}
	cursor, _ := page1["nextBefore"].(string)
	if cursor == "" {
		t.Fatalf("page 1 nextBefore = %v, want the cursor for an older page", page1["nextBefore"])
	}
	// The cursor is the last row's received_at, which is what makes it a
	// keyset rather than an offset.
	last, _ := messages1[49].(map[string]any)
	if last["received_at"] != cursor {
		t.Errorf("nextBefore = %q, want the last row's received_at %v", cursor, last["received_at"])
	}
	newest, _ := messages1[0].(map[string]any)
	if newest["subject"] != "Code 59" {
		t.Errorf("page 1 leads with %v, want the newest message", newest["subject"])
	}

	second := app.Do(t, http.MethodGet,
		inboxPath(slug, "/providers/netflix")+"?limit=50&before="+neturl.QueryEscape(cursor), nil, testrig.WithCookie(cookie))
	if second.Code != http.StatusOK {
		t.Fatalf("page 2: %d %s", second.Code, second.Body.String())
	}
	body2 := app.JSON(t, second)
	messages2, _ := body2["messages"].([]any)
	if len(messages2) != 10 {
		t.Fatalf("page 2 = %d messages, want the remaining 10", len(messages2))
	}
	page2, _ := body2["page"].(map[string]any)
	if page2["nextBefore"] != nil {
		t.Errorf("page 2 nextBefore = %v, want null on the last page", page2["nextBefore"])
	}
	oldest, _ := messages2[9].(map[string]any)
	if oldest["subject"] != "Code 0" {
		t.Errorf("page 2 ends with %v, want the oldest message", oldest["subject"])
	}

	// The quarantine list pages the same way, and 200 is the whole seeded set.
	quarantine := app.Do(t, http.MethodGet, inboxPath(slug, "/quarantine")+"?limit=200", nil, testrig.WithCookie(cookie))
	if quarantine.Code != http.StatusOK {
		t.Fatalf("quarantine: %d %s", quarantine.Code, quarantine.Body.String())
	}
	qBody := app.JSON(t, quarantine)
	rows, _ := qBody["messages"].([]any)
	if len(rows) != 60 {
		t.Fatalf("quarantine = %d rows, want 60", len(rows))
	}
	qPage, _ := qBody["page"].(map[string]any)
	if qPage["limit"] != float64(200) || qPage["nextBefore"] != nil {
		t.Errorf("quarantine page = %v", qPage)
	}
	row, _ := rows[0].(map[string]any)
	if row["provider_key"] != "quarantine" || row["provider_display_name"] != "Quarantine" ||
		row["status"] != "new" || row["quarantine_reason"] != "unknown_sender" ||
		row["envelope_from"] != "unknown@example.com" {
		t.Errorf("quarantine row = %v", row)
	}
}

// An out-of-range limit is clamped rather than rejected, and an unusable
// cursor is ignored rather than rejected — both carried over from the
// TypeScript's normalizePageOptions, so a client can never paint itself into a
// page it cannot navigate away from.
func TestProviderMessagesClampTheLimitAndIgnoreABadCursor(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)
	hid := householdID(t, app, slug)
	netflix := createProvider(t, app, cookie, slug, "netflix", "Netflix")
	for i := range 3 {
		seedMessage(t, app, hid, netflix, "m-"+strconv.Itoa(i), "Code "+strconv.Itoa(i), nil,
			seedAt.Add(time.Duration(i)*time.Minute))
	}

	cases := []struct {
		query string
		limit float64
		rows  int
	}{
		{"?limit=9999", 200, 3},
		{"?limit=0", 1, 1},
		{"?limit=2", 2, 2},
		{"?before=garbage", 50, 3},
	}
	for _, tc := range cases {
		t.Run(tc.query, func(t *testing.T) {
			rec := app.Do(t, http.MethodGet, inboxPath(slug, "/providers/netflix")+tc.query, nil, testrig.WithCookie(cookie))
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
			}
			body := app.JSON(t, rec)
			page, _ := body["page"].(map[string]any)
			if page["limit"] != tc.limit {
				t.Errorf("limit = %v, want %v", page["limit"], tc.limit)
			}
			if rows, _ := body["messages"].([]any); len(rows) != tc.rows {
				t.Errorf("messages = %d, want %d", len(rows), tc.rows)
			}
		})
	}
}

// The one place the page parameters diverge from the TypeScript, pinned so it
// is a decision and not a surprise: `limit` is declared as an integer in the
// spec, so a value that is not one is a validation failure rather than the
// silent fall-back to 50 that `Number(...)` produced. Every value a working
// client sends is still clamped, never refused.
func TestProviderMessagesRejectALimitThatIsNotANumber(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)
	createProvider(t, app, cookie, slug, "netflix", "Netflix")

	rec := app.Do(t, http.MethodGet, inboxPath(slug, "/providers/netflix")+"?limit=abc", nil, testrig.WithCookie(cookie))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d %s, want 400", rec.Code, rec.Body.String())
	}
	fields, _ := app.JSON(t, rec)["fields"].(map[string]any)
	if _, named := fields["limit"]; !named {
		t.Errorf("fields = %v, want the failure named against limit", fields)
	}
}

// "allows a permitted member to update message status in their household",
// plus the two refusals around it.
func TestUpdateMessageStatus(t *testing.T) {
	app := testrig.App(t)
	ownerCookie, slug := app.CompleteSetup(t)
	memberCookie := app.CreateMember(t, slug, memberEmail, "Member", "member")
	hid := householdID(t, app, slug)
	netflix := createProvider(t, app, ownerCookie, slug, "netflix", "Netflix")
	spotify := createProvider(t, app, ownerCookie, slug, "spotify", "Spotify")
	granted := seedMessage(t, app, hid, netflix, "msg-1", "Your code", ptrTo("123456"), seedAt)
	ungranted := seedMessage(t, app, hid, spotify, "msg-2", "Other code", nil, seedAt)
	grantAccess(t, app, ownerCookie, slug, memberEmail, "netflix")

	rec := app.Do(t, http.MethodPatch, inboxPath(slug, "/messages/"+granted+"/status"),
		map[string]any{"status": "used"}, testrig.WithCookie(memberCookie))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	message, _ := app.JSON(t, rec)["message"].(map[string]any)
	if message["id"] != granted || message["status"] != "used" {
		t.Errorf("message = %v", message)
	}

	denied := app.Do(t, http.MethodPatch, inboxPath(slug, "/messages/"+ungranted+"/status"),
		map[string]any{"status": "used"}, testrig.WithCookie(memberCookie))
	if denied.Code != http.StatusForbidden {
		t.Fatalf("without access: %d %s", denied.Code, denied.Body.String())
	}
	if got := app.JSON(t, denied)["error"]; got != "Forbidden" {
		t.Errorf("error = %q", got)
	}
	if got := app.Count(t, "messages", `"id" = $1 AND "status" = 'new'`, ungranted); got != 1 {
		t.Errorf("the refused message changed status")
	}

	missing := app.Do(t, http.MethodPatch, inboxPath(slug, "/messages/nope/status"),
		map[string]any{"status": "used"}, testrig.WithCookie(ownerCookie))
	if missing.Code != http.StatusNotFound {
		t.Fatalf("unknown message: %d %s", missing.Code, missing.Body.String())
	}
	if got := app.JSON(t, missing)["error"]; got != "Message not found" {
		t.Errorf("error = %q", got)
	}
}

// The status is validated in Go so the rejection can name the three values —
// and it is validated AFTER the lookup, so a bad status for somebody else's
// message is still a 404.
func TestUpdateMessageStatusRejectsAnUnknownStatus(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)
	hid := householdID(t, app, slug)
	netflix := createProvider(t, app, cookie, slug, "netflix", "Netflix")
	id := seedMessage(t, app, hid, netflix, "msg-1", "Your code", nil, seedAt)

	rec := app.Do(t, http.MethodPatch, inboxPath(slug, "/messages/"+id+"/status"),
		map[string]any{"status": "archived"}, testrig.WithCookie(cookie))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	body := app.JSON(t, rec)
	if got := body["error"]; got != "status must be new, used or expired" {
		t.Errorf("error = %q", got)
	}
	fields, _ := body["fields"].(map[string]any)
	if fields["status"] != "status must be new, used or expired" {
		t.Errorf("fields = %v", fields)
	}

	unknown := app.Do(t, http.MethodPatch, inboxPath(slug, "/messages/nope/status"),
		map[string]any{"status": "archived"}, testrig.WithCookie(cookie))
	if unknown.Code != http.StatusNotFound {
		t.Errorf("a bad status on an unknown message = %d, want 404", unknown.Code)
	}
}

// "denies quarantine review to members in the same household": quarantined
// mail has no provider to scope it by, so it is owner-only on both routes.
func TestQuarantineRoutesAreOwnerOnly(t *testing.T) {
	app := testrig.App(t)
	ownerCookie, slug := app.CompleteSetup(t)
	memberCookie := app.CreateMember(t, slug, memberEmail, "Member", "member")
	hid := householdID(t, app, slug)
	createProvider(t, app, ownerCookie, slug, "netflix", "Netflix")
	grantAccess(t, app, ownerCookie, slug, memberEmail, "netflix")
	id := seedQuarantine(t, app, hid, "q-1", "Review this", "unknown_sender", seedAt)

	list := app.Do(t, http.MethodGet, inboxPath(slug, "/quarantine"), nil, testrig.WithCookie(memberCookie))
	if list.Code != http.StatusForbidden {
		t.Fatalf("member list: %d %s", list.Code, list.Body.String())
	}
	if got := app.JSON(t, list)["error"]; got != "Forbidden" {
		t.Errorf("error = %q", got)
	}

	review := app.Do(t, http.MethodPost, inboxPath(slug, "/quarantine/"+id+"/review"),
		map[string]any{"action": "dismiss"}, testrig.WithCookie(memberCookie))
	if review.Code != http.StatusForbidden {
		t.Fatalf("member review: %d %s", review.Code, review.Body.String())
	}
	if got := app.Count(t, "quarantine_messages", `"reviewed_at" IS NOT NULL`); got != 0 {
		t.Error("a member's refused review still marked the row reviewed")
	}
}

// Ports the release path of messages-repository.test.ts through the route: the
// copy lands in the provider's inbox with the reason that says where it came
// from, the quarantine row is marked reviewed, and a second review of the same
// row is a 404.
func TestReviewQuarantineReleasesIntoAProvider(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)
	hid := householdID(t, app, slug)
	createProvider(t, app, cookie, slug, "netflix", "Netflix")
	id := seedQuarantine(t, app, hid, "q-1", "Review this", "unknown_sender", seedAt)

	rec := app.Do(t, http.MethodPost, inboxPath(slug, "/quarantine/"+id+"/review"),
		map[string]any{"action": "release", "providerKey": "netflix"}, testrig.WithCookie(cookie))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	body := app.JSON(t, rec)
	if body["reviewedAt"] == nil {
		t.Errorf("reviewedAt = %v", body["reviewedAt"])
	}
	released, _ := body["releasedMessage"].(map[string]any)
	if released == nil {
		t.Fatalf("releasedMessage = %v, want the stored copy", body["releasedMessage"])
	}
	if released["provider_key"] != "netflix" || released["status"] != "new" ||
		released["subject"] != "Review this" {
		t.Errorf("releasedMessage = %v", released)
	}

	// The reason records where the message came from and why it had been held.
	if got := app.Count(t, "messages",
		`"classification_reason" = 'Released from quarantine by owner review. Original reason: unknown_sender'`,
	); got != 1 {
		t.Errorf("released copy's classification_reason = %d rows, want 1", got)
	}
	if got := app.Count(t, "quarantine_messages", `"reviewed_at" IS NOT NULL`); got != 1 {
		t.Errorf("reviewed rows = %d, want 1", got)
	}
	// Reviewed rows leave the queue.
	list := app.Do(t, http.MethodGet, inboxPath(slug, "/quarantine"), nil, testrig.WithCookie(cookie))
	if rows, _ := app.JSON(t, list)["messages"].([]any); len(rows) != 0 {
		t.Errorf("quarantine still lists %v", rows)
	}
	if got := app.Count(t, "audit_events", `"action" = 'quarantine.release'`); got != 1 {
		t.Errorf("quarantine.release audits = %d, want 1", got)
	}
	if got := app.Count(t, "audit_events",
		`"action" = 'quarantine.release' AND "details"::jsonb ->> 'providerKey' = 'netflix'`); got != 1 {
		t.Error("the audit does not record which provider it was released into")
	}

	// A second review of the same row finds nothing left to review.
	again := app.Do(t, http.MethodPost, inboxPath(slug, "/quarantine/"+id+"/review"),
		map[string]any{"action": "release", "providerKey": "netflix"}, testrig.WithCookie(cookie))
	if again.Code != http.StatusNotFound {
		t.Fatalf("second review: %d %s", again.Code, again.Body.String())
	}
	if got := app.JSON(t, again)["error"]; got != "Quarantine message not found" {
		t.Errorf("error = %q", got)
	}
	if got := app.Count(t, "messages", "TRUE"); got != 1 {
		t.Errorf("messages = %d, want the one released copy", got)
	}
}

// A dismissal takes the row out of the queue and stores nothing.
func TestReviewQuarantineDismisses(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)
	hid := householdID(t, app, slug)
	id := seedQuarantine(t, app, hid, "q-1", "Review this", "unknown_sender", seedAt)

	rec := app.Do(t, http.MethodPost, inboxPath(slug, "/quarantine/"+id+"/review"),
		map[string]any{"action": "dismiss"}, testrig.WithCookie(cookie))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	body := app.JSON(t, rec)
	if value, present := body["releasedMessage"]; !present || value != nil {
		t.Errorf("releasedMessage = %v (present %v), want a null", value, present)
	}
	if got := app.Count(t, "messages", "TRUE"); got != 0 {
		t.Errorf("a dismissal stored %d messages, want none", got)
	}
	if got := app.Count(t, "quarantine_messages", `"reviewed_at" IS NOT NULL`); got != 1 {
		t.Errorf("reviewed rows = %d, want 1", got)
	}
	if got := app.Count(t, "audit_events", `"action" = 'quarantine.dismiss'`); got != 1 {
		t.Errorf("quarantine.dismiss audits = %d, want 1", got)
	}
	// No provider was involved, so the audit records no key for one.
	if got := app.Count(t, "audit_events",
		`"action" = 'quarantine.dismiss' AND "details" IS NULL`); got != 1 {
		t.Error("the dismissal audit carries details it should not")
	}
}

// The three refusals of the review route, in the order the handler applies
// them.
func TestReviewQuarantineRefusals(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)
	hid := householdID(t, app, slug)
	createProvider(t, app, cookie, slug, "netflix", "Netflix")
	id := seedQuarantine(t, app, hid, "q-1", "Review this", "unknown_sender", seedAt)

	cases := []struct {
		name   string
		id     string
		body   map[string]any
		status int
		error  string
	}{
		{
			"an unknown action", id, map[string]any{"action": "burn"},
			http.StatusBadRequest, "action must be dismiss or release",
		},
		{
			"a release with no provider", id, map[string]any{"action": "release"},
			http.StatusBadRequest, "providerKey is required to release a message",
		},
		{
			"a release into an unknown provider", id,
			map[string]any{"action": "release", "providerKey": "nope"},
			http.StatusNotFound, "Provider not found",
		},
		{
			"an unknown message", "nope", map[string]any{"action": "dismiss"},
			http.StatusNotFound, "Quarantine message not found",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := app.Do(t, http.MethodPost, inboxPath(slug, "/quarantine/"+tc.id+"/review"),
				tc.body, testrig.WithCookie(cookie))
			if rec.Code != tc.status {
				t.Fatalf("status = %d %s, want %d", rec.Code, rec.Body.String(), tc.status)
			}
			if got := app.JSON(t, rec)["error"]; got != tc.error {
				t.Errorf("error = %q, want %q", got, tc.error)
			}
		})
	}

	// None of them reviewed anything or recorded an audit.
	if got := app.Count(t, "quarantine_messages", `"reviewed_at" IS NOT NULL`); got != 0 {
		t.Errorf("reviewed rows = %d, want 0", got)
	}
	if got := app.Count(t, "audit_events", `"action" LIKE 'quarantine.%'`); got != 0 {
		t.Errorf("quarantine audits = %d, want 0", got)
	}
}

// REF §A1's header contract on the routes this task adds: nosniff on every
// answer, and no CSP — that one belongs to the SPA (package web), where there
// is a document to constrain.
func TestInboxResponsesCarryNoSniffAndNoCSP(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)
	createProvider(t, app, cookie, slug, "netflix", "Netflix")

	for _, path := range []string{"/providers", "/providers/netflix", "/providers/nope", "/quarantine"} {
		t.Run(path, func(t *testing.T) {
			rec := app.Do(t, http.MethodGet, inboxPath(slug, path), nil, testrig.WithCookie(cookie))
			if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
				t.Errorf("X-Content-Type-Options = %q, want nosniff (status %d)", got, rec.Code)
			}
			if got := rec.Header().Get("Content-Security-Policy"); got != "" {
				t.Errorf("Content-Security-Policy = %q, want none on an API response", got)
			}
		})
	}
}

// ptrTo is the address of a value, for the optional columns a seeded message
// carries.
func ptrTo[T any](value T) *T { return &value }
