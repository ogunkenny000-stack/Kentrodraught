-- Financial safety upgrade for the staged Kentro wallet RPCs.
-- Rehearse on an isolated database before production. Does not touch balances.
-- Prerequisites: 20261014_wallet_transactions.sql and schema.sql.
begin;

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
commit;
