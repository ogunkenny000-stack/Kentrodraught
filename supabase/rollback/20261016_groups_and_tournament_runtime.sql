-- Containment rollback: preserve groups, membership, messages, tournament
-- state, version trigger, wallet ledgers and all RLS. Drain/stop the tournament
-- worker BEFORE running this reviewed script. Do not drop live state tables.
-- Reapply the forward migration to restore these grants after repair.
begin;
revoke all on function public.kentro_commit_tournament(text,bigint,jsonb) from service_role;
revoke all on function public.kentro_pay_completed_tournament(text,numeric) from service_role;
revoke all on function public.kentro_group_action(uuid,text,jsonb) from authenticated;
commit;
