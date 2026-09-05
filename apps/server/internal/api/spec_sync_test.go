package api_test

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// rootSpec is openapi/mi-casa.yaml seen from this package's directory
// (apps/server/internal/api, which is `go test`'s working directory).
const rootSpec = "../../../../openapi/mi-casa.yaml"

// TestEmbeddedSpecMatchesRepoRoot guards the copy generate.go's `cp` step
// produces (internal/api/mi-casa.yaml, embedded at build time and fed to
// the request validator) against drifting from the single source of truth
// (repo-root openapi/mi-casa.yaml). Nothing else catches this: go:embed
// happily embeds a stale copy, and the embedded file compiles either way.
func TestEmbeddedSpecMatchesRepoRoot(t *testing.T) {
	embedded, err := os.ReadFile("mi-casa.yaml")
	if err != nil {
		t.Fatalf("read embedded copy (internal/api/mi-casa.yaml): %v", err)
	}

	root, err := os.ReadFile(rootSpec)
	if err != nil {
		t.Fatalf("read repo-root spec (openapi/mi-casa.yaml): %v", err)
	}

	if !bytes.Equal(embedded, root) {
		t.Fatal("internal/api/mi-casa.yaml has drifted from openapi/mi-casa.yaml — " +
			"run `go generate ./...` from apps/server to resync the embedded copy, " +
			"then commit the result")
	}
}

// TestGeneratedCodeMatchesSpec regenerates internal/api/gen from the spec
// into a temporary directory and compares the result with the committed
// files. Generated code is committed (CI and the image build never run
// codegen), so an edited spec whose `go generate` was forgotten would
// otherwise ship a server whose routes and types describe the OLD spec
// while the validator — which reads the spec at runtime — enforces the new
// one.
//
// The generator is deliberately NOT skipped when absent: .mise.toml pins
// oapi-codegen 2.8.0 and `mise exec -- go test` puts it on PATH, so a
// missing binary means the toolchain is wrong, not that the check is
// optional.
func TestGeneratedCodeMatchesSpec(t *testing.T) {
	codegen, err := exec.LookPath("oapi-codegen")
	if err != nil {
		t.Fatalf("oapi-codegen not on PATH (%v) — run the suite through the pinned "+
			"toolchain: `mise exec -- go test ./...` from apps/server", err)
	}

	spec, err := filepath.Abs(rootSpec)
	if err != nil {
		t.Fatalf("resolve spec path: %v", err)
	}

	// Each config writes to the path its own `output:` names, relative to
	// the working directory — apps/server, one level above `go test`'s. The
	// `-o` flag does not override it, so the regeneration is run from a
	// temporary directory instead, where the same relative paths land
	// harmlessly beside the real ones.
	outDir := t.TempDir()
	for _, target := range []struct{ config, file string }{
		{"cfg-types.yaml", "types.gen.go"},
		{"cfg-server.yaml", "server.gen.go"},
	} {
		config, err := filepath.Abs(filepath.Join("gen", target.config))
		if err != nil {
			t.Fatalf("resolve config path: %v", err)
		}
		cmd := exec.Command(codegen, "-config", config, spec)
		cmd.Dir = outDir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("oapi-codegen -config %s: %v\n%s", target.config, err, out)
		}

		want, err := os.ReadFile(filepath.Join(outDir, "internal", "api", "gen", target.file))
		if err != nil {
			t.Fatalf("read regenerated %s: %v", target.file, err)
		}
		got, err := os.ReadFile(filepath.Join("gen", target.file))
		if err != nil {
			t.Fatalf("read committed gen/%s: %v", target.file, err)
		}
		if !bytes.Equal(got, want) {
			t.Errorf("gen/%s is stale — run `go generate ./...` from apps/server "+
				"and commit the result", target.file)
		}
	}
}
