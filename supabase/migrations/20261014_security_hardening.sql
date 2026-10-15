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
