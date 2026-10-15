#!/usr/bin/env sh
# Optional two-process mode. This script expects a production build and Go binary.
set -eu
cd "$(dirname "$0")/.."
if [ ! -f dist/server.cjs ] || [ ! -f dist/index.html ] || [ ! -x dist/kentro-edge ]; then
  echo 'Build first: npm run build && npm run build:edge' >&2
  exit 1
fi
BACKEND_PORT=${BACKEND_PORT:-3001}
EDGE_PUBLIC_PORT=${EDGE_PUBLIC_PORT:-3000}
for port in "$BACKEND_PORT" "$EDGE_PUBLIC_PORT"; do
  case "$port" in ''|*[!0-9]*) echo 'Ports must be integers' >&2; exit 1;; esac
  [ "$port" -ge 1 ] && [ "$port" -le 65535 ] || { echo 'Ports must be 1..65535' >&2; exit 1; }
done
[ "$BACKEND_PORT" != "$EDGE_PUBLIC_PORT" ] || { echo 'Backend/public ports must differ' >&2; exit 1; }
# Only the loopback edge may supply client forwarding headers. The backend is
# deliberately bound to loopback so it cannot be reached around that edge.
NODE_ENV=production TRUST_PROXY=loopback HOST=127.0.0.1 PORT="$BACKEND_PORT" node dist/server.cjs &
NODE_PID=$!
EDGE_PID=''
cleanup() {
  [ -z "$EDGE_PID" ] || kill "$EDGE_PID" 2>/dev/null || true
  kill "$NODE_PID" 2>/dev/null || true
  [ -z "$EDGE_PID" ] || wait "$EDGE_PID" 2>/dev/null || true
  wait "$NODE_PID" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
attempt=0
until BACKEND_PORT="$BACKEND_PORT" node -e 'fetch("http://127.0.0.1:"+process.env.BACKEND_PORT+"/api/health", {signal:AbortSignal.timeout(500)}).then(async r=>{if(!r.ok||(await r.json()).component!=="kentro-node")process.exit(1)}).catch(()=>process.exit(1))'; do
  kill -0 "$NODE_PID" 2>/dev/null || { echo 'Node exited before readiness' >&2; exit 1; }
  attempt=$((attempt+1))
  [ "$attempt" -lt 40 ] || { echo 'Node readiness timed out' >&2; exit 1; }
  sleep 0.25
done
./dist/kentro-edge -listen "${EDGE_PUBLIC_HOST:-0.0.0.0}:$EDGE_PUBLIC_PORT" -backend "http://127.0.0.1:$BACKEND_PORT" -dist dist &
EDGE_PID=$!
# A companion failure stops both children; production should still use the
# host's service manager to restart this runner after a failure.
while kill -0 "$NODE_PID" 2>/dev/null && kill -0 "$EDGE_PID" 2>/dev/null; do sleep 1; done
echo 'A Kentro process stopped; shutting down its companion' >&2
exit 1
