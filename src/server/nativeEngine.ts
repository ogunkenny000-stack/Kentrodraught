import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { generateLegalMoves, hubMoveStringToNigerian, movesAreEquivalent, moveToHubString, scanFenToBoard } from "../gameLogic";
import { Mutex } from "./engineMutex";
import { isEngineDepth, isScanFen, MAX_ENGINE_DEPTH } from "./engineRequest";

export interface EngineResult { score: number; depth: number; pv: string; move: string; nodes?: number }
interface Flight { controller: AbortController; promise: Promise<EngineResult>; requestKey: string }
interface EngineOptions {
  binaryPath?: string;
  workDir?: string;
  initTimeoutMs?: number;
  searchGraceMs?: number;
  spawnProcess?: () => ChildProcessWithoutNullStreams;
}

/** One Hub conversation, shared completed results, and independently cancellable streams. */
export class PersistentEngine {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private readyPromise: Promise<void> | null = null;
  private mutex = new Mutex();
  private cache = new Map<string, EngineResult>();
  private flights = new Map<string, Flight>();
  private streams = new Map<string, Flight>();
  private nextRequest = 0;
  private stopped = false;
  private stopPromise: Promise<void> | null = null;
  private options: Required<Omit<EngineOptions, "spawnProcess">> & Pick<EngineOptions, "spawnProcess">;

  constructor(options: EngineOptions = {}) {
    this.options = {
      binaryPath: path.join(process.cwd(), "nd_upgraded", "scan_nigerian"),
      workDir: path.join(process.cwd(), "nd_upgraded"),
      initTimeoutMs: 15_000,
      searchGraceMs: 2500,
      ...options,
    };
  }

  private log(line: string): void {
    if (process.env.ENGINE_DEBUG === "1") {
      fs.appendFile(path.join(this.options.workDir, "engine.log"), line + "\n", () => {});
    }
  }

  private retire(child: ChildProcessWithoutNullStreams): void {
    if (this.proc === child) { this.proc = null; this.readyPromise = null; }
    if (!child.killed) child.kill();
  }

  private write(child: ChildProcessWithoutNullStreams, command: string, fail: (err: Error) => void): void {
    if (child.killed || !child.stdin.writable || child.stdin.destroyed) { fail(new Error("Engine input unavailable")); return; }
    try { child.stdin.write(command, (err) => { if (err) fail(err); }); }
    catch (err) { fail(err instanceof Error ? err : new Error("Engine input failed")); }
  }

  private start(): Promise<void> {
    if (this.stopped) return Promise.reject(new Error("Engine is shutting down"));
    if (this.proc && this.readyPromise) return this.readyPromise;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.options.spawnProcess?.() ?? spawn(this.options.binaryPath, ["hub"], { cwd: this.options.workDir });
    } catch (err) { return Promise.reject(err); }
    this.proc = child;
    const ready = new Promise<void>((resolve, reject) => {
      let buffer = "", settled = false;
      const cleanup = () => { clearTimeout(timer); child.stdout.off("data", onData); };
      const fail = (err: Error) => {
        if (!settled) { settled = true; cleanup(); reject(err); }
        this.retire(child);
      };
      // Keep lifecycle and stdin error handlers for the entire child lifetime,
      // including idle time, so an EPIPE never becomes an uncaught exception.
      child.on("error", fail);
      child.stdin.on("error", fail);
      child.on("exit", (code, signal) => fail(new Error(`Engine exited (${code ?? signal})`)));
      child.on("close", (code, signal) => fail(new Error(`Engine closed (${code ?? signal})`)));
      child.stderr.on("data", (chunk) => this.log(`STDERR ${chunk}`));
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString();
        if (buffer.length > 1_048_576) { fail(new Error("Engine initialization output too large")); return; }
        const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const raw of lines) {
          const line = raw.trim(); this.log(`INIT ${line}`);
          if (line === "wait") this.write(child, "init\n", fail);
          if (line === "ready" && !settled) { settled = true; cleanup(); resolve(); }
        }
      };
      const timer = setTimeout(() => fail(new Error("Engine initialization timed out")), this.options.initTimeoutMs);
      child.stdout.on("data", onData);
      this.write(child, "hub\n", fail);
    });
    this.readyPromise = ready;
    // A write callback or error may settle during startup. Reset only this child.
    void ready.catch(() => { if (this.proc === child) { this.proc = null; this.readyPromise = null; } });
    return ready;
  }

  private async ready(signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new Error("Superseded");
    let abort: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new Error("Superseded"));
      signal.addEventListener("abort", abort, { once: true });
    });
    try { await Promise.race([this.start(), cancelled]); }
    finally { signal.removeEventListener("abort", abort!); }
  }

  async warmUp(): Promise<void> {
    try { await this.start(); } catch (err) { console.warn("[engine] warm-up failed:", err instanceof Error ? err.message : err); }
  }

  async ping(): Promise<boolean> {
    const release = await this.mutex.acquire(true).catch(() => null);
    if (!release) return false;
    try {
      await this.start();
      const child = this.proc!;
      return await new Promise<boolean>((resolve) => {
        let buffer = "", settled = false;
        const finish = (ok: boolean) => {
          if (settled) return; settled = true;
          clearTimeout(timer); child.stdout.off("data", onData);
          child.off("exit", down); child.off("close", down); child.off("error", down); child.stdin.off("error", down);
          if (!ok) this.retire(child);
          resolve(ok);
        };
        const down = () => finish(false);
        const onData = (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n"); buffer = lines.pop() || "";
          if (lines.some((line) => line.trim() === "pong")) finish(true);
          else if (buffer.length > 1_048_576) finish(false);
        };
        const timer = setTimeout(down, 1000);
        child.stdout.on("data", onData);
        child.once("exit", down); child.once("close", down); child.once("error", down); child.stdin.once("error", down);
        this.write(child, "ping\n", down);
      });
    } catch { return false; }
    finally { release(); }
  }

  async getMove(fen: string, thinkTimeSec: number, depth?: number, isHighPriority = true, usePst = false, supersedeKey?: string, signal?: AbortSignal): Promise<EngineResult> {
    if (this.stopped) throw new Error("Engine is shutting down");
    if (!isScanFen(fen)) throw new Error("Invalid engine position");
    if (!Number.isFinite(thinkTimeSec) || thinkTimeSec <= 0 || thinkTimeSec > 5) throw new Error("Invalid engine time budget");
    if (depth !== undefined && !isEngineDepth(depth)) throw new Error("Invalid engine search depth");
    if (signal?.aborted) throw new Error("Superseded");
    const cacheKey = `${fen}|${thinkTimeSec.toFixed(3)}|${depth ?? MAX_ENGINE_DEPTH}|${usePst ? 1 : 0}`;
    // A request with a disconnect signal and no stream must not coalesce with
    // an independent HTTP caller: one socket cannot cancel another socket.
    const requestKey = JSON.stringify([cacheKey, supersedeKey ?? null, signal ? ++this.nextRequest : null]);
    const previous = supersedeKey ? this.streams.get(supersedeKey) : undefined;
    if (previous && previous.requestKey !== requestKey) previous.controller.abort();
    const cached = this.cache.get(cacheKey);
    if (cached) { this.cache.delete(cacheKey); this.cache.set(cacheKey, cached); return { ...cached }; }
    const existing = this.flights.get(requestKey);
    if (existing && !existing.controller.signal.aborted) return existing.promise;

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const flight: Flight = { controller, requestKey, promise: undefined! };
    flight.promise = this.execute(fen, thinkTimeSec, depth, isHighPriority, usePst, controller.signal).then((result) => {
      if (controller.signal.aborted) throw new Error("Superseded");
      if (this.cache.size >= 5000) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(cacheKey, result);
      return { ...result };
    }).finally(() => {
      signal?.removeEventListener("abort", onAbort);
      if (this.flights.get(requestKey) === flight) this.flights.delete(requestKey);
      if (supersedeKey && this.streams.get(supersedeKey) === flight) this.streams.delete(supersedeKey);
    });
    this.flights.set(requestKey, flight);
    if (supersedeKey) this.streams.set(supersedeKey, flight);
    return flight.promise;
  }

  private async execute(fen: string, thinkTime: number, depth: number | undefined, high: boolean, pst: boolean, signal: AbortSignal): Promise<EngineResult> {
    const release = await this.mutex.acquire(high, undefined, undefined, signal);
    try {
      if (signal.aborted) throw new Error("Superseded");
      const { board, turn } = scanFenToBoard(fen);
      const legal = generateLegalMoves(board, turn);
      if (!legal.length) return { move: "", score: -10000, depth: 0, nodes: 0, pv: "" };
      await this.ready(signal);
      if (signal.aborted) throw new Error("Superseded");
      const child = this.proc;
      if (!child) throw new Error("Engine process unavailable");
      return await new Promise<EngineResult>((resolve, reject) => {
        let buffer = "", settled = false;
        const result: EngineResult = { move: "", score: NaN, depth: 0, nodes: 0, pv: "" };
        const cleanup = () => {
          clearTimeout(hardTimer); clearTimeout(softTimer);
          child.stdout.off("data", onData); child.off("error", fail); child.stdin.off("error", fail);
          child.off("exit", down); child.off("close", down); signal.removeEventListener("abort", stop);
        };
        const fail = (err: Error) => {
          if (settled) return; settled = true; cleanup(); this.retire(child);
          reject(signal.aborted ? new Error("Superseded") : err);
        };
        const down = () => fail(new Error("Engine exited during search"));
        const stop = () => this.write(child, "stop\n", fail);
        const finish = () => {
          if (settled) return;
          const parsed = hubMoveStringToNigerian(result.move);
          const canonical = parsed && legal.find((move) => movesAreEquivalent(move, parsed));
          if (!canonical || !Number.isFinite(result.score)) { fail(new Error("Engine returned an invalid move or evaluation")); return; }
          settled = true; cleanup();
          if (signal.aborted) reject(new Error("Superseded"));
          else resolve({ ...result, move: moveToHubString(canonical) });
        };
        const onData = (chunk: Buffer) => {
          buffer += chunk.toString();
          if (buffer.length > 1_048_576) { fail(new Error("Engine search output too large")); return; }
          const lines = buffer.split("\n"); buffer = lines.pop() || "";
          for (const raw of lines) {
            if (settled) break;
            const line = raw.trim(); this.log(line);
            if (line.startsWith("info ")) {
              const fields = new Map([...line.matchAll(/(?:^|\s)([\w-]+)=("[^"]*"|\S+)/g)].map((m) => [m[1], m[2].replace(/^"|"$/g, "")]));
              if (fields.has("score")) result.score = Math.round(Number(fields.get("score")) * 100);
              if (fields.has("depth")) result.depth = Number(fields.get("depth"));
              if (fields.has("nodes")) result.nodes = Number(fields.get("nodes"));
              if (fields.has("pv")) result.pv = fields.get("pv")!;
            } else if (line === "done" || line.startsWith("done ")) {
              result.move = line.match(/(?:^|\s)move=(\S+)/)?.[1] || ""; finish();
            } else if (line.startsWith("error")) { fail(new Error("Engine rejected search command")); }
          }
        };
        const hardTimer = setTimeout(() => fail(new Error("Engine timed out")), thinkTime * 1000 + this.options.searchGraceMs);
        const softTimer = setTimeout(stop, thinkTime * 1000);
        signal.addEventListener("abort", stop, { once: true });
        child.stdout.on("data", onData); child.on("error", fail); child.stdin.on("error", fail);
        child.once("exit", down); child.once("close", down);
        // `go think` may return a forced/book move without an evaluation. The
        // application promises a score too, so request an actual bounded search.
        this.write(child, `set-param name=eval value=${pst ? "pst" : "pattern"}\npos pos="${fen}"\nlevel move-time=${thinkTime.toFixed(3)}\nlevel depth=${depth ?? MAX_ENGINE_DEPTH}\ngo analyze\n`, fail);
      });
    } finally { release(); }
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopped = true;
    for (const flight of this.flights.values()) flight.controller.abort();
    const child = this.proc;
    this.proc = null;
    this.readyPromise = null;
    if (!child || child.exitCode != null || child.signalCode != null) return Promise.resolve();
    this.stopPromise = new Promise<void>((resolve) => {
      const complete = () => {
        clearTimeout(deadline);
        child.off("exit", complete);
        child.off("close", complete);
        resolve();
      };
      const deadline = setTimeout(() => child.kill("SIGKILL"), 500);
      child.once("exit", complete);
      child.once("close", complete);
      child.kill("SIGTERM");
    });
    return this.stopPromise;
  }
}
