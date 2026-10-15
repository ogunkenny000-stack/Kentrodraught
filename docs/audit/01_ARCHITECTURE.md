# Architecture audit — 14 October 2026

Scope: the existing `codex-audit-recovery-20261014` checkout, originally at
`090e8d9c2ceac66c309e0d8179cfeb8172c3d546`. No production deployment or live-data
mutation is part of this audit. The machine initially had no Supabase, VAPID,
Gemini, or database credential bindings. No callable Supabase connector is
available in this chat; access elsewhere does not establish access here.

## Confirmed structure

| Layer | Entry points | Responsibilities |
| --- | --- | --- |
| React 19 / Vite 6 | `index.html`, `src/main.tsx`, `src/App.tsx` | Auth/guest startup, state ownership, navigation, game/arena/TV/nearby/social/admin views |
| Frontend services | `src/supabase.ts`, `src/apiClient.ts`, `src/lib/*` | Supabase account/data/realtime access, HTTP APIs, guest storage, sockets, calls, analysis, notifications |
| Express / WebSocket | `server.ts`, `src/server/onlinePlay.ts` | Engine bridge, wallet/admin/puzzles/notifications endpoints, room lifecycle and authoritative moves/clocks |
| Shared rules | `src/gameLogic.ts`, `src/server/gameEnd.ts` | Nigerian board numbering, legal moves/captures, promotion and adjudication |
| Native engine | `nd_upgraded/main.cpp`, `hub.cpp`, `gen.cpp`, `search.cpp`, `pos.cpp` | SCAN-derived C++ search through HUB stdin/stdout; compiled by `scripts/build-engine.cjs` |
| PostgreSQL / Supabase | `supabase/schema.sql`, SQL migrations | Profiles, history, social/chat, wallet, tournaments, notification subscriptions and access policies |
| Nearby | `src/components/game/OfflineNearby.tsx`, `src/lib/offlineMatch.ts` | Manual offer/answer pairing and WebRTC data channels, host-only local ICE, independently checked moves |
| PWA / pushes | `public/sw.js`, `src/server/webPush.ts`, `src/server/notifications.ts` | Offline cache, notification clicks, VAPID/encrypted HTTPS delivery, reminders |
| Optional Go edge | `go-edge/main.go` | Reverse proxy/static asset delivery; not needed for standard development or automatically enabled |
| Deployment | `Dockerfile`, `docker-compose.yml`, README Space metadata | Node 22 Docker build/runtime; persistent WebSocket-capable host required |

The checkout's actual `src/lib/kenEngine.ts` calls the native engine over
`/api/engine/move`. The older README describes an offline TypeScript worker
that is absent from this recovery branch. Do not assume offline AI exists.

## Match authority and persistence

The server owns live rooms in an in-memory `Map`, legal move selection, turns,
sequence numbers, clocks, guest admission, completion and rematch state.
The frontend receives snapshots through `src/lib/gameSocket.ts` and reduces
them with `roomState.ts`; reported client clocks/results are not authoritative.
`gameRecordsManager.ts` assigns game codes and writes local JSON records under
`data/`; Supabase integration also stores application history. A genuine rematch
has a separate game identity. Restarting a process does not restore live rooms;
deployment must drain matches rather than promise restart recovery.

Nearby gameplay does not use the Node server after pairing. It shares rules
with online play, checks packet sequence and position fingerprints, and keeps
unrated results locally. Two physical phones/hotspots are still required to
establish device-level interoperability.

## Background work and integrations

Native searches are serialized through the engine request/mutex layer. Room
heartbeat/expiry, JSON persistence, notification reminders and pending pushes
run on timers. Browser integrations include local/session storage, Supabase
realtime, WebRTC voice/video/nearby, service workers, media recording and optional
Gemini analysis. Browser layouts and data-backed behavior require separate
evidence; rendering a signed-in fixture is not authentication verification.

## Inventory and risks

`node scripts/audit-inventory.mjs` regenerates `inventory.json`, listing component
and library files, HTTP routes, WebSocket commands, SQL tables/migrations,
environment-variable names, tests, native sources and deployment files. It reads
source declarations rather than secret/environment values.

Confirmed findings and repairs are recorded in the numbered reports. Principal
risks include user-writable profile identifiers crossing authorization boundaries,
wide database write policies, multiple history persistence paths, differences
between native and shared rules, an oversized frontend state owner, and live
room state that does not survive server restart. Static review alone cannot
verify deployed policies, account lifecycle, real pushes, or production hosting.
