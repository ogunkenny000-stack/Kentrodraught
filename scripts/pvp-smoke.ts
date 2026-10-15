/**
 * End-to-end PvP smoke test against a RUNNING server (default
 * ws://localhost:8123). Drives real WebSocket clients through the whole
 * multiplayer surface (protocol v2, docs/ONLINE_PLAY_PROTOCOL.md):
 *
 *   room code creation -> join preview -> accept -> legal moves -> chat
 *   -> draw offer/accept (series game) -> two-party resignations
 *   -> automatic next-game start with colour swap -> series completion
 *   -> game-reset (ended only) -> leave-room -> mid-game abandonment
 *   -> live-rooms list + spectate
 *   -> sessions: token, name-taken, takeover (session-replaced)
 *   -> reconnect mid-game with token (room-rejoined + clock/phase/seq)
 *   -> game-reset during playing refused (game-in-progress)
 *   -> spectator leave-room never touches the game
 *   -> resign + series-update WITHOUT Supabase keys
 *   -> server-authoritative flag (game-ended reason "timeout")
 *   -> rematch request / decline / accept flow
 *   -> ping/pong, call-busy relay rule, malformed move, rate limiting
 *
 * Run:  PORT=8123 npx tsx server.ts &
 *       SMOKE_URL=ws://localhost:8123 npx tsx scripts/pvp-smoke.ts
 *
 * Exits 0 with "ALL PVP SMOKE TESTS PASSED" on success; throws on the
 * first failed expectation.
 */
import WebSocket from "ws";
import { randomBytes } from "node:crypto";
import { Board, Move, generateLegalMoves, applyMove } from "../src/gameLogic";

const URL = process.env.SMOKE_URL || "ws://localhost:8123";
const target = new globalThis.URL(URL);
if (!["ws:", "wss:"].includes(target.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) {
  throw new Error("PvP smoke is restricted to a disposable loopback server");
}

type Msg = any;

class Client {
  name: string;
  ws: WebSocket;
  inbox: Msg[] = [];
  waiters: { match: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];
  board: Board = {};
  turn: "W" | "B" = "W";
  color: "W" | "B" | null = null;
  roomId: string | null = null;
  token: string | null = null;
  lastSeq = 0;

  constructor(name: string) {
    this.name = name;
    this.ws = new WebSocket(URL);
    this.ws.on("message", (raw: WebSocket.RawData) => {
      const m = JSON.parse(String(raw));
      // Track board state exactly like the real client does.
      if ((m.type === "game-started" || m.type === "room-rejoined" || m.type === "spectate-joined" || m.type === "opponent-moved") && m.gameState?.board) {
        this.board = m.gameState.board;
        this.turn = m.gameState.turn;
      }
      if (m.type === "move-made" && m.move) {
        this.board = applyMove(this.board, m.move as Move).board;
        this.turn = m.turn;
      }
      if (m.type === "room-info" || m.type === "room-rejoined") {
        this.roomId = m.roomId;
        const me = (m.players || []).find((p: any) => p.username === this.name);
        if (me) this.color = me.color;
      }
      if (m.type === "login-success" && m.sessionToken) this.token = m.sessionToken;
      if (typeof m.seq === "number") this.lastSeq = Math.max(this.lastSeq, m.seq);
      this.inbox.push(m);
      for (let i = 0; i < this.waiters.length; i++) {
        if (this.waiters[i].match(m)) {
          const [w] = this.waiters.splice(i, 1);
          w.resolve(m);
          break;
        }
      }
    });
  }

  send(obj: Msg) { this.ws.send(JSON.stringify(obj)); }

  /** Resolves with the FIRST message (past or future) matching `match`. */
  wait(desc: string, match: (m: Msg) => boolean, timeoutMs = 12000): Promise<Msg> {
    const past = this.inbox.find(match);
    if (past) return Promise.resolve(past);
    return this.waitNext(desc, match, timeoutMs);
  }

  /** Waits only for messages that arrive AFTER this call. */
  waitNext(desc: string, match: (m: Msg) => boolean, timeoutMs = 12000): Promise<Msg> {
    return new Promise((resolve, reject) => {
      const waiter = { match, resolve: (m: Msg) => { clearTimeout(timer); resolve(m); } };
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error(`[${this.name}] timed out waiting for next: ${desc}`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  /** Resolves true if a matching message arrives within `ms`, false otherwise. */
  async arrivesWithin(ms: number, match: (m: Msg) => boolean): Promise<boolean> {
    try {
      await this.waitNext("(optional)", match, ms);
      return true;
    } catch {
      return false;
    }
  }

  clearInbox() { this.inbox = []; }

  legalMoves(): Move[] { return generateLegalMoves(this.board, this.turn); }

  playFirstLegalMove() {
    if (this.color !== this.turn) throw new Error(`[${this.name}] tried to move out of turn`);
    const legal = this.legalMoves();
    if (legal.length === 0) throw new Error(`[${this.name}] no legal moves available`);
    // Legacy clock fields are sent on purpose: the server must IGNORE them.
    this.send({ type: "make-move", move: legal[0], whiteTime: 1, blackTime: 1, statusMessage: "smoke" });
  }

  close() { try { this.ws.close(); } catch {} }
  drop() { try { this.ws.terminate(); } catch {} }
}

function assert(cond: any, msg: string) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openSocket(c: Client) {
  await new Promise<void>((res, rej) => {
    const timer = setTimeout(() => { c.drop(); rej(new Error(`[${c.name}] socket connection timed out`)); }, 12000);
    c.ws.once("open", () => { clearTimeout(timer); res(); });
    c.ws.once("error", (e) => { clearTimeout(timer); rej(e); });
  });
}

/** Logs in and returns the client plus the server's first reply (login-success or error). */
async function connectRaw(name: string, token?: string): Promise<{ c: Client; reply: Msg }> {
  const c = new Client(name);
  await openSocket(c);
  const replyP = c.waitNext("login reply", (m) => m.type === "login-success" || m.type === "error");
  c.send({ type: "login", username: name, ...(token ? { sessionToken: token } : {}) });
  const reply = await replyP;
  return { c, reply };
}

async function connect(name: string, token?: string): Promise<Client> {
  const { c, reply } = await connectRaw(name, token);
  if (reply.type !== "login-success") throw new Error(`[${name}] login failed: ${JSON.stringify(reply)}`);
  assert(typeof reply.sessionToken === "string" && /^[0-9a-f]{32}$/.test(reply.sessionToken), `${name}: login-success carries a 32-hex sessionToken`);
  assert(typeof reply.serverNow === "number", `${name}: login-success carries serverNow`);
  return c;
}

/** Two-party resignation: `loser` asks, `winner` accepts. Resolves with the winner's game-ended. */
async function resign(loser: Client, winner: Client): Promise<Msg> {
  const req = winner.waitNext("resign-requested", (m) => m.type === "resign-requested" && m.from === loser.name);
  loser.send({ type: "resign" });
  await req;
  const ended = winner.waitNext("game-ended (resign)", (m) => m.type === "game-ended" && m.reason === "resign");
  winner.send({ type: "resign-response", accept: true });
  return ended;
}

async function createAndJoin(host: Client, guest: Client, settings: Msg): Promise<{ roomId: string; started: Msg }> {
  const infoP = host.waitNext("room-info after create", (m) => m.type === "room-info" && !!m.roomId && m.phase === "lobby");
  host.send({ type: "create-room", ...settings });
  const info = await infoP;
  const roomId: string = info.roomId;
  const prevP = guest.waitNext("room-preview", (m) => m.type === "room-preview" && m.roomId === roomId);
  guest.send({ type: "join-room", roomId });
  await prevP;
  const startH = host.waitNext("game-started", (m) => m.type === "game-started");
  const startG = guest.waitNext("game-started", (m) => m.type === "game-started");
  guest.send({ type: "join-room-accept", roomId });
  const [started] = await Promise.all([startH, startG]);
  await host.wait("room-info with 2 players", (m) => m.type === "room-info" && m.roomId === roomId && m.players?.length === 2);
  await guest.wait("room-info with 2 players", (m) => m.type === "room-info" && m.roomId === roomId && m.players?.length === 2);
  return { roomId, started };
}

async function leaveBoth(a: Client, b: Client) {
  const la = a.waitNext("left", (m) => m.type === "left-room-success");
  a.send({ type: "leave-room" });
  await la;
  const lb = b.waitNext("left", (m) => m.type === "left-room-success");
  b.send({ type: "leave-room" });
  await lb;
}

async function main() {
  const suffix = Math.floor(Math.random() * 100000);
  let A = await connect(`smokeA${suffix}`);
  let B = await connect(`smokeB${suffix}`);
  const FIVE_MIN = { gameTime: 5, specialRule: "none", hostTime: 5, guestTime: 5, wagerAmount: 0 };

  console.log("\n== 1. Room creation with wager + Best of 3 ==");
  A.send({ type: "create-room", ...FIVE_MIN, bestOf: 3 });
  const roomInfo = await A.wait("room-info after create", (m) => m.type === "room-info" && !!m.roomId);
  assert(typeof roomInfo.roomId === "string" && roomInfo.roomId.length > 0, `room code created: ${roomInfo.roomId}`);
  assert(roomInfo.bestOf === 3, "room-info carries bestOf=3");
  assert(roomInfo.seriesGameNumber === 1, "series starts at game 1");
  assert(roomInfo.phase === "lobby" && typeof roomInfo.seq === "number" && roomInfo.clock, "room-info carries phase, seq and clock");
  assert(roomInfo.clockLimitType === "Blitz", "clockLimitType derived from gameTime (5 min = Blitz)");
  const roomId = roomInfo.roomId;

  console.log("\n== 2. Join preview shows the match terms ==");
  B.send({ type: "join-room", roomId });
  const preview = await B.wait("room-preview", (m) => m.type === "room-preview");
  assert(preview.roomId === roomId, "preview references the right room");
  assert(preview.bestOf === 3, "preview shows Best of 3");
  assert(preview.entryFee === 0, "preview shows FREE entry (wager 0)");

  console.log("\n== 3. Accept -> game 1 starts ==");
  const aStart1 = A.waitNext("game-started", (m) => m.type === "game-started");
  const bStart1 = B.waitNext("game-started", (m) => m.type === "game-started");
  B.send({ type: "join-room-accept", roomId });
  const [gs1a, gs1b] = await Promise.all([aStart1, bStart1]);
  assert(String(gs1a.gameState.statusMessage).startsWith("Game 1 of 3"), `game 1 labelled: "${gs1a.gameState.statusMessage}"`);
  assert(!!gs1b.gameState.board, "both players received the starting board");
  assert(gs1a.phase === "playing" && gs1a.clock?.running === "W" && gs1a.clock.whiteMs === 300000, "game-started carries phase=playing and a running server clock (White, 300000 ms)");
  assert(gs1a.gameState.whiteTime === 300 && gs1a.gameState.blackTime === 300, "legacy whiteTime/blackTime seconds derived from the clock");
  await A.wait("room-info with 2 players", (m) => m.type === "room-info" && (m.players?.length === 2));
  assert(A.color && B.color && A.color !== B.color, `colors assigned: A=${A.color}, B=${B.color}`);
  const game1Colors = { A: A.color, B: B.color };

  console.log("\n== 4. Legal moves relay both ways; client clock values are ignored ==");
  const white1 = A.color === "W" ? A : B;
  const black1 = white1 === A ? B : A;
  const mvSeen = black1.waitNext("move-made", (m) => m.type === "move-made");
  white1.playFirstLegalMove();
  const mm1 = await mvSeen;
  assert(black1.turn === black1.color, "turn passed to Black after White's move");
  assert(mm1.whiteTime > 290 && mm1.clock?.running === "B" && typeof mm1.seq === "number", `move-made ignores client clock (whiteTime=${mm1.whiteTime}), clock now runs for Black, seq=${mm1.seq}`);
  const mvSeen2 = white1.waitNext("move-made 2", (m) => m.type === "move-made" && m.moveIndex === 2);
  black1.playFirstLegalMove();
  const mm2 = await mvSeen2;
  assert(mm2.moveIndex === 2 && mm2.turn === "W", "second move relayed with moveIndex 2");

  console.log("\n== 5. Chat + emoji relay ==");
  const chatSeen = B.waitNext("chat-message", (m) => m.type === "chat-message" && m.text === "gg soon");
  A.send({ type: "chat", text: "gg soon" });
  const chat = await chatSeen;
  assert(chat.from === A.name, "chat relayed with sender name");
  const emojiSeen = B.waitNext("emoji", (m) => m.type === "emoji-reaction" && m.emoji === "🔥");
  A.send({ type: "emoji-reaction", emoji: "🔥", evil: "payload" });
  const em = await emojiSeen;
  assert(em.sender === A.name && em.evil === undefined, "emoji relayed with sender only (no arbitrary fields)");

  console.log("\n== 6. Draw offer -> accept = drawn series game, series continues ==");
  const offerSeen = B.waitNext("draw-offered", (m) => m.type === "draw-offered");
  A.send({ type: "offer-draw" });
  const offer = await offerSeen;
  assert(offer.clock && offer.clock.running === null, "clock pauses while a draw offer is pending");
  const aEnd1 = A.waitNext("game-ended (draw)", (m) => m.type === "game-ended" && m.reason === "draw");
  const aSeries1 = A.waitNext("series-update after draw", (m) => m.type === "series-update");
  B.send({ type: "draw-response", accept: true });
  const end1 = await aEnd1;
  assert(end1.phase === "ended" && end1.clock, "game-ended carries phase=ended and clock");
  const su1 = await aSeries1;
  assert(su1.draws === 1, "draw counted as a played series game");
  assert(su1.seriesOver === false, "series continues after a draw");
  assert(typeof su1.nextGameInMs === "number", "next game scheduled automatically");

  console.log("\n== 7. Auto-start of game 2 with colors SWAPPED ==");
  const aStart2 = A.waitNext("game 2 start", (m) => m.type === "game-started");
  const gs2 = await aStart2;
  await A.wait("room-info for game 2", (m) => m.type === "room-info" && m.seriesGameNumber === 2);
  await B.wait("B room-info for game 2", (m) => m.type === "room-info" && m.seriesGameNumber === 2);
  assert(A.color === (game1Colors.A === "W" ? "B" : "W"), `A's color swapped to ${A.color}`);
  assert(B.color === (game1Colors.B === "W" ? "B" : "W"), `B's color swapped to ${B.color}`);
  assert(gs2.gameCode && gs2.gameCode !== roomId, `series game 2 has its own game code (${gs2.gameCode})`);

  console.log("\n== 8. Resign game 2 (two-party) -> score 1-0, game 3 auto-starts; NO Supabase keys ==");
  const su2p = A.waitNext("series-update after resign", (m) => m.type === "series-update" && (m.score?.[A.name] || 0) >= 1);
  await resign(B, A);
  const su2 = await su2p;
  assert(su2.score[A.name] === 1 && (su2.score[B.name] || 0) === 0, `A leads 1-0 (draws ${su2.draws})`);
  assert(su2.seriesOver === false, "series not over at 1-0 in Bo3 with a draw used");
  await A.waitNext("game 3 start", (m) => m.type === "game-started");
  await A.wait("room-info for game 3", (m) => m.type === "room-info" && m.seriesGameNumber === 3);
  await B.wait("B room-info for game 3", (m) => m.type === "room-info" && m.seriesGameNumber === 3);

  console.log("\n== 9. Resign game 3 -> A wins the series 2-0 ==");
  const su3p = B.waitNext("final series-update", (m) => m.type === "series-update" && m.seriesOver === true);
  await resign(B, A);
  const su3 = await su3p;
  assert(su3.seriesWinner === A.name, `series winner announced: ${su3.seriesWinner}`);
  assert(su3.score[A.name] === 2, "final score 2 wins for A");

  console.log("\n== 10. game-reset (phase ended) resets the series to the lobby ==");
  const resetSeen = B.waitNext("game-reset-by-opponent", (m) => m.type === "game-reset-by-opponent");
  const resetInfo = A.waitNext("room-info after reset", (m) => m.type === "room-info" && m.seriesGameNumber === 1);
  A.send({ type: "game-reset" });
  await resetSeen;
  const ri = await resetInfo;
  assert((ri.seriesScore[A.name] || 0) === 0 && ri.seriesDraws === 0, "series score wiped for the rematch");
  assert(ri.phase === "lobby", "room is back in the lobby phase");

  console.log("\n== 11. Leave-room works cleanly post-series ==");
  const leftOk = B.waitNext("left-room-success", (m) => m.type === "left-room-success");
  const oppGone = A.waitNext("opponent-disconnected", (m) => m.type === "opponent-disconnected");
  B.send({ type: "leave-room" });
  await Promise.all([leftOk, oppGone]);
  assert(true, "leaver acknowledged and opponent notified");
  A.send({ type: "leave-room" });
  await A.waitNext("A left", (m) => m.type === "left-room-success");

  console.log("\n== 12. Mid-game exit forfeits (single game room) ==");
  A.clearInbox(); B.clearInbox();
  const r2 = await createAndJoin(A, B, { ...FIVE_MIN, bestOf: 1 });
  const abandonSeen = A.waitNext("game-ended abandoned", (m) => m.type === "game-ended" && m.reason === "abandoned");
  B.send({ type: "leave-room" });
  const ab = await abandonSeen;
  assert(ab.winnerColor === A.color, "the staying player is awarded the win on abandonment");

  console.log("\n== 13. Live-rooms list + spectate ==");
  A.send({ type: "leave-room" });
  await A.waitNext("A left 2", (m) => m.type === "left-room-success");
  const r3 = await createAndJoin(A, B, { ...FIVE_MIN, bestOf: 1 });
  let S = await connect(`smokeS${suffix}`);
  S.send({ type: "list-live-rooms" });
  const list = await S.wait("live-rooms-list", (m) => m.type === "live-rooms-list");
  assert(list.rooms.some((r: any) => r.roomId === r3.roomId), "live game appears in the live-rooms list");
  S.send({ type: "spectate-room", roomId: r3.roomId });
  const spec = await S.wait("spectate-joined", (m) => m.type === "spectate-joined");
  assert(!!spec.gameState?.board && spec.phase === "playing" && spec.clock && typeof spec.seq === "number", "spectator receives the live board with clock/phase/seq");
  const specMove = S.waitNext("spectated move", (m) => m.type === "move-made");
  (A.color === A.turn ? A : B).playFirstLegalMove();
  await specMove;
  assert(true, "spectator receives live moves in real time");
  const oldSpectator = S;
  oldSpectator.drop(); await sleep(100);
  S = await connect(oldSpectator.name, oldSpectator.token!);
  const specResume = await S.wait("spectator rejoined", (m) => m.type === "spectate-joined");
  assert(specResume.roomId === r3.roomId && specResume.gameState.moveHistory.length === 1,
    "spectator token reconnect restores the full public game without another watch request");
  const specWrite = S.waitNext("spectator action refused", (m) => m.type === "error" && m.code === "not-in-room");
  S.send({ type: "make-move", move: S.legalMoves()[0] }); await specWrite;
  assert(true, "spectator cannot submit player moves");

  console.log("\n== 14. Sessions: duplicate name refused without token, takeover with token ==");
  const dup = await connectRaw(A.name);
  assert(dup.reply.type === "error" && dup.reply.code === "name-taken", "second login with the same name and no token -> error name-taken");
  dup.c.close();
  const replacedP = A.waitNext("session-replaced", (m) => m.type === "session-replaced");
  const oldA = A;
  const take = await connectRaw(A.name, A.token!);
  assert(take.reply.type === "login-success" && take.reply.sessionToken === oldA.token, "login with the matching token succeeds and reuses the token");
  await replacedP;
  assert(true, "old socket received session-replaced");
  A = take.c;
  const rj = await A.wait("room-rejoined after takeover", (m) => m.type === "room-rejoined");
  assert(rj.roomId === r3.roomId && rj.phase === "playing" && typeof rj.seq === "number" && rj.clock && rj.yourColor === oldA.color, `room-rejoined carries roomId/phase/seq/clock/yourColor (${rj.yourColor})`);
  assert(Array.isArray(rj.chatTail) && rj.pendingOffer === null && rj.opponentConnected === true, "room-rejoined carries chatTail, pendingOffer and opponentConnected");
  oldA.close();

  console.log("\n== 15. Reconnect mid-game after a dropped socket (token) ==");
  const discSeen = A.waitNext("opponent-disconnected", (m) => m.type === "opponent-disconnected" && m.username === B.name);
  const oldB = B;
  B.drop();
  const disc = await discSeen;
  assert(disc.clock?.running === null, "clock pauses while the opponent is in disconnect grace");
  const reconSeen = A.waitNext("opponent-reconnected", (m) => m.type === "opponent-reconnected" && m.username === oldB.name);
  B = await connect(oldB.name, oldB.token!);
  const rj2 = await B.wait("room-rejoined", (m) => m.type === "room-rejoined");
  assert(rj2.roomId === r3.roomId && rj2.yourColor === oldB.color && rj2.phase === "playing" && rj2.gameState?.moveHistory?.length === 1, "reconnecting player gets the full room state back");
  const recon = await reconSeen;
  assert(recon.clock?.running === rj2.gameState.turn, "clock resumes for the side to move after reconnect");

  console.log("\n== 16. game-reset during playing is refused ==");
  const gip = A.waitNext("error game-in-progress", (m) => m.type === "error" && m.code === "game-in-progress");
  A.send({ type: "game-reset" });
  await gip;
  assert(true, "error { code: game-in-progress } returned");

  console.log("\n== 17. Spectator leave-room is treated as leave-spectate ==");
  const specLeft = S.waitNext("left-room-success", (m) => m.type === "left-room-success");
  S.send({ type: "leave-room" });
  await specLeft;
  const beforeLen = A.inbox.length;
  const mover = A.color === A.turn ? A : B;
  const other = mover === A ? B : A;
  const moveOk = other.waitNext("move after spectator left", (m) => m.type === "move-made");
  mover.playFirstLegalMove();
  await moveOk;
  assert(!A.inbox.slice(beforeLen).some((m) => m.type === "game-ended"), "the game continued untouched after the spectator left");

  console.log("\n== 18. Resign (two-party) ends a single game without Supabase keys ==");
  const bEnd = B.waitNext("game-ended", (m) => m.type === "game-ended");
  const ended = await resign(B, A);
  assert(ended.winnerColor === A.color && ended.reason === "resign", "resignation awards the game to the opponent");
  await bEnd;
  await leaveBoth(A, B);

  console.log("\n== 19. Server-authoritative flag: 3-second clock ends with reason timeout ==");
  const r4 = await createAndJoin(A, B, { gameTime: 0.05, specialRule: "none", hostTime: 0.05, guestTime: 0.05, wagerAmount: 0, bestOf: 1 });
  assert(r4.started.clock.running === "W" && r4.started.clock.whiteMs === 3000, "3 s clock starts running for White");
  const flagA = A.waitNext("game-ended timeout", (m) => m.type === "game-ended" && m.reason === "timeout", 9000);
  const flagB = B.waitNext("game-ended timeout", (m) => m.type === "game-ended" && m.reason === "timeout", 9000);
  const [flag] = await Promise.all([flagA, flagB]);
  assert(flag.winnerColor === "B" && flag.phase === "ended" && flag.clock.whiteMs === 0, "White flagged: Black wins on time, clock shows 0 ms");

  console.log("\n== 20. Rematch flow: request -> decline, request -> accept (colors swapped) ==");
  const colorsBefore = { A: A.color, B: B.color };
  const waiting = A.waitNext("rematch-waiting", (m) => m.type === "rematch-waiting");
  const requested = B.waitNext("rematch-requested", (m) => m.type === "rematch-requested" && m.from === A.name);
  A.send({ type: "rematch-request" });
  await Promise.all([waiting, requested]);
  const declined = A.waitNext("rematch-declined", (m) => m.type === "rematch-declined");
  B.send({ type: "rematch-response", accept: false });
  await declined;
  assert(true, "decline relayed to the requester");
  const requested2 = A.waitNext("rematch-requested", (m) => m.type === "rematch-requested" && m.from === B.name);
  B.send({ type: "rematch-request" });
  await requested2;
  const accA = A.waitNext("rematch-accepted", (m) => m.type === "rematch-accepted");
  const startA2 = A.waitNext("rematch game-started", (m) => m.type === "game-started");
  const startB2 = B.waitNext("rematch game-started", (m) => m.type === "game-started");
  A.send({ type: "rematch-response", accept: true });
  const [acc, gsA2] = await Promise.all([accA, startA2, startB2]);
  assert(acc.newGameCode && acc.newGameCode !== r4.roomId, `rematch gets a fresh game code (${acc.newGameCode})`);
  await A.wait("room-info rematch", (m) => m.type === "room-info" && m.gameCode === acc.newGameCode);
  assert(A.color === (colorsBefore.A === "W" ? "B" : "W") && B.color === (colorsBefore.B === "W" ? "B" : "W"), "colors swapped for the rematch");
  assert(gsA2.phase === "playing" && gsA2.clock.running === "W", "rematch game started with a running clock");
  await A.waitNext("rematch game flagged", (m) => m.type === "game-ended" && m.reason === "timeout", 9000);
  await leaveBoth(A, B);

  console.log("\n== 21. ping -> pong ==");
  const pong = A.waitNext("pong", (m) => m.type === "pong" && m.t === 12345);
  A.send({ type: "ping", t: 12345 });
  const pg = await pong;
  assert(typeof pg.serverNow === "number", "pong echoes t and carries serverNow");

  console.log("\n== 22. Malformed / illegal moves never crash the server ==");
  const r5 = await createAndJoin(A, B, { ...FIVE_MIN, bestOf: 1 });
  const mover5 = A.color === A.turn ? A : B;
  const other5 = mover5 === A ? B : A;
  const badShape = mover5.waitNext("error invalid-payload", (m) => m.type === "error" && m.code === "invalid-payload");
  mover5.send({ type: "make-move", move: { from: "x" } });
  await badShape;
  assert(true, "move with a malformed shape -> error invalid-payload");
  const noCaps = mover5.waitNext("move-rejected", (m) => m.type === "move-rejected");
  mover5.send({ type: "make-move", move: { from: 25, to: 26 } });
  const rej = await noCaps;
  assert(rej.code === "illegal-move" && !!rej.gameState?.board && typeof rej.seq === "number", "illegal move without caps -> move-rejected with full gameState");
  const wrongTurn = other5.waitNext("move-rejected not-your-turn", (m) => m.type === "move-rejected" && m.code === "not-your-turn");
  other5.send({ type: "make-move", move: { from: 35, to: 30, caps: [] } });
  await wrongTurn;
  assert(true, "out-of-turn move -> move-rejected not-your-turn");
  const stillAlive = other5.waitNext("legal move relayed", (m) => m.type === "move-made");
  mover5.playFirstLegalMove();
  await stillAlive;
  assert(true, "a legal move still relays afterwards (server alive)");
  const rs = A.waitNext("opponent-moved (resync)", (m) => m.type === "opponent-moved");
  A.send({ type: "resync", roomId: r5.roomId });
  const rsm = await rs;
  assert(rsm.gameState?.moveHistory?.length === 1 && rsm.clock && rsm.phase === "playing" && typeof rsm.seq === "number", "resync returns full state with clock/phase/seq");

  console.log("\n== 23. Calls: relay between the two players, call-busy for a third party ==");
  const C = await connect(`smokeC${suffix}`);
  const callSeen = B.waitNext("call-request", (m) => m.type === "call-request" && m.from === A.name);
  A.send({ type: "call-request", to: B.name, video: true });
  await callSeen;
  assert(true, "call-request relayed to the room opponent");
  const busy = C.waitNext("call-busy", (m) => m.type === "call-busy");
  C.send({ type: "call-request", to: A.name });
  const bz = await busy;
  assert(bz.from === A.name, "third party calling a busy user gets call-busy");
  const endSeen = B.waitNext("call-end", (m) => m.type === "call-end" && m.from === A.name);
  A.send({ type: "call-end", to: B.name, reason: "hangup" });
  const ce = await endSeen;
  assert(ce.reason === "hangup", "call-end relayed with reason");
  const unavailable = C.waitNext("call-unavailable", (m) => m.type === "call-unavailable");
  C.send({ type: "call-request", to: A.name });
  await unavailable;
  assert(true, "lounge user cannot call a seated player (call-unavailable)");
  await leaveBoth(A, B);

  console.log("\n== 24. Flooding gets an explicit rate-limited error ==");
  const limited = C.waitNext("error rate-limited", (m) => m.type === "error" && m.code === "rate-limited", 5000);
  for (let i = 0; i < 90; i++) C.send({ type: "ping", t: i });
  await limited;
  assert(true, "error { code: rate-limited } returned instead of a silent drop");
  await sleep(100);

  console.log("\n== 25. Guests receive exactly one free online game ==");
  const G = await connect(`KGuest_${randomBytes(10).toString("hex")}`);
  const guestMatch = await createAndJoin(A, G, { ...FIVE_MIN, bestOf: 1 });
  assert(guestMatch.started.phase === "playing", "guest joins and starts a free single game");
  await resign(G, A);
  const guestRematch = A.waitNext("guest rematch refused", (m) => m.type === "room-error");
  A.send({ type: "rematch-request" }); await guestRematch;
  await leaveBoth(A, G);
  const quotaExhausted = G.waitNext("guest quota exhausted", (m) => m.type === "guest-limit-reached");
  G.send({ type: "create-room", ...FIVE_MIN, bestOf: 3 }); await quotaExhausted;
  assert(true, "guest cannot create another game or play a rematch after completion");
  G.close();

  console.log("\n== 26. Private rooms never appear in discovery and cannot be watched by code ==");
  const P = await connect(`smokePrivate${suffix}`);
  const privateMatch = await createAndJoin(A, B, { ...FIVE_MIN, bestOf: 1, private: true });
  assert(privateMatch.started.private === true, "both players receive the private game flag");
  const privateListP = P.waitNext("private listing", (m) => m.type === "live-rooms-list");
  P.send({ type: "list-live-rooms" }); const privateList = await privateListP;
  assert(!privateList.rooms.some((r: any) => r.roomId === privateMatch.roomId), "private match is absent from Kentro TV discovery");
  const privateDenied = P.waitNext("private spectator rejected", (m) => m.type === "error");
  P.send({ type: "spectate-room", roomId: privateMatch.roomId });
  assert((await privateDenied).code === "busy", "knowing a private room code does not permit spectating");
  const stateDenied = P.waitNext("private resync rejected", (m) => m.type === "error" && m.code === "not-in-room");
  P.send({ type: "resync", roomId: privateMatch.roomId }); await stateDenied;
  assert(true, "unauthorized socket cannot fetch private game state through resync");
  await leaveBoth(A, B); P.close();

  A.close(); B.close(); S.close(); C.close();
  console.log("\n✅ ALL PVP SMOKE TESTS PASSED\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌ SMOKE TEST FAILED:", err.message || err);
  process.exit(1);
});
