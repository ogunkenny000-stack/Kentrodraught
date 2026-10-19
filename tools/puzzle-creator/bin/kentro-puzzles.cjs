#!/usr/bin/env node

// tools/puzzle-creator/cli.ts
var import_node_sqlite = require("node:sqlite");
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_node_crypto = require("node:crypto");

// src/gameLogic.ts
function ngSqToRc(sq) {
  const z = sq - 1;
  const row = Math.floor(z / 5);
  const col = z % 5 * 2 + (row % 2 === 0 ? 0 : 1);
  return [row, col];
}
function ngRcToSq(row, col) {
  if (row < 0 || row >= 10 || col < 0 || col >= 10) return null;
  if ((row + col) % 2 !== 0) return null;
  return row * 5 + Math.floor(col / 2) + 1;
}
function convertSq(sq) {
  const rb = Math.floor((sq - 1) / 5) * 5 + 1;
  return 2 * rb + 4 - sq;
}
function getCol(pc) {
  if (!pc) return null;
  return pc === "w" || pc === "W" ? "W" : "B";
}
function isKing(pc) {
  return pc === "W" || pc === "B";
}
function getOppColor(c) {
  return c === "W" ? "B" : "W";
}
var DIRS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1]
];
var FWD = {
  W: [
    [-1, -1],
    [-1, 1]
  ],
  // White moves up
  B: [
    [1, -1],
    [1, 1]
  ]
  // Black moves down
};
var PROMO = {
  W: 0,
  // White promotes at row 0 (squares 1-5)
  B: 9
  // Black promotes at row 9 (squares 46-50)
};
function getManQuiets(sq, board, color) {
  const [r, c] = ngSqToRc(sq);
  const moves = [];
  const dirs = FWD[color];
  for (const [dr, dc] of dirs) {
    const t = ngRcToSq(r + dr, c + dc);
    if (t && !board[t]) {
      moves.push({ from: sq, to: t, caps: [] });
    }
  }
  return moves;
}
function mcRec(start, cur, bd, caps, res, seen, enemy, path = []) {
  const [r, c] = ngSqToRc(cur);
  let found = false;
  for (const [dr, dc] of DIRS) {
    const mid = ngRcToSq(r + dr, c + dc);
    const land = ngRcToSq(r + 2 * dr, c + 2 * dc);
    if (mid === null || land === null) continue;
    const mp = bd[mid];
    if (!mp || getCol(mp) !== enemy) continue;
    if (caps.includes(mid)) continue;
    if (bd[land] && land !== start) continue;
    found = true;
    mcRec(start, land, bd, [...caps, mid], res, seen, enemy, [...path, land]);
  }
  if (caps.length > 0 && !found) {
    const sortedCaps = [...caps].sort().join(",");
    const key2 = `${start}->${cur}:[${sortedCaps}]`;
    if (!seen.has(key2)) {
      seen.add(key2);
      res.push({ from: start, to: cur, caps, path });
    }
  }
}
function getKingQuiets(sq, board) {
  const [r, c] = ngSqToRc(sq);
  const moves = [];
  for (const [dr, dc] of DIRS) {
    let nr = r + dr;
    let nc = c + dc;
    while (true) {
      const t = ngRcToSq(nr, nc);
      if (t === null || board[t]) break;
      moves.push({ from: sq, to: t, caps: [] });
      nr += dr;
      nc += dc;
    }
  }
  return moves;
}
function kcRec(start, cur, bd, caps, res, seen, enemy, path = []) {
  const [r, c] = ngSqToRc(cur);
  let found = false;
  for (const [dr, dc] of DIRS) {
    let nr = r + dr;
    let nc = c + dc;
    let esq = null;
    while (true) {
      const sq2 = ngRcToSq(nr, nc);
      if (sq2 === null) break;
      const p2 = sq2 === start ? null : bd[sq2];
      if (p2) {
        if (getCol(p2) === enemy && !caps.includes(sq2)) {
          esq = sq2;
        }
        break;
      }
      nr += dr;
      nc += dc;
    }
    if (esq === null) continue;
    const [er, ec] = ngSqToRc(esq);
    let lr = er + dr;
    let lc = ec + dc;
    const possible = [];
    const nextCaps = [...caps, esq];
    while (true) {
      const land = ngRcToSq(lr, lc);
      if (land === null) break;
      if (bd[land] && land !== start) break;
      found = true;
      const branch = [];
      kcRec(start, land, bd, nextCaps, branch, /* @__PURE__ */ new Set(), enemy, [...path, land]);
      possible.push(...branch);
      lr += dr;
      lc += dc;
    }
    const continued = possible.some((move) => move.caps.length > nextCaps.length);
    for (const move of possible) {
      if (continued && move.caps.length === nextCaps.length) continue;
      const key2 = `${move.from}->${move.to}:[${[...move.caps].sort((a, b) => a - b).join(",")}]`;
      if (!seen.has(key2)) {
        seen.add(key2);
        res.push(move);
      }
    }
  }
  if (caps.length > 0 && !found) {
    const sortedCaps = [...caps].sort().join(",");
    const key2 = `${start}->${cur}:[${sortedCaps}]`;
    if (!seen.has(key2)) {
      seen.add(key2);
      res.push({ from: start, to: cur, caps, path });
    }
  }
}
function generateLegalMoves(board, turn) {
  const caps = [];
  const quiets = [];
  const playerPieces = [];
  for (let sq = 1; sq <= 50; sq++) {
    if (board[sq] && getCol(board[sq]) === turn) {
      playerPieces.push(sq);
    }
  }
  const enemy = getOppColor(turn);
  for (const sq of playerPieces) {
    const pc = board[sq];
    if (isKing(pc)) {
      const res = [];
      const seen = /* @__PURE__ */ new Set();
      kcRec(sq, sq, board, [], res, seen, enemy);
      caps.push(...res);
    } else {
      const res = [];
      const seen = /* @__PURE__ */ new Set();
      mcRec(sq, sq, board, [], res, seen, enemy);
      caps.push(...res);
    }
  }
  if (caps.length > 0) {
    return caps;
  }
  for (const sq of playerPieces) {
    const pc = board[sq];
    if (isKing(pc)) {
      quiets.push(...getKingQuiets(sq, board));
    } else {
      quiets.push(...getManQuiets(sq, board, turn));
    }
  }
  return quiets;
}
function applyMove(board, mv) {
  const newBoard = { ...board };
  const pc = newBoard[mv.from];
  if (!pc) throw new Error(`No piece at starting square ${mv.from}`);
  newBoard[mv.from] = null;
  for (const cap of mv.caps) {
    newBoard[cap] = null;
  }
  const [r] = ngSqToRc(mv.to);
  const color = getCol(pc);
  let promoted = false;
  let finalPc = pc;
  if (!isKing(pc) && r === PROMO[color]) {
    finalPc = color === "W" ? "W" : "B";
    promoted = true;
  }
  newBoard[mv.to] = finalPc;
  return { board: newBoard, promoted };
}
function moveToNotationString(mv) {
  let s = `${mv.from}${mv.caps.length > 0 ? "x" : "-"}${mv.to}`;
  for (const cap of mv.caps) s += `x${cap}`;
  return s;
}
function createInitialBoard() {
  const board = {};
  for (let sq = 1; sq <= 50; sq++) {
    if (sq >= 1 && sq <= 20) {
      board[sq] = "b";
    } else if (sq >= 31 && sq <= 50) {
      board[sq] = "w";
    } else {
      board[sq] = null;
    }
  }
  return board;
}
function boardToScanFen(board, turn) {
  const chars = [turn];
  for (let scanSq = 1; scanSq <= 50; scanSq++) {
    const ngSq = convertSq(scanSq);
    let pc = board[ngSq];
    if (pc === "w" && ngSq >= 1 && ngSq <= 5) pc = "W";
    if (pc === "b" && ngSq >= 46 && ngSq <= 50) pc = "B";
    chars.push(pc ? pc : "e");
  }
  return chars.join("");
}
function scanFenToBoard(fen) {
  if (typeof fen !== "string" || !/^[WB][wWbBe]{50}$/.test(fen)) {
    throw new Error("Invalid SCAN FEN: expected W or B followed by exactly 50 piece or empty-square characters.");
  }
  const turn = fen[0];
  const board = {};
  for (let scanSq = 1; scanSq <= 50; scanSq++) {
    const ngSq = convertSq(scanSq);
    const char = fen[scanSq];
    board[ngSq] = char === "e" ? null : char;
  }
  return { board, turn };
}
function countPieces(board) {
  const counts = { whiteMen: 0, whiteKings: 0, blackMen: 0, blackKings: 0 };
  for (let sq = 1; sq <= 50; sq++) {
    const pc = board[sq];
    if (!pc) continue;
    const white = getCol(pc) === "W";
    const king = isKing(pc);
    if (white && king) counts.whiteKings++;
    else if (white) counts.whiteMen++;
    else if (king) counts.blackKings++;
    else counts.blackMen++;
  }
  return counts;
}
function countsEqual(a, b) {
  return a.whiteMen === b.whiteMen && a.whiteKings === b.whiteKings && a.blackMen === b.blackMen && a.blackKings === b.blackKings;
}
function materialCategory(c) {
  const whiteLoneKing = c.whiteKings === 1 && c.whiteMen === 0;
  const blackLoneKing = c.blackKings === 1 && c.blackMen === 0;
  if (!whiteLoneKing && !blackLoneKing) return null;
  const strongCount = whiteLoneKing ? c.blackMen + c.blackKings : c.whiteMen + c.whiteKings;
  const strongHasKing = whiteLoneKing ? c.blackKings >= 1 : c.whiteKings >= 1;
  if (!strongHasKing) return null;
  if (strongCount === 3) return "three";
  if (strongCount <= 2) return "two";
  return null;
}
var NO_END = { isOver: false, winner: null, isDraw: false, reason: "" };
function checkGameEnd(history, initialBoard = createInitialBoard(), firstMover = "W") {
  const boards = [{ ...initialBoard }];
  for (let i = 0; i < history.length; i++) {
    boards.push(applyMove(boards[i], history[i]).board);
  }
  const finalBoard = boards[boards.length - 1];
  const sideToMove = history.length % 2 === 0 ? firstMover : firstMover === "W" ? "B" : "W";
  if (generateLegalMoves(finalBoard, sideToMove).length === 0) {
    const winner = sideToMove === "W" ? "B" : "W";
    return { isOver: true, winner, isDraw: false, reason: "No legal moves left" };
  }
  {
    let repeats = 1;
    for (let i = boards.length - 1 - 2; i >= 0; i -= 2) {
      if (boardsEqual(boards[i], finalBoard)) {
        repeats++;
        if (repeats >= 3) {
          return { isOver: true, winner: null, isDraw: true, reason: "Threefold repetition" };
        }
      }
    }
  }
  {
    let streak = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      const mv = history[i];
      const moverBoard = boards[i];
      const movedPiece = moverBoard[mv.from];
      const wasKingMove = !!movedPiece && isKing(movedPiece);
      const wasCapture = mv.caps.length > 0;
      if (wasKingMove && !wasCapture) {
        streak++;
      } else {
        break;
      }
    }
    if (streak >= 50) {
      return { isOver: true, winner: null, isDraw: true, reason: "25 consecutive king moves by each side with no capture" };
    }
  }
  {
    const currentCounts = countPieces(finalBoard);
    const category = materialCategory(currentCounts);
    if (category) {
      let pliesInCategory = 0;
      for (let i = boards.length - 1; i > 0; i--) {
        if (countsEqual(countPieces(boards[i - 1]), currentCounts)) {
          pliesInCategory++;
        } else {
          break;
        }
      }
      const threshold = category === "three" ? 32 : 10;
      if (pliesInCategory >= threshold) {
        const moves = category === "three" ? 16 : 5;
        return {
          isOver: true,
          winner: null,
          isDraw: true,
          reason: category === "three" ? `Lone king vs 3 pieces (incl. a king): no progress in ${moves} moves by each side` : `Lone king vs 2 or fewer pieces (incl. a king): no progress in ${moves} moves by each side`
        };
      }
    }
  }
  return NO_END;
}
function boardsEqual(a, b) {
  for (let sq = 1; sq <= 50; sq++) {
    if ((a[sq] ?? null) !== (b[sq] ?? null)) return false;
  }
  return true;
}

// tools/puzzle-creator/proof.ts
var PuzzleBudgetExceeded = class extends Error {
};
var other = (t) => t === "W" ? "B" : "W";
function canonicalPuzzleFen(input) {
  if (typeof input !== "string" || !/^[WB][wWbBe]{50}$/.test(input))
    throw Error("Invalid SCAN FEN");
  const { board, turn } = scanFenToBoard(input), pieces = Object.values(board).filter(Boolean);
  if (pieces.length < 4 || pieces.length > 16 || pieces.filter((p) => p === "W" || p === "B").length > 4)
    throw Error("Require 4\u201316 pieces, at most four kings");
  for (const c of ["w", "b"])
    if (!pieces.some((p) => p?.toLowerCase() === c))
      throw Error("Both sides need pieces");
  if (boardToScanFen(board, turn) !== input)
    throw Error("Unpromoted last-rank man");
  return input;
}
function equivalentFen(fen) {
  const { board, turn } = scanFenToBoard(canonicalPuzzleFen(fen));
  const rotated = {};
  for (const [sq, p] of Object.entries(board))
    if (p)
      rotated[51 - Number(sq)] = { w: "b", b: "w", W: "B", B: "W" }[p];
  return boardToScanFen(rotated, other(turn));
}
function puzzleContentKey(fen) {
  const original = canonicalPuzzleFen(fen), rotated = equivalentFen(original);
  return original < rotated ? original : rotated;
}
var key = (m) => JSON.stringify([m.from, m.to, m.caps, m.path ?? []]);
function outcome(board, turn, history, root, first) {
  if (history.length >= 8)
    return checkGameEnd(history, root, first);
  if (!generateLegalMoves(board, turn).length)
    return { isOver: true, isDraw: false, winner: other(turn) };
  return { isOver: false, isDraw: false, winner: null };
}
function pv(tree) {
  let best = [];
  for (const edge of tree.edges) {
    const line = [edge.move, ...pv(edge.next)];
    if (line.length > best.length)
      best = line;
  }
  return best;
}
function features(fen, line) {
  let { board } = scanFenToBoard(fen), sacrifices = 0, sweep = false, kingTrap = false;
  for (let i = 0; i < line.length; i++) {
    const m = line[i];
    if (i % 2)
      sacrifices += m.caps.length;
    else {
      if (m.caps.length >= 2)
        sweep = true;
      if (m.caps.some((s) => board[s] === "W" || board[s] === "B"))
        kingTrap = true;
    }
    board = applyMove(board, m).board;
  }
  return { sacrifices, sweep, kingTrap };
}
function provePuzzle(input, options = {}) {
  const fen = canonicalPuzzleFen(input), root = scanFenToBoard(fen), solver = root.turn;
  const legal = generateLegalMoves(root.board, solver);
  if (legal.length < 2 || legal[0].caps.length)
    return null;
  if (!legal.some((m) => generateLegalMoves(applyMove(root.board, m).board, other(solver))[0]?.caps.length))
    return null;
  let nodes = 0;
  const limit = options.maxNodes ?? 1e5, deadline = options.deadline ?? Date.now() + 1500;
  const visit = (board, turn, history, left) => {
    if (++nodes > limit || Date.now() > deadline)
      throw new PuzzleBudgetExceeded("Proof budget exhausted");
    const end = outcome(board, turn, history, root.board, solver);
    if (end.isOver)
      return !end.isDraw && end.winner === solver ? { edges: [] } : null;
    if (!left)
      return null;
    const edges = [];
    for (const move of generateLegalMoves(board, turn)) {
      const next = visit(applyMove(board, move).board, other(turn), [...history, move], left - 1);
      if (turn === solver) {
        if (next)
          return { edges: [{ move, next }] };
      } else {
        if (!next)
          return null;
        edges.push({ move, next });
      }
    }
    return turn === solver ? null : { edges };
  };
  for (let bound = 3; bound <= Math.min(options.maxPlies ?? 11, 11); bound += 2) {
    const wins = [];
    for (const move of legal) {
      const next = visit(applyMove(root.board, move).board, other(solver), [move], bound - 1);
      if (next)
        wins.push({ move, next });
      if (wins.length > 1)
        return null;
    }
    if (!wins.length)
      continue;
    const certificate = { edges: wins }, line = pv(certificate), f = features(fen, line);
    if (!f.sacrifices || !f.sweep && !f.kingTrap || line.length < 3)
      return null;
    const difficulty = bound <= 3 ? "Easy" : bound <= 7 ? "Medium" : "Hard";
    if (difficulty === "Medium" && legal.length < 3)
      return null;
    if (difficulty === "Hard" && (legal.length < 4 || f.sacrifices < 2))
      return null;
    if (difficulty === "Hard") {
      const m = line[0], after = applyMove(root.board, m).board;
      if (root.board[m.from]?.toLowerCase() === root.board[m.from] && after[m.to]?.toUpperCase() === after[m.to])
        return null;
    }
    const proof = { fen, solver, difficulty, maxPlies: bound, line, nodes, certificate, theme: f.kingTrap ? "King trap" : "Sacrifice and capture", description: `Find the unique first move forcing a win within ${(bound + 1) / 2} of your turns. All legal defensive replies are covered under Nigerian rules.` };
    verifyCertificate(proof);
    return proof;
  }
  return null;
}
function verifyCertificate(proof) {
  const fen = canonicalPuzzleFen(proof.fen), root = scanFenToBoard(fen);
  if (root.turn !== proof.solver || ![3, 5, 7, 9, 11].includes(proof.maxPlies))
    throw Error("Invalid proof metadata");
  let nodes = 0;
  const visit = (board, turn, history, tree) => {
    if (++nodes > 2e5 || history.length > proof.maxPlies)
      throw Error("Oversized proof");
    const end = checkGameEnd(history, root.board, root.turn);
    if (end.isOver) {
      if (end.isDraw || end.winner !== proof.solver || tree.edges.length)
        throw Error("Non-winning leaf");
      return;
    }
    const legal = generateLegalMoves(board, turn);
    if (!tree.edges.length)
      throw Error("Unfinished proof");
    if (turn === proof.solver && tree.edges.length !== 1)
      throw Error("Solver must choose one move");
    const keys = tree.edges.map((e) => key(e.move));
    if (new Set(keys).size !== keys.length)
      throw Error("Duplicate proof edge");
    if (turn !== proof.solver && (legal.length !== keys.length || legal.some((m) => !keys.includes(key(m)))))
      throw Error("Missing defensive reply");
    for (const edge of tree.edges) {
      const move = legal.find((m) => key(m) === key(edge.move));
      if (!move)
        throw Error("Illegal move or incomplete capture");
      visit(applyMove(board, move).board, other(turn), [...history, move], edge.next);
    }
  };
  visit(root.board, root.turn, [], proof.certificate);
  if (JSON.stringify(pv(proof.certificate)) !== JSON.stringify(proof.line))
    throw Error("Principal line mismatch");
  return nodes;
}
function puzzleSolution(proof) {
  return proof.line.map((move, i) => ({ ...move, text: moveToNotationString(move), role: i % 2 === 0 ? "solver" : "reply" }));
}
function randomPuzzlePosition(random = Math.random) {
  const board = {}, squares = Array.from({ length: 40 }, (_, i) => i + 6), count = 4 + Math.floor(random() * 6), white = Math.floor(count / 2) + (random() < 0.5 ? 1 : 0);
  for (let i = 0; i < count; i++) {
    const sq = squares.splice(Math.floor(random() * squares.length), 1)[0];
    const p = i < white ? "w" : "b";
    board[sq] = random() < 0.09 ? p.toUpperCase() : p;
  }
  return boardToScanFen(board, random() < 0.5 ? "W" : "B");
}
function mutatePuzzlePosition(fen, random = Math.random) {
  const { board, turn } = scanFenToBoard(fen);
  for (let i = 0, n = random() < 0.7 ? 1 : 2; i < n; i++) {
    const keys = Object.keys(board).filter((s) => board[Number(s)]);
    const from = Number(keys[Math.floor(random() * keys.length)]), to = 6 + Math.floor(random() * 40);
    if (!board[to]) {
      board[to] = board[from];
      delete board[from];
    }
  }
  return boardToScanFen(board, turn);
}

// tools/puzzle-creator/cli.ts
var argv = process.argv.slice(2);
var command = argv.shift() ?? "help";
function option(name, fallback) {
  const i = argv.indexOf("--" + name);
  if (i < 0)
    return fallback;
  if (!argv[i + 1] || argv[i + 1].startsWith("--"))
    throw Error(`Missing --${name} value`);
  return argv[i + 1];
}
function integer(name, fallback, min = 1, max = 1e9) {
  const n = Number(option(name, String(fallback)));
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw Error(`Invalid --${name}`);
  return n;
}
var hash = (fen) => (0, import_node_crypto.createHash)("sha256").update(puzzleContentKey(fen)).digest("hex");
function open() {
  const path = (0, import_node_path.resolve)(option("db", "./puzzle-data/puzzles.sqlite"));
  (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(path), { recursive: true });
  const db = new import_node_sqlite.DatabaseSync(path);
  db.exec(`PRAGMA busy_timeout=30000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
CREATE TABLE IF NOT EXISTS positions(hash TEXT PRIMARY KEY,fen TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS puzzles(hash TEXT PRIMARY KEY REFERENCES positions(hash),difficulty TEXT NOT NULL,proof TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
  return db;
}
function exportPuzzle(proof, id) {
  return { id, title: `${proof.difficulty}: ${proof.theme}`, difficulty: proof.difficulty, theme: proof.theme, description: proof.description, fen: proof.fen, solution: puzzleSolution(proof), explanation: proof.description, source: "Kentro server creator", positionHash: id, proof };
}
async function main() {
  if (command === "help") {
    console.log(`Kentro Nigerian draughts server puzzle creator (Node 22.13+; Node 24 recommended)
 generate --db ./puzzle-data/puzzles.sqlite --count 10 --difficulty all --seconds 3600
   [--attempts 1000000] [--nodes 100000] [--candidate-ms 1500] [--seed 123]
 export --db ./puzzle-data/puzzles.sqlite --out puzzles.json
 verify --file puzzles.json [--nodes 1000000] [--candidate-ms 30000]
 import --db ./puzzle-data/puzzles.sqlite --file puzzles.json
 stats --db ./puzzle-data/puzzles.sqlite
All means count per tier, easy \u2192 medium \u2192 hard. Exit 2 means the requested quota was not met.
No network, Supabase credentials, phone runtime or user data are required.`);
    return;
  }
  if (command === "verify" || command === "import") {
    const parsed = JSON.parse((0, import_node_fs.readFileSync)(option("file", "puzzles.json"), "utf8")), items = Array.isArray(parsed) ? parsed : [parsed];
    const db2 = command === "import" ? open() : null;
    let accepted = 0, duplicates = 0;
    try {
      for (const item of items) {
        const supplied = item.proof;
        verifyCertificate(supplied);
        const proof = provePuzzle(supplied.fen, { maxPlies: supplied.maxPlies, maxNodes: integer("nodes", 1e6), deadline: Date.now() + integer("candidate-ms", 3e4) });
        if (!proof || proof.difficulty !== supplied.difficulty || proof.maxPlies !== supplied.maxPlies)
          throw Error("Puzzle fails fresh uniqueness/difficulty proof");
        const id = hash(proof.fen);
        if (db2) {
          db2.exec("BEGIN IMMEDIATE");
          try {
            const result = db2.prepare("INSERT OR IGNORE INTO positions(hash,fen,status) VALUES(?,?,'accepted')").run(id, proof.fen);
            if (result.changes) {
              db2.prepare("INSERT INTO puzzles(hash,difficulty,proof) VALUES(?,?,?)").run(id, proof.difficulty, JSON.stringify(proof));
              accepted++;
            } else
              duplicates++;
            db2.exec("COMMIT");
          } catch (error) {
            db2.exec("ROLLBACK");
            throw error;
          }
        } else
          accepted++;
      }
    } finally {
      db2?.close();
    }
    console.log(JSON.stringify({ verified: accepted, duplicates }));
    return;
  }
  if (!["generate", "export", "stats"].includes(command))
    throw Error("Unknown command; use help");
  const db = open();
  try {
    if (command === "stats") {
      console.log(JSON.stringify({ puzzles: db.prepare("SELECT difficulty,COUNT(*) count FROM puzzles GROUP BY difficulty").all(), positions: db.prepare("SELECT status,COUNT(*) count FROM positions GROUP BY status").all() }, null, 2));
      return;
    }
    if (command === "export") {
      const rows = db.prepare("SELECT hash,proof FROM puzzles ORDER BY CASE difficulty WHEN 'Easy' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,created_at,hash").all();
      const out = (0, import_node_path.resolve)(option("out", "puzzles.json"));
      (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(out), { recursive: true });
      (0, import_node_fs.writeFileSync)(out, JSON.stringify(rows.map((r) => exportPuzzle(JSON.parse(String(r.proof)), String(r.hash))), null, 2) + "\n");
      console.log(JSON.stringify({ exported: rows.length, file: out }));
      return;
    }
    const tier = option("difficulty", "all").toLowerCase();
    if (!["all", "easy", "medium", "hard"].includes(tier))
      throw Error("Invalid difficulty");
    const tiers = tier === "all" ? ["Easy", "Medium", "Hard"] : [tier[0].toUpperCase() + tier.slice(1)];
    const count = integer("count", 1), attemptLimit = integer("attempts", 1e6), seconds = integer("seconds", 3600), maxNodes = integer("nodes", 1e5), candidateMs = integer("candidate-ms", 1500);
    let state = integer("seed", Math.floor(Math.random() * 4294967294) + 1, 1, 4294967295);
    const initialSeed = state;
    const random = () => {
      state = Math.imul(1664525, state) + 1013904223 >>> 0;
      return state / 4294967296;
    };
    let stopped = false;
    process.on("SIGINT", () => {
      stopped = true;
    });
    process.on("SIGTERM", () => {
      stopped = true;
    });
    const until = Date.now() + seconds * 1e3, counts = { Easy: 0, Medium: 0, Hard: 0 };
    let attempts = 0, duplicates = 0, budgets = 0, lastLog = 0;
    const seeds = ["Weeeeeweeeeeeeeeeebeewebeeeebweeeeeeeeeeeeeeeeeeeee", "BeeeeewewbebeeeeeeeeweeeeeeeeeeeeeeeeeweBeeeeeeeeee"];
    const reserve = db.prepare("INSERT OR IGNORE INTO positions(hash,fen,status) VALUES(?,?,'examined')");
    while (!stopped && Date.now() < until && attempts < attemptLimit && tiers.some((t) => counts[t] < count)) {
      attempts++;
      const fen = tier !== "easy" && random() < 0.6 ? mutatePuzzlePosition(seeds[Math.floor(random() * seeds.length)], random) : randomPuzzlePosition(random);
      try {
        canonicalPuzzleFen(fen);
      } catch {
        continue;
      }
      const id = hash(fen);
      if (!reserve.run(id, fen).changes) {
        duplicates++;
        continue;
      }
      let proof = null;
      try {
        proof = provePuzzle(fen, { maxNodes, deadline: Math.min(until, Date.now() + candidateMs), maxPlies: tier === "easy" ? 3 : tier === "medium" ? 7 : 11 });
      } catch (error) {
        if (error instanceof PuzzleBudgetExceeded) {
          budgets++;
          db.prepare("UPDATE positions SET status='budget' WHERE hash=?").run(id);
        } else
          throw error;
      }
      if (proof) {
        if (proof.maxPlies >= 5 && seeds.length < 100)
          seeds.push(proof.fen);
        if (!tiers.includes(proof.difficulty) || counts[proof.difficulty] >= count) {
          db.prepare("UPDATE positions SET status='qualified-unselected' WHERE hash=?").run(id);
          continue;
        }
        db.exec("BEGIN IMMEDIATE");
        try {
          db.prepare("INSERT INTO puzzles(hash,difficulty,proof) VALUES(?,?,?)").run(id, proof.difficulty, JSON.stringify(proof));
          db.prepare("UPDATE positions SET status='accepted' WHERE hash=?").run(id);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        counts[proof.difficulty]++;
        console.error(JSON.stringify({ event: "accepted", difficulty: proof.difficulty, plies: proof.maxPlies, hash: id, counts }));
      }
      if (Date.now() - lastLog > 1e4) {
        console.error(JSON.stringify({ attempts, duplicates, budgets, counts, seed: initialSeed }));
        lastLog = Date.now();
      }
    }
    console.log(JSON.stringify({ complete: tiers.every((t) => counts[t] >= count), attempts, duplicates, budgets, counts, seed: initialSeed, stopped }));
    if (stopped || tiers.some((t) => counts[t] < count))
      process.exitCode = 2;
  } finally {
    db.close();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
