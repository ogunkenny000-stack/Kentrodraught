# Kentro Draughts — Supabase integration handoff

Status on 15 October 2026: source and disposable local checks are available.
**Hosted Supabase acceptance is PENDING. No production infrastructure was modified.**
Continue from branch `codex-audit-recovery-20261014`, not the older main snapshot.
The source archive includes all migrations, tests, reports, build scripts and native
weights. It intentionally excludes credentials, runtime resume tokens and user data.

## Before connecting ChatGPT Work

Use an isolated development/staging project. Supply environment values securely
from `.env.example`: public browser URL/publishable key at build time; the actual
server URL and service secret at runtime. Confirm both target the same project.
Never put the server secret, TURN secret or provider keys into any `VITE_*` value.
Keep `SKIP_DB_MIGRATION=1`; application startup must not migrate a live database.
`SUPABASE_DB_URL` is optional for a deliberately reviewed SQL operation.

Inspect the actual schema and migration history first. Back up schema and data,
record grants/extensions, and rehearse restoration. Do not run the local Auth
fixture `scripts/audit/supabase-fixture.sql` in Supabase.

## SQL application

For a new empty project apply `supabase/schema.sql` once, then every file under
`supabase/migrations/` in lexical filename order. This now includes the canonical guest trial migration `20261010_guest_online_trials.sql`; do not separately apply the old `supabase/guest_trials.sql` copy. The base schema alone is incomplete.
For an existing project apply reviewed missing incremental migrations against an
isolated copy; do not rerun the base schema or assume legacy data is clean.

`supabase/all_migrations_combined.sql` is generated from all ordered sources:

```sh
npm run migrations:check
npm run migrations:build
```

Do not run both the generated combined script and the same individual migrations
as an installation step. Rerun behavior is tested locally, but the combined script
contains multiple transactions: a later failure does not undo earlier commits.
Keep the application in maintenance until the entire reviewed upgrade succeeds.

The final additive migration `20261016_groups_and_tournament_runtime.sql` adds:

- Persistent groups, consent-based membership, role controls, messages/reactions,
  SELECT RLS and authenticated security-definer RPCs; direct browser writes denied.
- Server-only tournament state CAS and monotonically incremented versions.
- Server-only prize settlement using canonical champions, verified entry funding,
  integer shares/remainders and one transaction for all credits and the paid marker.
- Optional Realtime publication entries. Polling keeps groups usable without it.

## Locally reproducible integration

Use a disposable local PostgreSQL administrator URL on loopback only. The test
harnesses create and drop their own databases; the fixture includes synthetic Auth
claims. They do not verify genuine Supabase Auth, PostgREST or Realtime.

```sh
npm ci --include=dev
npm run lint
npm test
npm run build
npm run migrations:check
AUDIT_PG_URL=postgresql://postgres@127.0.0.1:55432/postgres npm run test:database
AUDIT_PG_URL=postgresql://postgres@127.0.0.1:55432/postgres npm run test:tournaments
AUDIT_PG_URL=postgresql://postgres@127.0.0.1:55432/postgres npm run test:groups
npm run test:restart
npm run test:multiplayer
```

Browser checks require Chromium; set `CHROME_PATH` if it is not on the default
path. Use `CHROME_NO_SANDBOX=1` only where the container requires that switch.
The GitHub Actions workflow covers core/local PostgreSQL/socket regression;
its next hosted CI run is not claimed as already passed.

## Hosted staging acceptance — ALL PENDING

The opt-in `npm run test:hosted` requires the named bindings from
`supabase/.env.staging-test.example`, two confirmed disposable staging users,
and an explicit matching project ref and confirmation. It creates/removes one
test group; do not run it against production. Missing bindings exit 2 with
PENDING, never a passing zero-test result. The script checks genuine Auth,
PostgREST role boundaries, consent, canonical messages and removed-user privacy.
It never runs payments or changes infrastructure.

Additional acceptance in ChatGPT Work:

1. Confirm real signup/verification/reset emails, redirect allowlist and expired JWT
   behavior. Verify banned/suspended identities cannot write, reconnect or request
   purchased AI levels. Seed the intended administrator by reviewed Auth UID only.
2. Verify all three API roles, private records/tournament invitations, anonymous
   visibility, notifications, friendships/DMs, group owner transfer and removal.
   Watch actual Realtime events and confirm removed users cannot receive content.
3. Start a free test tournament through the real organizer UI, join with genuine
   JWTs, make canonical moves, finish a round, confirm next pairing and standings,
   restart the staging server, and replay terminal synchronization without duplicates.
4. On disposable coin fixtures only, reconcile entry debits/pool, canonical champion
   shares/rake, repeated payment and cancellation refunds. Do not test real purchases
   or withdrawals. Sponsorship/manual pool increases are rejected until funded ledger
   support is designed. Never bypass the funding check to make a payout succeed.
5. Verify completed-record and rated-result retries against actual service-role RPCs.
   Reconcile historical duplicates/unfunded pools explicitly; the upgrade does not
   delete or silently repair financial history.
6. Configure HTTPS and WebSocket proxy upgrade/idle timeouts. Test a single writer
   using a persistent `KENTRO_DATA_DIR` volume, active restart recovery and corruption
   containment. Test clock/outage policy and planned draining with actual players.
7. Supply your own TURN REST relay using `TURN_URLS` and runtime `TURN_SHARED_SECRET`.
   Check two devices on separate NAT/mobile networks, voice/video, camera switch,
   permission denial, cancel, screen share and teardown. Managed audit Chromium has
   no peer ICE candidates, so no real media or Nearby transport pass is claimed.
8. Confirm VAPID delivery, offline service-worker updates, mobile accessibility,
   target browsers and realistic capacity. Record measured results and unresolved
   issues; local smoke timings do not certify production capacity.

## Restart and rollback

Run exactly one Node authority per data directory. Local files are single-writer
state, not a distributed database; do not add replicas behind a load balancer.
Back up the whole directory consistently while stopped/drained. It contains
`live_rooms.json`, `tournament_outbox.json`, record archives and sequence counters.
Room snapshots contain bearer resume tokens and require private filesystem/backups.

Commands checkpoint before room acknowledgement; clocks checkpoint each second.
An abrupt crash may restore up to about one second of clock time. Clocks freeze
during the outage and resume only after both players reconnect; recovery grants
120 seconds to reconnect. Unclaimed tournament pairings wait for the first player;
after that the absent opponent gets a 120-second join window. Spectators rejoin.
A corrupt/checksum-invalid snapshot blocks startup; retain it for diagnosis and
restore a verified compatible backup. Do not delete it to claim successful recovery.

Retain the previous application image and database backup. Drain the worker before
applying `supabase/rollback/20261016_groups_and_tournament_runtime.sql`. This
containment rollback revokes group mutation and tournament commit/payout RPCs;
it keeps RLS, messages, membership, versions, standings and money ledgers intact.
Reapplying the forward migration restores execution grants. Older rollback files
have distinct scopes; the legacy authorization rollback restores weaker policies
and must not be part of normal application rollback.

Rolling back application source does not undo SQL or restore balances. Never
use `docker compose down -v` during routine rollback. Live snapshot schema is
version 1; older application releases without recovery cannot resume those rooms.
Rehearse compatible application/data restoration before any production change.
