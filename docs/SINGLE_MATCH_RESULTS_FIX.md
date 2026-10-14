# Kentro Draughts — One Result Log Per Completed Match

## Expected result

For any completed online game, the history/feed uses **one card** showing both players and their outcomes side by side:

| Bayo | vs | Ayo |
|---|---|---|
| Loss | | Won |

Draws show **Draw** under both players. Rematches are separate games and still have their own cards.

## Root cause and repair

Before this repair the server saved a room result with its authoritative numeric `gameCode`, but BOTH browsers also saved separate `completed_games` rows with randomly generated `game_<timestamp>_<random>` IDs. This created several logs for one match.

The client no longer inserts records for `Multiplayer` at all. The server alone writes the finished match with `room.gameCode` as the unique `completed_games.gameId` (existing primary key). Online clients simply refresh the archive shortly after the server records the result. AI/practice/tournament saving remains unchanged.

A shared `uniqueCompletedMatches` helper deduplicates *legacy* online rows at read time throughout Home, Archive, Analysis, Player Directory, chat sharing and Kentro TV. It prefers the server record. It compares game IDs, players, winner, close finish times, and move sequences; two distinct authoritative game codes can never be combined. Old rows are NOT deleted from Supabase, to prevent loss of recordings or rematches.

## Deployment

1. Deploy the updated React application and the online server from the same ZIP together.
2. Ensure server-only `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are configured. The server needs them to save online results; never place the secret key in the public frontend.
3. No new database schema or migration is required: `completed_games.gameId` is already the primary key.
4. Build and run the project normally after installing dependencies (`npm ci` then `npm run build`, `npm test`).

## Acceptance tests (two separate accounts)

- Bayo hosts; Ayo wins: both players see **one** shared result card, **Loss** below Bayo and **Won** below Ayo.
- One draw: both players show **Draw**, one card.
- Win by flag, resignation and disconnect: correct winner and loser, one card.
- Rematch between the same players: TWO different cards (one for each real match), not four.
- Refresh both browsers, reopen Home > Your Past Games, Match Archive, Analysis, Kentro TV and the chat share dialog: no repeated match.
- AI games remain separate in history.
- Older client duplicate records, if present in the database, are hidden where the system can verify that they refer to the same match. Database rows themselves are left intact.

## Verification available in this environment

- 11 changed/new files passed local TypeScript transpilation/syntax checks.
- 12 focused standalone assertions passed for canonical IDs, duplicate legacy records, outcome labels, draws, rematches and replay records.
- Full Vite/TypeScript production build, installed Vitest suite, and real multiplayer device testing could not run without the app dependencies and live accounts.
