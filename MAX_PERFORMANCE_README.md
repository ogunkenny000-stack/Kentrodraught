# Kentro Draughts — Performance & Stability Pack (12 October 2026)

**This is the complete SOURCE project, not a live deployment.** It preserves the existing app design, Nigerian Draughts engine and rules, live WebSocket match protocol, offline nearby play, guest mode, Kentro TV and notifications. Supabase configuration must still be supplied by the operator.

## Improvements in this pack

1. **True lazy downloads / lower first-visit mobile data:** the service worker formerly installed by fetching every built JS/CSS route chunk; now it precaches only the application entry and startup styles. Unopened features stay undownloaded until requested; used chunks still enter the existing cache-first asset cache automatically. Offline use of a never-opened feature may require connecting once to load it.
2. **Zero per-request asset compression CPU:** production build prepares **Brotli + gzip** HTML, JS, CSS and text assets. Node and the optional Go reverse proxy negotiate supported encodings and serve these compressed files directly. API, rooms, balances and game state are never cached.
3. **Long-lived immutable caching for hashed bundles** and revalidation for the HTML shell / other files. Node-only hosting receives these benefits too; Go is NOT required.
4. **No abandoned engine searches:** superseded native-engine queue waiters now reject immediately instead of lingering indefinitely after being removed. One-shot lock release prevents queue corruption. Live/game priority jobs take precedence; high and low queues are bounded to protect small servers from burst memory/latency buildup. Saturation returns HTTP 503 + Retry-After rather than unlimited queue growth.
5. **More economical clock display:** visible clocks wake around the next displayed-second transition instead of polling every 250ms. Hidden tabs pause display scheduling and recompute the correct server-authoritative time on return. Clock values and server flag adjudication are unchanged.
6. **Lower mobile background work:** site-config refresh pauses in hidden tabs; lounge/live-room logic keeps its existing visibility protections. Noncritical outdated lobby snapshots can be skipped when a mobile WebSocket's send buffer is congested, keeping game moves/clock messages on their separate reliable path.
7. **Bounded avatar lookup cache:** max 320 entries / 45-minute TTL, preventing directories with thousands of players from growing retained memory without limit; own avatar updates still prime instantly.
8. **Smaller production hosting footprint:** production only loads Vite via dynamic import in development. Added a reproducible two-stage `Dockerfile`; compilers and dev packages are excluded from the final runtime. Compose persists `/app/data` with a named volume.

## Recommended setup (one small CPU server)

The **Node-only** approach avoids an extra process and is the first recommended deployment:

```bash
npm ci
npm run build
NODE_ENV=production PORT=3000 npm start
```

Set the public Supabase build variables **before building** (`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`). Provide private Supabase credentials **only at runtime** (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`), never as `VITE_` variables. Use a TLS reverse proxy for the public website (`wss://` for WebSocket). Do not run multiple independent Node game servers sharing one website unless rooms have been redesigned for shared state.

Alternatively, after creating a `.env` file containing the necessary non-public runtime secrets, run `docker compose up -d --build`. Its `kentro_game_data` volume preserves local sequence IDs and match records between container restarts.

If a benchmark shows it helps your host, optional Go edge instructions remain in `PERFORMANCE_UPGRADE.md`; on a tiny single-CPU host Go **may be slower** due to the extra process and proxy hop.

## Tests / validation

```bash
node scripts/performance-smoke.cjs
node --experimental-strip-types scripts/engine-mutex-smoke.mjs  # Node 22+
cd go-edge && go test ./... && cd ..
node scripts/build-engine.cjs
npm ci && npm run lint && npm test && npm run build
```

The first four groups were executed successfully during preparation. All 148 source TypeScript/TSX files were syntax-parsed with TypeScript, without syntax errors. Full `npm ci` did not complete in the preparation environment (missing offline package caches / installer failure), so full `tsc`, Vitest, production frontend build and end-to-end two-phone testing **are not verified here**. Check these on your build host before replacing your existing app.

## How to measure actual improvement

1. Compare **cold load** (clear app storage/cache) on the same mid-range Android phone and network, rather than just reloading a warmed cache. Use Chrome Performance/Network to compare transferred JS bytes, main-thread blocking and FPS while dragging/tapping.
2. Run the existing `node scripts/perf-smoke.cjs http://127.0.0.1:3000` against OLD and NEW services locally (do not point at production). Compare median/p95, RAM and CPU under equal conditions.
3. Run actual two-player scenarios: room invite, join, first move, forced multi-capture, reconnect, time loss, rematch, archive result, Kentro TV replay, mobile notifications.
4. Track WebSocket latency p50/p95, engine queueing / move time, Node heap/RSS and C++ engine RSS. Never claim a speedup without measurements against the old version on the intended CPU.
5. Load-test only a host you own, slowly. The authoritative room server is stateful; extra instances without shared room state can split a match.

No performance change can guarantee "peak" performance on every phone/network. This pack removes several avoidable costs while preserving correctness and offers a practical base for profiling real bottlenecks on your actual MVP hosting.
