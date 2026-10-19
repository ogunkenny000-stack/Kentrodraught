import { applyMove, boardToScanFen, checkGameEnd, generateLegalMoves, moveToNotationString, scanFenToBoard, type Board, type Move } from '../../src/gameLogic';
export type Difficulty = 'Easy' | 'Medium' | 'Hard';
export type Certificate = {
    edges: {
        move: Move;
        next: Certificate;
    }[];
};
export type PuzzleProof = {
    fen: string;
    solver: 'W' | 'B';
    difficulty: Difficulty;
    maxPlies: number;
    line: Move[];
    nodes: number;
    certificate: Certificate;
    theme: string;
    description: string;
};
export class PuzzleBudgetExceeded extends Error {
}
const other = (t: 'W' | 'B') => t === 'W' ? 'B' : 'W';
export function canonicalPuzzleFen(input: unknown): string {
    if (typeof input !== 'string' || !/^[WB][wWbBe]{50}$/.test(input))
        throw Error('Invalid SCAN FEN');
    const { board, turn } = scanFenToBoard(input), pieces = Object.values(board).filter(Boolean);
    if (pieces.length < 4 || pieces.length > 16 || pieces.filter(p => p === 'W' || p === 'B').length > 4)
        throw Error('Require 4–16 pieces, at most four kings');
    for (const c of ['w', 'b'])
        if (!pieces.some(p => p?.toLowerCase() === c))
            throw Error('Both sides need pieces');
    if (boardToScanFen(board, turn) !== input)
        throw Error('Unpromoted last-rank man');
    return input;
}
/** 180-degree rotation with colour and side-to-move swapped preserves these rules. */
export function equivalentFen(fen: string) { const { board, turn } = scanFenToBoard(canonicalPuzzleFen(fen)); const rotated: Board = {}; for (const [sq, p] of Object.entries(board))
    if (p)
        rotated[51 - Number(sq)] = ({ w: 'b', b: 'w', W: 'B', B: 'W' } as const)[p]; return boardToScanFen(rotated, other(turn)); }
export function puzzleContentKey(fen: string) { const original = canonicalPuzzleFen(fen), rotated = equivalentFen(original); return original < rotated ? original : rotated; }
const key = (m: Move) => JSON.stringify([m.from, m.to, m.caps, m.path ?? []]);
function outcome(board: Board, turn: 'W' | 'B', history: Move[], root: Board, first: 'W' | 'B') {
    // No repetition can occur before eight plies; the shortest material draw is ten.
    if (history.length >= 8)
        return checkGameEnd(history, root, first);
    if (!generateLegalMoves(board, turn).length)
        return { isOver: true, isDraw: false, winner: other(turn) };
    return { isOver: false, isDraw: false, winner: null };
}
function pv(tree: Certificate): Move[] { let best: Move[] = []; for (const edge of tree.edges) {
    const line = [edge.move, ...pv(edge.next)];
    if (line.length > best.length)
        best = line;
} return best; }
function features(fen: string, line: Move[]) { let { board } = scanFenToBoard(fen), sacrifices = 0, sweep = false, kingTrap = false; for (let i = 0; i < line.length; i++) {
    const m = line[i];
    if (i % 2)
        sacrifices += m.caps.length;
    else {
        if (m.caps.length >= 2)
            sweep = true;
        if (m.caps.some(s => board[s] === 'W' || board[s] === 'B'))
            kingTrap = true;
    }
    board = applyMove(board, m).board;
} return { sacrifices, sweep, kingTrap }; }
export function provePuzzle(input: unknown, options: {
    maxNodes?: number;
    deadline?: number;
    maxPlies?: number;
} = {}): PuzzleProof | null {
    const fen = canonicalPuzzleFen(input), root = scanFenToBoard(fen), solver = root.turn;
    const legal = generateLegalMoves(root.board, solver);
    if (legal.length < 2 || legal[0].caps.length)
        return null;
    // A quiet setup must force a capture, not offer a sacrifice the defender can ignore.
    if (!legal.some(m => generateLegalMoves(applyMove(root.board, m).board, other(solver))[0]?.caps.length))
        return null;
    let nodes = 0;
    const limit = options.maxNodes ?? 100000, deadline = options.deadline ?? Date.now() + 1500;
    const visit = (board: Board, turn: 'W' | 'B', history: Move[], left: number): Certificate | null => {
        if (++nodes > limit || Date.now() > deadline)
            throw new PuzzleBudgetExceeded('Proof budget exhausted');
        const end = outcome(board, turn, history, root.board, solver);
        if (end.isOver)
            return !end.isDraw && end.winner === solver ? { edges: [] } : null;
        if (!left)
            return null;
        const edges: Certificate['edges'] = [];
        for (const move of generateLegalMoves(board, turn)) {
            const next = visit(applyMove(board, move).board, other(turn), [...history, move], left - 1);
            if (turn === solver) {
                if (next)
                    return { edges: [{ move, next }] };
            }
            else {
                if (!next)
                    return null;
                edges.push({ move, next });
            }
        }
        return turn === solver ? null : { edges };
    };
    for (let bound = 3; bound <= Math.min(options.maxPlies ?? 11, 11); bound += 2) {
        const wins: {
            move: Move;
            next: Certificate;
        }[] = [];
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
        if (!f.sacrifices || (!f.sweep && !f.kingTrap) || line.length < 3)
            return null;
        const difficulty: Difficulty = bound <= 3 ? 'Easy' : bound <= 7 ? 'Medium' : 'Hard';
        if (difficulty === 'Medium' && legal.length < 3)
            return null;
        if (difficulty === 'Hard' && (legal.length < 4 || f.sacrifices < 2))
            return null;
        if (difficulty === 'Hard') {
            const m = line[0], after = applyMove(root.board, m).board;
            if (root.board[m.from]?.toLowerCase() === root.board[m.from] && after[m.to]?.toUpperCase() === after[m.to])
                return null;
        }
        const proof: PuzzleProof = { fen, solver, difficulty, maxPlies: bound, line, nodes, certificate, theme: f.kingTrap ? 'King trap' : 'Sacrifice and capture', description: `Find the unique first move forcing a win within ${(bound + 1) / 2} of your turns. All legal defensive replies are covered under Nigerian rules.` };
        verifyCertificate(proof);
        return proof;
    }
    return null;
}
export function verifyCertificate(proof: PuzzleProof) {
    const fen = canonicalPuzzleFen(proof.fen), root = scanFenToBoard(fen);
    if (root.turn !== proof.solver || ![3, 5, 7, 9, 11].includes(proof.maxPlies))
        throw Error('Invalid proof metadata');
    let nodes = 0;
    const visit = (board: Board, turn: 'W' | 'B', history: Move[], tree: Certificate) => {
        if (++nodes > 200000 || history.length > proof.maxPlies)
            throw Error('Oversized proof');
        const end = checkGameEnd(history, root.board, root.turn);
        if (end.isOver) {
            if (end.isDraw || end.winner !== proof.solver || tree.edges.length)
                throw Error('Non-winning leaf');
            return;
        }
        const legal = generateLegalMoves(board, turn);
        if (!tree.edges.length)
            throw Error('Unfinished proof');
        if (turn === proof.solver && tree.edges.length !== 1)
            throw Error('Solver must choose one move');
        const keys = tree.edges.map(e => key(e.move));
        if (new Set(keys).size !== keys.length)
            throw Error('Duplicate proof edge');
        if (turn !== proof.solver && (legal.length !== keys.length || legal.some(m => !keys.includes(key(m)))))
            throw Error('Missing defensive reply');
        for (const edge of tree.edges) {
            const move = legal.find(m => key(m) === key(edge.move));
            if (!move)
                throw Error('Illegal move or incomplete capture');
            visit(applyMove(board, move).board, other(turn), [...history, move], edge.next);
        }
    };
    visit(root.board, root.turn, [], proof.certificate);
    if (JSON.stringify(pv(proof.certificate)) !== JSON.stringify(proof.line))
        throw Error('Principal line mismatch');
    return nodes;
}
export function puzzleSolution(proof: PuzzleProof) { return proof.line.map((move, i) => ({ ...move, text: moveToNotationString(move), role: i % 2 === 0 ? 'solver' : 'reply' })); }
export function randomPuzzlePosition(random: () => number = Math.random): string {
    const board: Board = {}, squares = Array.from({ length: 40 }, (_, i) => i + 6), count = 4 + Math.floor(random() * 6), white = Math.floor(count / 2) + (random() < .5 ? 1 : 0);
    for (let i = 0; i < count; i++) {
        const sq = squares.splice(Math.floor(random() * squares.length), 1)[0];
        const p = i < white ? 'w' : 'b';
        board[sq] = random() < .09 ? p.toUpperCase() as 'W' | 'B' : p;
    }
    return boardToScanFen(board, random() < .5 ? 'W' : 'B');
}
/** Mutate constructed studies to discover deeper combinations; every result is reproved. */
export function mutatePuzzlePosition(fen: string, random: () => number = Math.random): string {
    const { board, turn } = scanFenToBoard(fen);
    for (let i = 0, n = random() < .7 ? 1 : 2; i < n; i++) {
        const keys = Object.keys(board).filter(s => board[Number(s)]);
        const from = Number(keys[Math.floor(random() * keys.length)]), to = 6 + Math.floor(random() * 40);
        if (!board[to]) {
            board[to] = board[from];
            delete board[from];
        }
    }
    return boardToScanFen(board, turn);
}
