import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createInitialBoard, generateLegalMoves, applyMove, moveToHubString } from "../gameLogic";
import { analyzeKen, clearClientEngineCache, EngineUnavailableError, SupersededError } from "./kenEngine";
const board = createInitialBoard();
const move = generateLegalMoves(board, "W")[0];
const boardB = applyMove(board, move).board;
const response = (extra = {}) => ({ ok: true, status: 200, json: async () => ({ move: moveToHubString(move), score: 25, depth: 4, nodes: 20, pv: "", ...extra }) });
function pendingFetch() {
  const requests: { signal: AbortSignal; resolve: (v: any) => void }[] = [];
  const fetcher = vi.fn((_url: any, options: any) => new Promise((resolve, reject) => {
    requests.push({ signal: options.signal, resolve });
    options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }));
  vi.stubGlobal("fetch", fetcher);
  return { requests, fetcher };
}
beforeEach(() => clearClientEngineCache());
afterEach(() => { clearClientEngineCache(); vi.unstubAllGlobals(); });
describe("native engine client", () => {
  it("returns only a canonical legal move", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
    expect((await analyzeKen(board, "W", 100)).move).toEqual(move);
  });
  it.each([{ move: "1-50" }, { move: moveToHubString(move) + "junk" }, { score: NaN }, { move: null }])("rejects invalid engine results %s", async (data) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(data)));
    await expect(analyzeKen(board, "W", 100)).rejects.toBeInstanceOf(EngineUnavailableError);
  });
  it("does not confuse a terminal position with an unavailable engine", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const terminal = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [i + 1, null]));
    expect(await analyzeKen(terminal, "W", 100)).toMatchObject({ move: null, score: -10000 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("A→B→A starts a fresh A and old cleanup cannot delete it", async () => {
    const { requests, fetcher } = pendingFetch();
    const first = analyzeKen(board, "W", 100, "live").catch((e) => e);
    const middle = analyzeKen(boardB, "W", 100, "live").catch((e) => e);
    const last = analyzeKen(board, "W", 100, "live");
    expect(requests).toHaveLength(3);
    expect(await first).toBeInstanceOf(SupersededError);
    expect(await middle).toBeInstanceOf(SupersededError);
    const repeated = analyzeKen(board, "W", 100, "live");
    expect(fetcher).toHaveBeenCalledTimes(3);
    requests[2].resolve(response());
    expect((await last).move).toEqual(move);
    expect((await repeated).move).toEqual(move);
  });
  it("a cached A still cancels a pending B", async () => {
    const { requests, fetcher } = pendingFetch();
    const first = analyzeKen(board, "W", 100, "live"); requests[0].resolve(response()); await first;
    const middle = analyzeKen(boardB, "W", 100, "live").catch((e) => e);
    expect((await analyzeKen(board, "W", 100, "live")).fromCache).toBe(true);
    expect(requests[1].signal.aborted).toBe(true);
    expect(await middle).toBeInstanceOf(SupersededError);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("keeps different callers' cancellation streams isolated", async () => {
    const { requests } = pendingFetch();
    const live = analyzeKen(board, "W", 100, "live").catch((e) => e);
    const review = analyzeKen(board, "W", 100, "review");
    const next = analyzeKen(boardB, "W", 100, "live").catch((e) => e);
    expect(requests[0].signal.aborted).toBe(true);
    expect(requests[1].signal.aborted).toBe(false);
    requests[1].resolve(response()); expect((await review).move).toEqual(move);
    clearClientEngineCache();
    expect(await live).toBeInstanceOf(SupersededError); expect(await next).toBeInstanceOf(SupersededError);
  });
  it("stops pending work when clearing caches", async () => {
    const { requests } = pendingFetch();
    const pending = analyzeKen(board, "W", 100).catch((e) => e);
    clearClientEngineCache();
    expect(requests[0].signal.aborted).toBe(true);
    expect(await pending).toBeInstanceOf(SupersededError);
  });
});
