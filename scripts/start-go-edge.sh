#!/usr/bin/env sh
# Optional two-process mode. This script expects a production build and Go binary.
set -eu
cd "$(dirname "$0")/.."
if [ ! -f dist/server.cjs ] || [ ! -f dist/index.html ] || [ ! -x dist/kentro-edge ]; then
  echo 'Build first: npm run build && npm run build:edge' >&2
  exit 1
fi
NODE_ENV=production HOST=127.0.0.1 PORT="${BACKEND_PORT:-3001}" node dist/server.cjs &
NODE_PID=$!
cleanup() { kill "$NODE_PID" 2>/dev/null || true; wait "$NODE_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
test "${BACKEND_PORT:-3001}" != "${EDGE_PUBLIC_PORT:-3000}" || { echo 'Backend/public ports must differ' >&2; exit 1; }
./dist/kentro-edge -listen ":${EDGE_PUBLIC_PORT:-3000}" -backend "http://127.0.0.1:${BACKEND_PORT:-3001}" -dist dist
