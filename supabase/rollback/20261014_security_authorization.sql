-- Operator-only emergency rollback, after explicit review. Restores EXACT
-- original policies from the migration's snapshot (including former security
-- weaknesses); do not run during routine deployment. Keeps all data and added
-- chat columns. Prefer rolling back application code while retaining security.
begin;
do $$ declare r record; begin
  if not exists(select 1 from public.kentro_security_policy_backup where migration='20261014_security_authorization') then
    raise exception 'No policy backup; refusing rollback';
  end if;
  for r in select tablename, policyname from pg_policies where schemaname='public' and tablename in
    ('friends','private_messages','global_chat','completed_games','tournaments','purchase_requests','coin_wallets','coin_transactions')
  loop execute format('drop policy %I on public.%I',r.policyname,r.tablename); end loop;
  for r in select ddl from public.kentro_security_policy_backup where migration='20261014_security_authorization'
    and table_name <> 'profiles' loop execute r.ddl; end loop;
end $$;
drop trigger if exists kentro_profile_guard on public.profiles;
drop trigger if exists kentro_friend_guard on public.friends;
drop trigger if exists kentro_message_guard on public.private_messages;
drop trigger if exists kentro_global_message_guard on public.global_chat;
alter table public.coin_wallets drop constraint if exists kentro_wallet_balance_safe;
alter table public.coin_transactions drop constraint if exists kentro_transaction_amount_safe;
commit;
