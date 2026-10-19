import { EventEmitter } from "node:events";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateLegalMoves, movesAreEquivalent } from "../gameLogic";
import { createClock, resumeClock, untimedClock } from "./roomClock";
import * as guestQuota from "./guestQuota";
const services = vi.hoisted(() => ({ debit: vi.fn(), settle: vi.fn(), refund: vi.fn(), start: vi.fn(), end: vi.fn(), link: vi.fn(), notify: vi.fn(), admin: vi.fn(), seq: 2610000 }));
vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events");
  return { WebSocketServer: class extends EventEmitter { clients = new Set(); close() { this.emit("close"); } } };
});
vi.mock("../../coinsService", () => ({ debitMultipleWallets: services.debit, settleMatchPot: services.settle, refundUnstartedMatch: services.refund }));
vi.mock("../../supabaseAdmin", () => ({ getSupabaseAdmin: services.admin, verifyAccessToken: async () => null }));
vi.mock("./notifications", () => ({ notifyMatchEnded: services.notify }));
vi.mock("./gameRecordsManager", () => ({
  getNextGameCode: () => String(++services.seq), recordGameStart: services.start,
  recordGameEnd: services.end, linkRematch: services.link,
  recordGameStartingPosition: vi.fn(),
}));
import { attachOnlinePlay } from "./onlinePlay";
class FakeSocket extends EventEmitter {
  readyState = 1;
  messages: any[] = [];
  failSend = false;
  send(message: string) { if (this.failSend) throw new Error("broken socket"); this.messages.push(JSON.parse(message)); }
  ping() {}
  close() { if (this.readyState !== 1) return; this.readyState = 3; this.emit("close"); }
  terminate() { this.close(); }
}
const servers: any[] = [];
const settingsValue = { matchRakePercent: 5 };
const microtasks = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
async function send(ws: FakeSocket, payload: any) {
  await Promise.all(ws.listeners("message").map((listener) => listener(Buffer.from(JSON.stringify(payload)))));
}
async function lobby(paid = false, extra: Record<string, unknown> = {}) {
  const settings = vi.fn().mockResolvedValue(settingsValue);
  const server = attachOnlinePlay({} as any, {
    coinsEnabled: paid, getCoinSettings: settings, resolveEntryFee: () => paid ? 10 : 0,
    sanitizeWagerAmount: () => 0, sanitizeBestOf: (value) => typeof value === "number" ? value : 1, sanitizeCustomBoard: () => null,
    findLegalMatch: (board, turn, claimed) => generateLegalMoves(board, turn).find((m) => movesAreEquivalent(m, claimed)) ?? null,
  });
  servers.push(server.wss);
  const connect = async (username: string) => {
    const ws = new FakeSocket(); server.wss.clients.add(ws as any); server.wss.emit("connection", ws);
    await send(ws, { type: "login", username });
    expect(ws.messages.some((m) => m.type === "login-success")).toBe(true);
    return ws;
  };
  const alice = await connect("alice"); const bob = await connect("bob");
  await send(alice, { type: "create-room", gameTime: 1, increment: 2, specialRule: "none", bestOf: 1, ...extra });
  const room: any = [...server.rooms.values()][0];
  expect(room).toBeDefined();
  const join = () => send(bob, { type: "join-room-accept", roomId: room.id });
  return { server, alice, bob, room, settings, join, connect };
}
async function game(paid = false) {
  const f = await lobby(paid); await f.join();
  expect(f.room.phase).toBe("playing");
  f.room.clock = createClock(60000, 60000, 2000, true);
  resumeClock(f.room.clock, f.room.gameState.turn, Date.now());
  return {
    ...f,
    white: f.room.players.find((p: any) => p.color === "W").ws as FakeSocket,
    black: f.room.players.find((p: any) => p.color === "B").ws as FakeSocket,
  };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
  vi.stubEnv("SUPABASE_URL", ""); vi.stubEnv("SUPABASE_SECRET_KEY", "");
  vi.clearAllMocks(); services.seq = 2610000;
  services.admin.mockReset().mockReturnValue(null);
  services.debit.mockReset().mockResolvedValue({ ok: true });
  services.settle.mockReset().mockResolvedValue(undefined);
  services.refund.mockReset().mockResolvedValue({ ok: true, refunded: true });
  services.end.mockReset().mockResolvedValue(undefined);
  services.start.mockReset().mockReturnValue({});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs();
});

describe("guest online trial admission", () => {
  it("lets a guest join one free match but refuses subsequent room creation and rematches", async () => {
    const f = await lobby(false);
    const guest = new FakeSocket();
    f.server.wss.clients.add(guest as any);
    f.server.wss.emit("connection", guest);
    await send(guest, { type: "login", username: "KGuest_0123456789abcdef0909" });
    expect(guest.messages.some(m => m.type === "login-success")).toBe(true);
    await send(guest, { type: "join-room-accept", roomId: f.room.id });
    expect(f.room.phase).toBe("playing");
    expect(guest.messages.some(m => m.type === "game-started")).toBe(true);
    await send(guest, { type: "create-room", gameTime: 5, bestOf: 3, wagerAmount: 100 });
    expect(guest.messages.some(m => m.type === "guest-limit-reached")).toBe(true);
    expect(f.server.rooms.size).toBe(1);
  });
});

describe("configured account identity", () => {
  it.each([
    { mode: "production", url: "", secret: "" },
    { mode: "test", url: "https://fixture.invalid", secret: "" },
    { mode: "test", url: "", secret: "fixture" },
  ])("fails closed for regular accounts when required auth is unavailable %j", async ({ mode, url, secret }) => {
    const f = await lobby();
    vi.stubEnv("NODE_ENV", mode); vi.stubEnv("SUPABASE_URL", url); vi.stubEnv("SUPABASE_SECRET_KEY", secret);
    const account = new FakeSocket(); f.server.wss.clients.add(account as any); f.server.wss.emit("connection", account);
    await send(account, { type: "login", username: "mallory" });
    expect(account.messages.at(-1)).toMatchObject({ type: "error", code: "not-logged-in" });
    await send(account, { type: "login", username: "KGuest_0123456789abcdef0101" });
    expect(account.messages.some(message => message.type === "login-success")).toBe(true);
    expect(services.admin).not.toHaveBeenCalled();
  });
  it("rejects a forged metadata username and binds the canonical profile instead", async () => {
    const f = await lobby();
    vi.stubEnv("SUPABASE_URL", "https://fixture.invalid"); vi.stubEnv("SUPABASE_SECRET_KEY", "fixture");
    const profile = { username: "Mallory", usernameLower: "mallory", ownerId: "uid-mallory", banned: false };
    const eq = vi.fn().mockReturnValue({ maybeSingle: async () => ({ data: profile, error: null }) });
    services.admin.mockReturnValue({ auth: { getUser: async () => ({ data: { user: { id: "uid-mallory", user_metadata: { username: "victim" } } }, error: null }) }, from: () => ({ select: () => ({ eq }) }) });
    const attacker = new FakeSocket(); f.server.wss.clients.add(attacker as any); f.server.wss.emit("connection", attacker);
    await send(attacker, { type: "login", username: "victim", accessToken: "valid-attacker-token" });
    expect(attacker.messages.at(-1)).toMatchObject({ type: "error", code: "not-logged-in" });
    await send(attacker, { type: "login", username: "mallory", accessToken: "valid-attacker-token" });
    expect(attacker.messages.at(-1)).toMatchObject({ type: "login-success", username: "Mallory" });
    expect(eq).toHaveBeenCalledWith("ownerId", "uid-mallory");
  });
  it.each([{ banned: true }, { suspendedUntil: Date.parse("2030-01-01T00:00:00Z") }])("rejects a canonical account with active moderation %j", async (moderation) => {
    const f = await lobby();
    vi.stubEnv("SUPABASE_URL", "https://fixture.invalid"); vi.stubEnv("SUPABASE_SECRET_KEY", "fixture");
    services.admin.mockReturnValue({ auth: { getUser: async () => ({ data: { user: { id: "uid-mallory", user_metadata: { username: "mallory" } } }, error: null }) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { username: "mallory", usernameLower: "mallory", ownerId: "uid-mallory", ...moderation }, error: null }) }) }) }) });
    const attacker = new FakeSocket(); f.server.wss.clients.add(attacker as any); f.server.wss.emit("connection", attacker);
    await send(attacker, { type: "login", username: "mallory", accessToken: "valid-token" });
    expect(attacker.messages.at(-1)).toMatchObject({ type: "error", code: "not-logged-in" });
  });
  it.each([
    { username: "Victim", usernameLower: "mallory" },
    { username: "kentro_house", usernameLower: "kentro_house" },
  ])("rejects an inconsistent or reserved historical profile %j", async (identity) => {
    const f = await lobby();
    vi.stubEnv("SUPABASE_URL", "https://fixture.invalid"); vi.stubEnv("SUPABASE_SECRET_KEY", "fixture");
    const profile = { ...identity, ownerId: "uid-mallory", banned: false };
    services.admin.mockReturnValue({ auth: { getUser: async () => ({ data: { user: { id: "uid-mallory" } }, error: null }) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }) }) }) });
    const attacker = new FakeSocket(); f.server.wss.clients.add(attacker as any); f.server.wss.emit("connection", attacker);
    await send(attacker, { type: "login", username: identity.usernameLower, accessToken: "valid-token" });
    expect(attacker.messages.at(-1)).toMatchObject({ type: "error", code: "not-logged-in" });
    expect(f.server.stats().players).toBe(2);
  });
  it("revokes an active account session and adjudicates its game through disconnect grace", async () => {
    const f = await lobby();
    vi.stubEnv("SUPABASE_URL", "https://fixture.invalid"); vi.stubEnv("SUPABASE_SECRET_KEY", "fixture");
    const profile = { username: "Mallory", usernameLower: "mallory", ownerId: "uid-mallory", banned: false };
    services.admin.mockReturnValue({ auth: { getUser: async () => ({ data: { user: { id: profile.ownerId } }, error: null }) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }) }) }) });
    const account = new FakeSocket(); f.server.wss.clients.add(account as any); f.server.wss.emit("connection", account);
    await send(account, { type: "login", username: "mallory", accessToken: "valid-token" });
    await send(account, { type: "join-room-accept", roomId: f.room.id });
    expect(f.room.phase).toBe("playing");
    expect(f.server.stats().sessions).toBe(3);

    profile.banned = true;
    f.server.revokeUser(profile.ownerId);
    f.server.revokeUser(profile.ownerId);
    expect(account.readyState).toBe(3);
    expect(f.server.stats().sessions).toBe(2);
    expect(f.room.players.find((p: any) => p.key === "mallory").ws).toBeNull();
    await send(account, { type: "create-room", gameTime: 5 });
    expect(f.server.rooms.size).toBe(1);
    await vi.advanceTimersByTimeAsync(60001);
    expect(f.room.phase).toBe("ended");
    expect(services.end).toHaveBeenCalledTimes(1);
    expect(services.end.mock.calls[0][0]).toMatchObject({ winnerUsername: "alice", participantUserIds: [profile.ownerId] });
  });
  it("invalidates a disconnected account's resume token", async () => {
    const f = await lobby();
    vi.stubEnv("SUPABASE_URL", "https://fixture.invalid"); vi.stubEnv("SUPABASE_SECRET_KEY", "fixture");
    const profile = { username: "Mallory", usernameLower: "mallory", ownerId: "uid-mallory", banned: false };
    services.admin.mockReturnValue({ auth: { getUser: async () => ({ data: { user: { id: profile.ownerId } }, error: null }) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }) }) }) });
    const account = new FakeSocket(); f.server.wss.clients.add(account as any); f.server.wss.emit("connection", account);
    await send(account, { type: "login", username: "mallory", accessToken: "valid-token" });
    account.close();
    expect(f.server.stats().sessions).toBe(3);
    f.server.revokeUser(profile.ownerId);
    expect(f.server.stats().sessions).toBe(2);
  });
  it("rejects a login whose active-profile lookup completed after revocation", async () => {
    const f = await lobby();
    vi.stubEnv("SUPABASE_URL", "https://fixture.invalid"); vi.stubEnv("SUPABASE_SECRET_KEY", "fixture");
    const lookup = deferred<any>();
    services.admin.mockReturnValue({ auth: { getUser: async () => ({ data: { user: { id: "uid-mallory" } }, error: null }) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => lookup.promise }) }) }) });
    const account = new FakeSocket(); f.server.wss.clients.add(account as any); f.server.wss.emit("connection", account);
    const login = send(account, { type: "login", username: "mallory", accessToken: "valid-token" });
    await microtasks();
    f.server.revokeUser("uid-mallory");
    lookup.resolve({ data: { username: "Mallory", usernameLower: "mallory", ownerId: "uid-mallory", banned: false }, error: null });
    await login;
    expect(account.messages.at(-1)).toMatchObject({ type: "error", code: "not-logged-in" });
    expect(f.server.stats().sessions).toBe(2);
  });
});

describe("online game reliability", () => {
  it("abandonment by both disconnected players records a draw exactly once", async () => {
    const f = await game(); f.alice.close(); f.bob.close();
    await vi.advanceTimersByTimeAsync(60001);
    expect(f.room.phase).toBe("ended"); expect(services.end).toHaveBeenCalledTimes(1);
    expect(services.end.mock.calls[0][0]).toMatchObject({ isDraw: true, winnerUsername: null, resultReason: "Abandoned (both players disconnected)" });
    await vi.advanceTimersByTimeAsync(60001);
    expect(services.end).toHaveBeenCalledTimes(1);
  });
  it("scores prototype-named players as ordinary series participants", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    const f = await lobby(false, { bestOf: 3 });
    const proto = await f.connect("__proto__");
    await send(proto, { type: "join-room-accept", roomId: f.room.id });
    vi.setSystemTime(Date.now() + 60001); await send(f.alice, { type: "offer-draw" });
    expect(f.room.phase).toBe("ended");
    expect(f.room.seriesScore["__proto__"]).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(f.room.seriesScore, "__proto__")).toBe(true);
  });
  it("previews room terms without seating, charging, or leaving another room", async () => {
    const f = await lobby(true);
    await send(f.bob, { type: "create-room", gameTime: 5 });
    const ownRoom = [...f.server.rooms.values()].find((r: any) => r.creator === "bob") as any;
    await send(f.bob, { type: "join-room", roomId: f.room.id });
    expect(f.bob.messages.at(-1)).toMatchObject({ type: "room-preview", roomId: f.room.id, entryFee: 10 });
    expect(ownRoom.players).toHaveLength(1); expect(f.room.players).toHaveLength(1);
    expect(services.debit).not.toHaveBeenCalled(); expect(services.start).not.toHaveBeenCalled();
    await f.join(); expect(f.room.phase).toBe("playing");
    expect(f.server.rooms.has(ownRoom.id)).toBe(false); expect(services.debit).toHaveBeenCalledTimes(1);
  });
  it("a seated player's leave-spectate cannot erase their room membership", async () => {
    const f = await game();
    await send(f.alice, { type: "leave-spectate" });
    await send(f.alice, { type: "create-room", gameTime: 5 });
    expect(f.room.phase).toBe("ended");
    expect(services.end).toHaveBeenCalledTimes(1);
    expect(f.room.players.some((p: any) => p.username === "alice")).toBe(false);
  });
  it("a new opponent cannot join an ended game and reuse its record or fees", async () => {
    const f = await game();
    await send(f.alice, { type: "leave-room" });
    const third = await f.connect("third");
    await send(third, { type: "join-room-accept", roomId: f.room.id });
    expect(f.room.players).toHaveLength(1);
    expect(f.room.phase).toBe("ended");
    expect(third.messages.at(-1)).toMatchObject({ type: "error", code: "wrong-phase" });
    expect(services.start).toHaveBeenCalledTimes(1);
  });
  it("delayed result persistence notifies the completed game after a rematch starts", async () => {
    const f = await game();
    const oldCode = f.room.gameCode;
    const oldRecord = deferred<void>();
    services.end.mockReturnValueOnce(oldRecord.promise);
    vi.setSystemTime(Date.now() + 60001);
    await send(f.alice, { type: "offer-draw" });
    await send(f.alice, { type: "rematch-request" });
    await send(f.bob, { type: "rematch-response", accept: true });
    expect(f.room.gameCode).not.toBe(oldCode);
    oldRecord.resolve(); await microtasks();
    expect(services.notify.mock.calls[0][0]).toBe(oldCode);
  });
  it("shutdown stops timers and closes sockets without awarding a result", async () => {
    const f = await game(); f.server.shutdown();
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(services.end).not.toHaveBeenCalled();
    expect(services.settle).not.toHaveBeenCalled();
    expect(f.server.stats()).toEqual({ players: 0, rooms: 0, sessions: 0, calls: 0 });
    expect(f.alice.readyState).toBe(3);
  });
  it("resolves an expired clock before an offer can pause it", async () => {
    const f = await game();
    vi.setSystemTime(Date.now() + 60001);
    await send(f.alice, { type: "offer-draw" });
    expect(f.room.phase).toBe("ended"); expect(f.room.pendingEndOffer).toBeNull();
    expect(f.bob.messages.filter((m) => m.type === "game-ended").at(-1)?.winnerColor).toBe("B");
    expect(services.end).toHaveBeenCalledTimes(1);
  });
  it("resolves a flag before disconnect handling stops the clock", async () => {
    const f = await game(); vi.setSystemTime(Date.now() + 60001); f.bob.close();
    await microtasks();
    expect(f.room.phase).toBe("ended");
    expect(f.alice.messages.filter((m) => m.type === "game-ended").at(-1)?.winnerColor).toBe("B");
    expect(services.end).toHaveBeenCalledTimes(1);
  });
  it("cannot gain a move or increment while the opponent is disconnected", async () => {
    const f = await game(); f.black.close();
    const before = f.room.clock.whiteMs;
    const move = generateLegalMoves(f.room.gameState.board, "W")[0];
    vi.setSystemTime(Date.now() + 10000);
    await send(f.white, { type: "make-move", move });
    expect(f.room.gameState.moveHistory).toHaveLength(0);
    expect(f.room.clock.whiteMs).toBe(before);
    expect(f.white.messages.at(-1)).toMatchObject({ type: "error", code: "busy" });
  });
  it("still permits connected untimed play", async () => {
    const f = await game(); f.room.clock = untimedClock(); f.room.clockLimitType = "Untimed";
    const move = generateLegalMoves(f.room.gameState.board, "W")[0];
    await send(f.white, { type: "make-move", move });
    expect(f.room.gameState.moveHistory).toHaveLength(1);
    expect(f.room.clock.running).toBeNull();
    expect(f.room.phase).toBe("playing");
  });
  it("does not debit a roster that changed while pricing was awaited", async () => {
    const f = await lobby(true); const gate = deferred<typeof settingsValue>();
    f.settings.mockReturnValueOnce(gate.promise);
    const joining = f.join(); await microtasks();
    await send(f.bob, { type: "leave-room" });
    gate.resolve(settingsValue); await joining;
    expect(services.debit).not.toHaveBeenCalled(); expect(f.room.started).toBe(false);
  });
  it("refunds both original payers when a guest leaves during debit", async () => {
    const f = await lobby(true); const gate = deferred<{ ok: boolean }>();
    services.debit.mockReturnValueOnce(gate.promise);
    const joining = f.join(); await microtasks();
    expect(services.debit).toHaveBeenCalledTimes(1);
    await send(f.bob, { type: "leave-room" });
    gate.resolve({ ok: true }); await joining; await microtasks();
    const chargedPlayers = services.debit.mock.calls[0][0];
    expect([...chargedPlayers].sort()).toEqual(["alice", "bob"]);
    expect(services.refund).toHaveBeenCalledExactlyOnceWith(
      services.debit.mock.calls[0][3], chargedPlayers[0], chargedPlayers[1], 10,
    );
    expect(services.settle).not.toHaveBeenCalled();
    expect(f.room.started).toBe(false);
    expect(f.server.rooms.has(f.room.id)).toBe(false);
  });
  it("an old payout completion cannot settle the next rematch's pot", async () => {
    const f = await game(true); const old = deferred<void>();
    services.settle.mockReturnValueOnce(old.promise);
    vi.setSystemTime(Date.now() + 60001); await send(f.alice, { type: "offer-draw" }); await microtasks();
    expect(services.settle).toHaveBeenCalledTimes(1);
    await send(f.alice, { type: "rematch-request" });
    await send(f.bob, { type: "rematch-response", accept: true });
    expect(f.room.phase).toBe("playing"); expect(services.debit).toHaveBeenCalledTimes(2);
    old.resolve(); await microtasks();
    expect(f.room.potSettled).toBe(false);
    vi.setSystemTime(Date.now() + 60001); await send(f.alice, { type: "offer-draw" }); await microtasks();
    expect(services.settle).toHaveBeenCalledTimes(2);
    expect(services.settle.mock.calls[1][3]).not.toBe(services.settle.mock.calls[0][3]);
  });
  it("a broken recipient cannot prevent the other recipient or final record", async () => {
    const f = await game(); f.alice.failSend = true;
    vi.setSystemTime(Date.now() + 60001); await send(f.bob, { type: "offer-draw" });
    expect(f.room.phase).toBe("ended"); expect(services.end).toHaveBeenCalledTimes(1);
    expect(f.bob.messages.some((m) => m.type === "game-ended")).toBe(true);
  });
});

describe("room privacy and spectators", () => {
  it("hides private rooms from discovery and refuses guessed-code spectating", async () => {
    const f = await lobby(false, { private: true });
    const watcher = await f.connect("watcher");
    await send(watcher, { type: "get-open-rooms" });
    expect(watcher.messages.at(-1)?.rooms).toEqual([]);
    await f.join();
    expect(f.alice.messages.find((m) => m.type === "game-started")).toMatchObject({ private: true });
    await send(watcher, { type: "list-live-rooms" });
    expect(watcher.messages.at(-1)?.rooms).toEqual([]);
    await send(watcher, { type: "spectate-room", roomId: f.room.id });
    expect(watcher.messages.at(-1)).toMatchObject({ type: "error", code: "busy" });
    expect(f.room.spectators).toHaveLength(0);
  });
  it("restores a public spectator by session token without allowing game actions", async () => {
    const f = await game(); const watcher = await f.connect("watcher");
    await send(watcher, { type: "spectate-room", roomId: f.room.id });
    const token = watcher.messages.find((m) => m.type === "login-success").sessionToken;
    watcher.close();
    expect(f.room.spectators[0].ws).toBeNull();
    const rejoined = new FakeSocket(); f.server.wss.clients.add(rejoined as any); f.server.wss.emit("connection", rejoined);
    await send(rejoined, { type: "login", username: "watcher", sessionToken: token });
    expect(rejoined.messages.some((m) => m.type === "spectate-joined" && m.roomId === f.room.id)).toBe(true);
    expect(f.room.spectators).toHaveLength(1);
    await send(rejoined, { type: "make-move", move: generateLegalMoves(f.room.gameState.board, "W")[0] });
    expect(rejoined.messages.at(-1)).toMatchObject({ type: "error", code: "not-in-room" });
    await send(rejoined, { type: "offer-draw" });
    expect(f.room.pendingEndOffer).toBeNull(); expect(f.room.gameState.moveHistory).toHaveLength(0);
  });
});

describe("asynchronous guest entitlement", () => {
  it("does not create an orphan room after the requesting socket closes", async () => {
    const f = await lobby(); const guest = await f.connect("KGuest_0123456789abcdef1001");
    const quota = deferred<boolean>(); vi.spyOn(guestQuota, "guestHasOnlineTrial").mockReturnValueOnce(quota.promise);
    const creating = send(guest, { type: "create-room", gameTime: 5 }); await microtasks();
    guest.close(); quota.resolve(true); await creating;
    expect(f.server.rooms.size).toBe(1);
  });
  it("does not seat a guest after they close during a quota check", async () => {
    const f = await lobby(); const guest = await f.connect("KGuest_0123456789abcdef1002");
    const quota = deferred<boolean>(); vi.spyOn(guestQuota, "guestHasOnlineTrial").mockReturnValueOnce(quota.promise);
    const joining = send(guest, { type: "join-room-accept", roomId: f.room.id }); await microtasks();
    guest.close(); quota.resolve(true); await joining;
    expect(f.room.players).toHaveLength(1); expect(f.room.started).toBe(false);
  });
  it("cannot overfill a lobby when another join starts the game during a quota check", async () => {
    const f = await lobby(); const guest = await f.connect("KGuest_0123456789abcdef1003");
    const quota = deferred<boolean>(); vi.spyOn(guestQuota, "guestHasOnlineTrial").mockReturnValueOnce(quota.promise);
    const joining = send(guest, { type: "join-room-accept", roomId: f.room.id }); await microtasks();
    await f.join(); quota.resolve(true); await joining;
    expect(f.room.players).toHaveLength(2); expect(services.start).toHaveBeenCalledTimes(1);
    expect(guest.messages.at(-1)).toMatchObject({ type: "error", code: "game-in-progress" });
  });
});


describe('bounded end offers',()=>{
  it.each(['offer-draw','resign'])('expires unanswered %s and resumes the authoritative clock',async type=>{
    const f=await game();await send(f.alice,{type});
    expect(f.room.pendingEndOffer).not.toBeNull();expect(f.room.clock.running).toBeNull();
    await vi.advanceTimersByTimeAsync(31000);
    expect(f.room.pendingEndOffer).toBeNull();expect(f.room.clock.running).toBe(f.room.gameState.turn);
    expect(f.alice.messages.some(m=>m.expired===true)).toBe(true);expect(f.room.phase).toBe('playing');
  });
});
