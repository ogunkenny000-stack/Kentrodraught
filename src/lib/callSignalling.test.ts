import { describe, it, expect } from "vitest";
import {
  ICE_SERVERS,
  MAX_RESTART_ATTEMPTS,
  RECOVERY_DEADLINE_MS,
  SignalQueue,
  classifyCandidate,
  gateIncomingCallMessage,
  isMobileUserAgent,
  optimizeOpusSdp,
  restartDelayMs,
  signalKindOf,
  signalName,
  videoMaxBitrateFor,
} from "./callSignalling";

describe("ICE configuration", () => {
  it("ships public STUN only and no shared TURN passwords", () => {
    expect(ICE_SERVERS).toHaveLength(2);
    for (const server of ICE_SERVERS) {
      expect(String(server.urls)).toMatch(/^stun:/);
      expect(server.credential).toBeUndefined();
    }
  });
});

describe("recovery timing", () => {
  it("backs off 2/4/8/16 s then gives up", () => {
    expect(restartDelayMs(1)).toBe(2_000);
    expect(restartDelayMs(2)).toBe(4_000);
    expect(restartDelayMs(3)).toBe(8_000);
    expect(restartDelayMs(4)).toBe(16_000);
    expect(restartDelayMs(5)).toBeNull();
    expect(restartDelayMs(0)).toBeNull();
    expect(MAX_RESTART_ATTEMPTS).toBe(4);
  });

  it("the whole backoff ladder fits inside the 45 s recovery budget", () => {
    let total = 0;
    for (let a = 1; a <= MAX_RESTART_ATTEMPTS; a++) total += restartDelayMs(a)!;
    expect(total).toBeLessThanOrEqual(RECOVERY_DEADLINE_MS);
  });
});

describe("device heuristics", () => {
  it("caps video bitrate lower on mobile", () => {
    expect(videoMaxBitrateFor(true)).toBe(600_000);
    expect(videoMaxBitrateFor(false)).toBe(1_200_000);
    expect(isMobileUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)")).toBe(true);
    expect(isMobileUserAgent("Mozilla/5.0 (Linux; Android 13; Pixel 7)")).toBe(true);
    expect(isMobileUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 12_6)")).toBe(false);
  });

  it("classifies ICE candidate types", () => {
    expect(classifyCandidate("candidate:1 1 udp 2113937151 192.168.1.2 5000 typ host generation 0")).toBe("host");
    expect(classifyCandidate("candidate:2 1 udp 1677729535 1.2.3.4 5000 typ srflx raddr 0.0.0.0 rport 0")).toBe("srflx");
    expect(classifyCandidate("candidate:3 1 udp 33562623 5.6.7.8 3478 typ relay raddr 0.0.0.0 rport 0")).toBe("relay");
    expect(classifyCandidate("")).toBe("unknown");
    expect(classifyCandidate(null)).toBe("unknown");
  });
});

describe("optimizeOpusSdp", () => {
  const base = [
    "v=0",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111 0",
    "a=rtpmap:111 opus/48000/2",
    "a=fmtp:111 minptime=10;useinbandfec=0",
    "a=rtpmap:0 PCMU/8000",
    "",
  ].join("\r\n");

  it("rewrites an existing opus fmtp line with DTX/FEC/mono/32k", () => {
    const out = optimizeOpusSdp(base);
    const line = out.split(/\r?\n/).find((l) => l.startsWith("a=fmtp:111"))!;
    expect(line).toContain("useinbandfec=1");
    expect(line).toContain("usedtx=1");
    expect(line).toContain("stereo=0");
    expect(line).toContain("sprop-stereo=0");
    expect(line).toContain("maxaveragebitrate=32000");
    expect(line).toContain("minptime=10");
    expect(line).not.toContain("useinbandfec=0");
    expect(out.split(/\r?\n/).filter((l) => l.startsWith("a=fmtp:111"))).toHaveLength(1);
  });

  it("inserts an fmtp line when there is none", () => {
    const noFmtp = base.replace("a=fmtp:111 minptime=10;useinbandfec=0\r\n", "");
    const out = optimizeOpusSdp(noFmtp);
    expect(out).toMatch(/a=fmtp:111 useinbandfec=1;usedtx=1;stereo=0;sprop-stereo=0;maxaveragebitrate=32000/);
  });

  it("leaves SDP without opus untouched", () => {
    const sdp = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\n";
    expect(optimizeOpusSdp(sdp)).toBe(sdp);
    expect(optimizeOpusSdp("")).toBe("");
  });
});

describe("SignalQueue", () => {
  it("keeps messages in order and drops ones older than the TTL", () => {
    const q = new SignalQueue<string>(15_000);
    q.push("a", 0);
    q.push("b", 10_000);
    q.push("c", 20_000);
    expect(q.size).toBe(3);
    expect(q.drain(16_000)).toEqual(["b", "c"]);
    expect(q.size).toBe(0);
  });

  it("prune drops only expired entries and keeps the rest queued", () => {
    const q = new SignalQueue<string>(15_000);
    q.push("old", 0);
    q.push("fresh", 10_000);
    expect(q.prune(16_000)).toBe(1);
    expect(q.size).toBe(1);
    expect(q.drain(16_000)).toEqual(["fresh"]);
  });

  it("drain on an empty queue is a no-op", () => {
    const q = new SignalQueue<number>(1000);
    expect(q.drain(0)).toEqual([]);
    q.push(1, 0);
    q.clear();
    expect(q.drain(0)).toEqual([]);
  });
});

describe("signal names", () => {
  it("round-trips voice and video prefixes", () => {
    expect(signalName("end", "video")).toBe("call-end");
    expect(signalName("end", "voice")).toBe("voice-leave");
    expect(signalName("busy", "voice")).toBe("voice-call-busy");
    expect(signalKindOf("voice-offer")).toBe("offer");
    expect(signalKindOf("call-ice-candidate")).toBe("ice");
    expect(signalKindOf("call-toggle-video")).toBeNull();
  });
});

describe("gateIncomingCallMessage", () => {
  it("handles a request while idle-like, from anyone", () => {
    expect(gateIncomingCallMessage({ type: "call-request", from: "x", state: "idle", peer: null })).toBe("handle");
    expect(gateIncomingCallMessage({ type: "voice-call-request", from: "x", state: "failed-network", peer: "old" })).toBe("handle");
  });

  it("replies busy to a third party's request during a call", () => {
    expect(gateIncomingCallMessage({ type: "call-request", from: "z", state: "connected", peer: "y" })).toBe("busy");
    expect(gateIncomingCallMessage({ type: "call-request", from: "z", state: "ringing", peer: "y" })).toBe("busy");
    expect(gateIncomingCallMessage({ type: "call-request", from: "z", state: "calling", peer: "y" })).toBe("busy");
  });

  it("treats the peer's own request while we are calling them as the mutual-call case", () => {
    expect(gateIncomingCallMessage({ type: "call-request", from: "y", state: "calling", peer: "y" })).toBe("handle");
    // ...but a duplicate request from the peer mid-call is just noise
    expect(gateIncomingCallMessage({ type: "call-request", from: "y", state: "connected", peer: "y" })).toBe("ignore");
  });

  it("ignores any non-request signalling that is not from the current peer", () => {
    expect(gateIncomingCallMessage({ type: "call-offer", from: "z", state: "connecting", peer: "y" })).toBe("ignore");
    expect(gateIncomingCallMessage({ type: "call-end", from: "z", state: "connected", peer: "y" })).toBe("ignore");
    expect(gateIncomingCallMessage({ type: "call-ice-candidate", from: undefined, state: "connected", peer: "y" })).toBe("ignore");
    expect(gateIncomingCallMessage({ type: "call-offer", from: "y", state: "connecting", peer: "y" })).toBe("handle");
  });

  it("ignores stale signalling once idle", () => {
    expect(gateIncomingCallMessage({ type: "call-end", from: "y", state: "idle", peer: null })).toBe("ignore");
    expect(gateIncomingCallMessage({ type: "call-answer", from: "y", state: "ended", peer: "y" })).toBe("ignore");
  });

  it("lets server-originated busy/unavailable through without a from field", () => {
    expect(gateIncomingCallMessage({ type: "call-unavailable", from: undefined, state: "calling", peer: "y" })).toBe("handle");
    expect(gateIncomingCallMessage({ type: "call-busy", from: "y", state: "calling", peer: "y" })).toBe("handle");
    expect(gateIncomingCallMessage({ type: "call-busy", from: "q", state: "calling", peer: "y" })).toBe("ignore");
  });
});
