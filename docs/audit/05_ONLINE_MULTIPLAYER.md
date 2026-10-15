# Online multiplayer — 15 October 2026

The server owns move legality, turns, clocks, rooms, session identity, guest
admission, series and terminal results. Client clocks/boards/results cannot
replace canonical state. Actual socket, browser, subprocess and production
container checks are recorded in report 13.

## Recovery and reliability repairs

`DurableState` stores versioned, checksummed JSON with private permissions,
file fsync, atomic rename and parent-directory fsync. A PID lock rejects a
second live writer. Lost/stale locks can be reclaimed after process death;
a closed writer cannot mutate a new owner's state. Corrupt/oversized snapshots
fail startup and remain available for diagnosis. Storage failures fail readiness
and stop further room commands rather than acknowledging unpersisted changes.

Rooms, canonical boards/history, clocks, seats, private resume tokens, guest
quotas, series and offers checkpoint before room acknowledgement. Read-only
messages reserve sequence ranges so numbers remain monotonic after restart.
A one-second heartbeat bounds crash clock rollback; orderly shutdown saves
remaining time. Recovery validates replayed history against the saved board,
freezes outage time, restores disconnected seats and grants a fresh 120-second
reconnect window. Clocks resume only after both seats return. Spectators must
rejoin and private rooms deny spectators independently.

Production regular accounts still require genuine verified Auth and canonical
UID binding; a saved resume token does not bypass account authorization. Guests
use private random resume tokens. Wrong tokens cannot reclaim a name. Local
quota use persists; configured production quotas use the existing atomic RPC.

Terminal metadata survives restart for idempotent archive/tournament sync and
pending pot settlement retries. A rematch clears the previous terminal result,
uses a fresh game identity and cannot accidentally recover as the prior draw.
Tournament rematches come from the worker. Already seated players cannot occupy
another active game without finishing/leaving the current one. Room capacity
is bounded to the supported recovery limit of 1,000.

Two-party draw/resignation semantics remain. Unanswered offers now expire after
30 seconds, cancel the dialog and resume the canonical clock. An already expired
clock resolves before an offer/disconnect can pause it. Regression checks cover
elapsed time once, accepted-move increments once, disconnect pauses, both absent
players drawing rather than inventing a winner, async pricing/debit races,
refund identity, rematch pot generations and a broken recipient socket.

## Executed evidence and limits

`npm run test:restart` kills the actual child process during a private game,
restarts it, rejects the wrong token, reclaims both real seats, compares history,
continues legal play, agrees a draw, starts a rematch and kills/restarts again to
check stale terminal state is absent. It then verifies SIGTERM and mode 0600.

The container smoke additionally kills/restarts an active production guest game
on its persistent volume, reclaims tokens, continues to an agreed draw, checks
archive restoration and orderly shutdown. No hosted Auth/financial behavior is
claimed. The 26-stage loopback socket suite and two-browser PvP exercise actual
room commands; media transport is explicitly skipped in that browser journey.

Operate one Node writer per directory. These files do not support horizontal
replicas, distributed locks or zero-loss failover. Consistent backups must include
rooms, outbox, archives and counters; snapshots contain bearer credentials.
Archive retention remains 500 games/200 series locally. Genuine hosted result/
rating synchronization, proxy/mobile timing and capacity require staging tests.
