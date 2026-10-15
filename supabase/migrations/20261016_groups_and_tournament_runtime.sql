-- Additive runtime state; apply after the authorization and privacy migrations.
begin;
alter table public.tournaments add column if not exists "engineVersion" bigint not null default 0;
alter table public.tournaments add column if not exists "engineState" jsonb not null default '{}'::jsonb;
create or replace function public.kentro_tournament_version() returns trigger language plpgsql set search_path='' as $$ begin new."engineVersion":=old."engineVersion"+1; return new; end $$;
drop trigger if exists kentro_tournament_version on public.tournaments;
create trigger kentro_tournament_version before update on public.tournaments for each row execute function public.kentro_tournament_version();
create or replace function public.kentro_commit_tournament(p_id text,p_version bigint,p_next jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.tournaments%rowtype;
begin
  if jsonb_typeof(p_next)<>'object' or p_next->>'status' not in ('registration','active','completed')
    or jsonb_typeof(p_next->'players')<>'array' or jsonb_typeof(p_next->'matches')<>'array'
    or jsonb_array_length(p_next->'players')>64 or jsonb_array_length(p_next->'matches')>20000
  then raise exception 'Invalid runtime state'; end if;
  update public.tournaments set status=p_next->>'status',players=p_next->'players',matches=p_next->'matches',
    "currentRound"=(p_next->>'currentRound')::integer,"maxRounds"=(p_next->>'maxRounds')::integer,
    logs=p_next->'logs',"engineState"=p_next->'engineState'
  where id=p_id and "engineVersion"=p_version returning * into v;
  if not found then return null; end if;
  return to_jsonb(v);
end $$;
revoke all on function public.kentro_commit_tournament(text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.kentro_commit_tournament(text,bigint,jsonb) to service_role;

create table if not exists public.kentro_groups (
  id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 80),
  description text not null default '' check(length(description)<=1000), icon text not null default '👥' check(length(icon)<=32),
  owner_id uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists public.kentro_group_members (
  group_id uuid not null references public.kentro_groups(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  role text not null check(role in ('owner','admin','member')), status text not null check(status in ('invited','active')),
  primary key(group_id,owner_id)
);
create table if not exists public.kentro_group_messages (
  id uuid primary key default gen_random_uuid(), group_id uuid not null references public.kentro_groups(id) on delete cascade,
  sender_id uuid not null references auth.users(id), text text not null check(length(text) between 1 and 200000),
  created_at timestamptz not null default now(), deleted boolean not null default false
);
alter table public.kentro_group_messages add column if not exists reactions jsonb not null default '{}'::jsonb;
create index if not exists kentro_group_message_order on public.kentro_group_messages(group_id,created_at desc,id);
alter table public.kentro_groups enable row level security;
alter table public.kentro_group_members enable row level security;
alter table public.kentro_group_messages enable row level security;
revoke all on public.kentro_groups,public.kentro_group_members,public.kentro_group_messages from public,anon,authenticated;
grant select on public.kentro_groups,public.kentro_group_members,public.kentro_group_messages to authenticated;

create or replace function public.kentro_in_group(p_group uuid,p_active boolean default true)
returns boolean language sql stable security definer set search_path='' as $$
 select public.kentro_account_active() and exists(select 1 from public.kentro_group_members m where m.group_id=p_group and m.owner_id=auth.uid() and (not p_active or m.status='active'));
$$;
revoke all on function public.kentro_in_group(uuid,boolean) from public;
grant execute on function public.kentro_in_group(uuid,boolean) to authenticated;
drop policy if exists kentro_group_read on public.kentro_groups;
create policy kentro_group_read on public.kentro_groups for select to authenticated using(public.kentro_in_group(id,false));
drop policy if exists kentro_member_read on public.kentro_group_members;
create policy kentro_member_read on public.kentro_group_members for select to authenticated using(public.kentro_in_group(group_id) or owner_id=auth.uid() and public.kentro_account_active());
drop policy if exists kentro_group_message_read on public.kentro_group_messages;
create policy kentro_group_message_read on public.kentro_group_messages for select to authenticated using(public.kentro_in_group(group_id));

create or replace function public.kentro_group_view(p_group uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',g.id,'name',g.name,'description',g.description,'icon',g.icon,
   'createdBy',(select p.username from public.profiles p where p."ownerId"=g.owner_id),
   'createdAt',(extract(epoch from g.created_at)*1000)::bigint,
   'invited',exists(select 1 from public.kentro_group_members where group_id=g.id and owner_id=auth.uid() and status='invited'),
   'admins',coalesce((select jsonb_agg(p.username order by p.username) from public.kentro_group_members m join public.profiles p on p."ownerId"=m.owner_id where m.group_id=g.id and m.role in ('owner','admin') and m.status='active'),'[]'),
   'members',coalesce((select jsonb_agg(p.username order by p.username) from public.kentro_group_members m join public.profiles p on p."ownerId"=m.owner_id where m.group_id=g.id and m.status='active'),'[]'))
 from public.kentro_groups g where g.id=p_group and public.kentro_in_group(g.id,false);
$$;
revoke all on function public.kentro_group_view(uuid) from public;
grant execute on function public.kentro_group_view(uuid) to authenticated;
create or replace function public.kentro_group_list() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(public.kentro_group_view(g.id) order by g.created_at desc),'[]') from public.kentro_groups g where public.kentro_in_group(g.id,false);
$$;
revoke all on function public.kentro_group_list() from public;
grant execute on function public.kentro_group_list() to authenticated;

create or replace function public.kentro_group_action(p_group uuid,p_action text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_group public.kentro_groups%rowtype; v_me public.kentro_group_members%rowtype;
 v_target uuid; v_role text; v_id uuid; v_name text; v_emoji text; v_reactors jsonb; v_message public.kentro_group_messages%rowtype;
begin
 if not public.kentro_account_active() or jsonb_typeof(p_data)<>'object' then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_action='create' then
  perform 1 from public.profiles where "ownerId"=v_uid for update;
  if length(trim(coalesce(p_data->>'name',''))) not between 1 and 80 or length(coalesce(p_data->>'description',''))>1000 or length(coalesce(p_data->>'icon','👥'))>32 then raise exception 'Invalid group'; end if;
  
  v_id:=coalesce(p_group,gen_random_uuid());
  select * into v_group from public.kentro_groups where id=v_id;
  if found then
   if v_group.owner_id<>v_uid or v_group.name<>trim(p_data->>'name') or v_group.description<>coalesce(p_data->>'description','') or v_group.icon<>coalesce(p_data->>'icon','👥') then raise exception 'Group identity conflict' using errcode='42501'; end if;
   return public.kentro_group_view(v_id);
  end if;
  if (select count(*) from public.kentro_groups where owner_id=v_uid)>=20 then raise exception 'Group limit reached'; end if;
  insert into public.kentro_groups(id,name,description,icon,owner_id) values(v_id,trim(p_data->>'name'),coalesce(p_data->>'description',''),coalesce(p_data->>'icon','👥'),v_uid) returning * into v_group;
  insert into public.kentro_group_members values(v_group.id,v_uid,'owner','active');
  return public.kentro_group_view(v_group.id);
 end if;
 select * into v_group from public.kentro_groups where id=p_group for update;
 if not found then raise exception 'Group unavailable' using errcode='42501'; end if;
 select * into v_me from public.kentro_group_members where group_id=p_group and owner_id=v_uid;
 if not found then raise exception 'Not a group member' using errcode='42501'; end if;
 if p_action='accept' and v_me.status in ('invited','active') then
  update public.kentro_group_members set status='active' where group_id=p_group and owner_id=v_uid;
 elsif p_action in ('leave','decline') then
  if v_me.role='owner' then raise exception 'Transfer ownership or delete the group first'; end if;
  delete from public.kentro_group_members where group_id=p_group and owner_id=v_uid; return jsonb_build_object('ok',true);
 elsif v_me.status<>'active' then raise exception 'Accept the invitation first' using errcode='42501';
 elsif p_action='send' then
  v_id:=coalesce((p_data->>'id')::uuid,gen_random_uuid());
  if length(coalesce(p_data->>'text','')) not between 1 and 200000 then raise exception 'Invalid message'; end if;
  insert into public.kentro_group_messages(id,group_id,sender_id,text) values(v_id,p_group,v_uid,p_data->>'text') on conflict(id) do nothing;
  select * into v_message from public.kentro_group_messages where id=v_id and group_id=p_group and sender_id=v_uid and text=p_data->>'text';
  if not found then raise exception 'Message identity conflict' using errcode='42501'; end if;
  return to_jsonb(v_message);
 elsif p_action='react' then
  v_emoji:=p_data->>'emoji';
  if length(coalesce(v_emoji,'')) not between 1 and 16 then raise exception 'Invalid reaction'; end if;
  select username into v_name from public.profiles where "ownerId"=v_uid;
  select * into v_message from public.kentro_group_messages where id=(p_data->>'id')::uuid and group_id=p_group and not deleted for update;
  if not found then raise exception 'Message unavailable'; end if;
  v_reactors:=coalesce(v_message.reactions->v_emoji,'[]');
  if v_reactors ? v_name then
   select coalesce(jsonb_agg(value),'[]') into v_reactors from jsonb_array_elements(v_reactors) where value<>to_jsonb(v_name);
  else v_reactors:=v_reactors||to_jsonb(v_name); end if;
  update public.kentro_group_messages set reactions=jsonb_set(reactions,array[v_emoji],v_reactors) where id=v_message.id;
  return jsonb_build_object('ok',true);
 elsif p_action='delete_message' then
  update public.kentro_group_messages set text='This message was deleted',deleted=true where id=(p_data->>'id')::uuid and group_id=p_group and (sender_id=v_uid or v_me.role in ('owner','admin'));
  if not found then raise exception 'Not authorized' using errcode='42501'; end if; return jsonb_build_object('ok',true);
 elsif p_action='update' and v_me.role in ('owner','admin') then
  update public.kentro_groups set name=coalesce(p_data->>'name',name),description=coalesce(p_data->>'description',description),icon=coalesce(p_data->>'icon',icon) where id=p_group;
 elsif p_action='delete' and v_me.role='owner' then
  delete from public.kentro_groups where id=p_group; return jsonb_build_object('ok',true);
 elsif p_action in ('invite','remove','promote','demote','transfer') and v_me.role in ('owner','admin') then
  select "ownerId" into v_target from public.profiles where "usernameLower"=lower(trim(p_data->>'username')) and not banned and ("suspendedUntil" is null or "suspendedUntil"<=(extract(epoch from now())*1000)::bigint);
  if v_target is null then raise exception 'Account unavailable'; end if;
  select role into v_role from public.kentro_group_members where group_id=p_group and owner_id=v_target;
  if p_action='invite' then
   if (select count(*) from public.kentro_group_members where group_id=p_group)>=100 then raise exception 'Group is full'; end if;
   insert into public.kentro_group_members values(p_group,v_target,'member','invited') on conflict do nothing;
  elsif v_target=v_group.owner_id then raise exception 'Owner cannot be removed or demoted';
  elsif p_action='remove' and (v_role='member' or v_me.role='owner') then delete from public.kentro_group_members where group_id=p_group and owner_id=v_target;
  elsif v_me.role='owner' and p_action in ('promote','demote','transfer') then
   if not exists(select 1 from public.kentro_group_members where group_id=p_group and owner_id=v_target and status='active') then raise exception 'Target is not an active member'; end if;
   update public.kentro_group_members set role=case p_action when 'promote' then 'admin' when 'demote' then 'member' else 'owner' end where group_id=p_group and owner_id=v_target;
   if p_action='transfer' then
    update public.kentro_groups set owner_id=v_target where id=p_group;
    update public.kentro_group_members set role='admin' where group_id=p_group and owner_id=v_uid;
   end if;
  else raise exception 'Not authorized' using errcode='42501'; end if;
 else raise exception 'Not authorized' using errcode='42501'; end if;
 return public.kentro_group_view(p_group);
end $$;
revoke all on function public.kentro_group_action(uuid,text,jsonb) from public;
grant execute on function public.kentro_group_action(uuid,text,jsonb) to authenticated;
create or replace function public.kentro_group_feed(p_group uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(feed) order by feed.created_at,feed.id),'[]') from (
  select m.id,m.group_id,m.text,m.created_at,m.deleted,m.reactions,p.username as sender
  from public.kentro_group_messages m join public.profiles p on p."ownerId"=m.sender_id
  where m.group_id=p_group and public.kentro_in_group(p_group) order by m.created_at desc,m.id desc limit 100
 ) feed;
$$;
revoke all on function public.kentro_group_feed(uuid) from public;
grant execute on function public.kentro_group_feed(uuid) to authenticated;
-- Realtime is optional; polling remains the fallback. Never publish secret room snapshots.
do $$ declare v_table text; begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach v_table in array array['kentro_groups','kentro_group_members','kentro_group_messages'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=v_table) then
    execute format('alter publication supabase_realtime add table public.%I',v_table);
   end if;
  end loop;
 end if;
end $$;
-- Canonical single or team champions share the net prize atomically. The
-- administrator confirms payment; no browser can select another beneficiary.
create or replace function public.kentro_pay_completed_tournament(p_id text,p_rake numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.tournaments%rowtype; v_champions text[]; v_pool numeric; v_payout bigint; v_house bigint; v_share bigint; v_amount bigint; v_extra integer; v_name text; v_paid jsonb:='{}';
begin
 select * into v from public.tournaments where id=p_id for update;
 if not found then return jsonb_build_object('ok',false,'errorReason','not_found'); end if;
 if v."prizePaid" then return jsonb_build_object('ok',false,'errorReason','already_paid'); end if;
 if v.status<>'completed' or jsonb_typeof(v."engineState"->'champions') is distinct from 'array' or jsonb_array_length(v."engineState"->'champions') not between 1 and 64 then return jsonb_build_object('ok',false,'errorReason','not_completed'); end if;
 if p_rake is null or p_rake<0 or p_rake>1 then raise exception 'Invalid rake'; end if;
 select array_agg(distinct lower(value) order by lower(value)) into v_champions from jsonb_array_elements_text(v."engineState"->'champions');
 v_pool:=v."prizePool";
 if v_pool is null or v_pool<0 or v_pool<>trunc(v_pool) or v_pool>9007199254740991 then raise exception 'Invalid pool'; end if;
 if v_pool>coalesce((select sum(amount) from public.coin_transactions where type='tournament_entry' and direction='debit' and "refId"=p_id),0) then raise exception 'Pool exceeds verified entry funding'; end if;
 v_payout:=floor(v_pool*(1-p_rake));v_house:=v_pool-v_payout;
 v_share:=v_payout/array_length(v_champions,1);v_extra:=v_payout-v_share*array_length(v_champions,1);
 foreach v_name in array v_champions loop
  if not exists(select 1 from public.profiles p where p."usernameLower"=v_name and not p.banned and (p."suspendedUntil" is null or p."suspendedUntil"<=(extract(epoch from now())*1000)::bigint))
   or not exists(select 1 from jsonb_array_elements(v.players) player where lower(player->>'username')=v_name)
   or (v_pool>0 and not exists(select 1 from public.coin_transactions c where c.username=v_name and c.type='tournament_entry' and c."refId"=p_id and c.amount>0 and c.direction='debit')) then raise exception 'Champion eligibility requires reconciliation'; end if;
  v_amount:=v_share; if v_extra>0 then v_amount:=v_amount+1; end if;
  if v_amount>0 then perform public.credit_wallet(v_name,v_amount,'tournament_prize',p_id); end if;
  v_paid:=v_paid||jsonb_build_object(v_name,v_amount);v_extra:=greatest(0,v_extra-1);
 end loop;
 if v_house>0 then perform public.credit_wallet('kentro_house',v_house,'rake',p_id); end if;
 update public.tournaments set "prizePaid"=true where id=p_id;
 return jsonb_build_object('ok',true,'payout',v_payout,'rake',v_house,'beneficiaries',v_paid);
end $$;
revoke all on function public.kentro_pay_completed_tournament(text,numeric) from public,anon,authenticated;
grant execute on function public.kentro_pay_completed_tournament(text,numeric) to service_role;
commit;
