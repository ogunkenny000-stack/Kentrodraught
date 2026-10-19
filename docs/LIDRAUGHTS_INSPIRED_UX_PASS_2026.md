# Kentro Draughts — UX clarity pass (13 October 2026)

## Scope
Second-pass UX improvements on top of the full UI/UX redesign. Inspired by the *principles* used in Lidraughts (clear play pathways, board-first layouts, separate preferences, and a distraction-free mode), **not a clone, not source-code reuse, and not a switch to international draughts rules**.

Research references:
- https://lidraughts.org/blog/XrVSYhIAACMA6-sv/lidraughts-v2 — board-first layout across three, two, and one-column sizes; resizable board and lean responsive pages.
- https://github.com/roepstoep/lidraughts/blob/master/modules/pref/src/main/Pref.scala — independent settings such as sounds, animation, coordinates and Zen mode.
- https://lidraughts.org/features — board, piece, display, and mobile preferences overview.

## Issues fixed in this pass
1. The Settings modal previously mixed all options into a dense, tiny-type vertical list. It is now split into **Board**, **Gameplay**, and **Comfort** tabs.
2. The former board settings had no live preview. New board-style previews appear while choosing an existing theme or custom squares.
3. The small-screen CSS could accidentally hide the game's **Options** button, leaving controls hard to discover. The Options button is explicitly restored.
4. A clean **Focus mode** hides desktop sidebars and the global navigation *during board-based play only*, without hiding the actual game toolbar, clocks, rules or offers. Toggle from **Options → Focus on board**, **Settings → Gameplay**, or keyboard **Z** when not typing in a text field or modal.
5. Square-number visibility and focus/comfort preferences now persist on the current device.
6. Sound and animation preferences live in a straightforward accessible section. Reduced motion disables decorative animations via CSS without suppressing the game rules or move responses.
7. Mobile header removes a duplicate sound shortcut (the option remains in Settings) and emphasizes settings/game controls.
8. The home screen no longer repeats Online Play in both the main hero and the destination tiles. The first tile now goes to Puzzles while Online Play stays the primary action.
9. Shared dialog shell now exposes correct dialog semantics, supports Escape dismissal where allowed, restores keyboard focus to the previous control, and traps Tab within the currently active modal.
10. Settings interactive elements have larger tap targets and labelled switch states.
11. The sidebar board-size slider now uses the same supported 80–130% range as Settings, preventing the two controls from disagreeing.

## Out of scope and safety
- No rules engine, protocol, coins, tournament scoring, authentication, wallet, database, or WebSocket behavior changed.
- Nigerian playable-square geometry is unchanged; current wood board and pieces remain.
- No external branding, screenshots, styling sheets or code from Lidraughts were imported.
- No hosting or deployment changes.

## Test plan (real devices)
- Android narrow viewport: open match → Options visible → Focus on board → navigation hidden, game clock and board remain functional → Options → Exit focus mode.
- Settings three tabs, each reachable with touch and keyboard; verify board theme switches, 80–130% desktop size slider, custom palette pickers, on/off controls and automatic persistence after refresh.
- Press Z while on board, and verify it does not trigger when typing inside inputs/chat or when a modal is open.
- Go to Home, Online, Kentro TV, Puzzles, Settings and back; no hidden navigation outside a game.
- Complete a legal capture sequence and a real 2-phone online game to verify unchanged move and server behavior.
- Check narrow portrait Android, landscape phone, tablet and desktop for clipping and readable player names/clocks.
- Keyboard accessibility: Escape closes dismissible dialogs; focus returns to opener; Tab and Shift+Tab stay in active dialog.
- Test high-motion and reduced-motion preferences; check offline and no-connection states.

## Verification status
- All 143 executable TS/TSX files parsed successfully using the available TypeScript compiler. `.d.ts` declarations are not executable and were excluded.
- CSS syntax parsed; existing rules file hash compared to the prior redesign version.
- Full Vite/React production build and interaction/device testing still required. The required npm dependencies were not fully available in this environment.
