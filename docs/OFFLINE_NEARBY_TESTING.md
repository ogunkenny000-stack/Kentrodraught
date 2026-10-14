# Offline Nearby Multiplayer — Wi-Fi / Hotspot

The existing Online Arena is unchanged. **Nearby Offline** is a new mode
in the Home Lobby, Online Game Hub and side menu. Guests can use it from
Sign In without creating an account.

## What works without internet

- Two devices on the **same local Wi-Fi / phone hotspot** communicate with a
  native browser WebRTC data channel. ICE uses `iceServers: []`: no game
  server, Supabase, STUN, TURN, matchmaking, or cloud signaling is contacted
  for nearby gameplay.
- Matching the existing Nigerian Draughts rules: compulsory captures,
  complete multi-jumps, flying kings, promotions, draw adjudication and
  no-legal-moves wins. Both peers independently verify legal moves and
  move sequence + board fingerprint before applying a received move.
- Turn enforcement, opponent names, resignations, draw offers, rematches,
  connection-loss pauses, flipped board for the black player.
- Nearby games are not rated, wagered or saved to online leaderboards.

## Why there are two pairing messages

A browser cannot simply advertise a Bluetooth game server or listen for
incoming sockets on a hotspot. Server-free browser WebRTC requires one
**invitation** (offer) and one **reply** (answer). The app provides a
host/join wizard, copy button and phone-native share sheet. Nearby Share /
Quick Share / AirDrop can transfer the codes between devices without mobile
data. Do not claim single-tap Bluetooth discovery or one-code room joining.

## Two-phone acceptance test

1. Load or install Kentro Draught on both phones **while online**. The
   service worker pre-caches the published app bundle. Use up-to-date
   browsers with WebRTC support.
2. Connect both phones to the same Wi-Fi or a third device's hotspot;
   then disable mobile data to prove gameplay doesn't need internet.
   Hotspot isolation/firewall must allow device-to-device connections.
3. Host: **Nearby Offline → Host Game → Share** the invitation via the
   phone's Nearby Share, Quick Share or AirDrop (or copy/paste directly).
4. Guest: **Join Game**, paste invitation, tap **Create Reply**. Share the
   reply back to host. Host pastes reply and taps **Connect & Start Game**.
5. Both screens show **Connected**, and the host (White) makes the first
   move. The guest sees the same position but from Black's perspective.
6. Verify one normal move, a compulsory capture, a multi-jump, king
   promotion, invalid/out-of-turn taps, and board consistency. Test a
   draw offer accept/decline, resignation, and a rematch.
7. Turn off the hotspot midgame: both boards stop accepting moves and show
   disconnection. Restart pairing to begin a fresh game.
8. Repeat on Android/Chrome, iOS/Safari and with airplane mode + Wi-Fi
   enabled; WebRTC local discovery may fail on isolated hotspots and some
   browser/OS combinations. Manual pairing cannot overcome AP isolation.

## Automated tests

`npm test -- src/lib/offlineMatch.test.ts`

Tests exercise mirrored legal moves, captures, whole-game adjudication,
replayed/stale messages and pairing code validation.

## Deployment note

After building and publishing the updated PWA, open it once while online on
both phones. Offline loading of the existing app shell depends on the
published service worker having installed/cached the new JS/CSS. The online
account, coin and C++ engine features still require connectivity.
