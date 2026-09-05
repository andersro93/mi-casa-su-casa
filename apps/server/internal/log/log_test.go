package log_test

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	applog "github.com/andersro93/mi-casa-su-casa/server/internal/log"
)

// captured redirects the package's output for the duration of one test and
// hands back what was written.
func captured(t *testing.T) *bytes.Buffer {
	t.Helper()
	buffer := &bytes.Buffer{}
	applog.SetOutput(buffer)
	t.Cleanup(func() { applog.SetOutput(nil) })
	return buffer
}

func TestEventWritesOneJSONLineWithEventAndLevelFirst(t *testing.T) {
	out := captured(t)

	applog.Event(applog.LevelWarn, "api_request_failed", map[string]any{
		"method":     "GET",
		"path":       "/api/does-not-exist",
		"status":     404,
		"durationMs": 3,
		"requestId":  "abc123",
	})

	line := strings.TrimRight(out.String(), "\n")
	if strings.Contains(line, "\n") {
		t.Fatalf("Event wrote more than one line: %q", out.String())
	}
	if !strings.HasPrefix(line, `{"event":"api_request_failed","level":"warn",`) {
		t.Fatalf("line does not lead with event and level: %q", line)
	}

	var got map[string]any
	if err := json.Unmarshal([]byte(line), &got); err != nil {
		t.Fatalf("Event wrote invalid JSON %q: %v", line, err)
	}
	for key, want := range map[string]any{
		"event":      "api_request_failed",
		"level":      "warn",
		"method":     "GET",
		"path":       "/api/does-not-exist",
		"status":     float64(404),
		"durationMs": float64(3),
		"requestId":  "abc123",
	} {
		if got[key] != want {
			t.Errorf("field %q = %#v, want %#v", key, got[key], want)
		}
	}
	// slog's own framing must not leak into the line: the log catalogue in
	// REF §A7 is {"event","level",...fields} and nothing else.
	for _, key := range []string{"time", "msg", "source"} {
		if _, present := got[key]; present {
			t.Errorf("line carries slog's %q key: %q", key, line)
		}
	}
}

func TestEventAcceptsNoFields(t *testing.T) {
	out := captured(t)

	applog.Event(applog.LevelInfo, "retention_completed", nil)

	if got, want := strings.TrimRight(out.String(), "\n"), `{"event":"retention_completed","level":"info"}`; got != want {
		t.Fatalf("Event = %q, want %q", got, want)
	}
}

func TestEventLevelsAreTheThreeInTheCatalogue(t *testing.T) {
	for _, level := range []string{applog.LevelInfo, applog.LevelWarn, applog.LevelError} {
		out := captured(t)
		applog.Event(level, "unhandled_error", nil)
		var got map[string]any
		if err := json.Unmarshal(out.Bytes(), &got); err != nil {
			t.Fatalf("level %q: invalid JSON: %v", level, err)
		}
		if got["level"] != level {
			t.Errorf("level %q logged as %#v", level, got["level"])
		}
	}
}

func TestEventFallsBackToInfoForAnUnknownLevel(t *testing.T) {
	out := captured(t)

	applog.Event("chatty", "email_stored", nil)

	var got map[string]any
	if err := json.Unmarshal(out.Bytes(), &got); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if got["level"] != applog.LevelInfo {
		t.Fatalf("unknown level logged as %#v, want %q", got["level"], applog.LevelInfo)
	}
}

func TestEventOrdersFieldsDeterministically(t *testing.T) {
	out := captured(t)

	applog.Event(applog.LevelError, "setup_failed", map[string]any{
		"zebra": 1,
		"alpha": 2,
		"mango": 3,
	})

	line := strings.TrimRight(out.String(), "\n")
	if want := `{"event":"setup_failed","level":"error","alpha":2,"mango":3,"zebra":1}`; line != want {
		t.Fatalf("Event = %q, want %q", line, want)
	}
}
