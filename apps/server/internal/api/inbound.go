package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/respond"
	"github.com/andersro93/mi-casa-su-casa/server/internal/classify"
	applog "github.com/andersro93/mi-casa-su-casa/server/internal/log"
	"github.com/andersro93/mi-casa-su-casa/server/internal/mail"
)

// The inbound mail endpoint: the Go replacement for the Workers deployment's
// `email` handler (src/server/email/handler.ts, REF §A3 "Inbound handler"),
// reached over HTTP because Mailgun forwards a message as a webhook POST
// rather than invoking a runtime entrypoint (REF Part C).
//
// The behaviour of the pipeline itself is unchanged — the same rejections in
// the same order, the same log events — but the way a rejection is EXPRESSED
// differs. The Worker called message.setReject(reason), which bounced the mail
// permanently; here the answer is a status code, and the mapping REF §A3
// prescribes turns on how Mailgun retries:
//
//	406  a permanent rejection. Mailgun does not retry a 406, and that is the
//	     whole reason for an otherwise unusual status: the message is bad
//	     (too large, unparseable, addressed to nobody) or the mailbox will not
//	     take it, and retrying for eight hours would change none of that.
//	200  stored or quarantined — the message is ours now.
//	500  something unexpected broke. Mailgun retries, which is what we want:
//	     a database that was down for a minute should not cost a verification
//	     code.
//	401  the request did not come from Mailgun (or came twice). Not part of
//	     the TypeScript's world at all — on Workers the platform was the
//	     authentication.
//
// A 401 is deliberately vague: whether the signature, the clock or the replay
// guard refused it goes to the log, never to the caller, so a prober cannot
// use the response to tell a wrong key from a wrong clock.

// MailgunInboundPath is where Mailgun's route forwards to. InboundBasePath is
// the prefix the cross-cutting middleware excludes: this endpoint is not in
// the OpenAPI spec (its request is a signed multipart form, not JSON, and its
// caller is a machine that has never seen a session cookie), so it is mounted
// on the mux directly and must sit outside both spec validation and the
// same-site guard — exactly as /api/auth/ does, and for the same reason.
const (
	InboundBasePath    = "/api/inbound/"
	MailgunInboundPath = "/api/inbound/mailgun/mime"
)

// maxFormMemory is what ParseMultipartForm keeps in memory before spilling to
// a temp file: the largest body-mime we accept plus room for the envelope
// fields and MIME framing around it. Sized so an accepted message is never
// written to disk at all.
const maxFormMemory = mail.MaxRawMessageBytes + 64*1024

// maxRequestBytes bounds the whole request. It is larger than
// MaxRawMessageBytes on purpose: a message just over the limit must be read
// far enough to be recognised and rejected as too large (406, permanent), not
// cut off mid-form and mistaken for a malformed one (401, which Mailgun would
// retry for eight hours).
const maxRequestBytes = mail.MaxRawMessageBytes + 1024*1024

// Mailgun's form fields (REF Part C). The message itself is `body-mime`
// because the forwarding URL ends in "mime"; the parsed body-plain/body-html
// fields Mailgun would otherwise send are not requested and not read.
const (
	fieldRecipient = "recipient"
	fieldSender    = "sender"
	fieldTimestamp = "timestamp"
	fieldToken     = "token"
	fieldSignature = "signature"
	fieldBodyMIME  = "body-mime"
)

// newInboundHandler builds the webhook endpoint from the same Deps every other
// route is built from. It is a plain http.Handler rather than a generated
// operation: see MailgunInboundPath's comment for why this one route lives
// outside the spec.
func newInboundHandler(d Deps) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer recoverInbound(w, r)

		if r.Method != http.MethodPost {
			// The spec validator would answer this for a route it knows; this
			// one is mounted past it, so it answers for itself rather than
			// letting the mux write a plain-text 405.
			respond.Error(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}
		serveInbound(d, w, r)
	})
}

// newInboundNotFoundHandler answers everything else under InboundBasePath.
//
// The prefix is excluded from spec validation, and that exclusion is what
// otherwise leaks: a request for /api/inbound/anything-else falls past the
// validator (which is where every other unknown /api/ path gets its JSON 404)
// and lands on the mux, whose own 404 is plain text. Mounting the subtree
// keeps one answer shape for the whole surface — a mail provider posting to a
// mistyped route gets the same envelope as any other caller.
func newInboundNotFoundHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		respond.Error(w, http.StatusNotFound, "Not found")
	})
}

// recoverInbound turns a panic below this handler into the same answer an
// unexpected error gets: `email_ingest_failed` and a 500, which Mailgun
// retries.
//
// The generated routes get this from the strict server's error handling; this
// one is mounted past all of that, so without it a nil collaborator or a
// hostile message that trips a parser bug would kill the connection with no
// log line and no status — and Mailgun would treat the dropped connection as
// a failure it should retry anyway, but nobody would know why.
//
// The panic VALUE is logged, never a body: it is the failure's own text
// (a nil dereference, an index out of range), and the message it happened to
// be processing is described by the same envelope fields every other line
// carries. http.ErrAbortHandler is re-panicked, because that is net/http's
// own signal for "drop this connection deliberately" and swallowing it would
// answer 500 to something that asked for silence.
func recoverInbound(w http.ResponseWriter, r *http.Request) {
	recovered := recover()
	if recovered == nil {
		return
	}
	if err, ok := recovered.(error); ok && errors.Is(err, http.ErrAbortHandler) {
		panic(recovered)
	}

	applog.Event(applog.LevelError, "email_ingest_failed", map[string]any{
		"path":  r.URL.Path,
		"error": fmt.Sprintf("panic: %v", recovered),
	})
	respond.Error(w, http.StatusInternalServerError, "Internal error")
}

// serveInbound is the handler body: authenticate the request, then run the
// TypeScript pipeline over what it carried.
func serveInbound(d Deps, w http.ResponseWriter, r *http.Request) {
	now := d.Now()

	// Read the form before anything else, because the signature fields are
	// IN it. A request whose Content-Length already exceeds what any
	// acceptable message could need is refused without being read: the size
	// check is the one part of the pipeline that does not need the request to
	// be authentic, and buffering 25 MB from a stranger to find out it is
	// unsigned would be the wrong order.
	if r.ContentLength > maxRequestBytes {
		rejectTooLarge(w, map[string]any{"contentLength": r.ContentLength})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)

	if err := r.ParseMultipartForm(maxFormMemory); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			rejectTooLarge(w, map[string]any{"limit": tooBig.Limit})
			return
		}
		// Not a form we can read, so not a request we can authenticate: 401
		// with the rest of the unauthenticated failures rather than a
		// message-level answer we have no grounds to give.
		rejectUnauthorized(w, r, "malformed")
		return
	}
	if r.MultipartForm != nil {
		// The http server removes spilled temp files when the request ends,
		// but a handler driven directly (httptest, or any future in-process
		// call) has no server to do it.
		defer func() { _ = r.MultipartForm.RemoveAll() }()
	}

	if err := mail.VerifyMailgunSignature(
		d.MailgunSigningKey,
		r.FormValue(fieldTimestamp),
		r.FormValue(fieldToken),
		r.FormValue(fieldSignature),
		now,
	); err != nil {
		rejectUnauthorized(w, r, mail.RejectionReason(err))
		return
	}
	if d.Replay.Seen(r.FormValue(fieldToken), now) {
		rejectUnauthorized(w, r, mail.ReasonReplay)
		return
	}

	ingest(d, w, r, now)
}

// ingest is the port of handleIncomingEmail: everything from here down has a
// TypeScript counterpart line for line.
func ingest(d Deps, w http.ResponseWriter, r *http.Request, now time.Time) {
	ctx := r.Context()

	envelopeFrom := strings.TrimSpace(r.FormValue(fieldSender))
	envelopeTo := strings.TrimSpace(r.FormValue(fieldRecipient))
	raw := []byte(r.FormValue(fieldBodyMIME))

	// The envelope, and the size — never the message. These three fields are
	// the TypeScript's `base` object, and they are the most a log line is
	// allowed to say about a message (REF §A7: never log bodies or codes).
	base := map[string]any{
		"from":    envelopeFrom,
		"to":      envelopeTo,
		"rawSize": len(raw),
	}

	if len(raw) > mail.MaxRawMessageBytes {
		rejectTooLarge(w, withFields(base, nil))
		return
	}

	// An absent body-mime and an unparseable one are the same failure: there
	// is no message here. Mailgun always sends the field for a `/mime` route,
	// so a request without it is malformed rather than empty.
	if len(raw) == 0 {
		logEmail(applog.LevelError, "email_parse_failed", base, map[string]any{
			"error": "the request carried no " + fieldBodyMIME + " field",
		})
		respond.Error(w, http.StatusNotAcceptable, "Message could not be parsed")
		return
	}

	parsed, err := mail.Parse(raw, envelopeFrom, envelopeTo)
	if err != nil {
		logEmail(applog.LevelError, "email_parse_failed", base, map[string]any{"error": err.Error()})
		respond.Error(w, http.StatusNotAcceptable, "Message could not be parsed")
		return
	}

	// The TypeScript's `context`: base plus the id every later line is
	// correlated by.
	fields := withFields(base, map[string]any{"messageId": parsed.MessageID})

	outcome, err := store(ctx, d, parsed, fields, now)
	if err != nil {
		// The Worker re-threw so Cloudflare answered with a temporary error;
		// here the equivalent is a 500, which Mailgun retries for up to eight
		// hours. The error text stays in the log — the caller is told nothing
		// about what broke.
		logEmail(applog.LevelError, "email_ingest_failed", fields, map[string]any{"error": err.Error()})
		respond.Error(w, http.StatusInternalServerError, "Internal error")
		return
	}
	if outcome.rejected {
		respond.Error(w, http.StatusNotAcceptable, outcome.message)
		return
	}

	respond.JSON(w, http.StatusOK, map[string]any{"ok": true, "outcome": outcome.message})
}

// outcome is what store decided: either a permanent rejection with the reason
// the caller is told, or the name of the row it wrote.
type outcome struct {
	rejected bool
	message  string
}

func rejected(message string) outcome { return outcome{rejected: true, message: message} }

// store classifies a parsed message and writes it, returning an error only for
// the failures the Worker re-threw — a database that would not answer. Every
// other ending is a decision, not a failure.
func store(ctx context.Context, d Deps, parsed *mail.Parsed, fields map[string]any, now time.Time) (outcome, error) {
	classification, err := classify.Classify(ctx, d.Repo, parsed)
	if err != nil {
		return outcome{}, err
	}

	if classification.Kind == classify.KindQuarantine {
		// No household means no row this could be stored against: the
		// recipient named a mailbox this installation does not have. Rejected
		// rather than dropped, so the sender is told instead of being left to
		// believe it was delivered.
		if classification.HouseholdID == nil {
			logEmail(applog.LevelInfo, "email_rejected", fields, map[string]any{
				"reason": "unknown_recipient",
				"detail": classification.Reason,
			})
			return rejected("Unknown recipient"), nil
		}

		pending, err := d.Repo.CountUnreviewedQuarantine(ctx, *classification.HouseholdID)
		if err != nil {
			return outcome{}, err
		}
		if pending >= mail.MaxUnreviewedQuarantine {
			logEmail(applog.LevelInfo, "email_rejected", fields, map[string]any{
				"householdId": *classification.HouseholdID,
				"reason":      "quarantine_full",
				"pending":     pending,
			})
			return rejected("Mailbox quarantine is full"), nil
		}

		if _, err := d.Repo.InsertQuarantine(ctx, *parsed, *classification.HouseholdID,
			classification.Code, classification.Reason, now); err != nil {
			return outcome{}, err
		}
		logEmail(applog.LevelInfo, "email_quarantined", fields, map[string]any{
			"householdId": *classification.HouseholdID,
			"reason":      classification.Reason,
			"truncated":   parsed.TextBodyTruncated,
		})
		return outcome{message: "quarantined"}, nil
	}

	if _, err := d.Repo.InsertMessage(ctx, *parsed, *classification.HouseholdID,
		classification.ProviderID, classification.Code, classification.Reason, now); err != nil {
		return outcome{}, err
	}
	// codeFound, never the code itself.
	logEmail(applog.LevelInfo, "email_stored", fields, map[string]any{
		"householdId": *classification.HouseholdID,
		"providerKey": classification.ProviderKey,
		"codeFound":   classification.Code != nil,
		"truncated":   parsed.TextBodyTruncated,
	})
	return outcome{message: "stored"}, nil
}

// rejectTooLarge answers REF §A3's size rejection. fields carries whatever is
// known about the request: the envelope and rawSize once the form has been
// read, and only the byte count when it was refused before that.
func rejectTooLarge(w http.ResponseWriter, fields map[string]any) {
	fields["reason"] = "too_large"
	fields["max"] = mail.MaxRawMessageBytes
	applog.Event(applog.LevelInfo, "email_rejected", fields)
	respond.Error(w, http.StatusNotAcceptable, "Message too large")
}

// rejectUnauthorized answers a request that failed the Mailgun guards. The
// reason is logged and never sent.
func rejectUnauthorized(w http.ResponseWriter, r *http.Request, reason string) {
	applog.Event(applog.LevelWarn, "inbound_rejected", map[string]any{
		"reason": reason,
		"path":   r.URL.Path,
	})
	respond.Error(w, http.StatusUnauthorized, "Unauthorized")
}

// logEmail writes one pipeline event: the shared context fields plus this
// event's own.
func logEmail(level, event string, fields, extra map[string]any) {
	applog.Event(level, event, withFields(fields, extra))
}

// withFields merges two field maps without mutating either, so the shared
// context can be reused by the next line.
func withFields(fields, extra map[string]any) map[string]any {
	merged := make(map[string]any, len(fields)+len(extra))
	for key, value := range fields {
		merged[key] = value
	}
	for key, value := range extra {
		merged[key] = value
	}
	return merged
}
