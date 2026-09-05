# CI/CD architecture

Three workflows, one quality gate, and no deploy step. GitHub Actions
validates every pull request, publishes a preview image for it, and — on merge
to `main` — tags a version and publishes a release: binaries, checksums,
SBOMs, cosign signatures and the multi-arch container image.

**Merging is releasing.** There is no "deploy" button and no environment this
repository rolls out to: the artifact is the image, and where it runs is
deployment infrastructure the repository does not own.

## Workflow layout

```
pull_request ──▶ ci-go.yml ──▶ test.yml (reusable)
                     └──────▶ image: build → smoke test → preview push

push to main ──▶ release.yml ──▶ version (svu)
                     ├────────▶ verify: test.yml on the merge commit
                     └────────▶ publish: tag → GoReleaser → GHCR + GitHub Release
```

### `Tests` — `.github/workflows/test.yml`

The single definition of "the suite is green", called by both of the others
(`workflow_call` only — it never runs on its own) so the gate cannot drift
between the pull-request check and the release check.

It runs against a real `postgres:17-alpine` service container:

```
bun install --frozen-lockfile
bun run check          # Biome + tsc
goreleaser check       # the release config is code too
bun run test           # the TypeScript suite
cd apps/server && go vet ./...
cd apps/server && go test -p 1 -count=1 ./...
```

`-p 1` is not optional: Go packages that truncate shared tables cannot run as
concurrent packages against one database.

The toolchain comes from `.mise.toml` via `jdx/mise-action`, with
`install_args` naming only what this job needs — plus `oapi-codegen` and
`sqlc`, because the generated-code drift test shells out to them and never
skips. CI itself never runs `go generate`: generated code is committed, and
that test is what keeps it honest.

### `CI (Go)` — `.github/workflows/ci-go.yml`

Runs on every pull request, with `cancel-in-progress` concurrency keyed on the
branch — a force-push obsoletes the running check rather than burning minutes
on a commit nobody can merge.

1. `test.yml`.
2. `svu next --v0` computes what the next release *would* be, so the preview
   tags sort below it.
3. `bash scripts/build-artifacts.sh` builds the SPA and both server binaries
   natively. Nothing compiles inside Docker.
4. `docker build` produces a single-arch image, and the **smoke test** proves
   it runs rather than merely compiles, against a throwaway Postgres:
   - `migrate` applies the schema from the image;
   - the default mode starts and answers `/healthz`;
   - `/readyz` returns `"ok":true` (so it reached Postgres);
   - `GET /` returns the embedded SPA (`id="root"`, not the committed
     placeholder — a build that skipped the embed overlay fails here);
   - an unsigned `POST /api/inbound/mailgun/mime` returns **401**, which
     proves the router mounted the webhook outside the spec validator, the
     multipart form parsed, and HMAC verification ran.
5. **Only then**, the preview image is pushed for both architectures:

   ```
   ghcr.io/andersro93/mi-casa-su-casa:<next>-pr.<number>          # moves with the PR
   ghcr.io/andersro93/mi-casa-su-casa:<next>-pr.<number>.<sha>    # immutable
   ```

   Both are valid semver prereleases of the release they precede, so they can
   never be mistaken for one.

Two kinds of pull request build and smoke-test but publish nothing, because
their `GITHUB_TOKEN` is read-only: those from **forks**, and those from
**Dependabot** (whose runs are treated as untrusted even on an in-repo
branch). The job checks both conditions before attempting a login, so the
failure is a skipped step rather than a 403 after the smoke test has already
passed.

On any failure the job dumps the container's log — the image has no shell to
go poking around in — and tears the stack down.

### `Release` — `.github/workflows/release.yml`

Runs on every push to `main`, plus a manual dispatch with two inputs.

**`version` job.** `svu` reads Conventional Commits since the last `v*` tag.
`--v0` keeps breaking changes bumping the minor while the major is 0; the
`allow_major` dispatch input drops it, so reaching 1.0.0 stays a deliberate
human act. A push with nothing releasable (docs, chore, ci) ends **green
without releasing** — the app did not change. The same state on a manual
dispatch is a refusal instead: somebody pressing the button expects a release
to exist.

**`verify` job.** `test.yml` again, on the merge commit — which is not the
pull request head that CI tested, so the suite runs once more on exactly what
ships.

**`publish` job.** In order:

1. Create and push the git tag. GoReleaser releases *from* a tag, so the tag
   comes first.
2. `goreleaser release --clean` builds and publishes everything: `linux/amd64`
   and `linux/arm64` archives, `checksums.txt`, SPDX SBOMs, a keyless cosign
   signature over the checksum file, the multi-arch image tagged
   `X.Y.Z` / `X.Y` / `X` / `latest` / `sha-<commit>` with cosign signatures
   over the manifests, and a GitHub Release with a Conventional-Commits
   changelog.
3. If the publish did not succeed — failed, cancelled, or never started — the
   tag and any GitHub Release are deleted again, so **a tag never points at a
   release that does not exist**. The cleanup keys on the publish step's own
   outcome rather than on `failure()`, because a cancelled job is not a failed
   one.

The `dry_run` dispatch input runs the whole pipeline as a GoReleaser snapshot
with nothing pushed, tagged or signed — plus a cosign sign-and-verify against
a throwaway blob, because GoReleaser auto-skips signing in snapshot mode and a
cosign flag incompatibility once reached a real release that way.

`concurrency: release` with `cancel-in-progress: false` serialises rapid
merges, so the second run computes its version from the tag the first one just
created.

### What the pipeline does not do

It does not roll anything out. Rolling out means, in order:

1. `/app/mi-casa migrate` as a one-off (a Job, an initContainer, or the
   compose `migrate` service) **before** the new image serves traffic —
   migrations are append-only, so old code briefly running against a newer
   schema is safe, while new code against an older schema is not.
2. Point the deployment at the new tag and let the rollout proceed. `/readyz`
   gates each replica; `SIGTERM` drains it (20 seconds, inside the usual
   30-second grace period).

See the README's [Upgrading](../README.md#upgrading) section, and
[`runbook.md`](./runbook.md) for rolling back.

## Local equivalents

Everything CI does can be run locally with the pinned toolchain:

```sh
mise run test        # what test.yml runs
mise run check       # Biome + tsc + goreleaser check
mise run artifacts   # what the image job builds
mise run image       # the multi-arch buildx assemble
mise run snapshot    # the full GoReleaser pipeline, nothing published
mise x -- svu next --v0    # what the next release would be
```

## Repository settings this assumes

- **Branch protection on `main`**: pull requests only, with `CI (Go)`
  required. `Tests` is reusable and reports under the calling workflow, so
  require `CI (Go)`, not `Tests`.
- **`packages: write`** for the workflow token, which is the default for
  workflows in this repository; GHCR is written with the built-in
  `GITHUB_TOKEN`, so there is no registry secret to manage.
- **`id-token: write`** on the publish job, which is what makes keyless cosign
  signing work through GitHub's OIDC. No signing key exists or needs rotating.
- Optionally the **`PRODUCTION_URL`** repository variable. The publish job's
  environment URL falls back to the GHCR package page when it is unset.

No other secret is required to build or release. There is no cloud account, no
API token and no deployment credential in this pipeline.

## Dependency updates

`.github/dependabot.yml` covers four ecosystems, weekly, with minor and patch
bumps grouped into one pull request each and majors arriving individually:

| Ecosystem | Directory | What it tracks |
| --- | --- | --- |
| `gomod` | `/apps/server` | the Go module |
| `npm` | `/` | the bun workspaces (`bun.lock` goes through the npm ecosystem) |
| `github-actions` | `/` | workflow actions, pinned by commit hash with a version comment |
| `docker` | `/` | the distroless base image, pinned by digest in the `Dockerfile` |

Dependabot's own pull requests build and smoke-test the image but publish no
preview, as described above.

---

## Legacy Cloudflare workflows

The original Cloudflare Workers deployment is still in the repository until
the cutover release removes it, and so are its workflows. They are **not** the
supported pipeline, and nothing in them touches the container:

| File | What it did |
| --- | --- |
| `.github/workflows/ci.yml` | `npm run check`/`typecheck`/`test`/`build` for the Worker sources |
| `.github/workflows/preview-deploy.yml` | Deployed each pull request to a shared preview Worker and preview D1 |
| `.github/workflows/production-deploy.yml` | Applied D1 migrations and deployed the Worker on every push to `main` |
| `.github/workflows/production-d1-migrate.yml` | Manual D1 migration recovery behind a protected environment |

They need the Cloudflare account secrets (`CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_API_TOKEN`, `D1_DATABASE_ID_PREVIEW`, `D1_DATABASE_ID_PRODUCTION`)
and the per-Worker dashboard variables described in the Worker's own
configuration. If you are not running the Worker, none of that applies, and
the workflows will simply fail or skip for want of secrets.

`.github/workflows/codeql-analysis.yml` is not legacy — it scans both trees
and stays.
