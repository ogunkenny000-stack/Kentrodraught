-- =============================================================================
-- FACTORY RESET — wipes EVERY row of app data AND every user account.
-- The schema itself (tables, functions, triggers, RLS policies) is untouched:
-- all features keep working, the database is just empty, like day one.
--
--   *** THIS CANNOT BE UNDONE. ***
--
-- What gets erased: all player accounts and logins, profiles, avatars, every
-- game ever played, all coin wallets/balances/transactions, purchase and
-- withdrawal requests, tournaments and their prize pools, puzzles, friends,
-- all chat (lounge + private), reports, admin grants, audit logs, and any
-- customized coin settings (prices/rake reset to the server defaults).
--
-- How to use: paste this whole file into the Supabase SQL Editor and run it
-- ONCE. Every signed-in device is logged out immediately.
--
-- Getting your owner access back afterwards takes one minute: open the app,
-- Sign Up with username  kennykristkentro  (any real email, your password).
-- The server hardcodes that username as the Owner, so the moment you're
-- signed in, the golden Admin button is back with full permissions --
-- register it BEFORE announcing the reset, since the first claim wins.
-- =============================================================================

-- All application data. TRUNCATE ... CASCADE clears dependents in one shot
-- and resets any sequences, so ids start from the beginning again too.
truncate table
  profiles,
  completed_games,
  admins,
  audit_logs,
  puzzles,
  tournaments,
  coin_wallets,
  coin_transactions,
  purchase_requests,
  withdrawal_requests,
  friends,
  global_chat,
  private_messages,
  reports,
  app_config
restart identity cascade;

-- Every Supabase Auth account (logins). Deleting from auth.users cascades to
-- identities, sessions, and refresh tokens -- all devices are signed out.
delete from auth.users;
