# Security and authentication — 15 October 2026

The continuation starts from GitHub commit `35bed25`. This report covers source
review and local executed checks. No hosted Supabase credentials, database
migrations, password emails, financial transfers or production deployment were
used to obtain these results.

## Identity and permissions

HTTP bearer tokens and the existing `x-access-token` contract are verified with
Supabase Auth. Canonical profile ownership binds subsequent usernames; mutable
display names and user metadata do not grant admin authority. Admin permissions
require an explicit matching Auth UID and a recognized permission. Banned,
suspended and reserved house accounts fail authentication. Database browser
policies independently protect official game results, profile statistics,
paid unlocks, wallet writes and tournament state.

Username sign-in and password reset use the server's account-auth facade. The
email lookup RPC is executable only by `service_role`. Password grants use an
isolated Supabase client and cannot replace the shared admin client's session.
Missing users and incorrect passwords receive the same failure body; reset
requests retain the same generic response for unknown users and provider
failures. Recovery redirects use the configured app origin, never a caller's
redirect. A 15-second upstream bound prevents indefinitely waiting auth calls.
These response guarantees do not establish constant-time provider behavior.

This continuation adds an account-specific, bounded login limiter of 12 attempts
per 15 minutes and a reset delivery limit of three per 15 minutes, alongside the
outer IP limiter. Account keys are normalized and do not depend on an asserted
forwarded IP. Reset throttling keeps the generic response. Limits are process
local; multiple replicas require a shared limiter and Supabase provider limits.

## Private tournament repair

The prior snapshot exposed private tournament rows and their invite codes
through an unrestricted SELECT policy. Knowing a tournament ID also bypassed
invitation requirements for server entry, and the chat definer RPC did not
check private access.

`20261015_tournament_privacy.sql` restricts private rows to active verified
participants, authorized tournament admins or explicitly invited Auth UIDs.
An authenticated, separately rate-limited server endpoint redeems invitations;
its service-only SQL function creates a UID-bound read grant. Clients cannot
create those grants or choose the receiving UID. Missing and ambiguous legacy
codes fail closed. Closed tournaments do not accept new invitations. Entry and
chat independently enforce the same private boundary; a failed entry does not
debit the wallet. New invitation codes use 96 random bits; existing codes are
preserved. Authorized recipients can still share an invitation code, as intended
for a bearer invitation; this is not individual organizer approval.

Notification UPDATE privileges are narrowed explicitly to `read_at`, including
installations with broad default table grants. A notification recipient cannot
rewrite the canonical title, body or recipient through a browser update.

## Other reviewed controls

Financial requests use atomic SQL RPCs, safe integer checks and canonical
ownership. Null-owned wallet rows do not authorize another user's HTTP access.
The SQL-upload puzzle route parses supported puzzle data; it cannot fall back
to executing arbitrary SQL. Signup repair migration execution is opt-in and
uses verified TLS. Push subscriptions validate the destination allowlist,
canonical key lengths and a valid P-256 point before delivery. Redirects to
arbitrary push endpoints are disabled. These controls were present in the
saved checkpoint and have been retained.

## Executed evidence

`npx vitest run src/server/tournamentInvites.test.ts
src/server/accountAuth.test.ts src/server/adminService.test.ts
src/server/coinsService.test.ts src/server/supabaseAdmin.test.ts
src/server/webPush.test.ts src/server/httpAuth.test.ts` passed **71 tests in
seven files** on this continuation. Real HTTP fixtures check invite UID binding,
input bounds, caching, generic errors, auth/provider failures, account attempt
limits and reset throttling. They do not call hosted Auth.

The disposable PostgreSQL suite additionally passed **26 checks**, including
actual role permissions, private reads, unauthorized invitation/entry/chat,
ban enforcement, wallet concurrency and rollback. See
[database report](07_SUPABASE_AND_DATABASE.md) for the exact scope.

## Remaining verification

Run genuine Auth login, email confirmation, password recovery, account disabling
and permission revocation in isolated Supabase staging. Exercise RLS and
Realtime with real JWTs after migration rehearsal. Establish deployment
origins, proxy trust, provider abuse limits and shared rate limiting for the
chosen topology. No penetration-test certification or production security
guarantee is claimed.
