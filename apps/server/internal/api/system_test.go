package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api"
	"github.com/andersro93/mi-casa-su-casa/server/internal/db"
	"github.com/andersro93/mi-casa-su-casa/server/internal/db/gen"
	"github.com/andersro93/mi-casa-su-casa/server/internal/testrig"
)

// fixedNow is the clock every readiness test pins, so "older than 48 hours"
// is decided by arithmetic rather than by how long the test suite took.
var fixedNow = time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)

// get runs one request against a freshly built handler and hands back the
// recorder, so each test reads as "ask for this path, assert on the answer".
func get(t *testing.T, deps api.Deps, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	api.NewHandler(deps).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

// decode reads a JSON body into a map, failing the test if it is not JSON —
// every response this package writes must be, including the errors.
func decode(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response body is not JSON (%v): %q", err, rec.Body.String())
	}
	return body
}

// Liveness must answer "the process is up" and nothing else. A nil pool is
// the strongest possible statement of that: if Healthz ever grew a query,
// this test would panic rather than quietly turn a Postgres outage into a
// restart loop.
func TestHealthzAnswersWithoutTouchingTheDatabase(t *testing.T) {
	rec := get(t, api.Deps{Now: func() time.Time { return fixedNow }}, "/healthz")

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /healthz status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q, want application/json; charset=utf-8", ct)
	}
	body := decode(t, rec)
	if body["ok"] != true {
		t.Errorf("body = %v, want ok true", body)
	}
	if len(body) != 1 {
		t.Errorf("body = %v, want exactly {\"ok\":true}", body)
	}
}

// Readiness on a database that has never run the retention job: ready (the
// query worked) but stale (nothing has been retained), which is exactly the
// state a fresh install is in.
func TestReadyzReportsStaleWhenNoRetentionRunRecorded(t *testing.T) {
	rig := testrig.Setup(t)
	deps := api.Deps{Pool: rig.Pool, Q: rig.Q, Now: func() time.Time { return fixedNow }}

	rec := get(t, deps, "/readyz")

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /readyz status = %d, want 200 (body %q)", rec.Code, rec.Body.String())
	}
	body := decode(t, rec)
	if body["ok"] != true || body["status"] != "ready" || body["setupConfigured"] != true {
		t.Errorf("body = %v, want ok/status ready/setupConfigured", body)
	}
	retention, ok := body["retention"].(map[string]any)
	if !ok {
		t.Fatalf("body has no retention object: %v", body)
	}
	if retention["lastRunAt"] != nil {
		t.Errorf("lastRunAt = %v, want null", retention["lastRunAt"])
	}
	if retention["stale"] != true {
		t.Errorf("stale = %v, want true when no run is recorded", retention["stale"])
	}
}

// The staleness window is the whole point of the field: a run inside 48
// hours means the cron is alive, one outside it means it has been silently
// failing. Both sides of the comparison come from the pinned clock.
func TestReadyzRetentionStaleness(t *testing.T) {
	tests := []struct {
		name      string
		ranAt     time.Time
		wantStale bool
	}{
		{"a run an hour ago is fresh", fixedNow.Add(-time.Hour), false},
		{"a run just inside 48 hours is fresh", fixedNow.Add(-47 * time.Hour), false},
		{"a run older than 48 hours is stale", fixedNow.Add(-49 * time.Hour), true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rig := testrig.Setup(t)
			if err := rig.Q.RecordRetentionRun(context.Background(),
				pgtype.Timestamptz{Time: tc.ranAt, Valid: true}); err != nil {
				t.Fatalf("record retention run: %v", err)
			}
			deps := api.Deps{Pool: rig.Pool, Q: rig.Q, Now: func() time.Time { return fixedNow }}

			rec := get(t, deps, "/readyz")

			if rec.Code != http.StatusOK {
				t.Fatalf("GET /readyz status = %d, want 200 (body %q)", rec.Code, rec.Body.String())
			}
			retention := decode(t, rec)["retention"].(map[string]any)
			if retention["stale"] != tc.wantStale {
				t.Errorf("stale = %v, want %v", retention["stale"], tc.wantStale)
			}
			lastRunAt, ok := retention["lastRunAt"].(string)
			if !ok {
				t.Fatalf("lastRunAt = %v, want an RFC3339 string", retention["lastRunAt"])
			}
			got, err := time.Parse(time.RFC3339, lastRunAt)
			if err != nil {
				t.Fatalf("lastRunAt %q is not RFC3339: %v", lastRunAt, err)
			}
			if !got.Equal(tc.ranAt) {
				t.Errorf("lastRunAt = %s, want %s", got, tc.ranAt)
			}
		})
	}
}

// An unreachable database is a 503 with a reason, not a 500 and not a
// panic: readiness exists precisely to say "do not route traffic here yet".
func TestReadyzIsUnavailableWhenTheDatabaseIsUnreachable(t *testing.T) {
	// A pool this test owns outright, so closing it to simulate the outage
	// cannot interfere with the rig's own cleanup.
	pool, err := db.New(context.Background(), testrig.DatabaseURL())
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	deps := api.Deps{Pool: pool, Q: gen.New(pool), Now: func() time.Time { return fixedNow }}
	pool.Close()

	rec := get(t, deps, "/readyz")

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("GET /readyz status = %d, want 503 (body %q)", rec.Code, rec.Body.String())
	}
	body := decode(t, rec)
	if body["ok"] != false {
		t.Errorf("ok = %v, want false", body["ok"])
	}
	if msg, _ := body["error"].(string); msg == "" {
		t.Errorf("body = %v, want a non-empty error", body)
	}
}

// An unmatched /api/ path must be a JSON 404 from the API, never the SPA's
// index.html: an XHR that gets HTML back fails with a parse error three
// layers away from the actual mistake.
func TestUnknownAPIPathIsAJSONNotFound(t *testing.T) {
	rec := get(t, api.Deps{Now: func() time.Time { return fixedNow }}, "/api/nope")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("GET /api/nope status = %d, want 404", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q, want application/json; charset=utf-8", ct)
	}
	if body := decode(t, rec); body["error"] != "Not found" {
		t.Errorf("body = %v, want {\"error\":\"Not found\"}", body)
	}
}
