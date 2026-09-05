package middleware

import (
	"context"
	"net/http"
)

// httpPair is the raw (ResponseWriter, Request) CaptureHTTP stashes.
type httpPair struct {
	w http.ResponseWriter
	r *http.Request
}

// CaptureHTTP puts the request's ResponseWriter and *http.Request into its
// context, so a generated strict-server handler — which is handed only a
// context and a decoded request object — can reach them again.
//
// It exists for exactly one thing: writing a SESSION COOKIE. First-run setup
// and invitation acceptance both create an account and hand the browser a
// signed-in state in the same response (REF §A2: "with the session cookie
// set"), and auth.Service.SignIn does that the only way it can be done — by
// setting a cookie on the response, reading the incoming request for the
// address digest and user agent the new session records. That signature is
// package auth's, not this package's, and hand-routing those two endpoints
// outside the generated tree would keep two ordinary JSON routes out of the
// spec that is this server's routing table. One context value is the cheaper
// trade.
//
// It is mounted on every tier that has such an operation (see internal/api's
// authChain). Do NOT reach for it to write a response BODY: the generated
// dispatcher writes the response, and a handler that also wrote to w would
// produce two.
func CaptureHTTP() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), httpKey, httpPair{w: w, r: r})))
		})
	}
}

// HTTPFromContext returns the ResponseWriter and Request CaptureHTTP stashed.
// ok is false when the operation's tier does not mount CaptureHTTP, which is a
// wiring mistake rather than a runtime condition — a caller that needs the
// pair should fail loudly rather than quietly skip whatever it wanted it for.
func HTTPFromContext(ctx context.Context) (w http.ResponseWriter, r *http.Request, ok bool) {
	pair, ok := ctx.Value(httpKey).(httpPair)
	if !ok {
		return nil, nil, false
	}
	return pair.w, pair.r, true
}
