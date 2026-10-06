#!/usr/bin/env bash
# Every screen at phone, tablet, laptop and desktop sizes, against a fresh
# copy of the app: a throwaway database with the demo sheet, the sync server,
# and a PRODUCTION build of the web app (so a build that would fail on Railway
# fails here first). Then apps/web/scripts/layout-audit.mts measures it.
#
#   pnpm test:layout
#
# Spare ports, so it runs beside the dev servers on 3010/8787.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$(mktemp -d)"
SYNC_PORT=8897
WEB_PORT=3197
cleanup() {
  [ -n "${SYNC_PID:-}" ] && kill "$SYNC_PID" 2>/dev/null || true
  [ -n "${WEB_PID:-}" ] && kill "$WEB_PID" 2>/dev/null || true
  rm -rf "$DIR"
}
trap cleanup EXIT

for p in $SYNC_PORT $WEB_PORT; do
  if lsof -ti tcp:$p >/dev/null 2>&1; then
    echo "port $p is in use — stop whatever is on it first" >&2
    exit 1
  fi
done

echo "▸ demo data"
(cd "$DIR" && node "$ROOT/packages/db/src/seed.ts" >/dev/null)

echo "▸ sync server"
(cd "$ROOT/apps/sync" && PGLITE_DIR="$DIR/.pglite" SYNC_PORT=$SYNC_PORT PUBLIC_WEB_URL="http://localhost:$WEB_PORT" \
  node src/server.ts >"$DIR/sync.log" 2>&1) &
SYNC_PID=$!
for _ in $(seq 1 60); do curl -sf "http://localhost:$SYNC_PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done
curl -sf "http://localhost:$SYNC_PORT/health" >/dev/null || { echo "the sync server did not start:" >&2; cat "$DIR/sync.log" >&2; exit 1; }

echo "▸ web build"
export NEXT_PUBLIC_SYNC_HTTP_URL="http://localhost:$SYNC_PORT"
export NEXT_PUBLIC_SYNC_WS_URL="ws://localhost:$SYNC_PORT"
export NEXT_PUBLIC_DOC_WS_URL="ws://localhost:$SYNC_PORT/doc"
# Its own build folder, so a dev server's .next is never touched.
(cd "$ROOT/apps/web" && NEXT_DIST_DIR=".next-layout" npx next build >"$DIR/build.log" 2>&1) || { echo "the web app did not build:" >&2; tail -60 "$DIR/build.log" >&2; exit 1; }

echo "▸ web server"
(cd "$ROOT/apps/web" && NEXT_DIST_DIR=".next-layout" npx next start -p $WEB_PORT >"$DIR/web.log" 2>&1) &
WEB_PID=$!
for _ in $(seq 1 60); do curl -sf "http://localhost:$WEB_PORT/" >/dev/null 2>&1 && break; sleep 0.5; done

echo "▸ measuring"
cd "$ROOT/apps/web"
SYNC_URL="http://localhost:$SYNC_PORT" node scripts/layout-audit.mts "http://localhost:$WEB_PORT"
