// Command go generate regenerates the code derived from files that are not
// Go: the sqlc query bindings in internal/db/gen (from
// internal/db/queries/*.sql against internal/db/migrations/*.sql), and the
// OpenAPI-derived types and server routes in internal/api/gen (from
// openapi/mi-casa.yaml at the repo root). Run from apps/server with the
// pinned toolchain:
//
//	mise exec -- go generate ./...
//
// sqlc 1.31.1 and oapi-codegen 2.8.0 must be on PATH; .mise.toml pins both.
// Generated code is committed, so neither CI nor the container image runs
// codegen at build time — internal/api/spec_sync_test.go fails if what is
// committed no longer matches the spec.
package server

//go:generate sqlc generate

// internal/api/mi-casa.yaml is a committed COPY of the repo-root spec, kept
// in sync by this generate step: go:embed cannot reach outside a package's
// own directory tree, and openapi/ sits above the module root, so the API
// package (which feeds the spec to the request-validation middleware) needs
// its own copy to embed. openapi/mi-casa.yaml stays the single source of
// truth; never hand-edit the copy.
//go:generate cp ../../openapi/mi-casa.yaml internal/api/mi-casa.yaml
//go:generate oapi-codegen -config internal/api/gen/cfg-types.yaml ../../openapi/mi-casa.yaml
//go:generate oapi-codegen -config internal/api/gen/cfg-server.yaml ../../openapi/mi-casa.yaml
