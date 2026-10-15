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
-- SECURITY: the final hardening block replaces legacy policies and RPC
-- grants below. Identity comes from Auth UUIDs, financial mutations use
-- service-only transactions, and username email lookup is server-only.

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


-- =========================================================================
-- admins  (was: admins/{username}) -- no client access at all, same as before
-- =========================================================================
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
-- The admins table is created before this SQL-language function so a fresh
-- installation can validate its table references immediately.
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
-- SECURITY DEFINER lets it read auth.users (never exposed to anon/
-- authenticated directly) despite being called pre-login. It intentionally
-- stays callable by anon: sign-in is exactly the moment there's no session
-- yet to gate on, and this preserves the same "email enumerable by
-- username" trade-off the old public usernameToEmail read had -- not a
-- new weakness introduced by this migration.
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

revoke all on function resolve_username_to_email(text) from public;
grant execute on function resolve_username_to_email(text) to anon, authenticated;

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


-- Puzzle storage (also supplied by the historical puzzles migration).
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
create policy "puzzles_select_authenticated" on puzzles
  for select to authenticated using (true);

-- BEGIN 20261014 SECURITY HARDENING (keep identical to the migration)
-- Data-preserving security repair. Run in one transaction after reviewing a backup.
-- No balances, requests, games, messages, profiles or tournaments are deleted.
begin;

-- Replace all legacy permissive policies on the repaired trust boundaries.
do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in
      ('profiles', 'friends', 'private_messages', 'tournaments', 'purchase_requests', 'completed_games', 'global_chat', 'reports')
  loop execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename); end loop;
end $$;

create policy profiles_read on public.profiles for select using (true);
create policy profiles_update_avatar on public.profiles for update to authenticated
  using ("ownerId" = auth.uid()) with check ("ownerId" = auth.uid());
-- Signup is performed by the auth trigger. Clients cannot choose initial ratings,
-- moderation state, ownership, or paid unlocks via INSERT/upsert.
create or replace function public.guard_profile_client_update()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') and
    (to_jsonb(new) - 'avatarUrl') is distinct from (to_jsonb(old) - 'avatarUrl') then
    raise exception 'Profile identity, statistics, moderation and unlocks are server managed' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists profile_client_update_guard on public.profiles;
create trigger profile_client_update_guard before update on public.profiles
for each row execute function public.guard_profile_client_update();

-- A username is display/lookup data, never an admin grant. Bind permissions to
-- the actual Auth UUID. No username-based backfill of admin privileges occurs.
create or replace function public.is_tournament_admin(p_uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.admins a where a.uid = p_uid
    and 'manage_tournaments' = any(a.permissions));
$$;
revoke all on function public.is_tournament_admin(uuid) from public, anon;
grant execute on function public.is_tournament_admin(uuid) to authenticated, service_role;
create policy tournaments_read on public.tournaments for select using (true);
-- Roster, rounds, results and money share one JSON document. A client UPDATE
-- policy cannot safely distinguish them, so writes use validated server routes.
-- Supabase service_role bypasses RLS; ordinary admins use the server routes too.

alter table public.friends add column if not exists "user1OwnerId" uuid;
alter table public.friends add column if not exists "user2OwnerId" uuid;
update public.friends f set "user1OwnerId" = p."ownerId" from public.profiles p
where p."usernameLower" = lower(trim(f.user1)) and f."user1OwnerId" is null;
update public.friends f set "user2OwnerId" = p."ownerId" from public.profiles p
where p."usernameLower" = lower(trim(f.user2)) and f."user2OwnerId" is null;
create or replace function public.guard_friend_identity()
returns trigger language plpgsql set search_path = public as $$
declare v_first uuid; v_second uuid; v_sender uuid;
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then return new; end if;
  if tg_op = 'INSERT' then
    select p."ownerId" into v_first from public.profiles p where p."usernameLower" = lower(trim(new.user1));
    select p."ownerId" into v_second from public.profiles p where p."usernameLower" = lower(trim(new.user2));
    select p."ownerId" into v_sender from public.profiles p where p."usernameLower" = lower(trim(new.sender));
    if v_first is null or v_second is null or v_first = v_second
      or auth.uid() is distinct from v_sender
      or v_sender not in (v_first, v_second)
      or new.status <> 'pending'
      or (new."user1OwnerId" is not null and new."user1OwnerId" <> v_first)
      or (new."user2OwnerId" is not null and new."user2OwnerId" <> v_second) then
      raise exception 'Invalid friend request identity' using errcode = '42501';
    end if;
    new."user1OwnerId" := v_first; new."user2OwnerId" := v_second;
  elsif (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status')
    or old.status <> 'pending' or new.status <> 'accepted'
    or exists (select 1 from public.profiles p where p."ownerId" = auth.uid()
      and p."usernameLower" = lower(trim(old.sender))) then
    raise exception 'Only the recipient may accept an unchanged friend request' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists friend_identity_guard on public.friends;
create trigger friend_identity_guard before insert or update on public.friends
for each row execute function public.guard_friend_identity();
create policy friends_read_participant on public.friends for select to authenticated
using (auth.uid() in ("user1OwnerId", "user2OwnerId")
  and exists (select 1 from public.profiles p where p."usernameLower" = lower(trim(friends.user1)) and p."ownerId" = friends."user1OwnerId")
  and exists (select 1 from public.profiles p where p."usernameLower" = lower(trim(friends.user2)) and p."ownerId" = friends."user2OwnerId"));
create policy friends_insert_sender on public.friends for insert to authenticated
with check (auth.uid() in ("user1OwnerId", "user2OwnerId")
  and exists (select 1 from public.profiles p where p."usernameLower" = lower(trim(friends.user1)) and p."ownerId" = friends."user1OwnerId")
  and exists (select 1 from public.profiles p where p."usernameLower" = lower(trim(friends.user2)) and p."ownerId" = friends."user2OwnerId"));
create policy friends_update_participant on public.friends for update to authenticated
using (auth.uid() in ("user1OwnerId", "user2OwnerId")
  and exists (select 1 from public.profiles p where p."usernameLower" = lower(trim(friends.user1)) and p."ownerId" = friends."user1OwnerId")
  and exists (select 1 from public.profiles p where p."usernameLower" = lower(trim(friends.user2)) and p."ownerId" = friends."user2OwnerId"))
with check (auth.uid() in ("user1OwnerId", "user2OwnerId")
  and exists (select 1 from public.profiles p where p."usernameLower" = lower(trim(friends.user1)) and p."ownerId" = friends."user1OwnerId")
  and exists (select 1 from public.profiles p where p."usernameLower" = lower(trim(friends.user2)) and p."ownerId" = friends."user2OwnerId"));
create policy friends_delete_participant on public.friends for delete to authenticated
using (auth.uid() in ("user1OwnerId", "user2OwnerId")
  and exists (select 1 from public.profiles p where p."usernameLower" = lower(trim(friends.user1)) and p."ownerId" = friends."user1OwnerId")
  and exists (select 1 from public.profiles p where p."usernameLower" = lower(trim(friends.user2)) and p."ownerId" = friends."user2OwnerId"));

-- Repair missing DM identity bindings only where profile data establishes them.
-- Existing conflicting/nonexistent identities are preserved but cannot be forged
-- into new participant bindings through a client UPDATE.
update public.private_messages m set "senderOwnerId" = p."ownerId" from public.profiles p
where p."usernameLower" = lower(trim(m.sender)) and m."senderOwnerId" is null;
update public.private_messages m set "recipientOwnerId" = p."ownerId" from public.profiles p
where p."usernameLower" = lower(trim(m.recipient)) and m."recipientOwnerId" is null;
create or replace function public.guard_private_message_identity()
returns trigger language plpgsql set search_path = public as $$
declare v_sender uuid; v_recipient uuid; v_chat text;
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then return new; end if;
  if tg_op = 'INSERT' then
    select p."ownerId" into v_sender from public.profiles p where p."usernameLower" = lower(trim(new.sender));
    select p."ownerId" into v_recipient from public.profiles p where p."usernameLower" = lower(trim(new.recipient));
    select string_agg(u, '_' order by u) into v_chat from unnest(array[lower(trim(new.sender)), lower(trim(new.recipient))]) u;
    if v_sender is null or v_recipient is null or v_sender = v_recipient
      or auth.uid() is distinct from v_sender or new."chatId" <> v_chat
      or (new."senderOwnerId" is not null and new."senderOwnerId" <> v_sender)
      or (new."recipientOwnerId" is not null and new."recipientOwnerId" <> v_recipient) then
      raise exception 'Invalid private message identity' using errcode = '42501';
    end if;
    new."senderOwnerId" := v_sender; new."recipientOwnerId" := v_recipient;
  elsif (to_jsonb(new) - 'reactions') is distinct from (to_jsonb(old) - 'reactions') then
    raise exception 'Message identity and content are immutable' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists private_message_identity_guard on public.private_messages;
create trigger private_message_identity_guard before insert or update on public.private_messages
for each row execute function public.guard_private_message_identity();
create policy messages_read_participant on public.private_messages for select to authenticated
using (auth.uid() in ("senderOwnerId", "recipientOwnerId")
  and exists (select 1 from public.profiles p where p."usernameLower" = lower(trim(private_messages.sender)) and p."ownerId" = private_messages."senderOwnerId")
  and exists (select 1 from public.profiles p where p."usernameLower" = lower(trim(private_messages.recipient)) and p."ownerId" = private_messages."recipientOwnerId"));
create policy messages_insert_sender on public.private_messages for insert to authenticated
with check (auth.uid() = "senderOwnerId");
create policy messages_update_reactions on public.private_messages for update to authenticated
using (auth.uid() in ("senderOwnerId", "recipientOwnerId")
  and exists (select 1 from public.profiles p where p."usernameLower" = lower(trim(private_messages.sender)) and p."ownerId" = private_messages."senderOwnerId")
  and exists (select 1 from public.profiles p where p."usernameLower" = lower(trim(private_messages.recipient)) and p."ownerId" = private_messages."recipientOwnerId"))
with check (auth.uid() in ("senderOwnerId", "recipientOwnerId")
  and exists (select 1 from public.profiles p where p."usernameLower" = lower(trim(private_messages.sender)) and p."ownerId" = private_messages."senderOwnerId")
  and exists (select 1 from public.profiles p where p."usernameLower" = lower(trim(private_messages.recipient)) and p."ownerId" = private_messages."recipientOwnerId"));

create policy purchases_read_own on public.purchase_requests for select to authenticated
using (auth.uid() = "ownerId");
create policy purchases_submit_pending on public.purchase_requests for insert to authenticated
with check (auth.uid() = "ownerId" and status = 'pending'
  and "resolvedBy" is null and "resolvedAt" is null and "coinsCredited" is null
  and exists (select 1 from public.profiles p where p."ownerId" = auth.uid()
    and p."usernameLower" = lower(trim(purchase_requests.username))));

-- Completed results become authoritative only through validated server logic.
create policy completed_games_read on public.completed_games for select using (true);

create policy global_chat_read on public.global_chat for select to authenticated using (true);
create policy global_chat_send_own on public.global_chat for insert to authenticated
with check (length(trim(text)) > 0 and length(text) <= 2000
  and exists (select 1 from public.profiles p where p."ownerId" = auth.uid()
    and p."usernameLower" = lower(trim(global_chat.sender))));

create policy reports_read_own on public.reports for select to authenticated using (auth.uid() = "reporterId");
create policy reports_submit_open on public.reports for insert to authenticated
with check (auth.uid() = "reporterId" and status = 'open');

-- The server offers a rate-limited sign-in endpoint. Direct public email
-- enumeration is no longer part of the client API.
revoke all on function public.resolve_username_to_email(text) from public, anon, authenticated;
grant execute on function public.resolve_username_to_email(text) to service_role;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text := trim(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)));
begin
  if v_name is null or v_name = '' or lower(v_name) = 'kentro_house' then
    raise exception 'Invalid or reserved username';
  end if;
  -- A collision aborts signup atomically, rather than silently creating an
  -- account with no profile or claiming somebody else's identity.
  insert into public.profiles ("usernameLower", username, "ownerId", "createdAt")
  values (lower(v_name), v_name, new.id, (extract(epoch from now()) * 1000)::bigint);
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- Bind legacy unowned wallets only when the profile already establishes an
-- unambiguous owner. Do not replace conflicting existing owner ids.
update public.coin_wallets w set "ownerId" = p."ownerId" from public.profiles p
where p."usernameLower" = w.username and w."ownerId" is null
  and p."ownerId" is not null and w.username <> 'kentro_house';

-- Internal helpers are definer functions with no client EXECUTE grant.
create or replace function public.security_lock_wallet(p_owner_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_name text; v_count integer; v_owner uuid;
begin
  select count(*), min(p."usernameLower") into v_count, v_name
    from public.profiles p where p."ownerId" = p_owner_id;
  if p_owner_id is null or v_count <> 1 or v_name = 'kentro_house' then
    raise exception 'Missing or ambiguous profile owner';
  end if;
  insert into public.coin_wallets (username, balance, "ownerId", "createdAt")
  values (v_name, 0, p_owner_id, (extract(epoch from now()) * 1000)::bigint)
  on conflict (username) do nothing;
  select w."ownerId" into v_owner from public.coin_wallets w where w.username = v_name for update;
  if v_owner is null then
    update public.coin_wallets w set "ownerId" = p_owner_id where w.username = v_name;
  elsif v_owner <> p_owner_id then raise exception 'Wallet ownership conflict'; end if;
  return v_name;
end $$;
revoke all on function public.security_lock_wallet(uuid) from public, anon, authenticated;

create or replace function public.unlock_ai_level(p_owner_id uuid, p_level integer, p_cost numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_profile public.profiles%rowtype; v_name text; v_balance numeric; v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if p_level is null or p_level < 2 or p_level > 8 or p_cost is null
    or p_cost < 0 or p_cost <> trunc(p_cost) or p_cost::text in ('NaN', 'Infinity', '-Infinity') then raise exception 'Invalid unlock'; end if;
  select * into v_profile from public.profiles p where p."ownerId" = p_owner_id for update;
  if not found then return jsonb_build_object('ok', false, 'errorReason', 'profile_not_found'); end if;
  v_name := public.security_lock_wallet(p_owner_id);
  select w.balance into v_balance from public.coin_wallets w where w.username = v_name;
  if v_profile."maxUnlockedKenLevel" >= p_level then
    return jsonb_build_object('ok', true, 'alreadyUnlocked', true, 'balance', v_balance, 'maxUnlockedKenLevel', v_profile."maxUnlockedKenLevel");
  end if;
  if v_balance < p_cost then return jsonb_build_object('ok', false, 'errorReason', 'insufficient_funds', 'balance', v_balance); end if;
  if p_cost > 0 then
    v_balance := v_balance - p_cost;
    update public.coin_wallets w set balance = v_balance where w.username = v_name;
    insert into public.coin_transactions (username, type, amount, direction, "balanceAfter", reason, "refId", timestamp)
    values (v_name, 'ai_unlock', p_cost, 'debit', v_balance, 'AI level unlock', p_level::text, v_now);
  end if;
  update public.profiles p set "maxUnlockedKenLevel" = p_level where p."usernameLower" = v_name;
  return jsonb_build_object('ok', true, 'balance', v_balance, 'maxUnlockedKenLevel', p_level);
end $$;
revoke all on function public.unlock_ai_level(uuid, integer, numeric) from public, anon, authenticated;
grant execute on function public.unlock_ai_level(uuid, integer, numeric) to service_role;

create or replace function public.submit_withdrawal(
  p_owner_id uuid, p_request_id uuid, p_coins numeric, p_naira_amount numeric,
  p_account_name text, p_account_number text, p_bank_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text; v_balance numeric; v_req public.withdrawal_requests%rowtype;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if p_request_id is null or p_coins is null or p_coins <= 0 or p_coins <> trunc(p_coins)
    or p_naira_amount is null or p_naira_amount < 0
    or p_coins::text in ('NaN', 'Infinity', '-Infinity') or p_naira_amount::text in ('NaN', 'Infinity', '-Infinity')
    or coalesce(trim(p_account_name), '') = '' or coalesce(trim(p_account_number), '') = '' then
    raise exception 'Invalid withdrawal request';
  end if;
  -- Existing request and its wallet use the same lock order as resolution.
  select * into v_req from public.withdrawal_requests r where r.id = p_request_id for update;
  if found and v_req."ownerId" is distinct from p_owner_id then
    raise exception 'Withdrawal idempotency key already used';
  end if;
  v_name := public.security_lock_wallet(p_owner_id);
  select w.balance into v_balance from public.coin_wallets w where w.username = v_name;
  -- A simultaneous first submission may have committed while this call waited
  -- for the wallet. Recheck after obtaining that lock before any debit.
  if v_req.id is null then
    select * into v_req from public.withdrawal_requests r where r.id = p_request_id for update;
  end if;
  if v_req.id is not null then
    if v_req."ownerId" is distinct from p_owner_id or v_req.coins <> p_coins
      or v_req."nairaAmount" <> p_naira_amount or v_req."accountName" <> p_account_name
      or v_req."accountNumber" <> p_account_number or v_req."bankName" is distinct from p_bank_name then
      raise exception 'Withdrawal idempotency key already used';
    end if;
    return jsonb_build_object('ok', true, 'alreadySubmitted', true, 'requestId', v_req.id,
      'balance', v_balance, 'coins', v_req.coins, 'nairaAmount', v_req."nairaAmount", 'status', v_req.status);
  end if;
  if v_balance < p_coins then return jsonb_build_object('ok', false, 'errorReason', 'insufficient_funds', 'balance', v_balance); end if;
  v_balance := v_balance - p_coins;
  update public.coin_wallets w set balance = v_balance where w.username = v_name;
  insert into public.withdrawal_requests (id, username, "ownerId", coins, "nairaAmount", "accountName", "accountNumber", "bankName", status, "submittedAt")
  values (p_request_id, v_name, p_owner_id, p_coins, p_naira_amount, p_account_name, p_account_number, p_bank_name, 'pending', v_now);
  insert into public.coin_transactions (username, type, amount, direction, "balanceAfter", reason, "refId", timestamp)
  values (v_name, 'withdrawal', p_coins, 'debit', v_balance, 'Withdrawal escrow', p_request_id::text, v_now);
  return jsonb_build_object('ok', true, 'requestId', p_request_id, 'balance', v_balance, 'coins', p_coins, 'nairaAmount', p_naira_amount, 'status', 'pending');
end $$;
revoke all on function public.submit_withdrawal(uuid, uuid, numeric, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_withdrawal(uuid, uuid, numeric, numeric, text, text, text) to service_role;

create or replace function public.resolve_purchase(
  p_request_id uuid, p_approve boolean, p_coins numeric, p_package_id text, p_admin_uid uuid, p_ip text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_req public.purchase_requests%rowtype; v_admin text; v_name text; v_balance numeric;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  select a.username into v_admin from public.admins a where a.uid = p_admin_uid and 'manage_payments' = any(a.permissions) limit 1;
  if v_admin is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_approve is null then raise exception 'Approval decision required'; end if;
  select * into v_req from public.purchase_requests r where r.id = p_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'errorReason', 'not_found'); end if;
  if v_req.status <> 'pending' then return jsonb_build_object('ok', false, 'errorReason', 'already_resolved', 'status', v_req.status); end if;
  if p_approve then
    if p_coins is null or p_coins <= 0 or p_coins <> trunc(p_coins) or p_coins::text in ('NaN', 'Infinity', '-Infinity')
      or p_package_id is null or v_req."packageId" is distinct from p_package_id then raise exception 'Invalid purchase package'; end if;
    v_name := public.security_lock_wallet(v_req."ownerId");
    select w.balance + p_coins into v_balance from public.coin_wallets w where w.username = v_name;
    update public.coin_wallets w set balance = v_balance where w.username = v_name;
    insert into public.coin_transactions (username, type, amount, direction, "balanceAfter", reason, "refId", timestamp)
    values (v_name, 'purchase_credit', p_coins, 'credit', v_balance, 'Approved coin purchase', p_request_id::text, v_now);
  end if;
  update public.purchase_requests r set status = case when p_approve then 'approved' else 'rejected' end,
    "resolvedBy" = v_admin, "resolvedAt" = v_now, "coinsCredited" = case when p_approve then p_coins else null end where r.id = p_request_id;
  insert into public.audit_logs ("adminUsername", "adminUid", action, target, details, result, ip, timestamp)
  values (v_admin, p_admin_uid, case when p_approve then 'approve_purchase' else 'reject_purchase' end,
    p_request_id::text, jsonb_build_object('ownerId', v_req."ownerId", 'coins', case when p_approve then p_coins else 0 end), 'success', p_ip, v_now);
  return jsonb_build_object('ok', true, 'balance', v_balance, 'status', case when p_approve then 'approved' else 'rejected' end);
end $$;
revoke all on function public.resolve_purchase(uuid, boolean, numeric, text, uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_purchase(uuid, boolean, numeric, text, uuid, text) to service_role;

create or replace function public.resolve_withdrawal(
  p_request_id uuid, p_approve boolean, p_admin_uid uuid, p_ip text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_req public.withdrawal_requests%rowtype; v_admin text; v_name text; v_balance numeric;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  select a.username into v_admin from public.admins a where a.uid = p_admin_uid and 'manage_payments' = any(a.permissions) limit 1;
  if v_admin is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_approve is null then raise exception 'Approval decision required'; end if;
  select * into v_req from public.withdrawal_requests r where r.id = p_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'errorReason', 'not_found'); end if;
  if v_req.status <> 'pending' then return jsonb_build_object('ok', false, 'errorReason', 'already_resolved', 'status', v_req.status); end if;
  -- Legacy pending requests without an escrow ledger entry require manual
  -- reconciliation. Refunding them automatically could manufacture coins.
  if not exists (select 1 from public.coin_transactions t where t."refId" = p_request_id::text
      and t.username = v_req.username and t.type = 'withdrawal' and t.direction = 'debit' and t.amount = v_req.coins) then
    return jsonb_build_object('ok', false, 'errorReason', 'escrow_not_verified');
  end if;
  if not p_approve then
    v_name := public.security_lock_wallet(v_req."ownerId");
    if v_name <> v_req.username then raise exception 'Withdrawal owner mismatch'; end if;
    select w.balance + v_req.coins into v_balance from public.coin_wallets w where w.username = v_name;
    update public.coin_wallets w set balance = v_balance where w.username = v_name;
    insert into public.coin_transactions (username, type, amount, direction, "balanceAfter", reason, "refId", timestamp)
    values (v_name, 'refund', v_req.coins, 'credit', v_balance, 'Rejected withdrawal refund', p_request_id::text, v_now);
  end if;
  update public.withdrawal_requests r set status = case when p_approve then 'paid' else 'rejected' end,
    "resolvedBy" = v_admin, "resolvedAt" = v_now where r.id = p_request_id;
  insert into public.audit_logs ("adminUsername", "adminUid", action, target, details, result, ip, timestamp)
  values (v_admin, p_admin_uid, case when p_approve then 'approve_withdrawal' else 'reject_withdrawal' end,
    p_request_id::text, jsonb_build_object('ownerId', v_req."ownerId", 'coins', v_req.coins), 'success', p_ip, v_now);
  return jsonb_build_object('ok', true, 'balance', v_balance, 'status', case when p_approve then 'paid' else 'rejected' end);
end $$;
revoke all on function public.resolve_withdrawal(uuid, boolean, uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_withdrawal(uuid, boolean, uuid, text) to service_role;

-- Existing tournament entry behavior, with qualified output-column references.
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
  if p_entry_fee is null or p_entry_fee < 0 or p_entry_fee <> trunc(p_entry_fee) or p_entry_fee::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Invalid tournament entry fee';
  end if;
  select t.* into v_tournament from tournaments t where t."id" = p_tournament_id for update;
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

    select w."balance" into v_balance from coin_wallets w where w."username" = lower(p_username) for update;
    if v_balance < p_entry_fee then
      return query select false, 'insufficient_funds', v_balance, null::jsonb;
      return;
    end if;

    v_balance := v_balance - p_entry_fee;
    update coin_wallets w set "balance" = v_balance where w."username" = lower(p_username);

    insert into coin_transactions ("username", "type", "amount", "direction", "balanceAfter", "reason", "refId", "timestamp")
      values (lower(p_username), 'tournament_entry', p_entry_fee, 'debit', v_balance, 'Tournament entry fee', p_tournament_id, v_now);
  else
    select w."balance" into v_balance from coin_wallets w where w."username" = lower(p_username);
    v_balance := coalesce(v_balance, 0);
  end if;

  update tournaments t
    set "players" = v_tournament."players" || p_player,
        "logs" = v_tournament."logs" || to_jsonb(p_log_line),
        "prizePool" = v_tournament."prizePool" + p_entry_fee
    where t."id" = p_tournament_id
    returning t."players" into v_tournament."players";

  return query select true, null::text, v_balance, v_tournament."players";
end;
$$;

revoke all on function tournament_entry(text, text, numeric, jsonb, text) from public, anon, authenticated;
grant execute on function tournament_entry(text, text, numeric, jsonb, text) to service_role;


-- RPCs run as their owner; direct callers must never change financial fields.
create or replace function public.tournaments_money_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') and
    (new."prizePool" is distinct from old."prizePool" or new."prizePaid" is distinct from old."prizePaid") then
    raise exception 'Tournament finances are server managed' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists tournaments_money_guard_trg on public.tournaments;
create trigger tournaments_money_guard_trg before update on public.tournaments
for each row execute function public.tournaments_money_guard();

revoke all on function public.debit_wallet(text, numeric, text, text) from public, anon, authenticated;
revoke all on function public.credit_wallet(text, numeric, text, text) from public, anon, authenticated;
revoke all on function public.debit_multiple_wallets(text[], numeric, text, text) from public, anon, authenticated;
revoke all on function public.pay_tournament_prize(text, text, numeric) from public, anon, authenticated;

-- NOT VALID preserves historical invalid rows for reconciliation while all new
-- writes must satisfy the money invariant, including older low-level RPCs.
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.coin_wallets'::regclass and conname = 'wallet_balance_finite_nonnegative') then
    alter table public.coin_wallets add constraint wallet_balance_finite_nonnegative
    check (balance >= 0 and balance::text not in ('NaN', 'Infinity', '-Infinity')) not valid;
  end if;
end $$;

commit;
-- END 20261014 SECURITY HARDENING
