# Kentro TV + Smart Game Notifications

This release extends the existing Kentro Draughts code and visuals. It does **not** replace the game rules, online-play protocol, guest trials, WhatsApp invitations, or nearby play.

## Features

### Kentro TV (option 8)

- **Live now** shows real active game rooms, player names, time-control labels and spectator counts. Selecting a match enters the **existing** spectator board with the real game state and clock.
- **Replays** load completed games from the existing game-record server routes and Supabase archive. Search by player/game code; view board, scrub through moves, pause and resume.
- **Verified move-by-move playback** uses the app's Nigerian Draughts move generator and actual recorded moves, rather than inventing positions.
- **Automatic highlights** discover capture sequences, promotions and final moves. Click a highlight to play a short animation.
- **Share** an exact replay position or animated highlight with a direct `/?replay=GAME_CODE&ply=N&clipEnd=N` link by copy, device sharing or WhatsApp.
- **Export a short video** from a supported browser using `canvas.captureStream()` + `MediaRecorder`. Browser formats vary; where recording is unsupported, the shareable replay link still works.
- A replay deep link launches Kentro TV, and guests can browse Kentro TV after entering the app as a guest.

### Smart Notifications (option 10)

- Notifications bell now opens an **in-app inbox**, including unread badge, timestamps, read-one/mark-all-as-read and category switches.
- Connected friends can send an **in-app challenge** while hosting an open room; tapping the received notification opens the existing one-tap room invitation screen.
- Notifications for accepted friendships, completed online game results linking directly to Kentro TV, live tournament rounds, final standings, and reminders about 15 minutes before a tournament starts.
- **Recipient-only Supabase RLS**: signed-in accounts may read and mark **only their own** notifications; clients cannot forge notifications by inserting rows.
- **Optional web push**: a user chooses "Enable notifications" in inbox settings. When the server has VAPID keys and the device supports push, the service worker can show alerts even with the tab closed. Otherwise, tab-local alerts and the in-app inbox remain available.
- Preferences are per-account, per-browser. Disabling web alerts unsubscribes the browser; sign-out attempts to remove its device subscription.

## Deployment: required steps

**1. Database.** In Supabase SQL Editor, run the entire script:

```
supabase/migrations/20261011_kentro_tv_notifications.sql
```

This creates `public.kentro_notifications`, `public.kentro_push_subscriptions`, RLS policies and triggers for friend/tournament events. Apply to a staging instance first and check against the current production schema. Existing `public.profiles`, `public.tournaments`, and `public.friends` tables are required (they are in `supabase/schema.sql`). Never turn off RLS to make this work.

**2. Server configuration.** Keep the existing required Supabase variables:

```
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=YOUR_SECRET_SERVER_ONLY
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_BROWSER_KEY
```

The secret Supabase key and private VAPID key must be set **only on the backend**; do not prefix them `VITE_`. Do not put real values in source code.

**3. Optional background push.** Generate a P-256 VAPID keypair **once**, privately, on your server or local terminal:

```bash
node - <<'NODE'
const {createECDH}=require('node:crypto');
const key=createECDH('prime256v1'); key.generateKeys();
console.log('WEB_PUSH_VAPID_PUBLIC_KEY='+key.getPublicKey().toString('base64url'));
console.log('WEB_PUSH_VAPID_PRIVATE_KEY='+key.getPrivateKey().toString('base64url'));
NODE
```

Configure your server environment, not the frontend, with both generated values and a real contact:

```
WEB_PUSH_VAPID_PUBLIC_KEY=...
WEB_PUSH_VAPID_PRIVATE_KEY=...
WEB_PUSH_CONTACT=mailto:support@YOUR_DOMAIN.com
```

Keep this keypair consistent across deployments; rotating it may require users to re-subscribe. Deploy the **backend, frontend, and `/sw.js` together**, on HTTPS. Browser permission must be requested by the user from the notification settings UI. iPhone background Web Push generally requires a supported installed Home Screen web app, and available behavior differs among iOS/browser versions.

With these variables omitted, push configuration returns `publicKey: null`; the in-app inbox still works after migration. The server checks for tournament reminders about every 60 seconds and dispatches queued browser push about every 30 seconds. These timers require the Node server to stay running. If multiple Node workers run, dedupe keys prevent duplicate inbox items but push fanout should use a single queue consumer for strict at-most-once delivery.

**4. Install, build and run** (with working npm registry access):

```bash
npm ci
npm run build
npm test -- --run
npm start
```

This release adds no external runtime packages; it uses built-in Node cryptography.

## Manual acceptance tests (two devices recommended)

- [ ] **Kentro TV Live:** Start an online match on two phones, open Kentro TV from a third session, select the live room and verify legal moves/clock changes match in real time.
- [ ] **Replay:** Complete a match. Select it under Replays and compare initial, mid-game, capture, promotion and final position with the recorded moves. Open a copied replay link in a new browser session.
- [ ] **WhatsApp:** Share a highlight via WhatsApp. The recipient opens the correct match and the intended animated move interval; verify that the game is available and completed.
- [ ] **Video:** Tap Export Short Video where MediaRecorder is supported; verify playable file and picture content. On unsupported devices, confirm the user-friendly fallback to an animated link.
- [ ] **Notifications:** A signed-in host opens an online room and sends a challenge to an accepted friend. The friend sees it in the notification inbox and reaches the correct game by tapping it.
- [ ] **Game result:** Finish the game and confirm result alerts for both signed-in players, then follow the replay link.
- [ ] **Tournament:** Start a tournament from an authorized admin action and verify round/final notifications. Test a tournament whose `startTime` is in the next 15 minutes for reminders. Ensure other players cannot generate alerts by changing tournament status.
- [ ] **Privacy:** Sign in as two different users, verify each cannot fetch/update the other's `kentro_notifications` rows via the client; guest sees sign-in guidance rather than someone else's inbox.
- [ ] **Preferences:** Turn off one category, check unread counts and push categories; restart the app and confirm preferences persist. Enable push, then disable and verify server subscription removal.
- [ ] **Mobile:** Test Android Chrome and iPhone installed web app if available. Deny notification permission and confirm inbox continues working.
- [ ] **Regression:** Check guest AI/online trial limits, online room invites, offline/hotspot mode, existing move rules and existing reconnect behavior.

## Automated tests and verification status

- `src/lib/kentroTv.test.ts` covers deterministic replay, rejection of illegal moves, highlight selection, deep links, and safe notification paths.
- `src/server/webPush.test.ts` covers endpoint validation, subscription keys, decryptable RFC 8291 payloads and independently verified VAPID signature.
- Local standalone checks completed successfully: 11 replay/link/notification/crypto checks. New source was syntax-checked with TypeScript transpilation; `/public/sw.js` passes `node --check`.
- **Not verified in this execution environment:** a full production dependency install/build, Supabase migration applied to the actual project, browser UI running end-to-end, live push delivery through mobile push services, and exported video on real devices. Production launch requires the above manual acceptance tests.

## Main files

| Area | Files |
|---|---|
| Kentro TV | `src/components/KentroTV.tsx`, `src/lib/kentroTv.ts`, `src/lib/highlightVideo.ts` |
| Notification UI | `src/components/NotificationCenter.tsx`, `src/lib/smartNotifications.ts`, `src/lib/pushSubscription.ts` |
| Server events and push | `src/server/notifications.ts`, `src/server/webPush.ts`, `server.ts` |
| Push worker | `public/sw.js` |
| Data authorization | `supabase/migrations/20261011_kentro_tv_notifications.sql` |
| Existing integrations | `src/App.tsx`, `src/components/HomeLobby.tsx`, `src/components/LobbyDashboard.tsx`, `src/components/MenuSidebar.tsx`, `src/server/onlinePlay.ts` |
