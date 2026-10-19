// Run: node --experimental-strip-types scripts/engine-benchmark.mjs [seconds-per-position]
// This measures the shipped native engine with fixed positions, full evaluation,
// a fresh transposition table for each case, and canonical legal-move validation.
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { boardToScanFen, createInitialBoard, generateLegalMoves, hubMoveStringToNigerian, movesAreEquivalent } from "../src/gameLogic.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const engineDirectory = join(root, "nd_upgraded");
const seconds = Number(process.argv[2] || "0.1");
if (!Number.isFinite(seconds) || seconds < 0.05 || seconds > 5) throw new Error("Search budget must be0.05–5 seconds.");
const cases = [
  { name: "standard-opening", board: createInitialBoard() },
  { name: "free-choice-king", board: { 34: "W", 1: "b", 8: "b", 28: "b", 36: "b" } },
  { name: "looping-man-capture", board: { 23: "w", 17: "b", 16: "b", 26: "b", 27: "b", 1: "b" } },
  { name: "uncounted-lone-king", board: { 23: "W", 50: "B" } },
  { name: "154-choice-stress", board: { 4: "W", 6: "W", 8: "b", 11: "b", 13: "W", 16: "b", 17: "b", 20: "W", 22: "b", 24: "b", 25: "b", 27: "b", 30: "W", 34: "b", 38: "W", 43: "b", 44: "b", 50: "W" } },
];
const child = spawn(join(engineDirectory, process.platform === "win32" ? "scan_nigerian.exe" : "scan_nigerian"), ["hub"], { cwd: engineDirectory, stdio: ["pipe", "pipe", "pipe"] });
let buffer = "";
let stderr = "";
child.stderr.on("data", (data) => { stderr = (stderr + data).slice(-4000); });
function query(command, ready = false) {
  return new Promise((resolve, reject) => {
    const lines = [];
    const cleanup = () => { clearTimeout(timer); clearTimeout(softStop); child.stdout.off("data", onData); child.off("error", fail); child.off("exit", onExit); child.stdin.off("error", fail); };
    const fail = (error) => { cleanup(); reject(error); };
    const onExit = (code, signal) => fail(new Error(`Engine exited:${signal || code};${stderr}`));
    const onData = (data) => {
      buffer += data.toString();
      const parts = buffer.split("\n"); buffer = parts.pop() || "";
      for (const part of parts) {
        const line = part.trim(); lines.push(line);
        if (line.startsWith("error ")) { fail(new Error(line)); return; }
        if ((ready && line === "ready") || (!ready && line.startsWith("done "))) { cleanup(); resolve(lines); return; }
      }
    };
    const timer = setTimeout(() => fail(new Error(`Engine query timed out;${stderr}`)), (seconds + 5) * 1000);
    const softStop = ready ? undefined : setTimeout(() => { if (child.stdin.writable) child.stdin.write("stop\n"); }, (seconds + 0.5) * 1000);
    child.stdout.on("data", onData); child.once("error", fail); child.once("exit", onExit); child.stdin.once("error", fail);
    child.stdin.write(command + "\n");
  });
}
try {
  const started = performance.now();
  await query("hub\ninit", true);
  const initializationMs = performance.now() - started;
  const results = [];
  for (const { name, board } of cases) {
    const fen = boardToScanFen(board, "W");
    const legal = generateLegalMoves(board, "W");
    const before = performance.now();
    const lines = await query(`set-param name=eval value=pattern\nnew-game\npos pos="${fen}"\nlevel depth=8 move-time=${seconds.toFixed(3)}\ngo think`);
    const elapsedMs = performance.now() - before;
    const done = lines.find((line) => line.startsWith("done "));
    const move = done?.match(/(?:^|\s)move=(\S+)/)?.[1];
    const parsed = move && hubMoveStringToNigerian(move);
    if (!parsed || !legal.some((candidate) => movesAreEquivalent(candidate, parsed))) throw new Error(`Illegal engine move in${name}: ${move || "none"}`);
    const info = lines.filter((line) => line.startsWith("info ")).at(-1) || "";
    const number = (key) => Number(info.match(new RegExp(`(?:^|\\s)${key}=(-?[0-9.]+)`))?.[1] ||0);
    results.push({ name, legalMoves: legal.length, elapsedMs: Math.round(elapsedMs * 100) / 100, depth: number("depth"), nodes: number("nodes"), score: number("score"), move, fen });
  }
  console.log(JSON.stringify({ platform: process.platform, architecture: process.arch, searchBudgetSeconds: seconds, depthLimit: 8, evaluation: "pattern", initializationMs: Math.round(initializationMs * 100) / 100, results }, null, 2));
} finally {
  if (child.stdin.writable) child.stdin.end("quit\n");
  child.kill();
}
