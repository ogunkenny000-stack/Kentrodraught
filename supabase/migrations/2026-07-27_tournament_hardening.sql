-- Tournament hardening (deep-review findings, 2026-07-27). Four fixes:
--
--   1. tournament_entry(): duplicate-registration check is now
--      case-insensitive ("Kenny" and "kenny" are the same person).
--   2. pay_tournament_prize(): the winner must (a) actually be on the
--      tournament's roster and (b) have a real, logged entry-fee payment
--      for THIS tournament when the pool is funded. Previously it would
--      pay the entire pool to any name at all -- including a typo'd or
--      entirely fabricated one (a wallet was auto-created for it).
--   3. refund_tournament_entries(): new. A cancelled/abandoned tournament
--      previously stranded its prize pool forever -- there was no refund
--      path of any kind. This pays every logged entry fee back, once,
--      idempotently, and closes the tournament.
--   4. A BEFORE UPDATE trigger on tournaments: the money columns
--      (prizePool / prizePaid) can no longer be edited by ordinary signed-in
--      clients, even though the row's UPDATE policy stays open for gameplay
--      (rounds, chat, standings). Server-side functions (service role) and
--      tournament admins are unaffected.
--
-- Run ONCE in the Supabase SQL Editor (or let the server's auto-migration
-- apply it via SUPABASE_DB_URL). Safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Case-insensitive duplicate check in tournament_entry
-- ---------------------------------------------------------------------------
create or replace function tournament_entry(
  p_tournament_id text,
  p_username text,
  p_entry_fee numeric,
  p_player jsonb,
  p_log_line text
)
returns table("ok" boolean, "errorReason" text, "balance" numeric, "players" jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament tournaments%rowtype;
  v_balance numeric;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  select * into v_tournament from tournaments where "id" = p_tournament_id for update;
  if not found then
    return query select false, 'not_found', null::numeric, null::jsonb;
    return;
  end if;

  if v_tournament."status" is not null and v_tournament."status" <> 'registration' then
    return query select false, 'not_open', null::numeric, null::jsonb;
    return;
  end if;

  -- lower() on BOTH sides: previously "Kenny" could register twice as
  -- "kenny", and the wallet debit keyed on the raw string could create a
  -- phantom second wallet for the capitalized spelling.
  if exists (
    select 1 from jsonb_array_elements(v_tournament."players") elem
    where lower(elem->>'username') = lower(p_username)
  ) then
    return query select false, 'already_registered', null::numeric, v_tournament."players";
    return;
  end if;

  if v_tournament."maxPlayers" is not null and jsonb_array_length(v_tournament."players") >= v_tournament."maxPlayers" then
    return query select false, 'full', null::numeric, null::jsonb;
    return;
  end if;

  if p_entry_fee > 0 then
    insert into coin_wallets ("username", "balance", "createdAt")
      values (lower(p_username), 0, v_now)
      on conflict ("username") do nothing;

    select "balance" into v_balance from coin_wallets where "username" = lower(p_username) for update;
    if v_balance < p_entry_fee then
      return query select false, 'insufficient_funds', v_balance, null::jsonb;
      return;
    end if;

    v_balance := v_balance - p_entry_fee;
    update coin_wallets set "balance" = v_balance where "username" = lower(p_username);

    insert into coin_transactions ("username", "type", "amount", "direction", "balanceAfter", "reason", "refId", "timestamp")
      values (lower(p_username), 'tournament_entry', p_entry_fee, 'debit', v_balance, 'Tournament entry fee', p_tournament_id, v_now);
  else
    select "balance" into v_balance from coin_wallets where "username" = lower(p_username);
    v_balance := coalesce(v_balance, 0);
  end if;

  update tournaments
    set "players" = v_tournament."players" || p_player,
        "logs" = v_tournament."logs" || to_jsonb(p_log_line),
        "prizePool" = v_tournament."prizePool" + p_entry_fee
    where "id" = p_tournament_id
    returning "players" into v_tournament."players";

  return query select true, null::text, v_balance, v_tournament."players";
end;
$$;

revoke all on function tournament_entry(text, text, numeric, jsonb, text) from public;
grant execute on function tournament_entry(text, text, numeric, jsonb, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Winner validation in pay_tournament_prize
-- ---------------------------------------------------------------------------
create or replace function pay_tournament_prize(
  p_tournament_id text,
  p_winner_username text,
  p_rake_percent numeric
)
returns table("ok" boolean, "errorReason" text, "payout" numeric, "rake" numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament tournaments%rowtype;
  v_pool numeric;
  v_rake numeric;
  v_payout numeric;
  v_winner_balance numeric;
  v_house_balance numeric;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  select * into v_tournament from tournaments where "id" = p_tournament_id for update;
  if not found then
    return query select false, 'not_found', null::numeric, null::numeric;
    return;
  end if;

  if v_tournament."prizePaid" then
    return query select false, 'already_paid', null::numeric, null::numeric;
    return;
  end if;

  -- The winner must actually be on this tournament's roster.
  if not exists (
    select 1 from jsonb_array_elements(v_tournament."players") elem
    where lower(elem->>'username') = lower(p_winner_username)
  ) then
    return query select false, 'not_a_player', null::numeric, null::numeric;
    return;
  end if;

  v_pool := coalesce(v_tournament."prizePool", 0);

  -- If real money is in the pool, the winner must have a REAL, logged
  -- entry-fee payment for this exact tournament. A roster row alone isn't
  -- proof of anything -- the tournaments row is client-writable for
  -- gameplay, so a forged roster entry must never be payable.
  if v_pool > 0 and not exists (
    select 1 from coin_transactions
    where lower("username") = lower(p_winner_username)
      and "type" = 'tournament_entry'
      and "direction" = 'debit'
      and "refId" = p_tournament_id
  ) then
    return query select false, 'no_paid_entry', null::numeric, null::numeric;
    return;
  end if;

  if v_pool <= 0 then
    update tournaments set "prizePaid" = true where "id" = p_tournament_id;
    return query select true, null::text, 0::numeric, 0::numeric;
    return;
  end if;

  v_rake := floor(v_pool * p_rake_percent);
  if v_rake < 0 then v_rake := 0; end if;
  if v_rake > v_pool then v_rake := v_pool; end if;
  v_payout := v_pool - v_rake;

  insert into coin_wallets ("username", "balance", "createdAt")
    values (lower(p_winner_username), 0, v_now)
    on conflict ("username") do nothing;
  select "balance" into v_winner_balance from coin_wallets where "username" = lower(p_winner_username) for update;
  v_winner_balance := coalesce(v_winner_balance, 0) + v_payout;
  update coin_wallets set "balance" = v_winner_balance where "username" = lower(p_winner_username);
  insert into coin_transactions ("username", "type", "amount", "direction", "balanceAfter", "reason", "refId", "timestamp")
    values (lower(p_winner_username), 'tournament_prize', v_payout, 'credit', v_winner_balance, 'Tournament prize', p_tournament_id, v_now);

  if v_rake > 0 then
    insert into coin_wallets ("username", "balance", "createdAt")
      values ('kentro_house', 0, v_now)
      on conflict ("username") do nothing;
    select "balance" into v_house_balance from coin_wallets where "username" = 'kentro_house' for update;
    v_house_balance := coalesce(v_house_balance, 0) + v_rake;
    update coin_wallets set "balance" = v_house_balance where "username" = 'kentro_house';
    insert into coin_transactions ("username", "type", "amount", "direction", "balanceAfter", "reason", "refId", "timestamp")
      values ('kentro_house', 'rake', v_rake, 'credit', v_house_balance, 'Tournament rake', p_tournament_id, v_now);
  end if;

  update tournaments set "prizePaid" = true where "id" = p_tournament_id;

  return query select true, null::text, v_payout, v_rake;
end;
$$;

revoke all on function pay_tournament_prize(text, text, numeric) from public;
grant execute on function pay_tournament_prize(text, text, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Refunds for cancelled/abandoned tournaments
-- ---------------------------------------------------------------------------
create or replace function refund_tournament_entries(
  p_tournament_id text
)
returns table("ok" boolean, "errorReason" text, "refundedCount" integer, "refundedTotal" numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament tournaments%rowtype;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
  v_row record;
  v_balance numeric;
  v_count integer := 0;
  v_total numeric := 0;
  v_refund_ref text;
begin
  select * into v_tournament from tournaments where "id" = p_tournament_id for update;
  if not found then
    return query select false, 'not_found', 0, 0::numeric;
    return;
  end if;

  -- prizePaid doubles as "financially settled" -- a paid-out tournament
  -- can't also be refunded, and a refunded one can't be refunded twice.
  if v_tournament."prizePaid" then
    return query select false, 'already_settled', 0, 0::numeric;
    return;
  end if;

  v_refund_ref := 'tournament-refund:' || p_tournament_id;

  for v_row in
    select "username", sum("amount") as amt
    from coin_transactions
    where "refId" = p_tournament_id
      and "type" = 'tournament_entry'
      and "direction" = 'debit'
    group by "username"
  loop
    -- Idempotency per player: if this exact refund was already logged
    -- (e.g. an earlier partially-failed run), skip them.
    if exists (
      select 1 from coin_transactions
      where "username" = v_row."username"
        and "type" = 'refund'
        and "refId" = v_refund_ref
    ) then
      continue;
    end if;

    select "balance" into v_balance from coin_wallets where "username" = v_row."username" for update;
    v_balance := coalesce(v_balance, 0) + v_row.amt;
    update coin_wallets set "balance" = v_balance where "username" = v_row."username";
    insert into coin_transactions ("username", "type", "amount", "direction", "balanceAfter", "reason", "refId", "timestamp")
      values (v_row."username", 'refund', v_row.amt, 'credit', v_balance, 'Tournament cancelled — entry fee refunded', v_refund_ref, v_now);

    v_count := v_count + 1;
    v_total := v_total + v_row.amt;
  end loop;

  update tournaments
    set "prizePool" = 0,
        "prizePaid" = true,
        "status" = 'cancelled',
        "logs" = coalesce("logs", '[]'::jsonb) || to_jsonb('Tournament cancelled — all entry fees refunded.'::text)
    where "id" = p_tournament_id;

  return query select true, null::text, v_count, v_total;
end;
$$;

revoke all on function refund_tournament_entries(text) from public;
grant execute on function refund_tournament_entries(text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Money columns are server-managed, even though the row stays writable
-- ---------------------------------------------------------------------------
create or replace function tournaments_money_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new."prizePool" is distinct from old."prizePool"
      or new."prizePaid" is distinct from old."prizePaid")
     and auth.uid() is not null                -- service-role/definer calls have no auth.uid()
     and not is_tournament_admin(auth.uid())
  then
    raise exception 'prizePool/prizePaid are managed by the server';
  end if;
  return new;
end;
$$;

drop trigger if exists tournaments_money_guard_trg on tournaments;
create trigger tournaments_money_guard_trg
  before update on tournaments
  for each row execute function tournaments_money_guard();
