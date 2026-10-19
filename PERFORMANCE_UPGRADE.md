# Kentro MVP performance upgrade — 2026-10-12

## What changed (no visual redesign)

- **Less JavaScript on first visit.** The TV, tournament, chat lounge, offline-nearby, puzzles, admin console, archive, analysis laboratory, profile, directory, and friends screens now use React code-splitting. Only load their bundles on first visit to each feature; core gameplay stays unchanged.
- **Less polling when the phone isn't being used.** Live-room refresh pauses for hidden tabs and resumes when displayed. The online lobby still gets a refresh immediately when entered.
- **Smaller opening history request.** Personal history initially requests at most 120 newest rows instead of 1,000; opening the match archive requests the full 1,000-record page. No records are deleted.
- **Optional Go HTTP/WebSocket edge.** Serves public files, forwards `/api/*` and WebSocket upgrades to the existing authoritative Node server. Includes long-cache headers for content-hashed static assets, uncacheable API requests, and compressed JS/CSS/HTML created once during build. Go does **not** implement game rules, authentication, coins, or tournament adjudication. The existing service worker keeps the same conservative caching policy.
- **Private Node listener when Go is used.** The app supports `HOST=127.0.0.1`, so the backend port need not be exposed.

## How to run

### Option A — simplest for a small host (default)

```
npm ci
npm run build
NODE_ENV=production PORT=3000 npm start
```

This keeps the **same** existing server topology. Frontend optimizations work in both modes. Use this if the Go edge adds unwanted RAM or process complexity.

### Option B — optional Go networking entry point

Requires Node.js (project runtime) and Go 1.23+ on the build machine.

```
npm ci
npm run build
npm run test:edge
npm run build:edge
./scripts/start-go-edge.sh
```

- Public frontend, API, and WebSocket endpoint: **port 3000** (Go).
- Private gameplay/backend endpoint: **127.0.0.1:3001** (Node).
- Configure HTTPS at your hosting reverse proxy/load balancer (for `wss://` too). Only expose port 3000 externally; keep 3001 firewalled. To change ports, set `EDGE_PUBLIC_PORT` and `BACKEND_PORT`.
- Go proxies the original same-origin WebSocket path `/` (and any future upgrade path), preserving existing room ids, session tokens, game clocks, and match logic.
- Restart both services on deployment. For production, supervise both processes with your host's service manager. `start-go-edge.sh` is a convenience runner, not a full process supervisor.
- **Don't start two instances of the Node game server** as a "scaling trick": its rooms are process-local and players in different instances wouldn't see the same games. True horizontal scaling requires shared authoritative room state/sticky sessions.

## Verification and benchmarks

```
# Go HTTP/static/API/upgrades test (works without npm dependencies)
cd go-edge && go test ./...

# TypeScript checks and game-protocol regression tests (require npm ci)
npm run lint
npm test

# Build frontend and server
npm run build
```

Run a **real two-player online match** (host, guest, reconnect, rematch, time loss) and watch a game through Kentro TV before enabling the Go edge on your live site. Compare median/p95 response times, WS RTT, CPU %, and RAM under similar load. It may be better to stick with the single Node process on very small servers. The Go edge is not a replacement for measuring slow DB calls, expensive AI searches, client frame rate, or poor mobile data connections.

## Important cautions

- Don't cache private API responses, balance changes, moves, or invitation status.
- Don't expose secret keys in `VITE_` variables. Keep Supabase service keys server-side.
- `go-edge` is a transparent reverse proxy for gameplay. It **does not** make engine search faster. AI search depth and concurrency must be tuned independently for the available CPU.
- The Go test suite covers routing, cache policy, HTTP forwarding, and successful WebSocket upgrade; full production build / live multiplayer remains to be checked wherever npm dependencies can't be installed.
- The historical 1,000-record cap remains; implement cursor pagination in a separate iteration if large player archives become common.
