-- Apply in Supabase SQL editor BEFORE enabling guest online play in production.
-- All usage changes are server-only via the service-role credential; clients
-- cannot grant or reset their online allowance using the Supabase anon key.
create table if not exists public.guest_online_trials (
  guest_name text primary key,
  used_at timestamptz not null default now(),
  constraint guest_online_name_format check (guest_name ~ '^KGuest_[a-f0-9]{20}$')
);
alter table public.guest_online_trials enable row level security;
revoke all on public.guest_online_trials from anon, authenticated;
grant select, insert on public.guest_online_trials to service_role;

-- Invoker-rights RPCs: ONLY service_role can call; no RLS bypass by callers.
create or replace function public.guest_online_available(p_guest text)
returns boolean language plpgsql security invoker set search_path = public as $$
begin
  if p_guest !~ '^KGuest_[a-f0-9]{20}$' then return false; end if;
  return not exists (select 1 from public.guest_online_trials where guest_name = p_guest);
end $$;

create or replace function public.claim_guest_online_games(p_guests text[])
returns boolean language plpgsql security invoker set search_path = public as $$
declare g text;
begin
  if cardinality(p_guests) > 2 then return false; end if;
  if exists (select 1 from unnest(p_guests) x where x !~ '^KGuest_[a-f0-9]{20}$') then return false; end if;
  -- Serialize admissions even across multiple server instances.
  for g in select distinct unnest(p_guests) order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended(g, 3818));
  end loop;
  if exists (select 1 from public.guest_online_trials where guest_name = any(p_guests)) then return false; end if;
  insert into public.guest_online_trials(guest_name) select distinct unnest(p_guests);
  return true;
end $$;
revoke all on function public.guest_online_available(text) from public, anon, authenticated;
revoke all on function public.claim_guest_online_games(text[]) from public, anon, authenticated;
grant execute on function public.guest_online_available(text) to service_role;
grant execute on function public.claim_guest_online_games(text[]) to service_role;
