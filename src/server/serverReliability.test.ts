import { describe, it, expect } from "vitest";
import { createClock, resumeClock, remainingMs, pauseClock, applyMoveToClock } from "./roomClock";
import { validateMessage } from "./wsValidation";

describe("clock reliability", () => {
  it("repeated resume never gives elapsed time back", () => {
    const clock = createClock(60000, 60000, 2000, true);
    resumeClock(clock, "W", 1000);
    resumeClock(clock, "W", 11000);
    expect(remainingMs(clock, "W", 16000)).toBe(45000);
    expect(clock.turnStartedAt).toBe(1000);
  });
  it("switching sides banks elapsed time exactly once", () => {
    const clock = createClock(60000, 60000, 2000, true);
    resumeClock(clock, "W", 1000); resumeClock(clock, "B", 11000);
    expect(clock.whiteMs).toBe(50000);
    expect(remainingMs(clock, "B", 16000)).toBe(55000);
  });
  it("a normal move deducts elapsed time and adds its one increment", () => {
    const clock = createClock(60000, 60000, 2000, true);
    resumeClock(clock, "W", 1000); applyMoveToClock(clock, "W", 11000);
    expect(clock.whiteMs).toBe(52000); expect(clock.running).toBeNull();
    pauseClock(clock, 16000); expect(clock.whiteMs).toBe(52000);
  });
  it("leaves untimed games untimed", () => {
    const clock = createClock(0, 0, 0, false);
    resumeClock(clock, "W", 1000); applyMoveToClock(clock, "W", 5000);
    expect(clock.running).toBeNull(); expect(clock.whiteMs).toBe(0);
  });
});

describe("websocket validator reliability", () => {
  it.each(["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"])("ignores unknown inherited type %s safely", (type) => {
    expect(validateMessage({ type })).toBeNull();
  });
  it("still validates real message types", () => {
    expect(validateMessage({ type: "login", username: "alice" })).toBeNull();
    expect(validateMessage({ type: "login", username: "" })).toBeTypeOf("string");
    expect(validateMessage({ type: "make-move", move: { from: 0, to: 51 } })).toBeTypeOf("string");
  });
});
