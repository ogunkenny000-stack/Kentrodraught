# Completion test results — 15 October 2026

These checks continue the owner's GitHub source through the recovery branch.
Current evidence files are `evidence/completion-*`; older `final-*` and checkpoint
results are historical. User-facing date uses Africa/Lagos; raw logs retain UTC.
No hosted Supabase or production infrastructure was modified.

| Check | Executed result and scope |
| --- | --- |
| `npm ci --include=dev --cache /workspace/.npm` | PASS; clean lockfile install, 299 installed packages, native postinstall initializes/searches |
| `npm run lint` | PASS; complete configured TypeScript check |
| `npm test` | PASS; **513 tests in 49 files** |
| `npm run build` | PASS; native search, Vite, service-worker injection, gzip/Brotli and server bundle; browser Auth separated from server classification |
| Native ASan/UBSan rules/build suite | PASS; **39 tests in 3 files** |
| `npm run migrations:check` | PASS; combined SQL matches every ordered source migration |
| `npm run test:database` | PASS; **35 PostgreSQL checks**: real roles/RLS, money transactions/concurrency, groups/consent/removal, CAS, funded canonical prizes, rollback and migration reruns |
| `npm run test:tournaments` | PASS; actual WS canonical moves/draws → worker → PostgreSQL standings; durable failed-result restart/replay and duplicates |
| `npm run test:restart` | PASS; actual SIGKILL in private game, wrong token denied, both seats/history/clocks restored, more play, draw, rematch killed/restored, no stale terminal result, SIGTERM/file permissions |
| `npm run test:multiplayer` | PASS; all **26 real loopback WS stages** |
| Two-browser PvP | PASS; real local WS moves/clocks/reconnect, resignation and rematch; voice transport explicitly SKIPPED |
| `npm run test:groups` | PASS; actual lounge/SDK + local Auth/HTTP adapter + PostgreSQL RLS, invite/accept/message/reload, oversized attachment rejection, microphone tracks ended on chat change |
| Media lifecycle unit tests | PASS within main suite; late capture after cancel, no new fallback permission prompts after cancel, adopted microphone cleanup; no peer transport claim |
| Production frontend browser journey | PASS; actual native AI, guest limits, resume/New, dialogs/keyboard and responsive board |
| TV browser journey | PASS with explicit replay/API fixtures; hosted data/push/share/export not certified |
| Recovery browser journey | PASS; validation/expired-session handling and explicit provider response fixture; real email/reset is pending |
| Offline browser journey | PASS; actual production worker installs/prepares Nearby and opens/reloads it with browser networking disabled; TV remains lazy |
| Static-serving + actual HTTP engine | PASS; built routes/cache/encoding/private artifacts, scored native response, invalid input, cancellation/cache and disconnect queue recovery |
| `npm run test:perf` | PASS; cache/compression byte equality/cleanup and engine queue invariants; not a capacity test |
| Optional Go race tests + vet | PASS with verified Go 1.27.2 and writable caches |
| Fresh production container | PASS; non-root Node 22, native search/static privacy, actual guest game SIGKILL/restart, resume tokens/history/clocks, paid-level denial, SIGTERM and completed archive restoration |
| `npm audit --json` | Zero known advisories at the scan time for the checked lockfile |
| `npm run test:hosted` without staging bindings | **PENDING, exits 2**; no hosted tests executed |
| Real-device media/Nearby | **PENDING/UNAVAILABLE** under managed Chromium UDP policy; zero prior ICE host candidates, no successful peer transport claimed |
| GitHub Actions new workflow | Prepared; next actual hosted CI execution is not claimed as already passed |

Local database URLs are explicitly disposable loopback fixtures. Their synthetic
Auth schema/role claims and the group HTTP adapter are not genuine hosted Auth,
PostgREST or Realtime. The opt-in staging test/template and acceptance/rollback
instructions are in [Supabase handoff](../SUPABASE_HANDOFF.md).

Browser external requests are blocked. UI/TV/recovery/PvP use loopback servers;
offline uses a dedicated `127.0.0.2` production listener to exercise the worker
instead of its intentional localhost development guard. The first offline check
found a listener bound only to `127.0.0.1`; adding the dedicated loopback listener
resolved that setup issue and the complete journey passed. Browser no-sandbox is
specific to this container. Group fixture Realtime deliberately fails; real polling
and PostgreSQL RPCs are exercised, with the limitation retained in the report.

Production builds retain the large-chunk advisory. Current main entry
`index-Ddv1nQpT.js` is 1,129,459 bytes raw, 311,162 gzip and 276,691 Brotli.
The bundle is still substantial on slower phones. Native LTO and Docker's
publishable-key-name lint warnings are recorded; the public browser build key
is intentionally synthetic/public, and private keys are not used as build args.
Dependency installation retained TLS/signature validation, using a BuildKit public
CA trust secret for the managed network. No TLS/signature bypass was used.

No real hosted account/email/Realtime, payment, withdrawal, push delivery,
production deployment, complete device/accessibility matrix or production
capacity certification is established. The final production image is `sha256:e56afaf1e5f6bd6b2220e846e154c82cea45f5cd8ba65d4844e938700e7a9302`,
362,623,824 bytes, UID 1000; graceful stop was 138 ms in this disposable run.
A temporary Docker build-cache space failure was resolved by pruning unused
local build cache before rebuilding and rerunning the complete container test.
No data volume was deleted. The source ZIP includes the required
8,503,280-byte native evaluation data; exact GitHub archive verification is the
final delivery step after the report commit.
