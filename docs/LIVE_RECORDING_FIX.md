# Recording and deployment repair — 20 October 2026 (Lagos)

## Fixed in this release

- Removed the engine fallback that accepted a move simply because its source square belonged to the mover. An engine move must match a complete legal Nigerian move; matching only its destination is insufficient.
- Added the same canonical-move guard immediately before applying any local move. Obsolete asynchronous Ken replies are discarded when their source board has changed.
- Replays every local game before upload. Invalid histories are refused rather than presented as verified recordings.
- Saves the starting board and first mover in `moveEvaluations.__kentroGameRecord`, including custom positions. Archive loading restores that metadata and supports older top-level `initialBoard`/`initialTurn` fields.
- Queues practice-game uploads per signed-in account, with stable IDs and duplicate-safe insert retries on reconnect/sign-in. Failed sends remain queued; another account cannot send them. Browser storage failures are surfaced. The queue is limited to 50 pending games and does not silently discard older entries. Keep browser data until sync completes. Independent tabs/devices are not a shared queue.
- Includes the previously completed automatic verified Ken progression/retry, reconnect and premove fixes, depth-30 analysis and standalone server puzzle creator.

The two existing suspect records are preserved. The missing custom starting position cannot be reconstructed reliably from the first move alone. The invalid capture must not be replaced by a guessed combination or fabricated result. Loading an invalid legacy record now explains the problem without changing it.

AI/practice games stay unranked. Only server-verified two-account multiplayer results can update ranked statistics. This release does not recalculate historical ELO or award ratings for AI games.

## Deploy to kentrodraught.ai.studio

The managed coding environment has Supabase access but **no connected hosting identity**. Publishing this repository/ZIP does not redeploy AI Studio. Replace the hosted app source with this release and redeploy the Node backend as well as its frontend.

Retain the existing original-project values:

```
VITE_SUPABASE_URL=https://pwovowlyylceuzontdhg.supabase.co
SUPABASE_URL=https://pwovowlyylceuzontdhg.supabase.co
APP_URL=https://kentrodraught.ai.studio
```

Keep the existing `VITE_SUPABASE_PUBLISHABLE_KEY` and server-only `SUPABASE_SECRET_KEY`. Do not put the secret key in a VITE variable or the frontend bundle. No new migration is required for these recording fixes.

To enable the already installed financial system, set **both** `VITE_KENTRO_COINS_ENABLED=1` at build time and `KENTRO_COINS_ENABLED=1` at runtime. Build and restart the complete application. The backend checks financial database readiness and refuses to enable charging if the contract is missing. Confirm `/api/coins/settings` reports `coinsEnabled:true` before announcing coins enabled. Existing Docker/Compose files support these flags and persistent game-data volumes.

For push notifications, generate a key pair once on the host:

```sh
node scripts/create-web-push-keys.cjs .env.web-push https://kentrodraught.ai.studio
```

Add `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` and `WEB_PUSH_CONTACT` from that file to the hosting environment securely, then restart. Preserve the pair across redeployments. The helper refuses to overwrite an existing key file. Never publish `.env.web-push`; it contains a private signing key. `/api/notifications/push-config` must then return a nonempty `publicKey`. Browser permission/installed-PWA requirements still apply; an iPhone needs the installed Home Screen app for web push.

Use the repository's build/start commands or Docker deployment. Preserve the persistent game-data directory. After deployment, check health, save/reload a test game, complete a verified Ken win, and play a controlled two-account multiplayer game to confirm one game record and one rating application. These authenticated live acceptance journeys were not performed by the read-only audit.
