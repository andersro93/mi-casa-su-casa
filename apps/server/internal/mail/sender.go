package mail

import (
	"context"
	"sync"

	applog "github.com/andersro93/mi-casa-su-casa/server/internal/log"
)

// Ports the transport half of src/server/email/sender.ts (REF §A3,
// "Outbound mail"). The message bodies themselves live in templates.go.
//
// The Workers deployment sent through an `EMAIL` binding whose `send` took a
// message with a `from` filled in from OUTBOUND_EMAIL_FROM. Off Workers there
// is no binding, so the seam is this interface: the composition root picks an
// implementation, and everything above it — the password-reset hook Limen
// calls, the invitation flow — only ever sees Sender.
//
// The sender ADDRESS is deliberately not part of Message. It is a property of
// the transport (one configured OUTBOUND_EMAIL_FROM per installation), not of
// the mail being sent, so a caller cannot get it wrong and a test does not
// have to know it.

// Message is one outbound email: who it goes to and the two bodies every
// message in this app carries. Both bodies are always populated — a text part
// for clients that cannot render HTML, an HTML part for the ones that can.
type Message struct {
	To      string
	Subject string
	Text    string
	HTML    string
}

// Sender delivers a Message. Implementations are expected to be safe for
// concurrent use: one Sender is built at boot and shared by every request.
type Sender interface {
	Send(ctx context.Context, msg Message) error
}

// RecordingSender is the test double: it records what it was asked to send
// instead of sending it, so a route test can assert on the mail a request
// produced without standing up an SMTP server.
//
// Fail, when non-nil, is returned by every Send instead of recording — which
// is how the "delivery failed but the invitation survived" paths (REF §A3:
// email failure is not an error) get exercised. Set it before the request
// under test; it is read under the same mutex as the recording, but changing
// it mid-flight makes for a test nobody can read.
type RecordingSender struct {
	mu   sync.Mutex
	sent []Message
	Fail error
}

var _ Sender = (*RecordingSender)(nil)

// Send records msg, or returns Fail when one is set.
func (s *RecordingSender) Send(_ context.Context, msg Message) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Fail != nil {
		return s.Fail
	}
	s.sent = append(s.sent, msg)
	return nil
}

// Sent returns everything recorded so far, in send order. The slice is a copy,
// so a caller ranging over it cannot be surprised by a concurrent Send.
func (s *RecordingSender) Sent() []Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Message, len(s.sent))
	copy(out, s.sent)
	return out
}

// Reset forgets everything recorded, for a test that reuses one rig across
// several sends and wants to assert on the last one alone.
func (s *RecordingSender) Reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sent = nil
}

// LogSender is the placeholder the composition root wires until the SMTP
// sender lands: it writes one `mail_send_skipped` line per message and drops
// it.
//
// It reports SUCCESS, deliberately. A skipped message is not a delivery
// failure — nothing went wrong, there is simply no transport configured yet —
// and returning an error here would fill the log with
// `password_reset_email_failed` and make every invitation report
// `emailSent:false` for a reason that has nothing to do with the invitation.
// The trade is that an installation running this build silently sends no
// mail, which is why the boot log says so out loud (cmd/mi-casa's
// logStartupConfig) and why the warn level is not info: nobody should mistake
// these lines for delivery.
//
// REMOVE THIS the moment internal/mail grows a real SMTP sender; it exists so
// the seam and its call sites are settled ahead of the transport.
type LogSender struct{}

var _ Sender = LogSender{}

// Send logs and drops. Only the envelope is logged — never the bodies, which
// carry reset links and, for other message kinds later, verification codes
// (REF §A7: never log message bodies or codes).
func (LogSender) Send(_ context.Context, msg Message) error {
	applog.Event(applog.LevelWarn, "mail_send_skipped", map[string]any{
		"to":      msg.To,
		"subject": msg.Subject,
		"reason":  "no outbound mail transport is configured in this build",
	})
	return nil
}
