# Online multiplayer audit — continued 2026-10-15

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

## Continuation from the owner's GitHub checkpoint

The 15 October continuation starts at `35bed25`, preserving its private-room,
canonical-authentication and authoritative-rating changes. Older recovered files
were not copied over this checkpoint.

`KENTRO_DATA_DIR` now selects the local record directory; an unset or blank value
retains the historical `./data` location. Configure it before server startup and
mount a writable persistent volume at that exact path. Sequence, archive and
rematch-series JSON files use the same resolved directory, independent of a
later working-directory change. `flushGameRecords()` awaits in-flight writes,
drains mutations made during a write and reports disk errors while keeping dirty
data eligible for retry. The synchronous process-exit fallback uses a separate
temporary filename from asynchronous writes. Atomic renames prevent partial JSON
replacement; this is not an fsync/power-loss guarantee or multi-process storage.

Custom game records now retain both the starting side and final side to move,
including a Black-first position. The server supplies these fields at start and
completion and stores them in existing Supabase replay metadata without a new
schema requirement. Opening/final boards and terminal move histories are copied
so subsequent caller mutations cannot silently change a stored replay. Legacy
rows without first-mover metadata default to White; their final side is inferred
from move parity.

Fresh checks for this continuation:

- `npx vitest run src/server/gameRecordsManager.test.ts src/server/gameRecordsManager.restart.test.ts src/server/onlinePlay.regression.test.ts src/server/serverReliability.test.ts`: **64 tests passed** after the final record changes.
- The real subprocess restart check sends SIGTERM while the two-second write
  debounce is still pending, awaits flushing, then loads the files in a new
  process with a different working directory. It checks private-record exclusion,
  participant metadata, the terminal result, custom Black-first replay, rematch
  scoring and a newer sequence number. Deleting the counter file also recovers
  a safe sequence from saved records. No Supabase credentials are supplied.
- `npx tsx scripts/audit/multiplayer-smoke.ts`: **all 26 real WebSocket stages
  passed** against the actual online-play module and independent `ws` clients.
  This wrapper creates and removes its own temporary data directory, disables
  coins, refuses Supabase credentials and binds only to loopback. The underlying
  smoke client now rejects non-loopback targets. It checks call signalling;
  actual audio/video transport is outside this test.

Completed JSON archives remain a bounded local cache (500 records and 200
series), rather than unlimited archival storage. Hosted persistence and pending
rating synchronization require configured Supabase and staging verification.
The test proves orderly process-restart preservation of these saved files;
active rooms remain in memory and do not resume after a server restart. Volume
mounting, server-level graceful shutdown, container restart and hosted identity
must also be checked through the complete deployment path.
