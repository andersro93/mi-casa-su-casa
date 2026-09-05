package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/middleware"
)

// Ports test/origin-policy.test.ts and the behavioural half of
// rejectCrossSiteMutations (src/server/security/origin.ts, REF §A1 item 3).

const appURL = "https://casa.example.com"

func TestAppOriginDerivesTheOriginFromAppURL(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"https://casa.example.com", "https://casa.example.com"},
		{"https://casa.example.com/", "https://casa.example.com"},
		{"https://casa.example.com/app/inbox", "https://casa.example.com"},
		{"http://localhost:8787", "http://localhost:8787"},
		// Default ports are dropped, as WHATWG URL's `origin` does.
		{"https://casa.example.com:443", "https://casa.example.com"},
		{"http://casa.example.com:80", "http://casa.example.com"},
		{"https://casa.example.com:8443", "https://casa.example.com:8443"},
		// Not a URL: the TypeScript returned null, we return "".
		{"nope", ""},
		{"", ""},
	} {
		if got := middleware.AppOrigin(tc.in); got != tc.want {
			t.Errorf("AppOrigin(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestAllowedOriginOnlyGrantsTheAppsOwnOrigin(t *testing.T) {
	for _, tc := range []struct{ origin, want string }{
		{"https://casa.example.com", "https://casa.example.com"},
		{"https://evil.example", ""},
		{"https://sub.casa.example.com", ""},
		{"http://localhost:5173", ""},
		{"", ""},
	} {
		if got := middleware.AllowedOrigin(appURL, false, tc.origin); got != tc.want {
			t.Errorf("AllowedOrigin(%q) = %q, want %q", tc.origin, got, tc.want)
		}
	}
}

func TestAllowedOriginAcceptsLocalhostOnlyInDevelopment(t *testing.T) {
	const devURL = "http://localhost:8787"

	for _, tc := range []struct{ origin, want string }{
		{"http://localhost:5173", "http://localhost:5173"},
		{"http://127.0.0.1:5173", "http://127.0.0.1:5173"},
		{"https://evil.example", ""},
		// Only http: an https localhost is not the dev server.
		{"https://localhost:5173", ""},
	} {
		if got := middleware.AllowedOrigin(devURL, true, tc.origin); got != tc.want {
			t.Errorf("dev AllowedOrigin(%q) = %q, want %q", tc.origin, got, tc.want)
		}
	}

	// The same origins in production are refused.
	if got := middleware.AllowedOrigin(appURL, false, "http://localhost:5173"); got != "" {
		t.Errorf("production AllowedOrigin(localhost) = %q, want %q", got, "")
	}
}

// sameSite runs one request through SameSite and reports the status and body.
func sameSite(t *testing.T, devMode bool, method string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, "https://casa.example.com/api/households", nil)
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	recorder := httptest.NewRecorder()
	middleware.SameSite(appURL, devMode)(okHandler()).ServeHTTP(recorder, request)
	return recorder
}

func TestSameSiteLetsSafeMethodsThroughWhateverTheOrigin(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodOptions} {
		recorder := sameSite(t, false, method, map[string]string{
			"Origin":         "https://evil.example",
			"Sec-Fetch-Site": "cross-site",
		})
		if recorder.Code != http.StatusOK {
			t.Errorf("%s = %d, want 200", method, recorder.Code)
		}
	}
}

func TestSameSitePassesRequestsThatCarryNoBrowserHeaders(t *testing.T) {
	// curl, a health prober, a server-to-server call: not browser-initiated
	// and therefore not a CSRF vector.
	if recorder := sameSite(t, false, http.MethodPost, nil); recorder.Code != http.StatusOK {
		t.Fatalf("headerless POST = %d, want 200", recorder.Code)
	}
}

func TestSameSiteAcceptsTheAppsOwnOrigin(t *testing.T) {
	recorder := sameSite(t, false, http.MethodPost, map[string]string{
		"Origin":         appURL,
		"Sec-Fetch-Site": "same-origin",
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("same-origin POST = %d, want 200", recorder.Code)
	}
}

func TestSameSiteRejectsAForeignOrigin(t *testing.T) {
	recorder := sameSite(t, false, http.MethodPost, map[string]string{"Origin": "https://evil.example"})
	assertRejected(t, recorder)
}

func TestSameSiteRejectsASiblingSubdomain(t *testing.T) {
	recorder := sameSite(t, false, http.MethodPost, map[string]string{
		"Origin":         "https://sub.casa.example.com",
		"Sec-Fetch-Site": "same-site",
	})
	assertRejected(t, recorder)
}

func TestSameSiteAcceptsSecFetchSiteNoneAndSameOrigin(t *testing.T) {
	for _, value := range []string{"same-origin", "none"} {
		recorder := sameSite(t, false, http.MethodPost, map[string]string{"Sec-Fetch-Site": value})
		if recorder.Code != http.StatusOK {
			t.Errorf("Sec-Fetch-Site: %s = %d, want 200", value, recorder.Code)
		}
	}
}

func TestSameSiteRejectsCrossSiteWithoutAMatchingOrigin(t *testing.T) {
	assertRejected(t, sameSite(t, false, http.MethodPost, map[string]string{"Sec-Fetch-Site": "cross-site"}))
	assertRejected(t, sameSite(t, false, http.MethodPost, map[string]string{
		"Sec-Fetch-Site": "cross-site",
		"Origin":         "https://evil.example",
	}))
}

func TestSameSiteAllowsCrossSiteWhenTheOriginMatchesExactly(t *testing.T) {
	// REF §A1 item 3: a dev server on another localhost port sends
	// Sec-Fetch-Site: cross-site with an Origin the policy accepts.
	recorder := sameSite(t, false, http.MethodPost, map[string]string{
		"Sec-Fetch-Site": "cross-site",
		"Origin":         appURL,
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("cross-site with a matching Origin = %d, want 200", recorder.Code)
	}
}

func TestSameSiteChecksTheRefererOnlyWhenThereIsNoOrigin(t *testing.T) {
	if recorder := sameSite(t, false, http.MethodPost, map[string]string{
		"Referer": appURL + "/app/inbox",
	}); recorder.Code != http.StatusOK {
		t.Errorf("same-origin Referer = %d, want 200", recorder.Code)
	}

	assertRejected(t, sameSite(t, false, http.MethodPost, map[string]string{
		"Referer": "https://evil.example/attack",
	}))

	// A Referer that is not a URL cannot be shown to be same-origin.
	assertRejected(t, sameSite(t, false, http.MethodPost, map[string]string{"Referer": "not a url"}))

	// A foreign Referer is ignored when the Origin is present and allowed:
	// the Origin is the stronger signal and the browser sends both.
	if recorder := sameSite(t, false, http.MethodPost, map[string]string{
		"Origin":  appURL,
		"Referer": "https://evil.example/attack",
	}); recorder.Code != http.StatusOK {
		t.Errorf("allowed Origin with a foreign Referer = %d, want 200", recorder.Code)
	}
}

func TestSameSiteAllowsLocalhostOriginsOnlyInDevelopment(t *testing.T) {
	if recorder := sameSite(t, true, http.MethodPost, map[string]string{
		"Origin": "http://localhost:5173",
	}); recorder.Code != http.StatusOK {
		t.Errorf("development localhost POST = %d, want 200", recorder.Code)
	}

	assertRejected(t, sameSite(t, false, http.MethodPost, map[string]string{
		"Origin": "http://localhost:5173",
	}))
}

func TestSameSiteRejectsAnOpaqueOrigin(t *testing.T) {
	// A sandboxed iframe or a redirected form posts Origin: null.
	assertRejected(t, sameSite(t, false, http.MethodPost, map[string]string{"Origin": "null"}))
}

func TestSameSiteRejectsEveryOriginWhenAppURLIsNotAURL(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "https://casa.example.com/api/households", nil)
	request.Header.Set("Origin", "https://casa.example.com")
	recorder := httptest.NewRecorder()
	middleware.SameSite("nope", false)(okHandler()).ServeHTTP(recorder, request)
	assertRejected(t, recorder)
}

func assertRejected(t *testing.T, recorder *httptest.ResponseRecorder) {
	t.Helper()
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", recorder.Code)
	}
	assertEnvelope(t, recorder, "Cross-site request rejected")
}
