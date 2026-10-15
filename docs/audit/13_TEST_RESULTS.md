# Final test results — 15 October 2026

The continuation began at the owner's GitHub checkpoint `35bed25`. Results below are fresh local checks, separate from `CHECKPOINT_VALIDATION.md` and the earlier checkpoint's 401 tests. Sanitized raw outputs are saved under `evidence/final-*`; Docker/Go/SQL evidence has named continuation files. User-facing dates use Africa/Lagos; raw runner timestamps retain their recorded UTC/timezone.

| Check and command | Result and scope |
| --- | --- |
| `npm ci --include=dev --cache /workspace/.npm` | PASS; clean lockfile install, 299 packages; native postinstall initialized and searched |
| `npm run lint` | PASS; TypeScript with React 19 types |
| `npm run build` | PASS; native freshness/search, Vite, service-worker injection, gzip/Brotli and Node bundle |
| `npm test` | PASS; 468 tests in 43 files |
| `NATIVE_RULES_SANITIZE=1 npx vitest run src/nativeRules.audit.test.ts src/rules.audit.test.ts src/engineBuild.audit.test.ts` | PASS; 39 tests in 3 files with native ASan/UBSan probe |
| `AUDIT_PG_URL=postgresql://postgres@127.0.0.1:55432/postgres npm run test:database` | PASS; 26 real PostgreSQL role, transaction, concurrency and migration checks in disposable databases |
| `npm run migrations:check` | PASS; combined SQL matches ordered migration sources |
| `npm run test:multiplayer` | PASS; all 26 actual loopback WebSocket stages |
| Browser `scripts/e2e/pvp.e2e.ts` | PASS; independent contexts, real local WS moves/clocks/reconnect/resign/rematch; `E2E_SKIP_MEDIA=1` explicitly skips voice |
| `npm run test:browser` | PASS; guest/auth UI, actual native AI, resume/New, quotas, modal focus and responsive board |
| `npm run test:tv` | PASS; explicit local replay/API fixtures; hosted data and push are not tested |
| `scripts/e2e/recovery.e2e.ts` | PASS; real recovery form validation, expired session, explicit provider-response fixture and continuation |
| `npm run test:offline` | PASS; production service worker prepares Nearby and opens/reloads it while browser networking is disabled |
| `npm run test:nearby` | UNAVAILABLE; zero host ICE candidates under managed Chromium policy; not a passing peer transport |
| `node scripts/static-serving-smoke.mjs http://127.0.0.1:8126` | PASS; actual built assets, negotiated raw bytes, cache headers, private artifacts and missing routes |
| `ENGINE_AUDIT_URL=http://127.0.0.1:8126 node scripts/audit/engine-http.mjs` | PASS; actual native scores, invalid input, terminal loss, cancellation/cache and disconnect queue recovery |
| `npm run test:perf` | PASS; precache/compression cleanup/byte equality and queue behavior |
| Go `go test -race -count=1 ./...`, `go vet ./...` | PASS; verified optional Go 1.27.2 toolchain, independent of the core app |
| `npm run test:container -- kentro-audit:20261015 ...` | PASS; non-root runtime, health, native search, actual two-client production gameplay, SIGTERM and durable record restart |
| `npm audit --json` | Zero known advisories in the final checked lockfile; dated scanner result |
| `git diff --check` | PASS |

Browser commands use `CHROME_NO_SANDBOX=1` only for this container and an explicit loopback `E2E_APP_URL`. Normal UI/TV/recovery use `http://127.0.0.1:8126`; offline uses `http://127.0.0.2:8126` to exercise the production worker rather than its intentional localhost development guard. External browser requests are blocked. The PvP browser uses a disposable development listener without hosted credentials; the container additionally exercises production guest socket admission.

Two browser harness problems were investigated: clearing a controlled input through a synthetic fill left stale component state, and an animated drawer target moved during a click. The harness now types a short invalid username and waits for stable clickable controls, preserving all validation/navigation assertions. The final journeys pass. An early native evaluator-cache test used a stale executable before rebuild; fresh rebuild and the final suite pass without weakening its assertions. The initial Docker restart harness also refreshed its ephemeral published port after restart; complete runtime checks then passed.

## Not executed or not established

No genuine Supabase hosted Auth/email/RLS/Realtime, real payment or prize, production deployment, physical-phone Nearby/media, real push delivery, full browser/device matrix or production capacity test was completed. Earlier checkpoint load measurements remain historical. A complete tournament worker and persisted groups are unfinished. See report 14 before release.

The final built entry is `index-D8zFNHhx.js`: 1,129,449 bytes raw, 311,153 gzip and 276,465 Brotli. This is still large. The fresh short shared-machine HTTP smoke observed / p50/p95 3.4/13.3 ms and recent-games 1.9/3.6 ms, 30 requests each; these are not production SLAs.
