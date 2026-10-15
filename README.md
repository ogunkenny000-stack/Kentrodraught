---
title: Kentro Draught
emoji: 👑
colorFrom: yellow
colorTo: gray
sdk: docker
app_port: 3000
pinned: false
---

## Latest performance and hosting enhancements (October 2026)

Start with **[MAX_PERFORMANCE_README.md](MAX_PERFORMANCE_README.md)** for the new performance fixes, tests, small-server container setup, and important limitations. This release preserves the existing app design and engine.

## MVP performance enhancement (Go + lightweight frontend)

See **[PERFORMANCE_UPGRADE.md](PERFORMANCE_UPGRADE.md)** for the optional Go edge, code-splitting changes, deployment options, tests, and CPU/RAM benchmarking guidance. The default Node server remains supported and retains authority over matches.

# Kentro Draught

Nigerian Draughts, online. Play the Ken engine (Ken 1–8, powered by a
compiled SCAN-derived C++ engine), battle friends in real time, join
tournaments, and use the built-in AI game analysis. Installable as a PWA —
open the Space on your phone and tap **Install**.

## Deploying (Hugging Face Spaces)

This repo is set up for the **Docker** Space SDK (see the YAML frontmatter
at the top of this file). Push `draught_com/` (including the `Dockerfile`)
to your Space's repo and it builds automatically. Before it'll work
correctly:

1. **Run `supabase/schema.sql`** against your Supabase project once (SQL
   Editor in the dashboard, or `supabase db push`) — creates every table,
   RLS policy, and the wallet/tournament-entry functions the app needs.
2. **`VITE_SUPABASE_URL`** and **`VITE_SUPABASE_PUBLISHABLE_KEY`** (required)
   — from your Supabase project's Settings -> API Keys page. These are
   exposed to the browser by design (same as Firebase's client config used
   to be); security comes from the RLS policies in `supabase/schema.sql`,
   not from hiding these.
3. **`SUPABASE_URL`** and **`SUPABASE_SECRET_KEY`** (required for Kentro
   Coins and admin actions) — Space secrets containing your Supabase
   project URL and Secret key. Without these, Kentro Coins and every admin
   action fail loudly (not silently) — see `supabaseAdmin.ts` for exact
   setup steps.
4. **`BOOTSTRAP_ADMIN_UID`** (optional one-time admin bootstrap)
   — set to your authenticated Supabase user's UUID, with a matching
   canonical `profiles` row. The server no longer grants admin rights by
   a client-chosen username. Remove this variable after bootstrap.

Review [the audit deployment and rollback procedure](docs/audit/15_DEPLOYMENT_AND_ROLLBACK.md)
before upgrading an existing instance. Boot-time migrations are disabled by
default; apply reviewed migrations separately to staging before production.

The included two-stage `Dockerfile` now builds from this source directory
rather than needing another `draught_com.zip` archive. It compiles the native
engine and frontend, then copies only production runtime files into the
smaller final image. The compose file persists local match files in a volume.

## Running locally

**Prerequisites:** Node.js 20+, a C++ toolchain (`g++`, `make`) for the
draughts engine, and a Supabase project with `supabase/schema.sql` applied.

```
npm install
npm run dev
```

`npm run dev` (and `npm run build`) automatically compile the engine binary
first — see `scripts/build-engine.cjs`. Set `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` (e.g. in a `.env` file) before running —
see `.env.example`. Coins/admin features additionally need `SUPABASE_URL`
and `SUPABASE_SECRET_KEY` set locally too if you want to test them.

## Project layout

- `src/` — React/Vite frontend
- `server.ts` — Express + WebSocket backend (multiplayer rooms, coin wallet
  endpoints, admin endpoints, the engine HTTP bridge)
- `nd_upgraded/` — the C++ draughts engine source (compiled fresh on every
  build/deploy, never shipped precompiled — see `.gitignore`)
- `supabase/schema.sql` — Postgres schema, RLS policies, and the wallet /
  tournament-entry RPC functions (apply once via the SQL Editor or
  `supabase db push`; this file existing in the repo does not apply it
  automatically)

## Frontend architecture (July 2026 refactor)

`src/App.tsx` was previously a 6,780-line monolith. It is now a ~3,700-line
state container (all game/multiplayer/economy state, effects and handlers)
that composes focused view components:

```
src/
├── lib/
│   ├── audio.ts          # Web-Audio sound effect synths
│   ├── analysis.ts       # engine eval, move classification, game review
│   └── constants.ts      # KEN_LEVELS, badges, coin economy, OPay details
├── components/
│   ├── ui/ModalShell.tsx        # shared responsive dialog (bottom sheet on
│   │                            #   phones, centered dialog on desktop)
│   ├── layout/
│   │   ├── TopNav.tsx           # global header
│   │   ├── MobileTabBar.tsx     # bottom navigation (phones, hub screens)
│   │   └── MobileDrawers.tsx    # menu + scorecard slide-out drawers
│   ├── game/GameScreen.tsx      # board arena, HUD cards, controls, editor
│   ├── panels/
│   │   ├── GameSidebar.tsx      # "Arena Desk": clocks, engine, move sheet,
│   │   │                        #   AI coach, practice mode, saved games
│   │   └── MultiplayerPanel.tsx # lobby + in-room chat/voice/ready panel
│   └── modals/                  # Rules, Settings, App Guide, Analysis,
│                                #   PDN import, Coins store, VS Computer,
│                                #   Game Over, Sandbox choice, Players
└── App.tsx                      # state owner + composition root
```

### Mobile fixes shipped with the refactor

- The in-game column now scrolls on phones (was `overflow-hidden` +
  `justify-center`, which clipped the opponent card and bottom controls on
  short screens with no way to reach them).
- Multiplayer chat / voice / ready controls are reachable on phones during a
  live match via a floating chat button + bottom sheet (previously the panel
  had no entry point at all once a game started).
- Every modal is a safe-area-aware bottom sheet on phones and can never
  overflow off-screen (body scrolls, capped at 88dvh).
- New bottom tab bar (Home / Arena / Play / Events / Lounge) on hub screens;
  hidden during board play to preserve vertical space.
- Safe-area insets respected throughout for Android gesture bars and
  notches in the installed PWA; tap-highlight and pull-to-refresh disabled
  for a native feel.

## Online play protocol and tests

The multiplayer layer (rooms, server-owned clocks, sessions, reconnects,
draw/resign/rematch, spectators, voice/video call signalling) follows the
contract in `docs/ONLINE_PLAY_PROTOCOL.md`; shared types live in
`src/shared/protocol.ts`. The server side is `src/server/onlinePlay.ts`
(attached from `server.ts`), the client side is `src/lib/gameSocket.ts`
(resilient socket manager), `src/lib/roomState.ts` (room reducer),
`src/lib/useServerClock.ts` (clock snapshots) and `src/lib/useWebRTCCall.ts`
(calls, perfect negotiation).

Three layers of tests:

    npx vitest run                                  # unit tests (rules, socket manager, clocks, call state machine)
    PORT=8123 npx tsx server.ts &                   # then, in another terminal:
    SMOKE_URL=ws://localhost:8123 npx tsx scripts/pvp-smoke.ts   # 24-section WebSocket smoke test
    npm run dev &                                   # then, in another terminal:
    npx tsx scripts/e2e/pvp.e2e.ts                  # two headless Chrome players: host/join, moves, clocks,
                                                    # dropped-socket recovery, voice call, resign, rematch

The browser test drives the locally installed Google Chrome through
`puppeteer-core` with fake camera/microphone devices and signs the two test
accounts in with an injected local session (see `scripts/e2e/harness.ts`),
so it never writes to the production database. Screenshots land in
`scripts/e2e/out/`.

## Offline Ken engine (on-device AI)

Ken 1-8 no longer call the server at all. A TypeScript alpha-beta engine
(`src/engine/kenCore.ts`) runs inside a Web Worker on the player's device,
powering AI games, hints, the live eval bar, and AI Game Review — all fully
offline. Move legality is delegated to the app's own `generateLegalMoves`,
so Ken can never disagree with the arbiter about forced captures.

The level strategy is copied **verbatim from lidraughts' draughtsnet**
(RoepStoep/draughtsnet, `draughtsnet.py` — the tables Scan 1-8 use for the
normal 10x10 game):

| Level | Move time | Nodes cap | Depth cap | Eval    | Handicap |
|------:|----------:|----------:|----------:|---------|---------:|
| 1     | 50 ms     | 50        | —         | simple  | 3        |
| 2     | 100 ms    | 120       | —         | simple  | 2        |
| 3     | 150 ms    | 400       | —         | simple  | 0        |
| 4     | 200 ms    | 1200      | —         | simple  | 0        |
| 5     | 300 ms    | —         | 6         | simple  | 0        |
| 6     | 400 ms    | —         | 5         | full    | 0        |
| 7     | 500 ms    | —         | 11        | full    | 0        |
| 8     | 1000 ms   | —         | 21        | full    | 0        |

Handicap = uniform random noise on root move scores (±80cp per point), the
same weakening idea Scan's `level handicap` applies. Depth caps are
ceilings; within Scan's exact time budget the engine searches as deep as
the device allows (capture chains are extended for free, so tactics are
seen far beyond the nominal depth). `scripts/ken-selftest.ts` self-plays a
full legality-checked game and verifies every level's caps:

    npx tsx scripts/ken-selftest.ts

The server's C++ Scan engine remains for server-side jobs (e.g. mining
puzzles from games); the client no longer depends on it.

## Fair Play Guard (anti app-switching)

Switching to another app, split-screening, or defocusing the window during
a live game is detected client-side (visibilitychange, window blur while
visible, and a rotation-safe viewport-shrink heuristic that ignores the
on-screen keyboard) and enforced server-side for multiplayer:

- 3 warnings, then the absentee **forfeits** (opponent wins; wager pot is
  settled through the exact resign flow).
- A single absence longer than 12s, or more than 20s total away time in a
  game, is also a forfeit — timed on the server, so a throttled background
  tab can't dodge it.
- The opponent and spectators see a live "left the app — warning N/3"
  banner; the offender gets a warning dialog on return.
- Tournament games vs Ken forfeit locally on the same 3-strike rule.
- Casual AI games aren't forfeited, but leaving the app voids the
  level-unlock for that match (same rule as using a hint/undo).

Forfeit (not restart) is deliberate: a restart would let a losing player
escape a lost position by switching apps on purpose. Honest limits: a
second device is physically undetectable, and a modified client can lie —
this closes the easy same-device route; pair it with move-quality
analysis for wagered games as the next layer.

## Docker

A production multi-stage `Dockerfile` is included (plus `docker-compose.yml`
and `.dockerignore`). It compiles the C++ Scan engine inside the image,
builds the frontend, bundles the server, and ships a slim non-root runtime
with a healthcheck. Compose enables an init process. Quickest path:

    # .env next to docker-compose.yml (see the comment inside it for keys)
    docker compose up -d --build

Or plain Docker:

    docker build \
      --build-arg VITE_SUPABASE_URL=https://YOURPROJECT.supabase.co \
      --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
      -t kentro-draught .
    docker run -d --init -p 3000:3000 --env-file .env \
      --mount type=volume,source=kentro_game_data,target=/app/data kentro-draught

Frontend keys (`VITE_*`) are build-time (Vite bakes them into the bundle;
they're the publishable, RLS-protected values). Server secrets
(`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, optional `SUPABASE_DB_URL` for
explicitly opted-in migration, optional `BOOTSTRAP_ADMIN_UID`) are runtime
env vars. On Hugging Face Docker Spaces, add all of them under Settings →
Variables and secrets. Define the public `VITE_*` pair as build variables;
the Dockerfile reads them as build args. Private server values belong in
runtime secrets, never frontend build args. Persistent storage must be
configured separately on the host; the plain Docker volume above is local
to that Docker daemon.

## Nearby Offline Multiplayer (Wi-Fi / hotspot)

The Home Lobby and Online Game Hub now offer **Play Nearby Offline** in
addition to normal online multiplayer. Each player loads/installs the PWA
while online once, then connects to the same Wi-Fi/hotspot. **Host Game**
produces an invite code, **Join Game** produces a reply code, and the
host pastes that reply to establish a direct, server-free WebRTC data channel.
Share the two codes via Nearby Share / Quick Share / AirDrop (or clipboard).
Web browsers cannot host a discoverable Bluetooth game or fully automate
local device pairing without a signaling service; this explicit exchange
is necessary to avoid depending on the internet. See
`docs/OFFLINE_NEARBY_TESTING.md` for steps, offline limits, and the device
acceptance checklist. No coins, online ratings, or cloud results are touched.


## Guest Mode (2026-10-11)

The sign-in screen now offers **Continue as Guest**, including WhatsApp invitees.
Guests can browse the app and play **three started AI games** plus **one
started online game** on a stable per-browser guest identity. The top banner
shows remaining games and provides a direct Sign In / Register action.

- AI trials are browser-local and counted when Start Match / New Game is pressed;
  existing in-progress AI games may be resumed without consuming another trial.
  Clearing browser site data may reset this client-side allowance; this is a
  product trial, not a tamper-proof device identifier.
- Online trials are enforced on the server when the two-player game begins;
  creating a room does not consume a trial. Reconnecting to that started game
  is allowed. Rematches/new rooms require a real signed-in account.
- Guest online rooms are free single matches; no coin wagers or series.
  Ranked progress, wallets, purchased levels, tournaments and messaging
  require sign-in. Nearby offline play remains available.
- **Production deployment requirement:** Run `supabase/guest_trials.sql` in
  your Supabase SQL editor before enabling online guest matches, and configure
  both `SUPABASE_URL` and server-only `SUPABASE_SECRET_KEY`. The server uses
  atomic `claim_guest_online_games` RPC to protect quota under concurrency and
  does **not** grant another game when the configured DB is unavailable.
  Local development without Supabase uses only process-local counters, which
  reset on server restart. Live migration and two-phone tests are still needed.
- Verify with `npm test` and `npm run build`, then test guest invite joining,
  remaining quota after refresh, reconnect, exhaustion, and account sign-in.

### Kentro TV and Smart Notifications (October 2026)

The existing app now includes live Kentro TV, recorded-game playback, shareable animated highlights, optional short-video export, in-app notifications, friend challenges, tournament reminders/results and optional opt-in Web Push. **Before deployment**, apply `supabase/migrations/20261011_kentro_tv_notifications.sql` and configure VAPID on the server if background push is desired. See [the complete setup and two-device testing guide](docs/KENTRO_TV_SMART_NOTIFICATIONS.md). No core draughts rule changes are required.

## Royal Nigerian Board (October 2026)

The default **Royal Nigerian Wood** board now uses the reference-matched bold timber frame,
cream-and-walnut squares, and larger ringed black/gold pieces. This affects the live game,
nearby offline mode, and Kentro TV replay without changing Nigerian rules or the engine.
See [`docs/ROYAL_NIGERIAN_BOARD.md`](docs/ROYAL_NIGERIAN_BOARD.md) for assets and testing.

## 2026 Product UX redesign

This package contains the full Kentro 2026 mobile-first interface overhaul, including new app navigation, home dashboard, guest-first entry, compact online-match setup, focused in-game board toolbar, updated Kentro TV, and shared styling across the remaining experiences. See [docs/PRODUCT_REDESIGN_2026.md](docs/PRODUCT_REDESIGN_2026.md) for file details, implementation decisions, and required live regression tests. It does **not** change the 10×10 Nigerian game rules or require a new database migration.

## October 13, 2026 screen-by-screen review

See `docs/SCREEN_BY_SCREEN_REVIEW_2026-10-13.md` for the 37-screen audit, applied fixes, verification evidence, remaining live-device tests, and release blockers. Run `node --experimental-strip-types scripts/screen-audit-smoke.mjs` for the focused regression checks (Node 22.16+).
