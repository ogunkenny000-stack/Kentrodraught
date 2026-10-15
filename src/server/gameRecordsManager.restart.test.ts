import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const children: ChildProcess[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
function run(cwd: string, storage: string, mode: "read" | "write" | "write-inflight", code = "") {
  const child = spawn(process.execPath, ["--import", pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href,
    path.resolve("scripts/audit/game-records-restart-child.ts"), mode, code], {
    cwd, env: { ...process.env, KENTRO_DATA_DIR: storage, SUPABASE_URL: "", SUPABASE_SECRET_KEY: "" }, stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let output = "", errors = "";
  child.stdout!.on("data", (chunk) => { output += String(chunk); });
  child.stderr!.on("data", (chunk) => { errors += String(chunk); });
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (status, signal) => status === 0 ? resolve() : reject(new Error(`Fixture exit ${status}/${signal}: ${errors}\n${output}`)));
  });
  const ready = new Promise<any>((resolve, reject) => {
    const onData = () => {
      const line = output.split("\n").find((entry) => entry.startsWith("FIXTURE "));
      if (line) { child.stdout!.off("data", onData); resolve(JSON.parse(line.slice(8))); }
    };
    child.stdout!.on("data", onData);
    exited.catch(reject);
  });
  return { child, ready, exited };
}
describe("actual on-disk game record restart", () => {
  it("retains the newer exit snapshot when SIGTERM interrupts an in-flight file write", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "kentro-record-inflight-")); directories.push(temporary);
    const storage = path.join(temporary, "records");
    const writer = run(temporary, storage, "write-inflight");
    const { code, inFlight } = await writer.ready;
    expect(inFlight).toBe(true);
    writer.child.kill("SIGTERM"); await writer.exited;
    const reader = run(temporary, storage, "read", code);
    const recovered = await reader.ready; await reader.exited;
    expect(recovered.record).toMatchObject({ gameCode: code, nextGameCode: "fixture-next", rematchStatus: "accepted", finalResult: "0–1" });
    expect((await readdir(storage)).sort()).toEqual(["game_seq.json", "permanent_game_records.json", "rematch_series.json"]);
  }, 20000);
  it("drains on SIGTERM, recovers private results/series/custom first mover and never reuses a code", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "kentro-record-restart-")); directories.push(temporary);
    const storage = path.join(temporary, "durable volume with spaces");
    const firstCwd = path.join(temporary, "first-process"), secondCwd = path.join(temporary, "second-process");
    await Promise.all([mkdir(firstCwd), mkdir(secondCwd)]);
    const writer = run(firstCwd, storage, "write");
    const { code } = await writer.ready;
    writer.child.kill("SIGTERM"); await writer.exited;
    expect((await readdir(firstCwd))).toEqual([]);
    expect((await readdir(storage)).sort()).toEqual(["game_seq.json", "permanent_game_records.json", "rematch_series.json"]);
    expect(JSON.parse(await readFile(path.join(storage, "permanent_game_records.json"), "utf8"))[0].gameCode).toBe(code);
    const reader = run(secondCwd, storage, "read", code);
    const recovered = await reader.ready; await reader.exited;
    expect(recovered.record).toMatchObject({ gameCode: code, private: true, participantUserIds: ["fixture-white", "fixture-black"],
      startingPosition: { 1: "B", 46: "W" }, startingTurn: "B", currentPosition: { 7: "B", 46: "W" }, currentTurn: "W",
      completeMoveHistory: [{ from: 1, to: 7, caps: [] }], finalResult: "0–1", serverSyncPending: true });
    expect(recovered.series).toMatchObject({ seriesGamesCount: 1, scores: { fixture_white: 0, fixture_black: 1 } });
    expect(recovered.recent).toEqual([]);
    expect(Number(recovered.next)).toBeGreaterThan(Number(code));
    // A missing counter is recovered from durable games, even under a new cwd.
    await unlink(path.join(storage, "game_seq.json"));
    const fallback = run(secondCwd, storage, "read", code);
    const missingCounter = await fallback.ready; await fallback.exited;
    expect(Number(missingCounter.next)).toBeGreaterThan(Number(code));
    expect(await readdir(secondCwd)).toEqual([]);
  }, 20000);
});
