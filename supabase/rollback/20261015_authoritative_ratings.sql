-- Disable new rating applications while preserving all statistics and the
-- exactly-once ledger. Do not remove ledger rows or recalculate past games.
begin;
revoke execute on function public.kentro_apply_rated_result(text,uuid,uuid,bigint,bigint,text,jsonb) from service_role;
commit;
