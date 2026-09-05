package mail_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/andersro93/mi-casa-su-casa/server/internal/mail"
)

// Ports test/email-sender.test.ts. The two cases about the transport itself
// ("sends with the configured sender", "throws when OUTBOUND_EMAIL_FROM is
// missing") have no counterpart here: the from-address is the transport's
// property in Go, not the message's, so there is nothing in a rendered
// Message for them to assert on. What they were really testing — that a
// Sender is handed exactly the message the template produced — is covered by
// TestRecordingSenderRecordsWhatItWasGiven below.

func TestPasswordResetEscapesInterpolatedValues(t *testing.T) {
	msg := mail.PasswordReset(
		"member@example.com",
		"<Admin>",
		"https://example.com/reset?token=<unsafe>",
	)

	if msg.To != "member@example.com" {
		t.Errorf("To = %q, want member@example.com", msg.To)
	}
	if msg.Subject != "Reset your Mi Casa Su Casa password" {
		t.Errorf("Subject = %q", msg.Subject)
	}

	// The text part carries the link exactly as given: a mail client turns it
	// into a link itself, and escaping it there would break the URL.
	wantLine := "Use this link to choose a new password: https://example.com/reset?token=<unsafe>"
	if !strings.Contains(msg.Text, wantLine) {
		t.Errorf("Text missing %q:\n%s", wantLine, msg.Text)
	}
	if !strings.Contains(msg.Text, "Hi <Admin>,") {
		t.Errorf("Text missing the greeting:\n%s", msg.Text)
	}

	// The HTML part escapes both.
	if !strings.Contains(msg.HTML, "https://example.com/reset?token=&lt;unsafe&gt;") {
		t.Errorf("HTML did not escape the URL:\n%s", msg.HTML)
	}
	if !strings.Contains(msg.HTML, "Hi &lt;Admin&gt;,") {
		t.Errorf("HTML did not escape the name:\n%s", msg.HTML)
	}
	if strings.Contains(msg.HTML, "<Admin>") {
		t.Errorf("HTML contains the raw name:\n%s", msg.HTML)
	}
}

func TestPasswordResetFallsBackToThere(t *testing.T) {
	for _, name := range []string{"", "   "} {
		msg := mail.PasswordReset("member@example.com", name, "https://example.com/reset")
		if !strings.HasPrefix(msg.Text, "Hi there,\n") {
			t.Errorf("name %q: Text starts %q, want the \"Hi there,\" greeting", name, firstLine(msg.Text))
		}
		if !strings.Contains(msg.HTML, "<p>Hi there,</p>") {
			t.Errorf("name %q: HTML missing the fallback greeting:\n%s", name, msg.HTML)
		}
	}
}

func TestPasswordResetTextBody(t *testing.T) {
	msg := mail.PasswordReset("member@example.com", "Sam", "https://example.com/reset")

	want := strings.Join([]string{
		"Hi Sam,",
		"",
		"We received a request to reset your Mi Casa Su Casa password.",
		"Use this link to choose a new password: https://example.com/reset",
		"",
		"If you did not request this, you can safely ignore this email.",
	}, "\n")
	if msg.Text != want {
		t.Errorf("Text =\n%s\nwant\n%s", msg.Text, want)
	}
}

func TestInvitationCarriesRoleAndExpiry(t *testing.T) {
	msg := mail.Invitation(mail.InvitationMail{
		To:           "invitee@example.com",
		InviteeName:  "Taylor",
		InviterName:  "Morgan",
		InviterEmail: "morgan@example.com",
		InviteURL:    "https://example.com/invite/token-123",
		ExpiresAt:    "2026-05-31T12:00:00.000Z",
		Role:         "owner",
	})

	if msg.To != "invitee@example.com" {
		t.Errorf("To = %q", msg.To)
	}
	if msg.Subject != "Morgan invited you to Mi Casa Su Casa" {
		t.Errorf("Subject = %q", msg.Subject)
	}

	want := strings.Join([]string{
		"Hi Taylor,",
		"",
		"Morgan (morgan@example.com) invited you to join Mi Casa Su Casa as a Owner.",
		"Accept the invitation here: https://example.com/invite/token-123",
		"This invite expires on 2026-05-31T12:00:00.000Z.",
	}, "\n")
	if msg.Text != want {
		t.Errorf("Text =\n%s\nwant\n%s", msg.Text, want)
	}
	if !strings.Contains(msg.HTML, "Accept your invitation") {
		t.Errorf("HTML missing the call to action:\n%s", msg.HTML)
	}
}

func TestInvitationRoleLabel(t *testing.T) {
	for role, want := range map[string]string{"owner": "Owner", "member": "Member", "": "Member"} {
		msg := mail.Invitation(mail.InvitationMail{InviterName: "M", Role: role})
		if !strings.Contains(msg.Text, "as a "+want+".") {
			t.Errorf("role %q: Text does not say %q:\n%s", role, want, msg.Text)
		}
	}
}

func TestInvitationEscapesInterpolatedValues(t *testing.T) {
	msg := mail.Invitation(mail.InvitationMail{
		To:           "invitee@example.com",
		InviteeName:  `"Taylor" <taylor>`,
		InviterName:  "Morgan & Co",
		InviterEmail: "morgan@example.com",
		InviteURL:    "https://example.com/invite/a&b",
		ExpiresAt:    "<tomorrow>",
		Role:         "member",
	})

	for _, raw := range []string{"<taylor>", "Morgan & Co", "<tomorrow>"} {
		if strings.Contains(msg.HTML, raw) {
			t.Errorf("HTML contains the unescaped %q:\n%s", raw, msg.HTML)
		}
	}
	if !strings.Contains(msg.HTML, "&quot;Taylor&quot; &lt;taylor&gt;") {
		t.Errorf("HTML did not escape the invitee name:\n%s", msg.HTML)
	}
	if !strings.Contains(msg.HTML, "Morgan &amp; Co") {
		t.Errorf("HTML did not escape the inviter name:\n%s", msg.HTML)
	}
	if !strings.Contains(msg.HTML, `href="https://example.com/invite/a&amp;b"`) {
		t.Errorf("HTML did not escape the invite URL:\n%s", msg.HTML)
	}
	// The subject is a header, not markup: it carries the raw value.
	if msg.Subject != "Morgan & Co invited you to Mi Casa Su Casa" {
		t.Errorf("Subject = %q", msg.Subject)
	}
}

func TestRecordingSenderRecordsWhatItWasGiven(t *testing.T) {
	sender := &mail.RecordingSender{}
	msg := mail.PasswordReset("member@example.com", "Sam", "https://example.com/reset")

	if err := sender.Send(context.Background(), msg); err != nil {
		t.Fatalf("Send: %v", err)
	}

	sent := sender.Sent()
	if len(sent) != 1 {
		t.Fatalf("Sent() has %d messages, want 1", len(sent))
	}
	if sent[0] != msg {
		t.Errorf("Sent()[0] = %+v, want %+v", sent[0], msg)
	}

	sender.Reset()
	if len(sender.Sent()) != 0 {
		t.Error("Reset did not clear the recording")
	}
}

func TestRecordingSenderFail(t *testing.T) {
	boom := errors.New("binding down")
	sender := &mail.RecordingSender{Fail: boom}

	err := sender.Send(context.Background(), mail.Message{To: "a@example.com"})
	if !errors.Is(err, boom) {
		t.Fatalf("Send error = %v, want %v", err, boom)
	}
	if len(sender.Sent()) != 0 {
		t.Error("a failed Send was recorded")
	}
}

func TestLogSenderReportsSuccess(t *testing.T) {
	if err := (mail.LogSender{}).Send(context.Background(), mail.Message{To: "a@example.com"}); err != nil {
		t.Fatalf("LogSender.Send: %v", err)
	}
}

func firstLine(s string) string {
	line, _, _ := strings.Cut(s, "\n")
	return line
}
