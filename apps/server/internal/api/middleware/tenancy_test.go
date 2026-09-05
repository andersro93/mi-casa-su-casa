package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/middleware"
	"github.com/andersro93/mi-casa-su-casa/server/internal/auth"
	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
	"github.com/andersro93/mi-casa-su-casa/server/internal/testrig"
)

// Ports requireHouseholdContext / requireOwner (src/server/auth/middleware.ts,
// REF §A1 "Auth guards") and the guard half of
// test/integration/tenant-isolation.test.ts.

// households seeds the fixture both households' tests share: an owner and a
// member in casa-a, and a separate owner of casa-b.
func households(t *testing.T) *repo.Repo {
	t.Helper()
	rig := testrig.Setup(t)
	r := repo.New(rig.Pool)
	ctx := t.Context()

	for _, seed := range []struct{ id, email string }{
		{"user-owner", "owner@example.com"},
		{"user-member", "member@example.com"},
		{"user-stranger", "stranger@example.com"},
	} {
		if _, err := rig.Pool.Exec(ctx,
			`INSERT INTO "users" ("id", "email", "name") VALUES ($1, $2, $2)`, seed.id, seed.email,
		); err != nil {
			t.Fatalf("seed user %s: %v", seed.id, err)
		}
	}

	casaA, err := r.CreateHousehold(ctx, "casa-a", "Casa A", "user-owner")
	if err != nil {
		t.Fatalf("create casa-a: %v", err)
	}
	if _, err := rig.Pool.Exec(ctx,
		`INSERT INTO "household_memberships" ("id", "household_id", "user_id", "role")
		 VALUES ('m-member', $1, 'user-member', 'member')`, casaA.ID,
	); err != nil {
		t.Fatalf("seed membership: %v", err)
	}
	if _, err := r.CreateHousehold(ctx, "casa-b", "Casa B", "user-stranger"); err != nil {
		t.Fatalf("create casa-b: %v", err)
	}
	return r
}

// guarded routes one path through Session + RequireHousehold (+ RequireOwner
// when ownerOnly), using a ServeMux so that r.PathValue("slug") is populated
// the way the real mux populates it.
func guarded(t *testing.T, r *repo.Repo, userID string, ownerOnly bool, path string) *httptest.ResponseRecorder {
	t.Helper()

	var session *auth.Session
	if userID != "" {
		session = &auth.Session{UserID: userID, Email: userID + "@example.com"}
	}
	deps := middleware.Deps{
		Auth:     &stubAuth{session: session},
		Repo:     r,
		IPDigest: func(ip string) string { return "digest" },
	}

	guards := []func(http.Handler) http.Handler{
		middleware.Session(deps),
		middleware.RequireHousehold(deps),
	}
	if ownerOnly {
		guards = append(guards, middleware.RequireOwner())
	}

	mux := http.NewServeMux()
	mux.Handle("GET /api/admin/{slug}/members", chain(guards...)(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		household := middleware.HouseholdFrom(req)
		if household == nil {
			t.Error("RequireHousehold let a request through without a household in the context")
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Header().Set("X-Test-Household", household.ID+" "+household.Slug+" "+household.Role)
		w.WriteHeader(http.StatusOK)
	})))
	// The empty-slug case cannot be reached through a {slug} pattern, so it
	// gets its own route.
	mux.Handle("GET /api/admin/members", chain(guards...)(okHandler()))

	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
	return recorder
}

func TestRequireHouseholdRejectsAnAnonymousCaller(t *testing.T) {
	recorder := guarded(t, households(t), "", false, "/api/admin/casa-a/members")

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", recorder.Code)
	}
	assertEnvelope(t, recorder, "Unauthorized")
}

func TestRequireHouseholdRejectsAnEmptySlug(t *testing.T) {
	recorder := guarded(t, households(t), "user-owner", false, "/api/admin/members")

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
	assertEnvelope(t, recorder, "Household slug is required")
}

func TestRequireHouseholdRejectsAMemberOfAnotherHousehold(t *testing.T) {
	recorder := guarded(t, households(t), "user-owner", false, "/api/admin/casa-b/members")

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", recorder.Code)
	}
	assertEnvelope(t, recorder, "Forbidden")
}

func TestRequireHouseholdAnswersAnUnknownSlugTheSameAsAForbiddenOne(t *testing.T) {
	// Deliberate: distinguishing the two would let a stranger enumerate
	// which household slugs exist.
	recorder := guarded(t, households(t), "user-owner", false, "/api/admin/casa-nowhere/members")

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", recorder.Code)
	}
	assertEnvelope(t, recorder, "Forbidden")
}

func TestRequireHouseholdPutsTheMembershipInTheContext(t *testing.T) {
	recorder := guarded(t, households(t), "user-member", false, "/api/admin/casa-a/members")

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	got := recorder.Header().Get("X-Test-Household")
	if got == "" {
		t.Fatal("no household reached the handler")
	}
	if want := " casa-a member"; got[len(got)-len(want):] != want {
		t.Fatalf("household = %q, want it to end with %q", got, want)
	}
}

func TestRequireOwnerRejectsAPlainMember(t *testing.T) {
	recorder := guarded(t, households(t), "user-member", true, "/api/admin/casa-a/members")

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", recorder.Code)
	}
	assertEnvelope(t, recorder, "Forbidden")
}

func TestRequireOwnerLetsTheOwnerThrough(t *testing.T) {
	recorder := guarded(t, households(t), "user-owner", true, "/api/admin/casa-a/members")

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
}

func TestRequireOwnerRejectsWhenNoHouseholdWasResolved(t *testing.T) {
	// RequireOwner is only ever mounted behind RequireHousehold; if a future
	// route forgets that, the answer must be a refusal and not a panic.
	recorder := httptest.NewRecorder()
	middleware.RequireOwner()(okHandler()).
		ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/admin/casa-a/members", nil))

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", recorder.Code)
	}
	assertEnvelope(t, recorder, "Forbidden")
}
