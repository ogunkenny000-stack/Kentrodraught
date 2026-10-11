-- Fix: "column reference balance is ambiguous" in debit_wallet (error 42702).
--
-- The function declares  returns table("ok" boolean, "balance" numeric)  which
-- creates an OUTPUT column called "balance". Inside the body it also does
-- select "balance" from coin_wallets -- and Postgres can't tell whether
-- "balance" means the table's column or the function's output column, so every
-- call fails. This is why "unlock AI level" (and any coin spend that debits)
-- errored out even when the player had plenty of coins.
--
-- The fix qualifies every reference to the TABLE column as coin_wallets."balance",
-- so there is no ambiguity. Behaviour is otherwise identical.
--
-- Run ONCE in the Supabase SQL Editor (idempotent -- safe to re-run).

create or replace function debit_wallet(
  p_username text,
  p_amount numeric,
  p_reason text,
  p_ref_id text default null
)
returns table("ok" boolean, "balance" numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current numeric;
  v_next numeric;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if p_amount <= 0 then
    raise exception 'debit_wallet: amount must be positive';
  end if;

  insert into coin_wallets ("username", "balance", "createdAt")
    values (p_username, 0, v_now)
    on conflict ("username") do nothing;

  -- Qualify with the table name so "balance" is unambiguous.
  select coin_wallets."balance" into v_current
    from coin_wallets where coin_wallets."username" = p_username for update;

  if v_current < p_amount then
    return query select false, v_current;
    return;
  end if;

  v_next := v_current - p_amount;
  update coin_wallets set "balance" = v_next where coin_wallets."username" = p_username;

  insert into coin_transactions ("username", "type", "amount", "direction", "balanceAfter", "reason", "refId", "timestamp")
    values (p_username, p_reason, p_amount, 'debit', v_next, p_reason, p_ref_id, v_now);

  return query select true, v_next;
end;
$$;

revoke all on function debit_wallet(text, numeric, text, text) from public;
grant execute on function debit_wallet(text, numeric, text, text) to service_role;
