# Deployment and rollback — 15 October 2026

No production deployment, hosted database migration or financial transaction
was performed during this audit. Use a reviewed source commit and a staging
database before enabling account, rating, tournament or wallet operations.

## Standard container

`docker compose up -d --build` builds the React client, Node backend and C++
engine. The image runs as the `node` user with a healthcheck. Compose adds an
init process, a ten-second stop grace period and the named persistent volume
`kentro_game_data:/app/data`. Built browser values are public
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Runtime private values
include `SUPABASE_SECRET_KEY`, optional `SUPABASE_DB_URL` and VAPID private
key; keep them in the host's secret manager or ignored local environment
file. Never provide server secrets as frontend build arguments.

Set runtime `SUPABASE_URL`, `APP_URL` and the required server key for the real
project. `APP_URL` should be the deployed HTTPS origin for account recovery.
`BOOTSTRAP_ADMIN_UID`, when deliberately configured, must identify the intended
authenticated account UUID. Optional push delivery uses
`WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` and
`WEB_PUSH_CONTACT`. Account/backend failures must not silently grant access.

Startup migrations are disabled by default; Compose explicitly sets
`SKIP_DB_MIGRATION=1`. Rehearse ordered migrations and authorization checks in
an isolated Supabase staging project first. Review the exact migration opt-in
code and rollback scripts before any hosted change; a successful source build
does not install schema, RLS policies or functions in Supabase.

## Persistent state and restart behavior

`KENTRO_DATA_DIR` selects the mutable game-record/sequence directory. The image
and Compose default it to `/app/data`. A different host-mounted path must be
explicitly configured and writable by container UID 1000; an unrelated mount
does not persist the application's files automatically. Back up completed
records, sequence counters and any other required database data separately.

`scripts/audit/container-smoke.ts` creates its own disposable container and
volume, publishes HTTP only on loopback, and passes no host credentials. It
checks non-root execution, actual native search, protected static delivery,
two-client guest gameplay, graceful shutdown and completed-record restoration
using a configured data-directory subpath. Fresh completion checks include actual production guest gameplay, active-game
SIGKILL/restart, token reclamation, clock/history preservation, denied paid-level
claims, graceful shutdown and completed-record restoration. Current image evidence
is [completion-container-20261015.json](evidence/completion-container-20261015.json).
The earlier image/build numbers are historical. The fresh image uses Node 22 and
UID 1000 with no runtime compiler/Vite. It is a local disposable image, not a
production deployment; build frontend values are explicitly synthetic and no
hosted secrets are passed.

Live rooms, sessions, local quotas, clocks and tournament outbox now checkpoint
under this same private directory. Actual subprocess and container SIGKILL tests
verify recovery. File fsync/atomic rename/checksum and a single-writer lock protect
snapshots; a bad snapshot fails startup. Outage time freezes, clocks have roughly
one-second crash tolerance, and seats get a fresh 120-second recovery window.
A rematch clears previous terminal state; terminal synchronization/outbox replay
is idempotent. Never run multiple Node authorities on the same or independent
copies of live state behind a load balancer.

Back up the whole data directory consistently while stopped/drained. Its room
snapshots contain bearer resume tokens and must remain private. A successful
source ZIP excludes this runtime state. The full current recovery, SQL containment
rollback and staging checklist is in [Supabase handoff](../SUPABASE_HANDOFF.md).

## Reverse proxies and optional edge

The server rejects untrusted forwarded client IPs by default. The optional
`scripts/start-go-edge.sh` binds Node to `127.0.0.1` and explicitly enables
`TRUST_PROXY=loopback` for the local Go edge. Go replaces incoming forwarded
headers using its actual socket peer. Do not expose the private backend port
or broadly trust arbitrary forwarding headers.

Terminate HTTPS at a configured production proxy with WebSocket upgrade
support, suitable idle timeouts and request limits. An additional external
proxy changes the address visible to Go: its current forwarding design uses
that proxy's socket IP, so enforce per-client limits at the external proxy
and review the trust chain before deployment. Avoid interpreting a shared
proxy address as proof of an individual client's identity.

## Rollback

Retain the previous application image/commit and take a database backup before
migration. Deploy staging, verify actual login/recovery, permissions, ratings,
wallet and social workflows, then review the production change. On rollback,
restore the compatible application image and explicitly decide whether schema
or data must also be restored. A Git revert does not undo database changes.
Preserve the mounted data volume; do not use volume-deleting cleanup commands
as part of ordinary redeployment. Recheck health, native search, WebSocket
upgrades and record visibility after either deployment or rollback.


New runtime TURN options `TURN_URLS`/`TURN_SHARED_SECRET` are forwarded by Compose.
The secret remains runtime-only; public client configuration contains only
short-lived credentials for authenticated callers. No shared relay service is
configured automatically. Use `.env.example` and supply the operator's own relay.
