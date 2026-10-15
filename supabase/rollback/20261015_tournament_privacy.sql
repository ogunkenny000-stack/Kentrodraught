-- Emergency containment for an incompatible invite UI, not restoration of
-- the old public disclosure. Keeps invitation grants, existing entrants,
-- all balances and private-row confidentiality. Reapply the forward privacy
-- migration to re-enable these features after fixing the application.
begin;
revoke all on function public.kentro_redeem_tournament_invite(uuid,text) from service_role;
revoke all on function public.tournament_entry(text,text,numeric,jsonb,text) from service_role;
revoke all on function public.kentro_tournament_chat(text,text,text) from authenticated;
commit;
