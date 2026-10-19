-- Narrow the remaining privileged RPC grants without changing application rows.
-- This migration is NOT applied to production by packaging this source.
-- Rehearse in staging and verify that Auth signup triggers and tournament
-- policies still work before authorizing a live rollout.
begin;
-- Trigger functions must not be directly callable via /rest/v1/rpc.
-- PostgreSQL executes them as triggers without granting public RPC EXECUTE.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.tournaments_money_guard() from public, anon, authenticated;
-- Ordinary clients need the admin helper for RLS policy evaluation, but
-- anonymous users have no reason to query privileged administrative status.
revoke execute on function public.is_tournament_admin(uuid) from public, anon;
grant execute on function public.is_tournament_admin(uuid) to authenticated;
-- Username-to-email must be usable ONLY by Kentro's trusted Node auth facade.
revoke execute on function public.resolve_username_to_email(text) from public, anon, authenticated;
grant execute on function public.resolve_username_to_email(text) to service_role;
commit;
