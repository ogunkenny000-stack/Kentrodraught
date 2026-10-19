# Depth 30, premoves and earned Ken levels — 20 October 2026 (Lagos)

## Analysis

Analysis Lab defaults to depth 30. Full-game reviews request depth 30 for every
non-terminal position and no longer stop after the previous half-second budget.
The browser adapter selects a depth-limited search without the short time cutoff;
all original search logic, evaluation weights and Nigerian rules are retained.
Completed evaluations are reused by position/depth/time/evaluation mode, with bounded
caches. Terminal positions use the rules result directly.

Moves offers pause/resume for full-game review. Full reviews do not run while playing
an analysis practice game. Switching the game/root or leaving Analysis cancels obsolete
work. Quick/5/15-second live-position modes remain available, but do not lower the full
review's depth target. Actual depth is shown; an incomplete fixed-depth review is never
presented as a completed depth-30 result. Slow devices/complex positions can take minutes
per position; a 30-minute watchdog and retry protect against an unresponsive worker.
Depth 30 is a finite search, not a guarantee of perfect draughts.

## Premove and connections

Premoves now apply to the exact board and turn produced by the opponent's move.
Incoming deltas advance a synchronous board reference and move counter before the queued
move runs. The queue is consumed once, without a delayed callback carrying an old render.
Invalidated moves are discarded; ambiguous capture routes require the player's choice.
Disconnected moves are refused rather than silently replayed later.

Reconnect retries begin at 250 ms and back off to a maximum of 5 seconds with jitter.
A stalled transport or login is retried after 8 seconds. Heartbeats run every 5 seconds;
foreground/network wake recovery remains immediate. These changes improve recovery but
cannot eliminate Internet outages, hosting cold starts or third-party service failures.

## Ken progression

For eligible signed-in, verified normal-game wins, beating 2 permits 3, beating 3 earns
4, then 4→5→6→7→8. The first three levels remain available as before; no earned unlock
charges coins. There is no level 9. Analysis/custom practice and assisted wins retain
their existing non-ranked eligibility rules.

Eligible victories now save automatically, even if the player does not press Next.
Next and the automatic save share an idempotent server claim. Network failures retain
account-scoped pending receipts (moves and server attestations, no login token) for retry
when that account reconnects/reopens the app. Receipts are still verified by the server;
no unverified local win can grant an entitlement. Existing proof expiration applies.

## Checks completed

- TypeScript and 555 unit tests passed.
- Real browser WASM review completed depth 30 and graded a complete legal short game.
- Desktop/mobile Analysis: depth-30 default, quick option, pause, custom roots, replay,
  import, engine failure/retry and responsive layout passed.
- Two-browser PvP: actual queued premove matched both boards with no rejection; clocks,
  reconnection, resignation and rematch passed. Media transport explicitly skipped.
- Frontend browser regression passed, including mobile layouts and guest limits.
- Disposable PostgreSQL: free progression from wins at levels 2 through 7, replay safety,
  unchanged wallet/ledger balances, and all financial concurrency tests passed.
- Signed complete-game proofs for both human colors at levels 2–7 passed; tampered,
  missing and expired proofs remain rejected. Multiplayer and restart suites passed.
- Production build retains the original Supabase public bindings and existing safety gates.

No real user data or hosted configuration was changed. The original upgraded Supabase
schema already supports these unlocks; no new migration is required. The updated source
and packaged build must be deployed through hosting for these app changes to become live.
