/** Real WebSocket regression against a disposable loopback-only application module. */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { generateLegalMoves, movesAreEquivalent, type Board } from "../../src/gameLogic";

if (process.env.SUPABASE_URL || process.env.SUPABASE_SECRET_KEY) {
  throw new Error("This disposable fixture refuses configured Supabase credentials");
}
const storage = await mkdtemp(path.join(os.tmpdir(), "kentro-websocket-smoke-"));
process.env.KENTRO_DATA_DIR = storage;
process.env.NODE_ENV = "test";
const { attachOnlinePlay } = await import("../../src/server/onlinePlay");
const { initGameRecordsManager, flushGameRecords } = await import("../../src/server/gameRecordsManager");
const server = createServer((_request, response) => { response.writeHead(404); response.end(); });
await initGameRecordsManager({ handleSignals: false });
const online = attachOnlinePlay(server, {
  coinsEnabled: false,
  getCoinSettings: async () => ({ matchRakePercent: 0 }),
  resolveEntryFee: () => 0,
  sanitizeWagerAmount: (raw) => Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Number(raw) : null,
  sanitizeBestOf: (raw) => [1, 3, 5, 7].includes(Number(raw)) ? Number(raw) : 1,
  sanitizeCustomBoard: (raw) => raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Board : null,
  findLegalMatch: (board, turn, claimed) => generateLegalMoves(board, turn).find((move) => movesAreEquivalent(move, claimed)) ?? null,
});
try {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture listener address");
  console.log("Disposable WebSocket fixture: no hosted authentication, wallets, database or media transport.");
  const child = spawn(process.execPath, ["--import", pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href,
    path.resolve("scripts/pvp-smoke.ts")], {
    env: { ...process.env, SMOKE_URL: `ws://127.0.0.1:${address.port}` }, stdio: "inherit",
  });
  const status = await new Promise<number>((resolve, reject) => {
    child.once("error", reject); child.once("exit", (code) => resolve(code ?? 1));
  });
  if (status !== 0) throw new Error(`PvP smoke failed with exit ${status}`);
} finally {
  online.shutdown();
  await new Promise<void>((resolve) => online.wss.close(() => resolve()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await flushGameRecords();
  await rm(storage, { recursive: true, force: true });
}
