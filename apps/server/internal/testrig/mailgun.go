package testrig

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"mime/multipart"
	"strconv"
	"sync/atomic"
	"testing"
	"time"
)

// The inbound webhook's request builder: what Mailgun posts to
// /api/inbound/mailgun/mime (REF Part C), signed with the rig's key.
//
// It lives in testrig rather than in the handler's own test file because the
// end-to-end suite needs the same request — a signed multipart form is not
// something a test should be re-deriving, and a second implementation of the
// signature is a second thing that can be subtly wrong.

// MailgunSigningKey is the HTTP webhook signing key the rig configures on
// api.Deps, so a test can sign a request the handler will accept.
const MailgunSigningKey = "e2e-signing-key"

// MailgunInboundPath is where the webhook is mounted.
const MailgunInboundPath = "/api/inbound/mailgun/mime"

// tokenCounter makes every MailgunForm token unique, so two deliveries in one
// test are not mistaken for a replay of each other.
var tokenCounter atomic.Uint64

// MailgunForm builds a signed multipart body for one inbound message: raw is
// the RFC 5322 message Mailgun puts in `body-mime`, from and to are the SMTP
// envelope (`sender` and `recipient`), and now is the instant the request is
// signed at.
//
// The token is fresh on every call. Use MailgunFormWithToken to send the same
// one twice, which is what the replay guard's test needs.
func MailgunForm(key, raw, from, to string, now time.Time) (*bytes.Buffer, string) {
	token := fmt.Sprintf("token-%d", tokenCounter.Add(1))
	return MailgunFormWithToken(key, raw, from, to, now, token)
}

// MailgunFormWithToken is MailgunForm with the anti-replay token spelled out.
func MailgunFormWithToken(key, raw, from, to string, now time.Time, token string) (*bytes.Buffer, string) {
	timestamp := strconv.FormatInt(now.Unix(), 10)

	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(timestamp + token))

	body := &bytes.Buffer{}
	form := multipart.NewWriter(body)
	// Only the fields the handler reads. Mailgun posts several more (`from`,
	// `subject`, `message-headers`, attachments); the handler takes every one
	// of those from the raw message instead, so a fixture carrying them would
	// suggest they matter.
	for name, value := range map[string]string{
		"recipient": to,
		"sender":    from,
		"timestamp": timestamp,
		"token":     token,
		"signature": hex.EncodeToString(mac.Sum(nil)),
		"body-mime": raw,
	} {
		_ = form.WriteField(name, value)
	}
	_ = form.Close()

	return body, form.FormDataContentType()
}

// MailgunFormWithout builds a signed form with one field left out, for the
// tests that prove a missing field is rejected the way REF §A3 says.
func MailgunFormWithout(t *testing.T, key, raw, from, to string, now time.Time, omit string) (*bytes.Buffer, string) {
	t.Helper()

	timestamp := strconv.FormatInt(now.Unix(), 10)
	token := fmt.Sprintf("token-%d", tokenCounter.Add(1))

	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(timestamp + token))

	fields := map[string]string{
		"recipient": to,
		"sender":    from,
		"timestamp": timestamp,
		"token":     token,
		"signature": hex.EncodeToString(mac.Sum(nil)),
		"body-mime": raw,
	}
	if _, ok := fields[omit]; !ok {
		t.Fatalf("testrig: MailgunFormWithout: %q is not one of the form fields", omit)
	}
	delete(fields, omit)

	body := &bytes.Buffer{}
	form := multipart.NewWriter(body)
	for name, value := range fields {
		_ = form.WriteField(name, value)
	}
	_ = form.Close()

	return body, form.FormDataContentType()
}
