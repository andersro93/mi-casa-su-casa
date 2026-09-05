#!/usr/bin/env bash
# Starts (or tears down) the stack the Playwright suite runs against: the REAL
# container image, a throwaway Postgres of its own, and a Mailpit that catches
# every outbound mail so a spec can read an invitation or reset link back.
#
#   bash scripts/e2e-stack.sh up      # builds mi-casa:e2e if missing
#   bash scripts/e2e-stack.sh down
#
# `mise run e2e` wraps up → test → down. The image is the same COPY-only
# Dockerfile as production; `up` runs scripts/build-artifacts.sh for you when
# dist/server is missing (E2E_REBUILD=1 forces both the artifacts and the
# image, which is what you want after touching Go or the SPA).
#
# The Postgres here is deliberately NOT the compose test database
# (docker-compose.test.yml, port 55433): that one is shared with `go test` and
# is truncated between tests, while this one is created and destroyed with the
# stack and must survive a whole suite run — first-run setup can only happen
# once per database, so a stray truncation would break every later spec.
#
# Environment knobs (all optional):
#   E2E_PORT           host port for the app          (default 3300)
#   E2E_MAILPIT_PORT   host port for Mailpit's API    (default 8325)
#   E2E_IMAGE          image to run                   (default mi-casa:e2e)
#   E2E_REBUILD=1      rebuild artifacts and image
#
# CI passes E2E_IMAGE=mi-casa:ci so the suite drives the exact image the smoke
# test just proved, with no second build.
set -euo pipefail
cd "$(dirname "$0")/.."

NET=mi-casa-e2e
PG=mi-casa-e2e-pg
MAILPIT=mi-casa-e2e-mailpit
APP=mi-casa-e2e-app
PORT="${E2E_PORT:-3300}"
MAILPIT_PORT="${E2E_MAILPIT_PORT:-8325}"
IMAGE="${E2E_IMAGE:-mi-casa:e2e}"
# Pinned rather than :latest so a Mailpit release cannot change what the suite
# sees between two runs of the same commit.
MAILPIT_IMAGE="${E2E_MAILPIT_IMAGE:-axllent/mailpit:v1.31.0}"

down() {
  docker rm -f "$APP" "$MAILPIT" "$PG" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  echo "e2e stack down"
}

case "${1:-up}" in
  down) down; exit 0 ;;
  up) ;;
  *) echo "usage: e2e-stack.sh [up|down]"; exit 2 ;;
esac

if [ -z "$(docker images -q "$IMAGE")" ] || [ "${E2E_REBUILD:-0}" = "1" ]; then
  # E2E_REBUILD=1 rebuilds the ARTIFACTS too: the Dockerfile only COPYs, so
  # reusing stale binaries would ship an image without the change under test.
  if [ "${E2E_REBUILD:-0}" = "1" ] || [ ! -e dist/server/linux/amd64/mi-casa ]; then
    bash scripts/build-artifacts.sh
  fi
  docker build -t "$IMAGE" .
fi

down >/dev/null
docker network create "$NET" >/dev/null

docker run -d --name "$PG" --network "$NET" \
  -e POSTGRES_USER=micasa -e POSTGRES_PASSWORD=micasa -e POSTGRES_DB=micasa \
  postgres:17-alpine >/dev/null

# Mailpit is the SMTP relay AND the assertion surface: the suite reads the
# invitation and password-reset links back over its HTTP API.
#
# The app insists on STARTTLS for any relay that is not on loopback, and this
# one is another container on the compose network, so SMTP_URL below carries
# ?starttls=off — the escape hatch internal/mail/smtp.go documents for exactly
# this case. Without it every send fails before the mailbox is even reached,
# and a suite that only ever asserts "the link came back" would not notice.
#
# --smtp-allowed-recipients is what makes a *failed* delivery reproducible:
# anything not @e2e.test is refused at RCPT TO, so invite.spec.ts can drive
# the "we couldn't send the email — here is a link to share" path without
# stopping a container mid-suite.
docker run -d --name "$MAILPIT" --network "$NET" -p "$MAILPIT_PORT":8025 \
  -e MP_SMTP_ALLOWED_RECIPIENTS='@e2e\.test$' \
  "$MAILPIT_IMAGE" >/dev/null

# -h 127.0.0.1 forces the probe over TCP. Without it pg_isready checks the
# Unix socket, which already accepts during initdb's socket-only first start —
# before the restart that opens TCP — so the app could race a "ready" Postgres
# that refused TCP connections.
for _ in $(seq 1 30); do
  docker exec "$PG" pg_isready -h 127.0.0.1 -U micasa -d micasa >/dev/null 2>&1 && break
  sleep 1
done

# ENVIRONMENT=test is what makes the http:// APP_URL legal (outside
# development and test the loader insists on https). APP_URL must match the
# host port, not the container port: it is the origin the same-site guard
# compares against and the base of every link mailed out.
#
# TRUSTED_PROXY_HOPS=1 is the reverse-proxy deployment (the one the compose
# files and the self-hosting guide describe), and the suite plays the proxy:
# every browser context and API client sends its own X-Forwarded-For, so the
# per-client rate limits — sign-in 5/min, the session endpoint 60/min — apply
# per simulated household member instead of lumping the whole suite into one
# bucket. Without it a suite that navigates a few dozen times in ninety
# seconds gets 429s on /api/auth/me, which the SPA reads as "signed out". The
# limits themselves are proven in apps/server/internal/api's rate-limit tests,
# where a fixed clock can assert them properly.
docker run -d --name "$APP" --network "$NET" -p "$PORT":3000 \
  -e DATABASE_URL=postgres://micasa:micasa@"$PG":5432/micasa \
  -e APP_URL=http://127.0.0.1:"$PORT" \
  -e ENVIRONMENT=test \
  -e TRUSTED_PROXY_HOPS=1 \
  -e AUTH_SECRET=e2e-stack-secret-at-least-32-bytes-ok \
  -e SETUP_SECRET=e2e-setup-secret \
  -e OWNER_EMAIL=owner@e2e.test \
  -e EMAIL_DOMAIN=e2e.test \
  -e MAILGUN_WEBHOOK_SIGNING_KEY=e2e-signing-key \
  -e SMTP_URL='smtp://'"$MAILPIT"':1025?starttls=off' \
  -e OUTBOUND_EMAIL_FROM=noreply@e2e.test \
  "$IMAGE" >/dev/null

for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/readyz" | grep -q '"ok":true'
echo "e2e stack up on http://127.0.0.1:$PORT (mailpit http://127.0.0.1:$MAILPIT_PORT)"
