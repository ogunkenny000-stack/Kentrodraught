# Kentro / Nigerian Draughts — repair notes

Date: October 6, 2026

## Scope

This is a repair of the supplied project, not a feature expansion or redesign. Existing game modes, difficulty settings, UI, source assets, dependency versions, and engine evaluation data are retained. Additional files are regression tests, repair documentation, and verification evidence.

The original uploaded ZIP was not modified. No deployment, live database migration, account change, or real wallet transaction was performed.

## Repairs made

### Engine, legal moves, and analysis

- Repaired engine extraction, initialization, and startup checks. The bootstrap now verifies a real native search instead of accepting the presence of a binary as proof that it works.
- Rebuilt the bundled x86-64 Linux executable from the existing C++ sources after the original executable crashed with an illegal-instruction signal in this environment. Sources, license, and evaluation data are retained.
- Corrected engine-request validation, search-depth reset, cancellation/preemption behavior, and cache handling so requests do not inherit stale shallow limits or unsuitable cached results.
- Fixed flying-king capture traversal across its vacated starting square and tightened move-notation parsing.
- Corrected terminal-position analysis, completion progress, and error handling rather than reporting an invented neutral evaluation when the engine fails.

The existing engine remains the engine. These changes do not establish an Elo increase, a fastest-engine benchmark, or a guarantee of perfect play.

### Online play, clocks, and session recovery

- Strengthened reconnect/session handling and validation of saved resume state.
- Prevented repeated clock resumes from refunding elapsed time, and banked elapsed time when a client processes a game-end event without a replacement clock snapshot.
- Resolve an already-expired clock before an offer or disconnection can pause it.
- Reject moves while an opponent is disconnected; preserve normal connected untimed play.
- Isolate failed socket sends so one broken recipient does not prevent the other player's result or final game record.
- Hardened incoming WebSocket message validation.

### Wallet-related match flow and saved records

- Added stricter numeric validation in existing wallet operations.
- Keep the exact charged participants across asynchronous pricing/debit operations, refund those participants if the seating changes, and prevent a previous game's delayed settlement from marking a new rematch's pot settled.
- Preserve dirty state after failed record writes, retry asynchronous failures, and wait for all in-flight file writes before subsequent flushes.
- Recover the game-code sequence from existing October–December codes as well as seven-digit codes. The existing code format has not been redesigned.

Wallet and settlement tests use mocks. They do not certify live ledger/database atomicity or real-money safety.

### Build and offline behavior

- Repaired service-worker cache/update handling and production asset injection.
- Corrected build/runtime packaging and the Docker recipe without upgrading the dependency lockfile.

## Verified results

The final executable checks were run on the source snapshot included in this delivery. Adding this note and the verification evidence does not change those source files.

| Check | Result |
| --- | --- |
| Complete Vitest suite | **246 tests passed in 17 test files** |
| TypeScript `tsc --noEmit` | Passed, exit 0 |
| Native engine initialization and actual search | Passed |
| Vite production client build | Passed, exit 0 |
| Service-worker asset injection | Passed, exit 0 |
| esbuild production server bundle and source map | Passed, exit 0 |
| Production server startup and native-engine warmup | Passed, confirmed by process output |

The rule suite includes complete-game invariants over 40 games and native-engine move legality checks. Multiplayer regression tests exercise the actual message dispatcher with fake sockets and mocked wallets, including expired clocks, disconnected moves, participant changes, refunds, and rematch settlement races.

Verification used Node.js 26.10.0 and integrity-checked dependency packages pinned by the supplied lockfile. The sandbox has no npm executable, so the corresponding installed CLI entry points were run directly; `npm ci` itself was not tested here. The included Dockerfile targets Node.js 22, but a Docker image was not built in this environment.

Exact commands, exit statuses, and output are included under `repair-verification-2026-10-06/`. The large-client-chunk warning is retained in the build log: the main JavaScript bundle is approximately 1.84 MB, or 444 KB gzip. No load-time or throughput benchmark is claimed.

## Checks still required in your environment

The sandbox rejects even localhost TCP requests with `Network is unreachable`. Server startup is therefore **not** an HTTP, browser, or end-to-end pass. Browser smoke testing and real network behavior could not be verified here.

Before using this with live users or balances, validate in a staging environment:

1. Sign-up/sign-in, sign-out, profile creation, and session recovery with your Supabase configuration.
2. Two-device timed and untimed games, legal captures, promotions, draw/resign flows, disconnect/rejoin, rematches, and series completion.
3. Wallet debits, refunds, and rematch payouts using test balances, including disconnects during charging and delayed database responses.
4. Saved-game history and recovery after a server restart, including failed/retried persistence.
5. Existing voice/video/media flows with actual browser permissions and network conditions.
6. Service-worker update, installation, and offline behavior in a real browser.
7. The Docker image and your expected concurrent load.

## Setup

Extract into a separate directory. Keep your existing secrets and live `data/` safe; do not overwrite them with files from an archive.

1. Copy `.env.example` to `.env` and fill in the configuration required by the existing features you use. Supply `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` before the client production build. Keep `SUPABASE_SECRET_KEY` server-side; never expose it as a `VITE_` variable.
2. Install from the lockfile with `npm ci`.
3. Run `npm run lint` and `npm test`.
4. Run `npm run build`, then `npm start`. Use `npm run dev` for the existing development workflow.

The install/build scripts run the native-engine bootstrap. It needs an available archive extractor (`unzip` or Python 3). The included executable targets x86-64 Linux/glibc 2.28; other supported host architectures need a local rebuild with the existing C++/make toolchain. For Windows, use a suitable Linux environment such as WSL or the included Docker setup. A bootstrap failure should be resolved, not ignored.

Build locally with your own public configuration: the temporary production build used for verification is not included as a deployment-ready `dist/` directory.

## Native executable provenance

Archive entry: `nd_upgraded.zip` → `nd_upgraded/scan_nigerian`.

The portable verification build used Zig 0.14.1's C++ driver with C++14, optimization level O2, the `x86_64-linux-gnu.2.28` target, and baseline CPU instructions. The project's bootstrap retains its normal rebuild path for other supported hosts.

SHA-256 of the included executable:

`575d7f206fef339b8f4336dfb78458b4c44b51c5e11ceaf8829841c5513e7d05`

The original engine license remains at `nd_upgraded/LICENSE` inside the engine archive. This repair is not a guarantee that every possible device, deployment, failure mode, or live-service integration has been exercised.
