package mail_test

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"testing"
	"time"

	"github.com/andersro93/mi-casa-su-casa/server/internal/mail"
)

const signingKey = "e2e-signing-key"

var signedAt = time.Date(2026, time.May, 10, 12, 0, 0, 0, time.UTC)

// sign computes what Mailgun would put in the `signature` field (REF Part C).
func sign(t *testing.T, key, timestamp, token string) string {
	t.Helper()
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(timestamp + token))
	return hex.EncodeToString(mac.Sum(nil))
}

func stamp(at time.Time) string { return strconv.FormatInt(at.Unix(), 10) }

func TestVerifyMailgunSignature_AcceptsAFreshSignature(t *testing.T) {
	ts := stamp(signedAt)
	token := "token-1"

	if err := mail.VerifyMailgunSignature(signingKey, ts, token, sign(t, signingKey, ts, token), signedAt); err != nil {
		t.Fatalf("expected a valid signature to verify, got: %v", err)
	}
}

func TestVerifyMailgunSignature_RejectsAnotherKeysSignature(t *testing.T) {
	ts := stamp(signedAt)
	token := "token-1"

	err := mail.VerifyMailgunSignature(signingKey, ts, token, sign(t, "some-other-key", ts, token), signedAt)
	if err == nil {
		t.Fatal("expected a signature made with another key to be rejected")
	}
	if got := mail.RejectionReason(err); got != mail.ReasonSignature {
		t.Errorf("reason = %q, want %q", got, mail.ReasonSignature)
	}
}

func TestVerifyMailgunSignature_RejectsAGarbledSignature(t *testing.T) {
	ts := stamp(signedAt)

	for _, signature := range []string{"", "not-hex", sign(t, signingKey, ts, "token-1")[:32]} {
		if err := mail.VerifyMailgunSignature(signingKey, ts, "token-1", signature, signedAt); err == nil {
			t.Errorf("expected signature %q to be rejected", signature)
		}
	}
}

func TestVerifyMailgunSignature_RejectsTimestampsOutsideFiveMinutes(t *testing.T) {
	token := "token-1"

	for name, at := range map[string]time.Time{
		"six minutes old":      signedAt.Add(-6 * time.Minute),
		"six minutes in front": signedAt.Add(6 * time.Minute),
	} {
		t.Run(name, func(t *testing.T) {
			ts := stamp(at)
			err := mail.VerifyMailgunSignature(signingKey, ts, token, sign(t, signingKey, ts, token), signedAt)
			if err == nil {
				t.Fatal("expected a stale timestamp to be rejected")
			}
			if got := mail.RejectionReason(err); got != mail.ReasonStale {
				t.Errorf("reason = %q, want %q", got, mail.ReasonStale)
			}
		})
	}
}

func TestVerifyMailgunSignature_AcceptsTimestampsInsideFiveMinutes(t *testing.T) {
	token := "token-1"

	for name, at := range map[string]time.Time{
		"four minutes old":      signedAt.Add(-4 * time.Minute),
		"four minutes in front": signedAt.Add(4 * time.Minute),
	} {
		t.Run(name, func(t *testing.T) {
			ts := stamp(at)
			if err := mail.VerifyMailgunSignature(signingKey, ts, token, sign(t, signingKey, ts, token), signedAt); err != nil {
				t.Fatalf("expected a timestamp inside the window to verify, got: %v", err)
			}
		})
	}
}

func TestVerifyMailgunSignature_RejectsAMalformedTimestamp(t *testing.T) {
	for _, ts := range []string{"", "yesterday", "12.5", "1e9"} {
		err := mail.VerifyMailgunSignature(signingKey, ts, "token-1", sign(t, signingKey, ts, "token-1"), signedAt)
		if err == nil {
			t.Errorf("expected timestamp %q to be rejected", ts)
			continue
		}
		if got := mail.RejectionReason(err); got != mail.ReasonStale {
			t.Errorf("timestamp %q: reason = %q, want %q", ts, got, mail.ReasonStale)
		}
	}
}

func TestReplayGuard_SeesATokenOnlyOnce(t *testing.T) {
	guard := mail.NewReplayGuard()

	if guard.Seen("token-1", signedAt) {
		t.Fatal("a token nobody has presented before must not be seen")
	}
	if !guard.Seen("token-1", signedAt) {
		t.Fatal("a token presented twice must be seen the second time")
	}
	if guard.Seen("token-2", signedAt) {
		t.Fatal("a different token must not be seen")
	}
}

func TestReplayGuard_ForgetsTokensAfterTenMinutes(t *testing.T) {
	guard := mail.NewReplayGuard()

	guard.Seen("token-1", signedAt)
	if !guard.Seen("token-1", signedAt.Add(9*time.Minute)) {
		t.Fatal("a token inside the ten-minute window must still be seen")
	}
	if guard.Seen("token-1", signedAt.Add(11*time.Minute)) {
		t.Fatal("a token older than the window must have been forgotten")
	}
}

// The guard is a process-lifetime map fed by an internet-facing endpoint, so
// what actually matters is that expired entries leave it rather than that the
// lookup works.
func TestReplayGuard_PrunesExpiredEntries(t *testing.T) {
	guard := mail.NewReplayGuard()

	for i := range 100 {
		guard.Seen("token-"+strconv.Itoa(i), signedAt)
	}
	if got := guard.Len(); got != 100 {
		t.Fatalf("Len() = %d, want 100", got)
	}

	guard.Seen("late", signedAt.Add(11*time.Minute))
	if got := guard.Len(); got != 1 {
		t.Errorf("Len() after the window passed = %d, want 1 (only the late token)", got)
	}
}

func TestReplayGuard_IsSafeForConcurrentUse(t *testing.T) {
	guard := mail.NewReplayGuard()

	done := make(chan struct{})
	for i := range 8 {
		go func() {
			defer func() { done <- struct{}{} }()
			for j := range 100 {
				guard.Seen("token-"+strconv.Itoa(i)+"-"+strconv.Itoa(j), signedAt)
			}
		}()
	}
	for range 8 {
		<-done
	}
	if got := guard.Len(); got != 800 {
		t.Errorf("Len() = %d, want 800", got)
	}
}
