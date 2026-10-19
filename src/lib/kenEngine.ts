/** Client for the project's compiled native Scan C++ engine. */
import { Board, Move, boardToScanFen, hubMoveStringToNigerian, generateLegalMoves, movesAreEquivalent } from "../gameLogic";
import { KEN_LEVELS } from "./constants";
import { supabase } from "../supabase";

export interface KenResult {
  move: Move | null;
  score: number;
  depth: number;
  nodes: number;
  pv: string;
  fromCache?: boolean;
  kenProof?: string;
}

export class EngineUnavailableError extends Error {
  constructor() { super("Ken engine unavailable."); this.name = "EngineUnavailableError"; }
}
export class SupersededError extends Error {
  constructor() { super("Engine request superseded."); this.name = "SupersededError"; }
}

class ClientLRUCache<V> {
  private map = new Map<string, V>();
  constructor(private readonly maxEntries = 2000) {}
  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) { this.map.delete(key); this.map.set(key, value); }
    return value;
  }
  set(key: string, value: V): void {
    this.map.delete(key);
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
  }
  clear(): void { this.map.clear(); }
}

type Flight = { cacheKey: string; requestKey: string; controller: AbortController; promise: Promise<KenResult> };
const clientEngineCache = new ClientLRUCache<KenResult>();
const inFlightRequests = new Map<string, Flight>();
const activeBySupersedeKey = new Map<string, Flight>();
// A tab owns its cancellation streams. Identical component names in another
// browser must never preempt this tab's native search on the shared server.
const browserRequestNamespace = globalThis.crypto?.randomUUID?.()
  ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

async function requestMove(
  board: Board, turn: "W" | "B", thinkTimeSec: number, depth: number,
  usePst = false, supersedeKey?: string, levelId?: number, gameId?: string
): Promise<KenResult> {
  const position = { ...board };
  const fen = boardToScanFen(position, turn);
  const cacheKey = `${fen}|${thinkTimeSec.toFixed(3)}|${depth}|${usePst ? 1 : 0}|${levelId ?? "analysis"}|${gameId ?? ""}`;
  // Cancellation belongs to the caller's stream, not to unrelated callers
  // requesting the same position. They can still share completed evaluations.
  const requestKey = JSON.stringify([cacheKey, supersedeKey || null]);
  const previous = supersedeKey ? activeBySupersedeKey.get(supersedeKey) : undefined;
  if (previous && previous.requestKey !== requestKey) {
    previous.controller.abort();
    if (inFlightRequests.get(previous.requestKey) === previous) inFlightRequests.delete(previous.requestKey);
    if (activeBySupersedeKey.get(supersedeKey!) === previous) activeBySupersedeKey.delete(supersedeKey!);
  }

  // Supersede first, even when the new position is already cached (A→B→A).
  const cached = clientEngineCache.get(cacheKey);
  if (cached) return { ...cached, fromCache: true };
  const existing = inFlightRequests.get(requestKey);
  if (existing && !existing.controller.signal.aborted) return existing.promise;

  const legalMoves = generateLegalMoves(position, turn);
  if (legalMoves.length === 0) return { move: null, score: -10000, depth: 0, nodes: 0, pv: "" };

  const controller = new AbortController();
  const flight: Flight = { cacheKey, requestKey, controller, promise: undefined! };
  const promise = (async (): Promise<KenResult> => {
    try {
      let res: Response;
      try {
        const { data } = await supabase.auth.getSession();
        if (controller.signal.aborted) throw new SupersededError();
        const token = data.session?.access_token;
        res = await fetch("/api/engine/move", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
          signal: controller.signal,
          body: JSON.stringify({ fen, purpose: levelId ? "play" : "analysis", levelId, gameId, thinkTime: thinkTimeSec, ...(depth > 0 ? { depth } : {}), usePst,
            supersedeKey: supersedeKey ? `${browserRequestNamespace}:${supersedeKey}` : undefined }),
        });
      } catch (err: any) {
        if (controller.signal.aborted || err?.name === "AbortError") throw new SupersededError();
        throw new EngineUnavailableError();
      }
      if (controller.signal.aborted || res.status === 499) throw new SupersededError();
      if (!res.ok) throw new EngineUnavailableError();
      const data = await res.json().catch(() => null);
      if (controller.signal.aborted) throw new SupersededError();
      if (!data || typeof data.move !== "string" || !Number.isFinite(data.score)) throw new EngineUnavailableError();
      const parsed = hubMoveStringToNigerian(data.move);
      const canonical = parsed && legalMoves.find((move) => movesAreEquivalent(move, parsed));
      if (!canonical) throw new EngineUnavailableError();
      const result: KenResult = {
        move: canonical,
        score: data.score,
        depth: Number.isFinite(data.depth) ? data.depth : 0,
        nodes: Number.isFinite(data.nodes) ? data.nodes : 0,
        pv: typeof data.pv === "string" ? data.pv : "",
        kenProof: typeof data.kenProof === "string" ? data.kenProof : undefined,
      };
      clientEngineCache.set(cacheKey, result);
      return result;
    } finally {
      // An old aborted A must never delete a newer A's pending request.
      if (inFlightRequests.get(requestKey) === flight) inFlightRequests.delete(requestKey);
      if (supersedeKey && activeBySupersedeKey.get(supersedeKey) === flight) activeBySupersedeKey.delete(supersedeKey);
    }
  })();
  flight.promise = promise;
  inFlightRequests.set(requestKey, flight);
  if (supersedeKey) activeBySupersedeKey.set(supersedeKey, flight);
  return promise;
}

/** Preserve the existing eight levels and their configured depth/time/eval. */
export async function getKenMove(board: Board, turn: "W" | "B", levelId: number, gameId?: string): Promise<KenResult> {
  const level = KEN_LEVELS.find((value) => value.id === levelId) || KEN_LEVELS[0];
  return requestMove(board, turn, level.moveTimeMs / 1000, level.depth, level.pst, "ken-game-move", level.id, gameId);
}

export async function analyzeKen(board: Board, turn: "W" | "B", moveTimeMs: number, supersedeKey?: string): Promise<KenResult> {
  return requestMove(board, turn, moveTimeMs / 1000, 0, false, supersedeKey);
}

export function clearClientEngineCache(): void {
  for (const flight of inFlightRequests.values()) flight.controller.abort();
  inFlightRequests.clear();
  activeBySupersedeKey.clear();
  clientEngineCache.clear();
}
