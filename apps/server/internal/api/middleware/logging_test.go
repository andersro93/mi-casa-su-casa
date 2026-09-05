package middleware_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/middleware"
	applog "github.com/andersro93/mi-casa-su-casa/server/internal/log"
)

// Ports test/integration/request-logging.test.ts and logFailedApiRequests
// (src/server/runtime/log.ts, REF §A1 item 4).

// logged runs one request through LogFailures and returns the lines written.
func logged(t *testing.T, status int, request *http.Request) []map[string]any {
	t.Helper()
	buffer := &bytes.Buffer{}
	applog.SetOutput(buffer)
	t.Cleanup(func() { applog.SetOutput(nil) })

	handler := middleware.LogFailures()(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
	}))
	handler.ServeHTTP(httptest.NewRecorder(), request)

	lines := make([]map[string]any, 0, 1)
	for _, raw := range strings.Split(strings.TrimSpace(buffer.String()), "\n") {
		if raw == "" {
			continue
		}
		var line map[string]any
		if err := json.Unmarshal([]byte(raw), &line); err != nil {
			t.Fatalf("log line %q is not JSON: %v", raw, err)
		}
		lines = append(lines, line)
	}
	return lines
}

func TestLogFailuresWritesOneLineForA404(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/does-not-exist", nil)
	request.Header.Set("X-Request-Id", "abc123-OSL")

	lines := logged(t, http.StatusNotFound, request)

	if len(lines) != 1 {
		t.Fatalf("wrote %d lines, want 1: %#v", len(lines), lines)
	}
	line := lines[0]
	for key, want := range map[string]any{
		"event":     "api_request_failed",
		"level":     "warn",
		"method":    "GET",
		"path":      "/api/does-not-exist",
		"status":    float64(404),
		"requestId": "abc123-OSL",
	} {
		if line[key] != want {
			t.Errorf("%s = %#v, want %#v", key, line[key], want)
		}
	}
	if _, present := line["durationMs"]; !present {
		t.Error("no durationMs in the line")
	}
	if duration, ok := line["durationMs"].(float64); !ok || duration < 0 {
		t.Errorf("durationMs = %#v, want a number of milliseconds", line["durationMs"])
	}
}

func TestLogFailuresIsSilentForASuccess(t *testing.T) {
	lines := logged(t, http.StatusOK, httptest.NewRequest(http.MethodGet, "/api/households", nil))

	if len(lines) != 0 {
		t.Fatalf("a 200 wrote %#v, want nothing", lines)
	}
}

func TestLogFailuresIsSilentForAHandlerThatNeverCallsWriteHeader(t *testing.T) {
	buffer := &bytes.Buffer{}
	applog.SetOutput(buffer)
	t.Cleanup(func() { applog.SetOutput(nil) })

	handler := middleware.LogFailures()(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("implicitly 200"))
	}))
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/households", nil))

	if buffer.Len() != 0 {
		t.Fatalf("an implicit 200 wrote %q, want nothing", buffer.String())
	}
}

func TestLogFailuresRaisesTheLevelForServerErrors(t *testing.T) {
	lines := logged(t, http.StatusInternalServerError, httptest.NewRequest(http.MethodPost, "/api/households", nil))

	if len(lines) != 1 {
		t.Fatalf("wrote %d lines, want 1", len(lines))
	}
	if lines[0]["level"] != "error" {
		t.Fatalf("level = %#v, want %q", lines[0]["level"], "error")
	}
	if lines[0]["method"] != "POST" {
		t.Fatalf("method = %#v, want %q", lines[0]["method"], "POST")
	}
}

func TestLogFailuresInventsARequestIdWhenTheClientSendsNone(t *testing.T) {
	first := logged(t, http.StatusBadRequest, httptest.NewRequest(http.MethodGet, "/api/households", nil))
	second := logged(t, http.StatusBadRequest, httptest.NewRequest(http.MethodGet, "/api/households", nil))

	id, ok := first[0]["requestId"].(string)
	if !ok || id == "" {
		t.Fatalf("requestId = %#v, want a non-empty id", first[0]["requestId"])
	}
	if second[0]["requestId"] == id {
		t.Fatal("two requests were logged under the same invented id")
	}
}

func TestLogFailuresLogsThePathWithoutTheQueryString(t *testing.T) {
	// A query string can carry an invitation token; the log catalogue in
	// REF §A7 forbids logging secrets, so only the path is recorded.
	lines := logged(t, http.StatusNotFound, httptest.NewRequest(http.MethodGet, "/api/invitations/lookup?token=super-secret", nil))

	if lines[0]["path"] != "/api/invitations/lookup" {
		t.Fatalf("path = %#v, want the path without its query", lines[0]["path"])
	}
	if strings.Contains(strings.Join(keysAndValues(lines[0]), " "), "super-secret") {
		t.Fatalf("the token reached the log: %#v", lines[0])
	}
}

func keysAndValues(line map[string]any) []string {
	out := make([]string, 0, len(line)*2)
	for key, value := range line {
		out = append(out, key)
		out = append(out, strings.TrimSpace(strings.Trim(stringify(value), `"`)))
	}
	return out
}

func stringify(value any) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}

func TestUnhandledErrorsShareTheRequestIdOfTheFailureLine(t *testing.T) {
	buffer := &bytes.Buffer{}
	applog.SetOutput(buffer)
	t.Cleanup(func() { applog.SetOutput(nil) })

	deps := sessionDeps(&stubAuth{err: errTest})
	handler := chain(middleware.LogFailures(), middleware.Session(deps))(okHandler())
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/settings/profile", nil))

	byEvent := map[string]map[string]any{}
	for _, raw := range strings.Split(strings.TrimSpace(buffer.String()), "\n") {
		var line map[string]any
		if err := json.Unmarshal([]byte(raw), &line); err != nil {
			t.Fatalf("log line %q is not JSON: %v", raw, err)
		}
		byEvent[line["event"].(string)] = line
	}

	failure, ok := byEvent["api_request_failed"]
	if !ok {
		t.Fatalf("no api_request_failed line in %q", buffer.String())
	}
	unhandled, ok := byEvent["unhandled_error"]
	if !ok {
		t.Fatalf("no unhandled_error line in %q", buffer.String())
	}
	if failure["requestId"] == nil || failure["requestId"] != unhandled["requestId"] {
		t.Fatalf("requestId %#v vs %#v: the two lines must correlate", failure["requestId"], unhandled["requestId"])
	}
	if unhandled["level"] != "error" || failure["level"] != "error" {
		t.Errorf("levels = %#v / %#v, want error for a 500", unhandled["level"], failure["level"])
	}
}
