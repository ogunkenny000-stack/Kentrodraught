-- DISPOSABLE LOCAL REPLICA ONLY. No production data. Captured schema 2026-10-17.
do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if; end$$;
create schema auth;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
grant usage on schema public,auth to anon,authenticated,service_role;
create table public.admins(username text primary key,uid uuid,permissions text[]);
create table public."coin_transactions"("id" uuid default gen_random_uuid() not null,
"username" text not null,
"type" text,
"amount" numeric not null,
"direction" text not null,
"balanceAfter" numeric not null,
"reason" text,
"refId" text,
"timestamp" bigint);
create table public."coin_wallets"("username" text not null,
"balance" numeric default 0 not null,
"ownerId" uuid,
"createdAt" bigint);
create table public."completed_games"("gameId" text not null,
"whitePlayer" text,
"blackPlayer" text,
"winner" text,
"moveHistoryStrings" jsonb,
"moveHistory" jsonb,
"moveEvaluations" jsonb default '{}'::jsonb,
"playMode" text,
"timestamp" bigint,
"createdAt" timestamp with time zone default now() not null);
create table public."kentro_ken_victory_claims"("owner_id" uuid not null,
"game_id" uuid not null,
"beaten_level" integer not null,
"claimed_at" timestamp with time zone default now() not null);
create table public."profiles"("usernameLower" text not null,
"username" text not null,
"ownerId" uuid,
"elo" numeric default 1500 not null,
"rd" numeric,
"vol" numeric,
"wins" integer default 0 not null,
"losses" integer default 0 not null,
"draws" integer default 0 not null,
"gamesCount" integer default 0 not null,
"totalPlayTime" numeric default 0 not null,
"averageDuration" numeric default 0 not null,
"maxUnlockedKenLevel" integer default 1 not null,
"banned" boolean default false not null,
"bannedAt" bigint,
"bannedBy" text,
"suspendedUntil" bigint,
"suspendedBy" text,
"createdAt" bigint,
"avatarUrl" text,
"bio" text,
"statusQuote" text);
create table public."purchase_requests"("id" uuid default gen_random_uuid() not null,
"username" text not null,
"item" text,
"packageId" text,
"coins" numeric,
"amountNaira" numeric,
"receiptRef" text,
"status" text default 'pending'::text not null,
"submittedAt" bigint,
"ownerId" uuid,
"resolvedBy" text,
"resolvedAt" bigint,
"coinsCredited" numeric);
create table public."tournaments"("id" text not null,
"name" text,
"description" text,
"type" text,
"visibility" text,
"inviteCode" text,
"maxPlayers" integer,
"minPlayers" integer,
"registrationDeadline" text,
"startTime" text,
"timeControl" text,
"handicap" text,
"tieBreak" text,
"prize" text,
"spectatorPermission" boolean default true,
"status" text,
"currentRound" integer default 0,
"maxRounds" integer,
"players" jsonb default '[]'::jsonb not null,
"matches" jsonb default '[]'::jsonb not null,
"chat" jsonb default '[]'::jsonb not null,
"logs" jsonb default '[]'::jsonb not null,
"createdAt" timestamp with time zone default now() not null,
"prizePool" numeric default 0 not null,
"prizePaid" boolean default false not null);
create table public."withdrawal_requests"("id" uuid default gen_random_uuid() not null,
"username" text not null,
"ownerId" uuid,
"coins" numeric not null,
"nairaAmount" numeric not null,
"accountName" text not null,
"accountNumber" text not null,
"bankName" text,
"status" text default 'pending'::text not null,
"submittedAt" bigint,
"resolvedBy" text,
"resolvedAt" bigint);
alter table public."coin_transactions" add constraint "coin_transactions_pkey" PRIMARY KEY (id);
alter table public."coin_wallets" add constraint "coin_wallets_pkey" PRIMARY KEY (username);
alter table public."completed_games" add constraint "completed_games_pkey" PRIMARY KEY ("gameId");
alter table public."kentro_ken_victory_claims" add constraint "kentro_ken_victory_claims_beaten_level_check" CHECK (((beaten_level >= 1) AND (beaten_level <= 7)));
alter table public."kentro_ken_victory_claims" add constraint "kentro_ken_victory_claims_pkey" PRIMARY KEY (owner_id, game_id);
alter table public."profiles" add constraint "profiles_bio_length" CHECK (((bio IS NULL) OR (char_length(bio) <= 500)));
alter table public."profiles" add constraint "profiles_pkey" PRIMARY KEY ("usernameLower");
alter table public."profiles" add constraint "profiles_status_quote_length" CHECK ((("statusQuote" IS NULL) OR (char_length("statusQuote") <= 120)));
alter table public."purchase_requests" add constraint "purchase_requests_pkey" PRIMARY KEY (id);
alter table public."tournaments" add constraint "tournaments_pkey" PRIMARY KEY (id);
alter table public."withdrawal_requests" add constraint "withdrawal_requests_pkey" PRIMARY KEY (id);
alter table public."coin_transactions" add constraint "coin_transactions_username_fkey" FOREIGN KEY (username) REFERENCES coin_wallets(username) ON DELETE CASCADE;
alter table public."kentro_ken_victory_claims" add constraint "kentro_ken_victory_claims_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public."profiles" add constraint "profiles_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE OR REPLACE FUNCTION public.credit_wallet(p_username text, p_amount numeric, p_reason text, p_ref_id text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

revoke all on function public."credit_wallet"(p_username text, p_amount numeric, p_reason text, p_ref_id text) from public,anon,authenticated;
grant execute on function public."credit_wallet"(p_username text, p_amount numeric, p_reason text, p_ref_id text) to service_role;
CREATE OR REPLACE FUNCTION public.debit_multiple_wallets(p_usernames text[], p_amount numeric, p_reason text, p_ref_id text DEFAULT NULL::text)
 RETURNS TABLE(ok boolean, "insufficientUsers" text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

revoke all on function public."debit_multiple_wallets"(p_usernames text[], p_amount numeric, p_reason text, p_ref_id text) from public,anon,authenticated;
grant execute on function public."debit_multiple_wallets"(p_usernames text[], p_amount numeric, p_reason text, p_ref_id text) to service_role;
CREATE OR REPLACE FUNCTION public.debit_wallet(p_username text, p_amount numeric, p_reason text, p_ref_id text DEFAULT NULL::text)
 RETURNS TABLE(ok boolean, balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

revoke all on function public."debit_wallet"(p_username text, p_amount numeric, p_reason text, p_ref_id text) from public,anon,authenticated;
grant execute on function public."debit_wallet"(p_username text, p_amount numeric, p_reason text, p_ref_id text) to service_role;
CREATE OR REPLACE FUNCTION public.is_tournament_admin(p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from admins
    where "uid" = p_uid and 'manage_tournaments' = any("permissions")
  );
$function$;

CREATE OR REPLACE FUNCTION public.kentro_claim_ken_victory(p_owner uuid, p_game_id uuid, p_level integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_profile public.profiles%rowtype; v_inserted uuid; v_previous integer;
begin
  if p_owner is null or p_game_id is null or p_level is null or p_level not between 1 and 7
  then raise exception 'Invalid Ken victory claim'; end if;
  select * into v_profile from public.profiles where "ownerId" = p_owner for update;
  if not found then return jsonb_build_object('ok',false,'error','profile_not_found'); end if;
  if v_profile.banned or (v_profile."suspendedUntil" is not null and v_profile."suspendedUntil" > (extract(epoch from now())*1000)::bigint)
  then return jsonb_build_object('ok',false,'error','account_unavailable'); end if;
  select beaten_level into v_previous from public.kentro_ken_victory_claims
    where owner_id=p_owner and game_id=p_game_id;
  if found then
    if v_previous <> p_level then return jsonb_build_object('ok',false,'error','game_already_claimed_for_another_level'); end if;
    return jsonb_build_object('ok',true,'alreadyClaimed',true,'maxUnlockedKenLevel',greatest(3,v_profile."maxUnlockedKenLevel"));
  end if;
  if p_level > greatest(3,v_profile."maxUnlockedKenLevel")
  then return jsonb_build_object('ok',false,'error','win_current_level_before_advancing'); end if;
  insert into public.kentro_ken_victory_claims(owner_id,game_id,beaten_level)
    values(p_owner,p_game_id,p_level) on conflict do nothing
    returning game_id into v_inserted;
  if v_inserted is null then
    return jsonb_build_object('ok',true,'alreadyClaimed',true,'maxUnlockedKenLevel',greatest(3,v_profile."maxUnlockedKenLevel"));
  end if;
  update public.profiles
    set "maxUnlockedKenLevel" = greatest(3,"maxUnlockedKenLevel",p_level+1)
    where "ownerId"=p_owner;
  return jsonb_build_object('ok',true,'alreadyClaimed',false,'maxUnlockedKenLevel',greatest(3,v_profile."maxUnlockedKenLevel",p_level+1));
end $function$;

revoke all on function public."kentro_claim_ken_victory"(p_owner uuid, p_game_id uuid, p_level integer) from public,anon,authenticated;
grant execute on function public."kentro_claim_ken_victory"(p_owner uuid, p_game_id uuid, p_level integer) to service_role;
CREATE OR REPLACE FUNCTION public.kentro_lock_ken_entitlement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op='UPDATE' and current_user in ('anon','authenticated')
    and new."maxUnlockedKenLevel" is distinct from old."maxUnlockedKenLevel"
  then raise exception 'Ken level access is server-managed' using errcode='42501'; end if;
  if tg_op='INSERT' and current_user in ('anon','authenticated')
    and new."maxUnlockedKenLevel" > 3
  then raise exception 'Ken level access is server-managed' using errcode='42501'; end if;
  return new;
end $function$;

revoke all on function public."kentro_lock_ken_entitlement"() from public,anon,authenticated;
grant execute on function public."kentro_lock_ken_entitlement"() to service_role;
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.pay_tournament_prize(p_tournament_id text, p_winner_username text, p_rake_percent numeric)
 RETURNS TABLE(ok boolean, "errorReason" text, payout numeric, rake numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

revoke all on function public."pay_tournament_prize"(p_tournament_id text, p_winner_username text, p_rake_percent numeric) from public,anon,authenticated;
grant execute on function public."pay_tournament_prize"(p_tournament_id text, p_winner_username text, p_rake_percent numeric) to service_role;
CREATE OR REPLACE FUNCTION public.profiles_protect_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new."banned"         := false;
      new."bannedAt"       := null;
      new."bannedBy"       := null;
      new."suspendedUntil" := null;
      new."suspendedBy"    := null;
    else
      new."banned"         := old."banned";
      new."bannedAt"       := old."bannedAt";
      new."bannedBy"       := old."bannedBy";
      new."suspendedUntil" := old."suspendedUntil";
      new."suspendedBy"    := old."suspendedBy";
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.refund_tournament_entries(p_tournament_id text)
 RETURNS TABLE(ok boolean, "errorReason" text, "refundedCount" integer, "refundedTotal" numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

revoke all on function public."refund_tournament_entries"(p_tournament_id text) from public,anon,authenticated;
grant execute on function public."refund_tournament_entries"(p_tournament_id text) to service_role;
CREATE OR REPLACE FUNCTION public.tournament_entry(p_tournament_id text, p_username text, p_entry_fee numeric, p_player jsonb, p_log_line text)
 RETURNS TABLE(ok boolean, "errorReason" text, balance numeric, players jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

revoke all on function public."tournament_entry"(p_tournament_id text, p_username text, p_entry_fee numeric, p_player jsonb, p_log_line text) from public,anon,authenticated;
grant execute on function public."tournament_entry"(p_tournament_id text, p_username text, p_entry_fee numeric, p_player jsonb, p_log_line text) to service_role;
CREATE OR REPLACE FUNCTION public.tournaments_freeze_config()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null and not public.is_tournament_admin(auth.uid()) then
    new := jsonb_populate_record(old, to_jsonb(old) || jsonb_build_object(
      'status', to_jsonb(new) -> 'status',
      'currentRound', to_jsonb(new) -> 'currentRound',
      'matches', to_jsonb(new) -> 'matches',
      'players', to_jsonb(new) -> 'players',
      'chat', to_jsonb(new) -> 'chat',
      'logs', to_jsonb(new) -> 'logs'));
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tournaments_money_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

create policy "coin_transactions_select_owner" on public."coin_transactions" as PERMISSIVE for SELECT to "authenticated" using ((EXISTS ( SELECT 1
   FROM coin_wallets w
  WHERE ((w.username = coin_transactions.username) AND (w."ownerId" = auth.uid())))));
create policy "coin_wallets_select_owner" on public."coin_wallets" as PERMISSIVE for SELECT to "authenticated" using ((auth.uid() = "ownerId"));
create policy "completed_games_select_all" on public."completed_games" as PERMISSIVE for SELECT to public using (true);
create policy "completed_games_write_authenticated" on public."completed_games" as PERMISSIVE for INSERT to "authenticated" with check (true);
create policy "profiles_insert_own" on public."profiles" as PERMISSIVE for INSERT to public with check ((auth.uid() = "ownerId"));
create policy "profiles_select_all" on public."profiles" as PERMISSIVE for SELECT to public using (true);
create policy "profiles_update_own" on public."profiles" as PERMISSIVE for UPDATE to public using ((auth.uid() = "ownerId")) with check ((auth.uid() = "ownerId"));
create policy "purchase_requests_insert_own" on public."purchase_requests" as PERMISSIVE for INSERT to "authenticated" with check ((auth.uid() = "ownerId"));
create policy "purchase_requests_select_own" on public."purchase_requests" as PERMISSIVE for SELECT to "authenticated" using ((auth.uid() = "ownerId"));
create policy "tournaments_delete_authenticated" on public."tournaments" as PERMISSIVE for DELETE to "authenticated" using (is_tournament_admin(auth.uid()));
create policy "tournaments_select_all" on public."tournaments" as PERMISSIVE for SELECT to public using (true);
create policy "tournaments_update_authenticated" on public."tournaments" as PERMISSIVE for UPDATE to "authenticated" using (true) with check (true);
create policy "tournaments_write_authenticated" on public."tournaments" as PERMISSIVE for INSERT to "authenticated" with check (is_tournament_admin(auth.uid()));
create policy "withdrawal_requests_select_own" on public."withdrawal_requests" as PERMISSIVE for SELECT to "authenticated" using ((auth.uid() = "ownerId"));
alter table public."coin_transactions" enable row level security;
grant all on table public."coin_transactions" to anon,authenticated,service_role;
alter table public."coin_wallets" enable row level security;
grant all on table public."coin_wallets" to anon,authenticated,service_role;
alter table public."completed_games" enable row level security;
grant all on table public."completed_games" to anon,authenticated,service_role;
alter table public."kentro_ken_victory_claims" enable row level security;
grant all on table public."kentro_ken_victory_claims" to anon,authenticated,service_role;
alter table public."profiles" enable row level security;
grant all on table public."profiles" to anon,authenticated,service_role;
alter table public."purchase_requests" enable row level security;
grant all on table public."purchase_requests" to anon,authenticated,service_role;
alter table public."tournaments" enable row level security;
grant all on table public."tournaments" to anon,authenticated,service_role;
alter table public."withdrawal_requests" enable row level security;
grant all on table public."withdrawal_requests" to anon,authenticated,service_role;
create trigger profiles_protect_columns_trg before insert or update on public.profiles for each row execute function public.profiles_protect_columns();
create trigger kentro_lock_ken_entitlement_trigger before insert or update on public.profiles for each row execute function public.kentro_lock_ken_entitlement();
create trigger tournaments_money_guard_trg before update on public.tournaments for each row execute function public.tournaments_money_guard();
create trigger tournaments_freeze_config_trg before update on public.tournaments for each row execute function public.tournaments_freeze_config();
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
