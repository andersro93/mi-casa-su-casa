# syntax=docker/dockerfile:1

# Mi Casa Su Casa — one image, one static Go binary, several modes selected
# by argv[1]: the web server (default: migrate-then-serve-and-schedule),
# `server` (HTTP only), `worker` (scheduler only, plus a bare /healthz),
# `migrate` (alias `migrations`) and `cron <job>`, plus `healthcheck` for
# HEALTHCHECK below. See apps/server/cmd/mi-casa/main.go for the
# authoritative dispatch table.
#
# NOTHING COMPILES IN HERE. The binaries are built natively, outside Docker:
#
#   bash scripts/build-artifacts.sh   # → dist/server/linux/{amd64,arm64}/mi-casa
#
# and this file only COPYs the one matching TARGETPLATFORM. That keeps a
# multi-arch `docker buildx build --platform linux/amd64,linux/arm64` down
# to seconds of file copying — no QEMU emulation, no in-container Go or Bun
# toolchains, and the native build reuses the developer's (or CI's) module
# and Vite caches. If the COPY below fails with "not found", run the script
# first.
#
# The SPA is not copied separately: it is embedded inside the binary
# (go:embed in internal/web), along with the SQL migrations and the IANA
# zone database (`import _ "time/tzdata"`).
#
# The base is distroless "static" rather than scratch: same
# no-shell/no-libc/no-package-manager attack surface, but it ships the
# things a from-scratch image has to hand-roll — an up-to-date CA bundle
# (the SMTP relay is dialled over TLS), tzdata, /tmp, and the `nonroot` user
# (uid 65532, which the :nonroot tag also sets as USER). Pinned by digest;
# Dependabot bumps it.
FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab

# Automatic buildx arg: "linux/amd64" or "linux/arm64" per platform.
ARG TARGETPLATFORM
# Where the per-platform binaries live in the build context. The default
# serves the scripts/build-artifacts.sh layout (dist/server/linux/<arch>/
# mi-casa); GoReleaser's dockers_v2 passes BINARY_ROOT=. because its build
# context holds them at linux/<arch>/mi-casa directly.
ARG BINARY_ROOT=dist/server

# No volume and no writable directory: the app keeps everything in Postgres
# — inbound mail, attachments and all — so there is nothing on disk to
# persist and nothing for a nonroot process to need write access to.
COPY ${BINARY_ROOT}/${TARGETPLATFORM}/mi-casa /app/mi-casa

ENV PORT=3000
EXPOSE 3000

# The binary is its own healthcheck client — there is no shell or curl here.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["/app/mi-casa", "healthcheck"]

ENTRYPOINT ["/app/mi-casa"]
