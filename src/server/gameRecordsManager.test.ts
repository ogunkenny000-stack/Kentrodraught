import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EventEmitter } from "node:events";
const eventSource: EventEmitter = process;
const disk = vi.hoisted(() => ({
  existsSync: vi.fn(), mkdirSync: vi.fn(), readFileSync: vi.fn(), writeFileSync: vi.fn(), renameSync: vi.fn(),
  promises: { writeFile: vi.fn(), rename: vi.fn() },
}));
const sync = vi.hoisted(() => ({ admin: vi.fn(), rate: vi.fn() }));
vi.mock("fs", () => ({ default: disk }));
vi.mock("../../supabaseAdmin", () => ({ getSupabaseAdmin: sync.admin }));
vi.mock("./authoritativeRatings", () => ({ applyAuthoritativeRating: sync.rate }));
const events = ["exit", "SIGINT", "SIGTERM"] as const;
let originalListeners: Map<string, Set<Function>>;
beforeEach(() => {
  originalListeners = new Map(events.map((event) => [event, new Set(eventSource.listeners(event))]));
  vi.stubEnv("SUPABASE_URL", ""); vi.stubEnv("SUPABASE_SECRET_KEY", "");
  vi.resetModules(); vi.useFakeTimers(); vi.clearAllMocks();
  sync.admin.mockReset().mockReturnValue(null); sync.rate.mockReset().mockResolvedValue(null);
  disk.existsSync.mockReturnValue(true);
  disk.writeFileSync.mockReset(); disk.renameSync.mockReset();
  disk.promises.writeFile.mockReset().mockResolvedValue(undefined);
  disk.promises.rename.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  for (const event of events) for (const listener of eventSource.listeners(event)) {
    if (!originalListeners.get(event)?.has(listener)) eventSource.removeListener(event, listener as any);
  }
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs();
});

describe("game record persistence", () => {
  it("retries failed server sync and applies authoritative ratings without changing the terminal result", async () => {
    vi.stubEnv("SUPABASE_URL","https://fixture.invalid"); vi.stubEnv("SUPABASE_SECRET_KEY","fixture");
    const upsert=vi.fn().mockResolvedValue({error:null});
    sync.admin.mockReturnValue({from:()=>({upsert})});
    sync.rate.mockRejectedValueOnce(new Error("temporary rating outage")).mockResolvedValue({ok:true,white:{username:"alice",rating:1662},black:{username:"bob",rating:1338}});
    const manager=await import("./gameRecordsManager");
    manager.recordGameStart({gameCode:"26100005",participantUserIds:["uid-alice","uid-bob"],player1:"alice",player2:"bob",playerColors:{alice:"W",bob:"B"},gameMode:"Multiplayer",timeControl:"1+2"});
    const rec=await manager.recordGameEnd({gameCode:"26100005",completeMoveHistory:[],finalResult:"1–0",resultReason:"Timeout",winnerColor:"W",winnerUsername:"alice",loserUsername:"bob",isDraw:false});
    expect(rec.serverSyncPending).toBe(true); expect(rec.finalResult).toBe("1–0");
    await vi.advanceTimersByTimeAsync(15000);
    expect(sync.rate).toHaveBeenCalledTimes(2); expect(rec.serverSyncPending).toBe(false);
    expect(rec.playerRatingsAfter).toEqual({alice:1662,bob:1338});
    expect(upsert).toHaveBeenLastCalledWith(expect.objectContaining({winner:"W"}),{onConflict:"gameId",ignoreDuplicates:true});
    await manager.recordGameEnd({gameCode:"26100005",completeMoveHistory:[],finalResult:"½–½",resultReason:"Duplicate",winnerColor:null,winnerUsername:null,loserUsername:null,isDraw:true});
    expect(upsert).toHaveBeenCalledTimes(2); expect(rec.finalResult).toBe("1–0");
  });
  it("keeps the first terminal result on duplicate completion and start", async () => {
    const manager = await import("./gameRecordsManager");
    const start = { gameCode: "26100001", player1: "alice", player2: "bob", playerColors: { alice: "W" as const, bob: "B" as const }, gameMode: "Multiplayer", timeControl: "1+2" };
    manager.recordGameStart(start);
    const finish = { gameCode: start.gameCode, completeMoveHistory: [], finalResult: "1–0" as const, resultReason: "Timeout", winnerColor: "W" as const, winnerUsername: "alice", loserUsername: "bob", isDraw: false };
    const first = await manager.recordGameEnd(finish);
    const endedAt = first.gameEndTime;
    vi.setSystemTime(Date.now() + 10000);
    const duplicate = await manager.recordGameEnd({ ...finish, finalResult: "½–½", winnerColor: null, winnerUsername: null, loserUsername: null, isDraw: true, resultReason: "Duplicate" });
    expect(duplicate.finalResult).toBe("1–0"); expect(duplicate.gameEndTime).toBe(endedAt);
    expect(manager.recordGameStart(start).gameEndTime).toBe(endedAt);
    expect(manager.getSeriesById("series_26100001")).toMatchObject({ seriesGamesCount: 1, draws: 0, scores: { alice: 1, bob: 0 } });
  });
  it("stores the actual crowned opening and isolates it from subsequent mutations", async () => {
    const manager = await import("./gameRecordsManager");
    const rec = manager.recordGameStart({ gameCode: "26100002", player1: "alice", player2: "bob", playerColors: { alice: "W", bob: "B" }, gameMode: "Multiplayer", timeControl: "1+2", startingPosition: { 46: "w" } });
    const opening = { 46: "W", 1: "B" };
    manager.recordGameStartingPosition(rec.gameCode, opening);
    opening[46] = "w";
    expect(rec.startingPosition).toEqual({ 46: "W", 1: "B" });
    expect(rec.currentPosition).toEqual({ 46: "W", 1: "B" });
  });
  it("never lists a game with moves as completed before a terminal result", async () => {
    const manager = await import("./gameRecordsManager");
    const rec = manager.recordGameStart({ gameCode: "26100003", player1: "alice", player2: "bob", playerColors: { alice: "W", bob: "B" }, gameMode: "Multiplayer", timeControl: "1+2" });
    rec.completeMoveHistory.push({ from: 31, to: 26, caps: [] });
    expect(await manager.getRecentGameRecords()).toEqual([]);
  });
  it("excludes completed private games from the public recent list", async () => {
    const manager = await import("./gameRecordsManager");
    manager.recordGameStart({ gameCode: "26100004", private: true, participantUserIds: ["uid-alice", "uid-bob"], player1: "alice", player2: "bob", playerColors: { alice: "W", bob: "B" }, gameMode: "Multiplayer", timeControl: "1+2" });
    await manager.recordGameEnd({ gameCode: "26100004", completeMoveHistory: [], finalResult: "½–½", resultReason: "Draw", winnerColor: null, winnerUsername: null, loserUsername: null, isDraw: true });
    expect(await manager.getRecentGameRecords()).toEqual([]);
    expect(await manager.getGameRecordByCode("26100004")).toMatchObject({ private: true, participantUserIds: ["uid-alice", "uid-bob"] });
  });
  it.each([9, 10, 11, 12])("recovers the sequence in month %i without a sequence file", async (month) => {
    vi.setSystemTime(new Date(2026, month - 1, 6, 12));
    const prefix = `26${month}`;
    disk.existsSync.mockImplementation((file: string) => !file.endsWith(".json") || file.endsWith("permanent_game_records.json"));
    disk.readFileSync.mockReturnValue(JSON.stringify([{ gameCode: `${prefix}0042` }]));
    const manager = await import("./gameRecordsManager");
    await manager.initGameRecordsManager();
    expect(manager.getNextGameCode()).toBe(`${prefix}0043`);
  });
  it("coalesces sequence changes into one successful atomic write", async () => {
    const manager = await import("./gameRecordsManager");
    const first = manager.getNextGameCode();
    expect(manager.getNextGameCode()).not.toBe(first);
    expect(disk.promises.writeFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(disk.promises.writeFile).toHaveBeenCalledTimes(1);
    expect(disk.promises.rename).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(disk.promises.writeFile).toHaveBeenCalledTimes(1);
  });
  it("retries an asynchronous write failure without another mutation", async () => {
    const manager = await import("./gameRecordsManager");
    disk.promises.writeFile.mockRejectedValueOnce(new Error("disk full"));
    manager.getNextGameCode();
    await vi.advanceTimersByTimeAsync(2000);
    expect(disk.promises.writeFile).toHaveBeenCalledTimes(1);
    expect(disk.promises.rename).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(disk.promises.writeFile).toHaveBeenCalledTimes(2);
    expect(disk.promises.rename).toHaveBeenCalledTimes(1);
  });
  it("retries a failed rename too", async () => {
    const manager = await import("./gameRecordsManager");
    disk.promises.rename.mockRejectedValueOnce(new Error("rename refused"));
    manager.getNextGameCode();
    await vi.advanceTimersByTimeAsync(4000);
    expect(disk.promises.writeFile).toHaveBeenCalledTimes(2);
    expect(disk.promises.rename).toHaveBeenCalledTimes(2);
  });
  it("retains the dirty flag after a synchronous failure", async () => {
    const manager = await import("./gameRecordsManager");
    disk.writeFileSync.mockImplementationOnce(() => { throw new Error("disk full"); });
    manager.getNextGameCode();
    manager.flushGameRecordsSync();
    expect(disk.writeFileSync).toHaveBeenCalledTimes(1);
    manager.flushGameRecordsSync();
    expect(disk.writeFileSync).toHaveBeenCalledTimes(2);
    expect(disk.renameSync).toHaveBeenCalledTimes(1);
    manager.flushGameRecordsSync();
    expect(disk.writeFileSync).toHaveBeenCalledTimes(2);
  });
  it("waits for every in-flight file before starting the next flush", async () => {
    const manager = await import("./gameRecordsManager");
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let seqFailed = false;
    disk.promises.writeFile.mockImplementation((file: string) => {
      if (file.includes("game_seq") && !seqFailed) { seqFailed = true; return Promise.reject(new Error("first sequence write failed")); }
      if (file.includes("permanent_game_records")) return held;
      return Promise.resolve();
    });
    const code = manager.getNextGameCode();
    manager.recordGameStart({ gameCode: code, player1: "alice", player2: "bob", playerColors: { alice: "W", bob: "B" }, gameMode: "online", timeControl: "1+2" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(disk.promises.writeFile).toHaveBeenCalledTimes(2);
    manager.getNextGameCode();
    await vi.advanceTimersByTimeAsync(2000);
    expect(disk.promises.writeFile).toHaveBeenCalledTimes(2);
    release();
    await vi.advanceTimersByTimeAsync(1);
    expect(disk.promises.writeFile).toHaveBeenCalledTimes(3);
  });
});
