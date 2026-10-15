# Online multiplayer audit — 2026-10-14

The authoritative WebSocket room lifecycle was reviewed and exercised on the
recovery branch. The first real socket smoke run reproduced a missing consent
step: `join-room` started the match immediately, while the application waited
for `room-preview`. The repaired server previews terms without seating a player,
debiting coins, consuming a trial, or leaving their current match. Only explicit
acceptance admits a new player.

## Repairs

| Defect | Resulting behavior | Evidence |
| --- | --- | --- |
| Missing room-preview handshake | Preview and acceptance are separate, with current server pricing | Regression plus real socket smoke |
| Seated player could send leave-spectate, erase room membership, then create a second game without forfeiting | Spectator departure only clears actual spectator membership; switching from a live seat forfeits normally | Regression |
| Guest entitlement check finished after its socket closed or another player filled the room | Create/join rechecks socket identity, room membership, room existence and phase after awaits | Three asynchronous regressions |
| New player could join an ended room and reuse its previous pot or record | Fresh admissions require lobby phase; token seat recovery still works | Regression |
| Every room was discoverable and spectatable | Optional private rooms stay out of lobby/TV lists and reject watch requests even with a known code | Regression and real socket smoke |
| Spectators disappeared permanently on disconnect despite the reconnect contract | Token reconnect within two minutes restores a public spectator's full board/clock/history | Regression and real socket smoke |
| Slow result persistence could notify a later rematch code | Notification uses the completed game's captured code | Delayed-promise regression |
| Duplicate record completion could overwrite the first result/time | First terminal result remains authoritative; duplicate summaries do not inflate series totals | Persistence regression |
| Crown setup record kept the ordinary opening | Actual crowned opening is captured before the first move, copied, and persisted in replay metadata | Persistence regression; rule replay logic reviewed |
| Private results lacked participant authorization metadata | Records store privacy and verified participant UIDs; public recent lists exclude private games | Persistence regression; HTTP/RLS coordinated with security audit |
| Prototype-named players broke series-score dictionaries | Score maps use null prototypes and own-key membership | Series regression |
| Server shutdown left transport timers and risked disconnect adjudication | Shutdown cancels transport/session/room timers and closes clients without declaring results | Regression; production shutdown coordinated with deployment audit |
| Guest storage reads could throw or a missing store could report an AI claim as saved | Reads are guarded, transient identity is stable, missing storage refuses an AI allowance claim | Browser utility regressions |

Clock checks also cover expiration before draw/resign dialogs or disconnect can
pause it, elapsed time charged once, increment awarded once per accepted move,
no moves/increments during opponent disconnect, untimed play, and a both-player
disconnect ending as one draw after both grace periods expire. Existing tests
cover roster changes during asynchronous pricing/debit, refunding the original
payers, old settlement completions not marking a rematch pot settled, and a
broken recipient not preventing the other player or record from receiving a
result. The server ignores client clock values and validates move legality.

## Executed validation

- `vitest run src/server/onlinePlay.regression.test.ts src/server/serverReliability.test.ts src/server/gameRecordsManager.test.ts src/lib/guestTrial.test.ts`: **48 tests passed**.
- `tsc --noEmit`: **passed** at integration of these changes; final repository checks are recorded in the audit overview.
- `SMOKE_URL=ws://localhost:8124 tsx scripts/pvp-smoke.ts`: **all 26 stages passed**, including guest exhaustion, private discovery/watch/resync denial, spectator reconnect and unauthorized move denial.
- The socket test used the real `attachOnlinePlay` module and real `ws` clients,
  with an isolated fixture HTTP server, process cwd `/tmp/kentro-online-audit`,
  coins disabled and Supabase credentials unset. Records and sequences were
  written only to that temporary fixture directory. No live database was used.
- A race in the smoke harness's second-move waiter was corrected: it now waits
  specifically for move index 2, so recipient delivery order cannot mistake
  White's first move for Black's reply. Expired waiters are removed and socket
  connection attempts have a timeout.

## Scope and remaining release checks

These results establish local authority, protocol correctness, race handling,
and isolation. They do not establish production account access, paid wallet
settlement, private-record database policies, mobile reconnect timing, or remote
notification delivery. Those require the configured deployment, authorized test
accounts and the documented recovery SQL migrations. The security audit covers
the new atomic paid-pot settlement and privacy row policies.

Private rooms currently deny all spectators; there is no per-viewer invitation
or consent workflow. Legacy clients default to public rooms. Room state and
local guest quotas are process memory: a server restart ends active transports
and resets local-only guest usage. Production guest quotas use the durable
atomic database RPC. A disconnect during an already dispatched guest quota claim
can consume the trial without starting a board; admission fails closed and does
not provide a second allowance.

Draw and resignation offers preserve the product's existing two-party semantics
and pause clocks pending an answer. A peer can leave an offer unanswered;
changing that policy requires a product decision about offer timeouts. No
unsupported transport, alternate board, or rules engine was added.
