import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));
vi.mock("./audio", () => ({
  getAudioContext: vi.fn(),
  playCallConnectedChime: vi.fn(),
  playCallEndedChime: vi.fn(),
  startVoiceRingback: () => () => {},
  startVoiceRingtone: () => () => {},
}));
import { createCallController } from "./useWebRTCCall";
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}
class Stream {
  constructor(readonly tracks: any[] = []) {}
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
  addTrack(t: any) {
    this.tracks.push(t);
  }
  removeTrack(t: any) {
    const i = this.tracks.indexOf(t);
    if (i >= 0) this.tracks.splice(i, 1);
  }
}
const track = () => ({ kind: "audio", stop: vi.fn(), onended: null });
function controller() {
  const updates: Record<string, any> = {};
  const send = vi.fn();
  const set = new Proxy(
    {},
    {
      get: (_t, key) => (value: any) => {
        updates[String(key)] = value;
      },
    },
  );
  return {
    value: createCallController({
      wsRef: { current: { readyState: 1, send } },
      userRef: { current: "alice" },
      mutedRef: { current: true },
      toastRef: { current: vi.fn() },
      set: set as any,
    }),
    updates,
    send,
  };
}
beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("RTCPeerConnection", class {});
  vi.stubGlobal("MediaStream", Stream);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ iceServers: [] }) })),
  );
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("media lifecycle without peer transport", () => {
  it("stops media acquired after the user cancels without signalling a call request", async () => {
    const prompt = deferred<any>();
    const capture = vi.fn(() => prompt.promise);
    vi.stubGlobal("navigator", {
      userAgent: "test",
      mediaDevices: { getUserMedia: capture },
    });
    const c = controller();
    const call = c.value.startCall("bob", "voice");
    await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(1));
    c.value.cancelCall();
    const t = track();
    prompt.resolve(new Stream([t]));
    await call;
    expect(t.stop).toHaveBeenCalled();
    expect(c.updates.localStream).toBeNull();
    expect(
      c.send.mock.calls.some(
        ([raw]) => JSON.parse(raw).type === "voice-request",
      ),
    ).toBe(false);
    c.value.dispose();
  });
  it("does not open fallback capture prompts after a cancelled permission rejection", async () => {
    const prompt = deferred<any>();
    const capture = vi.fn(() => prompt.promise);
    vi.stubGlobal("navigator", {
      userAgent: "test",
      mediaDevices: { getUserMedia: capture },
    });
    const c = controller();
    const call = c.value.startCall("bob", "video");
    await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(1));
    c.value.cancelCall();
    prompt.reject(new Error("Permission rejected"));
    await call;
    expect(capture).toHaveBeenCalledTimes(1);
    expect(c.updates.callState).toBe("idle");
    c.value.dispose();
  });
  it("disposal releases adopted microphone tracks and pending timers", async () => {
    const t = track();
    vi.stubGlobal("navigator", {
      userAgent: "test",
      mediaDevices: { getUserMedia: async () => new Stream([t]) },
    });
    const c = controller();
    await c.value.startCall("bob", "voice");
    expect(c.updates.localStream).toBeTruthy();
    c.value.dispose();
    expect(t.stop).toHaveBeenCalled();
    expect(c.updates.localStream).toBeNull();
    expect(c.updates.callState).toBe("idle");
  });
});
