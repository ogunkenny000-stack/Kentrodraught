// Singleton WebSocket manager for online play (docs/ONLINE_PLAY_PROTOCOL.md).
//
// Responsibilities:
//   - owns the ONE live socket; close/error events from superseded sockets
//     are ignored so a stale socket can never clobber the live one (H1)
//   - send(msg): queues while CONNECTING, refuses non-idempotent game
//     actions while disconnected and reports that as a UI event (H2)
//   - exponential backoff 250 ms -> 5 s with jitter (M6)
//   - app-level ping every 5 s, reconnect after 2 missed pongs, and a
//     server-time offset refreshed from every pong (contract section 5)
//   - session token persisted in localStorage (sessionStorage fallback) under `kd.session.<user>`
//     and presented with every login; `session-replaced` stops reconnecting
//     (contract section 1)
//
// Nothing in here knows about React -- App subscribes once and routes
// messages through a "latest handler" ref.

import { CLIENT_PING_INTERVAL_MS } from "../shared/protocol";

export type SocketStatus = "connecting" | "connected" | "disconnected";

export type GameSocketEvent =
  | { kind: "status"; status: SocketStatus; socket: WebSocket | null; attempts?: number }
  | { kind: "message"; data: any }
  | { kind: "send-refused"; type: string; reason: "disconnected" | "stopped" }
  | { kind: "session-replaced" }
  | { kind: "offset"; offset: number }
  | { kind: "ping"; ping: number };

export type GameSocketListener = (ev: GameSocketEvent) => void;

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export interface GameSocketOptions {
  /** Builds the socket URL (defaults to the page origin). */
  url?: () => string;
  /** Injectable WebSocket constructor (tests pass a fake). */
  WebSocketImpl?: new (url: string) => WebSocket;
  /** Injectable storage (defaults to window.sessionStorage). */
  storage?: StorageLike | null;
  now?: () => number;
  random?: () => number;
  pingIntervalMs?: number;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /** Max messages held while connecting / waiting for a reconnect. */
  maxQueue?: number;
}

/** Messages that must never be silently replayed later -- refused while down. */
export const NON_IDEMPOTENT_TYPES: ReadonlySet<string> = new Set([
  "make-move",
  "resign",
  "offer-draw",
  "draw-response",
  "resign-response",
  "cancel-draw",
  "cancel-resign",
  "rematch-request",
  "rematch-response",
  "rematch-cancel",
  "game-reset",
  "place-starting-king",
  "remove-front-row-piece",
  "chat",
  "emoji-reaction",
  "ready",
  "start-game",
  "set-clock",
  "leave-room",
  "create-room",
  "join-room",
  "join-room-accept",
  "join-room-refuse",
  "cancel-room",
  "spectate-room",
  "leave-spectate",
]);

export const SESSION_KEY_PREFIX = "kd.session.";

export function sessionKeyFor(username: string): string {
  return `${SESSION_KEY_PREFIX}${username}`;
}

const WS_OPEN = 1;

function defaultUrl(): string {
  if (typeof window === "undefined") return "ws://localhost";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}

function defaultStorage(): StorageLike | null {
  // localStorage first: the token must survive closing the tab (a phone user
  // who reopens the app must get their seat back, not "name-taken"). Fall
  // back to sessionStorage where localStorage is blocked.
  for (const pick of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      if (typeof window === "undefined") return null;
      const st = pick();
      if (st) {
        st.setItem("kd.storage.probe", "1");
        st.removeItem("kd.storage.probe");
        return st;
      }
    } catch {
      // storage blocked (private mode / sandboxed iframe) -- try the next one
    }
  }
  return null;
}

export class GameSocket {
  private ws: WebSocket | null = null;
  private username: string | null = null;
  private accessToken: string | null = null;
  private status: SocketStatus = "disconnected";
  private listeners = new Set<GameSocketListener>();
  private queue: object[] = [];
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pendingPings = 0;
  /** True when auto-reconnect is disabled (signed out, session replaced, name taken). */
  private stopped = true;
  private offset = 0;
  private loggedIn = false;
  private currentPing = 0;
  private lastPingSentAt = 0;

  private readonly urlFn: () => string;
  private readonly WS: new (url: string) => WebSocket;
  private readonly storage: StorageLike | null;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly pingIntervalMs: number;
  private readonly minBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly maxQueue: number;

  constructor(opts: GameSocketOptions = {}) {
    this.urlFn = opts.url ?? defaultUrl;
    this.WS = opts.WebSocketImpl ?? (typeof WebSocket !== "undefined" ? WebSocket : (null as any));
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.now = opts.now ?? (() => Date.now());
    this.random = opts.random ?? Math.random;
    this.pingIntervalMs = opts.pingIntervalMs ?? CLIENT_PING_INTERVAL_MS;
    this.minBackoffMs = opts.minBackoffMs ?? 250;
    this.maxBackoffMs = opts.maxBackoffMs ?? 5_000;
    this.maxQueue = opts.maxQueue ?? 50;

    if (typeof window !== "undefined") {
      const onWakeOrOnline = () => {
        if (this.stopped || !this.username) return;
        if (this.status === "disconnected") {
          this.attempts = 0;
          this.clearReconnectTimer();
          this.open();
        } else if (this.status === "connected" && this.ws && this.ws.readyState === WS_OPEN) {
          try {
            this.ws.send(JSON.stringify({ type: "ping", t: this.now() }));
          } catch {
            this.forceReconnect();
          }
        }
      };

      window.addEventListener("online", onWakeOrOnline);
      window.addEventListener("focus", onWakeOrOnline);
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") {
            onWakeOrOnline();
          }
        });
      }
    }
  }

  // ------------------------------------------------------------------ public

  getStatus(): SocketStatus {
    return this.status;
  }

  /** The number of reconnect attempts made so far. */
  getAttempts(): number {
    return this.attempts;
  }

  /** The live socket while connected (legacy consumers such as the WebRTC hook). */
  getSocket(): WebSocket | null {
    return this.status === "connected" ? this.ws : null;
  }

  /** `serverNow - Date.now()` as last measured (login-success / pong / clock). */
  getServerOffset(): number {
    return this.offset;
  }

  setServerOffset(offset: number): void {
    if (!Number.isFinite(offset)) return;
    this.offset = offset;
    this.emit({ kind: "offset", offset });
  }

  serverNow(): number {
    return this.now() + this.offset;
  }

  getPing(): number {
    return this.currentPing;
  }

  getUsername(): string | null {
    return this.username;
  }

  isStopped(): boolean {
    return this.stopped;
  }

  /** Best-effort Supabase access token, sent with the next login. */
  setAccessToken(token: string | null): void {
    this.accessToken = token || null;
  }

  getSessionToken(username = this.username): string | null {
    if (!username || !this.storage) return null;
    try {
      return this.storage.getItem(sessionKeyFor(username));
    } catch {
      return null;
    }
  }

  subscribe(listener: GameSocketListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Connect (or switch user). Idempotent for the same username while live. */
  connect(username: string): void {
    if (!username) return;
    const sameUser = this.username === username;
    if (sameUser && this.ws && (this.status === "connected" || this.status === "connecting")) {
      this.stopped = false;
      return;
    }
    if (!sameUser) this.queue = [];
    this.username = username;
    this.stopped = false;
    this.attempts = 0;
    this.clearReconnectTimer();
    this.open();
  }

  /** Sign-out: close for good and never auto-reconnect. */
  disconnect(): void {
    this.username = null;
    this.stopped = true;
    this.loggedIn = false;
    this.queue = [];
    this.clearReconnectTimer();
    this.teardownSocket();
    this.setStatus("disconnected");
  }

  /** Stop the reconnect loop (name-taken, session replaced) but remember the user. */
  pause(): void {
    this.stopped = true;
    this.queue = [];
    this.clearReconnectTimer();
    this.teardownSocket();
    this.setStatus("disconnected");
  }

  /** Manual reconnect from the UI: resets backoff and connects right away. */
  reconnectNow(): void {
    if (!this.username) return;
    this.stopped = false;
    this.attempts = 0;
    this.clearReconnectTimer();
    if (this.status === "connected" && this.ws && this.ws.readyState === WS_OPEN) return;
    this.teardownSocket();
    this.open();
  }

  /**
   * Send a message. Returns true when sent or queued, false when refused.
   * Queued idempotent messages are flushed only after `login-success`.
   */
  send(msg: { type: string } & Record<string, unknown>): boolean {
    const type = msg.type;
    if (this.loggedIn && this.status === "connected" && this.ws && this.ws.readyState === WS_OPEN) {
      try {
        this.ws.send(JSON.stringify(msg));
        return true;
      } catch {
        // fall through to queue / refuse logic below
      }
    }
    if (this.stopped || NON_IDEMPOTENT_TYPES.has(type)) {
      this.emit({ kind: "send-refused", type, reason: this.stopped ? "stopped" : "disconnected" });
      return false;
    }
    this.enqueue(msg);
    return true;
  }

  // ----------------------------------------------------------------- private

  private enqueue(msg: object): void {
    if (this.queue.length >= this.maxQueue) this.queue.shift();
    this.queue.push(msg);
  }

  private emit(ev: GameSocketEvent): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(ev);
      } catch (err) {
        console.error("[gameSocket] listener error:", err);
      }
    }
  }

  private setStatus(status: SocketStatus, attempts = this.attempts): void {
    if (this.status === status) return;
    this.status = status;
    this.emit({ kind: "status", status, socket: status === "connected" ? this.ws : null, attempts });
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.pendingPings = 0;
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WS_OPEN) return;
      if (this.pendingPings >= 2) {
        // Two pings unanswered: the link is dead even if the OS hasn't
        // noticed yet. Drop it and reconnect.
        this.forceReconnect();
        return;
      }
      this.pendingPings += 1;
      this.lastPingSentAt = this.now();
      try {
        this.ws.send(JSON.stringify({ type: "ping", t: this.lastPingSentAt }));
      } catch {
        this.forceReconnect();
      }
    }, this.pingIntervalMs);
  }

  /** Detach the current socket so its later close/error events are ignored. */
  private teardownSocket(): void {
    this.stopPing();
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
    const s = this.ws;
    this.ws = null;
    this.loggedIn = false;
    if (s) {
      try {
        s.onopen = null;
        s.onmessage = null;
        s.onclose = null;
        s.onerror = null;
        s.close();
      } catch {
        // already closed
      }
    }
  }

  private forceReconnect(): void {
    this.teardownSocket();
    this.setStatus("disconnected");
    this.scheduleReconnect();
  }

  private open(): void {
    if (!this.username || !this.WS) return;
    this.clearReconnectTimer();
    this.teardownSocket();

    let socket: WebSocket;
    try {
      socket = new this.WS(this.urlFn());
    } catch (err) {
      console.error("[gameSocket] failed to create socket:", err);
      this.setStatus("disconnected");
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;
    this.setStatus("connecting");
    // Bound both a stalled transport handshake and a missing login response.
    this.connectTimer = setTimeout(() => {
      if (socket === this.ws && !this.loggedIn) this.forceReconnect();
    }, 8000);

    socket.onopen = () => {
      if (socket !== this.ws) return; // superseded
      this.sendLogin(socket);
      // Transport-open is not authenticated readiness. A login failure must
      // never replay queued room actions under an unverified identity.
      this.startPing();
    };

    socket.onmessage = (event: MessageEvent) => {
      if (socket !== this.ws) return; // superseded
      let data: any;
      try {
        data = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
      } catch (err) {
        console.error("[gameSocket] bad JSON from server:", err);
        return;
      }
      this.handleIncoming(data);
    };

    socket.onclose = () => {
      if (socket !== this.ws) return; // superseded -- never clobber the live socket
      this.ws = null;
      this.loggedIn = false;
      this.stopPing();
      this.setStatus("disconnected");
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      if (socket !== this.ws) return;
      try {
        socket.close();
      } catch {
        // ignore
      }
    };
  }

  private sendLogin(socket: WebSocket): void {
    if (!this.username) return;
    const login: Record<string, unknown> = { type: "login", username: this.username };
    const token = this.getSessionToken(this.username);
    if (token) login.sessionToken = token;
    if (this.accessToken) login.accessToken = this.accessToken;
    try {
      socket.send(JSON.stringify(login));
    } catch (err) {
      console.error("[gameSocket] login send failed:", err);
    }
  }

  private flushQueue(socket: WebSocket): void {
    if (!this.loggedIn || socket !== this.ws || socket.readyState !== WS_OPEN) return;
    const pending = this.queue;
    this.queue = [];
    for (const msg of pending) {
      try {
        socket.send(JSON.stringify(msg));
      } catch (err) {
        console.error("[gameSocket] flush failed:", err);
      }
    }
  }

  private handleIncoming(data: any): void {
    if (!data || typeof data !== "object") return;
    switch (data.type) {
      case "pong": {
        this.pendingPings = 0;
        const sentAt = typeof data.t === "number" && data.t > 0 ? data.t : this.lastPingSentAt;
        if (sentAt > 0) {
          const rtt = Math.max(1, this.now() - sentAt);
          this.currentPing = this.currentPing === 0 ? rtt : Math.round(this.currentPing * 0.65 + rtt * 0.35);
          this.emit({ kind: "ping", ping: this.currentPing });
        }
        if (typeof data.serverNow === "number") {
          this.setServerOffset(data.serverNow - this.now());
        }
        break;
      }
      case "login-success": {
        if (this.connectTimer) clearTimeout(this.connectTimer);
        this.connectTimer = null;
        this.loggedIn = true;
        this.attempts = 0;
        this.setStatus("connected");
        if (this.ws) this.flushQueue(this.ws);
        if (typeof data.sessionToken === "string" && data.sessionToken && this.username && this.storage) {
          try {
            this.storage.setItem(sessionKeyFor(this.username), data.sessionToken);
          } catch {
            // storage full / blocked -- reconnects will simply lack the token
          }
        }
        if (typeof data.serverNow === "number") {
          this.setServerOffset(data.serverNow - this.now());
        }
        break;
      }
      case "session-replaced": {
        // Another tab/device took over this username with the session token.
        // Stop reconnecting: doing so would just bounce the two clients.
        this.stopped = true;
        this.queue = [];
        this.clearReconnectTimer();
        this.emit({ kind: "message", data });
        this.emit({ kind: "session-replaced" });
        this.teardownSocket();
        this.setStatus("disconnected");
        return;
      }
      default:
        break;
    }
    this.emit({ kind: "message", data });
  }

  private backoffDelay(): number {
    const base = Math.min(this.maxBackoffMs, this.minBackoffMs * Math.pow(2, Math.max(0, this.attempts - 1)));
    // +/- 25 % jitter so a fleet of clients doesn't reconnect in lockstep.
    const jitter = (this.random() * 2 - 1) * 0.25 * base;
    return Math.max(0, Math.round(base + jitter));
  }

  private scheduleReconnect(): void {
    if (this.stopped || !this.username || this.reconnectTimer) return;
    this.attempts += 1;
    this.emit({ kind: "status", status: "disconnected", socket: null, attempts: this.attempts });
    const delay = this.backoffDelay();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped || !this.username) return;
      this.open();
    }, delay);
  }
}

/** The app-wide singleton. */
export const gameSocket = new GameSocket();

// Dev/e2e hook: lets the browser end-to-end tests (scripts/e2e) simulate a
// dropped connection by reaching the manager. Never present in production.
if (typeof window !== "undefined" && (import.meta as any).env?.DEV) {
  (window as any).__kdGameSocket = gameSocket;
}
