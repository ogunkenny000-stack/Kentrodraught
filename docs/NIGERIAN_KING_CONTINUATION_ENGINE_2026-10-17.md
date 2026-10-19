# Nigerian Draughts flying-king continuation upgrade — 17 October 2026

## Implemented rule contract

- Mandatory capture: if any player piece can capture, quiet moves are illegal.
- A single capture is a complete move **only if continuation is not available**.
- For a **given victim** of a flying-king jump, where several empty landing squares exist, if **any** of those squares enables another capture, the king must choose a landing that continues and complete that sequence. Choosing an alternative landing behind the **same victim** just to stop early is disallowed. The rule applies recursively after each jumped victim.
- The player may select a *different capture opportunity*, different capturing piece, or different initial jumped victim, even when that legal complete sequence captures fewer pieces. **Do not enable International Draughts' global majority-capture filtering**.
- Men capture backward and forward; flying kings move/capture diagonally over distances, change direction, and cannot jump the same captured piece again.
- Jumped pieces remain blockers until the entire turn ends; the starting square is vacated. Promotion is determined by the final landing square (over-crown).

### Screenshot trap position

Black king on 49, White men on 38, 37, 32, etc. After capturing 38, land 33 to continue capturing 37, or land 27 to capture 32. Previously the game also accepted one-piece endings on 16 and 22 despite continuations behind the same first victim. Those evasive endings are now illegal.

The resulting complete lines in this fixture are:
- 49 → 33 → 42; take 38, 37
- 49 → 33 → 46; take 38, 37
- 49 → 27 → 36; take 38, 32

In contrast, White king on 34 with Black pieces on 28, 8, 36, **and 39** can choose to take only 39 or choose longer captures starting with 28. These are different first victims; no global maximum-capture rule applies.

### Modified production files

- `src/gameLogic.ts`: full-path king capture enumeration with per-victim continuation filtering and terminal-path de-duplication.
- `nd_upgraded/gen.cpp`: native SCAN-derived C++ generator enforces per-victim forced continuation only in Nigerian variant; other variants unchanged.
- `src/components/LobbyDashboard.tsx`: corrects incorrect 'maximum capture' description.
- Existing server validator `src/server/nativeEngine.ts` verifies native results against generated legal moves; its behavior automatically tracks the updated rule generator.

### Automated checks

After installing project dev dependencies:

```bash
npm run build:engine
npm run test:capture-rules
npm run test:captures
npm test
npm run lint
```

`test:capture-rules` is dependency-free beyond Node 22 and a C++14 compiler. It compiles a fresh C++ rules probe and compares the **entire legal move list** against TypeScript on crafted and deterministic random positions. GitHub Actions runs it after `npm test`.

### Caveat and variant policy

This implements the **strict king-landing continuation interpretation** requested by the owner. The Nigerian manual's 2017 section 3.4 describes the king as obliged to capture a second piece if encountered and section 2.9 rejects maximum quantity as a global priority. Some published online platforms describe king landing freedom differently. This is an explicit product rules decision; tournaments should disclose it.

References:
- https://www.scribd.com/document/848667716/INT-L-DRAUGHTS-NIGERIAN-VERSION-COMPREHENSIVE-RULES
- https://www.afrodraught.com/faq

No database schema or Supabase credentials changed. No production deployment done.
