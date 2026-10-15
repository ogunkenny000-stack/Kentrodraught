-- Apply after authorization/wallet/rating migrations. Keeps existing rows,
-- entrants and invitation codes. New invitation grants bind immutable UIDs.
begin;
-- Supabase installations can have broad default table grants. Narrow the
-- notification UPDATE privilege before granting the sole mutable column.
revoke update on public.kentro_notifications from public,anon,authenticated;
grant update(read_at) on public.kentro_notifications to authenticated;
create table if not exists public.kentro_tournament_invites (
  tournament_id text not null references public.tournaments(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key(tournament_id,owner_id)
);
alter table public.kentro_tournament_invites enable row level security;
revoke all on public.kentro_tournament_invites from public,anon,authenticated;

create or replace function public.kentro_can_view_tournament(p_id text,p_visibility text,p_players jsonb)
returns boolean language sql stable security definer set search_path='' as $$
  select lower(coalesce(p_visibility,'public'))<>'private' or
    exists(select 1 from public.profiles p where p."ownerId"=auth.uid()
      and not p.banned and (p."suspendedUntil" is null or p."suspendedUntil"<=(extract(epoch from now())*1000)::bigint)
      and p."usernameLower"<>'kentro_house'
      and (public.is_tournament_admin(auth.uid())
        or exists(select 1 from jsonb_array_elements(coalesce(p_players,'[]')) player
          where lower(player->>'username')=p."usernameLower")
        or exists(select 1 from public.kentro_tournament_invites i where i.tournament_id=p_id and i.owner_id=auth.uid())));
$$;
revoke all on function public.kentro_can_view_tournament(text,text,jsonb) from public;
grant execute on function public.kentro_can_view_tournament(text,text,jsonb) to anon,authenticated;
drop policy if exists tournaments_select_all on public.tournaments;
drop policy if exists tournaments_select_visible on public.tournaments;
create policy tournaments_select_visible on public.tournaments for select
  using (public.kentro_can_view_tournament(id,visibility,players));

create or replace function public.kentro_redeem_tournament_invite(p_owner uuid,p_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_tour public.tournaments%rowtype;
begin
  if p_owner is null or p_code is null or length(p_code) not between 4 and 64
    or not exists(select 1 from public.profiles p where p."ownerId"=p_owner
      and p."usernameLower"<>'kentro_house' and not p.banned
      and (p."suspendedUntil" is null or p."suspendedUntil"<=(extract(epoch from now())*1000)::bigint))
  then return jsonb_build_object('ok',false,'error','not_found'); end if;
  -- Duplicate historical codes fail closed rather than disclosing an arbitrary row.
  if (select count(*) from public.tournaments where lower(visibility)='private' and upper("inviteCode")=upper(trim(p_code)))<>1
  then return jsonb_build_object('ok',false,'error','not_found'); end if;
  select * into v_tour from public.tournaments where lower(visibility)='private' and upper("inviteCode")=upper(trim(p_code)) for update;
  if v_tour.status not in ('registration','upcoming','active','open') or v_tour.status is null
  then return jsonb_build_object('ok',false,'error','not_open'); end if;
  insert into public.kentro_tournament_invites(tournament_id,owner_id) values(v_tour.id,p_owner) on conflict do nothing;
  return jsonb_build_object('ok',true,'tournament',to_jsonb(v_tour));
end $$;
revoke all on function public.kentro_redeem_tournament_invite(uuid,text) from public,anon,authenticated;
grant execute on function public.kentro_redeem_tournament_invite(uuid,text) to service_role;

create or replace function public.tournament_entry(
  p_tournament_id text,p_username text,p_entry_fee numeric,p_player jsonb,p_log_line text
) returns table("ok" boolean,"errorReason" text,"balance" numeric,"players" jsonb)
language plpgsql security definer set search_path='' as $$
declare v_tour public.tournaments%rowtype; v_profile public.profiles%rowtype; v_balance numeric;
begin
  if p_entry_fee is null or p_entry_fee<0 or p_entry_fee>9007199254740991 or p_entry_fee<>trunc(p_entry_fee)
    or p_username is null or jsonb_typeof(p_player) is distinct from 'object'
  then raise exception 'Invalid tournament entry'; end if;
  select * into v_profile from public.profiles where "usernameLower"=lower(trim(p_username));
  if not found or v_profile.banned or v_profile."usernameLower"='kentro_house'
    or v_profile."suspendedUntil">(extract(epoch from now())*1000)::bigint
  then return query select false,'not_allowed',null::numeric,null::jsonb; return; end if;
  select * into v_tour from public.tournaments where id=p_tournament_id for update;
  if not found then return query select false,'not_found',null::numeric,null::jsonb; return; end if;
  if lower(v_tour.visibility)='private' and not exists(select 1 from public.kentro_tournament_invites
      where tournament_id=p_tournament_id and owner_id=v_profile."ownerId")
    and not public.is_tournament_admin(v_profile."ownerId")
  then return query select false,'not_allowed',null::numeric,null::jsonb; return; end if;
  if v_tour.status is distinct from 'registration' then return query select false,'not_open',null::numeric,null::jsonb; return; end if;
  if exists(select 1 from jsonb_array_elements(v_tour.players) player where lower(player->>'username')=v_profile."usernameLower")
  then return query select false,'already_registered',null::numeric,v_tour.players; return; end if;
  if v_tour."maxPlayers" is not null and jsonb_array_length(v_tour.players)>=v_tour."maxPlayers"
  then return query select false,'full',null::numeric,null::jsonb; return; end if;
  if p_entry_fee>0 then
    select d.ok,d.balance into ok,v_balance from public.debit_wallet(v_profile."usernameLower",p_entry_fee,'tournament_entry',p_tournament_id) d;
    if not ok then return query select false,'insufficient_funds',v_balance,null::jsonb; return; end if;
  else select coalesce(w.balance,0) into v_balance from public.coin_wallets w where w.username=v_profile."usernameLower"; end if;
  update public.tournaments set players=v_tour.players||jsonb_build_array(p_player||jsonb_build_object('username',v_profile.username)),
    logs=v_tour.logs||jsonb_build_array(left(coalesce(p_log_line,v_profile.username||' joined the tournament.'),500)),
    "prizePool"=v_tour."prizePool"+p_entry_fee where id=p_tournament_id returning tournaments.players into players;
  return query select true,null::text,coalesce(v_balance,0),players;
end $$;
revoke all on function public.tournament_entry(text,text,numeric,jsonb,text) from public,anon,authenticated;
grant execute on function public.tournament_entry(text,text,numeric,jsonb,text) to service_role;

create or replace function public.kentro_tournament_chat(p_tournament text,p_message text,p_reply text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_profile public.profiles%rowtype; v_tour public.tournaments%rowtype; v_chat jsonb;
begin
  select * into v_profile from public.profiles where "ownerId"=auth.uid();
  if not found or v_profile.banned or v_profile."usernameLower"='kentro_house' or v_profile."suspendedUntil">(extract(epoch from now())*1000)::bigint
    or p_message is null or length(trim(p_message)) not between 1 and 2000
    or (p_reply is not null and length(p_reply)>160)
  then raise exception 'Invalid chat message' using errcode='42501'; end if;
  select * into v_tour from public.tournaments where id=p_tournament for update;
  if not found or not public.kentro_can_view_tournament(v_tour.id,v_tour.visibility,v_tour.players)
  then raise exception 'Tournament unavailable' using errcode='42501'; end if;
  update public.tournaments set chat=chat||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),
    'sender',v_profile.username,'message',trim(p_message),'timestamp',(extract(epoch from now())*1000)::bigint,
    'isAnnouncement',false,'replyTo',p_reply,'reactions','{}'::jsonb)) where id=p_tournament returning chat into v_chat;
  return v_chat;
end $$;
revoke all on function public.kentro_tournament_chat(text,text,text) from public,anon;
grant execute on function public.kentro_tournament_chat(text,text,text) to authenticated;
commit;
