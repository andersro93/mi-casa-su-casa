package mail

import (
	"context"
	"sync"
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
