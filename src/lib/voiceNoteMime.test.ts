import { describe, it, expect } from "vitest";
import { VOICE_NOTE_MIME_CANDIDATES, blobTypeFor, pickRecordingMimeType } from "./voiceNoteMime";

describe("pickRecordingMimeType", () => {
  it("prefers Opus in WebM when the browser supports it (Chrome/Firefox)", () => {
    const supported = new Set(["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]);
    expect(pickRecordingMimeType((t) => supported.has(t))).toBe("audio/webm;codecs=opus");
  });

  it("falls back to MP4 on Safari, which has no WebM encoder", () => {
    const supported = new Set(["audio/mp4"]);
    expect(pickRecordingMimeType((t) => supported.has(t))).toBe("audio/mp4");
  });

  it("returns undefined (recorder default) when nothing is reported as supported", () => {
    expect(pickRecordingMimeType(() => false)).toBeUndefined();
  });

  it("returns undefined when isTypeSupported is missing (very old engines)", () => {
    expect(pickRecordingMimeType(undefined)).toBeUndefined();
    expect(pickRecordingMimeType(null)).toBeUndefined();
  });

  it("survives an isTypeSupported that throws on unknown containers", () => {
    const picky = (t: string) => {
      if (t.startsWith("audio/webm")) throw new Error("NotSupportedError");
      return t === "audio/mp4";
    };
    expect(pickRecordingMimeType(picky)).toBe("audio/mp4");
  });

  it("never hard-codes audio/webm as the only option", () => {
    expect(VOICE_NOTE_MIME_CANDIDATES.length).toBeGreaterThan(1);
    expect(VOICE_NOTE_MIME_CANDIDATES).toContain("audio/mp4");
  });
});

describe("blobTypeFor", () => {
  it("uses what the recorder reports first, then the pick, then webm", () => {
    expect(blobTypeFor("audio/mp4", "audio/webm")).toBe("audio/mp4");
    expect(blobTypeFor("", "audio/webm;codecs=opus")).toBe("audio/webm;codecs=opus");
    expect(blobTypeFor(undefined, undefined)).toBe("audio/webm");
  });
});
