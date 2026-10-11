-- Migration: restrict tournament creation/deletion to admins.
--
-- Run this ONCE in your existing Supabase project's SQL Editor (or via
-- `supabase db push` if you've adopted migrations). schema.sql itself is
-- meant for a fresh install only (see its header comment) -- this file is
-- the incremental version for a database you already have data in.
--
-- Safe to run more than once (uses CREATE OR REPLACE / DROP ... IF EXISTS
-- throughout), so re-running it if you're not sure whether it already
-- applied won't cause an error.
--
-- What this changes:
--   * Registering for, playing rounds in, and chatting inside a tournament
--     someone else created is UNCHANGED -- those go through UPDATE, which
--     stays open to every signed-in player.
--   * Creating a new tournament (INSERT) and deleting one (DELETE) now
--     require the "manage_tournaments" admin permission.

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

drop policy if exists "tournaments_write_authenticated" on tournaments;
create policy "tournaments_write_authenticated" on tournaments
  for insert to authenticated with check (is_tournament_admin(auth.uid()));

drop policy if exists "tournaments_delete_authenticated" on tournaments;
create policy "tournaments_delete_authenticated" on tournaments
  for delete to authenticated using (is_tournament_admin(auth.uid()));

-- tournaments_update_authenticated and tournaments_select_all are untouched
-- on purpose -- gameplay (registering, rounds, chat) still needs them open.

-- After running this, make sure at least one row in `admins` has
-- 'manage_tournaments' in its permissions array (Admin Panel -> Admins tab,
-- or `select * from admins;` in the SQL Editor to check), or nobody --
-- including you -- will be able to create a tournament from the client.
