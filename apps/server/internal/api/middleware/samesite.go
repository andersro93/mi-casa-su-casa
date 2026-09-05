package middleware

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/respond"
)

// safeMethods are the methods that cannot change state, and so cannot be
// the target of a cross-site forgery.
var safeMethods = map[string]bool{
	http.MethodGet:     true,
	http.MethodHead:    true,
	http.MethodOptions: true,
}

// SameSite is the cross-site request forgery guard for cookie-authenticated
// mutations, ported verbatim from rejectCrossSiteMutations in
// src/server/security/origin.ts (REF §A1 item 3).
//
// The reasoning, unchanged: browsers always send Sec-Fetch-Site and, for
// non-GET requests, Origin. A request carrying either header with a foreign
// value is rejected. A request carrying none of them (curl, a test, a
// server-to-server call) is not browser-initiated and therefore not a CSRF
// vector, so it passes — the session cookie is SameSite=Lax on top of this,
// and this guard is the belt to that pair of braces.
//
// devMode is ENVIRONMENT=development, and only that: it widens the accepted
// origins to any http://localhost or http://127.0.0.1 port so the Vite dev
// server can talk to a local API. It is deliberately not "development or
// test" — a test environment reachable from a browser would otherwise
// accept a forged request from any localhost page.
func SameSite(appURL string, devMode bool) func(http.Handler) http.Handler {
	allowed := AppOrigin(appURL)

	// originAllowed is the TypeScript's local closure of the same name:
	// corsOriginFor's answer, or an exact match against the app origin. The
	// second half is redundant with the first — corsOriginFor already
	// accepts an exact match — and is kept because dropping it would be a
	// change to a security check made for tidiness alone.
	originAllowed := func(candidate string) bool {
		return AllowedOrigin(appURL, devMode, candidate) != "" || (allowed != "" && candidate == allowed)
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if safeMethods[r.Method] {
				next.ServeHTTP(w, r)
				return
			}

			fetchSite := r.Header.Get("Sec-Fetch-Site")
			origin := r.Header.Get("Origin")
			referer := r.Header.Get("Referer")

			// Cross-site or a sibling subdomain: only allowed when Origin
			// matches exactly (a dev server on another localhost port, say).
			if fetchSite != "" && fetchSite != "same-origin" && fetchSite != "none" {
				if origin == "" || !originAllowed(origin) {
					rejectCrossSite(w)
					return
				}
			}

			if origin != "" && !originAllowed(origin) {
				rejectCrossSite(w)
				return
			}

			// Older browsers and some form posts send no Origin. The Referer
			// is weaker evidence — it can be stripped by a referrer policy —
			// but when it is present and foreign, the request is not ours.
			if origin == "" && referer != "" {
				refererOrigin := AppOrigin(referer)
				if refererOrigin == "" || !originAllowed(refererOrigin) {
					rejectCrossSite(w)
					return
				}
			}

			next.ServeHTTP(w, r)
		})
	}
}

func rejectCrossSite(w http.ResponseWriter) {
	respond.Error(w, http.StatusForbidden, "Cross-site request rejected")
}

// AppOrigin is the scheme + host + port a URL is served from — WHATWG URL's
// `origin`, which is what the TypeScript's `new URL(...).origin` produced.
// It returns "" where the TypeScript returned null: a value that is not an
// absolute http(s) URL has no origin to compare against.
//
// The default port is dropped (https://host:443 is https://host) so that two
// spellings of the same origin compare equal, exactly as the browser does
// when it fills in the Origin header.
func AppOrigin(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Hostname() == "" {
		return ""
	}

	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return ""
	}

	host := parsed.Host
	if port := parsed.Port(); (scheme == "http" && port == "80") || (scheme == "https" && port == "443") {
		host = parsed.Hostname()
	}
	return scheme + "://" + host
}

// AllowedOrigin decides whether a request Origin is one this app answers to,
// returning the origin itself when it is and "" when it is not. Ported from
// corsOriginFor.
//
// The Go server serves the SPA and the API from one origin and mounts no
// CORS middleware at all (REF §A1 item 2), so nothing writes an
// Access-Control-Allow-Origin header any more. The function survives as the
// single definition of "our origin", which SameSite is built on.
func AllowedOrigin(appURL string, devMode bool, origin string) string {
	if origin == "" {
		return ""
	}
	if origin == AppOrigin(appURL) {
		return origin
	}
	if devMode && isLocalDevOrigin(origin) {
		return origin
	}
	return ""
}

// isLocalDevOrigin recognises the Vite dev server: plain http on localhost
// or 127.0.0.1, any port. https is excluded — a local page served over TLS
// is not the dev server this allowance exists for.
func isLocalDevOrigin(origin string) bool {
	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}
	if !strings.EqualFold(parsed.Scheme, "http") {
		return false
	}
	host := parsed.Hostname()
	return host == "localhost" || host == "127.0.0.1"
}
