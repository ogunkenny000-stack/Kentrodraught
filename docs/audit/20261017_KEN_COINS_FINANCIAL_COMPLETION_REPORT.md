# Kentro Draughts: Ken progression and coin safety — 17 October 2026

**Release category: SOURCE VERIFIED, NOT HOSTED PAYMENTS-CERTIFIED.**

## What changed in this release

- Keep existing Ken progression: beating Ken 2 without hints/undo/practice offers Ken 3; Ken 1–3 are free, while Ken 4–8 require separately authorized paid entitlements.
- Complete all-level pricing validation and server-side ownership protection from the preceding release.
- Strengthen financial startup readiness: a database must contain the actual **profile authorization guard**, policy-backup footprint, all settlement/withdrawal/unlock/purchase RPCs, and service-role-only execution. Installing wallet functions without applying authorization changes will **not** turn coins on.
- Admin coin configuration now defaults to **disabled**; if readiness API fails, admin UI shows an explicit failure instead of displaying purchasable controls.
- Prevent reusing a previously refunded match-charge receipt to start another paid room.
- Add `kentro_refund_unstarted_match()` to recover uncertain charged-but-not-started games by looking up an immutable receipt; no receipt means **no refund and no artificial credit**. Concurrent charge/refund/settlement operations serialize by match ID. Duplicate refunds are idempotent.
- Close and retire aborted paid rooms after charge uncertainty or roster changes so a player cannot start another game using the same payment receipt.
- Add regression coverage for the charge timeout and cancelled paid match paths, including a disposable PostgreSQL test scenario.

## Checks executed here

- `npm run test:coin-safety`: **18 tests passed** (13 financial + 5 Ken pricing).
- `npm run test:preflight`: **8 passed**.
- `npm run test:supabase-contract`: **6 passed**.
- `npm run migrations:check`: **passed**.
- TypeScript/TSX transpilation syntax: **passed** for modified source modules.
- C++ Ken native-engine build and original forced-capture smoke test: **passed**.
- `npm run test:edge` (Go): **passed**.
- ZIP checksum verification and original-file retention: checked after packaging.

**Not completed:** `npm ci`, full React build, Vitest suite, disposable PostgreSQL financial concurrency tests, and end-to-end hosted paid transactions. In this execution environment npm cannot download `zod@4.6.7`, and neither a local PostgreSQL server nor a disposable Supabase staging branch is available. Do not interpret syntax/regression smoke tests as an end-to-end financial certificate.

## Connected production findings (read-only)

At the time of inspection, the `draught.com` Supabase project contained **34 wallet records and 45 coin transaction records**, including **one irregular match-fee ledger reference**. The required `kentro_*` financial RPCs and match receipt/settlement tables were **not installed**. Financial migrations were **NOT applied to production**, and no balances, withdrawals, or game results were changed.

Do not automatically refund historic irregular match transactions. Preserve transaction IDs and validate canonical game results and both players' real entry fees before deciding how to reconcile any record.

## Production installation — must be coordinated

1. Create and verify a **separately restorable** database backup. The source project contains real users and financial data. Supabase SQL-only tables copied inside the same database are not a disaster-recovery backup.
2. Restore a backup to a local PostgreSQL test database or a temporary isolated Supabase branch. Do **not** run `supabase/schema.sql` against the existing production database; it is for fresh databases only.
3. Compare the database's already-applied migrations with the source. Incrementally review the security migration before the money migrations; broad RLS changes may affect currently deployed clients.
4. On the disposable database run the ordered incremental files, especially `20261014_security_authorization.sql`, `20261014_wallet_transactions.sql`, `20261017_restrict_privileged_rpc_execute.sql`, and `20261017_zz_coin_safety.sql`. Apply all intermediate dependencies (ratings, tournaments, etc.) in order, not just isolated financial functions. All financial RPCs must be callable only by `service_role`.
5. Run `npm run test:database` (uses a disposable **local** PostgreSQL database; the script rejects non-loopback URLs) and `npm test`, `npm run lint`, `npm run build` using a properly networked environment with dependencies installed.
6. Verify one test purchase approval, AI entitlement, duplicate charge rejection, win settlement, draw refund, start-abort refund, withdrawal rejection, and tournament entry/payout without real money. Confirm exact wallet and ledger deltas, role privileges, and zero duplicate transactions.
7. Reconcile the existing irregular historic match ledger by hand; set up monitoring for `CRITICAL: manual reconciliation required` messages in server logs. Payment retries across process crashes also need operational reconciliation review.
8. Deploy frontend and server built from the **same** source and ensure server-only Supabase credentials are never in frontend variables. Enable `KENTRO_COINS_ENABLED=1` only **after** all hosted checks pass, with `VITE_KENTRO_COINS_ENABLED=1` at frontend build time; until then leave both `0`. Keep `SKIP_DB_MIGRATION=1` for intentionally managed migrations.

## Operational boundaries

The app does not verify off-platform bank deposits or execute actual bank withdrawals. A trusted operator must confirm external bank transfers before approving purchase credits or marking withdrawals paid. The app should not promise users instantaneous monetary redemption without separately verified payment rails.

**Nothing was deployed to the hosted website or changed in the live database during this release.**
