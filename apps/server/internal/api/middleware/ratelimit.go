package middleware

import (
	"net/http"
	"strconv"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/respond"
	"github.com/andersro93/mi-casa-su-casa/server/internal/ratelimit"
)

// RateLimit enforces one rule per client on the route it wraps. Ported from
// the rateLimit middleware in src/server/security/rate-limit.ts (REF §A1,
// "Rate limiting").
//
// It is mounted on the handful of endpoints that carry a secret — setup,
// invitation tokens, household creation — rather than on /api/* as a whole:
// a limiter on every route would either be too loose to slow a guessing
// attack or tight enough to break an ordinary session.
//
// The client key comes from the request context when Session has run and is
// derived here when it has not, because /api/setup and /api/invitations are
// reachable signed out and are precisely the routes that need the brake.
//
// A store that cannot be reached fails closed (500). Failing open would mean
// that the way to disable the limiter is to make the database unreachable,
// which is the state an attacker is most likely to be able to cause.
func RateLimit(d Deps, rule ratelimit.Rule) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			client := ClientKey(r)
			if client == "" {
				client = d.clientKey(r)
			}

			decision, err := ratelimit.Consume(r.Context(), d.RateLimit, rule, client, d.now())
			if err != nil {
				internalError(w, r, "rate limit "+rule.Name, err)
				return
			}

			if !decision.Allowed {
				w.Header().Set("Retry-After", strconv.Itoa(decision.RetryAfterSeconds))
				respond.Error(w, http.StatusTooManyRequests, "Too many requests. Please try again later.")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
