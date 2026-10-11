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
