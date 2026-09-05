package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"time"

	applog "github.com/andersro93/mi-casa-su-casa/server/internal/log"
)

// LogFailures writes one `api_request_failed` line per response with a
// status of 400 or above. Ported from logFailedApiRequests
// (src/server/runtime/log.ts, REF §A1 item 4).
//
// Successes are deliberately not logged: they are the overwhelming majority
// of requests, and request rate and latency belong on a metrics endpoint
// rather than in a log line per hit. What a log is for here is the failure
// somebody is about to ask about.
//
// The Workers deployment correlated lines by Cloudflare's ray id. Off
// Cloudflare there is no such header, so the id is the caller's
// X-Request-Id when it sent one — a reverse proxy or a load balancer
// usually does — and otherwise a random one, which at least ties this line
// to any other line the same request produces.
//
// Only the path is logged, never the query string: an invitation token
// travels in a query parameter, and REF §A7's rule is that secrets never
// reach the log.
func LogFailures() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			started := time.Now()
			recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

			// The id is minted before the request runs and put in the
			// context, so a line written deeper down (unhandled_error, say)
			// carries the same id as this one and the two can be read as one
			// story.
			id := newRequestID(r)
			r = r.WithContext(context.WithValue(r.Context(), requestIDKey, id))

			next.ServeHTTP(recorder, r)

			if recorder.status < http.StatusBadRequest {
				return
			}

			level := applog.LevelWarn
			if recorder.status >= http.StatusInternalServerError {
				level = applog.LevelError
			}
			applog.Event(level, "api_request_failed", map[string]any{
				"method":     r.Method,
				"path":       r.URL.Path,
				"status":     recorder.status,
				"durationMs": time.Since(started).Milliseconds(),
				"requestId":  id,
			})
		})
	}
}

// newRequestID is the caller's X-Request-Id, or a fresh random id when there
// is none. Random rather than sequential so two processes behind one load
// balancer cannot mint the same id.
func newRequestID(r *http.Request) string {
	if given := r.Header.Get("X-Request-Id"); given != "" {
		return given
	}
	var raw [8]byte
	// crypto/rand.Read never fails on any platform this runs on; Go 1.24
	// made it panic rather than return an error for exactly that reason.
	rand.Read(raw[:])
	return hex.EncodeToString(raw[:])
}

// statusRecorder remembers the status a handler wrote, which net/http
// otherwise gives no way to read back.
//
// It starts at 200 because a handler that writes a body without calling
// WriteHeader has implicitly sent one.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(status int) {
	s.status = status
	s.ResponseWriter.WriteHeader(status)
}

// Unwrap lets http.ResponseController reach the real writer, so wrapping a
// handler in this middleware does not cost it flushing or deadline control.
func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

// requestIDFrom is the id LogFailures minted for this request, or "" when it
// did not run (a unit test, or a handler mounted outside the chain).
func requestIDFrom(r *http.Request) string {
	id, _ := r.Context().Value(requestIDKey).(string)
	return id
}
