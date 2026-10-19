# Online play protocol v2 (server <-> client contract)

This is the contract both sides implement. Existing message names and fields
are KEPT; v2 only adds fields/messages and tightens rules. Anything not
mentioned here keeps its current behaviour.

Shared TypeScript types live in `src/shared/protocol.ts` (import from both
`server.ts` and the client).

## 1. Identity and sessions

- Client -> `login { username, sessionToken?, accessToken? }`
  - `sessionToken`: the token this client got from a previous `login-success`
    (client stores it in `sessionStorage` under `kd.session.<username>`).
  - `accessToken`: Supabase access token, required for account usernames when
    both `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are configured. The verified
    account's metadata username must match the requested name. Anonymous
    clients use the reserved `KGuest_<20 lowercase hex digits>` format.
- Server -> `login-success { username, sessionToken, serverNow, onlineUsers }`
  - `sessionToken`: 32-hex random string, minted on first login, reused on
    reconnect when the client presents a matching token.
- Rules:
  - A username that is currently online on another live socket can only be
    taken over by presenting its matching `sessionToken`, or a verified
    account UID matching the session's bound account; the old socket then
    receives `session-replaced {}` and is closed. Without the token the server
    answers `error { code: "name-taken", message }` and the socket stays
    logged out.
  - Reconnecting to a seat in a room (disconnect grace) REQUIRES the matching
    token or matching verified account UID. Same-username login without either is refused with `name-taken` while
    the seat is in grace.
  - Sessions expire 30 minutes after their last socket closes.
    A live game or unfinished series keeps the session until its seat is resolved.

## 2. Errors

- Server -> `error { code, message, context? }` for any refused action.
  Codes used: `name-taken`, `not-logged-in`, `invalid-payload`, `rate-limited`,
  `room-not-found`, `room-full`, `not-in-room`, `wrong-phase`,
  `game-in-progress`, `not-your-turn`, `illegal-move`, `busy`.
- The client MUST handle `error` (toast + clear any pending create/join flag)
  and the existing `chat-error`.

## 3. Room phases and state version

- Client -> `create-room { gameTime?, increment?, specialRule?, bestOf?, private? }`.
  `private` is an optional boolean, default `false`. Private lobbies and live
  games never appear in public room lists; `spectate-room` is refused for a
  private game even when its code is known. A room code still permits a player
  to request the match preview and explicitly accept an open seat.
- Client -> `join-room { roomId }` returns `room-preview` with the host, time
  controls, rule, series length, privacy, wager, and authoritative `entryFee`.
  Previewing never seats the client, charges coins, claims a guest trial, or
  forfeits another room. `join-room-accept { roomId }` performs admission and
  starts the match; a fresh player can only join a lobby. Already seated
  clients may replay join messages to restore their own room state.
- `phase: "lobby" | "setup" | "playing" | "ended"` is included in every
  `room-info`, `room-rejoined`, `game-started`, `game-ended`, `spectate-joined`.
  - `private` is also included in room-info, room-rejoined and game-started.
  - lobby: waiting for opponent / ready.  setup: crown-crown placement etc.
  - playing: clocks may run.  ended: result known, rematch/reset allowed.
- `seq` (integer, per room, starts at 1, +1 on EVERY mutation of room or game
  state) is included in every message sent with `sendToRoom` and in every
  direct room message (`room-rejoined`, `spectate-joined`, `move-rejected`,
  `opponent-moved`). Client rule: keep `lastSeq` per room; ignore
  state-carrying messages whose `seq < lastSeq` (stale); on a `move-made`
  whose `moveIndex` is not the next expected index send `resync { roomId }`;
  the reply is `opponent-moved { gameState, clock, seq, phase }` (full state).
- Phase gates (server enforces, answers `error { code: "wrong-phase" }`):
  - `make-move`, `offer-draw`, `resign`, `focus-lost/regained`: playing only.
  - `place-starting-king`, `remove-front-row-piece`: setup only.
  - `game-reset`, `rematch-request`, `rematch-response`, `rematch-cancel`: ended only.
    (Pressing "New game" during `playing` is refused with `game-in-progress`;
    the client must offer "Resign" instead.)
  - `ready`, `start-game`, `set-clock`: lobby only.

## 4. Server-authoritative clocks

- Shared type `ClockState` (see protocol.ts):
  `{ whiteMs, blackMs, running: "W" | "B" | null, turnStartedAt, serverNow, incrementMs }`
  - `whiteMs/blackMs`: remaining ms AS OF `turnStartedAt` for the running
    side (the other side's value is exact).
  - `running`: whose clock is ticking, `null` when paused (setup phase,
    pending draw/resign dialog, a player disconnected, game ended, untimed).
  - `turnStartedAt`/`serverNow`: server epoch ms. Client displays
    `remaining = whiteMs - max(0, (now + offset) - turnStartedAt)` for the
    running side, where `offset = serverNow - Date.now()` at receipt.
- `clock` is included in: `game-started`, `move-made`, `opponent-moved`,
  `room-info`, `room-rejoined`, `spectate-joined`, `game-ended`,
  `draw-offered`, `draw-declined`, `draw-cancelled`, `resign-requested`,
  `resign-declined`, `resign-cancelled`, `opponent-disconnected`,
  `opponent-reconnected`, `opponent-away`, `opponent-back`.
- Legacy `whiteTime`/`blackTime` (whole seconds) stay present in
  `gameState` and `move-made` for compatibility, derived from the clock.
- Client -> `make-move { move }`. Any `whiteTime/blackTime` sent by the
  client is IGNORED. The server deducts elapsed time from the mover, adds
  `incrementMs`, switches `running`, and re-arms a per-room flag timer.
- On flag the server ends the game itself:
  `game-ended { reason: "timeout", winnerColor, statusMessage, clock, phase: "ended", seq }`
  and routes it through the normal result/settlement funnel. The client never
  declares a flag on its own; it may show 0:00 while waiting.
- Untimed games: `running` is `null` always, `whiteMs/blackMs` = 0.
- `clockLimitType` is derived server-side from `gameTime` at room creation
  (<=5 Blitz, <=15 Rapid, else Classical; 0 = Untimed). `set-clock` only in lobby.

## 5. Heartbeat / time sync

- Client -> `ping { t }` every 15 s; server -> `pong { t, serverNow }`.
  Client reconnects after 2 missed pongs and refreshes `offset` from each pong.
- Server sends ws-level pings every 20 s and terminates after three missed
  heartbeats. Receiving a message or a pong marks that socket alive.

## 6. Reconnect / resync

- After a successful `login` with a token whose user has a seat in a room
  (playing or lobby) the server sends `room-rejoined` with the FULL
  `room-info` shape plus: `clock`, `phase`, `seq`, `yourColor`,
  `pendingOffer: { type: "draw" | "resign" | "rematch", from } | null`,
  `chatTail: [{ from, text, ts }]` (last 50), `opponentConnected: boolean`.
  A public spectator who reconnects with their token within two minutes gets
  `spectate-joined` with the same extras. Private games never admit spectators.
- The client applies `room-rejoined` through the same path as `room-info`
  + clock, then resumes.

## 7. Leaving / abandoning

- One server function `abandonRoom(ws, reason)` is used for socket close,
  `leave-room`, `create-room`/`join-room-accept` while already seated.
  - During `playing`: socket close = grace (existing behaviour, forfeit timer
    from the server clock: remaining time for timed games, 10 min untimed);
    explicit `leave-room`/joining elsewhere = immediate forfeit (whole
    series) through the settlement funnel.
  - A `leave-room` from someone who is only a spectator is treated as
    `leave-spectate` and never touches the game.
- Both players disconnected during `playing`: game is abandoned as a draw
  (pot refunded) once BOTH grace timers expire; if one returns first the
  other's timer keeps running.
- Client shows a confirmation before `leave-room` during `playing`
  ("You will forfeit this game").

## 8. Rematch (existing messages, now wired)

- Client -> `rematch-request` (phase ended) ; server -> opponent
  `rematch-requested { from }`.
- Client -> `rematch-response { accept }` ; server -> requester
  `rematch-declined { from }` or, on accept, resets the room (colors swapped,
  fresh series) and sends `room-info` then `game-started` to both.
- Client -> `rematch-cancel` ; server -> opponent `rematch-cancelled`.
- If the opponent is gone the server answers `error { code: "not-in-room" }`.
- `game-reset` remains for backwards compatibility (ended only) and behaves
  like an accepted rematch.

## 9. Validation and limits (server)

- `new WebSocketServer({ server, maxPayload: 64 * 1024 })`.
- Per-type payload validation before handling; violations -> `error
  { code: "invalid-payload" }`. Move shape: `{ from: int, to: int, caps: int[] }`
  (plus whatever fields the current Move type has; validate types).
- `roomId` <= 10 chars, `emoji` <= 8 chars, chat <= 500 chars (existing).
- Rate limits: keep existing; on hit answer `error { code: "rate-limited" }`
  instead of dropping silently.
- Broadcasts of `online-users-update` / `open-rooms-list` are coalesced into
  at most one per second and sent only to sockets not in a `playing` room.

## 10. Calls (voice/video) — server relay rules

- Server keeps `activeCalls: Map<username, { peer, startedAt }>`.
- `call-request`/`voice-call-request { to, ... }`:
  - if either party is in `activeCalls` -> reply to sender
    `call-busy { from: to }` (or `voice-call-busy`) and do not relay;
  - relayed only when sender and `to` are the two players of the same room,
    OR both are room-less (lounge call). Spectators can never send or
    receive call signalling.
  - pending requests expire after 40 s (server sends `call-cancel` to the
    callee and `call-unavailable` to the caller).
- All other `call-*`/`voice-*` messages are relayed only between the two
  parties of the active call (or the pending request).
- New client message `call-end { to, reason }` with reason in
  `"hangup" | "ice-failed" | "timeout" | "busy" | "peer-disconnected"`;
  server clears `activeCalls` for both and relays.
- If a party's socket closes and is not re-attached within 5 s, the server
  sends `call-end { from, reason: "peer-disconnected" }` to the peer and
  clears the call.
- Signalling for a peer whose socket is `null` (grace) is buffered for 15 s
  and flushed on rejoin.

## 11. Records and settlement (server internal)

- Each series game gets its own game code (record ids never collide).
- `potSettled` is set only after settlement succeeds; settlement failures are
  logged and retried (3 attempts, backoff) and NEVER block `game-ended`,
  `series-update` or the next series game. Recording failures likewise never
  block game flow. All timer callbacks are wrapped in try/catch.
- Game-end detection evaluates the live board/turn of the room (not a board
  reconstructed from the standard start position).
- Duplicate record starts/completions preserve the first terminal result and
  end timestamp; series totals contain one summary per game code. A delayed
  record completion uses its captured game code for notifications, even if a
  rematch has already begun. Custom and crowned opening positions are stored
  with the record so replay starts from the position actually played.
- Private records retain verified participant UIDs. Public recent-game lists
  exclude them; record/replay HTTP access and database row policies enforce
  participant authorization. Apply the recovery SQL migrations before rollout.
- Guests may play one free single game. Server admission claims both guests'
  allowances atomically; paid rooms, series, resets, and rematches are refused
  for guest participants. A configured database failure fails closed; local
  development without Supabase keeps guest counts in process memory.
- `shutdown()` clears transport/session/room timers and closes sockets with
  code 1012, without declaring winners or initiating new settlement writes.
  In-memory active games do not survive a server restart. Already initiated
  settlement operations retain their existing retry behavior.
