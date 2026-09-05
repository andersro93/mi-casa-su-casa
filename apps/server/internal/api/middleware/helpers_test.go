package middleware_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andersro93/mi-casa-su-casa/server/internal/auth"
	applog "github.com/andersro93/mi-casa-su-casa/server/internal/log"
)

// quietLog swallows the log lines a test provokes on purpose, so a passing
// run prints nothing but the test framework's own output.
func quietLog(t *testing.T) {
	t.Helper()
	applog.SetOutput(io.Discard)
	t.Cleanup(func() { applog.SetOutput(nil) })
}

// errTest stands in for "the database is on fire" wherever a collaborator
// is made to fail.
var errTest = errors.New("middleware_test: the collaborator failed")

// okHandler is the thing every middleware under test wraps: it answers 200
// and records nothing, so a test that sees 200 knows the middleware called
// next and a test that sees anything else knows it did not.
func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

// assertEnvelope checks the response is this project's failure shape with
// exactly the expected message — the SPA branches on these strings, so a
// reworded rejection is a breaking change.
func assertEnvelope(t *testing.T, recorder *httptest.ResponseRecorder, message string) {
	t.Helper()
	if got := recorder.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q", got)
	}
	var body struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("body %q is not JSON: %v", recorder.Body.String(), err)
	}
	if body.Error != message {
		t.Fatalf("error = %q, want %q", body.Error, message)
	}
}

// stubAuth is an auth.Service that answers SessionFromRequest from fixed
// values and panics on everything else: no middleware in this package calls
// anything but the session lookup, and a panic makes it obvious if one
// starts to.
type stubAuth struct {
	session *auth.Session
	err     error
	calls   int
}

var _ auth.Service = (*stubAuth)(nil)

func (s *stubAuth) SessionFromRequest(*http.Request) (*auth.Session, error) {
	s.calls++
	return s.session, s.err
}

func (s *stubAuth) Handler() http.Handler { panic("middleware must not mount the auth handler") }

func (s *stubAuth) CreateUser(context.Context, string, string, string) (string, error) {
	panic("middleware must not create users")
}

func (s *stubAuth) SignIn(context.Context, http.ResponseWriter, *http.Request, string) error {
	panic("middleware must not sign users in")
}

func (s *stubAuth) RevokeAllSessions(context.Context, string) error {
	panic("middleware must not revoke sessions")
}

func (s *stubAuth) RevokeSession(context.Context, string) error {
	panic("middleware must not revoke sessions")
}

func (s *stubAuth) DeleteUser(context.Context, string) error {
	panic("middleware must not delete users")
}

func (s *stubAuth) IPDigest() func(string) string {
	panic("middleware reads Deps.IPDigest, not the service's")
}

// chain applies middlewares left to right, so chain(a, b)(h) runs a, then b,
// then h — the order they are written in the composition root.
func chain(middlewares ...func(http.Handler) http.Handler) func(http.Handler) http.Handler {
	return func(final http.Handler) http.Handler {
		for i := len(middlewares) - 1; i >= 0; i-- {
			final = middlewares[i](final)
		}
		return final
	}
}
