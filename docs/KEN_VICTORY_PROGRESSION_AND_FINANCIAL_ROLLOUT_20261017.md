# Ken victory progression and finance installation — 17 October 2026

## What was installed on live draught.com Supabase
- `kentro_ken_victory_claims`: persistent, owner/game-unique claim receipt (no wallets or matches modified).
- `kentro_claim_ken_victory(uuid,uuid,integer)`: server-role-only, one-time sequential unlocking, no coin deduction.
- `kentro_lock_ken_entitlement` profile trigger: prevents browser clients changing their own `maxUnlockedKenLevel` directly. Existing records kept unchanged.
- Read-only verification confirmed claim RPC server-only, and two new migrations applied successfully.

## What the updated application does
- Ken 1–3 remain free; beating Ken 3 in a completed, normal, signed-in match can earn Ken 4. Beating Ken 4 can earn 5, etc., through Ken 8.
- The server checks Nigerian legal moves, terminal victory, and HMAC proof attached to each Ken AI response before calling the stored claim function.
- Uses the existing Supabase secret key as proof signer when a dedicated `KENTRO_PROGRESSION_SECRET` is not provided. Set a stable dedicated secret (at least 32 characters) on **all** backend replicas for consistent proofs.
- New frontend and backend must deploy together. Old instances will not send/understand the proof, and previously started games do not have it; start a fresh Ken match after deployment.
- No hint/undo victories are eligible. Practice/training, AI vs AI, user resignation and local custom position are ineligible.

## Financial system is NOT installed/enabled
The live database still lacks financial RPCs and transaction receipt tables. There are historic match-fee anomalies, no verified restorable backup, no disposable PostgreSQL instance and no successful real payment transaction test. Installing the bundled broad RLS migration into this active database without a tested migration/revert would risk 34 wallets, 45 transaction entries, and current player services. Therefore no financial migration was applied, and the source continues to default to `KENTRO_COINS_ENABLED=0`, `VITE_KENTRO_COINS_ENABLED=0`. Do not advertise coins as working.

## Still required for production finance
1. Verify a restorable database backup and restore into a disposable database.
2. Test and review security/RLS changes, wallet RPCs and refund/race scenarios against that restored schema.
3. Reconcile anomalous historical match-fee entries without auto-creating credits.
4. Apply ordered incremental migration files, read back RLS grants and readiness, deploy coordinated frontend/backend, test settlement, and only then opt into enabled coin flags.

## Limitations
HMAC proof binds a Ken move to a user, game ID, level and FEN but does not by itself prove a tamper-free full match chronology; a fully adversarial-resistant progression system requires server-owned AI match sessions (rather than independent client-supplied engine FENs). Treat this release as a functional progression milestone with remaining anti-cheat work, not a verified competitive rank system.
The full React build and database concurrency integration suite could not be run in the current runtime due to unavailable dependencies and PostgreSQL. Focused Node regression tests and TypeScript syntax transpilation passed.
