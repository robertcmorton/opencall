#!/usr/bin/env bash
# The security regression suite: a locked sync server on a throwaway database,
# then every access-control and hardening check in apps/web/scripts/auth-matrix.mts.
#
#   pnpm test:security
#
# Rule (as in Kitshare): every security fix adds a check here that fails
# without it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$(mktemp -d)"
PORT=8899
ADMIN="oc_security_check_$(openssl rand -hex 16)"
cleanup() {
  [ -n "${SYNC_PID:-}" ] && kill "$SYNC_PID" 2>/dev/null || true
  rm -rf "$DIR"
}
trap cleanup EXIT

if lsof -ti tcp:$PORT >/dev/null 2>&1; then
  echo "port $PORT is in use — stop whatever is on it first" >&2
  exit 1
fi

cd "$ROOT/apps/sync"
PGLITE_DIR="$DIR/db" ADMIN_TOKEN="$ADMIN" PUBLIC_WEB_URL="http://web.matrix.test" ALLOW_DEV_JOIN=0 SYNC_PORT=$PORT \
  node src/server.ts >"$DIR/sync.log" 2>&1 &
SYNC_PID=$!
for _ in $(seq 1 60); do
  curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1 && break
  sleep 0.5
done
if ! curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1; then
  echo "the sync server did not start:" >&2
  cat "$DIR/sync.log" >&2
  exit 1
fi

cd "$ROOT/apps/web"
MATRIX_ADMIN="$ADMIN" "$ROOT/apps/sync/node_modules/.bin/tsx" scripts/auth-matrix.mts
