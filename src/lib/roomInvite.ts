/** The online-play server accepts at most ten alphanumeric room-code characters. */
export function cleanInviteRoomCode(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 10);
}

/** Use a same-origin HTTPS link so tapping it opens the actual room in a browser/PWA. */
export function makeRoomInviteUrl(roomCode: string, origin: string): string {
  const code = cleanInviteRoomCode(roomCode);
  if (!code) throw new Error("A room code is required to make an invitation.");
  const url = new URL("/", origin);
  url.searchParams.set("room", code);
  return url.toString();
}

/** Accept our canonical link as well as older ?join= and ?code= invitations. */
export function getRoomCodeFromUrl(search: string): string | null {
  const params = new URLSearchParams(search);
  const raw = params.get("room") || params.get("join") || params.get("code");
  const code = raw ? cleanInviteRoomCode(raw) : "";
  return code || null;
}

/** Retain unrelated query parameters and the URL fragment on accepting/dismissing. */
export function removeRoomInviteFromUrl(currentUrl: string): string {
  const url = new URL(currentUrl);
  for (const key of ["room", "join", "code"]) url.searchParams.delete(key);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Safe copy on modern HTTPS browsers, with a fallback for older mobile browsers. */
export async function copyInviteText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Permissions-denied/unsupported clipboard: try the selection fallback.
    }
  }
  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    throw new Error("Clipboard is unavailable in this browser.");
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  try {
    input.select();
    if (!document.execCommand("copy")) throw new Error("Clipboard copy was rejected.");
  } finally {
    input.remove();
  }
}
