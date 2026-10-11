import { describe, it, expect } from "vitest";
import {
  makeClockSnapshot, clockRemainingMs, msToDisplaySeconds, formatClockMs,
  createLocalClock, advanceLocalClock, freezeClock, flagLocalClock, withOffset, isUntimedClock,
} from "./useServerClock";
import { roomReducer, initialRoomState, appendChat, MAX_ROOM_CHAT } from "./roomState";

describe("server clock snapshot", () => {
  const wire = {
    whiteMs: 60_000,
    blackMs: 45_000,
    running: "W" as const,
    turnStartedAt: 1_000_000,
    serverNow: 1_000_500,
    incrementMs: 3_000,
  };

  it("interpolates the running side using the server offset", () => {
    // Received at local t=5000 while the server said 1_000_500 -> offset 995_500.
    const snap = makeClockSnapshot(wire, 5_000);
    expect(snap.offset).toBe(995_500);
    // 2 s later locally = server 1_002_500 -> 2 500 ms elapsed since turn start.
    expect(clockRemainingMs(snap, "W", 7_000)).toBe(57_500);
    // The idle side is exact.
    expect(clockRemainingMs(snap, "B", 7_000)).toBe(45_000);
  });

  it("a paused clock does not tick", () => {
    const snap = makeClockSnapshot({ ...wire, running: null }, 5_000);
    expect(clockRemainingMs(snap, "W", 5_000)).toBe(60_000);
    expect(clockRemainingMs(snap, "W", 5_000 + 600_000)).toBe(60_000);
    expect(clockRemainingMs(snap, "B", 5_000 + 600_000)).toBe(45_000);
  });

  it("never goes below zero and shows 0:00 while waiting for the server", () => {
    const snap = makeClockSnapshot(wire, 5_000);
    expect(clockRemainingMs(snap, "W", 5_000 + 120_000)).toBe(0);
    expect(formatClockMs(clockRemainingMs(snap, "W", 5_000 + 120_000))).toBe("0:00");
  });

  it("rounds display seconds up so 0:01 stays until the flag", () => {
    expect(msToDisplaySeconds(999)).toBe(1);
    expect(msToDisplaySeconds(1_000)).toBe(1);
    expect(msToDisplaySeconds(1_001)).toBe(2);
    expect(formatClockMs(61_000)).toBe("1:01");
    expect(formatClockMs(600_000)).toBe("10:00");
  });

  it("withOffset refines the estimate without touching the snapshot", () => {
    const snap = makeClockSnapshot(wire, 5_000);
    const refined = withOffset(snap, 995_000);
    expect(refined.clock).toBe(snap.clock);
    expect(clockRemainingMs(refined, "W", 7_000)).toBe(58_000);
  });

  it("treats the all-zero snapshot as untimed", () => {
    expect(isUntimedClock(makeClockSnapshot({ whiteMs: 0, blackMs: 0, running: null, turnStartedAt: 0, serverNow: 0, incrementMs: 0 }))).toBe(true);
    expect(isUntimedClock(makeClockSnapshot(wire, 0))).toBe(false);
  });
});

describe("local clock helpers", () => {
  it("deducts elapsed time, adds the increment and hands over", () => {
    const start = createLocalClock(300_000, "W", 3_000, 10_000);
    expect(clockRemainingMs(start, "W", 12_500)).toBe(297_500);
    const after = advanceLocalClock(start, "W", 12_500);
    expect(after.clock.whiteMs).toBe(300_500); // 300 000 - 2 500 + 3 000
    expect(after.clock.blackMs).toBe(300_000);
    expect(after.clock.running).toBe("B");
    expect(clockRemainingMs(after, "B", 13_500)).toBe(299_000);
    expect(clockRemainingMs(after, "W", 13_500)).toBe(300_500);
  });

  it("freeze keeps the remaining time and flag zeroes the loser", () => {
    const start = createLocalClock(10_000, "B", 0, 0);
    const frozen = freezeClock(start, 4_000);
    expect(frozen.clock.running).toBeNull();
    expect(frozen.clock.blackMs).toBe(6_000);
    expect(clockRemainingMs(frozen, "B", 999_999)).toBe(6_000);
    const flagged = flagLocalClock(start, "B", 4_000);
    expect(flagged.clock.blackMs).toBe(0);
    expect(flagged.clock.whiteMs).toBe(10_000);
    expect(flagged.clock.running).toBeNull();
  });
});

describe("room reducer", () => {
  it("room-info applies clocks only from `clock` and resets the room on a new id", () => {
    const s1 = roomReducer(initialRoomState, {
      type: "ROOM_INFO",
      username: "me",
      receivedAt: 1_000,
      data: {
        roomId: "AAA111",
        players: [{ username: "me", color: "W", ready: true }, { username: "you", color: "B", ready: false }],
        started: true,
        phase: "playing",
        gameState: { whiteTime: 1, blackTime: 1 },
        clock: { whiteMs: 30_000, blackMs: 20_000, running: "W", turnStartedAt: 5_000, serverNow: 5_000, incrementMs: 0 },
        seq: 3,
      },
    });
    expect(s1.roomId).toBe("AAA111");
    expect(s1.yourColor).toBe("W");
    expect(s1.isReady).toBe(true);
    expect(s1.clock?.clock.whiteMs).toBe(30_000);
    expect(s1.clock?.offset).toBe(4_000);

    const withOffer = roomReducer(s1, { type: "PATCH", patch: { drawOfferReceived: "you" } });
    const s2 = roomReducer(withOffer, {
      type: "ROOM_INFO",
      username: "me",
      receivedAt: 2_000,
      data: { roomId: "BBB222", players: [{ username: "me", color: "B", ready: false }], started: false, phase: "lobby" },
    });
    expect(s2.roomId).toBe("BBB222");
    expect(s2.drawOfferReceived).toBeNull();
    expect(s2.clock).toBeNull();
    expect(s2.yourColor).toBe("B");
  });

  it("room-info applies the additive fields: gameCode, players[].connected, non-null pendingOffer", () => {
    const s = roomReducer(initialRoomState, {
      type: "ROOM_INFO",
      username: "me",
      receivedAt: 0,
      data: {
        roomId: "R9",
        gameCode: "2690007",
        players: [{ username: "me", color: "W", ready: true, connected: true }, { username: "you", color: "B", ready: true, connected: false }],
        started: true,
        phase: "playing",
        pendingOffer: { type: "draw", from: "me" },
        seq: 1,
      },
    });
    expect(s.gameCode).toBe("2690007");
    expect(s.opponentConnected).toBe(false);
    expect(s.drawOfferSent).toBe(true);
    expect(s.drawOfferReceived).toBeNull();

    // A null pendingOffer on a plain room-info must NOT wipe an offer we just sent.
    const s2 = roomReducer(s, { type: "ROOM_INFO", username: "me", receivedAt: 0, data: { roomId: "R9", players: s.players, started: true, phase: "playing", pendingOffer: null, seq: 2 } });
    expect(s2.drawOfferSent).toBe(true);
  });

  it("room-cancelled only clears the room it names", () => {
    const inRoom = roomReducer(initialRoomState, { type: "PATCH", patch: { roomId: "X1", players: [{ username: "me", color: "W", ready: false }] } });
    expect(roomReducer(inRoom, { type: "ROOM_CANCELLED", roomId: "OTHER" })).toBe(inRoom);
    expect(roomReducer(inRoom, { type: "ROOM_CANCELLED", roomId: "X1" })).toEqual(initialRoomState);
  });

  it("room-rejoined restores offers, chat tail and connectivity", () => {
    const s = roomReducer(initialRoomState, {
      type: "ROOM_INFO",
      rejoin: true,
      username: "me",
      receivedAt: 0,
      data: {
        roomId: "R1",
        players: [{ username: "me", color: "W", ready: true }, { username: "you", color: "B", ready: true }],
        started: true,
        phase: "playing",
        yourColor: "W",
        pendingOffer: { type: "resign", from: "you" },
        chatTail: [{ from: "you", text: "gg", ts: 1 }],
        opponentConnected: false,
        clock: { whiteMs: 1, blackMs: 2, running: null, turnStartedAt: 0, serverNow: 100, incrementMs: 0 },
      },
    });
    expect(s.resignOfferReceived).toBe("you");
    expect(s.messages).toEqual([{ from: "you", text: "gg", ts: 1 }]);
    expect(s.opponentConnected).toBe(false);
    expect(s.isSpectating).toBe(false);
    expect(s.clock?.clock.running).toBeNull();
  });

  it("game-ended freezes the display even without a clock payload", () => {
    const running = roomReducer(initialRoomState, {
      type: "CLOCK",
      receivedAt: 0,
      clock: { whiteMs: 1_000, blackMs: 1_000, running: "B", turnStartedAt: 0, serverNow: 0, incrementMs: 0 },
    });
    const ended = roomReducer(running, { type: "GAME_ENDED", receivedAt: 0, data: { reason: "timeout", winnerColor: "W", statusMessage: "flag" } });
    expect(ended.phase).toBe("ended");
    expect(ended.serverGameEnd).toEqual({ winnerColor: "W", reason: "timeout", statusMessage: "flag" });
    expect(ended.clock?.clock.running).toBeNull();
  });

  it("spectate-joined starts from a clean slate", () => {
    const dirty = roomReducer(initialRoomState, { type: "PATCH", patch: { seriesInfo: { bestOf: 3, gameNumber: 2, score: {}, draws: 0, seriesOver: false, seriesWinner: null }, wagerAmount: 500, drawOfferSent: true } });
    const s = roomReducer(dirty, { type: "SPECTATE_JOINED", receivedAt: 0, data: { roomId: "S1", players: [], gameTime: 5, specialRule: "none", spectatorCount: 2 } });
    expect(s.isSpectating).toBe(true);
    expect(s.seriesInfo).toBeNull();
    expect(s.wagerAmount).toBe(0);
    expect(s.drawOfferSent).toBe(false);
    expect(s.yourColor).toBe("W");
  });

  it("caps room chat at 200 messages", () => {
    let list = [] as ReturnType<typeof appendChat>;
    for (let i = 0; i < MAX_ROOM_CHAT + 25; i++) list = appendChat(list, { from: "a", text: String(i) });
    expect(list).toHaveLength(MAX_ROOM_CHAT);
    expect(list[0].text).toBe("25");
    expect(list[list.length - 1].text).toBe(String(MAX_ROOM_CHAT + 24));
  });
});
