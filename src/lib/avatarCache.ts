/**
 * Tiny read-through cache for player avatars: any component can ask for a
 * username's picture and the profiles table is hit AT MOST once per name
 * per session, no matter how many chat messages or scoreboards show it.
 */
import { supabase } from "../supabase";

const cache = new Map<string, Promise<string | null>>();

/** Names that are never real accounts -- resolve instantly, no network. */
const NON_PLAYER = /^(ken( level)? ?\d*|you|white( player)?|black( player)?|guest|system)$/i;

export function getAvatarUrl(username: string | null | undefined): Promise<string | null> {
  const name = (username || "").trim();
  if (!name || NON_PLAYER.test(name)) return Promise.resolve(null);
  const key = name.toLowerCase();
  let p = cache.get(key);
  if (!p) {
    // Supabase builders are PromiseLike (thenable) without .catch -- wrap
    // in a real async fn so failures resolve to null instead of throwing.
    p = (async () => {
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
    cache.set(key, p);
  }
  return p;
}

/** Instant, network-free entry -- used for the signed-in player's own
 *  picture (already in memory) and right after a new upload. */
export function primeAvatar(username: string | null | undefined, url: string | null) {
  const key = (username || "").trim().toLowerCase();
  if (key) cache.set(key, Promise.resolve(url));
}
