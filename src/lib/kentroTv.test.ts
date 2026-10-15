import { describe, expect, it } from "vitest";
import { applyMove, createInitialBoard, generateLegalMoves } from "../gameLogic";
import { buildReplayFrames, parseReplayLink, replayBounds, replayLink, selectHighlights } from "./kentroTv";
import { validNotificationPath, unreadCount, DEFAULT_NOTIFICATION_PREFERENCES } from "./smartNotifications";

describe("Kentro TV", () => {
  const game = () => {
    let board = createInitialBoard();
    let turn: "W" | "B" = "W";
    const moves = [];
    for (let i=0; i<100; i++) {
      const legal = generateLegalMoves(board, turn);
      if (!legal.length) break;
      const chosen = legal.find(m => m.caps.length >= 2) || legal[(i * 7 + 2) % legal.length];
      moves.push(chosen);
      board = applyMove(board, chosen).board;
      turn = turn === "W" ? "B" : "W";
    }
    return { board, moves };
  };
  it("replays legal moves to the exact final board", () => {
    const { board, moves } = game();
    const frames = buildReplayFrames({ startingPosition: null, completeMoveHistory: moves });
    expect(frames.length).toBe(moves.length+1);
    expect(frames[frames.length-1].board).toEqual(board);
    expect(frames[0].board).toEqual(createInitialBoard());
  });
  it("rejects forged move histories", () => {
    expect(() => buildReplayFrames({ startingPosition: null, completeMoveHistory: [{ from: 1, to: 50, caps: [] }] })).toThrow();
  });
  it("extracts actual capture and endgame highlights", () => {
    const { moves } = game();
    const clips = selectHighlights(buildReplayFrames({ startingPosition: null, completeMoveHistory: moves }));
    expect(clips.length).toBeGreaterThan(0);
    expect(clips.every(c => c.to >= c.from)).toBe(true);
  });
  it("builds direct autoplay highlight links and restricts invalid input", () => {
    const url = replayLink("https://draught.com/path?room=123", "2690001", 12, 16);
    expect(parseReplayLink(new URL(url).search)).toEqual({ gameCode: "2690001", ply: 12, clipEnd: 16 });
    expect(new URL(url).searchParams.has("room")).toBe(false);
    expect(parseReplayLink("?replay=%3Cscript%3E")).toBeNull();
    expect(parseReplayLink("?replay=2690001&ply=-8")).toMatchObject({ ply: 0 });
  });
  it("bounds shared clips to the verified game rather than running past its final board", () => {
    expect(replayBounds(9, 3, 2000)).toEqual({ ply: 3, range: { from: 3, to: 8 } });
    expect(replayBounds(9, 1900, 2000)).toEqual({ ply: 8, range: null });
    expect(replayBounds(9, -1, 4)).toEqual({ ply: 0, range: { from: 0, to: 4 } });
    expect(replayBounds(0, 10, 20)).toEqual({ ply: 0, range: null });
  });
});

describe("Notification safety", () => {
  it("accepts only same-origin navigation targets", () => {
    expect(validNotificationPath("/?room=1234567")).toBe("/?room=1234567");
    expect(validNotificationPath("https://evil.test")).toBe("/");
    expect(validNotificationPath("//evil.test")).toBe("/");
    expect(validNotificationPath("/\\evil.test")).toBe("/");
    for (const path of ["/\t/evil.test", "/\n/evil.test", "/\r/evil.test", "/ /evil.test", "/?replay=123\u0000"]) {
      expect(validNotificationPath(path)).toBe("/");
    }
  });
  it("counts only enabled unread alerts", () => {
    const example: any[] = [
      { category: "challenge", read_at: null },
      { category: "result", read_at: null },
      { category: "friend", read_at: "2026-10-11" },
    ];
    expect(unreadCount(example, DEFAULT_NOTIFICATION_PREFERENCES)).toBe(2);
    expect(unreadCount(example, { ...DEFAULT_NOTIFICATION_PREFERENCES, challenge: false })).toBe(1);
  });
});
