import express from "express";
import { DurableState } from "./durableState";
import {
  startTournament,
  applyTournamentResult,
  settleArena,
  type TournamentState,
} from "./tournamentEngine";
import { getSupabaseAdmin, verifyAccessToken } from "../../supabaseAdmin";
import { requirePermission } from "../../adminService";
import { requestAccessToken } from "./httpAuth";
export interface TournamentRepository {
  load(id: string): Promise<TournamentState | null>;
  active(): Promise<TournamentState[]>;
  save(
    id: string,
    version: number,
    next: TournamentState,
  ): Promise<TournamentState | null>;
  profile(name: string): Promise<{ username: string; uid: string }>;
}
export const hostedTournamentRepository: TournamentRepository = {
  async load(id) {
    const { data, error } = await getSupabaseAdmin()
      .from("tournaments")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  async active() {
    const rows: TournamentState[] = [];
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await getSupabaseAdmin()
        .from("tournaments")
        .select("*")
        .eq("status", "active")
        .order("id")
        .range(offset, offset + 99);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 100) return rows;
    }
  },
  async save(id, version, next) {
    const { data, error } = await getSupabaseAdmin().rpc(
      "kentro_commit_tournament",
      { p_id: id, p_version: version, p_next: next },
    );
    if (error) throw error;
    return data;
  },
  async profile(name) {
    const { data, error } = await getSupabaseAdmin()
      .from("profiles")
      .select("username,ownerId,banned,suspendedUntil")
      .eq("usernameLower", name.toLowerCase())
      .single();
    if (
      error ||
      !data?.ownerId ||
      data.banned ||
      Number(data.suspendedUntil) > Date.now()
    )
      throw new Error("Competitor account unavailable");
    return { username: data.username, uid: data.ownerId };
  },
};
export interface TournamentResult {
  gameCode: string;
  roomId: string;
  white: string;
  black: string;
  winner: "W" | "B" | null;
  draw: boolean;
  tournamentId?: string;
}
export class TournamentRuntime {
  private busy = false;
  private closing = false;
  private failed = false;
  storageHealthy = () => !this.failed;
  private persist() {
    try {
      this.disk.write(this.pending);
    } catch (error) {
      this.failed = true;
      throw error;
    }
  }
  private pending: TournamentResult[];
  private disk: DurableState<TournamentResult[]>;
  constructor(
    readonly repo: TournamentRepository,
    readonly room: (spec: any) => void,
    readonly code: () => string,
    file: string | false = false,
  ) {
    this.disk = new DurableState(file);
    this.pending = this.disk.read() || [];
  }
  async mutate(
    id: string,
    plan: (t: TournamentState) => TournamentState,
  ): Promise<TournamentState> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const current = await this.repo.load(id);
      if (!current) throw new Error("Tournament not found");
      const next = plan(current);
      if (JSON.stringify(next) === JSON.stringify(current)) return current;
      const saved = await this.repo.save(id, current.engineVersion || 0, next);
      if (saved) return saved;
    }
    throw new Error("Tournament changed concurrently; retry");
  }
  async start(id: string) {
    const t = await this.mutate(id, (t) => startTournament(t));
    await this.provision(t.id);
    return this.repo.load(id);
  }
  async provision(id: string) {
    const t = await this.mutate(id, (t) => {
      if (t.status !== "active") return t;
      const next = structuredClone(settleArena(t));
      for (const match of next.matches)
        if (match.status !== "completed" && !match.roomId)
          match.roomId = this.code();
      return next;
    });
    for (const match of t.matches.filter((m) => m.status !== "completed")) {
      const white = await this.repo.profile(match.white),
        black = await this.repo.profile(match.black);
      const minutes = String(t.timeControl).toLowerCase().includes("untimed")
        ? 0
        : Number(String(t.timeControl).match(/\d+/)?.[0]) || 5;
      const special: Record<string, string> = {
        "Short One": "short-one",
        "Short Two": "short-two",
        "Short Three": "short-three",
        "Crown Crown": "crown-crown",
      };
      this.room({
        id: match.roomId,
        tournamentId: t.id,
        matchId: match.id,
        white,
        black,
        private: t.visibility === "private" || t.spectatorPermission === false,
        minutes,
        specialRule: special[t.handicap] || "none",
      });
    }
    return t;
  }
  record = (result: TournamentResult): Promise<void> => {
    if (!result.tournamentId) return Promise.resolve();
    if (!this.pending.some((p) => p.gameCode === result.gameCode)) {
      if (this.pending.length >= 10000)
        throw new Error("Tournament outbox is full");
      this.pending.push(result);
      this.persist();
    }
    return this.closing ? Promise.resolve() : this.reconcile();
  };
  async reconcile() {
    if (this.busy || this.closing) return;
    this.busy = true;
    const failures: unknown[] = [];
    try {
      for (const event of this.pending.slice()) {
        try {
          const t = await this.repo.load(event.tournamentId!);
          if (!t)
            throw new Error("Pending tournament was deleted; review outbox");
          const match = t.matches.find((m) => m.roomId === event.roomId);
          if (!match) throw new Error("Pending pairing is missing");
          if (
            match.white !== event.white ||
            match.black !== event.black ||
            event.draw !== (event.winner === null)
          )
            throw new Error(
              "Canonical tournament participants/result mismatch",
            );
          await this.mutate(t.id, (current) =>
            applyTournamentResult(
              current,
              event.roomId,
              event.gameCode,
              event.winner,
            ),
          );
          this.pending = this.pending.filter(
            (p) => p.gameCode !== event.gameCode,
          );
          this.persist();
        } catch (error) {
          failures.push(error);
        }
      }
      for (const t of await this.repo.active())
        try {
          await this.provision(t.id);
        } catch (error) {
          failures.push(error);
        }
      if (failures.length)
        throw new AggregateError(
          failures,
          "Tournament reconciliation pending: " +
            String((failures[0] as Error)?.message || failures[0]),
        );
    } finally {
      this.busy = false;
    }
  }
  async close() {
    this.closing = true;
    while (this.busy) await new Promise((resolve) => setTimeout(resolve, 20));
    this.disk.close();
  }
}
export function createTournamentRuntimeRouter(runtime: TournamentRuntime) {
  const router = express.Router();
  router.use((_q, r, next) => {
    r.setHeader("Cache-Control", "no-store");
    next();
  });
  router.post("/start", async (q, r) => {
    try {
      if (
        !(await requirePermission(
          requestAccessToken(q.headers),
          "manage_tournaments",
        ))
      )
        return r
          .status(403)
          .json({ error: "Tournament organizer permission required" });
      const id = String(q.body?.tournamentId || "");
      if (id.length > 100 || !id)
        return r.status(400).json({ error: "Invalid tournament" });
      r.json({ tournament: await runtime.start(id) });
    } catch (e) {
      r.status(409).json({ error: (e as Error).message });
    }
  });
  router.post("/join-match", async (q, r) => {
    try {
      const uid = await verifyAccessToken(requestAccessToken(q.headers));
      if (!uid) return r.status(401).json({ error: "Sign in to play" });
      const t = await runtime.repo.load(String(q.body?.tournamentId || ""));
      const m = t?.matches.find((m) => m.id === q.body?.matchId);
      if (!t || !m || t.status !== "active" || m.status === "completed")
        return r.status(404).json({ error: "Match unavailable" });
      const white = await runtime.repo.profile(m.white),
        black = await runtime.repo.profile(m.black);
      if (![white.uid, black.uid].includes(uid))
        return r
          .status(403)
          .json({ error: "Only paired competitors may join" });
      await runtime.provision(t.id);
      const updated = await runtime.repo.load(t.id);
      const match = updated!.matches.find((n) => n.id === m.id)!;
      r.json({ roomId: match.roomId, color: white.uid === uid ? "W" : "B" });
    } catch {
      r.status(503).json({ error: "Tournament match could not be prepared" });
    }
  });
  return router;
}
