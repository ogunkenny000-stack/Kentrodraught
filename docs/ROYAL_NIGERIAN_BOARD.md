# Kentro Royal Nigerian Board — Visual Upgrade

This version applies the supplied wooden board reference to the **existing** game code.

## What changed

- `wood` (now labelled **Royal Nigerian Wood**) uses a thick polished wood frame and extracted cream/walnut textures from the reference image.
- Black and gold ringed piece artwork is reused as lightweight transparent WebP sprites.
- Larger, clearer board with 680px desktop allowance and near-full phone width; the live board still responds to pointer and touch input.
- Promoted kings get a visible crowned badge; captured pieces keep their existing animation.
- The same visuals are used on the main board (AI, online, puzzles, analysis/editor), Nearby Offline, and Kentro TV replay boards.
- The other user-selectable themes and the custom theme remain available.

## Nigerian rules are untouched

The Nigerian 10×10 board's playable-square mapping (`ngRcToSq`), 1–50 square IDs, move generator, mandatory captures, king rules, engine, clocks, game/network state, results, and server logic were **not changed**. Piece positions still come from the game state; the reference PNG is **not** used as a static playable board (which would break captures/moves).

## Assets and size

The four reusable sprites and textures live under `public/board/royal-wood/` and total approximately 13KB. CSS lives in `src/index.css` and is shared by all three gameplay/replay surfaces. Your full original source tree and native engine are retained.

## Testing

1. Run `node scripts/board-style-smoke.cjs` for integrity tests (no package install needed).
2. Run `npm ci`, then `npm run lint`, `npm test`, and `npm run build` in your normal CI environment.
3. On two phones, confirm legal and illegal taps, forced captures, a promotion to king, flip board, online watch, and hotspot play. Test offline Safari/Chrome caching on a real phone.

A fully built, visually reviewed browser session was not available here because npm dependencies could not be installed in this environment. No change has been deployed to hosting.
