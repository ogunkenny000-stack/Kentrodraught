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
