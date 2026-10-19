# Kentro Draughts: Supabase integration and production-safety status

**2026-10-15 — Verified by a read-only inspection of the connected Supabase project.**
**Production schema changed: NO. Production user/game records changed: NO.**

## Project verified

- Supabase project: `draught.com` (`pwovowlyylceuzontdhg`), active/healthy, region `eu-west-1`, PostgreSQL 17.
- Public API origin: `https://pwovowlyylceuzontdhg.supabase.co`.
- Both modern publishable and legacy anon keys are available. Private keys were not retrieved or written into the source.
- This is a *live project*, with approximately 94 profiles and 3,885 completed game records. Do not use this database for disposable test fixtures.
- No linked Supabase development branches currently exist.

## Live catalog facts

Fifteen public tables are currently present, all with RLS enabled: profiles, completed_games, tournaments, friends, private_messages, global_chat, coin_wallets, coin_transactions, admins, audit_logs, purchase_requests, reports, app_config, withdrawal_requests and puzzles.

Missing relative to the reviewed source:

- guest_online_trials
- kentro_notifications, kentro_push_subscriptions
- kentro_security_policy_backup, kentro_match_settlements, kentro_rated_matches
- kentro_tournament_invites
- kentro_groups, kentro_group_members, kentro_group_messages
- Completed games lack `private`, `participantUserIds`; profiles lack `statsVersion`; tournaments lack `engineVersion`, `engineState`.

**Security gaps in installed policies:** legacy `completed_games_write_authenticated` and `tournaments_update_authenticated` remain. Their intended hardened replacements have not been installed. Existing `resolve_username_to_email()`, `handle_new_user()`, `is_tournament_admin(uuid)` and `tournaments_money_guard()` have public/anonymous execute permissions flagged by Supabase's security advisor. For `is_tournament_admin`, authenticated execute is required for current RLS, so revoking every role blindly would break legitimate flows. `admins` and `audit_logs` RLS default deny is not automatically a vulnerability.

Supabase's performance advisor also reports 14 `auth_rls_initplan` warnings on current policies. Most are expected to change with the hardened migrations; re-run advisors after staging and deployment.

Password breach protection is disabled at the hosted project and requires the responsible operator to enable the setting in Supabase Authentication after checking plan/feature availability.

## Read-only production data preflight

Targeted aggregate queries returned:

| Invariant | Violations |
|---|---:|
| Duplicate `completed_games.gameId` groups | 0 |
| Duplicate `profiles.ownerId` groups | 0 |
| Case-insensitive profile name collisions | 0 |
| Duplicate unordered friend pairs | 0 |
| Invalid wallet balances (negative, fractional, outside safe integer range) | 0 |
| Invalid transaction amount/balance/direction | 0 |
| Tournaments currently present | 0 |

These aggregate checks are not a complete integrity audit, and they do not prove a future migration will succeed.

## Repairs made to this source snapshot

1. Added `supabase/migrations/20261010_guest_online_trials.sql` so guest online quotas are included in the normal ordered migration bundle. Retained `supabase/guest_trials.sql` for compatibility; **do not manually install both**.
2. Added `supabase/migrations/20261017_restrict_privileged_rpc_execute.sql` to limit direct client access to privileged RPCs and trigger functions while preserving authenticated tournament admin policy use.
3. Regenerated `supabase/all_migrations_combined.sql` from the ordered SQL files. **Do not run this entire bundle blindly on the live database**.
4. Added `scripts/audit/supabase-schema-readiness.mjs`: explicit opt-in read-only database schema contract for tables, columns, RPCs, RLS/policies and legacy grants. It does NOT query player rows or mutate schema.
5. Strengthened `scripts/audit/supabase-config-preflight.mjs` to catch both modern and legacy privileged API keys in browser environment variables, and reject a publishable key in the server secret slot.
6. Added 9 relevant focused regression checks (6 new schema contract tests and 3 credential tests).
7. Integrated the new Supabase config and schema tests into `.github/workflows/local-regression.yml`.
8. Preserved the merged Kentro TV stable replay grid, Nigerian capture behavior, engine, hosted recovery, groups and tournament code from the supplied base package.

## What can be executed safely now

```bash
npm run test:preflight
npm run test:supabase-contract
npm run migrations:check
npm run supabase:preflight           # local environment/config only
# Optional DATABASE-SIDE read-only readiness, requires a secure direct DB URL:
SUPABASE_SCHEMA_READONLY_CONFIRM=1 npm run supabase:schema-readiness
```

For the final command, supply `SUPABASE_DB_URL` privately through the host's secret settings. The tool wraps all catalog queries in `BEGIN READ ONLY`, and exits nonzero if the required schema is missing. It should fail on today's production schema; that's expected until reviewed migrations are installed.

## Required staging deployment and acceptance steps

1. **Staging database:** Explicit owner approval and any provider cost confirmation are required before creating a Supabase branch or project. The connected project has no existing branch. Do not create one without approval and awareness of cost. Do not test money/notifications/permissions against production data.
2. Take a verified recoverable backup of the live database and relevant Auth configuration; snapshot current table, policy, grant, function and migration inventory. Confirm restore procedure in staging.
3. Restore schema (and only sanitized fixture records if desired) in an isolated staging project. Compare each source migration with actual installed objects; migrations absent from `supabase_migrations` history may still have been manually applied previously.
4. Apply **only reviewed missing incremental migrations** in staged sequence. Start with the canonical guest migration if absent, then TV notifications, security authorization, wallet transactions, email privacy, ratings, tournament privacy, persistent groups/runtime and privileged RPC permission restrictions. Earlier July migrations need a separate object-level drift review; do not automatically rerun the base schema.
5. Run `npm run supabase:schema-readiness` against staging, then the opt-in `npm run test:hosted` using two *disposable* confirmed Auth users (see `supabase/.env.staging-test.example`). Test real signup/reset, private visibility, RLS, Realtime, group consent/removal, tournament canonical game progression, retry idempotency, push delivery, and wallet refunds with only synthetic money fixtures.
6. Run security/performance advisors on staging and resolve issues; verify all browser flows and WebSockets with staging deployment, TLS and matching server/runtime keys.
7. Only after staging is verified, review migration diff and obtain specific production rollout approval. Plan maintenance/drain window, consistent live room snapshots, backup/restore readiness, migration monitoring and rollback. A source rollback does **not** reverse committed SQL or wallet ledgers.
8. Configure the actual app host: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` at FRONTEND BUILD time; `SUPABASE_URL` and `SUPABASE_SECRET_KEY` ONLY on backend; keep `SKIP_DB_MIGRATION=1`; set `APP_URL` to the actual HTTPS app origin, persistent `KENTRO_DATA_DIR`, and VAPID contact/keys. Do not put private keys in `VITE_`, GitHub or this ZIP. If a VAPID private key was shared publicly, regenerate and rotate before enabling production push.

**Release classification: STAGING ONLY.** Missing hosted schema and runtime credentials, live Auth/RLS and notifications, real-device transport, and complete production build remain external blockers. Do not claim these are fully complete merely because source tests passed.

## Local verification of this handoff

- 8 config preflight tests PASS.
- 6 schema-contract tests PASS.
- Ordered SQL migration consistency PASS.
- C++ engine compilation/search and screenshot capture regression PASS.
- Go networking test PASS.
- Full `npm ci` / React typecheck unavailable: required `zod@4.6.7` package missing from the local offline npm cache; `tsc` without dependencies reports module-not-found failures, which is NOT a meaningful application typecheck.

The fixes introduced here do not claim the app is ready for production. Finish staging first.

Security guidance: https://supabase.com/docs/guides/database/postgres/row-level-security and https://supabase.com/docs/guides/database/database-linter
