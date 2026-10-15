-- Apply AFTER 20261014_security_authorization.sql. No historical ledger rewrite.
begin;
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

create or replace function public.kentro_tournament_chat(p_tournament text,p_message text,p_reply text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_profile public.profiles%rowtype; v_message jsonb; v_chat jsonb;
begin
 select * into v_profile from public.profiles where "ownerId"=auth.uid();
 if not found or v_profile.banned or v_profile."suspendedUntil">(extract(epoch from now())*1000)::bigint
   or length(trim(p_message)) not between 1 and 2000 then raise exception 'Invalid chat message' using errcode='42501'; end if;
 v_message:=jsonb_build_object('id',gen_random_uuid(),'sender',v_profile.username,'message',trim(p_message),
  'timestamp',(extract(epoch from now())*1000)::bigint,'isAnnouncement',false,'replyTo',p_reply,'reactions','{}'::jsonb);
 update public.tournaments set chat=chat||v_message where id=p_tournament returning chat into v_chat;
 if not found then raise exception 'Tournament not found'; end if;
 return v_chat;
end $$;

revoke all on function public.kentro_settle_match_pot(text,text,text,numeric,text,boolean,numeric) from public,anon,authenticated;
revoke all on function public.kentro_unlock_ai(uuid,text,integer,numeric) from public,anon,authenticated;
revoke all on function public.kentro_create_withdrawal(uuid,text,numeric,numeric,text,text,text) from public,anon,authenticated;
revoke all on function public.kentro_resolve_withdrawal(uuid,boolean,text) from public,anon,authenticated;
revoke all on function public.kentro_resolve_purchase(uuid,boolean,text,numeric) from public,anon,authenticated;
revoke all on function public.kentro_tournament_chat(text,text,text) from public,anon;
grant execute on function public.kentro_settle_match_pot(text,text,text,numeric,text,boolean,numeric) to service_role;
grant execute on function public.kentro_unlock_ai(uuid,text,integer,numeric) to service_role;
grant execute on function public.kentro_create_withdrawal(uuid,text,numeric,numeric,text,text,text) to service_role;
grant execute on function public.kentro_resolve_withdrawal(uuid,boolean,text) to service_role;
grant execute on function public.kentro_resolve_purchase(uuid,boolean,text,numeric) to service_role;
grant execute on function public.kentro_tournament_chat(text,text,text) to authenticated;
commit;
