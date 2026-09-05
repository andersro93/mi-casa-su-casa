package middleware_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/middleware"
	"github.com/andersro93/mi-casa-su-casa/server/internal/ratelimit"
)

// Ports test/integration/rate-limit.test.ts's HTTP behaviour: the sixth
// setup attempt inside the window is refused with 429 and a Retry-After, and
// a different client is unaffected.

// memoryStore is ratelimit.Store over a map; the counting itself is tested
// against Postgres in internal/ratelimit.
type memoryStore struct {
	counts map[string]int
	err    error
	keys   []string
}

func newMemoryStore() *memoryStore { return &memoryStore{counts: map[string]int{}} }

func (m *memoryStore) Hit(_ context.Context, key string, _ int) (int, error) {
	if m.err != nil {
		return 0, m.err
	}
	m.keys = append(m.keys, key)
	m.counts[key]++
	return m.counts[key], nil
}

func (m *memoryStore) Sweep(context.Context, time.Time) (int, error) { return 0, m.err }

// limited runs a request from ip through Session + RateLimit(Setup).
func limited(t *testing.T, deps middleware.Deps, ip string) *httptest.ResponseRecorder {
	t.Helper()
	handler := chain(
		middleware.Session(deps),
		middleware.RateLimit(deps, ratelimit.Setup),
	)(okHandler())

	request := httptest.NewRequest(http.MethodPost, "/api/setup/complete", nil)
	request.RemoteAddr = ip + ":41234"
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func limitDeps(store ratelimit.Store) middleware.Deps {
	return middleware.Deps{
		Auth:      &stubAuth{},
		RateLimit: store,
		IPDigest:  func(ip string) string { return "digest-" + ip },
		Now:       func() time.Time { return time.Unix(1_700_000_100, 0).UTC() },
	}
}

func TestRateLimitRefusesTheSixthSetupAttempt(t *testing.T) {
	deps := limitDeps(newMemoryStore())

	for attempt := 1; attempt <= ratelimit.Setup.Max; attempt++ {
		if recorder := limited(t, deps, "203.0.113.7"); recorder.Code != http.StatusOK {
			t.Fatalf("attempt %d = %d, want 200", attempt, recorder.Code)
		}
	}

	blocked := limited(t, deps, "203.0.113.7")
	if blocked.Code != http.StatusTooManyRequests {
		t.Fatalf("attempt %d = %d, want 429", ratelimit.Setup.Max+1, blocked.Code)
	}
	assertEnvelope(t, blocked, "Too many requests. Please try again later.")

	retryAfter, err := strconv.Atoi(blocked.Header().Get("Retry-After"))
	if err != nil {
		t.Fatalf("Retry-After = %q, want a number of seconds", blocked.Header().Get("Retry-After"))
	}
	if retryAfter < 1 || retryAfter > ratelimit.Setup.WindowSeconds {
		t.Fatalf("Retry-After = %d, want between 1 and %d", retryAfter, ratelimit.Setup.WindowSeconds)
	}
}

func TestRateLimitCountsEachClientSeparately(t *testing.T) {
	deps := limitDeps(newMemoryStore())

	for attempt := 0; attempt <= ratelimit.Setup.Max; attempt++ {
		limited(t, deps, "203.0.113.7")
	}

	if recorder := limited(t, deps, "203.0.113.8"); recorder.Code != http.StatusOK {
		t.Fatalf("a second client = %d, want 200", recorder.Code)
	}
}

func TestRateLimitKeysOnTheDigestNeverTheAddress(t *testing.T) {
	store := newMemoryStore()
	deps := limitDeps(store)

	limited(t, deps, "203.0.113.7")

	if len(store.keys) != 1 {
		t.Fatalf("the store saw %d keys, want 1", len(store.keys))
	}
	key := store.keys[0]
	if want := "app:setup:digest-203.0.113.7:"; len(key) <= len(want) || key[:len(want)] != want {
		t.Fatalf("key = %q, want it to start with %q", key, want)
	}
}

func TestRateLimitWorksWithoutTheSessionMiddlewareInFront(t *testing.T) {
	// /api/setup is unauthenticated, so the limiter must derive the client
	// key itself rather than depending on Session having run.
	deps := limitDeps(newMemoryStore())

	request := httptest.NewRequest(http.MethodPost, "/api/setup/complete", nil)
	request.RemoteAddr = "203.0.113.7:41234"
	recorder := httptest.NewRecorder()
	middleware.RateLimit(deps, ratelimit.Setup)(okHandler()).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
}

func TestRateLimitFailsClosedWhenTheStoreIsUnreachable(t *testing.T) {
	quietLog(t)
	store := newMemoryStore()
	store.err = errTest
	deps := limitDeps(store)

	recorder := limited(t, deps, "203.0.113.7")

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", recorder.Code)
	}
	assertEnvelope(t, recorder, "Internal error")
}
