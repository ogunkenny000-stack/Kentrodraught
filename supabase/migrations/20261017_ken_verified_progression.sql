-- Already installed on hosted draught.com on 17 Oct 2026.
-- This local copy documents the production schema, for new environments.
begin;
create table if not exists public.kentro_ken_victory_claims (
 owner_id uuid not null references auth.users(id) on delete cascade,
 game_id uuid not null,
 beaten_level integer not null check (beaten_level between 1 and 7),
 claimed_at timestamptz not null default now(),
 primary key(owner_id,game_id)
);
alter table public.kentro_ken_victory_claims enable row level security;
revoke all on public.kentro_ken_victory_claims from public,anon,authenticated;
create or replace function public.kentro_claim_ken_victory(p_owner uuid,p_game_id uuid,p_level integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_profile public.profiles%rowtype; v_previous integer; v_inserted uuid;
begin
 if p_owner is null or p_game_id is null or p_level is null or p_level not between 1 and 7 then raise exception 'Invalid Ken victory claim'; end if;
 select * into v_profile from public.profiles where "ownerId"=p_owner for update;
 if not found then return jsonb_build_object('ok',false,'error','profile_not_found'); end if;
 if v_profile.banned or (v_profile."suspendedUntil" is not null and v_profile."suspendedUntil">(extract(epoch from now())*1000)::bigint) then return jsonb_build_object('ok',false,'error','account_unavailable'); end if;
 select beaten_level into v_previous from public.kentro_ken_victory_claims where owner_id=p_owner and game_id=p_game_id;
 if found then
  if v_previous<>p_level then return jsonb_build_object('ok',false,'error','game_already_claimed_for_another_level'); end if;
  return jsonb_build_object('ok',true,'alreadyClaimed',true,'maxUnlockedKenLevel',greatest(3,v_profile."maxUnlockedKenLevel"));
 end if;
 if p_level>greatest(3,v_profile."maxUnlockedKenLevel") then return jsonb_build_object('ok',false,'error','win_current_level_before_advancing'); end if;
 insert into public.kentro_ken_victory_claims(owner_id,game_id,beaten_level) values(p_owner,p_game_id,p_level) on conflict do nothing returning game_id into v_inserted;
 if v_inserted is null then return jsonb_build_object('ok',true,'alreadyClaimed',true,'maxUnlockedKenLevel',greatest(3,v_profile."maxUnlockedKenLevel")); end if;
 update public.profiles set "maxUnlockedKenLevel"=greatest(3,"maxUnlockedKenLevel",p_level+1) where "ownerId"=p_owner;
 return jsonb_build_object('ok',true,'alreadyClaimed',false,'maxUnlockedKenLevel',greatest(3,v_profile."maxUnlockedKenLevel",p_level+1));
end $$;
revoke all on function public.kentro_claim_ken_victory(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.kentro_claim_ken_victory(uuid,uuid,integer) to service_role;
create or replace function public.kentro_lock_ken_entitlement()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and current_user in ('anon','authenticated') and new."maxUnlockedKenLevel" is distinct from old."maxUnlockedKenLevel"
 then raise exception 'Ken level access is server-managed' using errcode='42501'; end if;
 if tg_op='INSERT' and current_user in ('anon','authenticated') and new."maxUnlockedKenLevel">3
 then raise exception 'Ken level access is server-managed' using errcode='42501'; end if;
 return new;
end $$;
drop trigger if exists kentro_lock_ken_entitlement_trigger on public.profiles;
create trigger kentro_lock_ken_entitlement_trigger before insert or update on public.profiles for each row execute function public.kentro_lock_ken_entitlement();
revoke all on function public.kentro_lock_ken_entitlement() from public,anon,authenticated;
commit;
