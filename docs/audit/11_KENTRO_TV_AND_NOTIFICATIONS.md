# Kentro TV and notifications — 15 October 2026

TV reads canonical live rooms and completed records. Historical/custom replays retain their actual opening side; clip/ply bounds clamp to legal history. Playback and sharing must not imply that a hosted archive or notification delivery succeeded when the backend is unavailable.

## Executed checks

`CHROME_NO_SANDBOX=1 E2E_APP_URL=http://127.0.0.1:8126 npm run test:tv` passed the real React UI using explicit local API replay fixtures. Checks cover guest deep-link continuation, opening pieces, end-frame replay restart/pause, keyboard stepping, clamped clips, capture highlights, share-link bounds, clipboard-adapter fallback, a 390px replay board, guest notification guidance, unavailable signed-in inbox and persistence of all five notification preference categories. Off-origin HTTP/WebSocket traffic was blocked. The run made four recent-game and four replay fixture requests and had no uncaught UI error.

Unit checks cover Black-first replay logic and custom legal replay reconstruction. Service-worker tests protect live API writes from caching. Push subscription checks validate provider destinations and real P-256 public points; notification updates are limited by SQL to the recipient's read timestamp.

## Limits

Hosted replay storage/RLS/Realtime, production live-board synchronization, real VAPID/browser push delivery, OS permissions, background delivery, native share/WhatsApp handoff, actual system clipboard and video export were not verified. An unavailable inbox is intentional honest error handling, not evidence of successful notification delivery. Voice/video transport remains outside the passed browser PvP claim.
