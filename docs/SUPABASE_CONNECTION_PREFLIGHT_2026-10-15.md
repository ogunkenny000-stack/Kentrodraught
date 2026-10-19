# Kentro / Draught.com — hosted Supabase read-only preflight

**Checked on 15 October 2026. No SQL mutations, migrations, authentication sessions or live game writes were performed.**

## Confirmed connected project

- Dashboard project: `draught.com`
- Supabase project ref: `pwovowlyylceuzontdhg`
- API endpoint: `https://pwovowlyylceuzontdhg.supabase.co`
- Project health from management interface: `ACTIVE_HEALTHY`
- Region: `eu-west-1`
- Database: PostgreSQL 17

This metadata confirms dashboard access only. It does **not** confirm that the deployed application has correct public/secret keys, auth redirect settings, migrations or runtime network access.

## Observed database state

The live `public` schema contained 15 tables, all with RLS enabled: `profiles`, `completed_games`, `tournaments`, `friends`, `private_messages`, `global_chat`, `coin_wallets`, `coin_transactions`, `admins`, `audit_logs`, `purchase_requests`, `reports`, `app_config`, `withdrawal_requests`, `puzzles`.

At inspection, the project showed about **94 profiles** and **3,885 completed game records**. These are approximate metadata counts, not exact user or transaction totals. Preserve all existing data.

Only four migration-history entries were registered, dated 1–2 October 2026. This differs from the many SQL files bundled in this source. A missing history row alone does not prove a migration was never applied manually; inspect actual object definitions before applying anything.

**The following objects required by code were absent from the table list:**

- `guest_online_trials` (guest online limits)
- `kentro_notifications`, `kentro_push_subscriptions` (inbox/background push)
- `kentro_security_policy_backup` (reviewed authorization migration)
- `kentro_match_settlements` (financial idempotency)
- `kentro_rated_matches` (rating settlement)
- `kentro_tournament_invites` (private tournament invites)
- `kentro_groups`, `kentro_group_members`, `kentro_group_messages` (persisted groups)

The source also expects new RPCs and tournament columns. Do not call the hosted implementation functional until those objects, permissions and transactions are verified in staging.

## Security advisor findings (not auto-remediated)

- INFO: `admins` and `audit_logs` have RLS enabled but no select policies. This may be intentional default-deny. Verify how trusted server access is handled before changing.
- WARN: public execution grants on privileged `SECURITY DEFINER` functions `handle_new_user`, `is_tournament_admin`, `resolve_username_to_email`, and `tournaments_money_guard` for `anon` / `authenticated`. Review their intended call sites and revoke unneeded privileges in a staged migration. Do not automatically revoke the Auth trigger function without confirming trigger behavior.
- WARN: Supabase leaked-password protection is disabled; consider enabling through Auth settings after reviewing signup flows.

Source: live Supabase project's read-only management listing, advisory scan, and `pg_proc` privilege metadata. Official remediation reference: https://supabase.com/docs/guides/database/database-linter and https://supabase.com/docs/guides/auth/password-security.

## Safe rollout plan — action required before live changes

1. **Clone or create a separate Supabase staging project.** Back up the actual hosted schema and relevant data, protect personal information and verify restoration. Do not use this live production project for disposable integration fixtures.
2. Compare actual table columns, functions, policies, grants and migration-history with `supabase/schema.sql`, `supabase/guest_trials.sql` and each ordered SQL migration. Apply *only* the missing, reviewed incremental migrations in staging; never blindly rerun base schema, reset scripts or generated combined SQL against existing user records.
3. In the host's **secret settings**, set both `SUPABASE_URL` and `VITE_SUPABASE_URL` to the same project URL, set `VITE_SUPABASE_PUBLISHABLE_KEY` to the publishable key, and set `SUPABASE_SECRET_KEY` to the server-only secret key. Do not put any secret key in a `VITE_` variable or ZIP. Set `APP_URL` to your actual HTTPS domain and `SKIP_DB_MIGRATION=1`. Run `npm run supabase:preflight` in the deployed environment; it checks configuration consistency without exposing secrets or performing DB requests.
4. In staging, run the bundled opt-in `npm run test:hosted` with two disposable signed-in accounts and the explicit `SUPABASE_STAGING_TEST_CONFIRM=disposable-staging` gate. Check Auth, RLS/PostgREST, group consent, notifications, tournament integration, game-result idempotency, Realtime and WebSocket reconnection.
5. After documented test passes and backup/rollback approval, separately authorize migration of production. Re-run security/performance advisors and verify the live application. Never automatically deploy this ZIP or execute a migration by reading this guide.

The existing `docs/SUPABASE_HANDOFF.md` includes detailed incremental SQL steps and rollback advice. This report does not certify hosted readiness.
