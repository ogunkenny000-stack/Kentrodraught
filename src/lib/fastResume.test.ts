import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createInitialBoard } from "../gameLogic";
import { saveActiveRoom, loadActiveRoom, saveFastResumeState, loadFastResumeState, clearFastResumeState } from "./fastResume";
function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
}
const sample = (roomId = "a") => ({ roomId, board: createInitialBoard(), turn: "W" as const, lastMove: null, moveHistory: [] });
let local: ReturnType<typeof memoryStorage>;
beforeEach(() => { local = memoryStorage(); vi.stubGlobal("window", { localStorage: local, sessionStorage: memoryStorage() }); });
afterEach(() => vi.unstubAllGlobals());
describe("fast resume", () => {
  it("round-trips the project's object-shaped board", () => {
    const state = sample(); saveFastResumeState(state);
    expect(loadFastResumeState("a")?.board).toEqual(state.board);
    expect(loadFastResumeState("a")?.turn).toBe("W");
  });
  it("falls back when the localStorage accessor throws", () => {
    const sessionStorage = memoryStorage();
    vi.stubGlobal("window", { get localStorage() { throw new Error("blocked"); }, sessionStorage });
    saveFastResumeState(sample());
    expect(loadFastResumeState("a")?.roomId).toBe("a");
  });
  it("falls back when localStorage is readable but unwritable", () => {
    vi.stubGlobal("window", { localStorage: { ...local, setItem() { throw new Error("quota"); } }, sessionStorage: memoryStorage() });
    saveFastResumeState(sample());
    expect(loadFastResumeState("a")?.roomId).toBe("a");
  });
  it("clearing room A does not clear room B's current pointers", () => {
    saveFastResumeState(sample("a")); saveFastResumeState(sample("b"));
    saveActiveRoom({ roomId: "b", playMode: "Multiplayer" });
    clearFastResumeState("a");
    expect(loadFastResumeState("a")).toBeNull();
    expect(loadFastResumeState()?.roomId).toBe("b");
    expect(loadActiveRoom()?.roomId).toBe("b");
  });
  it("clears the matching room's current pointers", () => {
    saveFastResumeState(sample()); saveActiveRoom({ roomId: "a", playMode: "Multiplayer" });
    clearFastResumeState("a");
    expect(loadFastResumeState()).toBeNull(); expect(loadActiveRoom()).toBeNull();
  });
  it.each([{ board: [] }, { board: { 51: "w" } }, { board: { 1: "invalid" } }, { turn: "X" }, { roomId: "other" }, { timestamp: null }])("ignores malformed cached snapshots %s", (override) => {
    local.setItem("kd.fast_resume.a", JSON.stringify({ ...sample(), timestamp: Date.now(), ...override }));
    expect(loadFastResumeState("a")).toBeNull();
  });
  it("expires old snapshots without discarding a different active room", () => {
    local.setItem("kd.fast_resume.a", JSON.stringify({ ...sample(), timestamp: Date.now() - 7_200_001 }));
    saveActiveRoom({ roomId: "b", playMode: "Multiplayer" });
    expect(loadFastResumeState("a")).toBeNull(); expect(loadActiveRoom()?.roomId).toBe("b");
  });
});
