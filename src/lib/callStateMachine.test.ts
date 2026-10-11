import { describe, it, expect } from "vitest";
import {
  ACTIVE_STATES,
  IDLE_LIKE_STATES,
  canTransition,
  exitSignalFor,
  isActiveCall,
  isIdleLike,
  isMediaPhase,
  resolveGlareRole,
  terminalStateFor,
  transition,
  type CallPhase,
} from "./callStateMachine";

const ALL: CallPhase[] = [
  "idle", "calling", "ringing", "connecting", "connected",
  "reconnecting", "failed", "failed-network", "unsupported", "ended",
];

describe("call state machine", () => {
  it("caller happy path: idle -> calling -> connecting -> connected -> idle", () => {
    const path: CallPhase[] = ["idle", "calling", "connecting", "connected", "idle"];
    for (let i = 1; i < path.length; i++) {
      expect(transition(path[i - 1], path[i])).toMatchObject({ ok: true });
    }
  });

  it("callee happy path: idle -> ringing -> connecting -> connected -> idle", () => {
    const path: CallPhase[] = ["idle", "ringing", "connecting", "connected", "idle"];
    for (let i = 1; i < path.length; i++) {
      expect(transition(path[i - 1], path[i])).toMatchObject({ ok: true });
    }
  });

  it("connected bounces through reconnecting and back", () => {
    expect(canTransition("connected", "reconnecting")).toBe(true);
    expect(canTransition("reconnecting", "connected")).toBe(true);
    expect(canTransition("reconnecting", "failed-network")).toBe(true);
  });

  it("rejects skipping the signalling phase", () => {
    expect(canTransition("idle", "connected")).toBe(false);
    expect(canTransition("calling", "connected")).toBe(false);
    expect(canTransition("ringing", "connected")).toBe(false);
    expect(canTransition("idle", "connecting")).toBe(false);
    expect(canTransition("connected", "calling")).toBe(false);
    expect(canTransition("connected", "ringing")).toBe(false);
  });

  it("rejects no-op transitions with a readable error", () => {
    const r = transition("connected", "connected");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/already/);
    const r2 = transition("idle", "connected");
    expect(r2.ok).toBe(false);
    expect(r2.error).toMatch(/illegal/);
    expect(transition("idle", "calling").error).toBeUndefined();
  });

  it("mutual-call tie-break: an outgoing caller may become the callee (calling -> connecting)", () => {
    expect(canTransition("calling", "connecting")).toBe(true);
  });

  it("every idle-like state can start or receive a call", () => {
    for (const s of IDLE_LIKE_STATES) {
      if (s === "unsupported") continue;
      expect(canTransition(s, "calling")).toBe(true);
      expect(canTransition(s, "ringing")).toBe(true);
    }
    expect(canTransition("unsupported", "calling")).toBe(false);
    expect(canTransition("unsupported", "idle")).toBe(true);
  });

  it("every active state can be torn down to idle", () => {
    for (const s of ACTIVE_STATES) {
      expect(canTransition(s, "idle")).toBe(true);
    }
  });

  it("partitions the phases into idle-like and active", () => {
    for (const s of ALL) {
      expect(isIdleLike(s) !== isActiveCall(s)).toBe(true);
    }
    expect(isMediaPhase("connecting")).toBe(true);
    expect(isMediaPhase("reconnecting")).toBe(true);
    expect(isMediaPhase("calling")).toBe(false);
    expect(isMediaPhase("ringing")).toBe(false);
  });

  it("maps each local exit to exactly one signalling message", () => {
    expect(exitSignalFor("calling")).toBe("cancel");
    expect(exitSignalFor("ringing")).toBe("decline");
    expect(exitSignalFor("connecting")).toBe("end");
    expect(exitSignalFor("connected")).toBe("end");
    expect(exitSignalFor("reconnecting")).toBe("end");
    for (const s of IDLE_LIKE_STATES) expect(exitSignalFor(s)).toBeNull();
  });

  it("glare tie-break is deterministic and symmetric", () => {
    expect(resolveGlareRole("alice", "bob")).toBe("caller");
    expect(resolveGlareRole("bob", "alice")).toBe("callee");
    expect(resolveGlareRole("Zed", "amy")).toBe("caller"); // plain code-unit order, same on both ends
  });

  it("network-caused endings land on the Couldn't Connect surface", () => {
    expect(terminalStateFor("ice-failed")).toBe("failed-network");
    expect(terminalStateFor("timeout")).toBe("failed-network");
    expect(terminalStateFor("hangup")).toBe("idle");
    expect(terminalStateFor("busy")).toBe("idle");
    expect(terminalStateFor("peer-disconnected")).toBe("idle");
  });
});
