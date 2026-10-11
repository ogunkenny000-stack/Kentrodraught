---
title: Kentro Draught
emoji: 👑
colorFrom: yellow
colorTo: gray
sdk: docker
app_port: 3000
pinned: false
---

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
4. **`BOOTSTRAP_ADMIN_USERNAME`** (required to ever access the admin panel)
   — set to your own in-app username. You must have played at least one
   game with that username first (creates the `profiles` row the bootstrap
   binds to). See `server.ts`'s startup bootstrap logic.

The Dockerfile expects `draught_com.zip` and `Dockerfile` side by side and
un-zips the app itself during the build — see the comment at the top of the
Dockerfile for the exact expected layout.

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
with tini and a healthcheck. Quickest path:

    # .env next to docker-compose.yml (see the comment inside it for keys)
    docker compose up -d --build

Or plain Docker:

    docker build \
      --build-arg VITE_SUPABASE_URL=https://YOURPROJECT.supabase.co \
      --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
      -t kentro-draught .
    docker run -d -p 3000:3000 --env-file .env kentro-draught

Frontend keys (`VITE_*`) are build-time (Vite bakes them into the bundle;
they're the publishable, RLS-protected values). Server secrets
(`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, optional `SUPABASE_DB_URL` for
boot-time auto-migration, optional `BOOTSTRAP_ADMIN_USERNAME`) are runtime
env vars. On Hugging Face Docker Spaces, add all of them under Settings →
Variables and secrets — the `VITE_*` pair arrives via BuildKit secrets,
which this Dockerfile also accepts.
