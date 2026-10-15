/** Isolated subprocess fixture: never configure this helper with hosted credentials. */
import { initGameRecordsManager, getNextGameCode, recordGameStart, recordGameEnd,
  getGameRecordByCode, getSeriesById, getRecentGameRecords, flushGameRecords, flushGameRecordsSync, linkRematch } from "../../src/server/gameRecordsManager";
import fs from "node:fs";

if (process.env.SUPABASE_URL || process.env.SUPABASE_SECRET_KEY || !process.env.KENTRO_DATA_DIR) {
  throw new Error("Restart fixture requires isolated local data and no Supabase credentials");
}
await initGameRecordsManager({ handleSignals: false });
const mode = process.argv[2];
if (mode === "write" || mode === "write-inflight") {
  const code = getNextGameCode();
  let release: (() => void) | undefined;
  if (mode === "write-inflight") {
    const originalWrite = fs.promises.writeFile.bind(fs.promises);
    let blocked = false;
    fs.promises.writeFile = (async (...args: Parameters<typeof fs.promises.writeFile>) => {
      await originalWrite(...args);
      if (!blocked && String(args[0]).includes("permanent_game_records")) {
        blocked = true;
        await new Promise<void>((resolve) => {
          release = resolve;
          console.log(`FIXTURE ${JSON.stringify({ code, inFlight: true })}`);
        });
      }
    }) as typeof fs.promises.writeFile;
  }
  recordGameStart({ gameCode: code, private: true, participantUserIds: ["fixture-white", "fixture-black"],
    player1: "fixture_white", player2: "fixture_black", playerColors: { fixture_white: "W", fixture_black: "B" },
    gameMode: "Multiplayer", timeControl: "Untimed", startingPosition: { 1: "B", 46: "W" }, startingTurn: "B" });
  await recordGameEnd({ gameCode: code, completeMoveHistory: [{ from: 1, to: 7, caps: [] }],
    currentPosition: { 7: "B", 46: "W" }, currentTurn: "W", finalResult: "0–1", resultReason: "Resignation",
    winnerColor: "B", winnerUsername: "fixture_black", loserUsername: "fixture_white", isDraw: false });
  process.once("SIGTERM", () => {
    if (mode === "write-inflight") {
      // A newer synchronous fallback must not be replaced when the old async
      // write resumes. This deliberately reproduces the previous exit race.
      linkRematch(code, "fixture-next");
      flushGameRecordsSync();
      release?.();
    }
    void flushGameRecords().then(() => process.exit(0), () => process.exit(1));
  });
  setInterval(() => {}, 1000);
  if (mode === "write") console.log(`FIXTURE ${JSON.stringify({ code })}`);
} else if (mode === "read") {
  const code = process.argv[3];
  const record = await getGameRecordByCode(code);
  const result = { record, series: getSeriesById(`series_${code}`), recent: await getRecentGameRecords(), next: getNextGameCode() };
  await flushGameRecords();
  console.log(`FIXTURE ${JSON.stringify(result)}`);
} else {
  throw new Error("Unknown fixture operation");
}
