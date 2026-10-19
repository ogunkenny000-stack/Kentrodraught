/** Disposable Docker production smoke. Never passes host credentials into the container.
 * Usage: npx tsx scripts/audit/container-smoke.ts kentro-audit:local [evidence.json]
 * Creates and removes its own container/volume; binds HTTP only to loopback.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import WebSocket from "ws";
import { generateLegalMoves, type Board } from "../../src/gameLogic";

const run = promisify(execFile);
const image = process.argv[2];
if (!image || image.startsWith("-")) throw new Error("Supply the locally built image name");
const evidencePath = process.argv[3];
const suffix = randomBytes(6).toString("hex");
const container = `kentro-smoke-${suffix}`;
const volume = `kentro-smoke-${suffix}`;
const checks: string[] = [];
const docker = async (...args: string[]) => (await run("docker", args, { timeout: 120_000, maxBuffer: 4_000_000 })).stdout.trim();
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const clients: WebSocket[] = [];
let base = "";
async function json(route: string, init?: RequestInit): Promise<any> {
  const response = await fetch(base + route, { ...init, signal: AbortSignal.timeout(20_000) });
  assert.equal(response.status, 200, route);
  return response.json();
}
async function ready() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await json("/api/health")).ok) return; } catch { /* startup */ }
    await wait(200);
  }
  throw new Error("Container readiness timed out");
}
async function updateAddress() {
  // Docker may allocate a new ephemeral published port after stop/start.
  const inspect = JSON.parse(await docker("inspect", container))[0];
  base = `http://127.0.0.1:${inspect.NetworkSettings.Ports["3000/tcp"][0].HostPort}`;
}
async function dockerHealthy() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = JSON.parse(await docker("inspect", container))[0].State;
    if (state.Health?.Status === "healthy") return;
    if (!state.Running || state.Health?.Status === "unhealthy") throw new Error("Docker healthcheck failed");
    await wait(200);
  }
  throw new Error("Docker healthcheck did not become healthy");
}
async function peer(resume?: { name: string; token: string }) {
  const name = resume?.name || `KGuest_${randomBytes(10).toString("hex")}`;
  const socket = new WebSocket(base.replace(/^http:/, "ws:"));
  clients.push(socket);
  const inbox: any[] = [];
  const listeners = new Set<() => void>();
  socket.on("message", raw => { inbox.push(JSON.parse(String(raw))); for (const listener of listeners) listener(); });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket open timed out")), 10_000);
    socket.once("open", () => { clearTimeout(timer); resolve(); });
    socket.once("error", error => { clearTimeout(timer); reject(error); });
  });
  const receive = (type: string) => new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => { listeners.delete(find); reject(new Error(`Missing ${type}: ${JSON.stringify(inbox)}`)); }, 10_000);
    const find = () => {
      const index = inbox.findIndex(message => message.type === type);
      if (index >= 0) { clearTimeout(timer); listeners.delete(find); resolve(inbox.splice(index, 1)[0]); }
    };
    listeners.add(find); find();
  });
  const send = (message: any) => socket.send(JSON.stringify(message));
  send({ type: "login", username: name, sessionToken: resume?.token });
  const token = (await receive("login-success")).sessionToken;
  assert.match(token, /^[a-f0-9]{32}$/);
  return { socket, name, token, send, receive };
}

try {
  const imageInfo = JSON.parse(await docker("image", "inspect", image))[0];
  await docker("volume", "create", volume);
  await docker("run", "-d", "--init", "--name", container, "-p", "127.0.0.1::3000",
    "--mount", `type=volume,source=${volume},target=/app/data`,
    "-e", "KENTRO_DATA_DIR=/app/data/smoke-state", "-e", "SKIP_DB_MIGRATION=1", image);
  await updateAddress();
  await ready(); checks.push("Production HTTP readiness");
  const runtime = JSON.parse(await docker("exec", container, "node", "-e",
    "console.log(JSON.stringify({uid:process.getuid(),node:process.version,compiler:require('fs').existsSync('/usr/bin/g++'),vite:require('fs').existsSync('/app/node_modules/vite'),dataDir:process.env.KENTRO_DATA_DIR}))"));
  assert.notEqual(runtime.uid, 0); assert.equal(runtime.compiler, false); assert.equal(runtime.vite, false);
  checks.push("Non-root runtime without compiler/Vite");
  assert.equal((await json("/api/engine/health")).ok, true);
  const search = await json("/api/engine/move", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fen: "W" + "b".repeat(20) + "e".repeat(10) + "w".repeat(20), depth: 2, thinkTime: 0.05 }) });
  assert.match(search.move, /^\d+(?:[-x]\d+)+$/); assert.equal(Number.isFinite(search.score), true);
  checks.push("Actual native engine initialization and bounded search");
  for (const route of ["/server.cjs", "/server.cjs.map", "/.env", "/assets/missing.js", "/index.html.br"]) {
    assert.equal((await fetch(base + route)).status, 404, route);
  }
  const html = await (await fetch(base)).text();
  const entry = html.match(/<script[^>]+src="([^"]+\.js)"/);
  assert(entry, "Built HTML has a JavaScript entry");
  const actualScript = await fetch(base + entry[1]);
  assert.equal(actualScript.status, 200); assert.match(actualScript.headers.get("cache-control") || "", /immutable/);
  assert.match(actualScript.headers.get("vary") || "", /Accept-Encoding/i);
  checks.push("Built assets served with cache/encoding headers; private/missing files denied");
  let a = await peer(); let b = await peer();
  a.send({ type: "create-room", gameTime: 5, hostTime: 5, guestTime: 5, specialRule: "none", wagerAmount: 0, bestOf: 1 });
  const room = await a.receive("room-info");
  b.send({ type: "join-room", roomId: room.roomId }); await b.receive("room-preview");
  b.send({ type: "join-room-accept", roomId: room.roomId });
  const started = await a.receive("game-started"); await b.receive("game-started");
  const whiteName = started.players.find((player: any) => player.color === "W").username;
  const white = whiteName === a.name ? a : b;
  const move = generateLegalMoves(started.gameState.board as Board, "W")[0]; assert(move);
  white.send({ type: "make-move", move });
  assert.equal((await a.receive("move-made")).move.from, move.from);
  assert.equal((await b.receive("move-made")).move.to, move.to);
  await docker("kill", "--signal", "KILL", container);
  await docker("start", container); await updateAddress(); await ready();
  a = await peer({name:a.name,token:a.token});
  const recoveredA = await a.receive("room-rejoined");
  assert.equal(recoveredA.gameCode,started.gameCode);assert.equal(recoveredA.gameState.moveHistory.length,1);assert.equal(recoveredA.clock.running,null);
  b = await peer({name:b.name,token:b.token});await b.receive("room-rejoined");
  checks.push("Active guest game, resume tokens, paused clock and moves survive actual container SIGKILL/restart");
  const restricted = await fetch(base+'/api/engine/move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fen:"W"+"b".repeat(20)+"e".repeat(10)+"w".repeat(20),purpose:'play',levelId:8})});
  assert.equal(restricted.status,401);
  assert.equal((await json('/api/media/ice')).relayConfigured,false);
  checks.push("Production API rejects anonymous paid-level claims and publishes no relay credentials to guests");
  a.send({ type: "offer-draw" }); await b.receive("draw-offered");
  b.send({ type: "draw-response", accept: true });
  assert.equal((await a.receive("game-ended")).reason, "draw"); await b.receive("game-ended");
  checks.push("Real two-client production WebSocket create/consent/join/legal move/agreed draw");
  const record = (await json(`/api/games/code/${started.gameCode}`)).game;
  assert.equal(record.completeMoveHistory.length, 1); assert.equal(record.isDraw, true);
  await dockerHealthy(); checks.push("Configured Docker healthcheck reports healthy");
  const began = performance.now();
  await docker("stop", "--time", "10", container);
  const shutdownMs = Math.round(performance.now() - began);
  assert.equal(JSON.parse(await docker("inspect", container))[0].State.ExitCode, 0);
  assert.equal(a.socket.readyState, WebSocket.CLOSED); assert.equal(b.socket.readyState, WebSocket.CLOSED);
  checks.push("Graceful SIGTERM exits zero and closes WebSockets");
  await docker("start", container); await updateAddress(); await ready();
  const restored = (await json(`/api/games/code/${started.gameCode}`)).game;
  assert.equal(restored.gameCode, record.gameCode); assert.equal(restored.isDraw, true);
  assert.deepEqual(restored.completeMoveHistory, record.completeMoveHistory);
  assert.equal(restored.gameEndTime, record.gameEndTime);
  await docker("exec", container, "node", "-e", "if(!require('fs').existsSync('/app/data/smoke-state/permanent_game_records.json'))process.exit(1)");
  checks.push("Completed game metadata/moves survive stop/start in configured durable directory");
  const evidence = { capturedAt: new Date().toISOString(), image: imageInfo.Id, imageBytes: imageInfo.Size,
    runtime, shutdownMs, checks, limits: ["Disposable guest fixture without Supabase credentials", "No hosted account authentication/database, media transport, push delivery or capacity certification"] };
  console.log(JSON.stringify(evidence, null, 2));
  if (evidencePath) { await mkdir(path.dirname(evidencePath), { recursive: true }); await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n"); }
} catch (error) {
  const logs = await docker("logs", "--tail", "100", container).catch(() => "");
  console.error(logs); throw error;
} finally {
  for (const client of clients) client.terminate();
  await docker("rm", "-f", container).catch(() => "");
  await docker("volume", "rm", volume).catch(() => "");
}
