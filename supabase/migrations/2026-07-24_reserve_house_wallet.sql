-- Reserves the "kentro_house" wallet identity, which now collects rake from
-- wagered matches (10%) and tournament prize pools (20%) -- see
-- coinsService.ts (HOUSE_WALLET_USERNAME) and settleMatchPot().
--
-- Run this ONCE in the Supabase SQL Editor, ideally right away -- the
-- earlier this runs, the earlier "kentro_house" is permanently unavailable
-- to any real signup, no matter how that signup is constructed (this isn't
-- just a client-side username-format check, which can be bypassed by
-- calling supabase.auth.signUp() directly -- it's a real row claiming the
-- unique username slot at the database level, so nothing can ever remove or
-- reroute it afterward).
--
-- Safe to run more than once (ON CONFLICT DO NOTHING).

insert into coin_wallets ("username", "balance", "ownerId", "createdAt")
values ('kentro_house', 0, null, extract(epoch from now()) * 1000)
on conflict ("username") do nothing;

-- Sanity check after running -- should return exactly one row, balance 0
-- (or more, if rake has already started accumulating by the time you run
-- this).
-- select * from coin_wallets where username = 'kentro_house';
