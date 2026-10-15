-- =============================================================================
-- KENTRO DRAUGHT — ALL MIGRATIONS, ONE FILE.
--
-- Paste this ENTIRE file into the Supabase SQL Editor and run it ONCE.
-- Every statement is idempotent (guards were added automatically), so it is
-- completely safe to run on a database that already has some or all of these
-- applied — nothing errors, nothing is lost, existing data is untouched.
--
-- After running this you do NOT need the SUPABASE_DB_URL secret at all:
-- delete it from your Space and the server boots instantly, skipping the
-- database-connection step entirely.
--
-- (This file does NOT wipe anything. The factory reset lives separately in
-- reset_all_data.sql — run that one only when you deliberately want to
-- erase all data, and run THIS file first so the signup trigger exists
-- before you re-register your owner account.)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- SECTION 0: signup-fix trigger (creates a profile the instant an auth user
-- exists — essential when "Confirm email" is enabled, and for the owner
-- account registration after a reset)
-- ---------------------------------------------------------------------------

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles ("usernameLower", "username", "ownerId", "createdAt")
  values (
    lower(trim(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)))),
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    new.id,
    extract(epoch from now()) * 1000
  )
  on conflict ("usernameLower") do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

insert into public.profiles ("usernameLower", "username", "ownerId", "createdAt")
select
  lower(trim(coalesce(u.raw_user_meta_data ->> 'username', split_part(u.email, '@', 1)))),
  coalesce(u.raw_user_meta_data ->> 'username', split_part(u.email, '@', 1)),
  u.id,
  extract(epoch from u.created_at) * 1000
from auth.users u
where not exists (select 1 from public.profiles p where p."ownerId" = u.id)
on conflict ("usernameLower") do nothing;



-- ---------------------------------------------------------------------------
-- SECTION: 2026-07-22_tournament_admin_gate.sql
-- ---------------------------------------------------------------------------

-- Migration: restrict tournament creation/deletion to admins.
--
-- Run this ONCE in your existing Supabase project's SQL Editor (or via
-- `supabase db push` if you've adopted migrations). schema.sql itself is
-- meant for a fresh install only (see its header comment) -- this file is
-- the incremental version for a database you already have data in.
--
-- Safe to run more than once (uses CREATE OR REPLACE / DROP ... IF EXISTS
-- throughout), so re-running it if you're not sure whether it already
-- applied won't cause an error.
--
-- What this changes:
--   * Registering for, playing rounds in, and chatting inside a tournament
--     someone else created is UNCHANGED -- those go through UPDATE, which
--     stays open to every signed-in player.
--   * Creating a new tournament (INSERT) and deleting one (DELETE) now
--     require the "manage_tournaments" admin permission.

create or replace function is_tournament_admin(p_uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from admins
    where "uid" = p_uid and 'manage_tournaments' = any("permissions")
  );
$$;

grant execute on function is_tournament_admin(uuid) to authenticated;

drop policy if exists "tournaments_write_authenticated" on tournaments;
create policy "tournaments_write_authenticated" on tournaments
  for insert to authenticated with check (is_tournament_admin(auth.uid()));

drop policy if exists "tournaments_delete_authenticated" on tournaments;
create policy "tournaments_delete_authenticated" on tournaments
  for delete to authenticated using (is_tournament_admin(auth.uid()));

-- tournaments_update_authenticated and tournaments_select_all are untouched
-- on purpose -- gameplay (registering, rounds, chat) still needs them open.

-- After running this, make sure at least one row in `admins` has
-- 'manage_tournaments' in its permissions array (Admin Panel -> Admins tab,
-- or `select * from admins;` in the SQL Editor to check), or nobody --
-- including you -- will be able to create a tournament from the client.



-- ---------------------------------------------------------------------------
-- SECTION: 2026-07-23_signup_profile_fix.sql
-- ---------------------------------------------------------------------------

-- THE BUG: sign up with email -> "check your email" -> confirm -> later try
-- to sign in with username + password -> "No account found with that
-- username."
--
-- WHY: signUpWithEmail (src/supabase.ts) writes the new profiles row itself,
-- right after auth.signUp(). But with "Confirm email" on (Supabase Dashboard
-- default), signUp() deliberately returns no session until the confirmation
-- link is clicked -- so that write runs with auth.uid() = null, and the
-- profiles RLS policy (ownerId = auth.uid()) silently rejects it. The
-- account gets created and confirmed fine; the profiles row just never
-- shows up. Only a user's real, permanent Supabase account exists to sign
-- in with by email -- there's no separate account "created by Gmail" vs "by
-- username", it's the same one, just missing this one row.
--
-- THE FIX: a database trigger that creates the profiles row the instant the
-- auth.users row exists, inside the same transaction, with elevated
-- privilege -- so it doesn't depend on the browser having a session at all.
-- Plus a one-time backfill for every account this already happened to.
--
-- Run this ONCE in your Supabase project's SQL Editor. Safe to run more
-- than once (CREATE OR REPLACE / DROP...IF EXISTS / ON CONFLICT DO NOTHING
-- throughout).
--
-- This exact SQL already lives in two places in your codebase -- this file
-- just pulls it into one copy-paste so you don't have to dig for it:
--   * supabase/schema.sql (search "handle_new_user") -- for a fresh install
--   * server.ts (search "SIGNUP_FIX_MIGRATION_SQL") -- auto-runs this same
--     SQL on every server boot IF the SUPABASE_DB_URL env var is set
--     (Supabase Dashboard -> Project Settings -> Database -> Connection
--     string -> URI, real password filled in). Setting that in your Hugging
--     Face Space secrets means this stays applied automatically even after
--     future redeploys -- worth doing in addition to running this once now.

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles ("usernameLower", "username", "ownerId", "createdAt")
  values (
    lower(trim(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)))),
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    new.id,
    extract(epoch from now()) * 1000
  )
  on conflict ("usernameLower") do nothing; -- e.g. if the client's own upsert already won the race
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- One-time backfill: every real account that already hit this bug (signed
-- up before this trigger existed) gets its missing profiles row created
-- right now, so they can sign in by username immediately -- no need to
-- re-signup.
insert into public.profiles ("usernameLower", "username", "ownerId", "createdAt")
select
  lower(trim(coalesce(u.raw_user_meta_data ->> 'username', split_part(u.email, '@', 1)))),
  coalesce(u.raw_user_meta_data ->> 'username', split_part(u.email, '@', 1)),
  u.id,
  extract(epoch from u.created_at) * 1000
from auth.users u
where not exists (select 1 from public.profiles p where p."ownerId" = u.id)
on conflict ("usernameLower") do nothing;

-- Sanity check after running: this should return 0 rows. If it doesn't,
-- something else is also wrong (e.g. a username collision the ON CONFLICT
-- DO NOTHING silently skipped) and is worth a closer look.
-- select id, email, created_at from auth.users u
-- where not exists (select 1 from public.profiles p where p."ownerId" = u.id);



-- ---------------------------------------------------------------------------
-- SECTION: 2026-07-24_reserve_house_wallet.sql
-- ---------------------------------------------------------------------------

-- Reserves the "kentro_house" wallet identity, which now collects rake from
-- wagered matches (10%) and tournament prize pools (20%) -- see
-- coinsService.ts (HOUSE_WALLET_USERNAME) and settleMatchPot().
--
-- Run this ONCE in the Supabase SQL Editor, ideally right away -- the
-- earlier this runs, the earlier "kentro_house" is permanently unavailable
-- to any real signup, no matter how that signup is constructed (this isn't
-- just a client-side username-format check, which can be bypassed by
-- calling supabase.auth.signUp() directly -- it's a real row claiming the
-- unique username slot at the database level, so nothing can ever remove or
-- reroute it afterward).
--
-- Safe to run more than once (ON CONFLICT DO NOTHING).

insert into coin_wallets ("username", "balance", "ownerId", "createdAt")
values ('kentro_house', 0, null, extract(epoch from now()) * 1000)
on conflict ("username") do nothing;

-- Sanity check after running -- should return exactly one row, balance 0
-- (or more, if rake has already started accumulating by the time you run
-- this).
-- select * from coin_wallets where username = 'kentro_house';



-- ---------------------------------------------------------------------------
-- SECTION: 2026-07-24_tournament_prize_pool.sql
-- ---------------------------------------------------------------------------

-- Tournament prize pools: entry fees were being collected (tournament_entry
-- in schema.sql) but never actually paid out to anyone, and weren't even
-- logged to coin_transactions. This fixes both:
--   1. Every entry fee now increments a real "prizePool" total on the
--      tournament row, in the same atomic transaction as the debit, and
--      is logged like every other coin movement.
--   2. A new pay_tournament_prize() function pays the pool out (minus a
--      20% rake to the house) to a winner an admin confirms, once, ever,
--      per tournament (prizePaid guards against paying twice).
--
-- Run this ONCE in the Supabase SQL Editor. Safe to run more than once.

alter table tournaments add column if not exists "prizePool" numeric not null default 0;
alter table tournaments add column if not exists "prizePaid" boolean not null default false;

-- Same shape as tournament_entry() below it, just adding prize-pool
-- tracking and (new) actual coin_transactions logging, which the original
-- never had.
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

  if exists (
    select 1 from jsonb_array_elements(v_tournament."players") elem
    where elem->>'username' = p_username
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
      values (p_username, 0, v_now)
      on conflict ("username") do nothing;

    select "balance" into v_balance from coin_wallets where "username" = p_username for update;
    if v_balance < p_entry_fee then
      return query select false, 'insufficient_funds', v_balance, null::jsonb;
      return;
    end if;

    v_balance := v_balance - p_entry_fee;
    update coin_wallets set "balance" = v_balance where "username" = p_username;

    insert into coin_transactions ("username", "type", "amount", "direction", "balanceAfter", "reason", "refId", "timestamp")
      values (p_username, 'tournament_entry', p_entry_fee, 'debit', v_balance, 'Tournament entry fee', p_tournament_id, v_now);
  else
    select "balance" into v_balance from coin_wallets where "username" = p_username;
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

-- Pays out a tournament's accumulated prize pool, minus a rake, to the
-- confirmed winner -- atomically, and only once per tournament (prizePaid
-- guards a double-pay from e.g. an admin double-clicking or a retried
-- request). Deliberately takes the winner as a parameter rather than trying
-- to compute one itself: tournament formats/standings here are flexible
-- enough (Swiss, handicap, custom types) that auto-detecting a winner
-- reliably isn't a safe bet with real money attached -- the server endpoint
-- calling this still requires an admin to confirm who actually won.
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

  v_pool := coalesce(v_tournament."prizePool", 0);
  if v_pool <= 0 then
    -- Nothing to pay out (e.g. a free tournament) -- still mark paid so
    -- this is a deliberate, once-only action either way.
    update tournaments set "prizePaid" = true where "id" = p_tournament_id;
    return query select true, null::text, 0::numeric, 0::numeric;
    return;
  end if;

  v_rake := floor(v_pool * p_rake_percent);
  if v_rake < 0 then v_rake := 0; end if;
  if v_rake > v_pool then v_rake := v_pool; end if;
  v_payout := v_pool - v_rake;

  insert into coin_wallets ("username", "balance", "createdAt")
    values (p_winner_username, 0, v_now)
    on conflict ("username") do nothing;
  select "balance" into v_winner_balance from coin_wallets where "username" = p_winner_username for update;
  v_winner_balance := coalesce(v_winner_balance, 0) + v_payout;
  update coin_wallets set "balance" = v_winner_balance where "username" = p_winner_username;
  insert into coin_transactions ("username", "type", "amount", "direction", "balanceAfter", "reason", "refId", "timestamp")
    values (p_winner_username, 'tournament_prize', v_payout, 'credit', v_winner_balance, 'Tournament prize', p_tournament_id, v_now);

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
-- SECTION: 2026-07-24_withdrawal_requests.sql
-- ---------------------------------------------------------------------------

-- Adds the withdrawal_requests table. Coins are escrowed (debited) the
-- moment a request is submitted via POST /api/coins/withdraw-request, not
-- when an admin approves it -- "pending" means the money already left the
-- player's spendable balance and is sitting in limbo until an admin either
-- pays it out (paid) or rejects it (which refunds the escrow).
--
-- No client-side INSERT/UPDATE policy on purpose: unlike purchase_requests
-- (a claim with no money movement until an admin approves it), a withdrawal
-- request itself moves real coins out of a wallet, so it has to go through
-- server-validated logic (balance check, minimum amount, games-played and
-- account-age eligibility) via the service-role client, not a raw insert
-- straight from the browser.
--
-- Run this ONCE in the Supabase SQL Editor. Safe to run more than once.

create table if not exists withdrawal_requests (
  "id"             uuid primary key default gen_random_uuid(),
  "username"       text not null,
  "ownerId"        uuid,
  "coins"          numeric not null,
  "nairaAmount"    numeric not null,
  "accountName"    text not null,
  "accountNumber"  text not null,
  "bankName"       text,
  "status"         text not null default 'pending',
  "submittedAt"    bigint,
  "resolvedBy"     text,
  "resolvedAt"     bigint
);

alter table withdrawal_requests enable row level security;

drop policy if exists "withdrawal_requests_select_own" on withdrawal_requests;
create policy "withdrawal_requests_select_own" on withdrawal_requests
  for select to authenticated using (auth.uid() = "ownerId");



-- ---------------------------------------------------------------------------
-- SECTION: 2026-07-25_profile_avatar_column.sql
-- ---------------------------------------------------------------------------

-- Adds the avatarUrl column player profiles now read/display. Safe to run
-- more than once (IF NOT EXISTS).
alter table profiles add column if not exists "avatarUrl" text;



-- ---------------------------------------------------------------------------
-- SECTION: 2026-07-27_puzzles.sql
-- ---------------------------------------------------------------------------

-- Puzzles: admin-authored traps + tactics auto-mined from real completed
-- games (lidraughts-style). Solutions are ordered {from, to, text} steps in
-- Nigerian 1-50 numbering; fen is the engine's Scan FEN for the start
-- position (side to move = the solver).
create table if not exists puzzles (
  "id"             uuid primary key default gen_random_uuid(),
  "title"          text not null,
  "difficulty"     text not null default 'Medium',   -- Easy | Medium | Hard
  "theme"          text not null default 'Tactics',
  "description"    text not null default '',
  "fen"            text not null,
  "solution"       jsonb not null,                    -- [{from,to,text}, ...]
  "explanation"    text not null default '',
  "source"         text not null default 'admin',     -- 'admin' | 'game'
  "sourceGameId"   text,                              -- completed_games."gameId" when mined
  "createdBy"      text,
  "createdAt"      timestamptz not null default now()
);

create index if not exists puzzles_created_idx on puzzles ("createdAt" desc);
create index if not exists puzzles_source_game_idx on puzzles ("sourceGameId");

alter table puzzles enable row level security;

-- Everyone signed in can read puzzles; writes go through the server's
-- service-role key only (admin endpoints), same as coin settings.
drop policy if exists "puzzles_select_authenticated" on puzzles;
create policy "puzzles_select_authenticated" on puzzles
  for select to authenticated using (true);



-- ---------------------------------------------------------------------------
-- SECTION: 2026-07-27_tournament_hardening.sql
-- ---------------------------------------------------------------------------

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

-- 2026-10-14 audit security and atomic ledger migrations
-- Manual staging/backup review required. See docs/audit/07_SUPABASE_AND_DATABASE.md.
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
      and p."usernameLower" = lower(trim(p_username)));
$$;
revoke all on function public.kentro_owns_username(text) from public;
grant execute on function public.kentro_owns_username(text) to authenticated;

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
  using (auth.uid()="senderOwnerId" or auth.uid()="recipientOwnerId")
  with check (auth.uid()="senderOwnerId" or auth.uid()="recipientOwnerId");
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
  using (true) with check (true);
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
