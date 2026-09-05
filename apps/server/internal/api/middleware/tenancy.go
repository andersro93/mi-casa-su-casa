package middleware

import (
	"context"
	"net/http"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/respond"
	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
)

// Household is the tenancy context a route runs in: which household the URL
// named, and what the caller may do in it. Ported from the `household`
// context variable in src/server/auth/middleware.ts.
type Household struct {
	ID   string
	Slug string
	Role string
}

// RequireHousehold is the tenancy guard: it turns the `{slug}` in the URL
// into a membership, or refuses. Ported from requireHouseholdContext.
//
// The three refusals are exactly the TypeScript's, in the same order:
//
//	no caller      401 Unauthorized
//	no slug        400 Household slug is required
//	not a member   403 Forbidden
//
// The last one covers "there is no such household" as well, deliberately:
// answering 404 for an unknown slug and 403 for a real one would let a
// stranger enumerate which households exist by watching the status code.
func RequireHousehold(d Deps) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user := UserFrom(r)
			if user == nil {
				respond.Error(w, http.StatusUnauthorized, "Unauthorized")
				return
			}

			slug := r.PathValue("slug")
			if slug == "" {
				respond.Error(w, http.StatusBadRequest, "Household slug is required")
				return
			}

			membership, err := d.Repo.MembershipForSlug(r.Context(), user.UserID, slug)
			if err != nil {
				internalError(w, r, "membership lookup", err)
				return
			}
			if membership == nil {
				respond.Error(w, http.StatusForbidden, "Forbidden")
				return
			}

			household := &Household{ID: membership.HouseholdID, Slug: membership.Slug, Role: membership.Role}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), householdKey, household)))
		})
	}
}

// RequireOwner narrows a household route to its owners. Ported from
// requireOwner.
//
// A missing household is refused rather than treated as an error: the guard
// is only ever mounted behind RequireHousehold, and if a future route
// forgets that, refusing is the failure that cannot leak anything.
func RequireOwner() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			household := HouseholdFrom(r)
			if household == nil || household.Role != repo.RoleOwner {
				respond.Error(w, http.StatusForbidden, "Forbidden")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// HouseholdFrom is the tenancy context RequireHousehold resolved, or nil
// when the route is not household-scoped.
func HouseholdFrom(r *http.Request) *Household {
	household, _ := r.Context().Value(householdKey).(*Household)
	return household
}
