/**
 * Live end-to-end benchmark of the multiplayer room flow, against the REAL
 * built server over REAL WebSockets: login -> create-room -> join ->
 * accept -> game-started, then a full game's worth of move relays, timing
 * every hop and measuring wire sizes (delta vs full-state resync).
 */
import { spawn } from "node:child_process";
import WebSocket from "ws";
import { createInitialBoard, generateLegalMoves, applyMove, Board, Move } from "../src/gameLogic";

const PORT = 3999;
const MOVES = 240;

function pct(arr: number[], p: number) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

async function main() {
  const server = spawn("node", ["dist/server.cjs"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      SUPABASE_URL: "https://dummy.supabase.co",
      SUPABASE_SECRET_KEY: "dummy",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", () => {});
  // wait for HTTP to answer
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/`); if (r.status < 600) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }

  const mkClient = (name: string) => new Promise<{ ws: WebSocket; inbox: Map<string, ((d: any) => void)[]> }>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const inbox = new Map<string, ((d: any) => void)[]>();
    ws.on("message", (raw) => {
      if (process.env.BENCH_TRACE) console.error(name, "<-", JSON.parse(String(raw)).type);
      const d = JSON.parse(String(raw));
      (d as any).__bytes = String(raw).length;
      const q = inbox.get(d.type);
      if (q && q.length) q.shift()!(d);
    });
    ws.on("open", () => { ws.send(JSON.stringify({ type: "login", username: name })); resolve({ ws, inbox }); });
  });
  const waitFor = (c: { inbox: Map<string, ((d: any) => void)[]> }, type: string) =>
    new Promise<any>((res) => {
      if (!c.inbox.has(type)) c.inbox.set(type, []);
      c.inbox.get(type)!.push(res);
    });

  console.error("[bench] server up, connecting clients…");
  const A = await mkClient("BenchAlice");
  console.error("[bench] A connected");
  const B = await mkClient("BenchBob");
  console.error("[bench] B connected");

  // --- create + join + accept + start ---
  const tCreate0 = performance.now();
  const roomInfoP = waitFor(A, "room-info");
  A.ws.send(JSON.stringify({ type: "create-room", gameTime: 5, specialRule: "none", wagerAmount: 0 }));
  console.error("[bench] create-room sent");
  const roomInfo = await roomInfoP;
  console.error("[bench] room-info:", roomInfo.roomId);
  const tCreate = performance.now() - tCreate0;
  const roomId = roomInfo.roomId;

  const tPrev0 = performance.now();
  const prevP = waitFor(B, "room-preview");
  B.ws.send(JSON.stringify({ type: "join-room", roomId }));
  await prevP;
  const tPreview = performance.now() - tPrev0;

  const tAcc0 = performance.now();
  const startA = waitFor(A, "game-started");
  const startB = waitFor(B, "game-started");
  B.ws.send(JSON.stringify({ type: "join-room-accept", roomId }));
  const [sA] = await Promise.all([startA, startB]);
  const tAccept = performance.now() - tAcc0;

  const colorA: "W" | "B" = roomInfo.yourColor;
  let board: Board = sA.gameState.board ?? createInitialBoard();
  let turn: "W" | "B" = sA.gameState.turn;

  // --- move relay loop: mover sends, BOTH clients must receive the delta ---
  const lat: number[] = [];
  const deltaBytes: number[] = [];
  for (let i = 0; i < MOVES; i++) {
    const legal = generateLegalMoves(board, turn);
    if (legal.length === 0) break;
    const mv: Move = legal[i % legal.length];
    const mover = turn === colorA ? A : B;
    const pA = waitFor(A, "move-made");
    const pB = waitFor(B, "move-made");
    const t0 = performance.now();
    mover.ws.send(JSON.stringify({ type: "make-move", move: mv, whiteTime: 300, blackTime: 300 }));
    const [dA] = await Promise.all([pA, pB]);
    lat.push(performance.now() - t0);
    deltaBytes.push(dA.__bytes);
    board = applyMove(board, dA.move).board;
    turn = dA.turn;
  }

  // --- full-state resync at end-of-game size, for the wire comparison ---
  const fullP = waitFor(A, "opponent-moved");
  A.ws.send(JSON.stringify({ type: "resync" }));
  const full = await fullP;

  const avg = lat.reduce((a, b) => a + b, 0) / lat.length;
  const avgDelta = Math.round(deltaBytes.reduce((a, b) => a + b, 0) / deltaBytes.length);
  console.log(`room create ack:            ${tCreate.toFixed(1)} ms`);
  console.log(`join preview:               ${tPreview.toFixed(1)} ms`);
  console.log(`accept -> both started:     ${tAccept.toFixed(1)} ms`);
  console.log(`moves relayed:              ${lat.length}`);
  console.log(`move relay avg:             ${avg.toFixed(2)} ms   p50 ${pct(lat, 50).toFixed(2)}  p95 ${pct(lat, 95).toFixed(2)}  max ${Math.max(...lat).toFixed(2)}`);
  console.log(`per-move wire size (delta): ${avgDelta} bytes avg, ${Math.max(...deltaBytes)} max`);
  console.log(`full-state at move ${lat.length}:     ${full.__bytes} bytes  (what EVERY move used to cost)`);
  console.log(`bandwidth saved per game:   ~${(((full.__bytes - avgDelta) * lat.length * 2) / 1024).toFixed(0)} KB across both players`);

  A.ws.close(); B.ws.close(); server.kill("SIGTERM");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
