// Web-Audio sound effect helpers for Kentro Draught.
// Extracted from App.tsx -- every function is a pure fire-and-forget synth
// call so they can be imported anywhere without pulling in React state.

// A single AudioContext shared by every sound in the app. Contexts are
// expensive to spin up and browsers cap how many can stay alive at once --
// the old code here created (and never closed) a fresh one on every click,
// capture, promotion, ring, etc. A session with a few dozen moves would
// pile up a few dozen contexts, and once a browser's ceiling was hit,
// `new AudioContext()` started failing (silently, inside the try/catch),
// which is what "the music stops playing well" over time. One persistent,
// resumed-on-demand context fixes that everywhere it's used.
let sharedCtx: AudioContext | null = null;

export function getAudioContext(): AudioContext | null {
  try {
    if (!sharedCtx) {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return null;
      sharedCtx = new Ctor();
    }
    // Mobile browsers auto-suspend the context when the tab/app is
    // backgrounded; resuming is a harmless no-op when already running, but
    // skipping it means sounds go silently dead after you switch apps and
    // come back mid-game.
    if (sharedCtx.state === "suspended") {
      sharedCtx.resume().catch(() => {});
    }
    return sharedCtx;
  } catch {
    return null;
  }
}

export const playClickSound = (muted: boolean) => {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(160, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(70, ctx.currentTime + 0.07);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.07);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  } catch (e) {}
};

export const playCaptureSound = (muted: boolean) => {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    [now, now + 0.05].forEach((time, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(280 - index * 50, time);
      osc.frequency.exponentialRampToValueAtTime(140, time + 0.04);
      gain.gain.setValueAtTime(0.22, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.04);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(time);
      osc.stop(time + 0.05);
    });
  } catch (e) {}
};

export const playPromoSound = (muted: boolean) => {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    [now, now + 0.08, now + 0.16].forEach((time, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      const freqs = [261.6, 329.6, 392.0]; // C, E, G
      osc.frequency.setValueAtTime(freqs[index], time);
      gain.gain.setValueAtTime(0.15, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(time);
      osc.stop(time + 0.16);
    });
  } catch (e) {}
};

export const playGameStartSound = (muted: boolean) => {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    [329.63, 440.00].forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + index * 0.1);
      gain.gain.setValueAtTime(0.12, now + index * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.01, now + index * 0.1 + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + index * 0.1);
      osc.stop(now + index * 0.1 + 0.22);
    });
  } catch (e) {}
};

export const playVictorySound = (muted: boolean) => {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const notes = [261.63, 329.63, 392.00, 523.25];
    notes.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      const startTime = now + index * 0.08;
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0.15, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.4);
    });
  } catch (e) {}
};

export const playDefeatSound = (muted: boolean) => {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const notes = [311.13, 261.63, 196.00];
    notes.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      const startTime = now + index * 0.12;
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0.15, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.55);
    });
  } catch (e) {}
};

export const playDrawSound = (muted: boolean) => {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const notes = [293.66, 440.00];
    notes.forEach((freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.45);
    });
  } catch (e) {}
};

/** High-priority alert sound for fair-play departures and split-screen violations */
export const playWarningAlertSound = (muted: boolean) => {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const tones = [
      { f: 880, start: 0, dur: 0.12 },
      { f: 659.25, start: 0.14, dur: 0.12 },
      { f: 880, start: 0.28, dur: 0.18 },
    ];
    tones.forEach(({ f, start, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      const s = now + start;
      osc.frequency.setValueAtTime(f, s);
      gain.gain.setValueAtTime(0.2, s);
      gain.gain.exponentialRampToValueAtTime(0.01, s + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(s);
      osc.stop(s + dur + 0.05);
    });
  } catch (e) {}
};

/**
 * Looping phone-style ring sounds for the in-game voice call. Both return
 * a stop() function; callers MUST invoke it (accept/decline/cancel/timeout)
 * or the loop keeps going. Ignores `muted` being toggled mid-ring on
 * purpose -- an actively ringing call should stay audible until answered.
 */
function makeRingLoop(pattern: (ctx: AudioContext, t0: number) => number, muted: boolean): () => void {
  if (muted) return () => {};
  const ctx = getAudioContext();
  if (!ctx) return () => {};
  try {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cycle = () => {
      if (stopped) return;
      const nextIn = pattern(ctx, ctx.currentTime);
      timer = setTimeout(cycle, nextIn * 1000);
    };
    cycle();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      // Don't close the context here -- it's shared with every other sound
      // in the app now, not owned exclusively by this ring loop.
    };
  } catch {
    return () => {};
  }
}

/** Classic incoming-call double ring: bright dual-tone bursts. */
export const startVoiceRingtone = (muted: boolean): (() => void) =>
  makeRingLoop((ctx, t0) => {
    for (let burst = 0; burst < 2; burst++) {
      const start = t0 + burst * 0.45;
      for (const freq of [880, 1100]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(0.16, start + 0.03);
        gain.gain.setValueAtTime(0.16, start + 0.28);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.36);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(start); osc.stop(start + 0.38);
      }
    }
    return 2.4; // ring-ring … pause … repeat
  }, muted);

/** Outgoing ringback: the long single tone you hear while they ring. */
export const startVoiceRingback = (muted: boolean): (() => void) =>
  makeRingLoop((ctx, t0) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(425, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(0.1, t0 + 0.05);
    gain.gain.setValueAtTime(0.1, t0 + 1.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.25);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + 1.3);
    return 4.0; // 1.2s tone + 2.8s silence, telecom style
  }, muted);

/** Pleasant chime played when WebRTC peer connection connects */
export const playCallConnectedChime = (muted: boolean) => {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, idx) => {
      const start = now + idx * 0.08;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.14, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  } catch {}
};

/** Gentle descending chime played when a call ends */
export const playCallEndedChime = (muted: boolean) => {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const notes = [659.25, 440.0]; // E5 -> A4
    notes.forEach((freq, idx) => {
      const start = now + idx * 0.12;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.32);
    });
  } catch {}
};

