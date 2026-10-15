# Supabase and database audit

## Repaired trust boundaries

`supabase/migrations/20261014_security_hardening.sql` is an additive, data-preserving transaction for existing installations. `supabase/schema.sql` includes the same final security contract for fresh installations. Accounts, profiles, games, messages, balances, requests and tournament documents are retained. No live database was contacted for these repairs.

The final policies prevent client profile inserts and changes to identity, ratings, moderation, counters and paid unlocks; owner avatar updates remain permitted. The auth trigger creates the initial profile atomically with signup and aborts duplicate/reserved names instead of silently leaving an account without a profile. The admins table is created before functions referencing it, fixing fresh installation order. Existing ambiguous historical ownership is not guessed or overwritten.

Friend requests and private messages bind participants to immutable profile owner UUIDs, not caller-supplied names or recipient IDs. New friendships start pending and only the recipient can accept an unchanged request. Messages cannot change sender, recipient, chat identity or content after insertion. Participant reaction changes remain permitted. New global chat messages must use the signed-in account's name. Tournament document writes and completed game writes are server only.

## Financial operations

New service-only SQL RPCs lock relevant profile/request/wallet rows and commit financial state and required durable records together:

- `unlock_ai_level`: balance deduction and unlock in one transaction; retries of an unlocked level do not charge again.
- `submit_withdrawal`: request UUID is an idempotency key; escrow debit, ledger entry and request insert are atomic. Reusing a key with different payload is rejected.
- `resolve_purchase`: pending status, credit and success audit entry are atomic. The HTTP server selects an exact configured package and the RPC verifies its ID against the locked request. Unknown packages are rejected.
- `resolve_withdrawal`: resolution, refund if rejected, and success audit entry commit together. Pending status is locked, preventing duplicate settlement.

Legacy pending withdrawals without an escrow ledger entry tied to their request ID return `escrow_not_verified`; HTTP reports 409 and requires reconciliation. Those rows are preserved. Automatically refunding an unverified request could manufacture coins. This needs an operator reconciliation workflow before resolving affected legacy requests.

`tournament_entry` qualifies output-column references to avoid PL/pgSQL ambiguous-column failures. Roster capacity, entry debit, ledger and prize pool update remain one transaction. Existing general wallet/match settlement functions remain service only; multi-wallet payout/retry durability needs broader transactional settlement work.

## Applying and validating

Normal server startup never alters the database. Explicit `APPLY_DB_MIGRATIONS=1` with `SUPABASE_DB_URL` can apply the hardening migration; `SKIP_DB_MIGRATION=1` overrides it. The direct PostgreSQL connection verifies certificates; optional `SUPABASE_DB_SSL_CA` supplies a trusted CA. The former `rejectUnauthorized:false` bypass was removed. Deployment images must include the reviewed migration file if this explicit startup mode is used. Prefer separately reviewed migrations and backups in production.

Run `npm run test:database` for disposable PostgreSQL validation. The test bootstraps Supabase-like roles/auth helpers locally, applies the schema and migration, and exercises denied/allowed RLS operations and financial rollback/retry behavior. It does not replace a staging test against the actual installed Supabase schema, extensions, existing data and identity-provider configuration. Historical migration bundles are retained as historical artifacts; do not reapply them after the new hardening migration because old policies could weaken the final contract.
