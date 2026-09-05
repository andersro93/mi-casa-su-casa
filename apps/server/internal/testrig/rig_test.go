package testrig

import (
	"context"
	"testing"
)

// TestSetup_TruncatesBetweenTests inserts a household under one Setup call
// and asserts a second, independent Setup call sees an empty households
// table — the guarantee every other package's tests build on: each test
// starts from a clean database regardless of what an earlier test left
// behind.
func TestSetup_TruncatesBetweenTests(t *testing.T) {
	ctx := context.Background()

	first := Setup(t)
	if _, err := first.Pool.Exec(ctx,
		`INSERT INTO "households" ("id", "slug", "display_name") VALUES ('h1', 'test-household', 'Test household')`,
	); err != nil {
		t.Fatalf("insert household: %v", err)
	}

	var countAfterInsert int
	if err := first.Pool.QueryRow(ctx, `SELECT count(*) FROM "households"`).Scan(&countAfterInsert); err != nil {
		t.Fatalf("count households after insert: %v", err)
	}
	if countAfterInsert != 1 {
		t.Fatalf("expected 1 household after insert, got %d", countAfterInsert)
	}

	second := Setup(t)
	var countAfterSecondSetup int
	if err := second.Pool.QueryRow(ctx, `SELECT count(*) FROM "households"`).Scan(&countAfterSecondSetup); err != nil {
		t.Fatalf("count households after second Setup: %v", err)
	}
	if countAfterSecondSetup != 0 {
		t.Fatalf("expected households to be empty after second Setup, got %d rows", countAfterSecondSetup)
	}
}

// TestSetup_SeedsPendingInstallation guards the singleton app_installation
// row: goose's Up migration seeds it, but Setup's truncation would remove it
// again unless Setup explicitly re-seeds it afterwards.
func TestSetup_SeedsPendingInstallation(t *testing.T) {
	rig := Setup(t)

	var status string
	if err := rig.Pool.QueryRow(context.Background(),
		`SELECT "status" FROM "app_installation" WHERE "id" = 1`,
	).Scan(&status); err != nil {
		t.Fatalf("read app_installation row: %v", err)
	}
	if status != "pending" {
		t.Fatalf("expected seeded installation status %q, got %q", "pending", status)
	}
}

// TestSetup_SafeAcrossPackageTests exercises Setup from a second test
// function in the same package, standing in for two unrelated test files
// both depending on the rig within one `go test -p 1` binary.
func TestSetup_SafeAcrossPackageTests(t *testing.T) {
	rig := Setup(t)

	var count int
	if err := rig.Pool.QueryRow(context.Background(),
		`SELECT count(*) FROM "households"`,
	).Scan(&count); err != nil {
		t.Fatalf("count households: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected empty households table, got %d rows", count)
	}
}
