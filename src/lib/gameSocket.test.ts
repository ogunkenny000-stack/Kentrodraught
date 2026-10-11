import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GameSocket, GameSocketEvent, sessionKeyFor, NON_IDEMPOTENT_TYPES } from "./gameSocket";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  sent: any[] = [];
  url: string;
  onopen: ((ev: any) => void) | null = null;
  onmessage: ((ev: any) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    if (this.readyState !== 1) throw new Error("socket not open");
    this.sent.push(JSON.parse(data));
  }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({});
  }

  // --- test helpers ---
  open(authenticate = true) {
    this.readyState = 1;
    this.onopen?.({});
    if (authenticate) this.receive({ type: "login-success" });
  }
  receive(obj: any) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  serverClose() {
    this.readyState = 3;
    this.onclose?.({});
  }
}

class FakeStorage {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? (this.map.get(k) as string) : null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
}

function makeSocket(overrides: Partial<ConstructorParameters<typeof GameSocket>[0]> = {}) {
  const storage = new FakeStorage();
  const events: GameSocketEvent[] = [];
  const gs = new GameSocket({
    url: () => "ws://test",
    WebSocketImpl: FakeWebSocket as any,
    storage,
    random: () => 0.5, // zero jitter -> deterministic backoff
    ...overrides,
  });
  gs.subscribe((ev) => events.push(ev));
  return { gs, storage, events };
}

const last = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

describe("GameSocket", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000_000));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("queues idempotent messages until authentication succeeds", () => {
    const { gs } = makeSocket();
    gs.connect("alice");
    expect(gs.getStatus()).toBe("connecting");
    expect(gs.send({ type: "get-open-rooms" })).toBe(true);
    expect(last().sent).toHaveLength(0);

    last().open(false);
    expect(gs.getStatus()).toBe("connecting");
    expect(last().sent.map((m) => m.type)).toEqual(["login"]);
    last().receive({ type: "login-success" });
    expect(gs.getStatus()).toBe("connected");
    expect(last().sent.map((m) => m.type)).toEqual(["login", "get-open-rooms"]);
    expect(last().sent[0]).toEqual({ type: "login", username: "alice" });
  });

  it("refuses non-idempotent messages while disconnected and reports a UI event", () => {
    const { gs, events } = makeSocket();
    gs.connect("alice");
    last().open();
    last().serverClose();
    expect(gs.getStatus()).toBe("disconnected");

    expect(gs.send({ type: "make-move", move: { from: 1, to: 2, caps: [] } })).toBe(false);
    expect(gs.send({ type: "resign" })).toBe(false);
    expect(gs.send({ type: "offer-draw" })).toBe(false);
    const refused = events.filter((e) => e.kind === "send-refused") as Extract<GameSocketEvent, { kind: "send-refused" }>[];
    expect(refused.map((e) => e.type)).toEqual(["make-move", "resign", "offer-draw"]);

    // Idempotent requests are held and replayed after the next login.
    expect(gs.send({ type: "list-live-rooms" })).toBe(true);
    vi.advanceTimersByTime(1000);
    last().open();
    expect(last().sent.map((m) => m.type)).toEqual(["login", "list-live-rooms"]);
  });

  it("backs off exponentially from 1 s to 30 s", () => {
    const { gs } = makeSocket();
    gs.connect("alice");
    last().open();

    const expected = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
    for (const delay of expected) {
      const count = FakeWebSocket.instances.length;
      last().serverClose();
      vi.advanceTimersByTime(delay - 1);
      expect(FakeWebSocket.instances.length).toBe(count);
      vi.advanceTimersByTime(1);
      expect(FakeWebSocket.instances.length).toBe(count + 1);
      // The attempt stays unanswered (never opens) so the next close keeps escalating.
      last().readyState = 1;
    }

    // A successful login resets the schedule.
    last().onopen?.({});
    last().receive({ type: "login-success", username: "alice", sessionToken: "t", serverNow: 1_000_000, onlineUsers: [] });
    const count = FakeWebSocket.instances.length;
    last().serverClose();
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances.length).toBe(count + 1);
  });

  it("ignores close events from a superseded socket", () => {
    // Long ping interval so the pong watchdog cannot interfere with this scenario.
    const { gs, events } = makeSocket({ pingIntervalMs: 600_000 });
    gs.connect("alice");
    const first = last();
    first.open();
    const staleClose = first.onclose; // capture before it is detached

    // Switching user (or any forced reopen) supersedes the first socket.
    gs.connect("bob");
    const second = last();
    expect(second).not.toBe(first);
    expect(gs.getStatus()).toBe("connecting");

    // Both the detached handler and a late close on the old object are no-ops.
    staleClose?.({});
    first.serverClose();
    expect(gs.getStatus()).toBe("connecting");
    second.open();
    expect(gs.getStatus()).toBe("connected");
    expect(second.sent[0]).toEqual({ type: "login", username: "bob" });

    // reconnectNow() while healthy is a no-op (no needless socket churn).
    gs.reconnectNow();
    expect(last()).toBe(second);

    // No reconnect was scheduled by the stale close.
    const before = FakeWebSocket.instances.length;
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances.length).toBe(before);
    expect(events.filter((e) => e.kind === "status" && e.status === "disconnected")).toHaveLength(0);
  });

  it("pings every 15 s, refreshes the offset from pongs and reconnects after 2 missed pongs", () => {
    const { gs, events } = makeSocket();
    gs.connect("alice");
    last().open();
    const sock = last();

    vi.advanceTimersByTime(15_000);
    expect(sock.sent.filter((m) => m.type === "ping")).toHaveLength(1);
    expect(sock.sent[sock.sent.length - 1].t).toBe(Date.now());

    sock.receive({ type: "pong", t: Date.now(), serverNow: Date.now() + 5_000 });
    expect(gs.getServerOffset()).toBe(5_000);
    expect(events.some((e) => e.kind === "offset" && e.offset === 5_000)).toBe(true);

    // Two unanswered pings, then the third tick drops the socket.
    vi.advanceTimersByTime(15_000);
    vi.advanceTimersByTime(15_000);
    expect(sock.sent.filter((m) => m.type === "ping")).toHaveLength(3);
    expect(gs.getStatus()).toBe("connected");
    const count = FakeWebSocket.instances.length;
    vi.advanceTimersByTime(15_000);
    expect(gs.getStatus()).toBe("disconnected");
    expect(sock.readyState).toBe(3);
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances.length).toBe(count + 1);
    expect(gs.getStatus()).toBe("connecting");
  });

  it("persists the session token and presents it on the next login", () => {
    const { gs, storage } = makeSocket();
    gs.connect("alice");
    last().open();
    last().receive({ type: "login-success", username: "alice", sessionToken: "abcdef0123456789", serverNow: Date.now() + 250, onlineUsers: [] });
    expect(storage.getItem(sessionKeyFor("alice"))).toBe("abcdef0123456789");
    expect(gs.getServerOffset()).toBe(250);

    last().serverClose();
    vi.advanceTimersByTime(1000);
    last().open();
    expect(last().sent[0]).toEqual({ type: "login", username: "alice", sessionToken: "abcdef0123456789" });
  });

  it("stops reconnecting after session-replaced until asked to reconnect", () => {
    const { gs, events } = makeSocket();
    gs.connect("alice");
    last().open();
    last().receive({ type: "session-replaced" });
    expect(events.some((e) => e.kind === "session-replaced")).toBe(true);
    expect(gs.getStatus()).toBe("disconnected");
    expect(gs.isStopped()).toBe(true);

    const count = FakeWebSocket.instances.length;
    vi.advanceTimersByTime(120_000);
    expect(FakeWebSocket.instances.length).toBe(count);
    expect(gs.send({ type: "make-move" })).toBe(false);

    gs.reconnectNow();
    expect(FakeWebSocket.instances.length).toBe(count + 1);
    expect(gs.getStatus()).toBe("connecting");
  });

  it.each([...NON_IDEMPOTENT_TYPES])("never queues %s before authentication", (type) => {
    const { gs } = makeSocket();
    gs.connect("alice");
    expect(gs.send({ type })).toBe(false);
    last().open(false);
    expect(gs.send({ type })).toBe(false);
    last().receive({ type: "login-success" });
    expect(last().sent.map((m) => m.type)).toEqual(["login"]);
  });

  it("does not replay the previous user's queued requests", () => {
    const { gs } = makeSocket();
    gs.connect("alice");
    gs.send({ type: "request-room-state", roomId: "alice-room" });
    gs.connect("bob");
    last().open();
    expect(last().sent).toEqual([{ type: "login", username: "bob" }]);
  });

  it("discards queued requests on pause and session replacement", () => {
    for (const stop of ["pause", "session-replaced"] as const) {
      const { gs } = makeSocket();
      gs.connect("alice");
      gs.send({ type: "request-room-state", roomId: "old-room" });
      if (stop === "pause") gs.pause();
      else { last().open(false); last().receive({ type: "session-replaced" }); }
      gs.reconnectNow();
      last().open();
      expect(last().sent.map((m) => m.type)).toEqual(["login"]);
      gs.disconnect();
    }
  });

  it("disconnect() closes for good and pause() halts the loop", () => {
    const { gs } = makeSocket();
    gs.connect("alice");
    last().open();
    gs.pause();
    expect(gs.getStatus()).toBe("disconnected");
    let count = FakeWebSocket.instances.length;
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances.length).toBe(count);

    gs.reconnectNow();
    last().open();
    gs.disconnect();
    expect(gs.getStatus()).toBe("disconnected");
    count = FakeWebSocket.instances.length;
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances.length).toBe(count);
    expect(gs.getUsername()).toBeNull();
  });
});
