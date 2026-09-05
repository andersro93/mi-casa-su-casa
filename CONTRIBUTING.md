# Contributing

Thanks for contributing to Mi Casa Su Casa.

## Workflow

### Features

For non-trivial work, **start with an issue first**.

1. Open or reference a feature issue
2. Align on scope and acceptance criteria
3. Implement in a pull request linked to that issue
4. Include tests

### Bugs

Bug fixes should generally reference an issue, unless the change is a tiny
obvious correction.

### Documentation

Small documentation improvements can go straight to a PR, but larger
documentation changes should still reference an issue if they change project
expectations.

## Definition of done

A feature is only done when all of the following are true:

- implementation is complete
- tests are added or updated
- CI is green
- docs are updated if behavior or setup changed

## Main branch policy

- PRs only to `main`
- no direct pushes
- required CI checks before merge

Repository settings should enforce this with branch protection on `main`.

Recommended protection rules:

- require a pull request before merging
- require the `CI` workflow to pass before merging
- dismiss or re-run checks when the PR head changes
- prevent direct pushes to `main`

**Merging to `main` releases.** A merge with `feat`, `fix`, `perf` or a
breaking change since the last tag computes a version, tags it and publishes a
release and container image automatically — see
[`docs/ci-cd-architecture.md`](./docs/ci-cd-architecture.md). Docs- and
chore-only merges end green without releasing.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org), because the
version number and the changelog are both computed from them:

```
feat(inbox): group messages by sender rule
fix(mail): accept a Message-ID with no angle brackets
docs: rewrite the self-hosting guide
```

`feat` bumps the minor, `fix` and `perf` the patch, `!` or a
`BREAKING CHANGE:` footer the major (which, while the major is 0, bumps the
minor instead). Anything else releases nothing.

## Local development

Two toolchains — Go for the server, Bun for the SPA — both pinned in
`.mise.toml`:

```bash
mise install
bun install
docker compose -f docker-compose.test.yml up -d   # Postgres on 127.0.0.1:55433
```

Export the same variables the container takes (the README's
[Development](./README.md#development) section has a copy-pasteable block),
then:

```bash
cd apps/server && go run ./cmd/mi-casa migrate    # apply the schema
cd apps/server && go run ./cmd/mi-casa            # API on :3000
bun run --filter @mi-casa/frontend dev            # SPA on :5173, proxying /api
```

There is no seed script: run `/setup` with your `OWNER_EMAIL` and
`SETUP_SECRET`, which is the same bootstrap a self-hoster does.

## Commands

```bash
mise run test        # go vet + go test -p 1 -count=1 ./... (real Postgres), then the TS suite
mise run check       # Biome + tsc, then goreleaser check
mise run e2e         # Playwright against the real container image
mise run artifacts   # SPA + both server binaries
mise run image       # multi-arch image via buildx
mise run snapshot    # full GoReleaser dry run — nothing published
```

Underneath, `bun run check` is Biome plus `bun run typecheck` (the SPA's
`tsc --noEmit` and the Playwright suite's), and `bun run test` is the SPA's
Vitest suite. `bun run format` writes Biome's formatting.

After editing `openapi/mi-casa.yaml`, regenerate both sides and commit the
output:

```bash
cd apps/server && go generate ./...   # oapi-codegen + sqlc
bun run gen:client                    # openapi-typescript → the SPA's types
```

Generated code is committed; neither CI nor the image runs a code generator,
and a drift test fails when the committed output is stale. The same applies to
`sqlc`: edit the SQL in `apps/server/internal/db/queries`, then regenerate.

Schema changes are **append-only** goose migrations in
`apps/server/internal/db/migrations`. Never edit an applied one.

## Testing expectations

Every feature should improve or preserve confidence in deployability.

That means:

- unit tests for isolated logic (parsers, the classifier, the code extractor,
  slug rules, permission logic)
- Go tests against a **real Postgres** for anything touching the database,
  auth or the HTTP surface — `internal/testrig` gives you a handler wired to
  the real thing with a fixed clock and a recording mail sender
- Vitest for SPA components and hooks
- Playwright (`mise run e2e`) for flows that only exist end to end

At minimum, every PR is expected to keep these green:

```bash
mise run check
mise run test
```

`-p 1` on the Go suite is not optional: several packages truncate shared
tables and cannot run as concurrent packages against one database.

No feature is considered done without tests.

## Pull requests

Each PR should:

- link a GitHub issue
- explain what changed and why
- include test evidence
- stay focused in scope

## Decisions

Choices made along the way that the README does not cover live in
[DECISIONS.md](./DECISIONS.md). If you make one — a library, a trade-off, an
accepted limitation — add a line there in the same PR.

## Security

Do not open a public issue for a security problem. See
[SECURITY.md](./SECURITY.md).

## Code of conduct

By participating in this project, you agree to follow the
[Code of Conduct](./CODE_OF_CONDUCT.md).
