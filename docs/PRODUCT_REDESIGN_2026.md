# Kentro Draughts — Product experience overhaul

## Goal

Replace a dense, developer-oriented UI with a professional, mobile-first app while **retaining the Nigerian 10×10 rules, engine, server protocol, wallets, ratings, and saved matches**. This is an application-structure redesign; there is no database migration and no production deployment.

## Implementation

- **Navigation architecture:** Five clearly labeled mobile destinations (Home, Online, Play AI, Watch, Lounge); a consistent desktop sidebar; secondary destinations and preferences remain available in the menu. An unobtrusive shared header replaces ad-hoc screen branding.
- **New Home screen:** Clear welcome area, dedicated hero and start-online action, accessible AI game setup, four main destinations, player statistics, live matches, recent results, and community shortcuts. All existing callbacks connect to their original app logic.
- **Guest-first onboarding:** Guests can explore from the first sign-in view without entering credentials; the original guest quotas remain enforced by the existing mechanisms.
- **Online arena:** Quick match, create room, and join-by-code remain immediately visible. Advanced controls are in a labeled expandable section. Invitation links continue to open the same join flow.
- **Game screen:** Clear Back / game status / Options toolbar; secondary board adjustments live in Options. The royal wooden board, move highlights, kings, clocks, draw/resign flows, call support, and game-state logic remain intact.
- **Kentro TV:** More legible heading, live/replay tabs and watch cards; match replay and sharing logic unchanged.
- **Other surfaces:** Unified backgrounds, borders, headers, dialogue shells, drawers, nearby play, tournaments, chat, puzzles, notifications, player/profile overlays.
- **Accessibility and performance:** Larger primary controls, focus-visible rings, mobile safe-area navigation, reduced-motion support, lazy loading retained, no new runtime dependency.

## Core files

- `src/components/HomeLobby.tsx` — rebuilt dashboard
- `src/components/MenuSidebar.tsx` — streamlined navigation and collapsed settings
- `src/components/layout/TopNav.tsx` — shared compact header
- `src/components/layout/MobileTabBar.tsx` — five-destination app navigation
- `src/components/game/GameScreen.tsx` — focused toolbar and board controls
- `src/AuthScreen.tsx` — guest-first responsive sign-in layout
- `src/components/LobbyDashboard.tsx` — compact quick-play priority
- `src/components/KentroTV.tsx` — updated viewing navigation
- `src/kentro-design.css` — sitewide design system
- `src/main.tsx` — design stylesheet import
- `src/App.tsx` — redesigned shell and hide non-game right sidebar

## Functional regression checklist (requires full app and working backend)

1. Fresh browser: guest entry, create account, sign-in and password reset.
2. Test desktop at widths 1024, 1280 and 1600. Confirm sidebars, main content, dialogs, and board are not clipped.
3. Test Android mobile at 320×640, 375×812 and 430×932, including keyboard open and gesture-safe bottom navigation.
4. Quick Match: two connected users enter the same game; moves and clocks synchronize.
5. Code join and WhatsApp join; copy/link controls work with protected/expired rooms.
6. Play Ken AI in gold/black; change levels from Home and from in-game Options.
7. Capture chains, promotion, forced captures, draw offer, resignation, undo where allowed.
8. Disconnect during a game; reconnect without duplicate results.
9. Offline nearby pairing, legal play, and disconnect handling.
10. Kentro TV live spectating, opening a replay, scrub/playback, sharing, video exports.
11. Tournaments, puzzles, analysis, lounge, wallet, notifications, profile, friend requests.
12. Reduced motion, browser zoom, keyboard focus, screen-reader names, and touch targets.

## Tested here

- All 144 TypeScript/TSX files parse with TypeScript transpilation.
- The existing board-style smoke test passes.
- Startup/caching performance smoke test passes.
- TypeScript Nigerian rules file identical to the prior board release; core engine, network, server, and database unchanged.
- Stylesheet parses with PostCSS.

**Not yet verified:** complete application build (dependencies unavailable in this runtime), browser/device screenshots of actual running React UI, real-time two-device gameplay, server/database integration, and screen-reader/mobile accessibility. Do not release to production until those are verified on a staging instance.

## Research principles

- Material Design: direct access to three–five top-level destinations for compact screens.
- Apple HIG: readable in-game labels, primary touch controls around 44pt minimum, fewer controls obstructing play and reduced visual complexity.
- Product principle: one primary action per screen; move secondary functions into progressive disclosure instead of deleting them.
