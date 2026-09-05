// Command go generate regenerates the code derived from files that are not
// Go: the sqlc query bindings in internal/db/gen (from
// internal/db/queries/*.sql against internal/db/migrations/*.sql). Run from
// apps/server with the pinned toolchain:
//
//	mise exec -- go generate ./...
//
// sqlc 1.31.1 must be on PATH; .mise.toml pins it. Generated code is
// committed, so neither CI nor the container image runs codegen at build
// time.
package server

//go:generate sqlc generate
