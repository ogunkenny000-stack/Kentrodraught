/** Server-side guest online trials. In production use the atomic Postgres RPC
 * from supabase/guest_trials.sql. Never fall back to a fresh allowance when
 * the configured database fails: that would silently bypass guest limits.
 * In local development without Supabase the same rules use process memory. */
import { getSupabaseAdmin } from '../../supabaseAdmin';

export const GUEST_ONLINE_MAX = 1;
const GUEST_RE = /^KGuest_[a-f0-9]{20}$/;
const localUsed = new Set<string>();
export function isOnlineGuest(name: string): boolean { return GUEST_RE.test(name); }
function durableEnabled(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}
export async function guestHasOnlineTrial(name: string): Promise<boolean> {
  if (!isOnlineGuest(name)) return true;
  if (!durableEnabled()) return !localUsed.has(name);
  const { data, error } = await getSupabaseAdmin().rpc('guest_online_available', { p_guest: name });
  if (error) throw error;
  return data === true;
}
/** Atomically consumes at most one game per guest. Returns false without
 * consuming anyone's trial if any guest in the roster is already exhausted. */
export async function claimOnlineGuestTrials(usernames: string[]): Promise<boolean> {
  const guests = [...new Set(usernames.filter(isOnlineGuest))];
  if (!guests.length) return true;
  if (!durableEnabled()) {
    if (guests.some(name => localUsed.has(name))) return false;
    guests.forEach(name => localUsed.add(name));
    return true;
  }
  const { data, error } = await getSupabaseAdmin().rpc('claim_guest_online_games', { p_guests: guests });
  if (error) throw error;
  return data === true;
}
