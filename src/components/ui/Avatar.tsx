import { useEffect, useState } from "react";
import { getAvatarUrl } from "../../lib/avatarCache";

/**
 * One avatar to rule them all: shows the player's uploaded picture when
 * they have one, otherwise a colored circle with their initial (the color
 * is derived from the name, so a player is always "their" color everywhere
 * in the app). Give it a `url` when you already have one; give it just a
 * `name` and it fetches through the session cache.
 */
export function Avatar({ name, url, size = 24, className = "" }: {
  name: string;
  url?: string | null;
  size?: number;
  className?: string;
}) {
  const [fetched, setFetched] = useState<string | null>(null);

  useEffect(() => {
    if (url !== undefined) return; // caller supplied (possibly null) -- trust it
    let alive = true;
    getAvatarUrl(name).then((u) => { if (alive) setFetched(u); });
    return () => { alive = false; };
  }, [name, url]);

  const src = url !== undefined ? url : fetched;
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className={`rounded-full object-cover shrink-0 border border-slate-700/60 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={`rounded-full shrink-0 flex items-center justify-center font-extrabold select-none border border-slate-700/40 ${className}`}
      style={{
        width: size, height: size,
        fontSize: Math.max(9, Math.round(size * 0.45)),
        background: `hsl(${hue} 45% 26%)`,
        color: `hsl(${hue} 85% 78%)`,
      }}
      title={name}
    >
      {initial}
    </span>
  );
}
