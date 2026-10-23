#!/usr/bin/env bash
# How long every screen takes to be usable, over a link as slow as the real
# one. A fresh copy of the app — a throwaway database with the demo sheet, the
# sync server LOCKED as production is (an admin token, no dev join code), and a
# PRODUCTION build of the web app — with apps/web/scripts/perf-bench.mts
# putting a slowed link in front of both and timing each page and each moment
# of a show.
#
#   pnpm test:perf                         all three links (~10 minutes)
#   PERF_PROFILES=singapore pnpm test:perf just one
#   PERF_OUT=before.json pnpm test:perf    keep the numbers to compare later
#
# The browser reaches both servers through the slowed link; the web server's
# own call to the sync server (the show page fetches the sheet's epoch while
# it renders) goes direct, as it does between two servers in one region.
# Spare ports, so it runs beside the dev servers on 3010/8787.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# PERF_OUT is read from apps/web below; keep a relative path relative to here.
if [ -n "${PERF_OUT:-}" ] && [ "${PERF_OUT#/}" = "$PERF_OUT" ]; then export PERF_OUT="$PWD/$PERF_OUT"; fi
DIR="$(mktemp -d)"
SYNC_PORT=8898
WEB_PORT=3198
SYNC_PROXY_PORT=18898
WEB_PROXY_PORT=13198
cleanup() {
  [ -n "${SYNC_PID:-}" ] && kill "$SYNC_PID" 2>/dev/null || true
  [ -n "${WEB_PID:-}" ] && kill "$WEB_PID" 2>/dev/null || true
  for p in $SYNC_PORT $WEB_PORT $SYNC_PROXY_PORT $WEB_PROXY_PORT; do lsof -ti tcp:$p 2>/dev/null | xargs kill 2>/dev/null || true; done
  rm -rf "$DIR"
}
trap cleanup EXIT

for p in $SYNC_PORT $WEB_PORT $SYNC_PROXY_PORT $WEB_PROXY_PORT; do
  if lsof -ti tcp:$p >/dev/null 2>&1; then
    echo "port $p is in use — stop whatever is on it first" >&2
    exit 1
  fi
done

# A throwaway key for a throwaway server; never printed.
ADMIN="$(openssl rand -hex 24)"

echo "▸ demo data"
PGLITE_DIR="$DIR/.pglite" node "$ROOT/packages/db/src/seed.ts" >/dev/null 2>&1 || { echo "the demo data did not load" >&2; exit 1; }

echo "▸ sync server (locked)"
(cd "$ROOT/apps/sync" && PGLITE_DIR="$DIR/.pglite" SYNC_PORT=$SYNC_PORT ADMIN_TOKEN="$ADMIN" ALLOW_DEV_JOIN=0 \
  PUBLIC_WEB_URL="http://localhost:$WEB_PROXY_PORT" exec node src/server.ts >"$DIR/sync.log" 2>&1) &
SYNC_PID=$!
for _ in $(seq 1 60); do curl -sf "http://localhost:$SYNC_PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done
curl -sf "http://localhost:$SYNC_PORT/health" >/dev/null || { echo "the sync server did not start:" >&2; cat "$DIR/sync.log" >&2; exit 1; }

echo "▸ web build"
# What the browser is told: the slowed link, not the server itself.
export NEXT_PUBLIC_SYNC_HTTP_URL="http://localhost:$SYNC_PROXY_PORT"
export NEXT_PUBLIC_SYNC_WS_URL="ws://localhost:$SYNC_PROXY_PORT"
export NEXT_PUBLIC_DOC_WS_URL="ws://localhost:$SYNC_PROXY_PORT/doc"
# PERF_SKIP_BUILD=1 reuses the last build — only for working on the timing
# script itself; a change to the app needs a fresh build to be measured.
if [ "${PERF_SKIP_BUILD:-}" = 1 ] && [ -d "$ROOT/apps/web/.next-perf" ]; then
  echo "  (reusing the last build)"
else
  (cd "$ROOT/apps/web" && NEXT_DIST_DIR=".next-perf" ./node_modules/.bin/next build >"$DIR/build.log" 2>&1) || { echo "the web app did not build:" >&2; tail -60 "$DIR/build.log" >&2; exit 1; }
fi

echo "▸ web server"
(cd "$ROOT/apps/web" && NEXT_DIST_DIR=".next-perf" SYNC_INTERNAL_URL="http://localhost:$SYNC_PORT" \
  exec ./node_modules/.bin/next start -p $WEB_PORT >"$DIR/web.log" 2>&1) &
WEB_PID=$!
for _ in $(seq 1 60); do curl -sf "http://localhost:$WEB_PORT/" >/dev/null 2>&1 && break; sleep 0.5; done

echo "▸ timing"
cd "$ROOT/apps/web"
ADMIN_TOKEN="$ADMIN" SYNC_URL="http://localhost:$SYNC_PORT" \
  WEB_UPSTREAM_PORT=$WEB_PORT SYNC_UPSTREAM_PORT=$SYNC_PORT \
  WEB_PROXY_PORT=$WEB_PROXY_PORT SYNC_PROXY_PORT=$SYNC_PROXY_PORT \
  node scripts/perf-bench.mts || { echo "--- sync log (tail)" >&2; tail -30 "$DIR/sync.log" >&2; exit 1; }
