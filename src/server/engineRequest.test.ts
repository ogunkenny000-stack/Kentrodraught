import { describe, expect, it } from "vitest";
import { isScanFen, MAX_ENGINE_DEPTH, parseEngineMoveRequest } from "./engineRequest";
const fen = "W" + "b".repeat(20) + "e".repeat(10) + "w".repeat(20);

describe("native engine request validation", () => {
  it("retains the existing valid request and time cap", () => {
    expect(parseEngineMoveRequest({ fen, thinkTime: 2, depth: 12, usePst: true, supersedeKey: "analysis:one" })).toEqual({ fen, thinkTimeSec: 2, depth: 12, usePst: true, supersedeKey: "analysis:one" });
    expect(parseEngineMoveRequest({ fen, thinkTime: 500 }).thinkTimeSec).toBe(5);
    expect(parseEngineMoveRequest({ fen, thinkTime: -1 }).thinkTimeSec).toBe(0.05);
  });
  it.each([null, undefined, {}, [], "fen"])("rejects an invalid request body %s", (body) => {
    expect(() => parseEngineMoveRequest(body)).toThrow();
  });
  it.each(["", fen.slice(1), fen + "e", "X" + fen.slice(1), fen.slice(0, -1) + ".", fen + '\"\nquit\n']) ("rejects malformed or injected FEN %s", (value) => {
    expect(isScanFen(value)).toBe(false);
    expect(() => parseEngineMoveRequest({ fen: value })).toThrow("FEN");
  });
  it.each(["2\nquit", "2", 0, -1, 1.5, NaN, Infinity, MAX_ENGINE_DEPTH + 1])("rejects unsafe depth %s", (depth) => {
    expect(() => parseEngineMoveRequest({ fen, depth })).toThrow("Depth");
  });
  it.each([NaN, Infinity, -Infinity, "fast"])("uses the established default for non-finite or non-number think time %s", (thinkTime) => {
    expect(parseEngineMoveRequest({ fen, thinkTime }).thinkTimeSec).toBe(0.8);
  });
  it("allows time-controlled searches with no depth override", () => {
    expect(parseEngineMoveRequest({ fen }).depth).toBeUndefined();
    expect(parseEngineMoveRequest({ fen, depth: MAX_ENGINE_DEPTH }).depth).toBe(99);
  });
  it.each([{}, "x".repeat(129), "cancel\nquit"])("bounds cancellation keys", (supersedeKey) => {
    expect(() => parseEngineMoveRequest({ fen, supersedeKey })).toThrow("cancellation");
  });
});
