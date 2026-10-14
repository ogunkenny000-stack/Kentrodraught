# Online Arena — match discovery upgrade (2026-10-13)

## Why this upgrade

Research into AfroDraught's public match discovery suggested that browsing live challenges was easier for players than depending on room codes. Kentro retains its own design and Nigerian draughts rules and reuses the existing WebSocket lobby messages, with no new database or external infrastructure.

## Implemented

- **One-tap Quick Match** with 3/5/10/15-minute clock presets. Only standard, free, single-match rooms with the *same clock* are automatically joined. If none exists, the existing create-room call creates a free public waiting room. It does not pretend a match has started while waiting.
- **Open Challenges** directly in the lobby, displaying the server's real waiting rooms with host, minutes, rules, stake, best-of count, and a Join button. Filtering modes: Standard · Free, All free, All games. It shows at most 4 initially with an expand control. The original server independently validates availability and rules on join.
- **Guest-safe discovery** hides noneligible wagers and series games in the challenge list and the waiting rooms dialog. It never bypasses the existing server-enforced guest trial quota.
- **Kentro TV and recent online results** have discoverable shortcuts on the arena screen.
- The misleading *Active Games* tool previously displayed waiting rooms rather than in-progress games. Its action now opens Kentro TV instead.
- Fixed the previously missing ChevronRight icon import and corrected broad CSS selectors that would otherwise force arbitrary time buttons into highlighted states.

## Deliberate limits

This is a *small, targeted product improvement*, not a replacement matchmaking algorithm: room selection is based on the server's broadcast list, first matching room wins, and there is no Elo queue or cross-server matchmaking. If two players try the same waiting room, the server resolves the race and can reject the second join. A player creating a room may need to wait for someone to join. No cash/wager behavior or special game variants were added.

## Verification and deployment

Run from project root:

```sh
node --experimental-strip-types scripts/arena-discovery-smoke.mjs
npm ci
npm run build
npm test
```

Validation in the packaging environment covered the 11 focused match-discovery checks and TypeScript parsing. The full app build and actual multiplayer tests on two devices still need to be performed on a dependency-complete environment. No live deployment was attempted.

### Two-phone acceptance checklist

1. Sign in on two devices; open Online Arena and confirm connection status.
2. Set 10 min on A, tap Play 10-minute match, confirm A creates a waiting room if none exists.
3. On B confirm the challenge lists 10 min, Standard, Free. Tap Join and accept the existing room preview.
4. Start and finish one match, check move legality, clocks, and one match-history result.
5. Repeat with B creating a 5 min room while A selects 10 min. A must **not** autojoin B's 5-minute room.
6. Repeat with a coin wager and best-of-three room; Quick Match must never automatically join either.
7. Enter as guest and confirm wagered/series challenges are absent; the existing one-game server quota still applies.
8. Tap Watch live games and Recent matches. Confirm both navigate correctly, including on a narrow Android screen.
9. Disconnect networking; Quick Match and Join should be unavailable until reconnected.
