package repo_test

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
	"github.com/andersro93/mi-casa-su-casa/server/internal/testrig"
)

// setup opens a repository over the shared test rig's pool. Every test gets a
// freshly truncated database (see internal/testrig), so ids may be
// deterministic without colliding across tests.
func setup(t *testing.T) (*repo.Repo, *testrig.Rig) {
	t.Helper()
	rig := testrig.Setup(t)
	return repo.New(rig.Pool), rig
}

// ctx keeps the per-test context short so a hung query fails the test rather
// than the whole package's timeout.
func ctx(t *testing.T) context.Context {
	t.Helper()
	c, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	return c
}

// insertUser writes straight into Limen's "users" table. The repository does
// not create users — Limen does (Task 10) — so tests seed them with SQL, the
// way the TypeScript integration tests called their own createTestUser
// helper before exercising a repository function.
func insertUser(t *testing.T, rig *testrig.Rig, email string) string {
	t.Helper()
	id := "user-" + strings.SplitN(email, "@", 2)[0]
	name := strings.SplitN(email, "@", 2)[0]
	if _, err := rig.Pool.Exec(ctx(t),
		`INSERT INTO "users" ("id", "email", "name") VALUES ($1, $2, $3)`,
		id, email, name,
	); err != nil {
		t.Fatalf("insert user %s: %v", email, err)
	}
	return id
}

// countRows is the Go counterpart of the TS tests' `count(table, where)`
// helper: a raw count so an assertion can look past the repository at what
// actually landed in the database.
func countRows(t *testing.T, rig *testrig.Rig, table string, where string, args ...any) int {
	t.Helper()
	query := fmt.Sprintf(`SELECT count(*) FROM %q`, table)
	if where != "" {
		query += " WHERE " + where
	}
	var total int
	if err := rig.Pool.QueryRow(ctx(t), query, args...).Scan(&total); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return total
}

// ownedHousehold is the fixture nearly every test starts from: an owner and
// the household they own.
func ownedHousehold(t *testing.T, r *repo.Repo, rig *testrig.Rig, email, slug string) (userID string, household repo.Household) {
	t.Helper()
	userID = insertUser(t, rig, email)
	household, err := r.CreateHousehold(ctx(t), slug, slug, userID)
	if err != nil {
		t.Fatalf("create household %s: %v", slug, err)
	}
	return userID, household
}

// addMembership seeds a membership without going through an invitation, so a
// test of one area does not depend on another's write path.
func addMembership(t *testing.T, rig *testrig.Rig, householdID, userID, role string) string {
	t.Helper()
	id := fmt.Sprintf("membership-%s-%s", householdID, userID)
	if _, err := rig.Pool.Exec(ctx(t),
		`INSERT INTO "household_memberships" ("id", "household_id", "user_id", "role")
		 VALUES ($1, $2, $3, $4)`,
		id, householdID, userID, role,
	); err != nil {
		t.Fatalf("insert membership: %v", err)
	}
	return id
}

// insertSession seeds a row in Limen's "sessions" table, whose metadata is
// an opaque JSON *string* Limen writes and the settings screen unpacks.
func insertSession(t *testing.T, rig *testrig.Rig, id, userID, token string, createdAt time.Time, metadata string) {
	t.Helper()
	var meta *string
	if metadata != "" {
		meta = &metadata
	}
	if _, err := rig.Pool.Exec(ctx(t),
		`INSERT INTO "sessions" ("id", "user_id", "token", "created_at", "expires_at", "last_access", "metadata")
		 VALUES ($1, $2, $3, $4, $5, $4, $6)`,
		id, userID, token, createdAt, createdAt.Add(24*time.Hour), meta,
	); err != nil {
		t.Fatalf("insert session: %v", err)
	}
}

// contextWithCancel is context.WithCancel, wrapped so the audit test reads as
// prose rather than as an import.
func contextWithCancel(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithCancel(parent)
}

func strptr(v string) *string { return &v }
