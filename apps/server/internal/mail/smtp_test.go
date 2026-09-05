package mail

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"errors"
	"io"
	"math/big"
	"mime"
	"mime/multipart"
	"net"
	netmail "net/mail"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/emersion/go-sasl"
	smtpserver "github.com/emersion/go-smtp"
)

// The outbound transport's tests run a real SMTP server in-process
// (github.com/emersion/go-smtp, test-only) on 127.0.0.1 and assert on what
// actually arrived over the wire: the envelope, the headers and both bodies.
// A mock of net/smtp would prove nothing about the one thing that has ever
// been wrong with an SMTP client — what it puts on the socket.

// delivery is one message as the test server received it.
type delivery struct {
	from string
	to   []string
	data string
}

// recorder is the go-smtp backend: it accepts everything and remembers it.
type recorder struct {
	mu         sync.Mutex
	deliveries []delivery
	// credentials, when set, is the PLAIN username/password the server
	// requires. Empty means the server advertises no AUTH at all.
	username, password string
	authenticated      bool
}

func (b *recorder) NewSession(*smtpserver.Conn) (smtpserver.Session, error) {
	return &session{backend: b}, nil
}

func (b *recorder) record(d delivery) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.deliveries = append(b.deliveries, d)
}

func (b *recorder) received(t *testing.T) delivery {
	t.Helper()
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.deliveries) != 1 {
		t.Fatalf("server received %d messages, want 1", len(b.deliveries))
	}
	return b.deliveries[0]
}

type session struct {
	backend *recorder
	current delivery
}

func (s *session) Reset()        { s.current = delivery{} }
func (s *session) Logout() error { return nil }
func (s *session) Mail(from string, _ *smtpserver.MailOptions) error {
	s.current.from = from
	return nil
}
func (s *session) Rcpt(to string, _ *smtpserver.RcptOptions) error {
	s.current.to = append(s.current.to, to)
	return nil
}

func (s *session) AuthMechanisms() []string {
	if s.backend.username == "" {
		return nil
	}
	return []string{sasl.Plain}
}

func (s *session) Auth(mech string) (sasl.Server, error) {
	if s.backend.username == "" {
		return nil, smtpserver.ErrAuthUnsupported
	}
	return sasl.NewPlainServer(func(identity, username, password string) error {
		if username != s.backend.username || password != s.backend.password {
			return smtpserver.ErrAuthFailed
		}
		s.backend.authenticated = true
		return nil
	}), nil
}

func (s *session) Data(r io.Reader) error {
	body, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	s.current.data = string(body)
	s.backend.record(s.current)
	s.current = delivery{}
	return nil
}

// startServer runs a go-smtp server on a random loopback port and returns its
// host:port. tlsConfig non-nil makes it advertise STARTTLS.
func startServer(t *testing.T, backend *recorder, tlsConfig *tls.Config) string {
	t.Helper()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	server := smtpserver.NewServer(backend)
	server.Domain = "localhost"
	server.ReadTimeout = 10 * time.Second
	server.WriteTimeout = 10 * time.Second
	server.AllowInsecureAuth = true
	server.TLSConfig = tlsConfig

	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() { _ = server.Close() })

	return listener.Addr().String()
}

// startTLSServer runs one that speaks TLS from the first byte (smtps).
func startTLSServer(t *testing.T, backend *recorder, tlsConfig *tls.Config) string {
	t.Helper()

	listener, err := tls.Listen("tcp", "127.0.0.1:0", tlsConfig)
	if err != nil {
		t.Fatalf("listen tls: %v", err)
	}

	server := smtpserver.NewServer(backend)
	server.Domain = "localhost"
	server.ReadTimeout = 10 * time.Second
	server.WriteTimeout = 10 * time.Second
	server.AllowInsecureAuth = true

	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() { _ = server.Close() })

	return listener.Addr().String()
}

// selfSigned mints a certificate for 127.0.0.1, so the TLS handshake in these
// tests is a real one rather than a skipped one.
func selfSigned(t *testing.T) *tls.Config {
	t.Helper()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	template := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "127.0.0.1"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IsCA:         true,
	}
	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("create certificate: %v", err)
	}

	pool := x509.NewCertPool()
	parsed, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("parse certificate: %v", err)
	}
	pool.AddCert(parsed)

	return &tls.Config{
		Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key, Leaf: parsed}},
		RootCAs:      pool,
		MinVersion:   tls.VersionTLS12,
	}
}

// clientTLS is the trust the sender is given for a test server's certificate:
// the same self-signed cert as a root, so nothing has to skip verification.
func clientTLS(server *tls.Config) *tls.Config {
	return &tls.Config{RootCAs: server.RootCAs, MinVersion: tls.VersionTLS12}
}

const outboundFrom = "mi-casa@example.com"

func testMessage() Message {
	return Message{
		To:      "member@example.org",
		Subject: "Reset your Mi Casa Su Casa password",
		Text:    "Hi Ada,\n\nUse this link to choose a new password: https://example.com/reset?token=abc\n",
		HTML:    "<p>Hi Ada,</p><p><a href=\"https://example.com/reset?token=abc\">Choose a new password</a></p>",
	}
}

func TestSMTPSender_DeliversBothBodiesOverAPlainConnection(t *testing.T) {
	backend := &recorder{}
	addr := startServer(t, backend, nil)

	sender, err := NewSMTPSender("smtp://"+addr+"?starttls=off", outboundFrom)
	if err != nil {
		t.Fatalf("NewSMTPSender: %v", err)
	}
	if err := sender.Send(t.Context(), testMessage()); err != nil {
		t.Fatalf("Send: %v", err)
	}

	got := backend.received(t)
	if got.from != outboundFrom {
		t.Errorf("envelope from = %q, want %q", got.from, outboundFrom)
	}
	if len(got.to) != 1 || got.to[0] != "member@example.org" {
		t.Errorf("envelope to = %v, want [member@example.org]", got.to)
	}

	for _, want := range []string{
		"From: " + outboundFrom,
		"To: member@example.org",
		"Subject: Reset your Mi Casa Su Casa password",
		"MIME-Version: 1.0",
		"multipart/alternative",
		"Content-Type: text/plain; charset=utf-8",
		"Content-Type: text/html; charset=utf-8",
		"Content-Transfer-Encoding: quoted-printable",
	} {
		if !strings.Contains(got.data, want) {
			t.Errorf("delivered message is missing %q:\n%s", want, got.data)
		}
	}
	for _, header := range []string{"Date:", "Message-ID:"} {
		if !strings.Contains(got.data, header) {
			t.Errorf("delivered message has no %s header:\n%s", header, got.data)
		}
	}

	// Both bodies survive the transport intact — decoded, because
	// quoted-printable folds a long line and a substring assertion on the raw
	// message would be asserting on where the fold happened to land.
	text, html := alternatives(t, got.data)
	if want := normalizeNewlines(testMessage().Text); text != want {
		t.Errorf("text part = %q, want %q", text, want)
	}
	if want := normalizeNewlines(testMessage().HTML); html != want {
		t.Errorf("html part = %q, want %q", html, want)
	}
}

// alternatives decodes a delivered multipart/alternative into its two parts.
func alternatives(t *testing.T, data string) (text, html string) {
	t.Helper()

	message, err := netmail.ReadMessage(strings.NewReader(data))
	if err != nil {
		t.Fatalf("read delivered message: %v", err)
	}
	mediaType, params, err := mime.ParseMediaType(message.Header.Get("Content-Type"))
	if err != nil {
		t.Fatalf("parse content type: %v", err)
	}
	if mediaType != "multipart/alternative" {
		t.Fatalf("content type = %q, want multipart/alternative", mediaType)
	}

	reader := multipart.NewReader(message.Body, params["boundary"])
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatalf("read part: %v", err)
		}
		// multipart.Part undoes the quoted-printable encoding itself (and
		// drops the header once it has). That the parts ARE quoted-printable
		// is asserted on the raw message above.
		decoded, err := io.ReadAll(part)
		if err != nil {
			t.Fatalf("decode part: %v", err)
		}
		switch contentType := part.Header.Get("Content-Type"); {
		case strings.HasPrefix(contentType, "text/plain"):
			text = string(decoded)
		case strings.HasPrefix(contentType, "text/html"):
			html = string(decoded)
		default:
			t.Errorf("unexpected part %q", contentType)
		}
	}
	return text, html
}

func TestSMTPSender_EncodesANonASCIISubject(t *testing.T) {
	backend := &recorder{}
	addr := startServer(t, backend, nil)

	sender, err := NewSMTPSender("smtp://"+addr+"?starttls=off", outboundFrom)
	if err != nil {
		t.Fatalf("NewSMTPSender: %v", err)
	}
	msg := testMessage()
	msg.Subject = "Tilbakestill passordet ditt — Mi Casa"
	if err := sender.Send(t.Context(), msg); err != nil {
		t.Fatalf("Send: %v", err)
	}

	got := backend.received(t)
	if strings.Contains(got.data, msg.Subject) {
		t.Errorf("a non-ASCII subject must be RFC 2047 encoded, not sent raw:\n%s", got.data)
	}
	if !strings.Contains(got.data, "Subject: =?utf-8?q?") && !strings.Contains(got.data, "Subject: =?utf-8?b?") {
		t.Errorf("subject is not RFC 2047 encoded:\n%s", got.data)
	}

	decoded, err := (&mime.WordDecoder{}).DecodeHeader(subjectHeader(t, got.data))
	if err != nil {
		t.Fatalf("decode subject: %v", err)
	}
	if decoded != msg.Subject {
		t.Errorf("decoded subject = %q, want %q", decoded, msg.Subject)
	}
}

func TestSMTPSender_UpgradesToSTARTTLSWhenTheServerOffersIt(t *testing.T) {
	serverTLS := selfSigned(t)
	backend := &recorder{}
	addr := startServer(t, backend, serverTLS)

	sender, err := NewSMTPSender("smtp://"+addr, outboundFrom, WithTLSConfig(clientTLS(serverTLS)))
	if err != nil {
		t.Fatalf("NewSMTPSender: %v", err)
	}
	if err := sender.Send(t.Context(), testMessage()); err != nil {
		t.Fatalf("Send: %v", err)
	}

	if got := backend.received(t); !strings.Contains(got.data, "Reset your Mi Casa Su Casa password") {
		t.Errorf("message did not arrive over STARTTLS:\n%s", got.data)
	}
}

// The STARTTLS requirement is a policy read off the URL, and it is the one
// piece of this transport that is a security decision rather than a
// convenience: everything this sender carries is a password-reset or
// invitation link.
func TestSMTPSender_RequiresSTARTTLSForEverythingButLoopbackAndAnExplicitOptOut(t *testing.T) {
	for url, want := range map[string]bool{
		"smtp://smtp.example.com:587":              true,
		"smtp://smtp.example.com:587?starttls=on":  true,
		"smtp://smtp.example.com:587?starttls=off": false,
		"smtp://127.0.0.1:1025":                    false,
		"smtp://localhost:1025":                    false,
		"smtp://[::1]:1025":                        false,
		// Implicit TLS is already encrypted, so there is nothing to upgrade.
		"smtps://smtp.example.com:465": false,
	} {
		sender, err := NewSMTPSender(url, outboundFrom)
		if err != nil {
			t.Fatalf("NewSMTPSender(%q): %v", url, err)
		}
		if got := sender.(*smtpSender).requireSTARTTLS; got != want {
			t.Errorf("%q: requireSTARTTLS = %v, want %v", url, got, want)
		}
	}
}

// A server that offers no STARTTLS while the requirement is in force is
// refused, and nothing is handed to it. The requirement is set directly here
// because a test cannot dial a genuinely remote host — the policy that decides
// it is covered by the table above.
func TestSMTPSender_RefusesAServerThatOffersNoSTARTTLS(t *testing.T) {
	backend := &recorder{}
	addr := startServer(t, backend, nil)

	sender, err := NewSMTPSender("smtp://"+addr, outboundFrom)
	if err != nil {
		t.Fatalf("NewSMTPSender: %v", err)
	}
	sender.(*smtpSender).requireSTARTTLS = true

	if err := sender.Send(t.Context(), testMessage()); err == nil {
		t.Fatal("expected a send to a server without STARTTLS to fail")
	}
	if len(backend.deliveries) != 0 {
		t.Errorf("server received %d messages, want 0", len(backend.deliveries))
	}
}

// A loopback relay (the Mailpit or Postfix sidecar a deployment usually puts
// next to the app) may be spoken to in the clear: the traffic never leaves the
// host.
func TestSMTPSender_AllowsALoopbackServerWithoutSTARTTLS(t *testing.T) {
	backend := &recorder{}
	addr := startServer(t, backend, nil)

	sender, err := NewSMTPSender("smtp://"+addr, outboundFrom)
	if err != nil {
		t.Fatalf("NewSMTPSender: %v", err)
	}
	if err := sender.Send(t.Context(), testMessage()); err != nil {
		t.Fatalf("Send: %v", err)
	}
	backend.received(t)
}

func TestSMTPSender_DeliversOverImplicitTLS(t *testing.T) {
	serverTLS := selfSigned(t)
	backend := &recorder{}
	addr := startTLSServer(t, backend, serverTLS)

	sender, err := NewSMTPSender("smtps://"+addr, outboundFrom, WithTLSConfig(clientTLS(serverTLS)))
	if err != nil {
		t.Fatalf("NewSMTPSender: %v", err)
	}
	if err := sender.Send(t.Context(), testMessage()); err != nil {
		t.Fatalf("Send: %v", err)
	}
	backend.received(t)
}

func TestSMTPSender_AuthenticatesWithTheURLUserinfo(t *testing.T) {
	serverTLS := selfSigned(t)
	backend := &recorder{username: "postmaster", password: "s3cret"}
	addr := startTLSServer(t, backend, serverTLS)

	sender, err := NewSMTPSender("smtps://postmaster:s3cret@"+addr, outboundFrom,
		WithTLSConfig(clientTLS(serverTLS)))
	if err != nil {
		t.Fatalf("NewSMTPSender: %v", err)
	}
	if err := sender.Send(t.Context(), testMessage()); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if !backend.authenticated {
		t.Error("expected the sender to authenticate with the userinfo credentials")
	}
	backend.received(t)
}

func TestSMTPSender_RejectsAnUnusableURL(t *testing.T) {
	for _, bad := range []string{"", "not-a-url", "https://smtp.example.com:587", "smtp://"} {
		if _, err := NewSMTPSender(bad, outboundFrom); err == nil {
			t.Errorf("expected SMTP_URL %q to be rejected", bad)
		}
	}
	if _, err := NewSMTPSender("smtp://127.0.0.1:1025", ""); err == nil {
		t.Error("expected an empty from address to be rejected")
	}
}

func TestSMTPSender_ReportsAServerItCannotReach(t *testing.T) {
	// Port 1 on the loopback: nothing listens there, and the dial fails fast.
	sender, err := NewSMTPSender("smtp://127.0.0.1:1", outboundFrom)
	if err != nil {
		t.Fatalf("NewSMTPSender: %v", err)
	}
	if err := sender.Send(t.Context(), testMessage()); err == nil {
		t.Fatal("expected a send to an unreachable server to fail")
	}
}

func TestSMTPSender_HonoursACancelledContext(t *testing.T) {
	backend := &recorder{}
	addr := startServer(t, backend, nil)

	sender, err := NewSMTPSender("smtp://"+addr+"?starttls=off", outboundFrom)
	if err != nil {
		t.Fatalf("NewSMTPSender: %v", err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()

	if err := sender.Send(ctx, testMessage()); err == nil {
		t.Fatal("expected a send with a cancelled context to fail")
	}
}

// subjectHeader pulls the raw Subject line out of a delivered message,
// unfolding any continuation lines so the decoder sees one value.
func subjectHeader(t *testing.T, data string) string {
	t.Helper()
	lines := strings.Split(data, "\r\n")
	for i, line := range lines {
		if !strings.HasPrefix(line, "Subject: ") {
			continue
		}
		value := strings.TrimPrefix(line, "Subject: ")
		for _, next := range lines[i+1:] {
			if !strings.HasPrefix(next, " ") && !strings.HasPrefix(next, "\t") {
				break
			}
			value += strings.TrimLeft(next, " \t")
		}
		return value
	}
	t.Fatalf("no Subject header in:\n%s", data)
	return ""
}
