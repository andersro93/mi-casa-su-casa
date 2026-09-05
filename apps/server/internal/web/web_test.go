package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

// wantHeaders is REF §A1 item 1's header list, CSP included byte-for-byte.
var wantHeaders = map[string]string{
	"Content-Security-Policy":   "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests",
	"Strict-Transport-Security": "max-age=63072000; includeSubDomains",
	"X-Frame-Options":           "DENY",
	"Referrer-Policy":           "no-referrer",
	"X-Content-Type-Options":    "nosniff",
	"Permissions-Policy":        "camera=(), microphone=(), geolocation=(), payment=()",
}

func assertSecurityHeaders(t *testing.T, h http.Header) {
	t.Helper()
	for name, want := range wantHeaders {
		if got := h.Get(name); got != want {
			t.Errorf("header %s = %q, want %q", name, got, want)
		}
	}
}

// failingAPI fails the test if it is reached: every case below that uses it
// asserts a path the SPA layer must answer on its own.
func failingAPI(t *testing.T) http.Handler {
	t.Helper()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("api handler was called for %s, which the web layer owns", r.URL.Path)
		w.WriteHeader(http.StatusTeapot)
	})
}

func do(t *testing.T, h http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

// The document root and every client-side route serve the same index.html,
// with the security headers on both: the router decides what /casa/inbox
// means, and a reload of a deep link must not 404.
func TestSPARoutesServeIndexWithSecurityHeaders(t *testing.T) {
	for _, path := range []string{"/", "/casa/inbox"} {
		t.Run(path, func(t *testing.T) {
			rec := do(t, Handler(failingAPI(t)), path)

			if rec.Code != http.StatusOK {
				t.Fatalf("GET %s status = %d, want 200", path, rec.Code)
			}
			assertSecurityHeaders(t, rec.Header())
			if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
				t.Errorf("Content-Type = %q, want a text/html prefix", ct)
			}
			if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
				t.Errorf("Cache-Control = %q, want no-cache for index.html", cc)
			}
			if !strings.Contains(rec.Body.String(), "Mi Casa Su Casa") {
				t.Errorf("body does not look like index.html: %q", rec.Body.String())
			}
		})
	}
}

// The probes and the API belong to package api and are handed over
// untouched — a CSP on a JSON response buys nothing, and the probes were
// mounted ahead of the header middleware in the TypeScript app too.
func TestProbesAndAPIPathsGoToTheAPIHandlerUntouched(t *testing.T) {
	for _, path := range []string{"/healthz", "/readyz", "/api/anything"} {
		t.Run(path, func(t *testing.T) {
			called := false
			api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				w.WriteHeader(http.StatusOK)
			})

			rec := do(t, Handler(api), path)

			if !called {
				t.Fatalf("GET %s did not reach the api handler", path)
			}
			if got := rec.Header().Get("Content-Security-Policy"); got != "" {
				t.Errorf("CSP set on %s = %q, want none", path, got)
			}
		})
	}
}

// A self-hosted household inbox has no business in a search index.
func TestRobotsTxtDisallowsEverything(t *testing.T) {
	rec := do(t, Handler(failingAPI(t)), "/robots.txt")

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /robots.txt status = %d, want 200", rec.Code)
	}
	assertSecurityHeaders(t, rec.Header())
	if want := "User-agent: *\nDisallow: /\n"; rec.Body.String() != want {
		t.Errorf("robots.txt = %q, want %q", rec.Body.String(), want)
	}
}

// Cache-Control is the difference between a deploy users see immediately
// and one they see after a hard refresh. Hashed assets are immutable by
// construction; the three unhashed entry points must always be revalidated.
func TestCacheControlPerAssetKind(t *testing.T) {
	assets := fstest.MapFS{
		"index.html":              {Data: []byte("<!doctype html><title>Mi Casa Su Casa</title>")},
		"sw.js":                   {Data: []byte("// service worker")},
		"manifest.webmanifest":    {Data: []byte(`{"name":"Mi Casa Su Casa"}`)},
		"assets/app-a1b2c3d4.js":  {Data: []byte("console.log(1)")},
		"assets/app-a1b2c3d4.css": {Data: []byte("body{}")},
	}
	handler := handlerFor(assets, failingAPI(t))

	tests := []struct {
		path string
		want string
	}{
		{"/assets/app-a1b2c3d4.js", "public, max-age=31536000, immutable"},
		{"/assets/app-a1b2c3d4.css", "public, max-age=31536000, immutable"},
		{"/index.html", "no-cache"},
		{"/sw.js", "no-cache"},
		{"/manifest.webmanifest", "no-cache"},
		{"/", "no-cache"},
		{"/casa/inbox", "no-cache"},
	}

	for _, tc := range tests {
		t.Run(tc.path, func(t *testing.T) {
			rec := do(t, handler, tc.path)

			if rec.Code != http.StatusOK {
				t.Fatalf("GET %s status = %d, want 200", tc.path, rec.Code)
			}
			if got := rec.Header().Get("Cache-Control"); got != tc.want {
				t.Errorf("Cache-Control = %q, want %q", got, tc.want)
			}
			assertSecurityHeaders(t, rec.Header())
		})
	}
}
