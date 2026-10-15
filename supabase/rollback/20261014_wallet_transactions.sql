-- Operator-only disable plan for NEW transactional RPCs. This deliberately
-- preserves settled markers, financial request rows, and every ledger entry.
-- Rolling back money by deleting rows or retrying legacy payouts is unsafe.
-- Retain the functions for investigation and re-grant after a reviewed fix.
begin;
revoke execute on function public.kentro_settle_match_pot(text,text,text,numeric,text,boolean,numeric) from service_role;
revoke execute on function public.kentro_unlock_ai(uuid,text,integer,numeric) from service_role;
revoke execute on function public.kentro_create_withdrawal(uuid,text,numeric,numeric,text,text,text) from service_role;
revoke execute on function public.kentro_resolve_withdrawal(uuid,boolean,text) from service_role;
revoke execute on function public.kentro_resolve_purchase(uuid,boolean,text,numeric) from service_role;
revoke execute on function public.kentro_tournament_chat(text,text,text) from authenticated;
commit;
