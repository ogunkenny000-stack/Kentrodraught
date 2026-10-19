# Performance and resources — 15 October 2026

Node remains the default deployment. The optional Go edge serves browser
assets and forwards HTTP/WebSocket traffic; it does not improve move authority
or reduce native engine search memory by itself.

## Measurements and their limits

The saved checkpoint contains fifteen loopback stages at 2, 10, 25, 50 and 100
clients: direct Node, Go edge, then a direct Node repeat. Historical evidence
reports 3,348 validated relays and zero failures. At 100 clients, direct Node
p95 was approximately 3.221/4.197 ms, versus 26.656 ms through Go.
This supports keeping Node as the default, not a production capacity promise.
Those stages precede current repairs and are not claimed as rerun results.
See [measurement metadata](evidence/performance-metadata-20261015.json) for
the recorded versions, resource limits, binary identities and process scope.

The recorded entry JavaScript was 1,134,327 bytes raw, 312,931 gzip and 278,048
Brotli. It remains a substantial initial payload on slower mobile networks.
New final build hashes/sizes belong in the consolidated validation report;
the older measurement is retained rather than relabeled as current.

The resumed audit also ran a fresh thirty-request sequential loopback HTTP
smoke against the built Node application: `/` p50/p95 3.4/13.3 ms and
`/api/games/recent?limit=1` 1.9/3.6 ms. Browser verification shared the machine.
These timings describe this short local run and do not establish capacity.

The C++ engine runs in a separate process. Node RSS alone excludes its
transposition table, evaluation weights and search allocations. Capacity
planning must measure the container or full process tree under real engine,
database and multiplayer workloads. Short loopback guest tests omit hosted
authentication, database latency, WebRTC media and production traffic patterns.

## Verified delivery repairs

Both static servers negotiate gzip/Brotli/identity preferences, include
`Vary: Accept-Encoding`, reject fully excluded encodings and return 404 for
missing scripts instead of an HTML success response. The current Go review
also denies extensionless native binaries, unsupported file types and direct
compressed-file URLs. Final resolved paths, including SPA fallback, must
remain within the public build directory; symlink regressions exercise this.
Backend bundles and source maps are denied.

Precompression now removes obsolete gzip/Brotli files when a source becomes
small, becomes incompressible or is removed. This prevents a repeated build
from serving compressed bytes from an older source. Fresh
`node scripts/performance-smoke.cjs` passed byte-perfect decompression,
compression cleanup and Nearby/startup precache checks. `go test -race ./...`
and `go vet ./...` also passed after the current edge changes.
Their fresh command output is retained in
[Go evidence](evidence/go-edge-continuation-20261015.txt).

The service worker precaches the startup and Nearby static dependency closure;
TV remains lazy. This preserves Nearby cached loading without downloading
every optional screen at installation. Cached loading does not certify an
actual two-device WebRTC connection.

`node scripts/perf-smoke.cjs http://127.0.0.1:PORT` is a small sequential local
HTTP timing check: requests have deadlines and non-success responses fail.
It is deliberately limited to loopback and is not a load/capacity benchmark.
