import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EventEmitter } from "node:events";
const eventSource: EventEmitter = process;
const disk = vi.hoisted(() => ({
  existsSync: vi.fn(), mkdirSync: vi.fn(), readFileSync: vi.fn(), writeFileSync: vi.fn(), renameSync: vi.fn(),
  promises: { writeFile: vi.fn(), rename: vi.fn() },
}));
vi.mock("fs", () => ({ default: disk }));
vi.mock("../../supabaseAdmin", () => ({ getSupabaseAdmin: vi.fn(() => null) }));
const events = ["exit", "SIGINT", "SIGTERM"] as const;
let originalListeners: Map<string, Set<Function>>;
beforeEach(() => {
  originalListeners = new Map(events.map((event) => [event, new Set(eventSource.listeners(event))]));
  vi.stubEnv("SUPABASE_URL", ""); vi.stubEnv("SUPABASE_SECRET_KEY", "");
  vi.resetModules(); vi.useFakeTimers(); vi.clearAllMocks();
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
