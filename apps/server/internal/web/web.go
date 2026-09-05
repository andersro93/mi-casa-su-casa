// Package web serves the embedded SPA build and the security headers that
// go with it. It is the outermost layer of the HTTP server: NewHandler in
// package api builds the /api/* handler, and web.Handler wraps it — every
// request lands here first.
//
// See docs/superpowers/plans/2026-09-04-go-migration-reference.md §A1 item 1
// for the exact header set and CSP string this file implements
// byte-for-byte.
package web

import (
	"embed"
	"fmt"
	"io/fs"
	"net/http"
	"strings"
)

// distFS embeds the built SPA. dist/index.html is a placeholder committed
// so the package builds before the real frontend does; the image build
// overwrites the whole directory with the real Vite output before
// `go build` runs there.
//
//go:embed all:dist
var distFS embed.FS

// csp is REF §A1's Content-Security-Policy value, reproduced byte-exact.
// `img-src` allows https: because provider emails embed remote logos, and
// `font-src data:` because the SPA inlines its icon font.
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests"

// robotsBody is served at GET /robots.txt: a household's mail inbox has no
// business in a search index, in any environment this binary runs in.
const robotsBody = "User-agent: *\nDisallow: /\n"

// immutableCacheControl is for Vite's content-hashed output under /assets/:
// the filename changes whenever the bytes do, so the old URL can be cached
// for a year without ever going stale.
const immutableCacheControl = "public, max-age=31536000, immutable"

// revalidateCacheControl is for everything else — index.html, sw.js and
// manifest.webmanifest above all, whose names are reused by every build.
// `no-cache` permits caching but forces revalidation, which is what makes a
// deploy visible on the next navigation instead of after a hard refresh:
// index.html names the hashed bundles, and a stale copy of it pins users to
// the previous release indefinitely.
const revalidateCacheControl = "no-cache"

// securityHeaders sets REF §A1 item 1's header set on a non-API response.
// Called before any body is written, on every branch below (assets, robots
// and the SPA fallback alike) — the set does not vary by which one a
// request happens to hit.
func securityHeaders(h http.Header) {
	h.Set("Content-Security-Policy", csp)
	h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
}

// probePaths are the two health endpoints package api registers outside the
// /api/ namespace. They need an exact-match escape hatch here because this
// handler otherwise dispatches to the API by /api/ prefix alone — without
// it both probes fall through to the SPA fallback and answer 200 text/html,
// giving a liveness probe that passes unconditionally and a readiness probe
// with no connection to the database whatsoever. It is a silent failure:
// `curl -o /dev/null -w '%{http_code}'` reports 200 either way.
//
// A path set rather than a second implementation of the probes: package api
// stays the single source of truth for what they actually do.
var probePaths = map[string]bool{
	"/healthz": true,
	"/readyz":  true,
}

// Handler wraps apiHandler with static asset serving, the SPA fallback and
// REF §A1's headers on everything that is not an API path.
func Handler(apiHandler http.Handler) http.Handler {
	assets, err := fs.Sub(distFS, "dist")
	if err != nil {
		// distFS is compiled in; a broken subtree means the embed directive
		// itself is wrong, which the build should have caught. Panicking
		// here beats serving 500s for every request with no explanation.
		panic(fmt.Sprintf("web: dist embed is broken: %v", err))
	}
	return handlerFor(assets, apiHandler)
}

// handlerFor is Handler's body over any asset tree, which is what lets the
// tests exercise the cache-header rules against a synthetic build (hashed
// bundles included) without committing fake assets next to the real
// placeholder.
//
// Requests under /api/, and the two top-level probes, are handed to
// apiHandler UNTOUCHED — no headers are added here (REF §A1: the probes
// were registered ahead of the header middleware in the TypeScript app and
// so never received them either). Package api owns whatever headers its own
// responses need.
func handlerFor(assets fs.FS, apiHandler http.Handler) http.Handler {
	assetServer := http.FileServer(http.FS(assets))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/api" || probePaths[r.URL.Path] {
			apiHandler.ServeHTTP(w, r)
			return
		}

		securityHeaders(w.Header())

		if r.Method == http.MethodGet && r.URL.Path == "/robots.txt" {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			_, _ = w.Write([]byte(robotsBody))
			return
		}

		if servedAsFile(assets, assetServer, w, r) {
			return
		}

		// SPA fallback: any path that is not a known asset serves
		// index.html at 200 — the client-side router decides what it means,
		// exactly like the edge deployment's asset-not-found path did.
		serveIndex(assets, w)
	})
}

// servedAsFile reports whether the request path names a real file in the
// asset tree (never a directory — index.html is served through the explicit
// SPA fallback below, not by letting http.FileServer redirect "/" to it)
// and, if so, serves it with the cache policy its name implies.
func servedAsFile(assets fs.FS, assetServer http.Handler, w http.ResponseWriter, r *http.Request) bool {
	name := strings.TrimPrefix(r.URL.Path, "/")
	// index.html goes through the SPA fallback below instead: net/http's
	// file server answers both "" (a directory) and "index.html" with a
	// redirect rather than the document, so letting it handle either turns
	// a page load into a 301 nobody asked for.
	if name == "" || name == "index.html" {
		return false
	}
	info, err := fs.Stat(assets, name)
	if err != nil || info.IsDir() {
		return false
	}
	w.Header().Set("Cache-Control", cacheControlFor(name))
	assetServer.ServeHTTP(w, r)
	return true
}

// cacheControlFor picks the caching policy from the asset's path alone.
// Everything under assets/ carries Vite's content hash in its filename;
// anything else is an unhashed name that a new build reuses.
func cacheControlFor(name string) string {
	if strings.HasPrefix(name, "assets/") {
		return immutableCacheControl
	}
	return revalidateCacheControl
}

func serveIndex(assets fs.FS, w http.ResponseWriter) {
	data, err := fs.ReadFile(assets, "index.html")
	if err != nil {
		// Only reachable if the asset tree is missing index.html entirely,
		// which the placeholder committed alongside this file prevents in
		// every build.
		http.Error(w, "index.html missing from embedded build", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", revalidateCacheControl)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}
