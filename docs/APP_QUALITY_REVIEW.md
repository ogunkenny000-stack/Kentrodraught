# Kentro application quality review — 19 October 2026 UTC

This review covers the supplied complete application, its server, native/offline engines,
financial database logic and representative browser journeys. Passing these checks does
not promise a bug-free app or certify third-party services that were not exercised.
Nigerian draughts rules in `src/gameLogic.ts` remain byte-identical to the previous package.
No real user accounts, games, balances, ledger entries or hosting settings were changed
by this review. All financial and write-heavy regression testing used disposable fixtures.

## Confirmed defects corrected

- Account isolation: ignore stale profile, wallet and admin responses after identity
  changes. Clear prior profile/wallet state and bank/receipt forms on account changes;
  ignore late purchase, withdrawal and entitlement responses belonging to another identity.
- Withdrawal input: require positive safe whole numbers, rather than silently truncating
  decimals or accepting numeric prefixes with `parseInt`.
- Notification sign-out: bound push HTTP requests to eight seconds and retain browser
  endpoint revocation on server failure. Replace subscriptions tied to an old VAPID key.
- Push configuration: validate canonical key encoding, matching P-256 keys and a valid
  HTTPS/mail contact without control characters or embedded credentials.
- Offline engine: reject malformed worker results promptly, validate search statistics,
  normalize non-finite search budgets, honor pre-cancellation and release workers when
  posting a request fails. No engine search rules or evaluation weights were changed.
- Accessibility: improve small text and label contrast on authentication and home screens.
- Browser fixtures: wait for dialog transitions and unobscured controls; update the
  analysis entry label and account for subtitles and visual uppercase styling.

## Verification completed

| Area | Evidence |
| --- | --- |
| TypeScript and unit suite | `npm run lint`; 543 tests passed in 52 files |
| Financial safety and Ken proofs | coin safety/progression and signed Ken progression suites passed |
| Rules parity | 307 exact C++/TypeScript move-list parity positions passed |
| Migrations and permissions | generated migration check and 37 disposable PostgreSQL security checks passed |
| Financial database | PostgreSQL 16: atomic installation/rollback, protected RPCs, idempotent purchases, withdrawals, match charges/refunds/payouts and parallel race tests passed |
| Multiplayer | server smoke, crash/restart recovery and browser create/join/legal moves/clocks/reconnect/resign/rematch passed; browser media explicitly skipped in final PvP run |
| Tournaments and groups | real local PostgreSQL + WebSocket tournament results; two-browser persistent group/invite/message/reload journeys passed using local Auth/HTTP fixtures |
| Browser surfaces | guest quotas, desktop/mobile layouts, focus trapping, recovery validation/provider fixtures, TV playback/share, editor/custom AI/analysis, academy and puzzle unavailable state passed |
| Account switching | `scripts/e2e/account-isolation.e2e.ts` holds old wallet/admin responses across sign-out and guest continuation, then verifies no stale balance/controls |
| Analysis | desktop/mobile, custom roots/turns/imports, engine error/retry, forced score and cancellation checks passed |
| Production offline | actual service-worker install and network-disabled reload; offline Ken completed 36 validated plies including 10 captures with zero engine API requests |
| Production container | non-root Node 22 image, native search, cache/encoding/privacy headers, two clients, healthcheck, real SIGKILL/restart persistence and graceful shutdown passed |
| Edge service | Go unit tests passed in `golang:1.23-alpine`; host `/usr/bin/go` is GNU Go, so it cannot run this suite |
| Accessibility | axe WCAG 2 A/AA and 2.1 AA: zero automated violations on mobile authentication and desktop home after contrast fixes; this is not a full accessibility certification |
| Dependencies | `npm audit` and `npm audit --omit=dev`: zero reported known vulnerabilities at review time |
| Final build | original Supabase public bindings retained; frontend finance build flag enabled in prepared package |

Container and accessibility summaries are in `docs/audit/evidence/app-quality-20261019/`.
The standard Vite bundle-size warning remains: the main app and lazy admin bundle are
large. The production build includes precompressed assets and lazy feature chunks;
this review does not claim a load/capacity or low-end-device certification.

## Hosting and external checks still required

The original Supabase project `pwovowlyylceuzontdhg` was already upgraded and verified in
prior work. Its deployment keys should stay unchanged. Do not rerun old migration
executors merely because older notes describe an incomplete upgrade.

The last live check of `https://kentrodraught.ai.studio/api/coins/settings` still returned
`coinsEnabled:false`. The deployed frontend was also built with finance disabled.
Hosting must **rebuild** with `VITE_KENTRO_COINS_ENABLED=1` and redeploy the backend with
`KENTRO_COINS_ENABLED=1`, `SKIP_DB_MIGRATION=1` and the existing Supabase configuration.
A database upgrade, GitHub push or cloud configuration draft does not perform that hosting
redeployment. Hosting administration is not connected in this environment.

For background push, hosting needs a matching `WEB_PUSH_VAPID_PUBLIC_KEY` and
`WEB_PUSH_VAPID_PRIVATE_KEY` plus `WEB_PUSH_CONTACT` (e.g. `mailto:admin@your-domain`).
Keep the private key server-only and retain the pair across deployments. The public key
is intentionally returned by the push-config endpoint. This review did not rotate keys
or send notifications to users. A real permitted browser delivery still needs checking.

Managed Chromium gathered no host ICE candidates. Nearby and voice/video transports
could not be certified here and require real supported devices on the intended networks.
Actual bank transfers/payouts, hosted email delivery/recovery, hosted Realtime behavior,
and a complete post-redeployment signed-in acceptance run remain external checks.
No external messages or real-money transactions were sent by this review.
