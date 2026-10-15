// Login sessions for online play (protocol §1).
//
// One session per username (case-insensitive). A session owns a random
// 32-hex token minted at first login; presenting that token later is the
// ONLY way to take over the name from another live socket or to reclaim a
// seat that is in disconnect grace. A session with no socket expires after
// `ttlMs`, unless `keepAlive(session)` says the user still holds something
// worth keeping (a seat in a live game) -- then the check is re-armed.
import { randomBytes } from "crypto";

export interface Session {
  username: string;
  key: string;
  token: string;
  ws: any | null;
  userId: string | null;
  createdAt: number;
  detachedAt: number | null;
  expireTimer: NodeJS.Timeout | null;
}

export interface SessionStoreOptions {
  ttlMs: number;
  /** Called when a session finally expires (socket-less for `ttlMs`). */
  onExpire: (session: Session) => void;
  /** Return true to postpone expiry for another `ttlMs` (e.g. seat in a live game). */
  keepAlive?: (session: Session) => boolean;
}

export function mintSessionToken(): string {
  return randomBytes(16).toString("hex");
}

export class SessionStore {
  private byKey = new Map<string, Session>();

  constructor(private readonly opts: SessionStoreOptions) {}

  get size(): number {
    return this.byKey.size;
  }

  get(key: string): Session | undefined {
    return this.byKey.get(key);
  }

  /** Creates a brand-new session for `username`, replacing any existing one for that key. */
  create(username: string, userId: string | null): Session {
    const key = username.toLowerCase();
    const old = this.byKey.get(key);
    if (old) this.remove(old);
    const s: Session = {
      username,
      key,
      token: mintSessionToken(),
      ws: null,
      userId,
      createdAt: Date.now(),
      detachedAt: null,
      expireTimer: null,
    };
    this.byKey.set(key, s);
    return s;
  }

  attach(s: Session, ws: any): void {
    if (s.expireTimer) {
      clearTimeout(s.expireTimer);
      s.expireTimer = null;
    }
    s.ws = ws;
    s.detachedAt = null;
  }

  /** The session's socket went away: start the TTL countdown. */
  detach(s: Session): void {
    s.ws = null;
    s.detachedAt = Date.now();
    this.armExpiry(s);
  }

  remove(s: Session): void {
    if (s.expireTimer) {
      clearTimeout(s.expireTimer);
      s.expireTimer = null;
    }
    if (this.byKey.get(s.key) === s) this.byKey.delete(s.key);
  }

  /** Release expiry timers when the owning WebSocket server shuts down. */
  dispose(): void {
    for (const session of this.byKey.values()) this.remove(session);
  }

  private armExpiry(s: Session): void {
    if (s.expireTimer) clearTimeout(s.expireTimer);
    s.expireTimer = setTimeout(() => {
      s.expireTimer = null;
      try {
        if (s.ws) return; // re-attached meanwhile
        if (this.byKey.get(s.key) !== s) return; // replaced meanwhile
        if (this.opts.keepAlive && this.opts.keepAlive(s)) {
          this.armExpiry(s);
          return;
        }
        this.byKey.delete(s.key);
        this.opts.onExpire(s);
      } catch (err) {
        console.error(`[Sessions] expiry handler failed for ${s.username}:`, err);
      }
    }, this.opts.ttlMs);
  }
}
