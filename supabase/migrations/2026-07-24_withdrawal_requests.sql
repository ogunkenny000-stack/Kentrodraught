-- Adds the withdrawal_requests table. Coins are escrowed (debited) the
-- moment a request is submitted via POST /api/coins/withdraw-request, not
-- when an admin approves it -- "pending" means the money already left the
-- player's spendable balance and is sitting in limbo until an admin either
-- pays it out (paid) or rejects it (which refunds the escrow).
--
-- No client-side INSERT/UPDATE policy on purpose: unlike purchase_requests
-- (a claim with no money movement until an admin approves it), a withdrawal
-- request itself moves real coins out of a wallet, so it has to go through
-- server-validated logic (balance check, minimum amount, games-played and
-- account-age eligibility) via the service-role client, not a raw insert
-- straight from the browser.
--
-- Run this ONCE in the Supabase SQL Editor. Safe to run more than once.

create table if not exists withdrawal_requests (
  "id"             uuid primary key default gen_random_uuid(),
  "username"       text not null,
  "ownerId"        uuid,
  "coins"          numeric not null,
  "nairaAmount"    numeric not null,
  "accountName"    text not null,
  "accountNumber"  text not null,
  "bankName"       text,
  "status"         text not null default 'pending',
  "submittedAt"    bigint,
  "resolvedBy"     text,
  "resolvedAt"     bigint
);

alter table withdrawal_requests enable row level security;

drop policy if exists "withdrawal_requests_select_own" on withdrawal_requests;
create policy "withdrawal_requests_select_own" on withdrawal_requests
  for select to authenticated using (auth.uid() = "ownerId");
