# Room invitations from WhatsApp

## Host

1. Create a multiplayer room, as before.
2. The room-code area offers **Copy Code** and **Copy to WhatsApp**.
3. **Copy Code** puts the plain room number on the clipboard (for manual joining).
4. **Copy to WhatsApp** copies a direct HTTPS invitation URL such as `https://draught.com/?room=2680001` (the actual host and code come from the running app). Paste the link into a WhatsApp message.

The secondary in-game multiplayer panel offers the same pair of actions. It does **not** open an unrelated generic homepage.

## Guest

1. Tap the link inside WhatsApp. The app opens directly in the multiplayer invitation view instead of requiring code search or typing.
2. If not already authenticated, sign in or create an account; the link remains on the page during ordinary sign-in.
3. Press **Start Game**. The existing server-side `join-room` command seats the guest and starts the match once the guest has joined. The game server (not a local UI timer) starts the live game.
4. If the room has expired or is already full, the existing room error is displayed and the guest can retry or dismiss.

The link alone never commits the guest to an online game: pressing **Start Game** does.

## Compatibility and verification

- `?room=CODE` is the canonical new link. `?join=CODE` and `?code=CODE` remain accepted.
- Room codes are normalized to up to ten uppercase alphanumeric characters, consistent with the server.
- Invitation parameters are removed from browser history on success or dismissal without altering unrelated query parameters.
- The copied invitation uses `window.location.origin` (the deployed site), not a hardcoded development URL.
- The clipboard has a fallback for browsers without the modern Clipboard API, and copy failures display a useful error instead of falsely saying the link was copied.
- Unit tests in `src/lib/roomInvite.test.ts` check URL generation, URL parsing, normalization, parameter cleanup, and successful copying.

**To test with two real devices:** create a room on device A, press Copy to WhatsApp, paste the link into a chat with device B, open it there, sign in if necessary, press Start Game, and verify both clients enter the same active match. Also test closed-room links and manual Copy Code joining. Full end-to-end verification requires two authenticated accounts and a running configured game server.
