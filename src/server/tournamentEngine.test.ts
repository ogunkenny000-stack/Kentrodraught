import { describe, it, expect } from "vitest";
import {
  startTournament,
  applyTournamentResult,
  type TournamentState,
} from "./tournamentEngine";
function fixture(type = "Swiss Tournament", size = 6): TournamentState {
  return {
    id: "t1",
    type,
    status: "registration",
    currentRound: 1,
    maxRounds: 3,
    timeControl: "Blitz 5m",
    players: Array.from({ length: size }, (_, i) => ({
      username: "player_" + i,
      rating: 1800 - i * 50,
      points: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      streak: 0,
      team: i % 2 ? "Black" : "Gold",
    })),
    matches: [],
    logs: [],
  };
}
const types = [
  "Swiss Tournament",
  "Arena Tournament",
  "Single Elimination",
  "Double Elimination",
  "Round Robin",
  "Team Tournament",
  "League Tournament",
  "Knockout Cup",
  "Group Stage + Knockout",
  "King of the Hill",
  "Robin Hood Tournament (Handicap Tournament)",
  "Custom Tournament",
];
describe("server tournament engine", () => {
  it.each(types)(
    "completes %s only from idempotent canonical results",
    (type) => {
      let t = startTournament(fixture(type), 0);
      let counter = 0;
      while (t.status !== "completed") {
        if (++counter > 200) throw new Error("Tournament failed to finish");
        const match = t.matches.find((m) => m.status !== "completed");
        expect(match).toBeDefined();
        match!.roomId = "room" + counter;
        const next = applyTournamentResult(
          t,
          match!.roomId!,
          "game" + counter,
          "W",
          700000,
        );
        expect(
          applyTournamentResult(
            next,
            match!.roomId!,
            "game" + counter,
            "W",
            700000,
          ),
        ).toEqual(next);
        t = next;
      }
      expect(t.engineState?.champions?.length).toBeGreaterThan(0);
      expect(t.matches.every((m) => m.status === "completed")).toBe(true);
      if (type === "Round Robin" || type === "League Tournament")
        expect(
          new Set(t.matches.map((m) => [m.white, m.black].sort().join(":")))
            .size,
        ).toBe(15);
      if (type === "Team Tournament")
        for (const m of t.matches)
          expect(t.players.find((p) => p.username === m.white)?.team).not.toBe(
            t.players.find((p) => p.username === m.black)?.team,
          );
    },
  );
  it("replays elimination draws with reversed colors without inventing a winner", () => {
    const t = startTournament(fixture("Single Elimination", 2));
    t.matches[0].roomId = "r";
    const after = applyTournamentResult(t, "r", "g", null);
    expect(after.status).toBe("active");
    expect(after.matches[1]).toMatchObject({
      white: t.matches[0].black,
      black: t.matches[0].white,
      winner: null,
      status: "pending",
    });
    expect(after.players.map((p) => p.points)).toEqual([0.5, 0.5]);
  });
  it("handles odd round robin rosters without duplicate opponents or byes", () => {
    let t = startTournament(fixture("Round Robin", 5));
    let i = 0;
    while (t.status === "active") {
      const m = t.matches.find((m) => m.status !== "completed")!;
      m.roomId = "r" + i;
      t = applyTournamentResult(t, m.roomId, "g" + i++, "W");
    }
    expect(t.matches.filter((m) => m.black !== "∅")).toHaveLength(10);
    expect(t.players.every((p) => p.byes === 1)).toBe(true);
  });
  it("rejects duplicate players, invalid registration and contradictory terminal results", () => {
    const f = fixture();
    f.players[1].username = f.players[0].username;
    expect(() => startTournament(f)).toThrow("Duplicate");
    const t = startTournament(fixture("Swiss Tournament", 2));
    t.matches[0].roomId = "r";
    const after = applyTournamentResult(t, "r", "g", "W");
    expect(() => applyTournamentResult(after, "r", "g", "B")).toThrow(
      "Conflicting",
    );
  });
});

it.each([5, 9])(
  "does not replay opponents in smaller group pools for a %s-player event",
  (size) => {
    let t = startTournament(fixture("Group Stage + Knockout", size));
    let code = 0;
    while (t.engineState?.stage !== "knockout") {
      const m = t.matches.find((m) => m.status !== "completed")!;
      m.roomId = "room" + code;
      t = applyTournamentResult(t, m.roomId, "game" + code++, "W");
    }
    const groupMatches = t.matches.filter(
      (m) => m.round <= Number(t.engineState.groupRounds) && m.black !== "∅",
    );
    expect(
      new Set(groupMatches.map((m) => [m.white, m.black].sort().join(":")))
        .size,
    ).toBe(groupMatches.length);
  },
);


it('keeps the reigning hill winner through draws and crowns them over the points leader',()=>{
 let t=startTournament({...fixture('King of the Hill',3),maxRounds:4});let king='';
 for(let round=1;round<=4;round++){
  const match=t.matches.find(m=>m.status!=='completed')!;match.roomId='hill'+round;
  const previous=String(t.engineState!.hillChampion);
  const winner=round===4?null:round===3?(match.white===previous?'B':'W'):(match.white===previous?'W':'B');
  if(round===3)king=winner==='W'?match.white:match.black;
  t=applyTournamentResult(t,match.roomId,'hillgame'+round,winner as 'W'|'B'|null);
 }
 expect(t.status).toBe('completed');expect(t.engineState!.champions).toEqual([king]);
 expect(t.players.find(p=>p.username===king)!.points).toBeLessThan(Math.max(...t.players.map(p=>p.points)));
});
