package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/middleware"
	"github.com/andersro93/mi-casa-su-casa/server/internal/auth"
)

// Ports the loadAuthSession / requireAuthenticatedUser half of
// src/server/auth/middleware.ts (REF §A1, "Auth guards").

func sessionDeps(service auth.Service) middleware.Deps {
	return middleware.Deps{Auth: service, IPDigest: func(ip string) string { return "digest(" + ip + ")" }}
}

func TestSessionPutsTheCallerInTheContext(t *testing.T) {
	service := &stubAuth{session: &auth.Session{UserID: "user-a", Email: "a@example.com", Name: "A"}}

	var seen *auth.Session
	handler := middleware.Session(sessionDeps(service))(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = middleware.UserFrom(r)
		w.WriteHeader(http.StatusOK)
	}))

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/settings/profile", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	if seen == nil || seen.UserID != "user-a" {
		t.Fatalf("UserFrom = %#v, want the stubbed session", seen)
	}
}

func TestSessionLeavesTheContextEmptyWhenNobodyIsSignedIn(t *testing.T) {
	var seen *auth.Session
	called := false
	handler := middleware.Session(sessionDeps(&stubAuth{}))(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		seen = middleware.UserFrom(r)
		w.WriteHeader(http.StatusOK)
	}))

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/settings/profile", nil))

	if !called {
		t.Fatal("Session refused an anonymous request; it must only load, never guard")
	}
	if seen != nil {
		t.Fatalf("UserFrom = %#v, want nil", seen)
	}
}

func TestSessionResolvesTheCallerExactlyOncePerRequest(t *testing.T) {
	service := &stubAuth{session: &auth.Session{UserID: "user-a"}}
	handler := middleware.Session(sessionDeps(service))(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = middleware.UserFrom(r)
		_ = middleware.UserFrom(r)
		w.WriteHeader(http.StatusOK)
	}))

	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/settings/profile", nil))

	if service.calls != 1 {
		t.Fatalf("SessionFromRequest called %d times, want 1", service.calls)
	}
}

func TestSessionAnswers500WhenTheLookupItselfFails(t *testing.T) {
	// A database outage is not a sign-out: rendering it as one would show
	// every signed-in user a login screen and lose their unsaved work.
	quietLog(t)
	service := &stubAuth{err: errTest}

	recorder := httptest.NewRecorder()
	middleware.Session(sessionDeps(service))(okHandler()).
		ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/settings/profile", nil))

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", recorder.Code)
	}
	assertEnvelope(t, recorder, "Internal error")
}

func TestSessionStoresTheClientKeyAsADigestNotAnAddress(t *testing.T) {
	deps := middleware.Deps{
		Auth:             &stubAuth{},
		IPDigest:         func(ip string) string { return "digest(" + ip + ")" },
		TrustedProxyHops: 1,
	}

	var key string
	handler := middleware.Session(deps)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key = middleware.ClientKey(r)
		w.WriteHeader(http.StatusOK)
	}))

	request := httptest.NewRequest(http.MethodGet, "/api/settings/profile", nil)
	request.RemoteAddr = "10.0.0.9:41234"
	request.Header.Set("X-Forwarded-For", "203.0.113.7, 10.0.0.1")
	handler.ServeHTTP(httptest.NewRecorder(), request)

	if want := "digest(10.0.0.1)"; key != want {
		t.Fatalf("ClientKey = %q, want %q", key, want)
	}
}

func TestRequireSessionRejectsAnAnonymousCaller(t *testing.T) {
	recorder := httptest.NewRecorder()
	chain(middleware.Session(sessionDeps(&stubAuth{})), middleware.RequireSession())(okHandler()).
		ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/settings/profile", nil))

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", recorder.Code)
	}
	assertEnvelope(t, recorder, "Unauthorized")
}

func TestRequireSessionLetsASignedInCallerThrough(t *testing.T) {
	service := &stubAuth{session: &auth.Session{UserID: "user-a"}}

	recorder := httptest.NewRecorder()
	chain(middleware.Session(sessionDeps(service)), middleware.RequireSession())(okHandler()).
		ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/settings/profile", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
}
