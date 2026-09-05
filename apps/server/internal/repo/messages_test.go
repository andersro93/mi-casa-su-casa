package repo_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/andersro93/mi-casa-su-casa/server/internal/mail"
	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
)

// Ports test/integration/messages-repository.test.ts,
// provider-summaries.test.ts, pagination.test.ts and the purge half of
// retention.test.ts.

func parsedEmail(messageID string) mail.Parsed {
	return mail.Parsed{
		EnvelopeFrom:  "login@service.example",
		EnvelopeTo:    "casa@example.com",
		HouseholdSlug: strptr("casa"),
		FromHeader:    strptr("Service <login@service.example>"),
		Subject:       strptr("Your verification code"),
		MessageID:     messageID,
		DateHeader:    strptr("Sun, 10 May 2026 12:00:00 +0000"),
		TextBody:      "Your verification code is 123456",
		RawSize:       256,
	}
}

func TestInsertMessageStoresAndListsItForTheProvider(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	_, household := ownedHousehold(t, r, rig, "owner@example.com", "casa")
	provider, err := r.CreateProvider(c, household.ID, "netflix", "Netflix")
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}

	now := time.Date(2026, 5, 10, 12, 0, 0, 0, time.UTC)
	id, err := r.InsertMessage(c, parsedEmail("<message-1@test>"), household.ID, provider.ID, strptr("123456"), "matched", now)
	if err != nil {
		t.Fatalf("InsertMessage: %v", err)
	}
	if id == "" {
		t.Fatal("InsertMessage returned an empty id")
	}

	page, err := r.ListMessagesForProvider(c, household.ID, "netflix", repo.NormalizePage(0, ""))
	if err != nil {
		t.Fatalf("ListMessagesForProvider: %v", err)
	}
	if len(page.Items) != 1 {
		t.Fatalf("ListMessagesForProvider = %+v, want 1 message", page.Items)
	}
	message := page.Items[0]
	if message.HouseholdSlug != "casa" || message.ProviderKey != "netflix" ||
		message.ProviderDisplayName != "Netflix" || message.Status != "new" {
		t.Fatalf("message = %+v", message)
	}
	if message.ExtractedCode == nil || *message.ExtractedCode != "123456" {
		t.Fatalf("extracted code = %v", message.ExtractedCode)
	}
	if !message.ReceivedAt.Equal(now) {
		t.Fatalf("received_at = %v, want %v", message.ReceivedAt, now)
	}
	if page.NextBefore != nil {
		t.Fatalf("NextBefore = %v, want nil on the last page", page.NextBefore)
	}

	// The row's delete_after is received_at + the 30-day retention window.
	var deleteAfter time.Time
	if err := rig.Pool.QueryRow(c, `SELECT delete_after FROM messages WHERE id = $1`, id).Scan(&deleteAfter); err != nil {
		t.Fatalf("read delete_after: %v", err)
	}
	if want := now.AddDate(0, 0, 30); !deleteAfter.UTC().Equal(want) {
		t.Fatalf("delete_after = %v, want %v", deleteAfter.UTC(), want)
	}
}

func TestInsertMessageSwallowsARedeliveryButNotAnotherHouseholdsCopy(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	_, casa := ownedHousehold(t, r, rig, "a@example.com", "casa")
	_, otra := ownedHousehold(t, r, rig, "b@example.com", "otra")
	casaProvider, err := r.CreateProvider(c, casa.ID, "netflix", "Netflix")
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}
	otraProvider, err := r.CreateProvider(c, otra.ID, "netflix", "Netflix")
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}

	now := time.Date(2026, 5, 10, 12, 0, 0, 0, time.UTC)
	for range 2 {
		if _, err := r.InsertMessage(c, parsedEmail("<message-1@test>"), casa.ID, casaProvider.ID, strptr("123456"), "matched", now); err != nil {
			t.Fatalf("InsertMessage: %v", err)
		}
	}
	if _, err := r.InsertMessage(c, parsedEmail("<message-1@test>"), otra.ID, otraProvider.ID, strptr("123456"), "matched", now); err != nil {
		t.Fatalf("InsertMessage (other household): %v", err)
	}

	if got := countRows(t, rig, "messages", "household_id = $1", casa.ID); got != 1 {
		t.Fatalf("messages in casa = %d, want 1 (the redelivery is swallowed)", got)
	}
	if got := countRows(t, rig, "messages", "household_id = $1", otra.ID); got != 1 {
		t.Fatalf("messages in otra = %d, want 1 (a broadcast may land twice)", got)
	}
}

func TestInsertMessageFallsBackToTheRowIDWhenThereIsNoMessageID(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	_, household := ownedHousehold(t, r, rig, "owner@example.com", "casa")
	provider, err := r.CreateProvider(c, household.ID, "netflix", "Netflix")
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}

	parsed := parsedEmail("")
	id, err := r.InsertMessage(c, parsed, household.ID, provider.ID, nil, "matched", time.Now().UTC())
	if err != nil {
		t.Fatalf("InsertMessage: %v", err)
	}
	var messageID string
	if err := rig.Pool.QueryRow(c, `SELECT message_id FROM messages WHERE id = $1`, id).Scan(&messageID); err != nil {
		t.Fatalf("read message_id: %v", err)
	}
	if messageID != id {
		t.Fatalf("message_id = %q, want the row id %q", messageID, id)
	}
}

func TestReceivedAtIsServerTimeNotTheDateHeader(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	_, household := ownedHousehold(t, r, rig, "owner@example.com", "casa")
	provider, err := r.CreateProvider(c, household.ID, "netflix", "Netflix")
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}

	t0 := time.Date(2026, 5, 10, 12, 0, 0, 0, time.UTC)
	forged := parsedEmail("<forged@test>")
	forged.DateHeader = strptr("Fri, 01 Jan 2099 00:00:00 +0000")
	if _, err := r.InsertMessage(c, forged, household.ID, provider.ID, strptr("123456"), "matched", t0); err != nil {
		t.Fatalf("InsertMessage: %v", err)
	}

	genuine := parsedEmail("<genuine@test>")
	later := t0.Add(5 * time.Minute)
	genuine.DateHeader = strptr(later.Format(time.RFC1123Z))
	if _, err := r.InsertMessage(c, genuine, household.ID, provider.ID, strptr("123456"), "matched", later); err != nil {
		t.Fatalf("InsertMessage: %v", err)
	}

	page, err := r.ListMessagesForProvider(c, household.ID, "netflix", repo.NormalizePage(0, ""))
	if err != nil {
		t.Fatalf("ListMessagesForProvider: %v", err)
	}
	if len(page.Items) != 2 || !page.Items[0].ReceivedAt.Equal(later) || !page.Items[1].ReceivedAt.Equal(t0) {
		t.Fatalf("inbox order = %+v, want the genuine message on top", page.Items)
	}

	// 31 days after t0 both are purged, whatever the header claimed.
	if _, err := r.PurgeExpired(c, t0.AddDate(0, 0, 31), 500); err != nil {
		t.Fatalf("PurgeExpired: %v", err)
	}
	if got := countRows(t, rig, "messages", ""); got != 0 {
		t.Fatalf("messages after purge = %d, want 0", got)
	}
}

func TestQuarantineInsertListReviewAndCount(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	_, household := ownedHousehold(t, r, rig, "owner@example.com", "casa")

	old := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	now := time.Now().UTC().Truncate(time.Millisecond)
	if _, err := r.InsertQuarantine(c, parsedEmail("<q-1@test>"), household.ID, nil, "no rule", old); err != nil {
		t.Fatalf("InsertQuarantine: %v", err)
	}
	if _, err := r.InsertQuarantine(c, parsedEmail("<q-2@test>"), household.ID, nil, "no rule", now); err != nil {
		t.Fatalf("InsertQuarantine: %v", err)
	}
	// A redelivery is swallowed the same way a message's is.
	if _, err := r.InsertQuarantine(c, parsedEmail("<q-2@test>"), household.ID, nil, "no rule", now); err != nil {
		t.Fatalf("InsertQuarantine (redelivery): %v", err)
	}

	page, err := r.ListQuarantine(c, household.ID, repo.NormalizePage(0, ""))
	if err != nil {
		t.Fatalf("ListQuarantine: %v", err)
	}
	if len(page.Items) != 2 {
		t.Fatalf("ListQuarantine = %d items, want 2", len(page.Items))
	}
	first := page.Items[0]
	if first.ProviderKey != "quarantine" || first.ProviderDisplayName != "Quarantine" ||
		first.Status != "new" || first.HouseholdSlug != "casa" ||
		first.QuarantineReason != "no rule" || first.EnvelopeFrom != "login@service.example" {
		t.Fatalf("quarantine row = %+v", first)
	}

	unreviewed, err := r.CountUnreviewedQuarantine(c, household.ID)
	if err != nil || unreviewed != 2 {
		t.Fatalf("CountUnreviewedQuarantine = %d (%v), want 2", unreviewed, err)
	}

	if _, err := r.PurgeExpired(c, time.Now().UTC(), 500); err != nil {
		t.Fatalf("PurgeExpired: %v", err)
	}
	page, err = r.ListQuarantine(c, household.ID, repo.NormalizePage(0, ""))
	if err != nil {
		t.Fatalf("ListQuarantine: %v", err)
	}
	if len(page.Items) != 1 {
		t.Fatalf("ListQuarantine after purge = %d items, want 1", len(page.Items))
	}
}

func TestReviewQuarantineReleaseAndDismiss(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	_, household := ownedHousehold(t, r, rig, "owner@example.com", "casa")
	provider, err := r.CreateProvider(c, household.ID, "netflix", "Netflix")
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}
	now := time.Now().UTC()

	releasedID, err := r.InsertQuarantine(c, parsedEmail("<release@test>"), household.ID, strptr("123456"), "no rule matched", now)
	if err != nil {
		t.Fatalf("InsertQuarantine: %v", err)
	}
	dismissedID, err := r.InsertQuarantine(c, parsedEmail("<dismiss@test>"), household.ID, nil, "no rule matched", now)
	if err != nil {
		t.Fatalf("InsertQuarantine: %v", err)
	}

	review, err := r.ReviewQuarantine(c, household.ID, releasedID, "release", provider.ID)
	if err != nil {
		t.Fatalf("ReviewQuarantine(release): %v", err)
	}
	if review == nil || review.ReleasedMessage == nil {
		t.Fatalf("ReviewQuarantine(release) = %+v, want a released message", review)
	}
	if review.ReviewedAt.IsZero() {
		t.Fatal("ReviewQuarantine returned a zero reviewedAt")
	}
	released := review.ReleasedMessage
	if released.ProviderKey != "netflix" || released.Status != "new" ||
		released.ExtractedCode == nil || *released.ExtractedCode != "123456" {
		t.Fatalf("released message = %+v", released)
	}
	var reason string
	if err := rig.Pool.QueryRow(c,
		`SELECT classification_reason FROM messages WHERE id = $1`, released.ID,
	).Scan(&reason); err != nil {
		t.Fatalf("read classification_reason: %v", err)
	}
	if want := "Released from quarantine by owner review. Original reason: no rule matched"; reason != want {
		t.Fatalf("classification_reason = %q, want %q", reason, want)
	}

	// Reviewing the same row again finds nothing left to review.
	again, err := r.ReviewQuarantine(c, household.ID, releasedID, "release", provider.ID)
	if err != nil {
		t.Fatalf("ReviewQuarantine (repeat): %v", err)
	}
	if again != nil {
		t.Fatalf("ReviewQuarantine on an already reviewed row = %+v, want nil", again)
	}

	dismiss, err := r.ReviewQuarantine(c, household.ID, dismissedID, "dismiss", "")
	if err != nil {
		t.Fatalf("ReviewQuarantine(dismiss): %v", err)
	}
	if dismiss == nil || dismiss.ReleasedMessage != nil {
		t.Fatalf("ReviewQuarantine(dismiss) = %+v, want no released message", dismiss)
	}
	if got := countRows(t, rig, "messages", ""); got != 1 {
		t.Fatalf("messages after one release and one dismiss = %d, want 1", got)
	}
	if unreviewed, err := r.CountUnreviewedQuarantine(c, household.ID); err != nil || unreviewed != 0 {
		t.Fatalf("CountUnreviewedQuarantine = %d (%v), want 0", unreviewed, err)
	}

	// Another household cannot review this household's rows.
	_, otra := ownedHousehold(t, r, rig, "b@example.com", "otra")
	crossTenant, err := r.ReviewQuarantine(c, otra.ID, dismissedID, "dismiss", "")
	if err != nil {
		t.Fatalf("ReviewQuarantine (cross-tenant): %v", err)
	}
	if crossTenant != nil {
		t.Fatalf("ReviewQuarantine across households = %+v, want nil", crossTenant)
	}
}

func TestUpdateMessageStatusAndFindMessageByID(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	_, casa := ownedHousehold(t, r, rig, "a@example.com", "casa")
	_, otra := ownedHousehold(t, r, rig, "b@example.com", "otra")
	provider, err := r.CreateProvider(c, casa.ID, "netflix", "Netflix")
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}
	id, err := r.InsertMessage(c, parsedEmail("<m@test>"), casa.ID, provider.ID, strptr("123456"), "matched", time.Now().UTC())
	if err != nil {
		t.Fatalf("InsertMessage: %v", err)
	}

	found, err := r.FindMessageByID(c, casa.ID, id)
	if err != nil || found == nil || found.ID != id {
		t.Fatalf("FindMessageByID = %+v (%v)", found, err)
	}
	if crossTenant, err := r.FindMessageByID(c, otra.ID, id); err != nil || crossTenant != nil {
		t.Fatalf("FindMessageByID(other household) = %+v (%v), want nil", crossTenant, err)
	}

	updated, err := r.UpdateMessageStatus(c, casa.ID, id, "used")
	if err != nil || updated == nil || updated.Status != "used" {
		t.Fatalf("UpdateMessageStatus = %+v (%v)", updated, err)
	}
	// The same call through another household changes nothing and finds
	// nothing.
	crossTenant, err := r.UpdateMessageStatus(c, otra.ID, id, "expired")
	if err != nil || crossTenant != nil {
		t.Fatalf("UpdateMessageStatus(other household) = %+v (%v), want nil", crossTenant, err)
	}
	still, err := r.FindMessageByID(c, casa.ID, id)
	if err != nil || still == nil || still.Status != "used" {
		t.Fatalf("status after a cross-tenant update = %+v (%v), want used", still, err)
	}
}

func TestListProviderSummariesForUser(t *testing.T) {
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

	seed := func(messageID, subject string, code *string, status string, receivedAt time.Time) string {
		t.Helper()
		parsed := parsedEmail(messageID)
		parsed.Subject = strptr(subject)
		id, err := r.InsertMessage(c, parsed, household.ID, netflix.ID, code, "matched", receivedAt)
		if err != nil {
			t.Fatalf("InsertMessage: %v", err)
		}
		if status != "new" {
			if _, err := r.UpdateMessageStatus(c, household.ID, id, status); err != nil {
				t.Fatalf("UpdateMessageStatus: %v", err)
			}
		}
		return id
	}

	seed("<old@t>", "Old code", strptr("111111"), "used", time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	newest := seed("<newest@t>", "Your Netflix verification code", strptr("482913"), "new", time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC))
	seed("<middle@t>", "New sign-in", nil, "new", time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC))

	summaries, err := r.ListProviderSummariesForUser(c, household.ID, owner)
	if err != nil {
		t.Fatalf("ListProviderSummariesForUser: %v", err)
	}
	if len(summaries) != 2 {
		t.Fatalf("summaries = %+v, want both providers for an owner", summaries)
	}

	byKey := map[string]repo.ProviderSummary{}
	for _, summary := range summaries {
		byKey[summary.ProviderKey] = summary
	}
	n := byKey["netflix"]
	if n.HouseholdSlug != "casa" || n.MessageCount != 3 || n.NewCount != 2 {
		t.Fatalf("netflix summary = %+v", n)
	}
	if n.LatestMessageID == nil || *n.LatestMessageID != newest {
		t.Fatalf("latest_message_id = %v, want %s", n.LatestMessageID, newest)
	}
	if n.LatestSubject == nil || *n.LatestSubject != "Your Netflix verification code" ||
		n.LatestCode == nil || *n.LatestCode != "482913" ||
		n.LatestStatus == nil || *n.LatestStatus != "new" {
		t.Fatalf("netflix latest fields = %+v", n)
	}
	if n.LatestReceivedAt == nil || !n.LatestReceivedAt.Equal(time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("latest_received_at = %v", n.LatestReceivedAt)
	}

	s := byKey["spotify"]
	if s.MessageCount != 0 || s.LatestReceivedAt != nil || s.LatestMessageID != nil ||
		s.LatestSubject != nil || s.LatestCode != nil || s.LatestStatus != nil {
		t.Fatalf("spotify summary = %+v, want null latest fields", s)
	}
	if spotify.ID == "" {
		t.Fatal("spotify provider has no id")
	}

	// A member sees only the providers they were granted.
	member := insertUser(t, rig, "member@example.com")
	addMembership(t, rig, household.ID, member, repo.RoleMember)
	memberSummaries, err := r.ListProviderSummariesForUser(c, household.ID, member)
	if err != nil {
		t.Fatalf("ListProviderSummariesForUser(member): %v", err)
	}
	if len(memberSummaries) != 0 {
		t.Fatalf("member summaries without a grant = %+v, want none", memberSummaries)
	}
	if err := r.GrantProviderAccess(c, household.ID, member, netflix.ID); err != nil {
		t.Fatalf("GrantProviderAccess: %v", err)
	}
	memberSummaries, err = r.ListProviderSummariesForUser(c, household.ID, member)
	if err != nil {
		t.Fatalf("ListProviderSummariesForUser(member): %v", err)
	}
	if len(memberSummaries) != 1 || memberSummaries[0].ProviderKey != "netflix" {
		t.Fatalf("member summaries = %+v, want only netflix", memberSummaries)
	}

	// And a stranger sees nothing at all.
	stranger := insertUser(t, rig, "stranger@example.com")
	strangerSummaries, err := r.ListProviderSummariesForUser(c, household.ID, stranger)
	if err != nil {
		t.Fatalf("ListProviderSummariesForUser(stranger): %v", err)
	}
	if len(strangerSummaries) != 0 {
		t.Fatalf("stranger summaries = %+v, want none", strangerSummaries)
	}
}

func TestNormalizePage(t *testing.T) {
	if got := repo.NormalizePage(0, ""); got.Limit != 50 || got.Before != nil {
		t.Fatalf("NormalizePage(0, \"\") = %+v, want limit 50", got)
	}
	if got := repo.NormalizePage(-3, ""); got.Limit != 1 {
		t.Fatalf("NormalizePage(-3) limit = %d, want 1", got.Limit)
	}
	if got := repo.NormalizePage(9999, ""); got.Limit != 200 {
		t.Fatalf("NormalizePage(9999) limit = %d, want 200", got.Limit)
	}
	if got := repo.NormalizePage(50, "garbage"); got.Before != nil {
		t.Fatalf("NormalizePage with an unparseable cursor kept it: %v", got.Before)
	}
	got := repo.NormalizePage(50, "2026-01-01T00:10:00Z")
	if got.Before == nil || !got.Before.Equal(time.Date(2026, 1, 1, 0, 10, 0, 0, time.UTC)) {
		t.Fatalf("NormalizePage cursor = %v", got.Before)
	}
}

func TestPagesMessagesAndQuarantineNewestFirstWithAKeysetCursor(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	_, household := ownedHousehold(t, r, rig, "owner@example.com", "casa")
	provider, err := r.CreateProvider(c, household.ID, "netflix", "Netflix")
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := range 60 {
		receivedAt := base.Add(time.Duration(i) * time.Minute)
		if _, err := r.InsertMessage(c, parsedEmail(mID("m", i)), household.ID, provider.ID, nil, "r", receivedAt); err != nil {
			t.Fatalf("InsertMessage %d: %v", i, err)
		}
		if _, err := r.InsertQuarantine(c, parsedEmail(mID("q", i)), household.ID, nil, "r", receivedAt); err != nil {
			t.Fatalf("InsertQuarantine %d: %v", i, err)
		}
	}

	first, err := r.ListMessagesForProvider(c, household.ID, "netflix", repo.NormalizePage(50, ""))
	if err != nil {
		t.Fatalf("ListMessagesForProvider: %v", err)
	}
	if len(first.Items) != 50 {
		t.Fatalf("first page = %d items, want 50", len(first.Items))
	}
	newest := base.Add(59 * time.Minute)
	if !first.Items[0].ReceivedAt.Equal(newest) {
		t.Fatalf("first item received_at = %v, want the newest %v", first.Items[0].ReceivedAt, newest)
	}
	if first.NextBefore == nil || !first.NextBefore.Equal(first.Items[49].ReceivedAt) {
		t.Fatalf("NextBefore = %v, want the last item's received_at", first.NextBefore)
	}

	second, err := r.ListMessagesForProvider(c, household.ID, "netflix",
		repo.NormalizePage(50, first.NextBefore.Format(time.RFC3339Nano)))
	if err != nil {
		t.Fatalf("ListMessagesForProvider (page 2): %v", err)
	}
	if len(second.Items) != 10 {
		t.Fatalf("second page = %d items, want 10", len(second.Items))
	}
	if !second.Items[len(second.Items)-1].ReceivedAt.Equal(base) {
		t.Fatalf("last item received_at = %v, want the oldest %v", second.Items[len(second.Items)-1].ReceivedAt, base)
	}
	if second.NextBefore != nil {
		t.Fatalf("NextBefore on the last page = %v, want nil", second.NextBefore)
	}

	quarantine, err := r.ListQuarantine(c, household.ID, repo.NormalizePage(25, ""))
	if err != nil {
		t.Fatalf("ListQuarantine: %v", err)
	}
	if len(quarantine.Items) != 25 || quarantine.NextBefore == nil {
		t.Fatalf("quarantine page = %d items, NextBefore %v", len(quarantine.Items), quarantine.NextBefore)
	}
	all, err := r.ListQuarantine(c, household.ID, repo.NormalizePage(200, ""))
	if err != nil {
		t.Fatalf("ListQuarantine (full): %v", err)
	}
	if len(all.Items) != 60 || all.NextBefore != nil {
		t.Fatalf("full quarantine page = %d items, NextBefore %v", len(all.Items), all.NextBefore)
	}
}

func TestPurgeExpiredDeletesInBoundedBatches(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	_, household := ownedHousehold(t, r, rig, "owner@example.com", "casa")
	provider, err := r.CreateProvider(c, household.ID, "netflix", "Netflix")
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}

	// 230 rows already past their retention window, and 5 that are not.
	expired := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, -30)
	live := time.Date(2099, 1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, -30)
	for i := range 230 {
		if _, err := r.InsertMessage(c, parsedEmail(mID("old", i)), household.ID, provider.ID, nil, "r", expired); err != nil {
			t.Fatalf("InsertMessage %d: %v", i, err)
		}
	}
	for i := range 5 {
		if _, err := r.InsertMessage(c, parsedEmail(mID("live", i)), household.ID, provider.ID, nil, "r", live); err != nil {
			t.Fatalf("InsertMessage %d: %v", i, err)
		}
	}
	for i := range 3 {
		if _, err := r.InsertQuarantine(c, parsedEmail(mID("q", i)), household.ID, nil, "r", expired); err != nil {
			t.Fatalf("InsertQuarantine %d: %v", i, err)
		}
	}

	result, err := r.PurgeExpired(c, time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC), 100)
	if err != nil {
		t.Fatalf("PurgeExpired: %v", err)
	}
	// Two full batches of 100 and a short one for messages (230 rows), plus a
	// single short batch for quarantine: the loop stops on the first batch
	// that comes back short, so an empty table still costs one statement.
	if result.Messages != 230 || result.Quarantine != 3 || result.Batches != 4 {
		t.Fatalf("PurgeExpired = %+v, want {Messages:230 Quarantine:3 Batches:4}", result)
	}
	if got := countRows(t, rig, "messages", ""); got != 5 {
		t.Fatalf("messages left = %d, want 5", got)
	}
	if got := countRows(t, rig, "quarantine_messages", ""); got != 0 {
		t.Fatalf("quarantine rows left = %d, want 0", got)
	}
}

// mID builds a distinct RFC 5322 Message-ID per seeded row, so the
// (household, message_id) unique constraint does not swallow the seed data
// the paging and purge tests depend on.
func mID(prefix string, i int) string {
	return fmt.Sprintf("<%s-%d@t>", prefix, i)
}

// Ports the normalizeDateHeader half of src/server/db/repositories/messages.ts
// (REF §A3, "Message storage"): the Date header is a sender-controlled string,
// so it is stored when it parses and left null when it does not — never as a
// reason to reject the message.
func TestDateHeaderIsStoredWhenItParsesAndNullWhenItDoesNot(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	_, household := ownedHousehold(t, r, rig, "owner@example.com", "casa")
	provider, err := r.CreateProvider(c, household.ID, "netflix", "Netflix")
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}
	now := time.Date(2026, 5, 10, 12, 0, 0, 0, time.UTC)

	good := parsedEmail("<good-date@test>")
	if _, err := r.InsertMessage(c, good, household.ID, provider.ID, nil, "matched", now); err != nil {
		t.Fatalf("InsertMessage: %v", err)
	}

	bad := parsedEmail("<bad-date@test>")
	bad.DateHeader = strptr("whenever, really")
	if _, err := r.InsertMessage(c, bad, household.ID, provider.ID, nil, "matched", now); err != nil {
		t.Fatalf("InsertMessage with an unparseable Date: %v", err)
	}

	if got := countRows(t, rig, "messages", "date_header = $1", time.Date(2026, 5, 10, 12, 0, 0, 0, time.UTC)); got != 1 {
		t.Errorf("rows with the parsed date_header = %d, want 1", got)
	}
	if got := countRows(t, rig, "messages", "date_header IS NULL"); got != 1 {
		t.Errorf("rows with a null date_header = %d, want 1", got)
	}
}
