package mail

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	"net/smtp"
	"net/textproto"
	"net/url"
	"strings"
	"time"
)

// The outbound transport: the real implementation of Sender.
//
// The Workers deployment handed a message to an `EMAIL` binding and the
// platform delivered it. A container has no binding, so this dials an SMTP
// relay itself — the sidecar or provider named by SMTP_URL (see internal/
// config, which requires it, and the design spec's config table).
//
// Everything below is one message per connection: dial, hand over, quit.
// Connection pooling would save a handshake on a workload that sends a
// password reset every few minutes at most, and would cost a pool of sockets
// to a relay that may drop them whenever it likes.

// dialTimeout bounds the TCP connect, and sendTimeout the whole conversation
// after it. Both exist because an SMTP relay that accepts a connection and
// then says nothing would otherwise hold the calling request forever: the
// invitation route waits on this send.
const (
	dialTimeout = 10 * time.Second
	sendTimeout = 30 * time.Second
)

// SMTPOption customises the sender. There is one today, for TLS trust.
type SMTPOption func(*smtpSender)

// WithTLSConfig replaces the TLS configuration used for both implicit TLS
// (smtps) and the STARTTLS upgrade.
//
// It exists for the tests, which have to trust a certificate that no public
// root signed, and it is deliberately a *tls.Config rather than a
// "skip verification" boolean: a test passes a root it minted, so the
// handshake it exercises is a real one, and nothing in this package offers a
// way to turn verification OFF in production.
func WithTLSConfig(cfg *tls.Config) SMTPOption {
	return func(s *smtpSender) { s.tlsConfig = cfg }
}

// smtpSender is one configured relay.
type smtpSender struct {
	// addr is host:port, host the name TLS is verified against.
	addr string
	host string
	from string

	// implicitTLS is smtps://: TLS from the first byte, no upgrade.
	implicitTLS bool
	// startTLSDisabled is ?starttls=off: never upgrade, even if offered.
	startTLSDisabled bool
	// requireSTARTTLS refuses to hand a message to a server that offers no
	// upgrade. See NewSMTPSender for when it is switched off.
	requireSTARTTLS bool

	auth      smtp.Auth
	tlsConfig *tls.Config
}

var _ Sender = (*smtpSender)(nil)

// NewSMTPSender builds the outbound transport from SMTP_URL and
// OUTBOUND_EMAIL_FROM.
//
//	smtp://host:port            upgrade to TLS with STARTTLS (default port 587)
//	smtps://host:port           TLS from the first byte (default port 465)
//	smtp://user:pass@host:port  PLAIN authentication with the userinfo
//	smtp://host:port?starttls=off   do not upgrade at all
//
// STARTTLS is REQUIRED on an smtp:// URL — a relay that offers no upgrade is
// refused rather than spoken to in the clear — with two exemptions:
//
//   - a loopback host (localhost, 127.0.0.1, ::1), which is the sidecar relay
//     or mail catcher a deployment runs next to the app. That traffic never
//     leaves the machine, and the sidecar usually has no certificate anybody
//     could verify.
//   - ?starttls=off, for an operator who has a reason we did not anticipate
//     and would otherwise be stuck. It is spelled out in the URL, so it shows
//     up in a review of the deployment's configuration rather than hiding in
//     an "insecure" flag nobody reads.
//
// The messages this carries are password-reset and invitation links — a
// credential in a URL — which is why the default is the strict one.
func NewSMTPSender(smtpURL, from string, opts ...SMTPOption) (Sender, error) {
	if strings.TrimSpace(from) == "" {
		return nil, errors.New("mail: outbound from address is required")
	}
	if containsCRLF(from) {
		return nil, errors.New("mail: outbound from address must not contain CR or LF")
	}

	parsed, err := url.Parse(smtpURL)
	if err != nil {
		return nil, fmt.Errorf("mail: parse SMTP URL: %w", err)
	}
	if parsed.Scheme != "smtp" && parsed.Scheme != "smtps" {
		return nil, fmt.Errorf("mail: SMTP URL scheme must be smtp or smtps, got %q", parsed.Scheme)
	}
	host := parsed.Hostname()
	if host == "" {
		return nil, errors.New("mail: SMTP URL has no host")
	}

	port := parsed.Port()
	if port == "" {
		if parsed.Scheme == "smtps" {
			port = "465"
		} else {
			port = "587"
		}
	}

	sender := &smtpSender{
		addr:             net.JoinHostPort(host, port),
		host:             host,
		from:             strings.TrimSpace(from),
		implicitTLS:      parsed.Scheme == "smtps",
		startTLSDisabled: parsed.Query().Get("starttls") == "off",
	}
	sender.requireSTARTTLS = !sender.implicitTLS && !sender.startTLSDisabled && !isLoopbackHost(host)

	if parsed.User != nil {
		password, _ := parsed.User.Password()
		// PLAIN only. net/smtp's PlainAuth refuses to send the credentials
		// over an unencrypted connection unless the server is localhost, which
		// is the same line this sender draws for STARTTLS.
		sender.auth = smtp.PlainAuth("", parsed.User.Username(), password, host)
	}

	for _, opt := range opts {
		opt(sender)
	}
	return sender, nil
}

// Send delivers one message: dial, upgrade, authenticate, hand it over, quit.
func (s *smtpSender) Send(ctx context.Context, msg Message) error {
	if strings.TrimSpace(msg.To) == "" {
		return errors.New("mail: message has no recipient")
	}
	// Header injection, refused before anything is composed or dialled. The
	// recipient is the one field here that can carry a value from outside —
	// an invitation is addressed to whatever an owner typed — and a CR or LF
	// in it would end the To header and let the rest of the string become
	// headers of its own (a Bcc, a second body). The check is on the raw
	// value rather than on the composed message because by then the damage
	// would already be in the buffer.
	if containsCRLF(msg.To) {
		return errors.New("mail: recipient address must not contain CR or LF")
	}
	if containsCRLF(s.from) {
		return errors.New("mail: sender address must not contain CR or LF")
	}

	body, err := s.compose(msg, time.Now())
	if err != nil {
		return err
	}

	conn, err := s.dial(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close() }()

	client, err := smtp.NewClient(conn, s.host)
	if err != nil {
		return fmt.Errorf("mail: smtp handshake with %s: %w", s.addr, err)
	}
	defer func() { _ = client.Close() }()

	if err := s.upgrade(client); err != nil {
		return err
	}
	if err := s.authenticate(client); err != nil {
		return err
	}

	if err := client.Mail(s.from); err != nil {
		return fmt.Errorf("mail: smtp MAIL FROM: %w", err)
	}
	if err := client.Rcpt(msg.To); err != nil {
		return fmt.Errorf("mail: smtp RCPT TO: %w", err)
	}
	writer, err := client.Data()
	if err != nil {
		return fmt.Errorf("mail: smtp DATA: %w", err)
	}
	if _, err := writer.Write(body); err != nil {
		return fmt.Errorf("mail: smtp write message: %w", err)
	}
	if err := writer.Close(); err != nil {
		return fmt.Errorf("mail: smtp finish message: %w", err)
	}

	// Quit is the difference between a relay that logs a clean session and one
	// that logs a dropped connection for every message we send.
	if err := client.Quit(); err != nil {
		return fmt.Errorf("mail: smtp QUIT: %w", err)
	}
	return nil
}

// dial opens the connection, honouring ctx for the connect and turning
// whatever deadline it carries into a socket deadline for the rest of the
// conversation — net/smtp has no context of its own, so this is the only place
// a cancelled request can stop the send.
func (s *smtpSender) dial(ctx context.Context) (net.Conn, error) {
	dialer := &net.Dialer{Timeout: dialTimeout}

	conn, err := dialer.DialContext(ctx, "tcp", s.addr)
	if err != nil {
		return nil, fmt.Errorf("mail: dial %s: %w", s.addr, err)
	}

	deadline := time.Now().Add(sendTimeout)
	if ctxDeadline, ok := ctx.Deadline(); ok && ctxDeadline.Before(deadline) {
		deadline = ctxDeadline
	}
	if err := conn.SetDeadline(deadline); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("mail: set deadline on %s: %w", s.addr, err)
	}

	if !s.implicitTLS {
		return conn, nil
	}

	tlsConn := tls.Client(conn, s.clientTLSConfig())
	if err := tlsConn.HandshakeContext(ctx); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("mail: tls handshake with %s: %w", s.addr, err)
	}
	return tlsConn, nil
}

// upgrade runs STARTTLS when it applies, and enforces the requirement when the
// server offers none.
func (s *smtpSender) upgrade(client *smtp.Client) error {
	if s.implicitTLS || s.startTLSDisabled {
		return nil
	}

	if ok, _ := client.Extension("STARTTLS"); !ok {
		if s.requireSTARTTLS {
			return fmt.Errorf("mail: %s does not offer STARTTLS and this sender requires it "+
				"(use a loopback relay, or ?starttls=off if that is deliberate)", s.addr)
		}
		return nil
	}
	if err := client.StartTLS(s.clientTLSConfig()); err != nil {
		return fmt.Errorf("mail: starttls with %s: %w", s.addr, err)
	}
	return nil
}

// authenticate presents the URL's credentials, when there are any.
func (s *smtpSender) authenticate(client *smtp.Client) error {
	if s.auth == nil {
		return nil
	}
	if ok, _ := client.Extension("AUTH"); !ok {
		return fmt.Errorf("mail: %s offers no AUTH but SMTP_URL carries credentials", s.addr)
	}
	if err := client.Auth(s.auth); err != nil {
		return fmt.Errorf("mail: smtp authentication with %s: %w", s.addr, err)
	}
	return nil
}

// clientTLSConfig is the configuration for both TLS paths: whatever
// WithTLSConfig supplied, or the defaults with the server name filled in.
func (s *smtpSender) clientTLSConfig() *tls.Config {
	if s.tlsConfig == nil {
		return &tls.Config{ServerName: s.host, MinVersion: tls.VersionTLS12}
	}
	cfg := s.tlsConfig.Clone()
	if cfg.ServerName == "" {
		cfg.ServerName = s.host
	}
	if cfg.MinVersion == 0 {
		cfg.MinVersion = tls.VersionTLS12
	}
	return cfg
}

// compose renders msg as the RFC 5322 message that goes on the wire: a
// multipart/alternative with the text part first (the fallback) and the HTML
// part second (what a client prefers when it can render it), both
// quoted-printable so a non-ASCII body survives a relay that is not 8-bit
// clean.
//
// The headers are the minimum a receiving MTA and a spam filter expect: a Date
// and a Message-ID above all. A message without them is scored as suspicious
// by most filters, and a reset link that lands in spam is a support ticket.
func (s *smtpSender) compose(msg Message, now time.Time) ([]byte, error) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	if err := writePart(writer, "text/plain; charset=utf-8", msg.Text); err != nil {
		return nil, err
	}
	if err := writePart(writer, "text/html; charset=utf-8", msg.HTML); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("mail: close multipart body: %w", err)
	}

	messageID, err := newMessageID(s.from)
	if err != nil {
		return nil, err
	}

	out := &bytes.Buffer{}
	headers := [][2]string{
		{"From", s.from},
		{"To", msg.To},
		// RFC 2047 when it has to be: mime.QEncoding leaves a plain ASCII
		// subject exactly as written, so the common case reads normally in a
		// raw message.
		{"Subject", mime.QEncoding.Encode("utf-8", msg.Subject)},
		{"Date", now.Format(time.RFC1123Z)},
		{"Message-ID", messageID},
		{"MIME-Version", "1.0"},
		{"Content-Type", "multipart/alternative; boundary=" + writer.Boundary()},
	}
	for _, header := range headers {
		fmt.Fprintf(out, "%s: %s\r\n", header[0], header[1])
	}
	out.WriteString("\r\n")
	out.Write(body.Bytes())

	return out.Bytes(), nil
}

// writePart adds one alternative, quoted-printable encoded.
func writePart(writer *multipart.Writer, contentType, content string) error {
	part, err := writer.CreatePart(textproto.MIMEHeader{
		"Content-Type":              {contentType},
		"Content-Transfer-Encoding": {"quoted-printable"},
	})
	if err != nil {
		return fmt.Errorf("mail: create %s part: %w", contentType, err)
	}

	encoder := quotedprintable.NewWriter(part)
	// The templates are written with \n; SMTP wants CRLF, and the encoder
	// passes line endings through rather than normalising them.
	if _, err := encoder.Write([]byte(normalizeNewlines(content))); err != nil {
		return fmt.Errorf("mail: encode %s part: %w", contentType, err)
	}
	if err := encoder.Close(); err != nil {
		return fmt.Errorf("mail: finish %s part: %w", contentType, err)
	}
	return nil
}

// normalizeNewlines turns every line ending into CRLF, without doubling the
// ones that already are.
func normalizeNewlines(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, "\r\n", "\n"), "\n", "\r\n")
}

// newMessageID mints a Message-ID for an outbound message: random, and
// domain-qualified with the sender's own domain so it is globally unique the
// way RFC 5322 asks.
func newMessageID(from string) (string, error) {
	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		return "", fmt.Errorf("mail: generate message id: %w", err)
	}

	domain := "localhost"
	if at := strings.LastIndex(from, "@"); at >= 0 && at < len(from)-1 {
		domain = from[at+1:]
	}
	return "<" + hex.EncodeToString(random) + "@" + domain + ">", nil
}

// containsCRLF reports whether s carries a line break in any spelling. Both
// characters are checked on their own, not only the CRLF pair: a bare LF ends
// a header line for most MTAs, and every relay that normalises it turns a
// lone CR into one too.
func containsCRLF(s string) bool {
	return strings.ContainsAny(s, "\r\n")
}

// isLoopbackHost reports whether host names this machine — the sidecar-relay
// exemption from the STARTTLS requirement. Both the literal name and the
// loopback addresses count; anything that has to leave the machine does not.
func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback()
	}
	return false
}
