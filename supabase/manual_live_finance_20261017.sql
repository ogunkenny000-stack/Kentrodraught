-- KENTRO DRAUGHTS / LIVE FINANCE INSTALLER
-- 2026-10-17; designed for the existing draught.com schema only.
-- Do NOT run schema.sql or reset_all_data.sql against a live project.
-- Zero DELETE/TRUNCATE statements; preserves 34+ wallet rows and ledger.
-- Take an independent database backup in the Supabase dashboard first.
-- Existing payout anomalies remain untouched for manual reconciliation.
BEGIN;
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '90s';
DO $$ BEGIN
 IF to_regclass('public.profiles') IS NULL OR
    to_regclass('public.coin_wallets') IS NULL OR
    to_regclass('public.coin_transactions') IS NULL OR
    to_regclass('public.purchase_requests') IS NULL OR
    to_regclass('public.withdrawal_requests') IS NULL OR
    to_regclass('public.tournaments') IS NULL
 THEN RAISE EXCEPTION 'Not a supported installed Kentro database'; END IF;
 IF to_regprocedure('public.debit_wallet(text,numeric,text,text)') IS NULL OR
    to_regprocedure('public.credit_wallet(text,numeric,text,text)') IS NULL OR
    to_regprocedure('public.debit_multiple_wallets(text[],numeric,text,text)') IS NULL
 THEN RAISE EXCEPTION 'Core wallet RPCs missing; inspect existing schema first'; END IF;
END $$;

-- Live-compatible, narrowly scoped security prerequisite.
-- Neither this stage nor the next stage edits any existing wallet balances.
create table if not exists public.kentro_security_policy_backup (
  migration text not null, table_name text not null, policy_name text not null,
  ddl text not null, primary key(migration,table_name,policy_name)
);
alter table public.kentro_security_policy_backup enable row level security;
revoke all on public.kentro_security_policy_backup from public,anon,authenticated;
insert into public.kentro_security_policy_backup(migration,table_name,policy_name,ddl)
select 'kentro_live_finance_20261017',tablename,policyname,
 format('CREATE POLICY %I ON public.%I AS %s FOR %s TO %s%s%s;',policyname,tablename,permissive,cmd,
 array_to_string(roles,', '),
 case when qual is null then '' else ' USING ('||qual||')' end,
 case when with_check is null then '' else ' WITH CHECK ('||with_check||')' end)
from pg_policies where schemaname='public' and tablename in
('profiles','completed_games','tournaments','coin_wallets','coin_transactions','purchase_requests','withdrawal_requests')
on conflict do nothing;

create or replace function public.kentro_profile_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new."usernameLower"='kentro_house' and (tg_op='INSERT' or new."ownerId" is distinct from old."ownerId")
  then raise exception 'Reserved system identity' using errcode='42501'; end if;
  if current_user in ('anon','authenticated') then
    if tg_op='INSERT' then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kentro-profile:'||auth.uid()::text,0));
      if exists(select 1 from public.profiles p where p."ownerId"=auth.uid())
        or new."ownerId" is distinct from auth.uid()
        or new."usernameLower"<>lower(trim(new."username"))
        or new.banned or new."bannedAt" is not null or new."bannedBy" is not null
        or new."suspendedUntil" is not null or new."suspendedBy" is not null
        or new."maxUnlockedKenLevel">3
        or new.elo<>1500 or new.wins<>0 or new.losses<>0
        or new.draws<>0 or new."gamesCount"<>0
        or new."totalPlayTime"<>0 or new."averageDuration"<>0
        or new.rd is not null or new.vol is not null
      then raise exception 'Invalid profile creation' using errcode='42501'; end if;
      new."createdAt":=(extract(epoch from now())*1000)::bigint;
    elsif (to_jsonb(new)-array['avatarUrl','bio','statusQuote']) is distinct from
          (to_jsonb(old)-array['avatarUrl','bio','statusQuote'])
    then raise exception 'Protected profile fields are server-managed' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists kentro_profile_guard on public.profiles;
create trigger kentro_profile_guard before insert or update on public.profiles
 for each row execute function public.kentro_profile_guard();
revoke all on function public.kentro_profile_guard() from public,anon,authenticated;

-- A duplicate historical owner aborts this transaction for operator review;
-- it is never automatically merged or assigned to a different wallet.
create unique index if not exists kentro_profiles_owner_unique
 on public.profiles("ownerId") where "ownerId" is not null;

-- Remove precisely identified legacy broad permissions for money-sensitive
-- tournament writes and official match results; do not touch other policies.
drop policy if exists tournaments_write_authenticated on public.tournaments;
drop policy if exists tournaments_update_authenticated on public.tournaments;
drop policy if exists tournaments_delete_authenticated on public.tournaments;
drop policy if exists completed_games_write_authenticated on public.completed_games;

drop policy if exists tournaments_admin_insert on public.tournaments;
create policy tournaments_admin_insert on public.tournaments
 for insert to authenticated with check (public.is_tournament_admin((select auth.uid())));
drop policy if exists tournaments_admin_update on public.tournaments;
create policy tournaments_admin_update on public.tournaments
 for update to authenticated using (public.is_tournament_admin((select auth.uid())))
 with check (public.is_tournament_admin((select auth.uid())));
drop policy if exists tournaments_admin_delete on public.tournaments;
create policy tournaments_admin_delete on public.tournaments
 for delete to authenticated using (public.is_tournament_admin((select auth.uid())));

-- An ordinary user may save public practice matches, but never official rated
-- PvP or tournament results. Such records are written by the server role.
drop policy if exists completed_games_insert_own_practice on public.completed_games;
create policy completed_games_insert_own_practice on public.completed_games
 for insert to authenticated with check (
  "playMode" in ('Human_vs_AI','AI_vs_Human','Training','Analysis','Local','Position_Editor')
  and exists(select 1 from public.profiles p where p."ownerId"=(select auth.uid())
    and (p."usernameLower"=lower("whitePlayer") or p."usernameLower"=lower("blackPlayer")))
 );

-- Prevent fraudulent pending purchase requests from starting as approved.
drop policy if exists purchase_requests_insert_own on public.purchase_requests;
drop policy if exists purchase_requests_insert_own_pending on public.purchase_requests;
create policy purchase_requests_insert_own_pending on public.purchase_requests
 for insert to authenticated with check (
  "ownerId"=(select auth.uid()) and status='pending'
  and "resolvedAt" is null and "resolvedBy" is null and "coinsCredited" is null
  and exists(select 1 from public.profiles p
    where p."ownerId"=(select auth.uid()) and p."usernameLower"=lower(username))
 );

-- Canonical tournament entry and private invitation checks.
create table if not exists public.kentro_tournament_invites (
  tournament_id text not null references public.tournaments(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key(tournament_id,owner_id)
);
alter table public.kentro_tournament_invites enable row level security;
revoke all on public.kentro_tournament_invites from public,anon,authenticated;

create or replace function public.kentro_can_view_tournament(p_id text,p_visibility text,p_players jsonb)
returns boolean language sql stable security definer set search_path='' as $$
  select lower(coalesce(p_visibility,'public'))<>'private' or
    exists(select 1 from public.profiles p where p."ownerId"=auth.uid()
      and not p.banned and (p."suspendedUntil" is null or p."suspendedUntil"<=(extract(epoch from now())*1000)::bigint)
      and p."usernameLower"<>'kentro_house'
      and (public.is_tournament_admin(auth.uid())
        or exists(select 1 from jsonb_array_elements(coalesce(p_players,'[]')) player
          where lower(player->>'username')=p."usernameLower")
        or exists(select 1 from public.kentro_tournament_invites i where i.tournament_id=p_id and i.owner_id=auth.uid())));
$$;
revoke all on function public.kentro_can_view_tournament(text,text,jsonb) from public;
grant execute on function public.kentro_can_view_tournament(text,text,jsonb) to anon,authenticated;
drop policy if exists tournaments_select_all on public.tournaments;
drop policy if exists tournaments_select_visible on public.tournaments;
create policy tournaments_select_visible on public.tournaments for select
  using (public.kentro_can_view_tournament(id,visibility,players));

create or replace function public.kentro_redeem_tournament_invite(p_owner uuid,p_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_tour public.tournaments%rowtype;
begin
  if p_owner is null or p_code is null or length(p_code) not between 4 and 64
    or not exists(select 1 from public.profiles p where p."ownerId"=p_owner
      and p."usernameLower"<>'kentro_house' and not p.banned
      and (p."suspendedUntil" is null or p."suspendedUntil"<=(extract(epoch from now())*1000)::bigint))
  then return jsonb_build_object('ok',false,'error','not_found'); end if;
  -- Duplicate historical codes fail closed rather than disclosing an arbitrary row.
  if (select count(*) from public.tournaments where lower(visibility)='private' and upper("inviteCode")=upper(trim(p_code)))<>1
  then return jsonb_build_object('ok',false,'error','not_found'); end if;
  select * into v_tour from public.tournaments where lower(visibility)='private' and upper("inviteCode")=upper(trim(p_code)) for update;
  if v_tour.status not in ('registration','upcoming','active','open') or v_tour.status is null
  then return jsonb_build_object('ok',false,'error','not_open'); end if;
  insert into public.kentro_tournament_invites(tournament_id,owner_id) values(v_tour.id,p_owner) on conflict do nothing;
  return jsonb_build_object('ok',true,'tournament',to_jsonb(v_tour));
end $$;
revoke all on function public.kentro_redeem_tournament_invite(uuid,text) from public,anon,authenticated;
grant execute on function public.kentro_redeem_tournament_invite(uuid,text) to service_role;

create or replace function public.tournament_entry(
  p_tournament_id text,p_username text,p_entry_fee numeric,p_player jsonb,p_log_line text
) returns table("ok" boolean,"errorReason" text,"balance" numeric,"players" jsonb)
language plpgsql security definer set search_path='' as $$
declare v_tour public.tournaments%rowtype; v_profile public.profiles%rowtype; v_balance numeric;
begin
  if p_entry_fee is null or p_entry_fee<0 or p_entry_fee>9007199254740991 or p_entry_fee<>trunc(p_entry_fee)
    or p_username is null or jsonb_typeof(p_player) is distinct from 'object'
  then raise exception 'Invalid tournament entry'; end if;
  select * into v_profile from public.profiles where "usernameLower"=lower(trim(p_username));
  if not found or v_profile.banned or v_profile."usernameLower"='kentro_house'
    or v_profile."suspendedUntil">(extract(epoch from now())*1000)::bigint
  then return query select false,'not_allowed',null::numeric,null::jsonb; return; end if;
  select * into v_tour from public.tournaments where id=p_tournament_id for update;
  if not found then return query select false,'not_found',null::numeric,null::jsonb; return; end if;
  if lower(v_tour.visibility)='private' and not exists(select 1 from public.kentro_tournament_invites
      where tournament_id=p_tournament_id and owner_id=v_profile."ownerId")
    and not public.is_tournament_admin(v_profile."ownerId")
  then return query select false,'not_allowed',null::numeric,null::jsonb; return; end if;
  if v_tour.status is distinct from 'registration' then return query select false,'not_open',null::numeric,null::jsonb; return; end if;
  if exists(select 1 from jsonb_array_elements(v_tour.players) player where lower(player->>'username')=v_profile."usernameLower")
  then return query select false,'already_registered',null::numeric,v_tour.players; return; end if;
  if v_tour."maxPlayers" is not null and jsonb_array_length(v_tour.players)>=v_tour."maxPlayers"
  then return query select false,'full',null::numeric,null::jsonb; return; end if;
  if p_entry_fee>0 then
    select d.ok,d.balance into ok,v_balance from public.debit_wallet(v_profile."usernameLower",p_entry_fee,'tournament_entry',p_tournament_id) d;
    if not ok then return query select false,'insufficient_funds',v_balance,null::jsonb; return; end if;
  else select coalesce(w.balance,0) into v_balance from public.coin_wallets w where w.username=v_profile."usernameLower"; end if;
  update public.tournaments set players=v_tour.players||jsonb_build_array(p_player||jsonb_build_object('username',v_profile.username)),
    logs=v_tour.logs||jsonb_build_array(left(coalesce(p_log_line,v_profile.username||' joined the tournament.'),500)),
    "prizePool"=v_tour."prizePool"+p_entry_fee where id=p_tournament_id returning tournaments.players into players;
  return query select true,null::text,coalesce(v_balance,0),players;
end $$;
revoke all on function public.tournament_entry(text,text,numeric,jsonb,text) from public,anon,authenticated;
grant execute on function public.tournament_entry(text,text,numeric,jsonb,text) to service_role;


-- Minimal tournament runtime required by the matching finance endpoints.
alter table public.tournaments add column if not exists "engineVersion" bigint not null default 0;
alter table public.tournaments add column if not exists "engineState" jsonb not null default '{}'::jsonb;
create or replace function public.kentro_tournament_version() returns trigger language plpgsql set search_path='' as $$ begin new."engineVersion":=old."engineVersion"+1; return new; end $$;
drop trigger if exists kentro_tournament_version on public.tournaments;
create trigger kentro_tournament_version before update on public.tournaments for each row execute function public.kentro_tournament_version();
create or replace function public.kentro_commit_tournament(p_id text,p_version bigint,p_next jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.tournaments%rowtype;
begin
  if jsonb_typeof(p_next)<>'object' or p_next->>'status' not in ('registration','active','completed')
    or jsonb_typeof(p_next->'players')<>'array' or jsonb_typeof(p_next->'matches')<>'array'
    or jsonb_array_length(p_next->'players')>64 or jsonb_array_length(p_next->'matches')>20000
  then raise exception 'Invalid runtime state'; end if;
  update public.tournaments set status=p_next->>'status',players=p_next->'players',matches=p_next->'matches',
    "currentRound"=(p_next->>'currentRound')::integer,"maxRounds"=(p_next->>'maxRounds')::integer,
    logs=p_next->'logs',"engineState"=p_next->'engineState'
  where id=p_id and "engineVersion"=p_version returning * into v;
  if not found then return null; end if;
  return to_jsonb(v);
end $$;
revoke all on function public.kentro_commit_tournament(text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.kentro_commit_tournament(text,bigint,jsonb) to service_role;

-- Canonical single or team champions share the net prize atomically. The
-- administrator confirms payment; no browser can select another beneficiary.
create or replace function public.kentro_pay_completed_tournament(p_id text,p_rake numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.tournaments%rowtype; v_champions text[]; v_pool numeric; v_payout bigint; v_house bigint; v_share bigint; v_amount bigint; v_extra integer; v_name text; v_paid jsonb:='{}';
begin
 select * into v from public.tournaments where id=p_id for update;
 if not found then return jsonb_build_object('ok',false,'errorReason','not_found'); end if;
 if v."prizePaid" then return jsonb_build_object('ok',false,'errorReason','already_paid'); end if;
 if v.status<>'completed' or jsonb_typeof(v."engineState"->'champions') is distinct from 'array' or jsonb_array_length(v."engineState"->'champions') not between 1 and 64 then return jsonb_build_object('ok',false,'errorReason','not_completed'); end if;
 if p_rake is null or p_rake<0 or p_rake>1 then raise exception 'Invalid rake'; end if;
 select array_agg(distinct lower(value) order by lower(value)) into v_champions from jsonb_array_elements_text(v."engineState"->'champions');
 v_pool:=v."prizePool";
 if v_pool is null or v_pool<0 or v_pool<>trunc(v_pool) or v_pool>9007199254740991 then raise exception 'Invalid pool'; end if;
 if v_pool>coalesce((select sum(amount) from public.coin_transactions where type='tournament_entry' and direction='debit' and "refId"=p_id),0) then raise exception 'Pool exceeds verified entry funding'; end if;
 v_payout:=floor(v_pool*(1-p_rake));v_house:=v_pool-v_payout;
 v_share:=v_payout/array_length(v_champions,1);v_extra:=v_payout-v_share*array_length(v_champions,1);
 foreach v_name in array v_champions loop
  if not exists(select 1 from public.profiles p where p."usernameLower"=v_name and not p.banned and (p."suspendedUntil" is null or p."suspendedUntil"<=(extract(epoch from now())*1000)::bigint))
   or not exists(select 1 from jsonb_array_elements(v.players) player where lower(player->>'username')=v_name)
   or (v_pool>0 and not exists(select 1 from public.coin_transactions c where c.username=v_name and c.type='tournament_entry' and c."refId"=p_id and c.amount>0 and c.direction='debit')) then raise exception 'Champion eligibility requires reconciliation'; end if;
  v_amount:=v_share; if v_extra>0 then v_amount:=v_amount+1; end if;
  if v_amount>0 then perform public.credit_wallet(v_name,v_amount,'tournament_prize',p_id); end if;
  v_paid:=v_paid||jsonb_build_object(v_name,v_amount);v_extra:=greatest(0,v_extra-1);
 end loop;
 if v_house>0 then perform public.credit_wallet('kentro_house',v_house,'rake',p_id); end if;
 update public.tournaments set "prizePaid"=true where id=p_id;
 return jsonb_build_object('ok',true,'payout',v_payout,'rake',v_house,'beneficiaries',v_paid);
end $$;
revoke all on function public.kentro_pay_completed_tournament(text,numeric) from public,anon,authenticated;
grant execute on function public.kentro_pay_completed_tournament(text,numeric) to service_role;

-- VERIFIED WALLET OPERATIONS
-- Apply AFTER 20261014_security_authorization.sql. No historical ledger rewrite.

create table if not exists public.kentro_match_settlements (
  match_id text primary key, result jsonb not null, settled_at timestamptz not null default now()
);
alter table public.kentro_match_settlements enable row level security;
revoke all on public.kentro_match_settlements from public,anon,authenticated;

create or replace function public.kentro_settle_match_pot(
  p_match_id text, p_white text, p_black text, p_fee numeric, p_winner text, p_draw boolean, p_rake numeric
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_pot numeric; v_rake numeric; v_user text; v_paid numeric;
begin
  if p_match_id is null or length(p_match_id)>160 or p_fee is null or p_fee<=0 or p_fee<>trunc(p_fee)
    or p_fee>4503599627370495 or p_rake is null or p_rake<0 or p_rake>1
    or p_white is null or p_black is null or p_white=p_black
    or (not p_draw and p_winner not in (p_white,p_black)) or p_draw is null
  then raise exception 'Invalid match settlement'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kentro-settlement:'||p_match_id,0));
  select result into v_result from public.kentro_match_settlements where match_id=p_match_id;
  if found then return v_result; end if;
  -- The server may only distribute money actually escrowed for this match.
  -- A missing receipt is not permission to pay a historical result again.
  if exists(select 1 from public.coin_transactions
    where "refId" in (p_match_id,'rake:'||p_match_id)
      and direction='credit' and type in ('match_prize','refund','rake')) then
    raise exception 'Existing match payout or refund requires reconciliation';
  end if;
  if (select count(*) from public.coin_transactions
      where "refId"=p_match_id and type='match_entry' and direction='debit') <> 2 then
    raise exception 'Match requires exactly one entry debit per player';
  end if;
  foreach v_user in array array[p_white,p_black] loop
    select coalesce(sum(amount),0) into v_paid from public.coin_transactions
      where username=v_user and "refId"=p_match_id and type='match_entry' and direction='debit';
    if v_paid<>p_fee then raise exception 'Match pot has no matching escrow'; end if;
  end loop;
  -- Lock all participating wallet rows in a consistent order across payouts.
  perform 1 from public.coin_wallets where username in (p_white,p_black,'kentro_house') order by username for update;
  if p_draw then
    perform public.credit_wallet(p_white,p_fee,'refund',p_match_id);
    perform public.credit_wallet(p_black,p_fee,'refund',p_match_id);
    v_result:=jsonb_build_object('ok',true,'payout',p_fee*2,'rake',0);
  else
    v_pot:=p_fee*2; v_rake:=floor(v_pot*p_rake);
    if v_pot-v_rake>0 then perform public.credit_wallet(p_winner,v_pot-v_rake,'match_prize',p_match_id); end if;
    if v_rake>0 then perform public.credit_wallet('kentro_house',v_rake,'rake','rake:'||p_match_id); end if;
    v_result:=jsonb_build_object('ok',true,'payout',v_pot-v_rake,'rake',v_rake);
  end if;
  insert into public.kentro_match_settlements(match_id,result) values(p_match_id,v_result);
  return v_result;
end $$;

create or replace function public.kentro_unlock_ai(p_owner uuid,p_username text,p_level integer,p_cost numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_profile public.profiles%rowtype; v_debit record;
begin
  if p_level is null or p_level<2 or p_level>8 or p_cost is null or p_cost<0 or p_cost<>trunc(p_cost) then raise exception 'Invalid unlock'; end if;
  select * into v_profile from public.profiles where "usernameLower"=p_username and "ownerId"=p_owner for update;
  if not found then raise exception 'Profile ownership mismatch'; end if;
  if v_profile."maxUnlockedKenLevel">=p_level then
    return jsonb_build_object('ok',true,'alreadyUnlocked',true,'maxUnlockedKenLevel',v_profile."maxUnlockedKenLevel");
  end if;
  if p_cost>0 then
    select * into v_debit from public.debit_wallet(p_username,p_cost,'ai_unlock',p_level::text);
    if not v_debit.ok then return jsonb_build_object('ok',false,'balance',v_debit.balance); end if;
  end if;
  update public.profiles set "maxUnlockedKenLevel"=p_level where "usernameLower"=p_username;
  return jsonb_build_object('ok',true,'balance',(select balance from public.coin_wallets where username=p_username),'maxUnlockedKenLevel',p_level);
end $$;

create or replace function public.kentro_create_withdrawal(
 p_owner uuid,p_username text,p_coins numeric,p_naira numeric,p_account_name text,p_account_number text,p_bank text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_debit record; v_id uuid:=gen_random_uuid();
begin
  if not exists(select 1 from public.profiles where "ownerId"=p_owner and "usernameLower"=p_username)
    or p_coins is null or p_coins<=0 or p_coins<>trunc(p_coins) or p_naira is null or p_naira<0 or p_naira<>trunc(p_naira)
    or length(trim(p_account_name)) not between 1 and 120 or p_account_number !~ '^[0-9]{10}$'
  then raise exception 'Invalid withdrawal'; end if;
  select * into v_debit from public.debit_wallet(p_username,p_coins,'withdrawal',v_id::text);
  if not v_debit.ok then return jsonb_build_object('ok',false,'balance',v_debit.balance); end if;
  insert into public.withdrawal_requests(id,username,"ownerId",coins,"nairaAmount","accountName","accountNumber","bankName",status,"submittedAt")
    values(v_id,p_username,p_owner,p_coins,p_naira,trim(p_account_name),p_account_number,p_bank,'pending',(extract(epoch from now())*1000)::bigint);
  return jsonb_build_object('ok',true,'requestId',v_id,'balance',v_debit.balance,'nairaAmount',p_naira);
end $$;

create or replace function public.kentro_resolve_withdrawal(p_id uuid,p_approve boolean,p_admin text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_request public.withdrawal_requests%rowtype; v_balance numeric;
begin
 select * into v_request from public.withdrawal_requests where id=p_id for update;
 if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
 if v_request.status<>'pending' then return jsonb_build_object('ok',false,'error','already_resolved'); end if;
 if p_approve is null then raise exception 'Explicit approval required'; end if;
 if not p_approve then v_balance:=public.credit_wallet(v_request.username,v_request.coins,'refund',p_id::text); end if;
 update public.withdrawal_requests set status=case when p_approve then 'paid' else 'rejected' end,
   "resolvedBy"=p_admin,"resolvedAt"=(extract(epoch from now())*1000)::bigint where id=p_id;
 return jsonb_build_object('ok',true,'username',v_request.username,'coins',v_request.coins,'balance',v_balance);
end $$;

create or replace function public.kentro_resolve_purchase(p_id uuid,p_approve boolean,p_admin text,p_coins numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_request public.purchase_requests%rowtype; v_username text; v_balance numeric;
begin
 select * into v_request from public.purchase_requests where id=p_id for update;
 if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
 if v_request.status<>'pending' then return jsonb_build_object('ok',false,'error','already_resolved'); end if;
 if p_approve is null then raise exception 'Explicit approval required'; end if;
 select "usernameLower" into v_username from public.profiles where "ownerId"=v_request."ownerId";
 if v_username is null then raise exception 'Purchase owner has no canonical profile'; end if;
 if p_approve then v_balance:=public.credit_wallet(v_username,p_coins,'purchase_credit',p_id::text); end if;
 update public.purchase_requests set status=case when p_approve then 'approved' else 'rejected' end,
   "resolvedBy"=p_admin,"resolvedAt"=(extract(epoch from now())*1000)::bigint,
   "coinsCredited"=case when p_approve then p_coins else null end where id=p_id;
 return jsonb_build_object('ok',true,'username',v_username,'coins',p_coins,'balance',v_balance);
end $$;

-- Tournament chat is intentionally excluded from this financial installer.


revoke all on function public.kentro_settle_match_pot(text,text,text,numeric,text,boolean,numeric) from public,anon,authenticated;
revoke all on function public.kentro_unlock_ai(uuid,text,integer,numeric) from public,anon,authenticated;
revoke all on function public.kentro_create_withdrawal(uuid,text,numeric,numeric,text,text,text) from public,anon,authenticated;
revoke all on function public.kentro_resolve_withdrawal(uuid,boolean,text) from public,anon,authenticated;
revoke all on function public.kentro_resolve_purchase(uuid,boolean,text,numeric) from public,anon,authenticated;
grant execute on function public.kentro_settle_match_pot(text,text,text,numeric,text,boolean,numeric) to service_role;
grant execute on function public.kentro_unlock_ai(uuid,text,integer,numeric) to service_role;
grant execute on function public.kentro_create_withdrawal(uuid,text,numeric,numeric,text,text,text) to service_role;
grant execute on function public.kentro_resolve_withdrawal(uuid,boolean,text) to service_role;
grant execute on function public.kentro_resolve_purchase(uuid,boolean,text,numeric) to service_role;

-- IDEMPOTENT CHARGING / SETTLEMENT / READINESS
-- Financial safety upgrade for the staged Kentro wallet RPCs.
-- Rehearse on an isolated database before production. Does not touch balances.
-- Prerequisites: 20261014_wallet_transactions.sql and schema.sql.

-- One immutable debit receipt per paid room, preventing double entry-fees
-- when a client reconnects or the server retries the same game start.
create table if not exists public.kentro_match_charges (
  match_id text primary key,
  white_username text not null,
  black_username text not null,
  fee numeric not null check (fee > 0 and fee = trunc(fee) and fee <= 4503599627370495),
  charged_at timestamptz not null default now(),
  check (white_username <> black_username)
);
alter table public.kentro_match_charges enable row level security;
revoke all on public.kentro_match_charges from public, anon, authenticated;

create or replace function public.kentro_charge_match_pot(
  p_match_id text, p_white text, p_black text, p_fee numeric
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_receipt public.kentro_match_charges%rowtype; v_charge record;
begin
  if p_match_id is null or length(trim(p_match_id)) not between 1 and 160
     or p_white is null or length(trim(p_white)) < 1
     or p_black is null or length(trim(p_black)) < 1
     or p_white <> lower(trim(p_white)) or p_black <> lower(trim(p_black))
     or p_white = p_black or p_fee is null or p_fee <= 0
     or p_fee <> trunc(p_fee) or p_fee > 4503599627370495
  then raise exception 'Invalid match charge'; end if;
  -- Serialize charging against refunds/settlements of the SAME match ID.
  -- A refunded receipt can never be recycled to finance a new match.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kentro-settlement:' || p_match_id, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kentro-charge:' || p_match_id, 0));
  -- A cancellation tombstone also closes an ID that was never charged.
  -- This check MUST precede the receipt lookup: HTTP delivery can reorder
  -- cancellation and the delayed original charge.
  if exists(select 1 from public.kentro_match_settlements where match_id=p_match_id) then
    raise exception 'Match payment already settled; a new game must use a new ID';
  end if;
  select * into v_receipt from public.kentro_match_charges where match_id=p_match_id;
  if found then
    if v_receipt.white_username <> p_white or v_receipt.black_username <> p_black or v_receipt.fee <> p_fee then
      raise exception 'Conflicting payment retry for an existing game';
    end if;
    return jsonb_build_object('ok', true, 'alreadyCharged', true);
  end if;
  -- Never attach a new receipt to an old match's ledger or debit it again.
  if exists(select 1 from public.coin_transactions where "refId" in (p_match_id,'rake:'||p_match_id)
    and type in ('match_entry','match_prize','refund','rake')) then
    raise exception 'Legacy match reference requires reconciliation before reuse';
  end if;
  select * into v_charge from public.debit_multiple_wallets(
    array[p_white,p_black],p_fee,'match_entry',p_match_id
  );
  if not coalesce(v_charge.ok,false) then
    return jsonb_build_object('ok',false,'insufficientUsers',coalesce(v_charge."insufficientUsers",array[]::text[]));
  end if;
  insert into public.kentro_match_charges(match_id,white_username,black_username,fee)
    values(p_match_id,p_white,p_black,p_fee);
  return jsonb_build_object('ok', true, 'alreadyCharged', false);
end $$;

-- Require the corresponding debits before an idempotent payout. Legacy
-- in-flight matches charged before this migration retain the old ledger
-- verification in kentro_settle_match_pot, but new matches use the receipt.
create or replace function public.kentro_settle_match_pot(
  p_match_id text, p_white text, p_black text, p_fee numeric, p_winner text, p_draw boolean, p_rake numeric
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_pot numeric; v_rake numeric; v_user text; v_paid numeric;
        v_receipt public.kentro_match_charges%rowtype;
begin
  if p_match_id is null or length(trim(p_match_id)) not between 1 and 160
    or p_fee is null or p_fee<=0 or p_fee<>trunc(p_fee)
    or p_fee>4503599627370495 or p_rake is null or p_rake<0 or p_rake>1
    or p_white is null or p_black is null or p_white=p_black
    or p_draw is null or (not p_draw and (p_winner is null or p_winner not in (p_white,p_black)))
  then raise exception 'Invalid match settlement'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kentro-settlement:'||p_match_id,0));
  select result into v_result from public.kentro_match_settlements where match_id=p_match_id;
  if found then return v_result; end if;
  select * into v_receipt from public.kentro_match_charges where match_id=p_match_id;
  if found then
    if v_receipt.white_username<>p_white or v_receipt.black_username<>p_black or v_receipt.fee<>p_fee then
      raise exception 'Settlement does not match the paid match receipt';
    end if;
  end if;
  -- A missing receipt is not permission to pay a historical result again.
  if exists(select 1 from public.coin_transactions
    where "refId" in (p_match_id,'rake:'||p_match_id)
      and direction='credit' and type in ('match_prize','refund','rake')) then
    raise exception 'Existing match payout or refund requires reconciliation';
  end if;
  if (select count(*) from public.coin_transactions
      where "refId"=p_match_id and type='match_entry' and direction='debit') <> 2 then
    raise exception 'Match requires exactly one entry debit per player';
  end if;
  foreach v_user in array array[p_white,p_black] loop
    select coalesce(sum(amount),0) into v_paid from public.coin_transactions
      where username=v_user and "refId"=p_match_id and type='match_entry' and direction='debit';
    if v_paid<>p_fee then raise exception 'Match pot has no matching escrow'; end if;
  end loop;
  perform 1 from public.coin_wallets where username in (p_white,p_black,'kentro_house') order by username for update;
  if p_draw then
    perform public.credit_wallet(p_white,p_fee,'refund',p_match_id);
    perform public.credit_wallet(p_black,p_fee,'refund',p_match_id);
    v_result:=jsonb_build_object('ok',true,'payout',p_fee*2,'rake',0);
  else
    v_pot:=p_fee*2; v_rake:=floor(v_pot*p_rake);
    if v_pot-v_rake>0 then perform public.credit_wallet(p_winner,v_pot-v_rake,'match_prize',p_match_id); end if;
    if v_rake>0 then perform public.credit_wallet('kentro_house',v_rake,'rake','rake:'||p_match_id); end if;
    v_result:=jsonb_build_object('ok',true,'payout',v_pot-v_rake,'rake',v_rake);
  end if;
  insert into public.kentro_match_settlements(match_id,result) values(p_match_id,v_result);
  return v_result;
end $$;

-- If the charge response is lost or a player disconnects before the game
-- starts, check the durable charge receipt and refund only if it exists.
-- Concurrency with the initial charge and other settlement attempts is
-- serialized by the per-match advisory lock. A repeated call is idempotent.
create or replace function public.kentro_refund_unstarted_match(
  p_match_id text, p_white text, p_black text, p_fee numeric
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_receipt public.kentro_match_charges%rowtype; v_result jsonb;
begin
  if p_match_id is null or length(trim(p_match_id)) not between 1 and 160
    or p_white is null or p_black is null or p_white=p_black
    or p_fee is null or p_fee<=0 or p_fee<>trunc(p_fee) or p_fee>4503599627370495
  then raise exception 'Invalid unstarted-match refund'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kentro-settlement:' || p_match_id,0));
  if exists(select 1 from public.kentro_match_settlements where match_id=p_match_id) then
    return jsonb_build_object('ok',true,'alreadySettled',true);
  end if;
  select * into v_receipt from public.kentro_match_charges where match_id=p_match_id;
  if not found then
    if exists(select 1 from public.coin_transactions where "refId" in (p_match_id,'rake:'||p_match_id)
      and type in ('match_entry','match_prize','refund','rake')) then
      raise exception 'Legacy match reference requires reconciliation before refund';
    end if;
    v_result:=jsonb_build_object('ok',true,'notCharged',true,'cancelled',true);
    insert into public.kentro_match_settlements(match_id,result) values(p_match_id,v_result);
    return v_result;
  end if;
  if v_receipt.white_username<>p_white or v_receipt.black_username<>p_black or v_receipt.fee<>p_fee then
    raise exception 'Unstarted-match refund does not match paid receipt';
  end if;
  if exists(select 1 from public.kentro_match_settlements where match_id=p_match_id) then
    return jsonb_build_object('ok',true,'alreadySettled',true);
  end if;
  v_result:=public.kentro_settle_match_pot(p_match_id,p_white,p_black,p_fee,null,true,0);
  return v_result || jsonb_build_object('refunded',true);
end $$;

-- Only privileged Node processes may run the health contract. The check
-- verifies BOTH money RPCs and money tables before opening any paid route.
create or replace function public.kentro_coin_readiness() returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_ok boolean; v_signature text; v_function regprocedure; v_issues jsonb:='[]'::jsonb;
begin
  select (
    -- A finance-ready schema must also prevent browsers from changing their
    -- own paid Ken entitlements or forging authoritative game results.
    -- This ensures merely installing wallet RPCs never bypasses the earlier
    -- authorization migration.
    pg_catalog.to_regclass('public.kentro_security_policy_backup') is not null and
    exists(select 1 from pg_catalog.pg_trigger t
           join pg_catalog.pg_class c on c.oid=t.tgrelid
           join pg_catalog.pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relname='profiles'
             and t.tgname='kentro_profile_guard' and t.tgenabled <> 'D'
             and not t.tgisinternal) and
    pg_catalog.to_regclass('public.coin_wallets') is not null and
    pg_catalog.to_regclass('public.coin_transactions') is not null and
    pg_catalog.to_regclass('public.kentro_match_charges') is not null and
    pg_catalog.to_regclass('public.kentro_match_settlements') is not null and
    -- Legacy broad policies permit users to manipulate tournament money
    -- and fabricate official game outcomes. Paid features must remain OFF
    -- until these are replaced with restricted authorization rules.
    not exists(select 1 from pg_catalog.pg_policies
      where schemaname='public' and tablename='tournaments'
        and policyname in ('tournaments_write_authenticated',
          'tournaments_update_authenticated', 'tournaments_delete_authenticated')) and
    not exists(select 1 from pg_catalog.pg_policies
      where schemaname='public' and tablename='completed_games'
        and policyname='completed_games_write_authenticated') and
    pg_catalog.to_regclass('public.purchase_requests') is not null and
    pg_catalog.to_regclass('public.withdrawal_requests') is not null and
    pg_catalog.to_regprocedure('public.kentro_charge_match_pot(text,text,text,numeric)') is not null and
    pg_catalog.to_regprocedure('public.kentro_refund_unstarted_match(text,text,text,numeric)') is not null and
    pg_catalog.to_regprocedure('public.kentro_settle_match_pot(text,text,text,numeric,text,boolean,numeric)') is not null and
    pg_catalog.to_regprocedure('public.kentro_unlock_ai(uuid,text,integer,numeric)') is not null and
    pg_catalog.to_regprocedure('public.kentro_create_withdrawal(uuid,text,numeric,numeric,text,text,text)') is not null and
    pg_catalog.to_regprocedure('public.kentro_resolve_withdrawal(uuid,boolean,text)') is not null and
    pg_catalog.to_regprocedure('public.kentro_resolve_purchase(uuid,boolean,text,numeric)') is not null and
    pg_catalog.to_regprocedure('public.tournament_entry(text,text,numeric,jsonb,text)') is not null and
    pg_catalog.to_regprocedure('public.refund_tournament_entries(text)') is not null and
    pg_catalog.to_regprocedure('public.pay_tournament_prize(text,text,numeric)') is not null and
    pg_catalog.to_regprocedure('public.debit_wallet(text,numeric,text,text)') is not null and
    pg_catalog.to_regprocedure('public.credit_wallet(text,numeric,text,text)') is not null and
    pg_catalog.to_regprocedure('public.debit_multiple_wallets(text[],numeric,text,text)') is not null and
    -- Existence alone is not sufficient: the backend role must be able to
    -- execute these functions or coin requests will fail after activation.
    pg_catalog.has_function_privilege('service_role', 'public.kentro_charge_match_pot(text,text,text,numeric)', 'EXECUTE') and
    pg_catalog.has_function_privilege('service_role', 'public.kentro_refund_unstarted_match(text,text,text,numeric)', 'EXECUTE') and
    pg_catalog.has_function_privilege('service_role', 'public.kentro_settle_match_pot(text,text,text,numeric,text,boolean,numeric)', 'EXECUTE') and
    pg_catalog.has_function_privilege('service_role', 'public.kentro_unlock_ai(uuid,text,integer,numeric)', 'EXECUTE') and
    pg_catalog.has_function_privilege('service_role', 'public.kentro_create_withdrawal(uuid,text,numeric,numeric,text,text,text)', 'EXECUTE') and
    pg_catalog.has_function_privilege('service_role', 'public.kentro_resolve_withdrawal(uuid,boolean,text)', 'EXECUTE') and
    pg_catalog.has_function_privilege('service_role', 'public.kentro_resolve_purchase(uuid,boolean,text,numeric)', 'EXECUTE') and
    pg_catalog.has_function_privilege('service_role', 'public.tournament_entry(text,text,numeric,jsonb,text)', 'EXECUTE') and
    -- Privileged transaction entry points must never be exposed to browsers.
    not pg_catalog.has_function_privilege('anon', 'public.kentro_unlock_ai(uuid,text,integer,numeric)', 'EXECUTE') and
    not pg_catalog.has_function_privilege('authenticated', 'public.kentro_unlock_ai(uuid,text,integer,numeric)', 'EXECUTE') and
    not pg_catalog.has_function_privilege('anon', 'public.kentro_charge_match_pot(text,text,text,numeric)', 'EXECUTE') and
    not pg_catalog.has_function_privilege('authenticated', 'public.kentro_charge_match_pot(text,text,text,numeric)', 'EXECUTE') and
    not pg_catalog.has_function_privilege('anon', 'public.kentro_refund_unstarted_match(text,text,text,numeric)', 'EXECUTE') and
    not pg_catalog.has_function_privilege('authenticated', 'public.kentro_refund_unstarted_match(text,text,text,numeric)', 'EXECUTE') and
    not pg_catalog.has_function_privilege('anon', 'public.kentro_settle_match_pot(text,text,text,numeric,text,boolean,numeric)', 'EXECUTE') and
    not pg_catalog.has_function_privilege('authenticated', 'public.kentro_settle_match_pot(text,text,text,numeric,text,boolean,numeric)', 'EXECUTE') and
    not pg_catalog.has_function_privilege('anon', 'public.kentro_create_withdrawal(uuid,text,numeric,numeric,text,text,text)', 'EXECUTE') and
    not pg_catalog.has_function_privilege('authenticated', 'public.kentro_create_withdrawal(uuid,text,numeric,numeric,text,text,text)', 'EXECUTE') and
    not pg_catalog.has_function_privilege('anon', 'public.kentro_resolve_purchase(uuid,boolean,text,numeric)', 'EXECUTE') and
    not pg_catalog.has_function_privilege('authenticated', 'public.kentro_resolve_purchase(uuid,boolean,text,numeric)', 'EXECUTE') and
    not pg_catalog.has_function_privilege('anon', 'public.kentro_resolve_withdrawal(uuid,boolean,text)', 'EXECUTE') and
    not pg_catalog.has_function_privilege('authenticated', 'public.kentro_resolve_withdrawal(uuid,boolean,text)', 'EXECUTE') and
    (select count(*) = 6 and bool_and(c.relrowsecurity)
     from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in
       ('coin_wallets','coin_transactions','kentro_match_charges',
        'kentro_match_settlements','purchase_requests','withdrawal_requests')
       and c.relkind = 'r')
  ) into v_ok;
  -- Check the complete privileged finance surface, including legacy helpers
  -- and the tournament runtime used by this source release. Never rely only
  -- on function names or on CREATE FUNCTION's default PUBLIC privilege.
  foreach v_signature in array array[
    'public.debit_wallet(text,numeric,text,text)',
    'public.credit_wallet(text,numeric,text,text)',
    'public.debit_multiple_wallets(text[],numeric,text,text)',
    'public.tournament_entry(text,text,numeric,jsonb,text)',
    'public.refund_tournament_entries(text)',
    'public.pay_tournament_prize(text,text,numeric)',
    'public.kentro_commit_tournament(text,bigint,jsonb)',
    'public.kentro_pay_completed_tournament(text,numeric)',
    'public.kentro_claim_ken_victory(uuid,uuid,integer)',
    'public.kentro_coin_readiness()'
  ] loop
    v_function:=pg_catalog.to_regprocedure(v_signature);
    if v_function is null then
      v_ok:=false; v_issues:=v_issues||jsonb_build_array('MISSING_RPC '||v_signature);
    elsif not pg_catalog.has_function_privilege('service_role',v_function,'EXECUTE')
      or pg_catalog.has_function_privilege('anon',v_function,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',v_function,'EXECUTE') then
      v_ok:=false; v_issues:=v_issues||jsonb_build_array('UNSAFE_RPC_PRIVILEGES '||v_signature);
    end if;
  end loop;
  if (select count(*) from information_schema.columns where table_schema='public'
      and table_name='tournaments' and column_name in ('engineState','engineVersion'))<>2 then
    v_ok:=false; v_issues:=v_issues||jsonb_build_array('MISSING_TOURNAMENT_RUNTIME_COLUMNS');
  end if;
  return jsonb_build_object('ready',coalesce(v_ok,false),'issues',v_issues);
end $$;
revoke all on function public.kentro_charge_match_pot(text,text,text,numeric) from public,anon,authenticated;
revoke all on function public.kentro_refund_unstarted_match(text,text,text,numeric) from public,anon,authenticated;
revoke all on function public.kentro_settle_match_pot(text,text,text,numeric,text,boolean,numeric) from public,anon,authenticated;
revoke all on function public.kentro_coin_readiness() from public,anon,authenticated;
grant execute on function public.kentro_charge_match_pot(text,text,text,numeric) to service_role;
grant execute on function public.kentro_refund_unstarted_match(text,text,text,numeric) to service_role;
grant execute on function public.kentro_settle_match_pot(text,text,text,numeric,text,boolean,numeric) to service_role;
grant execute on function public.kentro_coin_readiness() to service_role;

-- Check every minimum prerequisite before the transaction commits.
DO $$ DECLARE r jsonb; BEGIN
 IF to_regprocedure('public.kentro_coin_readiness()') is null THEN
   RAISE EXCEPTION 'Coin readiness function missing'; END IF;
 SELECT public.kentro_coin_readiness() INTO r;
 IF COALESCE((r->>'ready')::boolean,false) IS NOT TRUE THEN
   RAISE EXCEPTION 'Coin readiness did not pass, rolling back the entire upgrade: %',r;
 END IF;
 IF has_function_privilege('anon','public.kentro_charge_match_pot(text,text,text,numeric)','EXECUTE')
   OR has_function_privilege('authenticated','public.kentro_charge_match_pot(text,text,text,numeric)','EXECUTE')
 THEN RAISE EXCEPTION 'Charge RPC exposed to users'; END IF;
END $$;
COMMIT;
