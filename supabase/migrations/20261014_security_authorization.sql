-- Reviewed incremental security repair; no rows deleted or balances rewritten.
-- Apply as database owner after backup and staging verification. All schema
-- changes occur in one transaction. Never run reset_all_data.sql for this fix.
begin;

-- Exact policy snapshots support a deliberate operator rollback. This table
-- contains DDL only and is inaccessible to browser roles.
create table if not exists public.kentro_security_policy_backup (
  migration text not null, table_name text not null, policy_name text not null,
  ddl text not null, primary key (migration, table_name, policy_name)
);
alter table public.kentro_security_policy_backup enable row level security;
revoke all on public.kentro_security_policy_backup from public, anon, authenticated;
insert into public.kentro_security_policy_backup
select '20261014_security_authorization', tablename, policyname,
  format('create policy %I on public.%I as %s for %s to %s%s%s;', policyname,
    tablename, permissive, cmd, array_to_string(roles, ', '),
    case when qual is null then '' else ' using (' || qual || ')' end,
    case when with_check is null then '' else ' with check (' || with_check || ')' end)
from pg_policies where schemaname = 'public' and tablename in
  ('profiles','friends','private_messages','global_chat','completed_games','tournaments','purchase_requests','coin_wallets','coin_transactions')
  and not exists(select 1 from public.kentro_security_policy_backup where migration='20261014_security_authorization')
on conflict do nothing;

create or replace function public.kentro_owns_username(p_username text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.profiles p
    where p."ownerId" = (select auth.uid())
      and p."usernameLower" = lower(trim(p_username)) and p."usernameLower"<>'kentro_house'
      and not p.banned and (p."suspendedUntil" is null or p."suspendedUntil"<=(extract(epoch from now())*1000)::bigint));
$$;
revoke all on function public.kentro_owns_username(text) from public;
grant execute on function public.kentro_owns_username(text) to authenticated;

create or replace function public.kentro_account_active()
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.profiles p where p."ownerId"=(select auth.uid())
    and p."usernameLower"<>'kentro_house' and not p.banned
    and (p."suspendedUntil" is null or p."suspendedUntil"<=(extract(epoch from now())*1000)::bigint));
$$;
revoke all on function public.kentro_account_active() from public;
grant execute on function public.kentro_account_active() to authenticated;
create or replace function public.is_tournament_admin(p_uid uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.admins a join public.profiles p on p."ownerId"=a.uid
    where a.uid=p_uid and 'manage_tournaments'=any(a.permissions)
      and p."usernameLower"<>'kentro_house' and not p.banned
      and (p."suspendedUntil" is null or p."suspendedUntil"<=(extract(epoch from now())*1000)::bigint));
$$;

-- A permissive policy is ORed with every other permissive policy, so remove
-- all legacy policies for the tables below before installing explicit rules.
do $$ declare r record; begin
  for r in select tablename, policyname from pg_policies
    where schemaname='public' and tablename in
      ('friends','private_messages','global_chat','completed_games','tournaments','purchase_requests','coin_wallets','coin_transactions')
  loop execute format('drop policy %I on public.%I', r.policyname, r.tablename); end loop;
end $$;

-- Profile authority stays on the server: ratings, standings, paid unlocks,
-- identity, account age, and moderation cannot be forged by a browser.
-- Clients may update their avatar. Practice records remain locally usable;
-- a rated result requires an authoritative server completion pipeline.
create or replace function public.kentro_profile_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- Signup runs through a SECURITY DEFINER trigger, so this reservation must
  -- apply to every database role, including the trigger's owner. Existing
  -- reserved rows stay available for operator reconciliation but cannot be
  -- claimed or renamed through a new write.
  if new."usernameLower"='kentro_house' and
    (tg_op='INSERT' or new."ownerId" is distinct from old."ownerId")
  then raise exception 'Reserved system identity' using errcode='42501'; end if;
  if current_user in ('anon','authenticated') then
    if tg_op='INSERT' then
      -- Serialize two first-profile claims by the same Auth identity; an
      -- EXISTS check on its own can race without an ownerId unique index.
      perform pg_advisory_xact_lock(hashtextextended('kentro-profile:'||auth.uid()::text,0));
      if new."usernameLower" <> lower(trim(new."username"))
        or new."usernameLower" in ('kentro_house')
        or new."ownerId" is distinct from auth.uid()
        or exists(select 1 from public.profiles p where p."ownerId"=auth.uid())
        or new."banned" or new."bannedAt" is not null or new."bannedBy" is not null
        or new."suspendedUntil" is not null or new."suspendedBy" is not null
        or new."maxUnlockedKenLevel" > 3
        or new.elo<>1500 or new.wins<>0 or new.losses<>0 or new.draws<>0
        or new."gamesCount"<>0 or new."totalPlayTime"<>0 or new."averageDuration"<>0
        or new.rd is not null or new.vol is not null
      then raise exception 'Invalid profile creation' using errcode='42501'; end if;
      new."createdAt" := (extract(epoch from now())*1000)::bigint;
    elsif (to_jsonb(new) - 'avatarUrl') is distinct from (to_jsonb(old) - 'avatarUrl')
    then raise exception 'Profile identity, ratings and access are server-managed' using errcode='42501'; end if;
  end if;
  return new;
end $$;
drop trigger if exists kentro_profile_guard on public.profiles;
create trigger kentro_profile_guard before insert or update on public.profiles
  for each row execute function public.kentro_profile_guard();

alter table public.completed_games add column if not exists private boolean not null default false;
alter table public.completed_games add column if not exists "participantUserIds" jsonb not null default '[]'::jsonb;
create policy completed_games_select_visible on public.completed_games for select
  using (not private or "participantUserIds" ? (auth.uid()::text));
create policy completed_games_insert_own_practice on public.completed_games for insert to authenticated
  with check (not private and "participantUserIds"='[]'::jsonb and "playMode" in ('Human_vs_AI','AI_vs_Human','Training','Analysis','Local','Position_Editor')
    and (public.kentro_owns_username("whitePlayer") or public.kentro_owns_username("blackPlayer")));
-- Official Multiplayer/Tournament records, outcomes, and analysis are server-only.

create policy tournaments_select_all on public.tournaments for select using (true);
create policy tournaments_admin_insert on public.tournaments for insert to authenticated
  with check (public.is_tournament_admin(auth.uid()));
create policy tournaments_admin_delete on public.tournaments for delete to authenticated
  using (public.is_tournament_admin(auth.uid()));
-- Ordinary writes go through narrowly scoped RPCs; no blanket roster/status/
-- standings/prize updates remain. Tournament admins retain management access.
create policy tournaments_admin_update on public.tournaments for update to authenticated
  using (public.is_tournament_admin(auth.uid())) with check (public.is_tournament_admin(auth.uid()));

create policy friends_select_participant on public.friends for select to authenticated
  using (public.kentro_owns_username("user1") or public.kentro_owns_username("user2"));
create policy friends_insert_sender on public.friends for insert to authenticated
  with check (public.kentro_owns_username(sender) and status='pending'
    and lower("user1") <> lower("user2")
    and lower(sender) in (lower("user1"),lower("user2"))
    and exists(select 1 from public.profiles p where p."usernameLower"=lower("user1"))
    and exists(select 1 from public.profiles p where p."usernameLower"=lower("user2")));
create policy friends_update_recipient on public.friends for update to authenticated
  using (status='pending' and not public.kentro_owns_username(sender)
    and (public.kentro_owns_username("user1") or public.kentro_owns_username("user2")))
  with check (status='accepted' and not public.kentro_owns_username(sender)
    and (public.kentro_owns_username("user1") or public.kentro_owns_username("user2")));
create policy friends_delete_participant on public.friends for delete to authenticated
  using (public.kentro_owns_username("user1") or public.kentro_owns_username("user2"));
create or replace function public.kentro_friend_guard()
returns trigger language plpgsql security invoker set search_path='' as $$ begin
  if current_user in ('anon','authenticated') and
    (new.id is distinct from old.id or new."user1" is distinct from old."user1"
      or new."user2" is distinct from old."user2" or new.sender is distinct from old.sender)
  then raise exception 'Friend participants are immutable' using errcode='42501'; end if;
  return new;
end $$;
drop trigger if exists kentro_friend_guard on public.friends;
create trigger kentro_friend_guard before update on public.friends for each row execute function public.kentro_friend_guard();

-- Add rich chat fields already sent by the UI but missing from the baseline.
alter table public.private_messages add column if not exists status text not null default 'delivered';
alter table public.global_chat add column if not exists reactions jsonb not null default '{}'::jsonb;
alter table public.global_chat add column if not exists elo numeric;
alter table public.global_chat add column if not exists "voiceNote" text;
alter table public.global_chat add column if not exists duration numeric;
alter table public.global_chat add column if not exists sticker text;
alter table public.global_chat add column if not exists "stickerEmoji" text;
alter table public.global_chat add column if not exists "stickerImageUrl" text;
alter table public.global_chat add column if not exists "stickerLabel" text;

create policy private_messages_select_participant on public.private_messages for select to authenticated
  using (auth.uid()="senderOwnerId" or auth.uid()="recipientOwnerId");
create policy private_messages_insert_sender on public.private_messages for insert to authenticated
  with check (auth.uid()="senderOwnerId" and public.kentro_owns_username(sender)
    and exists(select 1 from public.profiles p where p."usernameLower"=lower(recipient) and p."ownerId"="recipientOwnerId")
    and status='delivered');
create policy private_messages_update_participant on public.private_messages for update to authenticated
  using ((auth.uid()="senderOwnerId" or auth.uid()="recipientOwnerId") and public.kentro_account_active())
  with check ((auth.uid()="senderOwnerId" or auth.uid()="recipientOwnerId") and public.kentro_account_active());
create or replace function public.kentro_message_guard()
returns trigger language plpgsql security invoker set search_path='' as $$ begin
  if current_user in ('anon','authenticated') and
    (to_jsonb(new) - array['reactions','status']) is distinct from
    (to_jsonb(old) - array['reactions','status'])
  then raise exception 'Message content and participants are immutable' using errcode='42501'; end if;
  return new;
end $$;
drop trigger if exists kentro_message_guard on public.private_messages;
create trigger kentro_message_guard before update on public.private_messages for each row execute function public.kentro_message_guard();
create policy global_chat_select_authenticated on public.global_chat for select to authenticated using (true);
create policy global_chat_insert_sender on public.global_chat for insert to authenticated with check (public.kentro_owns_username(sender));
create policy global_chat_update_sender on public.global_chat for update to authenticated
  using (public.kentro_account_active()) with check (public.kentro_account_active());
drop trigger if exists kentro_global_message_guard on public.global_chat;
create trigger kentro_global_message_guard before update on public.global_chat for each row execute function public.kentro_message_guard();

create policy purchase_requests_select_own on public.purchase_requests for select to authenticated using (auth.uid()="ownerId");
create policy purchase_requests_insert_own_pending on public.purchase_requests for insert to authenticated
  with check (auth.uid()="ownerId" and public.kentro_owns_username(username) and status='pending'
    and "resolvedAt" is null and "resolvedBy" is null and "coinsCredited" is null);
create policy coin_wallets_select_owner on public.coin_wallets for select to authenticated
  using (public.kentro_owns_username(username) and ("ownerId" is null or "ownerId"=auth.uid()));
create policy coin_transactions_select_owner on public.coin_transactions for select to authenticated
  using (public.kentro_owns_username(username));

-- NOT VALID preserves existing historical rows. New writes must satisfy all
-- ledger invariants; old anomalies can be reviewed and reconciled separately.
do $$ begin
  if not exists(select 1 from pg_constraint where conname='kentro_wallet_balance_safe' and conrelid='public.coin_wallets'::regclass) then
    alter table public.coin_wallets add constraint kentro_wallet_balance_safe
      check (balance >= 0 and balance <= 9007199254740991 and balance=trunc(balance)) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='kentro_transaction_amount_safe' and conrelid='public.coin_transactions'::regclass) then
    alter table public.coin_transactions add constraint kentro_transaction_amount_safe
      check (amount >= 0 and amount <= 9007199254740991 and amount=trunc(amount)
        and "balanceAfter">=0 and "balanceAfter"<=9007199254740991 and "balanceAfter"=trunc("balanceAfter")
        and direction in ('debit','credit')) not valid;
  end if;
end $$;
commit;
