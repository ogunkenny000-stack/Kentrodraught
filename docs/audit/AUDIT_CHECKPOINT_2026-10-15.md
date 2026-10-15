# Kentro Draughts — audit checkpoint, 15 October 2026

## Status and scope

**Audit paused at the owner's request; this is a work-in-progress checkpoint, not production certification.** The owner requested that the current repairs and a full account of work completed be saved immediately to GitHub branch `codex-audit-recovery-20261014`.

The starting commit was `090e8d9c2ceac66c309e0d8179cfeb8172c3d546`. Work covers the React interface, Node HTTP/WebSocket backend, native C++ engine, optional Go proxy, service worker, Supabase authorization and transactional SQL, dependency installation, containers, and automated verification. Local source and migration files were changed; production was not deployed and hosted database migrations were not applied. No production credentials are included.

This report distinguishes executed checks from outstanding work. Earlier subsystem checks were made during development and do not automatically certify every later edit. The checkpoint validation section records the final checks attempted on this snapshot.

## 1. Architecture and environment

The application uses React/Vite and an Express/WebSocket backend. Computer play calls a native C++ engine through the server; it is not a fully browser-contained offline engine. Authoritative rooms validate moves and maintain clocks on the server. Room state remains in memory; restart recovery of live games is not established. Game archives also use local JSON storage, with optional Supabase synchronization. The Go reverse proxy is optional.

Node 24.19.0/npm 11.9.0 were used locally. Native compilation and actual search succeeded. Go 1.27.2 and disposable PostgreSQL 17.11 were prepared for isolated checks. Chromium was available for real browser automation. Dependencies were installed with a writable npm cache. An independent frozen-lock installation installed 343 packages successfully. Reusable cloud-environment configuration publication remains unfinished.

See [architecture inventory](01_ARCHITECTURE.md) and [machine-readable inventory](inventory.json). Inventory reflects its generation time, not necessarily every final checkpoint addition.

## 2. Build and dependency repairs

Compatible dependency updates reduced the earlier audit result of 30 advisories (2 critical, 22 high, 6 moderate). The last dependency audit reported zero production advisories and seven high development-tool advisories in the browser-download/archive/FTP dependency chain. This is a dated scanner result, not a guarantee of security. Development-only Vite plugins were moved out of production dependencies and the lockfile was regenerated.

Native build fingerprinting now includes relevant source, headers, build logic, weights, and executable verification to avoid silently reusing stale binaries. Production assets receive gzip/Brotli variants and service-worker asset injection. `npm run lint` means TypeScript checking; there is no separately established ESLint pass.

## 3. Interface, accessibility, and local play

Changes address mobile guest account gates, form labels and error announcements, password-reveal focus, modal behavior, nested buttons, privacy controls, and custom-position propagation. AI New Game invocation was corrected so a click event could not become a board. Navigation preserves a resumable AI game; explicit New Game clears it. Request generations prevent a stale AI reply from applying after navigation/reset.

Executed browser journeys covered sign-in/register/reset form validation, actual native AI response, resume/New behavior, dialogs, mobile gating, and horizontal-overflow checks at widths 320, 360, 375, 390, 414, 768, 1024, and 1440 plus landscape 844×390. These are local UI checks, not proof of hosted email delivery, registration, or authenticated Supabase workflows.

## 4. Nigerian draughts rules

Native king captures incorrectly discarded terminal landing choices when another landing could continue; continuation is now evaluated per landing. Move lists exceeding 128 choices now use safe overflow storage, and a sorting sentinel boundary was repaired. Fixtures exercise 128, 129, 154, and 512 entries. Native immediate material draws were replaced with historical 10/32/50-ply counters and win priority. Dense FEN validation was tightened; custom starting boards and first movers now inform local adjudication.

Sanitizer verification previously passed 39 tests across three audit files. A further 62 existing rules/request tests passed. Native/TypeScript parity sampled 300 seeded positions and a 100-ply legal playout, alongside explicit expected capture and draw fixtures. These checks do not prove every reachable position. The external credited rules manual was unavailable. Legacy Kivy code and the unused material-only draw helper were not modernized.

See [detailed rules report](04_NIGERIAN_DRAUGHTS_RULES.md).

## 5. AI engine

Actual native build and search were verified. The audit also reproduced evaluator contamination through a persistent transposition table: changing evaluator could reuse scores from the prior evaluator. The engine now clears that table when the evaluator changes; a persistent-HUB regression was added. The native executable was rebuilt after this change.

Recorded benchmarks include opening, kings, forced capture, lone-king and stress positions. Timing varies, and cooperative search budgets are not hard latency guarantees. A FEN-only engine request lacks the game's earlier history, so browser/server history adjudication remains responsible for historical draws. See [AI report](09_AI_ENGINE.md), [benchmark](engine-benchmark.json), and [resource measurements](engine-benchmark-resources.json).

## 6. Online multiplayer

Repairs and checks cover legal canonical moves, turn/sequence validation, clocks, reconnect/resume, consent before joining, resignation/draw/rematch, private-room discovery and spectator restrictions, guest limits, and spectator move denial. An actual WebSocket smoke journey completed 26 stages. A browser PvP journey passed creation, consent/join, bidirectional moves/capture, clocks, reconnect, resignation and rematch in independent browser contexts.

Identity is being enforced through verified auth UID and canonical profile ownership rather than editable user metadata. The checkpoint includes active moderation revocation and production fail-closed identity checks. Local development fixtures do not establish production hosted authentication. See [multiplayer report](05_ONLINE_MULTIPLAYER.md) and [protocol](../ONLINE_PLAY_PROTOCOL.md).

## 7. Authentication, authorization, and privacy

New server account-auth routes resolve usernames privately, use isolated Supabase auth clients for password grants, return generic invalid-login responses, and make password-reset responses conditional/non-enumerating. Public username-to-email RPC access is revoked in SQL; only the service role retains it. The client now calls the server for username sign-in and reset instead of retrieving email addresses. Five HTTP fixture tests passed for session handling, enumeration resistance, reset behavior, input bounds, and fail-closed configuration/upstream errors.

Other repairs include canonical UID binding, ban checks, reserved house-account protection, restrictions on official game records and private UIDs, removal of an arbitrary-SQL administration fallback, and withdrawal eligibility bound to the authenticated user. A focused moderation/authentication review reported 32 WebSocket tests and route checks passing.

**These changes require review and staging migration execution.** Source edits alone do not alter hosted permissions. No Supabase connector or configured project credentials were available in this session despite the user's reference to draught.com.

## 8. Database and money-like operations

New migrations implement authorization policies and transactional wallet operations, including purchase approval, withdrawals, paid unlocks, tournament entry, payouts and refunds. Disposable PostgreSQL checks exercised real SQL roles, permissions, atomicity, repeated requests, concurrent operations and rollback rather than relying solely on mocks.

The last completed reported database run passed 20 checks. Additional tournament concurrency assertions exist in the checkpoint script; their final execution status must be read from checkpoint evidence rather than inferred from their presence. SQL rollback scripts exist for authorization, wallet and rating migrations. The email-privacy migration has no dedicated rollback file; do not blindly restore public email lookup access.

Reproduction harness: `scripts/audit/database-security.mjs`, using only an explicitly selected disposable PostgreSQL target. Do not point this fixture harness at production.

## 9. Ratings and statistics

Client-side authoritative rating/statistic and paid-level updates were removed. The server path uses Glicko-2, canonical completed multiplayer results, ordered profile locking, version checks/recalculation and a unique rated-game ledger to prevent duplicate or overlapping updates. Pending synchronization is persisted and retried. The client refreshes canonical results after completion and retains verified profile state on failure.

Focused rating/database tests covered duplicate results, concurrent overlapping games and rollback if the second profile update fails. End-to-end hosted staging verification of this complete path remains outstanding. Local practice and AI games are unranked; tournament results must not be fabricated by the browser.

## 10. Tournaments, TV, social, and notifications

Simulated tournament competitors, random spectator positions/reactions/logs and invented online counts were removed. Missing real feeds now have truthful UI states. A complete authoritative tournament scheduling/pairing/live-board pipeline is not certified and remains unfinished. Private tournament read policies/invite disclosure were identified as needing further review; do not treat private-tournament confidentiality as resolved.

TV replay handling and guest navigation received fixes. Push changes preserve local unsubscribe even when server deletion fails, and notification clicks avoid forcibly reloading an active game. Seventeen focused push/service-worker tests were reported passing. Real VAPID delivery, hosted social flows, and a complete final TV browser pass are not established by this checkpoint.

## 11. Nearby and offline behavior

Production service-worker checks confirmed that initial load prepares the Nearby dependency closure, excludes TV from that precache, and supports opening and reloading the offline route with browser networking disabled. Nearby rule validation and local state handling received tests and repairs.

Actual peer transport could not be completed in this environment: managed Chromium enforces `WebRtcIPHandling=disable_non_proxied_udp` and produced no ICE candidates. This policy was not bypassed. Voice was likewise explicitly skipped. Physical-device Nearby/voice testing remains necessary; successful cached loading is not successful peer pairing.

## 12. Performance and HTTP delivery

Static delivery fixes cover compression quality negotiation, `Vary`, raw-byte equivalence, private server bundle/map/environment-file denial, missing assets and a sendFile callback that could previously continue after success and reset responses. Graceful server/engine shutdown was improved. Go encoding handling now rejects cases where all supported representations are forbidden.

Fifteen loopback benchmark stages tested direct Node, Go proxy, then direct Node again at 2/10/25/50/100 clients: zero failures and 3,348 validated relays. At 100 clients direct p95 was approximately 3.221/4.197 ms versus Go 26.656 ms. Node remains the default. This short local benchmark used guest rooms without hosted DB or AI workloads; it is not a production capacity SLA.

A measured main JavaScript asset was 1,134,327 raw bytes, 312,931 gzip and 278,048 Brotli. Bundle size remains a concern. See [measurement conditions](evidence/performance-metadata-20261015.json) and adjacent raw evidence files.

## 13. Containers and deployment

A dependency-pruned image was built at approximately 345.6 MiB, running as a non-root user with development compiler/build tools absent from runtime. Checks exercised startup, engine health, persistent marker survival across restart, static byte correctness, two-client gameplay and graceful WebSocket shutdown. Recorded shutdown completed in approximately 173 ms with exit zero.

**That image predates the last authentication/rating/native edits.** It must be rebuilt and tested before release. Persistent game storage needs a correctly mounted writable location; a proposed configurable data-directory improvement was not completed at the pause. Never assume a platform mount automatically matches the application's data path. No hosting resources were provisioned or production deployment performed.

## 14. Remaining work and release risks

- Complete the authoritative tournament pipeline and private tournament/invite policy review.
- Run all migrations against an isolated Supabase staging project; verify genuine login, password reset, role policies, ratings, social and wallet flows there.
- Review SQL migration ordering, combined-script consistency, and rollback procedures before any hosted application.
- Rebuild the container from the saved commit and rerun runtime tests; confirm durable storage and restart behavior. Live rooms currently lack proven restart recovery.
- Verify Nearby and voice on permitted real devices/networks; validate real push delivery.
- Complete final TV/social/tournament browser coverage and accessibility/device coverage.
- Resolve remaining development-tool advisories when compatible fixed dependencies become available; reduce the main bundle where justified by measurements.
- Complete reusable cloud setup configuration and the originally requested sixteen-report audit package. This consolidated checkpoint and existing detailed reports preserve the work already done.

## 15. Readiness assessment

The local development workflow is substantially repaired and exercised. **Production readiness is not established.** No final numerical quality score is assigned because the owner paused the audit before completion; assigning a precise score would imply coverage and closure that have not been demonstrated.

A release should use a reviewed commit, backed-up database, staging migration rehearsal, verified environment bindings and durable storage, final image tests and a defined rollback. Revert application code and SQL deliberately together; do not assume a code revert reverses schema or data changes. No deployment approval is requested by this checkpoint.

## 16. Checkpoint validation and delivery

Fresh TypeScript, complete unit/regression suite and production build checks were started immediately before saving this checkpoint. Their exact results are recorded in `CHECKPOINT_VALIDATION.md` and corresponding sanitized build/test logs in `evidence/`.

The intended delivery is a normal, non-force push to `origin/codex-audit-recovery-20261014`. If authentication prevents it, the local commit and patch bundle preserve the work, but they are not equivalent to a successful GitHub save. Delivery status will be stated explicitly to the owner.
