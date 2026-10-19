import { describe, it, expect } from "vitest";
import {
  TournamentRuntime,
  type TournamentRepository,
} from "./tournamentRuntime";
import type { TournamentState } from "./tournamentEngine";
function fixture() {
  let state: TournamentState = {
    id: "tour",
    status: "registration",
    type: "Swiss Tournament",
    currentRound: 1,
    maxRounds: 1,
    players: ["alice", "bob", "carol", "dave"].map((username) => ({
      username,
      rating: 1500,
      points: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      streak: 0,
    })),
    matches: [],
    logs: [],
    engineVersion: 0,
  };
  const repo: TournamentRepository = {
    load: async () => structuredClone(state),
    active: async () =>
      state.status === "active" ? [structuredClone(state)] : [],
    profile: async (name) => ({ username: name, uid: "id:" + name }),
    save: async (_id, version, next) => {
      await Promise.resolve();
      if (version !== state.engineVersion) return null;
      state = { ...structuredClone(next), engineVersion: version + 1 };
      return structuredClone(state);
    },
  };
  const rooms: any[] = [];
  let code = 0;
  const runtime = new TournamentRuntime(
    repo,
    (spec) => {
      if (!rooms.some((r) => r.id === spec.id)) rooms.push(spec);
    },
    () => String(++code),
  );
  return {
    runtime,
    repo,
    rooms,
    get state() {
      return state;
    },
  };
}
describe("canonical tournament runtime", () => {
  it("provisions paired rooms once and converges concurrent different-game results", async () => {
    const f = fixture();
    await f.runtime.start("tour");
    await f.runtime.provision("tour");
    expect(f.rooms).toHaveLength(2);
    await Promise.all(
      f.rooms.map((room) =>
        f.runtime.record({
          tournamentId: "tour",
          roomId: room.id,
          gameCode: room.id,
          white: room.white.username,
          black: room.black.username,
          winner: "W",
          draw: false,
        }),
      ),
    );
    await f.runtime.reconcile();
    expect(f.state.status).toBe("completed");
    expect(f.state.players.reduce((s, p) => s + p.wins, 0)).toBe(2);
    await f.runtime.close();
  });
  it("rejects participant forgery and leaves a failed result available for retry", async () => {
    const f = fixture();
    await f.runtime.start("tour");
    const room = f.rooms[0];
    await expect(
      f.runtime.record({
        tournamentId: "tour",
        roomId: room.id,
        gameCode: room.id,
        white: "intruder",
        black: room.black.username,
        winner: "W",
        draw: false,
      }),
    ).rejects.toThrow("mismatch");
    expect(f.state.matches[0].winner).toBeNull();
    await f.runtime.close();
  });
  it("retries CAS conflicts instead of losing a concurrent update", async () => {
    const f = fixture();
    const initial = f.state;
    const values = await Promise.all([
      f.runtime.mutate("tour", (s) => ({ ...s, logs: [...s.logs, "one"] })),
      f.runtime.mutate("tour", (s) => ({ ...s, logs: [...s.logs, "two"] })),
    ]);
    expect(f.state.logs.sort()).toEqual(["one", "two"]);
    expect(initial.logs).toEqual([]);
    expect(values).toHaveLength(2);
    await f.runtime.close();
  });
});
