# Kentro Draughts finance rollout review — 18 October 2026

**Release decision: HOLD. Financial migration not installed; no production deployment or money activation performed.**

Target: `draught.com`, project `pwovowlyylceuzontdhg`. This report supersedes the earlier source-preparation status. The user authorized careful installation, but required gates remain unmet. No new live DDL, wallet write, synthetic transaction, purchase approval, withdrawal action, or bank transfer was executed by this task.

## Verified live preservation

Before snapshot: 2026-10-17T15:37:02.513024+00:00. After snapshot: 2026-10-18T05:44:41.106034+00:00 (UTC).

| Measure | Before | After |
|---|---:|---:|
| Wallet rows | 34 | 34 |
| Sum of balances | 3,035 | 3,035 |
| Ledger rows | 45 | 45 |
| Total credits | 3,945 | 3,945 |
| Total debits | 910 | 910 |
| Pending purchases | 1 | 1 |
| Pending withdrawals | 0 | 0 |

All individual wallet rows, including their balances, compared equal. Private snapshots remain outside this release. These audit snapshots are **not** independently restorable database backups.

The charge and settlement tables and `kentro_coin_readiness()` remain absent. Existing Ken claims and entitlement guard remain installed.

## Source and SQL repairs

- A cancelled match now stores a durable cancellation marker even when no charge has arrived. The charge checks that marker before reading a receipt, preventing a delayed request from debiting a cancelled game. The original installer was executed on a disposable PostgreSQL WASM replica and reproduced the unsafe cancellation-first ordering before this repair.
- Old ledger references cannot be charged again, and old payouts/refunds cannot be distributed again merely because they lack a receipt. Legacy settlement requires exactly one debit per player. Historical entries are never automatically credited, merged, or deleted.
- The manual profile guard now serializes initial profile claims, rejects duplicate identities, sets account age on the server, and creates a unique non-null owner index. Existing duplicates would abort the transaction for review; none were found in the live catalog inspection.
- The manual installer includes the narrow tournament invitation/visibility/entry and runtime/payout definitions used by this source. This fixes the live `tournament_entry` ambiguity (`balance` was both an output parameter and an unqualified column). It adds the two runtime columns and required tournament RPCs without applying the social/group history or combined migration bundle.
- Financial readiness also checks legacy wallet/tournament helpers, Ken claims, tournament runtime, the service role, and browser-role execution privileges. Merely creating the charge function cannot establish readiness.
- The rollback probe now checks draws, cancellation before charge, precise rejection reasons, and absence of synthetic wallets, ledger rows, receipts, and settlement markers.
- The built Node server previously crashed on `import.meta.env` in shared constants. The client feature flag now lives in a browser-only module; both React imports were reviewed using the React best-practices guidance. The server retains its independent database-gated switch.
- The test runners are separated correctly; the Ken proof test resolves the local TypeScript dependency. The interrupted-start test now checks the receipt-aware refund with the actual White/Black ordering. The native move-overflow fixture still exceeds 128 moves under the shipped rules. The evaluator-cache regression compares scores against a clean evaluation instead of relying on variable search-node ratios. No draughts rule or engine search behavior was changed.

## Tests and evidence

| Check | Result |
|---|---|
| `npm ci` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS: 527 tests in 50 files |
| `npm run test:coin-safety` | PASS: 21 checks |
| `npm run test:preflight` | PASS: 8 checks |
| `npm run test:supabase-contract` | PASS: 6 evaluator tests; does not mean the live schema is ready |
| `npm run migrations:check` | PASS |
| `npm run build` | PASS: frontend and Node backend |
| `npm run test:ken-proof` | PASS: 3 focused checks |
| `npm run test:finance-rehearsal` | PASS: 14 sequential database scenarios |
| `npm run test:production-bundle` | PASS: startup, health, HTML, disabled wallet route, hidden backend artifact |
| `npm run test:finance-db` | PASS in isolated GitHub Actions: 16 scenarios each on PostgreSQL 17.11 and 18.6 |
| Live source schema contract | FAIL: 46 catalog issues; details in evidence |
| Hosted purchase, tournament, wager, refund and withdrawal E2E | NOT RUN |

Evidence directory: [finance-rollout-20261017](audit/evidence/finance-rollout-20261017/). Important files are `final-commands.json`, `unit-tests-final.log`, `finance-rehearsal.log`, `production-smoke.json`, `before-after-summary.json`, and `live-schema-contract.json`.

The first rehearsal used PostgreSQL 18.6 compiled to WebAssembly (PGlite 0.5.10). A subsequent isolated GitHub Actions run executed the same reviewed installer and sanitized live-shaped fixture on native PostgreSQL 17.11 and 18.6. Both native jobs passed all 16 scenarios, including independent concurrent database sessions. The live server is PostgreSQL 17.6. No live user rows or hosted credentials were sent to GitHub. This remains an isolated rehearsal, not an exact Supabase restoration or hosted production certification.

Native evidence: [successful CI run](https://github.com/ogunkenny000-stack/Kentrodraught/actions/runs/39102177465), commit `1cdd49a2db2da6698f14a5a58d153de9be8320d7`, branch `codex-finance-native-validation-20261018`. The branch adds only validation files/workflow; it does not update main or deploy the app. Logs are `native-postgres-17.log` and `native-postgres-18.log` alongside `native-ci-summary.json`. The additional scenarios exercise 12 concurrent charge/settlement retries and 12 rounds of charge/cancel and settlement/refund races. Both terminal orderings conserve money and close the match ID.

The 14 scenarios cover installer failure rollback, reinstall/data preservation, the rollback-only probe, 17 privileged finance entry points and RLS, unsafe grant detection, default profile creation and entitlement protection, exactly-once winner payment/rake, draw and abort refunds, cancellation-first ordering, historical replay rejection, injected second-debit rollback, paid AI unlock/idempotence, Ken 3→4→5→6→7→8 without ledger debits, synthetic operator purchase/withdrawal resolution, and tournament entry/refund. A synthetic `paid` withdrawal status is only a database-state simulation and proves no external payout.

Ken verification also accepts full legal signed winning transcripts for both human colors at levels 3–7 and rejects changed owners, game IDs, levels, missing signatures, illegal moves and unfinished games. A real native-engine capture is checked against the frontend replay encoding. Actual signed-in hosted progression remains unverified.

## Historical reconciliation: reference 2680002

The ledger has two distinct cycles: each debits 50 from each of two players, pays 90 to the same winner, and credits 10 rake to the house. Combined debits are 200; payouts are 180; rake is 20. The second charge follows the first payout, rather than appearing as two simultaneous debit requests.

No `completed_games.gameId` equals the ledger reference. Searching the same player pair around those timestamps found a 110-move Black win (two client-written result rows about half a second apart) near the first payout, and a one-move Black win near the second payout. The winner in both corresponds to the credited player. This is consistent with a rematch reusing the old room reference, but the available records do not prove the server-side mapping. A short game can be a resignation or disconnect; it is not sufficient evidence for a refund.

**Recommendation:** correlate the durable server game records or hosting logs with each charge/payout timestamp and the player pair. If two separate games are confirmed, record that reconciliation and make no corrective credit. If the same game was actually charged twice, document the canonical game and exact excess amount before the owner authorizes a separately logged compensating transaction. No correction was fabricated or applied.

## Installed migrations and planned installer

The live migration history contains only these existing entries:

| Version | Name |
|---|---|
| `20261001095803` | `revoke_public_execute_on_money_functions` |
| `20261001100003` | `protect_ban_columns_and_lock_game_updates` |
| `20261001100732` | `add_profile_bio_and_status_quote` |
| `20261002203526` | `chat_columns_chat_friends_tournament_policies` |
| `20261017145413` | `kentro_verified_ken_victory_progression_20261017` |
| `20261017145448` | `kentro_lock_ken_entitlements_20261017` |

**New migrations installed by this task: none.**

Reviewed candidate: `supabase/manual_live_finance_20261017.sql`.
SHA-256: `836b04aafb9d556ee4fe504825ea808ca4fe18afc150b80c8e90fce3e1160456`.
It has one outer `BEGIN`/`COMMIT`, lock/statement timeouts, and a real final readiness assertion. A forced error before `COMMIT` was rehearsed and the original synthetic wallet/ledger data survived unchanged. The policy-snapshot table is not a disaster-recovery backup.

Do not execute `schema.sql`, any reset script, or `all_migrations_combined.sql` against this live installation.

## Remaining blockers and exact continuation

1. **Restorable backup:** the official project's backup page requires sign-in, and the chosen Google route is waiting for device approval. This is an authentication requirement; the user has already authorized installation. Obtain an independently restorable provider backup or external logical backup and verify its restore viability on an isolated database. A policy snapshot or financial-row export does not satisfy this gate.
2. **Native PostgreSQL rehearsal and concurrency — RESOLVED:** the exact candidate passed 16 scenarios on each native PostgreSQL 17.11 and 18.6 CI service. The script creates its own database, uses independent service-role connections, and drops only that disposable database. No live database was targeted. Retain the CI evidence and rerun only if the candidate SQL or relevant runtime changes.
3. **Source/database compatibility:** the live contract still lacks guest trials, notifications, rated-result support, groups, private game columns, and required authorization policies/RPCs. The exact catalog report is included. The narrowed financial installer resolves its own tournament dependencies but is not a complete upgrade for all features in this source. Prepare and review any additional required compatible migrations independently; do not run the historical bundle as a shortcut.
4. **Migration permission:** previous sessions reported tool-level migration refusals. No new live migration was attempted here because backup/concurrency gates failed. Any future permission rejection must be respected; dashboard access must not be used to evade it.
5. **Hosted validation and deployment:** after the above gates pass, apply only the reviewed candidate through an allowed workflow; verify all permissions/RLS, run the rollback probe, compare the private baseline, and run signed-in hosted acceptance with controlled operator accounts. Independently verify incoming purchase funds; manually confirm external withdrawal payment. Never initiate a bank transfer from this test plan alone.
6. **Deployment access:** the production hosting account/deployment target has not been supplied or verified. Keep both `KENTRO_COINS_ENABLED=0` and `VITE_KENTRO_COINS_ENABLED=0`. After every database and hosted check passes, rebuild and deploy matching frontend/backend with the switches set to `1`. Use `SKIP_DB_MIGRATION=1` for the manual installation.

This is a repaired, locally reviewed release candidate. The live finance rollout is not complete.
