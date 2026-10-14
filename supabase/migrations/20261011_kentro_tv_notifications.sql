-- Kentro TV / Smart Notifications. Run once in the Supabase SQL editor before deploying.
-- Durable recipient-only inbox; no user-created notifications (spam/forgery prevention).
create table if not exists public.kentro_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('challenge','friend','tournament','result','system')),
  title text not null check (char_length(title) between 1 and 150),
  body text not null check (char_length(body) <= 500),
  target_path text not null default '/' check (target_path like '/%' and target_path not like '//%'),
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  push_delivered_at timestamptz,
  unique (recipient_id, dedupe_key)
);
create index if not exists kentro_notifications_recipient_created_idx on public.kentro_notifications(recipient_id, created_at desc);
alter table public.kentro_notifications enable row level security;
revoke all on public.kentro_notifications from anon;
grant select on public.kentro_notifications to authenticated;
grant update (read_at) on public.kentro_notifications to authenticated;
-- Supabase service-role and restricted DB triggers can insert.
drop policy if exists "kentro_notifications_read_own" on public.kentro_notifications;
create policy "kentro_notifications_read_own" on public.kentro_notifications for select to authenticated using (recipient_id = (select auth.uid()));
drop policy if exists "kentro_notifications_update_own" on public.kentro_notifications;
create policy "kentro_notifications_update_own" on public.kentro_notifications for update to authenticated
  using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));

-- Resolve a target by actual profile ownership; never use a user-provided uid as authority.
create or replace function public.kentro_notify_friend() returns trigger language plpgsql security definer set search_path = '' as $$
declare other_name text; other_id uuid;
begin
  if new.status <> 'accepted' or (tg_op = 'UPDATE' and old.status = 'accepted') then return new; end if;
  -- Notify the original sender when the other player accepts.
  other_name := new.sender;
  select p."ownerId" into other_id from public.profiles p where p."usernameLower" = lower(other_name) limit 1;
  if other_id is not null then
    insert into public.kentro_notifications(recipient_id,category,title,body,target_path,dedupe_key)
    values (other_id,'friend','Friend request accepted',left(coalesce(case when lower(new.sender) = lower(new.user1) then new.user2 else new.user1 end,'A player') || ' accepted your friend request.',500),'/','friend:'||new.id)
    on conflict (recipient_id,dedupe_key) do nothing;
  end if;
  return new;
end $$;
revoke execute on function public.kentro_notify_friend() from public, anon, authenticated;
drop trigger if exists trg_kentro_notify_friend on public.friends;
create trigger trg_kentro_notify_friend after insert or update on public.friends for each row execute function public.kentro_notify_friend();

-- Tournament events, deduped by status/round. Existing registration is not altered.
create or replace function public.kentro_notify_tournament() returns trigger language plpgsql security definer set search_path = '' as $$
declare player jsonb; player_name text; player_uid uuid; event_key text; event_title text;
begin
  if new.status not in ('active','completed') then return new; end if;
  -- Legacy tournament RLS permits general updates: only notify for admin updates
  -- or service-role jobs (auth.uid() is NULL), preventing player-generated spam.
  if auth.uid() is not null and not public.is_tournament_admin(auth.uid()) then return new; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new."currentRound" is not distinct from old."currentRound" then return new; end if;
  event_key := 'tournament:'||new.id||':'||coalesce(new.status,'')||':'||coalesce(new."currentRound"::text,'0');
  event_title := case when new.status='completed' then 'Tournament results are in' else 'Tournament round is live' end;
  for player in select value from jsonb_array_elements(coalesce(new.players,'[]'::jsonb)) loop
    player_name := case when jsonb_typeof(player) = 'string' then trim(both '"' from player::text) else coalesce(player->>'username', player->>'name') end;
    if player_name is null then continue; end if;
    select p."ownerId" into player_uid from public.profiles p where p."usernameLower" = lower(player_name) limit 1;
    if player_uid is not null then
      insert into public.kentro_notifications(recipient_id,category,title,body,target_path,dedupe_key)
      values(player_uid,'tournament',event_title,left(coalesce(new.name,'Your tournament')||' · '||case when new.status='completed' then 'Check the final standings.' else 'Open the tournament hub for your fixtures.' end,500),'/?view=tournament',event_key)
      on conflict (recipient_id,dedupe_key) do nothing;
    end if;
  end loop;
  return new;
end $$;
revoke execute on function public.kentro_notify_tournament() from public, anon, authenticated;
drop trigger if exists trg_kentro_notify_tournament on public.tournaments;
create trigger trg_kentro_notify_tournament after insert or update on public.tournaments for each row execute function public.kentro_notify_tournament();

-- Optional: enable Postgres Changes for this table in Supabase Realtime publication.
-- Client also polls on focus and every 35 s, so realtime configuration isn't required.

-- Device subscriptions are server-managed; a user may revoke them through the authenticated endpoint.
create table if not exists public.kentro_push_subscriptions (
  endpoint text primary key,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  categories jsonb not null default '["challenge","friend","tournament","result","system"]'::jsonb,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists kentro_push_recipient_idx on public.kentro_push_subscriptions(recipient_id);
alter table public.kentro_push_subscriptions enable row level security;
revoke all on public.kentro_push_subscriptions from anon, authenticated;
-- Subscription keys are not exposed by the Data API; all writes occur through token-verified server routes.
