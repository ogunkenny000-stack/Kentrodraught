/**
 * Reproduction for: "trap meant to capture three -> after capturing 1 it
 * stops". Simulates the ADMIN recording flow (TrapCreator logic) and the
 * PLAYER solving flow (App.tsx handlePuzzleSquareClick + auto-reply logic)
 * using the real rules engine, for two trap shapes:
 *   Shape 1: one solver move that jumps 3 pieces in a single sequence
 *   Shape 2: three pieces captured across two solver moves with a
 *            defender reply in between
 */
import { Board, Move, ngRcToSq, generateLegalMoves, applyMove, moveToNotationString, resolveCaptureClick } from "../src/gameLogic";

const sq = (r: number, c: number): number => {
  const s = ngRcToSq(r, c);
  if (s === null) throw new Error(`(${r},${c}) is not a dark square`);
  return s;
};

function emptyBoard(): Board {
  const b: Board = {};
  for (let i = 1; i <= 50; i++) b[i] = null;
  return b;
}
const count = (b: Board) => Object.values(b).filter(Boolean).length;

type Step = { from: number; to: number; text: string; caps: number[]; role: "solver" | "reply" };
type Clicks = number[][]; // each entry: [pieceSquare, tap1, tap2, ...]

// ---- TrapCreator recording simulation (mirrors handleRecordClick + fullSolutionLine) ----
function record(start: Board, firstMover: "W" | "B", clicks: [number, number][]): { line: Step[]; final: Board } {
  // (recording still uses from->finalSquare pairs; the UI additionally allows hop-walking)
  let bd = { ...start };
  let turn = firstMover;
  const recMoves: Move[] = [];
  for (const [from, to] of clicks) {
    const legal = generateLegalMoves(bd, turn);
    const mv = legal.find((m) => m.from === from && m.to === to);
    if (!mv) {
      throw new Error(
        `RECORDING BLOCKED: ${turn} click ${from}->${to} is not a legal destination. ` +
        `Legal from ${from}: [${legal.filter((m) => m.from === from).map((m) => `${m.to}(x${m.caps.length})`).join(", ") || "none"}]`
      );
    }
    bd = applyMove(bd, mv).board;
    recMoves.push(mv);
    turn = turn === "W" ? "B" : "W";
  }
  const line: Step[] = recMoves.map((mv, i) => ({
    from: mv.from, to: mv.to, caps: mv.caps, text: moveToNotationString(mv),
    role: i % 2 === 0 ? "solver" : "reply",
  }));
  while (line.length > 0 && line[line.length - 1].role === "reply") line.pop();
  return { line, final: bd };
}

// ---- App.tsx puzzle player simulation (mirrors handlePuzzleSquareClick + auto-reply effect) ----
function matchPuzzleStepMove(b: Board, mover: "W" | "B", step: { from: number; to: number; caps?: number[] }): Move | null {
  const candidates = generateLegalMoves(b, mover).filter((m) => m.from === step.from && m.to === step.to);
  if (candidates.length === 0) return null;
  if (step.caps && step.caps.length > 0) {
    const wanted = [...step.caps].sort().join(",");
    const exact = candidates.find((m) => [...m.caps].sort().join(",") === wanted);
    if (exact) return exact;
  }
  return candidates[0];
}

function playPuzzle(startBoard: Board, startTurn: "W" | "B", solution: Step[], solverClicks: Clicks): void {
  let board = { ...startBoard };
  let turn = startTurn;
  let idx = 0;
  let completed = false;
  const usesFullLine = solution.some((s) => s.role === "solver" || s.role === "reply");
  let clickPtr = 0;

  const doAutoReply = () => {
    const step = solution[idx];
    if (!step || step.role !== "reply") return false;
    const replyMove = matchPuzzleStepMove(board, turn, step) ?? { from: step.from, to: step.to, caps: step.caps ?? [] };
    board = applyMove(board, replyMove as Move).board;
    turn = turn === "W" ? "B" : "W";
    idx += 1;
    if (idx >= solution.length) completed = true;
    console.log(`    [auto] defender replied ${step.text} (board now ${count(board)} pieces)`);
    return true;
  };

  while (!completed) {
    const step = solution[idx];
    if (!step) break;
    if (usesFullLine && step.role === "reply") {
      if (!doAutoReply()) throw new Error("auto-reply failed to fire");
      continue;
    }
    if (clickPtr >= solverClicks.length) throw new Error(`PLAYER STUCK at step ${idx} (${step.text}): ran out of clicks`);
    const [from, ...taps] = solverClicks[clickPtr++];
    const pc = board[from];
    if (!pc || pc.toUpperCase() !== turn) throw new Error(`PLAYER STUCK: cannot select ${from} — no ${turn} piece there (turn=${turn})`);
    const candidates = generateLegalMoves(board, turn).filter((m) => m.from === from);
    let walked: number[] = [];
    let applied: Move | null = null;
    for (const tap of taps) {
      const res = resolveCaptureClick(candidates, walked, tap);
      if (res.kind === "extend") { walked = res.walked; console.log(`    [you ] hop -> ${tap} (keep jumping)`); continue; }
      if (res.kind === "apply") { applied = res.move; break; }
      const legalTos = candidates.map((m) => `${m.to}(x${m.caps.length})`);
      throw new Error(`WRONG-CLICK: tap ${tap} matched nothing. Legal from ${from}: [${legalTos.join(", ")}]`);
    }
    if (!applied) throw new Error("PLAYER STUCK: taps never completed a move");
    const capsMatch = !step.caps || step.caps.length === 0 ||
      [...step.caps].sort().join(",") === [...applied.caps].sort().join(",");
    if (!(applied.from === step.from && applied.to === step.to && capsMatch)) {
      throw new Error(`Legal but NOT the puzzle move: played ${moveToNotationString(applied)}, expected ${step.text}`);
    }
    board = applyMove(board, applied).board;
    console.log(`    [you ] played ${step.text} (${applied.caps.length} caps, board ${count(board)} pieces)`);
    idx += 1;
    if (usesFullLine) turn = turn === "W" ? "B" : "W";
    if (idx >= solution.length) completed = true;
  }
  if (!completed) throw new Error("puzzle did not complete");
  console.log("    ✓ puzzle completed");
}

// ================= Shape 1: single move, 3 jumps =================
console.log("\n== Shape 1: one move capturing THREE pieces ==");
{
  const b = emptyBoard();
  const wFrom = sq(7, 1);
  const v1 = sq(6, 2), v2 = sq(4, 4), v3 = sq(2, 6);
  b[wFrom] = "w"; b[v1] = "b"; b[v2] = "b"; b[v3] = "b";
  b[sq(0, 4)] = "b"; // spare defender so the position isn't over after the combo

  const legal = generateLegalMoves(b, "W");
  console.log("  White's legal moves:", legal.map((m) => `${moveToNotationString(m)} [caps ${m.caps.length}] -> ${m.to}`));
  const combo = legal.find((m) => m.caps.length === 3);
  if (!combo) throw new Error("engine did not produce the 3-capture");
  const intermediate1 = sq(5, 3);
  console.log(`  Is the FIRST landing square ${intermediate1} offered as a destination?`,
    legal.some((m) => m.from === wFrom && m.to === intermediate1));

  const { line } = record(b, "W", [[wFrom, combo.to]]);
  console.log("  Recorded line:", line.map((s) => `${s.role}:${s.text}`));
  console.log("  Style A — one tap on the final square:");
  playPuzzle(b, "W", line, [[wFrom, combo.to]]);
  console.log("  Style B — physical-board hop-by-hop clicking:");
  const hops = (combo as any).path as number[];
  playPuzzle(b, "W", line, [[wFrom, ...hops]]);
}

// ============ Decoy scenario: the reported bug itself ============
console.log("\n== Decoy: short 1-capture beside a 3-capture (the reported bug) ==");
{
  const b = emptyBoard();
  const wFrom = sq(7, 1);
  b[wFrom] = "w";
  b[sq(6, 2)] = "b"; b[sq(4, 4)] = "b"; b[sq(2, 6)] = "b"; // the combo
  b[sq(8, 2)] = "b"; // decoy: a separate backward 1-capture
  b[sq(0, 4)] = "b"; // spare defender
  const legal = generateLegalMoves(b, "W");
  console.log("  Legal moves now:", legal.map((m) => `${moveToNotationString(m)} [x${m.caps.length}]`));
  if (legal.some((m) => m.caps.length < 3)) throw new Error("MAJORITY RULE FAILED: short capture still offered");
  console.log("  ✓ the 1-capture escape hatch is gone — only the full 3-capture is playable");
}

// ================= Shape 2: three captures across the line =================
console.log("\n== Shape 2: capture, forced-ish reply, double capture ==");
{
  const b = emptyBoard();
  const wFrom = sq(7, 1);
  const v1 = sq(6, 2);          // victim 1
  const yStart = sq(3, 3);      // defender who will step into the fork
  const v3 = sq(2, 2);          // victim 3 (chained)
  b[wFrom] = "w"; b[v1] = "b"; b[yStart] = "b"; b[v3] = "b";

  const land1 = sq(5, 3);
  const yReply = sq(4, 2);
  const clicks: [number, number][] = [
    [wFrom, land1],        // solver: capture v1
    [yStart, yReply],      // defender reply (recorded by admin)
    [land1, sq(1, 3)],     // solver: double capture over yReply + v3
  ];
  const { line, final } = record(b, "W", clicks);
  console.log("  Recorded line:", line.map((s) => `${s.role}:${s.text} (caps ${s.caps.length})`));
  console.log("  Pieces left after full line:", count(final));

  // Player plays only the SOLVER clicks; defender replies must auto-play.
  playPuzzle(b, "W", line, [[wFrom, land1], [land1, sq(1, 3)]]);
  console.log("  Same line, hop-by-hop on the double capture:");
  playPuzzle(b, "W", line, [[wFrom, land1], [land1, sq(3, 1), sq(1, 3)]]);
}

console.log("\nDONE");
