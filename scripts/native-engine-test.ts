// Run with: npx tsx scripts/native-engine-test.ts [--sanitize]
// Compiles the real generator into an isolated fixture adapter; no eval/book or
// approximate AI participates in these comparisons.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyMove, boardToScanFen, checkGameEnd, createInitialBoard, generateLegalMoves,
  hubMoveStringToNigerian, moveToHubString,
  type Board, type Move,
} from "../src/gameLogic.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(path.join(tmpdir(), "kentro-native-test-"));
const executable = path.join(temp, "probe");
const sanitize = process.argv.includes("--sanitize");
let state = 0x814cd37;
const random = () => {
  state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
  return (state >>> 0) / 4294967296;
};
const empty = (): Board => Object.fromEntries(Array.from({ length: 50 }, (_, i) => [i + 1, null]));
const board = (pieces: Record<string, number[]>): Board => {
  const result = empty();
  for (const [piece, squares] of Object.entries(pieces)) for (const sq of squares) result[sq] = piece as Board[number];
  return result;
};
const key = (move: Pick<Move, "from" | "to" | "caps">) => `${move.from}:${move.to}:${[...move.caps].sort((a, b) => a - b).join(",")}`;
interface Fixture { name: string; start: Board; turn: "W" | "B"; history?: Move[]; expected?: string[]; count?: number; draw?: boolean; end?: boolean }
const fixtures: Fixture[] = [];
const add = (fixture: Fixture) => fixtures.push(fixture);

add({ name: "initial nine quiets", start: createInitialBoard(), turn: "W", expected: ["31:26:", "32:26:", "32:27:", "33:27:", "33:28:", "34:28:", "34:29:", "35:29:", "35:30:"], draw: false, end: false });
add({ name: "far king landings remain terminal", start: board({ W: [23], b: [18, 8] }), turn: "W", expected: ["23:3:8,18", "23:9:18", "23:5:18"], draw: false, end: false });
add({ name: "man captures backward", start: board({ w: [23], b: [28] }), turn: "W", expected: ["23:34:28"] });
add({ name: "capture loops to vacated origin", start: board({ w: [23], b: [17, 16, 26, 27] }), turn: "W" });
add({ name: "king crosses vacated origin", start: board({ W: [23], b: [17, 7, 8, 27] }), turn: "W" });
add({ name: "141 legal captures exceed inline capacity", start: board({ W: [1, 10, 11, 15, 42, 48, 50], B: [7, 13, 16, 23, 24, 25, 26, 27, 31, 35, 36, 40, 46] }), turn: "W", count: 141 });
add({ name: "new lone-king position is playable", start: board({ W: [1], B: [49] }), turn: "W", draw: false, end: false });
add({ name: "eliminated side loses before material draw", start: board({ W: [1] }), turn: "B", expected: [], draw: false, end: true });

// Find legal nonrepeating histories with unchanged material. Explicit threshold
// expectations below are independent of either implementation's draw detector.
function quietHistory(start: Board, plies: number, requireMan = false): Move[] {
  for (let attempt = 0; attempt < 300; attempt++) {
    let current = start; let turn: "W" | "B" = "W"; const history: Move[] = [];
    const seen = new Set([boardToScanFen(current, turn)]);
    let movedMan = false;
    for (let ply = 0; ply < plies; ply++) {
      const nextTurn = turn === "W" ? "B" : "W";
      const candidates = generateLegalMoves(current, turn).filter((move) => {
        if (move.caps.length) return false;
        const next = applyMove(current, move);
        if (next.promoted || seen.has(boardToScanFen(next.board, nextTurn))) return false;
        const replies = generateLegalMoves(next.board, nextTurn);
        return replies.length > 0 && replies.every((reply) => reply.caps.length === 0);
      });
      if (!candidates.length) break;
      const move = candidates[Math.floor(random() * candidates.length)];
      movedMan ||= current[move.from] === "w" || current[move.from] === "b";
      history.push(move); current = applyMove(current, move).board; turn = nextTurn;
      seen.add(boardToScanFen(current, turn));
    }
    if (history.length === plies && (!requireMan || movedMan)) return history;
  }
  throw new Error(`Could not construct ${plies}-ply quiet fixture`);
}

for (const [name, start, threshold, requireMan] of [
  ["five moves each", board({ W: [1], B: [49] }), 10, false],
  ["sixteen moves each", board({ W: [3], B: [46], b: [6, 10] }), 32, true],
  ["twenty-five king moves each", board({ W: [1, 2], B: [49, 50] }), 50, false],
] as const) {
  const history = quietHistory(start, threshold, requireMan);
  add({ name: `${name}: before threshold`, start, turn: "W", history: history.slice(0, -1), draw: false, end: false });
  add({ name: `${name}: threshold`, start, turn: "W", history, draw: true, end: true });
}
const noKingStart = board({ W: [5], b: [6] });
add({ name: "material rule requires an opposing king", start: noKingStart, turn: "W", history: quietHistory(noKingStart, 10, true), draw: false, end: false });

// Seeded arbitrary positions cover dense capture trees and sparse flying kings.
for (let i = 0; i < 600; i++) {
  const current = empty();
  const squares = Array.from({ length: 50 }, (_, sq) => sq + 1);
  for (let j = squares.length - 1; j > 0; j--) { const k = Math.floor(random() * (j + 1)); [squares[j], squares[k]] = [squares[k], squares[j]]; }
  const count = 2 + Math.floor(random() * 29);
  for (let j = 0; j < count; j++) {
    const sq = squares[j]; const white = j === 0 || (j !== 1 && random() < 0.5);
    current[sq] = white ? (sq <= 5 || random() < 0.6 ? "W" : "w") : (sq >= 46 || random() < 0.6 ? "B" : "b");
  }
  add({ name: `seeded position ${i}`, start: current, turn: random() < 0.5 ? "W" : "B" });
}
for (let game = 0; game < 8; game++) {
  let current = createInitialBoard(); let turn: "W" | "B" = "W";
  for (let ply = 0; ply < 120; ply++) {
    const moves = generateLegalMoves(current, turn);
    add({ name: `seeded game ${game} ply ${ply}`, start: current, turn });
    if (!moves.length) break;
    current = applyMove(current, moves[Math.floor(random() * moves.length)]).board;
    turn = turn === "W" ? "B" : "W";
  }
}

try {
  const sources = ["bit", "common", "fen", "gen", "list", "move", "pos", "libmy", "score", "util", "var"].map((name) => `nd_upgraded/${name}.cpp`);
  const compile = spawnSync(process.env.CXX || "g++", ["-std=c++14", "-O1", "-g", "-Wall", "-Wextra", "-Wno-unused-parameter", "-ffunction-sections", "-fdata-sections", ...(sanitize ? ["-fsanitize=address,undefined", "-fno-omit-frame-pointer", "-fno-pie", "-no-pie"] : []), "-I", "nd_upgraded", "scripts/native-engine-probe.cpp", ...sources, "-Wl,--gc-sections", "-o", executable], { cwd: root, stdio: "inherit" });
  assert.equal(compile.status, 0, "Native fixture adapter compilation failed");
  const lines = fixtures.map((fixture) => [boardToScanFen(fixture.start, fixture.turn), ...(fixture.history || []).map(moveToHubString)].join(" "));
  const run = spawnSync(executable, [], { input: lines.join("\n") + "\n", encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 90000 });
  assert.equal(run.status, 0, `Native fixture adapter failed: ${run.error || run.stderr}`);
  const results = run.stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(results.length, fixtures.length, "Native adapter did not complete all fixtures");
  let successors = 0;
  for (let i = 0; i < fixtures.length; i++) {
    const fixture = fixtures[i]; const result = results[i];
    let current = fixture.start; let turn = fixture.turn;
    for (const move of fixture.history || []) { current = applyMove(current, move).board; turn = turn === "W" ? "B" : "W"; }
    const legal = generateLegalMoves(current, turn);
    const expected = legal.map(key).sort();
    const actualMoves = result.moves.map((entry: { move: string }) => { const move = hubMoveStringToNigerian(entry.move); assert.ok(move, `${fixture.name}: invalid hub move`); return move; });
    const actual = actualMoves.map(key).sort();
    assert.equal(new Set(actual).size, actual.length, `${fixture.name}: duplicate native moves`);
    assert.deepEqual(actual, expected, `${fixture.name}: native/TypeScript legal moves differ`);
    if (fixture.expected) assert.deepEqual(actual, [...fixture.expected].sort(), `${fixture.name}: independent expected legal moves differ`);
    if (fixture.count !== undefined) assert.equal(actual.length, fixture.count, fixture.name);
    if (fixture.draw !== undefined) assert.equal(result.draw, fixture.draw, `${fixture.name}: draw rule`);
    if (fixture.end !== undefined) assert.equal(result.end, fixture.end, `${fixture.name}: termination`);
    const gameEnd = checkGameEnd(fixture.history || [], fixture.start, fixture.turn);
    assert.equal(result.draw, gameEnd.isDraw, `${fixture.name}: native/TypeScript draw differs`);
    assert.equal(result.end, gameEnd.isOver, `${fixture.name}: native/TypeScript termination differs`);
    assert.equal(result.fen, boardToScanFen(current, turn), `${fixture.name}: final history position`);
    for (let j = 0; j < actualMoves.length; j++) {
      const next = applyMove(current, actualMoves[j]);
      assert.equal(result.moves[j].fen, boardToScanFen(next.board, turn === "W" ? "B" : "W"), `${fixture.name}: native/TypeScript successor differs`);
      successors++;
    }
  }
  console.log(`[native:test] ${fixtures.length} positions and ${successors} successors agree; independent capture, draw, 141-move, and List boundary fixtures passed${sanitize ? " under ASan/UBSan" : ""}.`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
