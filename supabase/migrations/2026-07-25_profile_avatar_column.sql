-- Adds the avatarUrl column player profiles now read/display. Safe to run
-- more than once (IF NOT EXISTS).
alter table profiles add column if not exists "avatarUrl" text;
