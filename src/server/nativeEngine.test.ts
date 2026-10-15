import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { applyMove, boardToScanFen, createInitialBoard, generateLegalMoves, moveToHubString, scanFenToBoard } from "../gameLogic";
import { PersistentEngine } from "./nativeEngine";

const board = createInitialBoard();
const fenA = boardToScanFen(board, "W");
const fenB = boardToScanFen(applyMove(board, generateLegalMoves(board, "W")[0]).board, "B");
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
class HubChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  commands: string[] = [];
  fen = fenA;
  autoReply = true;
  initialized = true;
  stopReplies = true;
  replyText?: string;
  stdin = new Writable({ write: (chunk, _encoding, done) => {
    for (const command of chunk.toString().trim().split("\n")) {
      this.commands.push(command);
      if (command === "hub" && this.initialized) queueMicrotask(() => this.stdout.write("wait\n"));
      if (command === "init") queueMicrotask(() => this.stdout.write("ready\n"));
      if (command.startsWith("pos ")) this.fen = command.match(/pos="([^"]+)"/)![1];
      if (command === "ping") queueMicrotask(() => this.stdout.write("po"));
      if (command === "ping") queueMicrotask(() => this.stdout.write("ng\n"));
      if ((command === "go analyze" && this.autoReply) || (command === "stop" && this.stopReplies)) queueMicrotask(() => this.reply());
    }
    done();
  }});
  reply(): void {
    const { board, turn } = scanFenToBoard(this.fen);
    const move = moveToHubString(generateLegalMoves(board, turn)[0]);
    this.stdout.write(this.replyText ?? `info depth=4 score=0.25 nodes=20 pv="${move}"\ndone move=${move}\n`);
  }
  kill(): boolean { if (!this.killed) { this.killed = true; queueMicrotask(() => this.emit("exit", null, "SIGTERM")); } return true; }
}
const engines: PersistentEngine[] = [];
function harness(child = new HubChild(), overrides = {}) {
  const children = [child];
  const engine = new PersistentEngine({ initTimeoutMs: 50, searchGraceMs: 30,
    spawnProcess: () => (children.length ? children.shift()! : new HubChild()) as unknown as ChildProcessWithoutNullStreams,
    ...overrides });
  engines.push(engine);
  return { engine, child, children };
}
afterEach(async () => { await Promise.all(engines.splice(0).map((engine) => engine.stop())); });

describe("persistent native engine lifecycle", () => {
  it("initializes once, handles split ping output, and resets depth on every search", async () => {
    const { engine, child } = harness();
    expect(await engine.ping()).toBe(true);
    expect(await engine.getMove(fenA, 0.2, 4)).toMatchObject({ score: 25, depth: 4, nodes: 20 });
    await engine.getMove(fenB, 0.2);
    expect(child.commands.filter((line) => line === "hub")).toHaveLength(1);
    expect(child.commands).toContain("level depth=4"); expect(child.commands).toContain("level depth=99");
  });
  it("bounds initialization and starts a fresh process after failure", async () => {
    const child = new HubChild(); child.initialized = false;
    const { engine } = harness(child, { initTimeoutMs: 10 });
    await expect(engine.getMove(fenA, 0.1)).rejects.toThrow("initialization timed out");
    expect(child.killed).toBe(true);
    expect((await engine.getMove(fenA, 0.1)).score).toBe(25);
  });
  it("disconnecting during initialization releases that request promptly", async () => {
    const child = new HubChild(); child.initialized = false;
    const { engine } = harness(child, { initTimeoutMs: 1000 });
    const controller = new AbortController();
    const pending = engine.getMove(fenA, 0.1, undefined, true, false, undefined, controller.signal).catch((err) => err);
    await flush(); controller.abort();
    expect(await pending).toHaveProperty("message", "Superseded");
    child.stdout.write("ready\n");
    child.autoReply = true;
    expect((await engine.getMove(fenA, 0.1)).score).toBe(25);
  });
  it.each(["exit", "error", "stdin"])("rejects promptly on %s during search and recovers", async (event) => {
    const { engine, child } = harness(); child.autoReply = false;
    const pending = engine.getMove(fenA, 1).catch((err) => err);
    await flush();
    if (event === "exit") child.emit("exit", 1, null);
    else if (event === "stdin") child.stdin.emit("error", new Error("EPIPE"));
    else child.emit("error", new Error("spawn failed"));
    expect(await pending).toBeInstanceOf(Error);
    expect((await engine.getMove(fenA, 0.1)).score).toBe(25);
  });
  it("handles idle stdin errors without an uncaught event", async () => {
    const { engine, child } = harness(); await engine.warmUp();
    child.stdin.emit("error", new Error("idle EPIPE"));
    expect((await engine.getMove(fenA, 0.1)).score).toBe(25);
  });
  it("kills an unresponsive search before transferring the conversation", async () => {
    const { engine, child } = harness(); child.autoReply = false; child.stopReplies = false;
    await expect(engine.getMove(fenA, 0.01)).rejects.toThrow("timed out");
    expect(child.killed).toBe(true);
    expect((await engine.getMove(fenB, 0.1)).score).toBe(25);
  });
  it.each([
    "info score=NaN\ndone move=31-26\n",
    "info score=0.2\ndone move=1-50\n",
    "done move=31-26\n",
    "info score=Infinity\ndone move=31-26\n",
  ])("rejects malformed, missing-score, or illegal native output", async (replyText) => {
    const child = new HubChild(); child.replyText = replyText;
    const { engine } = harness(child);
    await expect(engine.getMove(fenA, 0.1)).rejects.toThrow("invalid move or evaluation");
  });
  it("returns terminal loss without spawning the native process", async () => {
    const { engine, child } = harness();
    expect(await engine.getMove("W" + "e".repeat(50), 0.1)).toMatchObject({ move: "", score: -10000 });
    expect(child.commands).toHaveLength(0);
  });
  it("reaps the process on shutdown and refuses cached or new work afterward", async () => {
    const { engine, child } = harness();
    await engine.getMove(fenA, 0.1);
    const stopped = engine.stop();
    expect(engine.stop()).toBe(stopped);
    await stopped;
    expect(child.killed).toBe(true);
    expect(await engine.ping()).toBe(false);
    await expect(engine.getMove(fenA, 0.1)).rejects.toThrow("shutting down");
  });
});

describe("native request stream cancellation", () => {
  it("a cached A cancels active B in the same stream", async () => {
    const { engine, child } = harness();
    await engine.getMove(fenA, 0.2, undefined, true, false, "one");
    child.autoReply = false;
    const pending = engine.getMove(fenB, 0.2, undefined, true, false, "one").catch((err) => err);
    await flush();
    expect((await engine.getMove(fenA, 0.2, undefined, true, false, "one")).score).toBe(25);
    expect(await pending).toHaveProperty("message", "Superseded");
    expect(child.commands).toContain("stop");
  });
  it("does not coalesce independently cancellable streams at the same position", async () => {
    const { engine, child } = harness(); child.autoReply = false;
    const first = engine.getMove(fenA, 0.2, undefined, true, false, "one").catch((err) => err);
    const other = engine.getMove(fenA, 0.2, undefined, true, false, "two");
    await flush();
    const next = engine.getMove(fenB, 0.2, undefined, true, false, "one");
    await flush();
    expect(await first).toHaveProperty("message", "Superseded");
    child.reply(); expect((await other).score).toBe(25);
    await flush(); child.reply(); expect((await next).score).toBe(25);
    expect(child.commands.filter((line) => line === "go analyze")).toHaveLength(3);
  });
  it("disconnecting a queued HTTP caller cancels only that caller", async () => {
    const { engine, child } = harness(); child.autoReply = false;
    const running = engine.getMove(fenA, 0.2);
    const disconnected = new AbortController();
    const queued = engine.getMove(fenA, 0.2, undefined, true, false, undefined, disconnected.signal).catch((err) => err);
    await flush(); disconnected.abort();
    expect(await queued).toHaveProperty("message", "Superseded");
    expect(child.commands).not.toContain("stop");
    child.reply(); expect((await running).score).toBe(25);
    expect(child.commands.filter((line) => line === "go analyze")).toHaveLength(1);
  });
  it("disconnecting a running caller stops it and leaves the queue usable", async () => {
    const { engine, child } = harness(); child.autoReply = false;
    const disconnected = new AbortController();
    const running = engine.getMove(fenA, 0.2, undefined, true, false, undefined, disconnected.signal).catch((err) => err);
    const next = engine.getMove(fenB, 0.2);
    await flush(); disconnected.abort(); await flush();
    expect(await running).toHaveProperty("message", "Superseded");
    child.reply(); expect((await next).score).toBe(25);
  });
});
