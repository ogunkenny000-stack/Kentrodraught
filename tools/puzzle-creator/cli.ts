#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalPuzzleFen, provePuzzle, puzzleContentKey, puzzleSolution, randomPuzzlePosition, mutatePuzzlePosition, verifyCertificate, PuzzleBudgetExceeded, type PuzzleProof } from './proof';
const argv = process.argv.slice(2), command = argv.shift() ?? 'help';
function option(name: string, fallback: string) { const i = argv.indexOf('--' + name); if (i < 0)
    return fallback; if (!argv[i + 1] || argv[i + 1].startsWith('--'))
    throw Error(`Missing --${name} value`); return argv[i + 1]; }
function integer(name: string, fallback: number, min = 1, max = 1e9) { const n = Number(option(name, String(fallback))); if (!Number.isSafeInteger(n) || n < min || n > max)
    throw Error(`Invalid --${name}`); return n; }
const hash = (fen: string) => createHash('sha256').update(puzzleContentKey(fen)).digest('hex');
function open() {
    const path = resolve(option('db', './puzzle-data/puzzles.sqlite'));
    mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec(`PRAGMA busy_timeout=30000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
CREATE TABLE IF NOT EXISTS positions(hash TEXT PRIMARY KEY,fen TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS puzzles(hash TEXT PRIMARY KEY REFERENCES positions(hash),difficulty TEXT NOT NULL,proof TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
    return db;
}
function exportPuzzle(proof: PuzzleProof, id: string) { return { id, title: `${proof.difficulty}: ${proof.theme}`, difficulty: proof.difficulty, theme: proof.theme, description: proof.description, fen: proof.fen, solution: puzzleSolution(proof), explanation: proof.description, source: 'Kentro server creator', positionHash: id, proof }; }
async function main() {
    if (command === 'help') {
        console.log(`Kentro Nigerian draughts server puzzle creator (Node 22.13+; Node 24 recommended)
 generate --db ./puzzle-data/puzzles.sqlite --count 10 --difficulty all --seconds 3600
   [--attempts 1000000] [--nodes 100000] [--candidate-ms 1500] [--seed 123]
 export --db ./puzzle-data/puzzles.sqlite --out puzzles.json
 verify --file puzzles.json [--nodes 1000000] [--candidate-ms 30000]
 import --db ./puzzle-data/puzzles.sqlite --file puzzles.json
 stats --db ./puzzle-data/puzzles.sqlite
All means count per tier, easy → medium → hard. Exit 2 means the requested quota was not met.
No network, Supabase credentials, phone runtime or user data are required.`);
        return;
    }
    if (command === 'verify' || command === 'import') {
        const parsed = JSON.parse(readFileSync(option('file', 'puzzles.json'), 'utf8')), items = Array.isArray(parsed) ? parsed : [parsed];
        const db = command === 'import' ? open() : null;
        let accepted = 0, duplicates = 0;
        try {
            for (const item of items) {
                const supplied = item.proof as PuzzleProof;
                verifyCertificate(supplied);
                const proof = provePuzzle(supplied.fen, { maxPlies: supplied.maxPlies, maxNodes: integer('nodes', 1000000), deadline: Date.now() + integer('candidate-ms', 30000) });
                if (!proof || proof.difficulty !== supplied.difficulty || proof.maxPlies !== supplied.maxPlies)
                    throw Error('Puzzle fails fresh uniqueness/difficulty proof');
                const id = hash(proof.fen);
                if (db) {
                    db.exec('BEGIN IMMEDIATE');
                    try {
                        const result = db.prepare("INSERT OR IGNORE INTO positions(hash,fen,status) VALUES(?,?,'accepted')").run(id, proof.fen);
                        if (result.changes) {
                            db.prepare('INSERT INTO puzzles(hash,difficulty,proof) VALUES(?,?,?)').run(id, proof.difficulty, JSON.stringify(proof));
                            accepted++;
                        }
                        else
                            duplicates++;
                        db.exec('COMMIT');
                    }
                    catch (error) {
                        db.exec('ROLLBACK');
                        throw error;
                    }
                }
                else
                    accepted++;
            }
        }
        finally {
            db?.close();
        }
        console.log(JSON.stringify({ verified: accepted, duplicates }));
        return;
    }
    if (!['generate', 'export', 'stats'].includes(command))
        throw Error('Unknown command; use help');
    const db = open();
    try {
        if (command === 'stats') {
            console.log(JSON.stringify({ puzzles: db.prepare('SELECT difficulty,COUNT(*) count FROM puzzles GROUP BY difficulty').all(), positions: db.prepare('SELECT status,COUNT(*) count FROM positions GROUP BY status').all() }, null, 2));
            return;
        }
        if (command === 'export') {
            const rows = db.prepare("SELECT hash,proof FROM puzzles ORDER BY CASE difficulty WHEN 'Easy' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,created_at,hash").all();
            const out = resolve(option('out', 'puzzles.json'));
            mkdirSync(dirname(out), { recursive: true });
            writeFileSync(out, JSON.stringify(rows.map(r => exportPuzzle(JSON.parse(String(r.proof)), String(r.hash))), null, 2) + '\n');
            console.log(JSON.stringify({ exported: rows.length, file: out }));
            return;
        }
        const tier = option('difficulty', 'all').toLowerCase();
        if (!['all', 'easy', 'medium', 'hard'].includes(tier))
            throw Error('Invalid difficulty');
        const tiers = tier === 'all' ? ['Easy', 'Medium', 'Hard'] : [tier[0].toUpperCase() + tier.slice(1)];
        const count = integer('count', 1), attemptLimit = integer('attempts', 1000000), seconds = integer('seconds', 3600), maxNodes = integer('nodes', 100000), candidateMs = integer('candidate-ms', 1500);
        let state = integer('seed', Math.floor(Math.random() * 4294967294) + 1, 1, 4294967295);
        const initialSeed = state;
        const random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
        let stopped = false;
        process.on('SIGINT', () => { stopped = true; });
        process.on('SIGTERM', () => { stopped = true; });
        const until = Date.now() + seconds * 1000, counts: Record<string, number> = { Easy: 0, Medium: 0, Hard: 0 };
        let attempts = 0, duplicates = 0, budgets = 0, lastLog = 0;
        const seeds = ['Weeeeeweeeeeeeeeeebeewebeeeebweeeeeeeeeeeeeeeeeeeee', 'BeeeeewewbebeeeeeeeeweeeeeeeeeeeeeeeeeweBeeeeeeeeee'];
        const reserve = db.prepare("INSERT OR IGNORE INTO positions(hash,fen,status) VALUES(?,?,'examined')");
        while (!stopped && Date.now() < until && attempts < attemptLimit && tiers.some(t => counts[t] < count)) {
            attempts++;
            const fen = tier !== 'easy' && random() < .6 ? mutatePuzzlePosition(seeds[Math.floor(random() * seeds.length)], random) : randomPuzzlePosition(random);
            try {
                canonicalPuzzleFen(fen);
            }
            catch {
                continue;
            }
            const id = hash(fen);
            if (!reserve.run(id, fen).changes) {
                duplicates++;
                continue;
            }
            let proof: PuzzleProof | null = null;
            try {
                proof = provePuzzle(fen, { maxNodes, deadline: Math.min(until, Date.now() + candidateMs), maxPlies: tier === 'easy' ? 3 : tier === 'medium' ? 7 : 11 });
            }
            catch (error) {
                if (error instanceof PuzzleBudgetExceeded) {
                    budgets++;
                    db.prepare("UPDATE positions SET status='budget' WHERE hash=?").run(id);
                }
                else
                    throw error;
            }
            if (proof) {
                if (proof.maxPlies >= 5 && seeds.length < 100)
                    seeds.push(proof.fen);
                if (!tiers.includes(proof.difficulty) || counts[proof.difficulty] >= count) {
                    db.prepare("UPDATE positions SET status='qualified-unselected' WHERE hash=?").run(id);
                    continue;
                }
                db.exec('BEGIN IMMEDIATE');
                try {
                    db.prepare('INSERT INTO puzzles(hash,difficulty,proof) VALUES(?,?,?)').run(id, proof.difficulty, JSON.stringify(proof));
                    db.prepare("UPDATE positions SET status='accepted' WHERE hash=?").run(id);
                    db.exec('COMMIT');
                }
                catch (error) {
                    db.exec('ROLLBACK');
                    throw error;
                }
                counts[proof.difficulty]++;
                console.error(JSON.stringify({ event: 'accepted', difficulty: proof.difficulty, plies: proof.maxPlies, hash: id, counts }));
            }
            if (Date.now() - lastLog > 10000) {
                console.error(JSON.stringify({ attempts, duplicates, budgets, counts, seed: initialSeed }));
                lastLog = Date.now();
            }
        }
        console.log(JSON.stringify({ complete: tiers.every(t => counts[t] >= count), attempts, duplicates, budgets, counts, seed: initialSeed, stopped }));
        if (stopped || tiers.some(t => counts[t] < count))
            process.exitCode = 2;
    }
    finally {
        db.close();
    }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
