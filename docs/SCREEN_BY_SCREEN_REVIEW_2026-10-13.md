# Kentro Draughts — Screen-by-Screen Quality Audit

**Date:** 13 October 2026  
**Baseline:** `kentro-draughts-online-arena-discovery-upgrade.zip` (latest handoff)  
**Scope:** Mobile and desktop React UI, primary screen navigation, modals, error/empty/loading cases, guest limitations, board controls, and integrations referenced by the UI. The existing game rule implementation and gameplay server are intentionally not rewritten.

## Read this before release

This is a **code and focused-test review**, not a certificate that every browser/device/backend flow works. No deployed URL, authenticated Supabase test environment, two physical phones, working payments sandbox, or successful complete JavaScript dependency installation was available here. A complete production build, browser automation, and mobile usability run are **pending**. The live system must not be described as error-free based only on these checks.

**Status keys:** `Fixed` = source defect corrected in this package. `Reviewed` = inspected existing code and documented intended behavior, but not end-to-end verified. `Needs live test` = must be exercised with actual services/devices. `Follow-up` = material issue remains outside this patch's safe scope.

## Entry and account screens

| # | Screen/flow | Review and expected experience | Status |
|---|---|---|---|
| 01 | Initial splash and install | Skip splash on active room / invite / replay. Installed PWA assets and Android safe-area behavior require browser check. Storage denial now cannot crash the App's preferences. | Fixed + needs live test |
| 02 | Sign in | Username/password validation, loading/error states and auth listener inspected. Real sign-in, invalid credentials and email-unconfirmed scenario still need Supabase test account. | Reviewed; needs live test |
| 03 | Sign up | Username reservation, email format, weak-password responses, confirmation copy inspected. Confirmation link requires live email test. | Reviewed; needs live test |
| 04 | Password reset | Username-based reset and success state inspected. Confirm reset email arrives and redirect works on real site. | Reviewed; needs live test |
| 05 | Guest entry | Guest access button, 3-AI / 1-online display and sign-in gate inspected. Quota and cross-device reset limits need server tests. | Reviewed; needs live test |
| 06 | Main shell | Sidebar/tab destinations mapped. Mobile header no longer offers an irrelevant statistics shortcut on ordinary hub pages. Live board state is recognized by top navigation. | Fixed |
| 07 | Mobile drawer | Close buttons labelled and Escape close added. Screen reader and focus order need actual accessibility pass. | Fixed + needs live test |

## Playing screens

| # | Screen/flow | Review and expected experience | Status |
|---|---|---|---|
| 08 | Home dashboard | Primary Play Online/Play Ken CTA, live list, stats, weekly puzzle links and cards reviewed. **Daily puzzle** mismatch corrected to weekly. | Fixed |
| 09 | Online Arena discovery | Quick Match with matching time controls, compatible-room filtering and direct open-challenge joining checked with 11 focused tests. Network race/load tests remain. | Reviewed; needs live test |
| 10 | Create custom game | Time, special rules, wagers, best-of series and room creation inspectable. Validate all combinations with a live server before release. | Reviewed; needs live test |
| 11 | Room code and WhatsApp invitations | Copy code, direct share URL and invitation acceptance inspected. Android WhatsApp in-app browser deep link test needed. | Reviewed; needs live test |
| 12 | Waiting room and joining preview | Opponent preview, ready/leave and reconnect flow inspected. Test host cancellation and stale/full/expired rooms with two devices. | Reviewed; needs live test |
| 13 | Live online match | Wooden 10×10 board, move controls, clocks, chat, status and focus mode preserved. **Navigation can no longer silently abandon an active game:** the forfeit confirmation is reused. | Fixed + needs live test |
| 14 | Match interruption/reconnect | Snapshot and socket handling present; must test unplug/reconnect/timeout, stale room, double join, browser backgrounding. No guarantee until tested on two phones. | Reviewed; needs live test |
| 15 | Game over and rematch | Result modal, draw/resign, series and replay entry inspected. Must test win/loss/draw variants and rematches against server. | Reviewed; needs live test |
| 16 | Ken AI and level selection | AI starting side, level selection and autosave inspected. **Locked difficulty bypass via both sidebars fixed**; redirected to proper AI setup when locked. | Fixed |
| 17 | AI-vs-AI / computer settings | Game mode and level preferences reviewed, but actual performance and engine resource limits need live bench. | Reviewed; needs live test |
| 18 | Nearby offline multiplayer | Offer/answer Wi-Fi pairing, board state, draw, resign and rematch reviewed. **Back** now confirms active-game termination. WebRTC hotspot pairing still requires real two-phone verification. | Fixed + needs live test |
| 19 | Puzzles list | Loading/error/empty states and weekly completion count inspected. Puzzle backend delivery and solve flow require live test. | Reviewed; needs live test |
| 20 | Active puzzle board | Loaded position, legal Nigerian move path, capture sequences, mistake and completion feedback need a device test using known reference puzzles. | Reviewed; needs live test |
| 21 | Training / analysis lab | Position loading, past game analysis, review, AI controls and sidebar entry points inspected. Heavy engine analysis performance requires test. | Reviewed; needs live test |
| 22 | Board editor | Piece placement, position reset and custom challenge handoff inspected. Confirm invalid-position handling with multiplayer server. | Reviewed; needs live test |

## Watching, tournaments and social screens

| # | Screen/flow | Review and expected experience | Status |
|---|---|---|---|
| 23 | Kentro TV live | Live listing, refresh, spectator entry and empty state inspected. Actual spectator lag/reconnect requires multi-device test. | Reviewed; needs live test |
| 24 | Kentro TV replay | Move frames, slider, autoplay, direct links, WhatsApp/share and highlight export inspected. Replay logic/record availability tested only by focused checks, not full browser playback. | Reviewed; needs live test |
| 25 | Tournaments | Creation/joining, standing, results and admin-only actions visible in source. Real database migrations, RLS and schedule behavior need test. | Reviewed; needs live test |
| 26 | Profile and avatar | Stats, avatar downscale, wallet fetch and sign-out examined. **Removed false 'Instant Transfers' wording and artificial withdrawal countdown**. Real avatar upload still needs test. | Fixed + needs live test |
| 27 | Friends | Loading and realtime subscriptions, add/remove actions inspected. **Add and remove failures now appear to the player; icon controls labelled.** Friend creation currently auto-accepts; reciprocal consent/access rules require a separate backend and RLS review. | Fixed + follow-up |
| 28 | Players directory | Player lookups, modal open path and profile/admin details require a populated live account database. | Reviewed; needs live test |
| 29 | Community lounge | Chat, groups, forwarding, voice notes, profile overlays and direct messages inspected at source level. Real-time delivery, moderation and multi-device calls require live test. | Reviewed; needs live test |
| 30 | Voice/video call overlay | Incoming call, accept/decline, permissions and camera/mic states mapped. Needs two devices and permission-denial tests. | Reviewed; needs live test |
| 31 | Notifications inbox | Notification list/read/preferences and safe-link navigation reviewed. **Added Escape key, dialog focus containment and focus restoration; live match notification taps cannot force navigation away**. Push delivery needs VAPID and real-device test. | Fixed + needs live test |
| 32 | Settings | Board themes/preview, sound, focus, square numbers, scaling and reduced-motion checked. Guarded preference storage prevents crash on restricted storage. | Fixed |
| 33 | Completed games and history | Shared one-match result representation used in Home/archives/replays. Test legacy duplicates, genuine rematches, both players, and private match visibility with database fixture. | Reviewed; needs live test |
| 34 | Wallet / coin purchases | Frontend purchase/receipt screens inspected, but coin settlement, double submission, backend authorization and payment security require specialist server/database tests. | Follow-up |
| 35 | Administration and moderation | User/game/tournament/puzzle/training screens exist; UI visibility is not proof of backend authorization. Test administrator and normal-account access separately. | Follow-up |
| 36 | Academy / Learn placeholder | **Removed fabricated 10-day countdown**; screen now accurately says 'In development'. | Fixed |
| 37 | Misc. dialogs / mobile chat sheets | ModalShell focus trap, Escape, scrolling and safe-area logic reviewed; keyboard and Android touch test remains. | Reviewed; needs live test |

## Corrections applied in this handoff

1. Added `src/lib/safeStorage.ts`; guarded App preference, username, saved AI game and tournament storage operations against private-mode/security/quota exceptions.
2. Reused the existing explicit forfeit confirmation when navigating away from an active online match, including global navigation. Ensured the game-over path does not double-confirm.
3. Blocked notification deep-link reloads during an unfinished live online match.
4. Prevented the side navigation (desktop and mobile) from changing Ken AI to a locked difficulty without going through the unlock UI.
5. Improved top navigation to recognize all active game-board screens; hid irrelevant mobile match-statistics shortcuts on hub screens.
6. Made Nearby Offline Back confirm active match abandonment and notify the opponent with a best-effort resignation.
7. Improved mobile drawer Escape handling, dialog semantics and labelled close controls.
8. Added keyboard Focus/Escape handling to the notifications drawer, with focus restoration.
9. Corrected Weekly Puzzles wording and removed false placeholder launch countdown.
10. Changed wallet wording to avoid promising instant withdrawals that are not available.
11. Added visible Friends action failure messages and accessible labels to icon-only controls.
12. Added `scripts/screen-audit-smoke.mjs` covering critical regression paths and blocked storage behavior.

## Evidence collected

- **150** TypeScript/TSX source and test files transpile/parse with **0 syntax errors** (excluding one declaration-only file).
- **13** critical screen regression checks pass.
- **11** Online Arena discovery checks pass.
- Board-geometry and royal wooden asset smoke check passes.
- Startup loading/compression smoke check passes.
- Engine queue prioritization/cancellation smoke check passes.
- Native Nigerian engine initializes and searches successfully.
- Go edge integration tests pass.
- Both CSS entry files parse using PostCSS.
- **Not completed:** `npm ci` (dependency registry/cache inaccessible), complete `vite build`, TypeScript whole-program typecheck, Vitest suite, Playwright/Chromium browser journey, authenticated database tests, Android phone/real hotspot tests, push-notification test, payment/security audit.

## Release-blocking test sequence

1. On clean Android Chrome: signup, confirm email, sign in, sign out, guest entry, install PWA, restrictive storage and offline state.
2. On small Android screen and desktop: navigate all 37 areas; verify no clipped board, overlapping dialogs, invisible icons, or inaccessible controls.
3. On two signed-in phones: Quick Match, invite link from WhatsApp, join/cancel full room, clock sync, legal captures, disconnection and return, live navigation forfeit prompt, match result and rematch.
4. On guest phone: exactly 3 new AI games and 1 online match; resume AI match without extra quota; sign-in prompts and disabled restricted features.
5. On Wi-Fi hotspot with cellular data disabled: manually complete offline offer/answer, moves, draw, resignation, disconnected state, rematch, and Back confirmation.
6. Save a real game: one completed record, proper winner/loser labels, genuine rematch separate, replay seek, highlight generation and share link.
7. Admin and ordinary accounts: tournament actions, moderation, notifications, friends access, coin receipts, purchase requests, unauthorized API calls and RLS behavior.
8. Stress test 10/50/100 concurrent connections on MVP host and measure CPU, memory, p95 move acknowledgment, page loading, and reconnect success.

**Outstanding material risk:** `FriendsPage` and lounge friend creation currently save `status: "accepted"` immediately. A genuine request/approve workflow requires coordinated UI, server, schema and RLS changes; don't assume consent or privacy is correct without that work. Likewise, account roles, coin settlement and player-to-player communications need authenticated backend verification.

**Do not deploy solely on the strength of these checks.** Stage to a test environment first; run real two-player and mobile journeys and fix every observed regression before production.
