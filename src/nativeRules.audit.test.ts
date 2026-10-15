import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMove, boardToScanFen, createInitialBoard, generateLegalMoves, hubMoveStringToNigerian, moveToHubString, moveToNotationString, type Board, type Move } from "./gameLogic";
import { drawFixtures, fixtureHistory, overflowBoard } from "./rules.fixtures";

let temporaryDirectory: string;
let probe: string;
beforeAll(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "kentro-native-rules-"));
  probe = join(temporaryDirectory, "rules-probe");
  const sources = ["bit", "common", "fen", "gen", "list", "move", "pos", "score", "util", "libmy", "var"].map((name) => `nd_upgraded/${name}.cpp`);
  const flags = process.platform === "darwin" ? ["-Wl,-dead_strip"] : ["-Wl,--gc-sections"];
  if (process.env.NATIVE_RULES_SANITIZE === "1") flags.push("-fsanitize=address,undefined", "-fno-omit-frame-pointer");
  execFileSync(process.env.CXX || (process.platform === "darwin" ? "clang++" : "g++"), ["-std=c++14", "-O1", "-g", "-ffunction-sections", "-fdata-sections", ...flags, "-I", "nd_upgraded", "scripts/native-rules-probe.cpp", ...sources, "-o", probe], { cwd: process.cwd(), timeout: 60000, stdio: "pipe" });
}, 65000);
afterAll(() => { if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true }); });

function query(cases: { board: Board; turn?: "W" | "B"; history?: Move[] }[]) {
  const lines = cases.map(({ board, turn = "W", history = [] }) => `${boardToScanFen(board, turn)} ${history.map(moveToHubString).join(" ")}`);
  const result = spawnSync(probe, { input: lines.join("\n") + "\n", encoding: "utf8", timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
  expect(result.error, result.error?.message).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim().split("\n").map((line) => {
    const [end, draw, ...moves] = line.split(" ");
    return { isOver: end === "end=1", isDraw: draw === "draw=1", moves: moves.map((text) => {
      const move = hubMoveStringToNigerian(text);
      if (!move) throw new Error(`Unparseable native move ${text}`);
      return move;
    }) };
  });
}
function moveKey(move: { from: number; to: number; caps: number[] }) {
  return moveToNotationString({ ...move, caps: [...move.caps].sort((a, b) => a - b) });
}
function expectSameMoves(board: Board, nativeMoves: { from: number; to: number; caps: number[] }[], turn: "W" | "B" = "W") {
  expect(nativeMoves.map(moveKey).sort()).toEqual(generateLegalMoves(board, turn).map(moveKey).sort());
}

describe("native Nigerian generator and draw regressions", () => {
  it("safely sorts, copies, clears and reuses lists at128,129,154 and512 entries", () => {
    expect(execFileSync(probe, ["--list-boundaries"], { encoding: "utf8", timeout: 15000 }).trim()).toBe("128 129 154 512");
  });
  it("preserves short and long terminal landings for free-choice king captures", () => {
    const board: Board = { 34: "W", 1: "b", 8: "b", 28: "b", 36: "b" };
    const result = query([{ board }])[0];
    expect(result.moves).toHaveLength(4);
    expectSameMoves(board, result.moves);
  });
  it("safely sorts and copies all154 legal moves beyond Scan's original128-slot buffer", () => {
    const result = query([{ board: overflowBoard }])[0];
    expect(result.moves).toHaveLength(154);
    expectSameMoves(overflowBoard, result.moves);
  });
  it("does not declare an uncounted lone-king endgame terminal", () => {
    const result = query([{ board: { 23: "W", 50: "B" } }])[0];
    expect(result).toMatchObject({ isOver: false, isDraw: false });
    expect(result.moves.length).toBeGreaterThan(0);
  });
  it.each(drawFixtures)("counts $plies plies for $reason including quiet man moves", ({ board, notation, plies }) => {
    const history = fixtureHistory(board, notation);
    const results = query(Array.from({ length: plies + 1 }, (_, count) => ({ board, history: history.slice(0, count) })));
    for (const result of results.slice(0, plies)) expect(result).toMatchObject({ isOver: false, isDraw: false });
    expect(results[plies]).toMatchObject({ isOver: true, isDraw: true });
  });
  it("agrees on every legal move for300 seeded mixed-man/king positions and both colors", () => {
    let seed = 7321;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const cases: { board: Board; turn: "W" | "B" }[] = [];
    for (let index = 0; index < 150; index++) {
      const board: Board = {};
      for (let square = 1; square <= 50; square++) {
        const value = random();
        board[square] = value < 0.06 ? "W" : value < 0.12 ? "w" : value < 0.22 ? "b" : value < 0.28 ? "B" : null;
        if (square <= 5 && board[square] === "w") board[square] = "W";
        if (square >= 46 && board[square] === "b") board[square] = "B";
      }
      if (!Object.values(board).some((piece) => piece === "w" || piece === "W") || !Object.values(board).some((piece) => piece === "b" || piece === "B")) continue;
      cases.push({ board, turn: "W" }, { board, turn: "B" });
    }
    const results = query(cases);
    expect(cases).toHaveLength(300);
    cases.forEach(({ board, turn }, index) => expectSameMoves(board, results[index].moves, turn));
  });
  it("agrees through a full100-ply deterministic playout from the standard start", () => {
    let board = createInitialBoard();
    let turn: "W" | "B" = "W";
    const cases: { board: Board; turn: "W" | "B" }[] = [];
    for (let ply = 0; ply < 100; ply++) {
      const moves = generateLegalMoves(board, turn);
      if (!moves.length) break;
      cases.push({ board, turn });
      board = applyMove(board, moves[(ply * 13 + 7) % moves.length]).board;
      turn = turn === "W" ? "B" : "W";
    }
    const results = query(cases);
    expect(cases.length).toBeGreaterThan(50);
    cases.forEach(({ board, turn }, index) => expectSameMoves(board, results[index].moves, turn));
  });
});
