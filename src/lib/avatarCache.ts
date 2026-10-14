/**
 * Tiny read-through cache for player avatars: any component can ask for a
 * username's picture and repeated chat/scoreboard entries share one lookup.
 * Cache size and age are bounded so it stays small on older phones.
 */
import { supabase } from "../supabase";

// Bounded LRU: player directories and chats can contain thousands of names.
// Keep no more than 320 resolved/pending promises in a low-memory phone.
const MAX_CACHED_AVATARS = 320;
const cache = new Map<string, { promise: Promise<string | null>; expires: number }>();
function retain(key: string, promise: Promise<string | null>, ttlMs: number): void {
  cache.delete(key);
  cache.set(key, { promise, expires: Date.now() + ttlMs });
  while (cache.size > MAX_CACHED_AVATARS) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

/** Names that are never real accounts -- resolve instantly, no network. */
const NON_PLAYER = /^(ken( level)? ?\d*|you|white( player)?|black( player)?|guest|system)$/i;

export function getAvatarUrl(username: string | null | undefined): Promise<string | null> {
  const name = (username || "").trim();
  if (!name || NON_PLAYER.test(name)) return Promise.resolve(null);
  const key = name.toLowerCase();
  const found = cache.get(key);
  if (found && found.expires > Date.now()) {
    // Touch this entry so frequently visible players stay cached.
    cache.delete(key);
    cache.set(key, found);
    return found.promise;
  }
  if (found) cache.delete(key);
  // Supabase builders are PromiseLike (thenable) without .catch -- wrap
    // in a real async fn so failures resolve to null instead of throwing.
    const p = (async () => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("avatarUrl")
          .eq("usernameLower", key)
          .maybeSingle();
        return (data?.avatarUrl as string | undefined) ?? null;
      } catch {
        return null;
      }
    })();
    // Avatar changes are primed by the profile editor immediately; the TTL
    // bounds stale results when another player edits their profile.
  retain(key, p, 45 * 60_000);
  return p;
}

/** Instant, network-free entry -- used for the signed-in player's own
 *  picture (already in memory) and right after a new upload. */
export function primeAvatar(username: string | null | undefined, url: string | null) {
  const key = (username || "").trim().toLowerCase();
  if (key) retain(key, Promise.resolve(url), 45 * 60_000);
}
