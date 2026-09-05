package db_test

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// serverDir is apps/server seen from this package's directory
// (apps/server/internal/db, which is `go test`'s working directory).
const serverDir = "../.."

// TestGeneratedQueriesMatchSchema regenerates internal/db/gen from
// internal/db/queries and internal/db/migrations into a temporary directory
// and compares the result with the committed files — the sqlc counterpart of
// internal/api/spec_sync_test.go's TestGeneratedCodeMatchesSpec.
//
// Generated code is committed (CI and the image build never run codegen), so
// editing a query without re-running `go generate` would otherwise ship the
// OLD bindings silently. The repo layer is well tested against real Postgres,
// which catches most behaviour changes — but a query-only change with no new
// test (adding a missing household_id predicate, say) would pass green while
// doing nothing at all.
//
// The generator is deliberately NOT skipped when absent: .mise.toml pins sqlc
// 1.31.1, `mise exec -- go test` puts it on PATH, and .github/workflows/test.yml
// installs it for exactly this test. A missing binary means the toolchain is
// wrong, not that the check is optional.
func TestGeneratedQueriesMatchSchema(t *testing.T) {
	sqlc, err := exec.LookPath("sqlc")
	if err != nil {
		t.Fatalf("sqlc not on PATH (%v) — run the suite through the pinned "+
			"toolchain: `mise exec -- go test ./...` from apps/server", err)
	}

	// sqlc resolves every path in the config by joining it onto the config
	// file's own directory — an absolute path there is appended, not honoured.
	// So the copy lives in a temp directory with `queries` and `schema`
	// rewritten as paths relative to *it*, and `out` pointing at a sibling
	// directory inside the same temp tree.
	tmp := t.TempDir()
	config, err := os.ReadFile(filepath.Join(serverDir, "sqlc.yaml"))
	if err != nil {
		t.Fatalf("read sqlc.yaml: %v", err)
	}
	rewritten := string(config)
	for _, path := range []struct{ key, dir string }{
		{"queries", "internal/db/queries"},
		{"schema", "internal/db/migrations"},
	} {
		abs, err := filepath.Abs(filepath.Join(serverDir, path.dir))
		if err != nil {
			t.Fatalf("resolve %s path: %v", path.key, err)
		}
		rel, err := filepath.Rel(tmp, abs)
		if err != nil {
			t.Fatalf("relativise %s path: %v", path.key, err)
		}
		from := path.key + `: "` + path.dir + `"`
		if !strings.Contains(rewritten, from) {
			t.Fatalf("sqlc.yaml no longer contains %q — this test rewrites that "+
				"line and must be updated alongside the config", from)
		}
		rewritten = strings.Replace(rewritten, from, path.key+`: "`+rel+`"`, 1)
	}
	const committedOut = `out: "internal/db/gen"`
	if !strings.Contains(rewritten, committedOut) {
		t.Fatalf("sqlc.yaml no longer contains %q — this test rewrites that "+
			"line and must be updated alongside the config", committedOut)
	}
	rewritten = strings.Replace(rewritten, committedOut, `out: "sqlc-out"`, 1)

	if err := os.WriteFile(filepath.Join(tmp, "sqlc.yaml"), []byte(rewritten), 0o600); err != nil {
		t.Fatalf("write rewritten sqlc.yaml: %v", err)
	}

	cmd := exec.Command(sqlc, "generate", "-f", filepath.Join(tmp, "sqlc.yaml"))
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("sqlc generate: %v\n%s", err, out)
	}

	freshDir := filepath.Join(tmp, "sqlc-out")
	fresh, err := os.ReadDir(freshDir)
	if err != nil {
		t.Fatalf("read regenerated output: %v", err)
	}
	if len(fresh) == 0 {
		t.Fatal("sqlc generate produced no files — the rewritten config is wrong, " +
			"not the committed output")
	}

	// Both directions: a file that regeneration no longer produces is drift
	// too (a deleted query whose bindings were left behind).
	committed, err := os.ReadDir("gen")
	if err != nil {
		t.Fatalf("read committed internal/db/gen: %v", err)
	}
	names := map[string]bool{}
	for _, entry := range fresh {
		names[entry.Name()] = true
	}
	for _, entry := range committed {
		// Reported here and skipped below: without the `continue` the
		// content comparison would report the same file a second time, as an
		// unreadable regenerated file.
		if !names[entry.Name()] {
			t.Errorf("gen/%s is not produced by `sqlc generate` any more — run "+
				"`go generate ./...` from apps/server and commit the result", entry.Name())
		}
	}

	for name := range names {
		want, err := os.ReadFile(filepath.Join(freshDir, name))
		if err != nil {
			t.Errorf("read regenerated %s: %v", name, err)
			continue
		}
		got, err := os.ReadFile(filepath.Join("gen", name))
		if err != nil {
			t.Errorf("read committed gen/%s: %v", name, err)
			continue
		}
		if !bytes.Equal(got, want) {
			t.Errorf("gen/%s is stale — run `go generate ./...` from apps/server "+
				"and commit the result", name)
		}
	}
}
