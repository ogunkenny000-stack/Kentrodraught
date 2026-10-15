-- Kentro Draught -- Supabase (Postgres) schema
--
-- This replaces the old Firestore data model (see git history for
-- `firestore.rules` / `firebase-blueprint.json` if you need the original
-- reference). Run this once against a fresh Supabase project:
--
--   supabase db push
--   -- or paste this file into the SQL Editor in the Supabase dashboard
--
-- DESIGN NOTE -- column naming: columns keep the EXACT camelCase names the
-- old Firestore documents used ("ownerId", "whitePlayer", "chatId", ...),
-- quoted here so Postgres preserves the case. supabase-js returns column
-- names verbatim (no camelCase<->snake_case translation), so every existing
-- `doc.whitePlayer` / `data.ownerId` read in the frontend keeps working
-- unchanged -- only the data-access calls themselves (Firestore SDK calls ->
-- supabase-js calls) needed to change, not the hundreds of call sites that
-- just read fields off the returned objects. Table names are plain
-- snake_case since those are only ever referenced as string literals in
-- `.from(...)`, never as JS object keys.
--
-- DESIGN NOTE -- jsonb columns: a few fields (players/matches/chat/logs on
-- tournaments, moveHistory/moveEvaluations on completed_games, reactions on
-- private_messages, permissions on admins) were always read and written as
-- one whole nested structure in the original app, never queried into. jsonb
-- is the idiomatic Postgres fit for that -- it is not a NoSQL-inside-SQL
-- workaround, just the right column type for "opaque structured blob the
-- app owns."
--
-- This base schema must be followed by the incremental migrations. The
-- October 2026 security migrations bind identities to Auth UIDs, protect
-- statistics/economy writes and replace permissive legacy browser policies.

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- =========================================================================
-- profiles  (was: users/{username})
-- =========================================================================
-- Primary key is the lowercased username, exactly like the old Firestore
-- doc ID (`doc(db, "users", uname.toLowerCase().trim())`). "username" keeps
-- the user's display casing, same split the old docs had between the doc ID
-- and the `username` field.
create table if not exists profiles (
  "usernameLower"      text primary key,
  "username"           text not null,
  "ownerId"            uuid references auth.users(id) on delete set null,
  "elo"                numeric not null default 1500,
  "rd"                 numeric,
  "vol"                numeric,
  "wins"               integer not null default 0,
  "losses"             integer not null default 0,
  "draws"              integer not null default 0,
  "gamesCount"         integer not null default 0,
  "totalPlayTime"      numeric not null default 0,
  "averageDuration"    numeric not null default 0,
  "maxUnlockedKenLevel" integer not null default 1,
  "avatarUrl"          text,
  "banned"             boolean not null default false,
  "bannedAt"           bigint,
  "bannedBy"           text,
  "suspendedUntil"     bigint,
  "suspendedBy"        text,
  "createdAt"          bigint
);

create index if not exists profiles_owner_id_idx on profiles ("ownerId");

alter table profiles enable row level security;

-- Public profile read, same as the old "allow read: if true" -- leaderboards,
-- opponent lookups, and the admin panel all depend on this.
create policy "profiles_select_all" on profiles
  for select using (true);

-- A profile can only be created/claimed by the signed-in owner it names.
create policy "profiles_insert_own" on profiles
  for insert with check (auth.uid() = "ownerId");

-- Only the owner can update their own profile, and only while it stays
-- theirs (same intent as the old rule: owner-gated read-modify-write).
create policy "profiles_update_own" on profiles
  for update using (auth.uid() = "ownerId") with check (auth.uid() = "ownerId");

-- no delete policy -- profiles are never deleted by clients, same as before.


-- =========================================================================
-- completed_games  (was: completed_games/{gameId})
-- =========================================================================
-- "timestamp" is a PLAIN bigint (epoch ms), not timestamptz -- the original
-- app wrote `timestamp: Date.now()` (a plain number), never
-- serverTimestamp(), and a lot of client sort/compare code
-- (`(b.timestamp||0) - (a.timestamp||0)`) depends on it staying a number.
create table if not exists completed_games (
  "gameId"             text primary key,
  "whitePlayer"        text,
  "blackPlayer"        text,
  "winner"             text,
  "moveHistoryStrings" jsonb,
  "moveHistory"        jsonb,
  "moveEvaluations"    jsonb default '{}'::jsonb,
  "playMode"           text,
  "timestamp"          bigint,
  "createdAt"          timestamptz not null default now()
);

create index if not exists completed_games_timestamp_idx on completed_games ("timestamp" desc);
create index if not exists completed_games_white_idx on completed_games ("whitePlayer");
create index if not exists completed_games_black_idx on completed_games ("blackPlayer");

alter table completed_games enable row level security;

create policy "completed_games_select_all" on completed_games
  for select using (true);

-- Any signed-in player can record a finished game (same as the old
-- "allow write: if request.auth != null").
create policy "completed_games_write_authenticated" on completed_games
  for insert to authenticated with check (true);

create policy "completed_games_update_authenticated" on completed_games
  for update to authenticated using (true) with check (true);


-- Define administrators before SQL-language authorization functions resolve it.
create table if not exists admins (
  "username"    text primary key,
  "uid"         uuid,
  "permissions" text[] not null default '{}',
  "roleLabel"   text,
  "addedAt"     bigint,
  "addedBy"     text
);

alter table admins enable row level security;
-- Deliberately no policies at all: RLS defaults to deny for anon and
-- authenticated. Only the service-role client (server.ts) can read/write.



-- Used by the tournaments INSERT/DELETE policies below to check admin status
-- without opening up direct client access to the `admins` table (which has
-- no policies at all, by design -- see that table's definition further down
-- this file). SECURITY DEFINER runs this with the privileges of the role
-- that creates it (not the calling user's), so it can read `admins` even
-- though the caller can't -- it only ever returns a plain boolean, never any
-- row data, so it can't be used to leak who else is an admin.
-- search_path is pinned per Postgres/Supabase security guidance for
-- SECURITY DEFINER functions, to prevent search-path hijacking.
-- (Referencing `admins` here before its `create table` below is fine --
-- Postgres doesn't resolve table/column references inside a function body
-- until the function is actually called, only once the whole script below
-- has finished running and the table exists.)
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

-- =========================================================================
-- tournaments  (was: tournaments/{tournamentId})
-- =========================================================================
create table if not exists tournaments (
  "id"                     text primary key,
  "name"                   text,
  "description"            text,
  "type"                   text,
  "visibility"             text,
  "inviteCode"             text,
  "maxPlayers"             integer,
  "minPlayers"             integer,
  "registrationDeadline"   text,
  "startTime"              text,
  "timeControl"            text,
  "handicap"               text,
  "tieBreak"               text,
  "prize"                  text,
  "spectatorPermission"    boolean default true,
  "status"                 text,
  "currentRound"           integer default 0,
  "maxRounds"              integer,
  "prizePool"              numeric not null default 0,
  "prizePaid"              boolean not null default false,
  "players"                jsonb not null default '[]'::jsonb,
  "matches"                jsonb not null default '[]'::jsonb,
  "chat"                   jsonb not null default '[]'::jsonb,
  "logs"                   jsonb not null default '[]'::jsonb,
  "createdAt"              timestamptz not null default now()
);

create index if not exists tournaments_created_at_idx on tournaments ("createdAt" desc);

alter table tournaments enable row level security;

create policy "tournaments_select_all" on tournaments
  for select using (true);

-- Only admins with the "manage_tournaments" permission may create or delete
-- tournaments (see is_tournament_admin() just above -- the admins table
-- itself has no client-readable policies, so a plain RLS subquery against it
-- can't be used directly here). Registering, playing rounds, and chatting in
-- an existing tournament all go through UPDATE, which stays open to every
-- authenticated player -- this restriction is about who can spin up or
-- tear down a tournament, not who can participate in one.
create policy "tournaments_write_authenticated" on tournaments
  for insert to authenticated with check (is_tournament_admin(auth.uid()));

create policy "tournaments_update_authenticated" on tournaments
  for update to authenticated using (true) with check (true);

create policy "tournaments_delete_authenticated" on tournaments
  for delete to authenticated using (is_tournament_admin(auth.uid()));


-- =========================================================================
-- friends  (was: friends/{friendId}, friendId = [u1,u2].sort().join("_"))
-- =========================================================================
create table if not exists friends (
  "id"        text primary key,
  "user1"     text not null,
  "user2"     text not null,
  "user1Elo"  numeric,
  "user2Elo"  numeric,
  "status"    text not null default 'pending',
  "sender"    text,
  "timestamp" timestamptz not null default now()
);

create index if not exists friends_user1_idx on friends ("user1");
create index if not exists friends_user2_idx on friends ("user2");

alter table friends enable row level security;

create policy "friends_select_authenticated" on friends
  for select to authenticated using (true);

create policy "friends_write_authenticated" on friends
  for insert to authenticated with check (true);

create policy "friends_update_authenticated" on friends
  for update to authenticated using (true) with check (true);

create policy "friends_delete_authenticated" on friends
  for delete to authenticated using (true);


-- =========================================================================
-- private_messages  (was: private_messages/{messageId})
-- =========================================================================
create table if not exists private_messages (
  "id"                uuid primary key default gen_random_uuid(),
  "chatId"            text not null,
  "text"              text,
  "voiceNote"         text,
  "duration"          numeric,
  "sticker"           text,
  "stickerEmoji"      text,
  "stickerImageUrl"   text,
  "stickerLabel"      text,
  "sender"            text not null,
  "recipient"         text not null,
  "senderOwnerId"     uuid,
  "recipientOwnerId"  uuid,
  "reactions"         jsonb not null default '{}'::jsonb,
  "timestamp"         timestamptz not null default now()
);

create index if not exists private_messages_chat_id_idx on private_messages ("chatId", "timestamp");

alter table private_messages enable row level security;

-- Same gate as the old rule: only the two participants (by ownerId) can
-- read a DM thread.
create policy "private_messages_select_participant" on private_messages
  for select to authenticated
  using (auth.uid() = "senderOwnerId" or auth.uid() = "recipientOwnerId");

create policy "private_messages_insert_participant" on private_messages
  for insert to authenticated
  with check (auth.uid() = "senderOwnerId" or auth.uid() = "recipientOwnerId");

create policy "private_messages_update_participant" on private_messages
  for update to authenticated
  using (auth.uid() = "senderOwnerId" or auth.uid() = "recipientOwnerId")
  with check (auth.uid() = "senderOwnerId" or auth.uid() = "recipientOwnerId");


-- =========================================================================
-- global_chat  (was: global_chat/{messageId})
-- =========================================================================
create table if not exists global_chat (
  "id"        uuid primary key default gen_random_uuid(),
  "text"      text not null,
  "sender"    text not null,
  "timestamp" timestamptz not null default now()
);

create index if not exists global_chat_timestamp_idx on global_chat ("timestamp" desc);

alter table global_chat enable row level security;

create policy "global_chat_select_authenticated" on global_chat
  for select to authenticated using (true);

create policy "global_chat_insert_authenticated" on global_chat
  for insert to authenticated with check (true);


-- =========================================================================
-- coin_wallets + coin_transactions  (was: coinWallets/{username}/transactions/{txId})
-- =========================================================================
-- Client read-only, same as before ("allow write: if false" in the old
-- rules -- every balance change goes through the server's service-role
-- client and the RPC functions below).
create table if not exists coin_wallets (
  "username"  text primary key,
  "balance"   numeric not null default 0,
  "ownerId"   uuid,
  "createdAt" bigint
);

create table if not exists coin_transactions (
  "id"           uuid primary key default gen_random_uuid(),
  "username"     text not null references coin_wallets("username") on delete cascade,
  "type"         text,
  "amount"       numeric not null,
  "direction"    text not null,
  "balanceAfter" numeric not null,
  "reason"       text,
  "refId"        text,
  "timestamp"    bigint
);

create index if not exists coin_transactions_username_idx on coin_transactions ("username", "timestamp" desc);

alter table coin_wallets enable row level security;
alter table coin_transactions enable row level security;

create policy "coin_wallets_select_owner" on coin_wallets
  for select to authenticated using (auth.uid() = "ownerId");

create policy "coin_transactions_select_owner" on coin_transactions
  for select to authenticated using (
    exists (
      select 1 from coin_wallets w
      where w."username" = coin_transactions."username" and w."ownerId" = auth.uid()
    )
  );

-- no insert/update/delete policies on either table -- only the service-role
-- client (which bypasses RLS entirely) can write, via debit_wallet /
-- credit_wallet / debit_multiple_wallets below.


-- =========================================================================
-- admins  (was: admins/{username}) -- no client access at all, same as before
-- =========================================================================
-- =========================================================================
-- audit_logs  (was: auditLogs/{logId}) -- append-only via Admin SDK, no
-- client access at all, same as before
-- =========================================================================
create table if not exists audit_logs (
  "id"             uuid primary key default gen_random_uuid(),
  "adminUsername"  text,
  "adminUid"       uuid,
  "action"         text,
  "target"         text,
  "details"        jsonb,
  "result"         text,
  "ip"             text,
  "timestamp"      bigint
);

alter table audit_logs enable row level security;
-- No policies -- server (service role) only, same as the old rules.


-- =========================================================================
-- purchase_requests  (was: purchaseRequests/{requestId})
-- =========================================================================
create table if not exists purchase_requests (
  "id"             uuid primary key default gen_random_uuid(),
  "username"       text not null,
  "item"           text,
  "packageId"      text,
  "coins"          numeric,
  "amountNaira"    numeric,
  "receiptRef"     text,
  "status"         text not null default 'pending',
  "submittedAt"    bigint,
  "ownerId"        uuid,
  "resolvedBy"     text,
  "resolvedAt"     bigint,
  "coinsCredited"  numeric
);

alter table purchase_requests enable row level security;

-- Create your own, read your own -- same as the old rule.
create policy "purchase_requests_select_own" on purchase_requests
  for select to authenticated using (auth.uid() = "ownerId");

-- =========================================================================
-- withdrawal_requests
-- =========================================================================
-- Coins are debited from the wallet (escrowed) the moment a request is
-- submitted, not when an admin approves it -- see /api/coins/withdraw-request
-- in server.ts. That's what "pending" means here: money already left the
-- player's spendable balance, sitting in limbo until an admin either pays it
-- out (status -> paid) or rejects it, which refunds the escrow back.
create table if not exists withdrawal_requests (
  "id"             uuid primary key default gen_random_uuid(),
  "username"       text not null,
  "ownerId"        uuid,
  "coins"          numeric not null,
  "nairaAmount"    numeric not null,
  "accountName"    text not null,
  "accountNumber"  text not null,
  "bankName"       text,
  "status"         text not null default 'pending', -- pending | paid | rejected
  "submittedAt"    bigint,
  "resolvedBy"     text,
  "resolvedAt"     bigint
);

alter table withdrawal_requests enable row level security;

create policy "withdrawal_requests_select_own" on withdrawal_requests
  for select to authenticated using (auth.uid() = "ownerId");

create policy "purchase_requests_insert_own" on purchase_requests
  for insert to authenticated with check (auth.uid() = "ownerId");

-- Updates (approve/reject) only ever happen via the server's service-role
-- client -- no client update/delete policy, same as before.


-- =========================================================================
-- reports  (was: reports/{reportId}) -- create/read own only
-- =========================================================================
create table if not exists reports (
  "id"          uuid primary key default gen_random_uuid(),
  "reporterId"  uuid,
  "status"      text not null default 'open',
  "details"     jsonb,
  "createdAt"   bigint
);

alter table reports enable row level security;

create policy "reports_select_own" on reports
  for select to authenticated using (auth.uid() = "reporterId");

create policy "reports_insert_own" on reports
  for insert to authenticated with check (auth.uid() = "reporterId");


-- =========================================================================
-- app_config  (was: appConfig/{docId}) -- public read, admin-only write
-- =========================================================================
-- The whole CoinSettings object (match fee, tournament fee, AI unlock
-- costs, coin packages) lives in one jsonb blob, same as the single
-- Firestore doc it replaces -- it was always read/written as one unit.
create table if not exists app_config (
  "id"   text primary key,
  "data" jsonb not null default '{}'::jsonb
);

alter table app_config enable row level security;

create policy "app_config_select_all" on app_config
  for select using (true);

-- No client write policy -- admin-only writes go through the server's
-- service-role client, same as before.


-- =========================================================================
-- resolve_username_to_email(username) -- was the usernameToEmail collection
-- =========================================================================
-- The old app kept a whole extra `usernameToEmail/{username}` collection
-- just so the client could look up an email before it had a session to
-- sign in with. With a real relational DB we don't need a duplicate
-- mapping table -- this function joins profiles -> auth.users directly.
-- SECURITY DEFINER reads auth.users for the Node authentication facade.
-- Browser roles cannot execute this function or enumerate account emails.
create or replace function resolve_username_to_email(p_username text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
begin
  select u.email into v_email
  from profiles p
  join auth.users u on u.id = p."ownerId"
  where p."usernameLower" = lower(trim(p_username));

  return v_email;
end;
$$;

revoke all on function resolve_username_to_email(text) from public, anon, authenticated;
grant execute on function resolve_username_to_email(text) to service_role;

-- =========================================================================
-- handle_new_user() -- creates the profiles row the instant an account
-- exists, fixing a real bug: the client-side upsert in signUpWithEmail
-- (src/supabase.ts) runs immediately after supabase.auth.signUp(), but with
-- "Confirm email" enabled, signUp() deliberately returns NO active session
-- until the confirmation link is clicked. That client write happens as an
-- unauthenticated request, auth.uid() is null, and the RLS policy on
-- profiles (ownerId = auth.uid()) correctly rejects it -- silently, since
-- the calling code only logs the failure and never surfaces it. Net
-- result: signup "succeeds" from the user's point of view (they see the
-- "check your email" screen), the account gets created and even gets
-- confirmed, but no profile row is ever created -- so sign-in-by-username
-- can never find them ("No account found with that username"), because
-- there genuinely isn't one in the profiles table.
--
-- A trigger sidesteps this timing gap entirely: it fires inside the same
-- transaction as the INSERT into auth.users, runs with elevated privilege
-- (security definer), and doesn't depend on the browser having a session
-- at all. This is the standard, canonical fix for this exact class of bug
-- in Supabase apps. The client-side upsert in signUpWithEmail is left in
-- place as a harmless no-op fallback (onConflict already makes it a no-op
-- once this trigger has created the row) rather than removed, but this
-- trigger is what actually does the real work from now on.
-- =========================================================================
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

-- =========================================================================
-- One-time backfill for any accounts already created before this trigger
-- existed (e.g. test signups made while diagnosing this bug) -- creates
-- the missing profiles row for every confirmed auth.users account that
-- doesn't have one yet. Safe to run multiple times (ON CONFLICT DO
-- NOTHING); safe to leave in the file, it's a no-op once everyone's
-- backfilled.
-- =========================================================================
insert into public.profiles ("usernameLower", "username", "ownerId", "createdAt")
select
  lower(trim(coalesce(u.raw_user_meta_data ->> 'username', split_part(u.email, '@', 1)))),
  coalesce(u.raw_user_meta_data ->> 'username', split_part(u.email, '@', 1)),
  u.id,
  extract(epoch from u.created_at) * 1000
from auth.users u
where not exists (select 1 from public.profiles p where p."ownerId" = u.id)
on conflict ("usernameLower") do nothing;



-- =========================================================================
-- Wallet RPCs -- replace the old runTransaction()-based coinsService.ts
-- logic. SECURITY DEFINER + execute revoked from anon/authenticated: these
-- are only ever called from server.ts via the service-role client, exactly
-- the same trust boundary the Admin-SDK-only Firestore transactions had.
-- Row locks (FOR UPDATE) give the same atomicity Firestore's transaction
-- retries gave, without the retry-on-conflict loop.
-- =========================================================================

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


create or replace function credit_wallet(
  p_username text,
  p_amount numeric,
  p_reason text,
  p_ref_id text default null
)
returns numeric
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
    raise exception 'credit_wallet: amount must be positive';
  end if;

  insert into coin_wallets ("username", "balance", "createdAt")
    values (p_username, 0, v_now)
    on conflict ("username") do nothing;

  select "balance" into v_current from coin_wallets where "username" = p_username for update;

  v_next := v_current + p_amount;
  update coin_wallets set "balance" = v_next where "username" = p_username;

  insert into coin_transactions ("username", "type", "amount", "direction", "balanceAfter", "reason", "refId", "timestamp")
    values (p_username, p_reason, p_amount, 'credit', v_next, p_reason, p_ref_id, v_now);

  return v_next;
end;
$$;

revoke all on function credit_wallet(text, numeric, text, text) from public;
grant execute on function credit_wallet(text, numeric, text, text) to service_role;


-- Debits the same amount from several wallets atomically: either everyone
-- has enough and all are charged, or nobody is. Usernames are locked in
-- sorted order so two concurrent calls touching overlapping wallets can't
-- deadlock (Firestore's transaction auto-retry sidestepped this; explicit
-- row locks need the same ordering discipline instead).
create or replace function debit_multiple_wallets(
  p_usernames text[],
  p_amount numeric,
  p_reason text,
  p_ref_id text default null
)
returns table("ok" boolean, "insufficientUsers" text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sorted text[];
  v_uname text;
  v_balance numeric;
  v_insufficient text[] := '{}';
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if p_amount <= 0 then
    raise exception 'debit_multiple_wallets: amount must be positive';
  end if;

  select array_agg(u order by u) into v_sorted from unnest(p_usernames) u;

  foreach v_uname in array v_sorted loop
    insert into coin_wallets ("username", "balance", "createdAt")
      values (v_uname, 0, v_now)
      on conflict ("username") do nothing;
  end loop;

  -- Lock every wallet (sorted order avoids deadlocks against concurrent
  -- calls touching overlapping wallets) and collect EVERY username that's
  -- short -- same as the original, which checked every balance before
  -- deciding whether to charge anyone, not just the first shortfall found.
  foreach v_uname in array v_sorted loop
    select "balance" into v_balance from coin_wallets where "username" = v_uname for update;
    if v_balance < p_amount then
      v_insufficient := array_append(v_insufficient, v_uname);
    end if;
  end loop;

  if array_length(v_insufficient, 1) > 0 then
    return query select false, v_insufficient;
    return;
  end if;

  foreach v_uname in array v_sorted loop
    update coin_wallets set "balance" = "balance" - p_amount where "username" = v_uname
      returning "balance" into v_balance;
    insert into coin_transactions ("username", "type", "amount", "direction", "balanceAfter", "reason", "refId", "timestamp")
      values (v_uname, p_reason, p_amount, 'debit', v_balance, p_reason, p_ref_id, v_now);
  end loop;

  return query select true, null::text[];
end;
$$;

revoke all on function debit_multiple_wallets(text[], numeric, text, text) from public;
grant execute on function debit_multiple_wallets(text[], numeric, text, text) to service_role;


-- Tournament entry: atomically checks the tournament is open + has room +
-- the player isn't already in it + the player's wallet can cover the fee,
-- then debits the wallet and appends the player to the tournament roster +
-- log, all in one transaction (was a single Firestore runTransaction
-- reading both docs and writing both). Error-reason strings match what
-- server.ts's /api/coins/tournament-entry already branches on.
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


-- =========================================================================
-- Realtime -- tables the frontend subscribes to via supabase-js's
-- `.channel(...).on('postgres_changes', ...)` (see FriendsPage.tsx and
-- GlobalChatLounge.tsx) must be added to the supabase_realtime publication,
-- or change events simply never fire -- this replaces Firestore's
-- onSnapshot, which needed no equivalent opt-in. tournaments and profiles
-- are read with plain one-shot queries in this app (no onSnapshot
-- equivalent was used for them), so they're deliberately left out here.
-- =========================================================================
alter publication supabase_realtime add table friends;
alter publication supabase_realtime add table private_messages;
alter publication supabase_realtime add table global_chat;
alter publication supabase_realtime add table completed_games;
