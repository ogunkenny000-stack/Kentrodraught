/** Guest identity and AI trial counters. This browser-local AI quota is a
 * product trial, not tamper-proof DRM: clearing site data resets it. Online
 * quotas are enforced separately by the game server. */
export const GUEST_AI_LIMIT = 3;
export const GUEST_ONLINE_LIMIT = 1;
const GUEST_ACTIVE = 'kentro.guest.active.v1';
const GUEST_NAME = 'kentro.guest.name.v1';
const AI_COUNT = 'kentro.guest.ai.started.v1';
export const GUEST_AI_SAVE = 'kentro_guest_ai_game_in_progress';
const NAME_RE = /^KGuest_[a-f0-9]{20}$/;

function storage(): Storage | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null; }
  catch { return null; }
}
function readStored(key: string): string | null {
  try { return storage()?.getItem(key) ?? null; } catch { return null; }
}
let transientName: string | null = null;
export function isGuestActive(): boolean { return readStored(GUEST_ACTIVE) === 'true'; }
export function setGuestActive(active: boolean): void {
  try { active ? storage()?.setItem(GUEST_ACTIVE, 'true') : storage()?.removeItem(GUEST_ACTIVE); } catch { /* private mode */ }
}
export function isGuestName(name: string): boolean { return NAME_RE.test(name); }
export function getGuestName(): string {
  const previous = readStored(GUEST_NAME) || transientName || '';
  if (isGuestName(previous)) return previous;
  // Use an unguessable, stable per-browser ID so server reconnects use the same identity.
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  const name = `KGuest_${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
  transientName = name;
  try { storage()?.setItem(GUEST_NAME, name); } catch { /* no persistent storage */ }
  return name;
}
export function getGuestAiUsed(): number {
  const value = Number(readStored(AI_COUNT) ?? '0');
  return Number.isInteger(value) ? Math.max(0, Math.min(GUEST_AI_LIMIT, value)) : 0;
}
export function claimGuestAiGame(): boolean {
  const used = getGuestAiUsed();
  if (used >= GUEST_AI_LIMIT) return false;
  try {
    const local = storage();
    if (!local) return false;
    local.setItem(AI_COUNT, String(used + 1));
  }
  catch { return false; } // Do not advertise a durable quota if persistence is unavailable.
  return true;
}

/** Friendly label for anonymous usernames. Identity used in game messages stays unchanged. */
export function guestDisplayName(name: string): string {
  return isGuestName(name) ? `Guest ${name.slice(-4).toUpperCase()}` : name;
}
