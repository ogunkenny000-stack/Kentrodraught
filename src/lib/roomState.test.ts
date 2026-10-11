import { describe, it, expect } from "vitest";
import { roomReducer, initialRoomState, isSameUser, findMe, RoomPlayer } from "./roomState";

describe("roomState - username matching and auto color swap", () => {
  it("isSameUser correctly handles case insensitivity and whitespace", () => {
    expect(isSameUser("PlayerOne", "playerone")).toBe(true);
    expect(isSameUser("  PlayerOne  ", "playerone")).toBe(true);
    expect(isSameUser("PlayerOne", "PlayerTwo")).toBe(false);
    expect(isSameUser(null, "playerone")).toBe(false);
    expect(isSameUser("playerone", undefined)).toBe(false);
  });

  it("findMe finds the seated player regardless of username case", () => {
    const players: RoomPlayer[] = [
      { username: "Alice", color: "W", ready: true },
      { username: "Bob", color: "B", ready: true },
    ];

    expect(findMe(players, "alice")?.color).toBe("W");
    expect(findMe(players, "  BOB  ")?.color).toBe("B");
    expect(findMe(players, "Charlie")).toBeUndefined();
  });

  it("ROOM_INFO assigns yourColor correctly from data.yourColor or players list", () => {
    const players: RoomPlayer[] = [
      { username: "Alice", color: "W", ready: true },
      { username: "Bob", color: "B", ready: true },
    ];

    // Explicit yourColor
    const state1 = roomReducer(initialRoomState, {
      type: "ROOM_INFO",
      data: { roomId: "room_1", players, yourColor: "B" },
      username: "Alice",
      receivedAt: Date.now(),
    });
    expect(state1.yourColor).toBe("B");

    // Inferred yourColor via username lookup
    const state2 = roomReducer(initialRoomState, {
      type: "ROOM_INFO",
      data: { roomId: "room_1", players },
      username: "Alice",
      receivedAt: Date.now(),
    });
    expect(state2.yourColor).toBe("W");
  });

  it("swaps yourColor on rematch/next game when GAME_RESET or GAME_STARTED occurs", () => {
    // Game 1: Alice is White, Bob is Black
    const g1Players: RoomPlayer[] = [
      { username: "Alice", color: "W", ready: true },
      { username: "Bob", color: "B", ready: true },
    ];

    const stateG1 = roomReducer(initialRoomState, {
      type: "GAME_STARTED",
      data: { roomId: "room_1", players: g1Players, yourColor: "W" },
      username: "Alice",
      receivedAt: Date.now(),
    });
    expect(stateG1.yourColor).toBe("W");

    // Game 2 (Rematch / Next Series Game): Colors are swapped on server
    // Alice is now Black, Bob is now White
    const g2Players: RoomPlayer[] = [
      { username: "Alice", color: "B", ready: true },
      { username: "Bob", color: "W", ready: true },
    ];

    // Case A: via GAME_RESET
    const stateReset = roomReducer(stateG1, {
      type: "GAME_RESET",
      players: g2Players,
      username: "Alice",
      yourColor: "B",
    });
    expect(stateReset.yourColor).toBe("B");

    // Case B: via GAME_STARTED with explicit yourColor
    const stateG2 = roomReducer(stateReset, {
      type: "GAME_STARTED",
      data: { roomId: "room_1", players: g2Players, yourColor: "B" },
      username: "Alice",
      receivedAt: Date.now(),
    });
    expect(stateG2.yourColor).toBe("B");

    // Bob's perspective in Game 2: was Black, now White
    const bobStateG2 = roomReducer(initialRoomState, {
      type: "GAME_STARTED",
      data: { roomId: "room_1", players: g2Players, yourColor: "W" },
      username: "Bob",
      receivedAt: Date.now(),
    });
    expect(bobStateG2.yourColor).toBe("W");
  });

  it("banks elapsed display time when game-ended omits a clock", () => {
    const state = { ...initialRoomState, clock: { offset: 2000, clock: {
      whiteMs: 60000, blackMs: 50000, running: "W" as const,
      turnStartedAt: 10000, serverNow: 10000, incrementMs: 2000,
    } } };
    const next = roomReducer(state, { type: "GAME_ENDED", data: { winnerColor: "B" }, receivedAt: 13000 });
    expect(next.clock?.clock.whiteMs).toBe(55000);
    expect(next.clock?.clock.blackMs).toBe(50000);
    expect(next.clock?.clock.running).toBeNull();
    expect(state.clock.clock.whiteMs).toBe(60000);
  });

  it("preserves an authoritative final clock supplied by the server", () => {
    const clock = { whiteMs: 0, blackMs: 31000, running: null, turnStartedAt: 15000, serverNow: 15000, incrementMs: 0 };
    const next = roomReducer(initialRoomState, { type: "GAME_ENDED", data: { winnerColor: "B", clock }, receivedAt: 13000 });
    expect(next.clock?.clock.whiteMs).toBe(0);
    expect(next.clock?.clock.blackMs).toBe(31000);
    expect(next.clock?.clock.running).toBeNull();
  });

  it("preserves spectator view as White ('W') on SPECTATE_JOINED", () => {
    const state = roomReducer(initialRoomState, {
      type: "SPECTATE_JOINED",
      data: {
        roomId: "room_1",
        players: [
          { username: "Alice", color: "W" },
          { username: "Bob", color: "B" },
        ],
      },
      receivedAt: Date.now(),
    });
    expect(state.isSpectating).toBe(true);
    expect(state.yourColor).toBe("W");
  });
});
