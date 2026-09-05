package mail

import (
	"strings"
)

// Ports the two message bodies in src/server/email/sender.ts (REF §A3,
// "Outbound mail"). The text lines are verbatim; the HTML carries the same
// paragraphs with every interpolated value escaped.
//
// Nothing here talks to a transport: a template is a pure function from its
// inputs to a Message, which is what lets templates_test.go assert on the
// rendered bodies without a Sender at all.

// escapeHTML is the TypeScript escapeHtml, entity for entity — including
// &quot; for the double quote, where Go's html.EscapeString writes &#34;. The
// difference is cosmetic in a browser, but these bodies are compared against
// the TypeScript's in the ported tests, and a hand-written five-replacement
// escape is easier to check by eye than a claim that two libraries agree.
//
// The order matters: & is replaced first, or the ampersands introduced by the
// later replacements would be escaped again.
func escapeHTML(value string) string {
	return strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		`"`, "&quot;",
		"'", "&#39;",
	).Replace(value)
}

// PasswordReset renders the reset link mail Limen's request-reset route
// triggers (REF §B6.4 hands us the address and the token; the link is built
// by the caller, which is the only place that knows where the reset screen
// lives).
//
// An empty or whitespace-only name becomes "there": the mail is triggered by
// an address alone, and "Hi ," reads like a bug to the person receiving it.
func PasswordReset(to, name, url string) Message {
	recipient := strings.TrimSpace(name)
	if recipient == "" {
		recipient = "there"
	}

	return Message{
		To:      to,
		Subject: "Reset your Mi Casa Su Casa password",
		Text: strings.Join([]string{
			"Hi " + recipient + ",",
			"",
			"We received a request to reset your Mi Casa Su Casa password.",
			"Use this link to choose a new password: " + url,
			"",
			"If you did not request this, you can safely ignore this email.",
		}, "\n"),
		HTML: strings.Join([]string{
			"<p>Hi " + escapeHTML(recipient) + ",</p>",
			"<p>We received a request to reset your Mi Casa Su Casa password.</p>",
			`<p><a href="` + escapeHTML(url) + `">Choose a new password</a></p>`,
			"<p>If you did not request this, you can safely ignore this email.</p>",
		}, "\n"),
	}
}

// InvitationMail is everything the invitation template interpolates. ExpiresAt
// is already a string: the TypeScript passed the ISO timestamp it had just
// written to the database, and the mail says the same thing the record does.
type InvitationMail struct {
	To           string
	InviteeName  string
	InviterName  string
	InviterEmail string
	InviteURL    string
	ExpiresAt    string
	Role         string
}

// Invitation renders the household invitation mail. The subject names the
// inviter because that is what makes it recognisable in an inbox — "Morgan
// invited you to Mi Casa Su Casa" is opened; "You have a new invitation" is
// not.
func Invitation(in InvitationMail) Message {
	role := roleLabel(in.Role)

	return Message{
		To:      in.To,
		Subject: in.InviterName + " invited you to Mi Casa Su Casa",
		Text: strings.Join([]string{
			"Hi " + in.InviteeName + ",",
			"",
			in.InviterName + " (" + in.InviterEmail + ") invited you to join Mi Casa Su Casa as a " + role + ".",
			"Accept the invitation here: " + in.InviteURL,
			"This invite expires on " + in.ExpiresAt + ".",
		}, "\n"),
		HTML: strings.Join([]string{
			"<p>Hi " + escapeHTML(in.InviteeName) + ",</p>",
			"<p>" + escapeHTML(in.InviterName) + " (" + escapeHTML(in.InviterEmail) +
				") invited you to join Mi Casa Su Casa as a " + escapeHTML(role) + ".</p>",
			`<p><a href="` + escapeHTML(in.InviteURL) + `">Accept your invitation</a></p>`,
			"<p>This invite expires on " + escapeHTML(in.ExpiresAt) + ".</p>",
		}, "\n"),
	}
}

// roleLabel is the human spelling of an invitation role. Anything that is not
// "owner" reads as Member, matching the TypeScript's ternary: the schema only
// allows the two, and a value that somehow escaped it should describe the
// lesser of the two rather than the greater.
func roleLabel(role string) string {
	if role == "owner" {
		return "Owner"
	}
	return "Member"
}
