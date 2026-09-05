package api_test

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api"
	applog "github.com/andersro93/mi-casa-su-casa/server/internal/log"
	"github.com/andersro93/mi-casa-su-casa/server/internal/mail"
	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
	"github.com/andersro93/mi-casa-su-casa/server/internal/testrig"
)

// Ports test/email-handler.test.ts and test/integration/email-pipeline.test.ts
// to the shape the Go deployment actually receives: not a Worker's
// ForwardableEmailMessage but a signed Mailgun webhook POST (REF Part C),
// answered with REF §A3's Go mapping — 406 for a permanent rejection Mailgun
// must not retry, 200 for stored or quarantined, 401 for a request that failed
// the signature guards.

// deliveredAt is the instant every fixture is signed and delivered at, so the
// signature window is never at the mercy of how fast the suite runs.
var deliveredAt = time.Date(2026, time.May, 10, 12, 0, 0, 0, time.UTC)

// rawEmailInput is the Go counterpart of email-pipeline.test.ts's rawEmail
// input: the handful of headers the pipeline's behaviour turns on.
type rawEmailInput struct {
	from                  string
	headerFrom            string
	to                    string
	subject               string
	body                  string
	messageID             string
	authenticationResults string
	mailgunSPF            string
	mailgunDKIM           string
}

// rawEmail renders one RFC 5322 message.
func rawEmail(in rawEmailInput) string {
	headerFrom := in.headerFrom
	if headerFrom == "" {
		headerFrom = in.from
	}

	lines := []string{"From: Service <" + headerFrom + ">"}
	if in.authenticationResults != "" {
		lines = append(lines, "Authentication-Results: "+in.authenticationResults)
	}
	if in.mailgunSPF != "" {
		lines = append(lines, mail.MailgunSPFHeader+": "+in.mailgunSPF)
	}
	if in.mailgunDKIM != "" {
		lines = append(lines, mail.MailgunDKIMHeader+": "+in.mailgunDKIM)
	}
	lines = append(lines, "To: "+in.to, "Subject: "+in.subject)
	if in.messageID != "" {
		lines = append(lines, "Message-ID: "+in.messageID)
	}
	lines = append(lines,
		"Date: Sun, 10 May 2026 12:00:00 +0000",
		"Content-Type: text/plain; charset=utf-8",
		"",
		in.body,
	)
	return strings.Join(lines, "\r\n")
}

// deliver posts one signed webhook request built from a raw message.
func deliver(t *testing.T, app *testrig.AppRig, raw, from, to string) *httptest.ResponseRecorder {
	t.Helper()
	body, contentType := testrig.MailgunForm(testrig.MailgunSigningKey, raw, from, to, deliveredAt)
	return post(app, body, contentType)
}

// post drives one request at the inbound endpoint through the whole handler.
func post(app *testrig.AppRig, body io.Reader, contentType string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, testrig.MailgunInboundPath, body)
	req.Header.Set("Content-Type", contentType)
	return app.DoRequest(req)
}

// inboundRig is an app with the clock pinned to deliveredAt (the signature
// window is checked against Deps.Now) and one household, ready for delivery.
func inboundRig(t *testing.T) (*testrig.AppRig, string) {
	t.Helper()
	app := testrig.App(t)
	app.CompleteSetup(t)
	app.SetNow(deliveredAt)
	return app, householdID(t, app, testrig.OwnerHouseholdSlug)
}

// seedNetflix gives the household a provider with a domain rule, the fixture
// every "matched sender" case is built on.
func seedNetflix(t *testing.T, app *testrig.AppRig, hid string) repo.Provider {
	t.Helper()
	provider, err := app.Deps.Repo.CreateProvider(t.Context(), hid, "netflix", "Netflix")
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if _, err := app.Deps.Repo.CreateSenderRule(t.Context(), hid, provider.ID, "domain", "netflix.com"); err != nil {
		t.Fatalf("create sender rule: %v", err)
	}
	return provider
}

// assertOutcome checks the 200 envelope both success paths answer with.
func assertOutcome(t *testing.T, app *testrig.AppRig, rec *httptest.ResponseRecorder, want string) {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	body := app.JSON(t, rec)
	if body["ok"] != true {
		t.Errorf("ok = %v, want true", body["ok"])
	}
	if body["outcome"] != want {
		t.Errorf("outcome = %v, want %q", body["outcome"], want)
	}
}

// assertRejected checks a permanent rejection: 406, so Mailgun does not retry.
func assertRejected(t *testing.T, app *testrig.AppRig, rec *httptest.ResponseRecorder, want string) {
	t.Helper()
	if rec.Code != http.StatusNotAcceptable {
		t.Fatalf("status = %d, want 406: %s", rec.Code, rec.Body.String())
	}
	if got := app.JSON(t, rec)["error"]; got != want {
		t.Errorf("error = %v, want %q", got, want)
	}
}

func TestInbound_StoresAMatchedMessageWithItsCode(t *testing.T) {
	app, hid := inboundRig(t)
	seedNetflix(t, app, hid)

	raw := rawEmail(rawEmailInput{
		from:      "info@netflix.com",
		to:        "casa@" + testrig.EmailDomain,
		subject:   "Your verification code",
		body:      "Your verification code is 482913",
		messageID: "<abc@netflix.com>",
	})

	rec := deliver(t, app, raw, "info@netflix.com", "casa@"+testrig.EmailDomain)
	assertOutcome(t, app, rec, "stored")

	stored, err := app.Deps.Repo.ListMessagesForProvider(t.Context(), hid, "netflix", repo.Page{Limit: 10})
	if err != nil {
		t.Fatalf("list messages: %v", err)
	}
	if len(stored.Items) != 1 {
		t.Fatalf("stored %d messages, want 1", len(stored.Items))
	}
	if stored.Items[0].ExtractedCode == nil || *stored.Items[0].ExtractedCode != "482913" {
		t.Errorf("extracted code = %v, want 482913", stored.Items[0].ExtractedCode)
	}
	if stored.Items[0].ProviderKey != "netflix" {
		t.Errorf("provider key = %q, want netflix", stored.Items[0].ProviderKey)
	}
}

func TestInbound_DeduplicatesARedeliveredMessage(t *testing.T) {
	app, hid := inboundRig(t)
	seedNetflix(t, app, hid)

	raw := rawEmail(rawEmailInput{
		from:      "info@netflix.com",
		to:        "casa@" + testrig.EmailDomain,
		subject:   "Your verification code",
		body:      "Your verification code is 482913",
		messageID: "<abc@netflix.com>",
	})

	first := deliver(t, app, raw, "info@netflix.com", "casa@"+testrig.EmailDomain)
	second := deliver(t, app, raw, "info@netflix.com", "casa@"+testrig.EmailDomain)

	assertOutcome(t, app, first, "stored")
	// A redelivery is accepted, not refused: Mailgun retried something it had
	// every right to retry, and answering anything but 200 would have it keep
	// trying for eight hours.
	assertOutcome(t, app, second, "stored")

	if got := app.Count(t, "messages", "household_id = $1", hid); got != 1 {
		t.Errorf("messages rows = %d, want 1", got)
	}
}

func TestInbound_QuarantinesAnUnmatchedSender(t *testing.T) {
	app, hid := inboundRig(t)

	raw := rawEmail(rawEmailInput{
		from:    "someone@unknown.example",
		to:      "casa@" + testrig.EmailDomain,
		subject: "Hello",
		body:    "No rule for me",
	})

	rec := deliver(t, app, raw, "someone@unknown.example", "casa@"+testrig.EmailDomain)
	assertOutcome(t, app, rec, "quarantined")

	if got := app.Count(t, "quarantine_messages", "household_id = $1", hid); got != 1 {
		t.Errorf("quarantine rows = %d, want 1", got)
	}
}

func TestInbound_RejectsMailForAnUnknownHousehold(t *testing.T) {
	app, hid := inboundRig(t)

	raw := rawEmail(rawEmailInput{
		from:    "info@netflix.com",
		to:      "nobody@" + testrig.EmailDomain,
		subject: "Code",
		body:    "123456",
	})

	rec := deliver(t, app, raw, "info@netflix.com", "nobody@"+testrig.EmailDomain)
	assertRejected(t, app, rec, "Unknown recipient")

	if got := app.Count(t, "quarantine_messages", "household_id = $1", hid); got != 0 {
		t.Errorf("quarantine rows = %d, want 0", got)
	}
	if got := app.Count(t, "messages", "household_id = $1", hid); got != 0 {
		t.Errorf("message rows = %d, want 0", got)
	}
}

func TestInbound_RejectsAMessageOverTwoMebibytes(t *testing.T) {
	app, hid := inboundRig(t)
	seedNetflix(t, app, hid)

	raw := rawEmail(rawEmailInput{
		from:    "info@netflix.com",
		to:      "casa@" + testrig.EmailDomain,
		subject: "Code",
		body:    "Your verification code is 482913\r\n" + strings.Repeat("x", mail.MaxRawMessageBytes),
	})

	rec := deliver(t, app, raw, "info@netflix.com", "casa@"+testrig.EmailDomain)
	assertRejected(t, app, rec, "Message too large")

	if got := app.Count(t, "messages", "household_id = $1", hid); got != 0 {
		t.Errorf("message rows = %d, want 0", got)
	}
}

func TestInbound_RejectsWhenTheQuarantineIsFull(t *testing.T) {
	app, hid := inboundRig(t)

	for i := range mail.MaxUnreviewedQuarantine {
		parsed := mail.Parsed{
			EnvelopeFrom: "someone@unknown.example",
			EnvelopeTo:   "casa@" + testrig.EmailDomain,
			MessageID:    "<seed-" + strconv.Itoa(i) + "@test>",
			TextBody:     "seeded",
			RawSize:      16,
		}
		if _, err := app.Deps.Repo.InsertQuarantine(t.Context(), parsed, hid, nil, "seeded", deliveredAt); err != nil {
			t.Fatalf("seed quarantine %d: %v", i, err)
		}
	}

	raw := rawEmail(rawEmailInput{
		from:    "someone@unknown.example",
		to:      "casa@" + testrig.EmailDomain,
		subject: "One too many",
		body:    "No rule for me either",
	})

	rec := deliver(t, app, raw, "someone@unknown.example", "casa@"+testrig.EmailDomain)
	assertRejected(t, app, rec, "Mailbox quarantine is full")

	if got := app.Count(t, "quarantine_messages", "household_id = $1", hid); got != mail.MaxUnreviewedQuarantine {
		t.Errorf("quarantine rows = %d, want %d", got, mail.MaxUnreviewedQuarantine)
	}
}

func TestInbound_RejectsAnUnparseableMessage(t *testing.T) {
	app, hid := inboundRig(t)

	rec := deliver(t, app, "not a header at all\r\n\r\nbody", "someone@unknown.example", "casa@"+testrig.EmailDomain)
	assertRejected(t, app, rec, "Message could not be parsed")

	if got := app.Count(t, "quarantine_messages", "household_id = $1", hid); got != 0 {
		t.Errorf("quarantine rows = %d, want 0", got)
	}
}

func TestInbound_RejectsARequestWithoutABodyMimeField(t *testing.T) {
	app, _ := inboundRig(t)

	body, contentType := testrig.MailgunFormWithout(t, testrig.MailgunSigningKey,
		"", "someone@unknown.example", "casa@"+testrig.EmailDomain, deliveredAt, "body-mime")

	assertRejected(t, app, post(app, body, contentType), "Message could not be parsed")
}

func TestInbound_RefusesARequestSignedWithTheWrongKey(t *testing.T) {
	app, hid := inboundRig(t)

	raw := rawEmail(rawEmailInput{
		from:    "info@netflix.com",
		to:      "casa@" + testrig.EmailDomain,
		subject: "Code",
		body:    "Your verification code is 482913",
	})
	body, contentType := testrig.MailgunForm("not-the-signing-key", raw,
		"info@netflix.com", "casa@"+testrig.EmailDomain, deliveredAt)

	rec := post(app, body, contentType)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401: %s", rec.Code, rec.Body.String())
	}
	if got := app.JSON(t, rec)["error"]; got != "Unauthorized" {
		t.Errorf("error = %v, want %q", got, "Unauthorized")
	}
	if got := app.Count(t, "quarantine_messages", "household_id = $1", hid); got != 0 {
		t.Errorf("quarantine rows = %d, want 0", got)
	}
}

func TestInbound_RefusesAStaleRequest(t *testing.T) {
	app, _ := inboundRig(t)

	raw := rawEmail(rawEmailInput{
		from:    "info@netflix.com",
		to:      "casa@" + testrig.EmailDomain,
		subject: "Code",
		body:    "Your verification code is 482913",
	})
	body, contentType := testrig.MailgunForm(testrig.MailgunSigningKey, raw,
		"info@netflix.com", "casa@"+testrig.EmailDomain, deliveredAt.Add(-6*time.Minute))

	if rec := post(app, body, contentType); rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401: %s", rec.Code, rec.Body.String())
	}
}

func TestInbound_RefusesAReplayedRequest(t *testing.T) {
	app, hid := inboundRig(t)
	seedNetflix(t, app, hid)

	raw := rawEmail(rawEmailInput{
		from:      "info@netflix.com",
		to:        "casa@" + testrig.EmailDomain,
		subject:   "Code",
		body:      "Your verification code is 482913",
		messageID: "<replayed@netflix.com>",
	})
	build := func() (*bytes.Buffer, string) {
		return testrig.MailgunFormWithToken(testrig.MailgunSigningKey, raw,
			"info@netflix.com", "casa@"+testrig.EmailDomain, deliveredAt, "replayed-token")
	}

	body, contentType := build()
	assertOutcome(t, app, post(app, body, contentType), "stored")

	body, contentType = build()
	rec := post(app, body, contentType)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401: %s", rec.Code, rec.Body.String())
	}
	if got := app.JSON(t, rec)["error"]; got != "Unauthorized" {
		t.Errorf("error = %v, want %q", got, "Unauthorized")
	}
}

// The envelope sender matches a rule, but Mailgun says its SPF check failed —
// REF §A3 step 5 refuses to trust it, and the reason it writes is what the
// needs-review screen shows.
func TestInbound_QuarantinesAnEnvelopeMatchThatFailedSPF(t *testing.T) {
	app, hid := inboundRig(t)
	seedNetflix(t, app, hid)

	raw := rawEmail(rawEmailInput{
		from:       "codes@netflix.com",
		headerFrom: "attacker@attacker.example",
		to:         "casa@" + testrig.EmailDomain,
		subject:    "Your Netflix code",
		body:       "Your verification code is 000000",
		mailgunSPF: "Fail",
	})

	rec := deliver(t, app, raw, "codes@netflix.com", "casa@"+testrig.EmailDomain)
	assertOutcome(t, app, rec, "quarantined")

	stored, err := app.Deps.Repo.ListMessagesForProvider(t.Context(), hid, "netflix", repo.Page{Limit: 10})
	if err != nil {
		t.Fatalf("list messages: %v", err)
	}
	if len(stored.Items) != 0 {
		t.Fatalf("stored %d messages, want 0", len(stored.Items))
	}

	quarantined, err := app.Deps.Repo.ListQuarantine(t.Context(), hid, repo.Page{Limit: 10})
	if err != nil {
		t.Fatalf("list quarantine: %v", err)
	}
	if len(quarantined.Items) != 1 {
		t.Fatalf("quarantined %d messages, want 1", len(quarantined.Items))
	}
	if reason := quarantined.Items[0].QuarantineReason; !strings.Contains(reason, "authentication failed") {
		t.Errorf("quarantine reason = %q, want one naming the failed authentication", reason)
	}
}

// The From header matches too, and it is authenticated: Mailgun's DKIM verdict
// is what makes the header candidate trustworthy (REF Part C).
func TestInbound_FilesByTheFromHeaderWhenTheEnvelopeIsABounceAddress(t *testing.T) {
	app, hid := inboundRig(t)
	seedNetflix(t, app, hid)

	raw := rawEmail(rawEmailInput{
		from:        "bounce+abc@amazonses.com",
		headerFrom:  "info@account.netflix.com",
		to:          "casa@" + testrig.EmailDomain,
		subject:     "Code",
		body:        "Your verification code is 555444",
		mailgunSPF:  "Pass",
		mailgunDKIM: "Pass",
	})

	rec := deliver(t, app, raw, "bounce+abc@amazonses.com", "casa@"+testrig.EmailDomain)
	assertOutcome(t, app, rec, "stored")

	stored, err := app.Deps.Repo.ListMessagesForProvider(t.Context(), hid, "netflix", repo.Page{Limit: 10})
	if err != nil {
		t.Fatalf("list messages: %v", err)
	}
	if len(stored.Items) != 1 {
		t.Fatalf("stored %d messages, want 1", len(stored.Items))
	}
	if stored.Items[0].ExtractedCode == nil || *stored.Items[0].ExtractedCode != "555444" {
		t.Errorf("extracted code = %v, want 555444", stored.Items[0].ExtractedCode)
	}
}

// The endpoint is mounted outside the OpenAPI surface, so it has to answer the
// method check itself rather than inheriting the spec validator's 405.
func TestInbound_RefusesEveryMethodButPost(t *testing.T) {
	app, _ := inboundRig(t)

	req := httptest.NewRequest(http.MethodGet, testrig.MailgunInboundPath, nil)
	rec := app.DoRequest(req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405: %s", rec.Code, rec.Body.String())
	}
	if got := app.JSON(t, rec)["error"]; got != "Method not allowed" {
		t.Errorf("error = %v, want %q", got, "Method not allowed")
	}
}

// --- the guards in front of the pipeline -------------------------------

// captureLog redirects the structured log into a buffer for the duration of
// one test, so a rejection's reason — which the response deliberately never
// carries — can be asserted on.
func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	buffer := &bytes.Buffer{}
	applog.SetOutput(buffer)
	t.Cleanup(func() { applog.SetOutput(nil) })
	return buffer
}

// assertLogged fails unless the buffer holds an event line with every one of
// the given field fragments.
func assertLogged(t *testing.T, buffer *bytes.Buffer, event string, fragments ...string) {
	t.Helper()
	for _, line := range strings.Split(strings.TrimSpace(buffer.String()), "\n") {
		if !strings.Contains(line, `"event":"`+event+`"`) {
			continue
		}
		missing := false
		for _, fragment := range fragments {
			if !strings.Contains(line, fragment) {
				missing = true
			}
		}
		if !missing {
			return
		}
	}
	t.Errorf("no %q line with %v in:\n%s", event, fragments, buffer.String())
}

// A body that is not a multipart form cannot be authenticated — the signature
// fields are inside it — so it joins the unauthenticated rejections rather
// than being given a message-level answer.
func TestInbound_RefusesABodyThatIsNotAMultipartForm(t *testing.T) {
	app, _ := inboundRig(t)
	buffer := captureLog(t)

	rec := post(app, strings.NewReader(`{"body-mime":"nope"}`), "application/json")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401: %s", rec.Code, rec.Body.String())
	}
	if got := app.JSON(t, rec)["error"]; got != "Unauthorized" {
		t.Errorf("error = %v, want %q", got, "Unauthorized")
	}
	assertLogged(t, buffer, "inbound_rejected", `"reason":"malformed"`)
}

// A request that announces more than any acceptable message could need is
// refused on its Content-Length, before the body is read and therefore before
// anything is verified: buffering 25 MB from a stranger to discover it was
// unsigned would be the wrong order.
func TestInbound_RefusesAnOversizedRequestBeforeVerifyingAnything(t *testing.T) {
	app, _ := inboundRig(t)
	buffer := captureLog(t)

	// The declared length is what the branch turns on, so the request declares
	// one rather than actually carrying four megabytes. Nothing reads the body:
	// that IS the behaviour under test.
	req := httptest.NewRequest(http.MethodPost, testrig.MailgunInboundPath, strings.NewReader("unsigned"))
	req.Header.Set("Content-Type", "multipart/form-data; boundary=whatever")
	req.ContentLength = 4 * 1024 * 1024

	assertRejected(t, app, app.DoRequest(req), "Message too large")
	// contentLength, not rawSize: the line proves the body was never read.
	assertLogged(t, buffer, "email_rejected", `"reason":"too_large"`, `"contentLength":4194304`)
}

// The same limit, enforced on a request that declares no length at all — a
// chunked POST, where only reading the body can reveal how big it is. This is
// the http.MaxBytesError branch.
func TestInbound_RefusesAnOversizedChunkedRequest(t *testing.T) {
	app, _ := inboundRig(t)
	buffer := captureLog(t)

	raw := rawEmail(rawEmailInput{
		from:    "info@netflix.com",
		to:      "casa@" + testrig.EmailDomain,
		subject: "Code",
		body:    strings.Repeat("x", 4*1024*1024),
	})
	form, contentType := testrig.MailgunForm(testrig.MailgunSigningKey, raw,
		"info@netflix.com", "casa@"+testrig.EmailDomain, deliveredAt)

	// A plain reader, so httptest cannot work the length out from the buffer.
	req := httptest.NewRequest(http.MethodPost, testrig.MailgunInboundPath, struct{ io.Reader }{form})
	req.Header.Set("Content-Type", contentType)
	req.ContentLength = -1
	if req.ContentLength != -1 {
		t.Fatalf("the request declares a length of %d; this test needs none", req.ContentLength)
	}

	assertRejected(t, app, app.DoRequest(req), "Message too large")
	// `limit` is the field only the http.MaxBytesError branch writes, which is
	// what pins this test to that branch rather than to either size check
	// around it.
	assertLogged(t, buffer, "email_rejected", `"reason":"too_large"`, `"limit":3145728`)
}

// A panic below the handler must answer like any other unexpected failure —
// 500, which Mailgun retries — rather than killing the connection silently.
//
// It is provoked with a Deps whose Repo is nil (a composition root that was
// mis-assembled) rather than through a seam added to production code for one
// test: classification dereferences the repository, so the panic happens
// exactly where a real one would, past every guard and inside the pipeline.
func TestInbound_RecoversAPanicAsAnIngestFailure(t *testing.T) {
	app, hid := inboundRig(t)
	seedNetflix(t, app, hid)
	buffer := captureLog(t)

	broken := app.Deps
	broken.Repo = nil
	handler := api.NewHandler(broken)

	raw := rawEmail(rawEmailInput{
		from:      "info@netflix.com",
		to:        "casa@" + testrig.EmailDomain,
		subject:   "Code",
		body:      "Your verification code is 482913",
		messageID: "<panic@netflix.com>",
	})
	form, contentType := testrig.MailgunForm(testrig.MailgunSigningKey, raw,
		"info@netflix.com", "casa@"+testrig.EmailDomain, deliveredAt)

	req := httptest.NewRequest(http.MethodPost, testrig.MailgunInboundPath, form)
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500: %s", rec.Code, rec.Body.String())
	}
	if got := app.JSON(t, rec)["error"]; got != "Internal error" {
		t.Errorf("error = %v, want %q", got, "Internal error")
	}
	assertLogged(t, buffer, "email_ingest_failed", `"error":"panic:`)
	// The panic line says what broke, never what the message said.
	if strings.Contains(buffer.String(), "482913") {
		t.Errorf("the log carries the verification code:\n%s", buffer.String())
	}
}

// The prefix is excluded from spec validation, which is where every other
// unknown /api/ path gets its 404 — so the subtree has to answer for itself,
// in the same envelope.
func TestInbound_AnswersJSONForAnUnknownPathUnderItsPrefix(t *testing.T) {
	app, _ := inboundRig(t)

	for _, path := range []string{
		"/api/inbound/",
		"/api/inbound/mailgun",
		"/api/inbound/mailgun/mime/extra",
		"/api/inbound/postmark/mime",
	} {
		t.Run(path, func(t *testing.T) {
			rec := app.DoRequest(httptest.NewRequest(http.MethodPost, path, nil))
			if rec.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want 404: %s", rec.Code, rec.Body.String())
			}
			if got := app.JSON(t, rec)["error"]; got != "Not found" {
				t.Errorf("error = %v, want %q", got, "Not found")
			}
		})
	}
}
