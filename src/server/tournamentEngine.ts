/** Deterministic tournament authority. Browser results never enter this API. */
export interface Competitor {
  username: string;
  rating: number;
  points: number;
  wins: number;
  losses: number;
  draws: number;
  streak: number;
  team?: string;
  byes?: number;
  buchholz?: number;
  [key: string]: unknown;
}
export interface Pairing {
  id: string;
  round: number;
  white: string;
  black: string;
  winner: "W" | "B" | "D" | null;
  status: "pending" | "playing" | "completed";
  roomId?: string;
  gameCode?: string;
  replayOf?: string;
}
export interface TournamentState {
  id: string;
  type: string;
  status: string;
  currentRound: number;
  maxRounds: number;
  minPlayers?: number;
  players: Competitor[];
  matches: Pairing[];
  logs: string[];
  engineVersion?: number;
  engineState?: {
    format?: string;
    stage?: string;
    seed?: string[];
    groups?: Record<string, number>;
    endsAt?: number;
    champions?: string[];
    [key: string]: unknown;
  };
  [key: string]: any;
}
const key = (s: string) => s.toLowerCase();
const compare = (a: Competitor, b: Competitor) =>
  b.points - a.points ||
  (b.buchholz || 0) - (a.buchholz || 0) ||
  b.rating - a.rating ||
  key(a.username).localeCompare(key(b.username), "en");
function format(type: string) {
  const t = type.toLowerCase();
  if (t.includes("group stage")) return "groups";
  if (t.includes("double")) return "double";
  if (t.includes("single") || t.includes("knockout")) return "knockout";
  if (t.includes("round robin") || t.includes("league")) return "roundrobin";
  if (t.includes("arena")) return "arena";
  if (t.includes("team")) return "team";
  if (t.includes("hill")) return "hill";
  return "swiss";
}
function robin(seed: string[], round: number): [string, string][] {
  const entries = [...seed];
  if (entries.length % 2) entries.push("∅");
  for (let i = 1; i < round; i++) entries.splice(1, 0, entries.pop()!);
  return entries
    .slice(0, entries.length / 2)
    .map((name, i) =>
      round % 2
        ? [name, entries[entries.length - 1 - i]]
        : [entries[entries.length - 1 - i], name],
    );
}
function schedule(t: TournamentState): Pairing[] {
  const f =
    t.engineState!.stage === "knockout" ? "knockout" : t.engineState!.format;
  const eligible = t.players
    .filter((p) =>
      f === "knockout"
        ? (t.engineState?.stage === "knockout"
            ? Number(p.bracketLosses || 0)
            : p.losses) === 0
        : f === "double"
          ? p.losses < 2
          : true,
    )
    .sort(compare);
  let pairs: [string, string][] = [];
  if (f === "roundrobin") pairs = robin(t.engineState!.seed!, t.currentRound);
  else if (f === "groups") {
    for (const group of [0, 1]) {
      const seed = t.engineState!.seed!.filter(
        (n) => t.engineState!.groups![n] === group,
      );
      if (t.currentRound <= seed.length + (seed.length % 2) - 1)
        pairs.push(...robin(seed, t.currentRound));
    }
  } else if (f === "hill") {
    const champion = String(t.engineState!.hillChampion || eligible[0].username);
    const counts = (name: string) =>
      t.matches.filter((m) => m.white === name || m.black === name).length;
    const challenger = eligible
      .filter((p) => p.username !== champion)
      .sort(
        (a, b) => counts(a.username) - counts(b.username) || compare(a, b),
      )[0];
    if (challenger)
      pairs = [
        [
          t.currentRound % 2 ? champion : challenger.username,
          t.currentRound % 2 ? challenger.username : champion,
        ],
      ];
  } else {
    const pool = [...eligible];
    if (f === "team")
      for (let i = 0; i < (t.currentRound - 1) % pool.length; i++)
        pool.push(pool.shift()!);
    if (f !== "team" && pool.length % 2) {
      const bye = pool
        .slice()
        .sort((a, b) => (a.byes || 0) - (b.byes || 0) || compare(b, a))[0];
      pool.splice(pool.indexOf(bye), 1);
      pairs.push([bye.username, "∅"]);
    }
    while (pool.length) {
      const a = pool.shift()!;
      const candidates = pool
        .map((p, index) => ({
          p,
          index,
          penalty:
            (f === "team" && a.team === p.team ? 1e6 : 0) +
            (f === "double" ? Math.abs(a.losses - p.losses) * 10000 : 0) +
            (t.matches.some(
              (m) =>
                (m.white === a.username && m.black === p.username) ||
                (m.black === a.username && m.white === p.username),
            )
              ? 1000
              : 0) +
            Math.abs(a.points - p.points) * 10,
        }))
        .filter((candidate) => f !== "team" || candidate.p.team !== a.team)
        .sort((a, b) => a.penalty - b.penalty || a.index - b.index);
      if (!candidates.length) break;
      const b = pool.splice(candidates[0].index, 1)[0];
      const balance = (n: string) =>
        t.matches.reduce(
          (v, m) => v + (m.white === n ? 1 : 0) - (m.black === n ? 1 : 0),
          0,
        );
      pairs.push(
        balance(a.username) > balance(b.username)
          ? [b.username, a.username]
          : [a.username, b.username],
      );
    }
  }
  return pairs
    .map((pair) => (pair[0] === "∅" ? [pair[1], pair[0]] : pair))
    .map(([white, black], i) => ({
      id: `${t.id}:r${t.currentRound}:${i}`,
      round: t.currentRound,
      white,
      black,
      winner: black === "∅" ? "W" : null,
      status: black === "∅" ? "completed" : "pending",
    }));
}
function award(t: TournamentState, m: Pairing) {
  for (const p of t.players) {
    if (p.username !== m.white && p.username !== m.black) continue;
    if (m.black === "∅") {
      p.points++;
      p.byes = (p.byes || 0) + 1;
      continue;
    }
    const win = m.winner === (p.username === m.white ? "W" : "B");
    const draw = m.winner === "D";
    if (t.engineState?.stage === "knockout" && !win && !draw)
      p.bracketLosses = Number(p.bracketLosses || 0) + 1;
    p.points += win ? 1 : draw ? 0.5 : 0;
    p.wins += win ? 1 : 0;
    p.draws += draw ? 1 : 0;
    p.losses += !win && !draw ? 1 : 0;
    p.streak = win ? p.streak + 1 : 0;
  }
  for (const p of t.players)
    p.buchholz = t.matches
      .filter(
        (m) =>
          m.status === "completed" &&
          m.black !== "∅" &&
          (m.white === p.username || m.black === p.username),
      )
      .reduce(
        (sum, m) =>
          sum +
          (t.players.find(
            (o) => o.username === (m.white === p.username ? m.black : m.white),
          )?.points || 0),
        0,
      );
}
function next(t: TournamentState, now: number): TournamentState {
  if (
    t.matches.some(
      (m) => m.round === t.currentRound && m.status !== "completed",
    )
  )
    return t;
  const f =
    t.engineState!.stage === "knockout" ? "knockout" : t.engineState!.format;
  const alive = t.players.filter((p) =>
    f === "knockout"
      ? (t.engineState?.stage === "knockout"
          ? Number(p.bracketLosses || 0)
          : p.losses) === 0
      : f === "double"
        ? p.losses < 2
        : true,
  );
  if (f === "groups" && t.currentRound >= Number(t.engineState!.groupRounds)) {
    const qualifiers = [0, 1].flatMap((g) =>
      t.players
        .filter((p) => t.engineState!.groups![p.username] === g)
        .sort(compare)
        .slice(0, 2),
    );
    t.engineState!.stage = "knockout";
    t.engineState!.qualifiers = qualifiers.map((p) => p.username);
    // Group losses do not eliminate a qualifying player from the final bracket.
    t.engineState!.groupStats = Object.fromEntries(
      t.players.map((p) => [
        p.username,
        { points: p.points, wins: p.wins, losses: p.losses, draws: p.draws },
      ]),
    );
    t.players.forEach((p) => {
      p.bracketLosses = qualifiers.some((q) => q.username === p.username)
        ? 0
        : 1;
    });
    t.maxRounds = t.currentRound + Math.ceil(Math.log2(qualifiers.length));
  } else if (
    f === "knockout" || f === "double"
      ? alive.length <= 1
      : f === "arena"
        ? now >= t.engineState!.endsAt!
        : t.currentRound >= t.maxRounds
  ) {
    t.status = "completed";
    let champions =
      f === "knockout" || f === "double"
        ? alive
        : t.players.slice().sort(compare).slice(0, 1);
    if (f === "hill") champions = t.players.filter(p => p.username === t.engineState!.hillChampion);
    if (f === "team") {
      const teams = new Map<string, number>();
      for (const p of t.players)
        teams.set(p.team!, (teams.get(p.team!) || 0) + p.points);
      const winning = [...teams].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en"),
      )[0][0];
      champions = t.players.filter((p) => p.team === winning);
    }
    t.engineState!.champions = champions.map((p) => p.username);
    t.logs.push("Completed from authoritative game results.");
    return t;
  }
  t.currentRound++;
  const matches = schedule(t);
  t.matches.push(...matches);
  matches.filter((m) => m.black === "∅").forEach((m) => award(t, m));
  if (!matches.length) throw new Error("No valid pairings");
  return next(t, now);
}
export function startTournament(
  input: TournamentState,
  now = Date.now(),
): TournamentState {
  if (input.status !== "registration")
    throw new Error("Tournament has already started");
  if (
    !Array.isArray(input.players) ||
    input.players.length < Math.max(2, input.minPlayers || 2) ||
    input.players.length > 64
  )
    throw new Error("Not enough registered players");
  if (
    new Set(input.players.map((p) => key(p.username))).size !==
    input.players.length
  )
    throw new Error("Duplicate competitors");
  const t = structuredClone(input);
  const f = format(t.type);
  if (f === "groups" && t.players.length < 4)
    throw new Error("Group stage needs at least four players");
  if (
    f === "team" &&
    (t.players.some((p) => !p.team) ||
      new Set(t.players.map((p) => p.team)).size < 2)
  )
    throw new Error("At least two named teams are required");
  if (f === "arena" && String(t.timeControl).toLowerCase().includes("untimed"))
    throw new Error("Arena requires a clock");
  t.players = t.players.map((p) => ({
    ...p,
    points: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    streak: 0,
    byes: 0,
    buchholz: 0,
  }));
  const seed = t.players
    .slice()
    .sort(
      (a, b) =>
        b.rating - a.rating ||
        key(a.username).localeCompare(key(b.username), "en"),
    )
    .map((p) => p.username);
  t.engineState = {
    format: f,
    seed,
    ...(f === "hill" ? { hillChampion: seed[0] } : {}),
    groups: Object.fromEntries(seed.map((n, i) => [n, i % 2])),
    groupRounds:
      Math.ceil(seed.length / 2) + (Math.ceil(seed.length / 2) % 2) - 1,
    endsAt:
      now + Math.min(240, Math.max(5, Number(t.arenaMinutes) || 10)) * 60000,
  };
  t.status = "active";
  t.currentRound = 1;
  t.matches = [];
  t.logs = [...(t.logs || []), "Tournament started by the server."];
  t.maxRounds =
    f === "roundrobin"
      ? seed.length + (seed.length % 2) - 1
      : f === "groups"
        ? Number(t.engineState.groupRounds) + 2
        : f === "double"
          ? seed.length * 2
          : f === "knockout"
            ? Math.ceil(Math.log2(seed.length))
            : Math.min(
                32,
                Math.max(
                  1,
                  Number(input.maxRounds) || Math.ceil(Math.log2(seed.length)),
                ),
              );
  t.matches = schedule(t);
  t.matches.filter((m) => m.black === "∅").forEach((m) => award(t, m));
  return t;
}
export function applyTournamentResult(
  input: TournamentState,
  roomId: string,
  gameCode: string,
  winner: "W" | "B" | null,
  now = Date.now(),
): TournamentState {
  const t = structuredClone(input);
  const m = t.matches.find((m) => m.roomId === roomId);
  if (!m) throw new Error("Match not found");
  if (m.status === "completed") {
    if (m.gameCode === gameCode && m.winner === (winner || "D")) return t;
    throw new Error("Conflicting terminal result");
  }
  if (t.status !== "active") throw new Error("Tournament is not active");
  m.winner = winner || "D";
  m.status = "completed";
  m.gameCode = gameCode;
  award(t, m);
  if (t.engineState?.format === "hill" && winner) t.engineState.hillChampion = winner === "W" ? m.white : m.black;
  const f =
    t.engineState?.stage === "knockout" ? "knockout" : t.engineState?.format;
  if (!winner && (f === "knockout" || f === "double")) {
    t.matches.push({
      id: m.id + ":replay",
      round: m.round,
      white: m.black,
      black: m.white,
      winner: null,
      status: "pending",
      replayOf: m.id,
    });
    return t;
  }
  return next(t, now);
}
export function settleArena(
  input: TournamentState,
  now = Date.now(),
): TournamentState {
  return input.status === "active" &&
    input.engineState?.format === "arena" &&
    now >= input.engineState.endsAt!
    ? next(structuredClone(input), now)
    : input;
}
