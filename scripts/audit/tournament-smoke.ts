/** Actual WS games + authoritative worker + PostgreSQL CAS/outbox replay.
 * Auth users and role claims are LOCAL fixtures, not hosted authentication. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import WebSocket from "ws";
import { Client } from "pg";
import { localDatabase } from "./localDatabase";
import {
  TournamentRuntime,
  type TournamentRepository,
  type TournamentResult,
} from "../../src/server/tournamentRuntime";
import { generateLegalMoves, movesAreEquivalent } from "../../src/gameLogic";
if (process.env.SUPABASE_URL || process.env.SUPABASE_SECRET_KEY)
  throw new Error("Refusing to run with hosted bindings.");
const directory = await mkdtemp(path.join(os.tmpdir(), "kentro-tournament-"));
process.env.NODE_ENV = "test";
process.env.KENTRO_DATA_DIR = directory;
const fixture = await localDatabase();
const { attachOnlinePlay } = await import("../../src/server/onlinePlay");
const { initGameRecordsManager, flushGameRecords } = await import(
  "../../src/server/gameRecordsManager"
);
await initGameRecordsManager({ handleSignals: false });
const service = new Client({ connectionString: fixture.url });
await service.connect();
await service.query("set role service_role");
const users = ["alice", "bob", "carol", "dave"].map((username, i) => ({
  username,
  uid: `70000000-0000-4000-8000-00000000000${i + 1}`,
}));
const server = createServer();
const sockets: WebSocket[] = [];
const events: TournamentResult[] = [];
let runtime: TournamentRuntime;
let outage = false;
const repo: TournamentRepository = {
  async load(id) {
    return (
      (await service.query("select * from tournaments where id=$1", [id]))
        .rows[0] || null
    );
  },
  async active() {
    return (
      await service.query("select * from tournaments where status='active'")
    ).rows;
  },
  async save(id, version, next) {
    if (outage) throw new Error("simulated database outage");
    return (
      await service.query(
        "select kentro_commit_tournament($1,$2,$3) as result",
        [id, version, next],
      )
    ).rows[0].result;
  },
  async profile(name) {
    const user = users.find((u) => u.username === name);
    assert.ok(user);
    return user;
  },
};
const game = attachOnlinePlay(server, {
  recoveryPath: path.join(directory, "rooms.json"),
  coinsEnabled: false,
  getCoinSettings: async () => ({ matchRakePercent: 0 }),
  resolveEntryFee: () => 0,
  sanitizeWagerAmount: () => 0,
  sanitizeBestOf: () => 1,
  sanitizeCustomBoard: () => null,
  findLegalMatch: (b, t, m) =>
    generateLegalMoves(b, t).find((c) => movesAreEquivalent(c, m)) || null,
  onGameCompleted: async (event) => {
    events.push(event);
    try {
      await runtime.record(event);
    } catch {
      /* Expected injected outage; the durable outbox must retain it. */
    }
  },
});
let code = 7800000;
const outbox = path.join(directory, "outbox.json");
const worker = () =>
  new TournamentRuntime(
    repo,
    (spec) => game.ensureTournamentRoom(spec),
    () => String(++code),
    outbox,
  );
runtime = worker();
async function peer(name: string) {
  const ws = new WebSocket("ws://127.0.0.1:" + (server.address() as any).port);
  sockets.push(ws);
  const inbox: any[] = [];
  const listeners = new Set<() => void>();
  ws.on("message", (b) => {
    inbox.push(JSON.parse(String(b)));
    listeners.forEach((f) => f());
  });
  await new Promise<void>((r, j) => {
    ws.once("open", r);
    ws.once("error", j);
  });
  const send = (m: any) => ws.send(JSON.stringify(m));
  const receive = (type: string) =>
    new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        listeners.delete(find);
        reject(
          new Error(name + " missing " + type + " " + JSON.stringify(inbox)),
        );
      }, 5000);
      const find = () => {
        const i = inbox.findIndex((m) => m.type === type);
        if (i >= 0) {
          clearTimeout(timeout);
          listeners.delete(find);
          resolve(inbox.splice(i, 1)[0]);
        }
      };
      listeners.add(find);
      find();
    });
  send({ type: "login", username: name });
  await receive("login-success");
  return { ws, send, receive };
}
async function until(fn: () => boolean | Promise<boolean>) {
  const end = Date.now() + 5000;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error("Condition timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}
try {
  for (const user of users)
    await fixture.db.query(
      "insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)",
      [
        user.uid,
        user.username + "@example.invalid",
        { username: user.username },
      ],
    );
  const players = users.map((u) => ({
    username: u.username,
    rating: 1500,
    points: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    streak: 0,
  }));
  await fixture.db.query(
    'insert into tournaments(id,type,status,players,matches,logs,"maxRounds","timeControl",visibility) values($1,$2,$3,$4,$5,$6,1,$7,$8)',
    [
      "pipeline",
      "Swiss Tournament",
      "registration",
      JSON.stringify(players),
      "[]",
      "[]",
      "Blitz 5m",
      "private",
    ],
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  await runtime.start("pipeline");
  assert.equal(game.rooms.size, 2);
  const state = await repo.load("pipeline");
  assert.ok(state);
  for (let i = 0; i < state.matches.length; i++) {
    const match = state.matches[i];
    const a = await peer(match.white),
      b = await peer(match.black);
    await a.receive("room-rejoined");
    await b.receive("room-rejoined");
    a.send({ type: "join-room-accept", roomId: match.roomId });
    const start = await a.receive("game-started");
    const move = generateLegalMoves(start.gameState.board, "W")[0];
    a.send({ type: "make-move", move });
    await a.receive("move-made");
    await b.receive("move-made");
    // The first terminal result must survive a worker restart while the DB is unavailable.
    if (i === 0) outage = true;
    a.send({ type: "offer-draw" });
    await b.receive("draw-offered");
    b.send({ type: "draw-response", accept: true });
    await a.receive("game-ended");
    await b.receive("game-ended");
    await until(() => events.length === i + 1);
    await runtime.close();
    if (i === 0) {
      const snapshot = JSON.parse(await readFile(outbox, "utf8"));
      assert.equal(JSON.parse(snapshot.payload).length, 1);
      outage = false;
    }
    runtime = worker();
    await runtime.reconcile();
  }
  const completed = await repo.load("pipeline");
  assert.equal(completed?.status, "completed");
  assert.equal(
    completed.matches.filter((m) => m.status === "completed").length,
    2,
  );
  assert.ok(completed.players.every((p) => p.draws === 1 && p.points === 0.5));
  const version = completed.engineVersion;
  await runtime.record(events[0]);
  assert.equal((await repo.load("pipeline"))?.engineVersion, version);
  assert.equal(
    JSON.parse(JSON.parse(await readFile(outbox, "utf8")).payload).length,
    0,
  );
  console.log(
    "PASS real WS canonical moves/draws → PostgreSQL tournament standings; durable failed-result outbox restart; duplicate terminal replay; private paired rooms. Hosted Supabase: PENDING.",
  );
} finally {
  await runtime.close();
  game.shutdown();
  sockets.forEach((s) => s.terminate());
  await new Promise<void>((r) => game.wss.close(() => r()));
  await new Promise<void>((r) => server.close(() => r()));
  await flushGameRecords();
  await service.end();
  await fixture.close();
  await rm(directory, { recursive: true, force: true });
}
