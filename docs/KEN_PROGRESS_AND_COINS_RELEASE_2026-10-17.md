# Ken progression and Kentro Coins: source remediation (17 October 2026)

## Release state: code ready for controlled staging, NOT payments-ready in production

This update is based on `Kentro-Draughts-Nigerian-Capture-Engine-Fixed.zip`. It preserves Nigerian rules, TV, networking, Supabase, and groups source and changes no hosted Supabase data. The operator explicitly chose `SKIP_DB_MIGRATION=1` and declined a paid Supabase staging branch. **Do not enable paid actions with real balances until a separate integration test is completed.**

### Ken levels

- **Ken 1-3 are free.** A legitimate player victory against Ken 2 (without hints/undo or practice) shows the next-level action, which starts a new Ken 3 game. This does **not** charge any coins or grant a database entitlement.
- Ken 4-8 continue to use a server-authorized paid unlock, not a claimed client-side victory. The source never accepts a player-submitted `maxUnlockedKenLevel` update as proof of purchase.
- The level-up action now independently checks victory, mode, hint/undo/practice status and the next-level entitlement.
- Unlock prices include every level skipped, preventing a direct jump from Ken 3 to Ken 8 for one level's price. The `all` bundle costs no more than the remaining levels individually. Already-unlocked targets cost zero. Admin-defined pricing must be a safe nonnegative integer.
- A different product policy (e.g. earning *permanent* paid Ken 4 by beating Ken 3) would require server-verified game outcomes and a separate authorization policy. This release intentionally does not grant paid entitlements from client-only result messages.

### Money safety fixes

- Financial routes default to **disabled** (`KENTRO_COINS_ENABLED=0`), and public UI coin controls default to **hidden** (`VITE_KENTRO_COINS_ENABLED=0`). The backend only enables them when the operator opts in and a privileged `kentro_coin_readiness()` RPC confirms financial tables, transactional RPCs, role execution privileges, and RLS.
- A missing migration or failed Supabase connection keeps coins **disabled**, instead of allowing partial debits. The frontend checks the backend's actual status; hiding coin UI does not replace server authorization.
- Free multiplayer creates a zero-wager room even when old host-setup state contains a wager. New paid rooms are rejected if financial operations are disabled.
- The new `public.kentro_match_charges` table holds a single receipt per game ID. `kentro_charge_match_pot()` serializes concurrent matching requests and atomically debits both wallets once or neither. The online room sends names in White/Black **color** order, independent of who joined first; settlement uses the same order.
- `kentro_settle_match_pot()` verifies matching debits and game receipt, and records an idempotent payout/refund. It also supports the previous receipt-less charge format when the legacy ledger proves both payments. Never automatically re-charge historical matches.
- Purchase approval, withdrawal creation/approval/refund, paid AI unlock, and tournament fee RPCs remain database-authoritative and transactional via the prerequisite SQL migrations. Financial routes are off if their required RPCs are missing. Real bank-transfer claims still need independent human bank verification; the app cannot independently confirm off-platform money was paid.
- New **read-only** `scripts/audit/coin-ledger-reconciliation.sql` helps diagnose previous unsettled games. Running it is safe for balances, but do not automatically issue refunds without reviewing corresponding real transaction records.

### Changes to deploy after testing

1. Take a verified Supabase backup and reconcile any existing incomplete match payouts using `scripts/audit/coin-ledger-reconciliation.sql` before enabling wagers.
2. On a disposable **local PostgreSQL** or isolated branch, apply `supabase/schema.sql` to a blank database, then all files in `supabase/migrations/` in sorted order. **For an existing production database, do NOT reapply the base schema or combined full SQL.** Review the incremental migrations against the actual existing schema, including `20261014_wallet_transactions.sql` and `20261017_zz_coin_safety.sql`, before adopting them.
3. Run `npm run test:database`, `npm run test:coin-safety`, `npm run test:supabase-contract`, `npm run test:preflight`, `npm run lint`, `npm test`, and `npm run build`. The local PostgreSQL regression suite automatically refuses a non-loopback `AUDIT_PG_URL`.
4. Verify that the server-side `service_role` / secret key is configured **only in the backend**. Keep frontend variables restricted to publishable values.
5. Verify a **test** wallet purchase-credit, Ken 4 unlock, duplicate concurrent wager charge, both settlement outcomes, cancellations and withdrawal rejection/refund. Check transaction row counts and balances before/after each test.
6. Only then explicitly set `KENTRO_COINS_ENABLED=1` on the Node runtime and `VITE_KENTRO_COINS_ENABLED=1` at frontend build time, rebuild and restart. Observe the startup `[Coins] Enabled` log and `/api/coins/settings` returning `coinsEnabled: true`. Continue keeping `SKIP_DB_MIGRATION=1` if migrations are managed manually.
7. Confirm the server's restart recovery and monetary reconciliation on deployed infrastructure; the in-memory retry loop is **not** a substitute for a durable unattended settlement-retry job. Investigate `GAVE UP settling pot` logs manually.

### Tests run for this delivery

- `npm run test:coin-safety` — **14 passed** (9 financial readiness/charging tests and 5 Ken progression/pricing tests).
- `npm run test:preflight` — **8 passed**.
- `npm run test:supabase-contract` — **6 passed**.
- `node scripts/build-migrations.cjs --check` — **passed**.
- Source TypeScript/TSX syntax-transpilation checks — **passed**.
- Included database-security regression scenario for concurrent payment receipts, one-time settlement, and service-role privileges; **not executed locally** because this environment has no local PostgreSQL service.
- Full application `npm ci`, lint, React build, and Vitest were **not completed** in this environment due to an unavailable cached npm package (`zod@4.6.7`). Results must not be construed as an end-to-end payment certification.

### Known production constraints

The currently connected `draught.com` Supabase database was previously checked read-only and was found to lack `kentro_unlock_ai`, `kentro_resolve_purchase`, `kentro_resolve_withdrawal`, `kentro_settle_match_pot`, and other staged RPCs. Those functions were **not** installed by this deliverable; money features therefore intentionally remain off. No live player balance, purchase, or account was modified. Payments cannot be represented as fully working until the migrations and external bank verification are completed.
