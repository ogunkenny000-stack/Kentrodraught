// Picks a MediaRecorder container the current browser can actually produce.
// Safari has no WebM encoder (it throws on `mimeType: "audio/webm"`), so
// the candidates run Opus/WebM first, then MP4/AAC, then the recorder's own
// default when nothing is reported as supported.

export const VOICE_NOTE_MIME_CANDIDATES: readonly string[] = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

/**
 * Returns the first supported candidate, or `undefined` when the recorder
 * should be created without a `mimeType` (browser default).
 */
export function pickRecordingMimeType(
  isTypeSupported: ((type: string) => boolean) | undefined | null
): string | undefined {
  if (typeof isTypeSupported !== "function") return undefined;
  for (const candidate of VOICE_NOTE_MIME_CANDIDATES) {
    try {
      if (isTypeSupported(candidate)) return candidate;
    } catch {
      // Some engines throw on unknown containers; keep looking.
    }
  }
  return undefined;
}

/** The type to stamp on the assembled Blob: what the recorder reports, else the pick, else webm. */
export function blobTypeFor(recorderMimeType: string | undefined | null, picked: string | undefined): string {
  return recorderMimeType || picked || "audio/webm";
}
