# Supabase and database — 15 October 2026

The database repairs were executed only in a disposable PostgreSQL 17 container
bound to loopback. No hosted database was changed. PostgreSQL role/RLS and
transaction checks are stronger than mocked RPC tests, but do not simulate
Supabase Auth, PostgREST, Realtime, extensions or hosting configuration fully.

## Installation order and consistency

For a **new empty project**, apply `supabase/schema.sql` once and then all
`supabase/migrations/*.sql` in filename order. The base schema deliberately
retains historical definitions for compatibility; it is not a secure complete
installation without the later authorization migrations. Do not rerun the base
schema against an existing project.

For an **existing project**, back up first, inspect its current schema and data,
and rehearse the incremental migrations against an isolated staging copy.
`supabase/all_migrations_combined.sql` is generated from the ordered migration
sources using `node scripts/build-migrations.cjs`. `--check` detects drift. The
old combined script omitted email privacy and authoritative rating upgrades;
the generated script includes every current migration. The existing puzzle
policy creation now drops its prior policy before recreating it, so an upgrade
rerun does not fail at that point.

The combined script contains explicit transaction boundaries from individual
migrations. A later migration failure does not undo earlier committed
migrations. Keep maintenance access restricted until the entire upgrade
succeeds, and use the tested deployment procedure rather than pasting into a
live database without rehearsal. Existing malformed profiles, duplicate legacy
identities/codes and ledger anomalies require operator review; these repairs do
not silently delete them.

## Authorization and transactions

The authorization migration snapshots legacy policies, removes permissive
browser writes, protects profile identity/statistics/access, binds friend
acceptance to the recipient, protects message participants/content, and keeps
official online results server controlled. Historical records remain present.
Private completed games use explicit participant Auth UIDs. Wallet constraints
reject new negative, fractional and unsafe balances while leaving historical
rows available for reconciliation.

Wallet RPCs serialize entry charges, match payouts, paid AI unlocks, withdrawals
and purchase resolution. Settlement/request markers make repeated operations
idempotent. Failed request inserts or a failing later credit roll back the
entire transaction. Tournament entry checks capacity while holding the
tournament row lock; paid entry, roster and pool updates happen together.
Payouts require a logged entrant and cannot race into paying twice. Cancellation
refunds are also serialized and idempotent.

Authoritative rating RPCs require a canonical completed multiplayer record and
the verified two-player identities. Ordered profile locks, statistic versions
and a unique game ledger prevent duplicate updates and lost overlapping game
results. The application computes Glicko-2; SQL validates the proposed output,
record identity, version and result before writing both profiles atomically.

The new tournament privacy migration stores invitation grants by Auth UID,
restricts private SELECT/entry/chat independently, rejects ambiguous codes and
keeps new invite redemption service-only. Notification read receipts have
column-specific UPDATE permissions even under broad default grants.

## Executed checks

Reproduction:

```sh
node scripts/build-migrations.cjs --check
AUDIT_PG_URL=postgresql://postgres@127.0.0.1:55432/postgres \
  node --experimental-strip-types scripts/audit/database-security.mjs
```

The shown URL is an isolated local fixture with disposable trust authentication;
it is not a recommended production connection. The harness refuses non-loopback
targets, creates its own database and drops it after the run. Only run it against
a disposable local PostgreSQL administrator instance.

**26 checks passed**. Assertions cover real `anon`, `authenticated` and
`service_role` connections, email lookup revocation, reserved signup identity,
concurrent first-profile claims, protected profile fields, friend consent,
message identity/content, official records, private replays, private invitation
redemption/entry/chat, bans, notification field permissions, wallet privacy and
integer bounds, all-or-none debits, repeated/concurrent settlements, injected
payout/request failures, concurrent unlocks/purchase resolutions/withdrawals,
tournament capacity/payout/refunds, overlapping rated games and two-profile
rollback. The suite runs ordered migrations and the combined script twice and
compares final policy definitions, SQL functions and execution grants.

The harness also executes the legacy authorization rollback, verifies exact
policy restoration without deleting application data, then reinstalls all
security migrations. The private tournament containment rollback is executed
and verified to disable invitation/entry functionality while keeping private
rows confidential; the forward migration restores functionality.

## Rollback and staging limits

Wallet and rating rollback files disable new RPC execution while preserving
ledgers, settled markers and statistics. Private tournament rollback similarly
disables affected features and retains confidential rows and invitation data.
The older authorization rollback deliberately restores earlier policy
weaknesses; it is an emergency operator procedure, not a routine deploy step.
Do not restore public email resolution when rolling back application code.

Still required before a hosted release: staging upgrade from the project's
actual schema/data, backups and restore rehearsal, genuine Auth JWT/PostgREST
and Realtime tests, canonical record synchronization/rating retry verification,
financial reconciliation, secret bindings and reviewed access grants. The
local suite cannot certify the state of the user's connected account.
