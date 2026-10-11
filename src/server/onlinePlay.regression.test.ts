import { EventEmitter } from "node:events";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateLegalMoves, movesAreEquivalent } from "../gameLogic";
import { createClock, resumeClock, untimedClock } from "./roomClock";
const services = vi.hoisted(() => ({ debit: vi.fn(), settle: vi.fn(), start: vi.fn(), end: vi.fn(), link: vi.fn(), seq: 2610000 }));
vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events");
  return { WebSocketServer: class extends EventEmitter { clients = new Set(); close() { this.emit("close"); } } };
});
vi.mock("../../coinsService", () => ({ debitMultipleWallets: services.debit, settleMatchPot: services.settle }));
vi.mock("../../supabaseAdmin", () => ({ getSupabaseAdmin: () => null, verifyAccessToken: async () => null }));
vi.mock("./gameRecordsManager", () => ({
  getNextGameCode: () => String(++services.seq), recordGameStart: services.start,
  recordGameEnd: services.end, linkRematch: services.link,
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
async function lobby(paid = false) {
  const settings = vi.fn().mockResolvedValue(settingsValue);
  const server = attachOnlinePlay({} as any, {
    coinsEnabled: paid, getCoinSettings: settings, resolveEntryFee: () => paid ? 10 : 0,
    sanitizeWagerAmount: () => 0, sanitizeBestOf: () => 1, sanitizeCustomBoard: () => null,
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
  await send(alice, { type: "create-room", gameTime: 1, increment: 2, specialRule: "none", bestOf: 1 });
  const room: any = [...server.rooms.values()][0];
  expect(room).toBeDefined();
  const join = () => send(bob, { type: "join-room-accept", roomId: room.id });
  return { server, alice, bob, room, settings, join };
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
  services.debit.mockReset().mockResolvedValue({ ok: true });
  services.settle.mockReset().mockResolvedValue(undefined);
  services.end.mockReset().mockResolvedValue(undefined);
  services.start.mockReset().mockReturnValue({});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs();
});

describe("online game reliability", () => {
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
    expect(services.settle).toHaveBeenCalledTimes(1);
    expect(services.settle.mock.calls[0][0].map((p: any) => p.username)).toEqual(["alice", "bob"]);
    expect(services.settle.mock.calls[0][2]).toEqual({ isDraw: true, winnerColor: null });
    expect(f.room.started).toBe(false); expect(f.room.feesCharged).toBe(false);
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
