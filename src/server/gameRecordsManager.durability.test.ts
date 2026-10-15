import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

it("flushes a real process on SIGTERM and recovers records, series and code allocation after restart", () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "kentro-record-restart-"));
  const moduleUrl = pathToFileURL(path.resolve("src/server/gameRecordsManager.ts")).href;
  const run = (source: string) => spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], {
    cwd: process.cwd(), encoding: "utf8", timeout: 15000,
    env: { ...process.env, NODE_ENV: "test", SUPABASE_URL: "", SUPABASE_SECRET_KEY: "", KENTRO_DATA_DIR: dataDir },
  });
  try {
    const first = run(`
      const m = await import(${JSON.stringify(moduleUrl)}); await m.initGameRecordsManager();
      const code = m.getNextGameCode();
      m.recordGameStart({ gameCode: code, player1: 'Alice', player2: 'Bob', playerColors: { Alice: 'W', Bob: 'B' },
        gameMode: 'Multiplayer', timeControl: 'Untimed', startingPosition: { 1: 'B', 50: 'W' }, startingTurn: 'B' });
      await m.recordGameEnd({ gameCode: code, completeMoveHistory: [{ from: 1, to: 6, caps: [] }], currentPosition: { 6: 'B', 50: 'W' },
        currentTurn: 'W', finalResult: '½–½', resultReason: 'Draw Agreement', winnerColor: null, winnerUsername: null, loserUsername: null, isDraw: true });
      console.log('RESULT:' + JSON.stringify({ code }));
      setTimeout(() => process.exit(99), 2000); process.kill(process.pid, 'SIGTERM');
    `);
    expect(first.error).toBeUndefined(); expect(first.status, first.stderr).toBe(143);
    const { code } = JSON.parse(first.stdout.split("\n").find(line => line.startsWith("RESULT:"))!.slice(7));
    expect(JSON.parse(readFileSync(path.join(dataDir, "permanent_game_records.json"), "utf8"))).toHaveLength(1);
    const second = run(`
      const m = await import(${JSON.stringify(moduleUrl)}); await m.initGameRecordsManager();
      const record = await m.getGameRecordByCode(${JSON.stringify(code)});
      console.log('RESULT:' + JSON.stringify({ record, series: m.getSeriesById(record.seriesId), next: m.getNextGameCode() }));
      await m.flushGameRecords();
    `);
    expect(second.error).toBeUndefined(); expect(second.status, second.stderr).toBe(0);
    const result = JSON.parse(second.stdout.split("\n").find(line => line.startsWith("RESULT:"))!.slice(7));
    expect(result.record).toMatchObject({ gameCode: code, whitePlayer: "Alice", blackPlayer: "Bob", isDraw: true,
      startingPosition: { 1: "B", 50: "W" }, startingTurn: "B", currentPosition: { 6: "B", 50: "W" }, currentTurn: "W" });
    expect(result.series).toMatchObject({ seriesGamesCount: 1, draws: 1 });
    expect(Number(result.next)).toBeGreaterThan(Number(code));
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
}, 20000);
