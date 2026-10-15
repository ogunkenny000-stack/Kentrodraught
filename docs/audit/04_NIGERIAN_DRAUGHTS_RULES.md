# Nigerian Draughts rules audit — 15 October 2026

Scope: the web application, authoritative online rooms, nearby rules module, and
the native Nigerian variant. The intended rule set was established from the
existing `src/gameLogic.ts` adjudicator and rule comments, the existing rule
tests, and `nd_upgraded/README.md`'s explicit free-choice rule 2.9. The credited
Drafts Techniques Company manual is not included, so this is verification of the
project's established rules, not independent certification against that manual.

## Established behavior

| Area | Intended and tested behavior |
| --- | --- |
| Board | 10×10, 50 playable squares; Nigerian squares 1–50 map bijectively to engine squares by reversing each group of five |
| Start | Twenty men per side; White moves first from the ordinary start |
| Men | One square diagonally forward quietly; capture forward or backward |
| Kings | Slide along clear diagonals; jump an enemy and choose an empty landing beyond it |
| Capture obligation | If a capture exists, quiet moves are unavailable |
| Free choice | Different complete capture lengths remain legal; there is no maximum-capture obligation |
| Continuation | A selected landing must continue if another capture is possible there; a different terminal landing may still end the move |
| Delayed removal | Captured enemies block later rays until the whole chain ends; no victim may be captured twice; the origin is vacated |
| Promotion | Crown only when the completed move ends on the promotion row; a man passing through and leaving that row remains a man |
| Win | A side with no legal move loses, including capture-out and blocking; this takes priority over draws |
| Repetition | Three occurrences of the same board and side to move draw |
| King count | Fifty consecutive capture-free king plies draw; a man move or capture resets this count |
| Lone king vs three | When the opponent has exactly three pieces including a king, the unchanged composition must persist for 32 plies |
| Lone king vs ≤two | When the opponent has at most two pieces including a king, the unchanged composition must persist for 10 plies |

The material counters include quiet man moves on the stronger side. Captures or
promotions that change the composition restart the count. A bare imported
position starts with no historical count and is not an immediate material draw.

## Confirmed defects and repairs

| Defect | Repair and regression evidence |
| --- | --- |
| Native king generation discarded terminal landings when another landing behind the same victim could continue | Test continuation separately for each landing. With White king 34 and Black men 1, 8, 28, 36, the four legal choices end on 4, 6, 12, 41; the short terminal choices 6 and 12 remain legal |
| Free-choice capture lists could exceed the native 128-move array | Retain inline storage for ordinary positions and grow overflow storage. A crafted position has 154 legal choices in both implementations |
| Native sorting wrote its sentinel beyond the score array at exactly 128 entries | Reserve an extra sentinel slot in inline and overflow score storage; exercise sorting, copying, clearing and reuse at 128, 129, 154 and 512 entries under sanitizers |
| Native lone-king positions ended immediately, ignoring elapsed moves and the opponent's king requirement | Move adjudication to historical `Node` counters with 10/32/50-ply thresholds and win priority |
| Local custom-position adjudication reconstructed history from the ordinary start | Allow the real initial board and first mover in `checkGameEnd`; the app now supplies both |
| Dense FEN import accepted malformed input | Require a side-to-move character and exactly 50 valid square characters before conversion |

These repairs preserve the existing free-choice and delayed-promotion rules.
They do not impose the international maximum-capture rule.

## Executed evidence

```bash
NATIVE_RULES_SANITIZE=1 npx vitest run src/rules.audit.test.ts src/nativeRules.audit.test.ts src/engineBuild.audit.test.ts
# 3 files, 39 tests passed; AddressSanitizer + UndefinedBehaviorSanitizer

npx vitest run src/rules.test.ts src/rules.regression.test.ts src/server/engineRequest.test.ts
# 3 files, 62 tests passed
```

The native audit compiles the actual C++ generator/adjudicator into an isolated
temporary probe. It compares every generated move against TypeScript for 300
seeded mixed-man/king positions across both turns and every position of a
100-ply deterministic ordinary-start playout. It also checks concrete short and
long capture choices, the 154-choice position, list boundaries, and all prefixes
of four legal draw histories through their exact 10/32/50-ply boundaries.

`src/rules.fixtures.ts` builds each history through legal moves; it does not
forge moves to reach a counter. Browser/server parity tests compare
`checkGameEnd` with `checkGameEndFrom` at every history prefix, both from White's
start and a rotated, recolored Black start. Existing tests additionally exercise
40 seeded games, promotion/material invariants, origin-returning man captures,
king chains crossing the vacated origin, full-token notation rejection, puzzle
validation and native search choices over five 20-ply games.

The room handler validates claimed from/to/captured squares against the shared
legal move list before applying its canonical move. This shares one validator
between browser and server; the handcrafted expected results provide a separate
check on several important rule cases. Multiplayer authorization, sequence and
clock evidence is recorded in [05_ONLINE_MULTIPLAYER.md](05_ONLINE_MULTIPLAYER.md).

## Limits and remaining risks

- Random sampling and parity do not prove legality for every reachable board.
  The suites cover selected independent expected positions and a bounded sample.
- The engine HTTP API sends a current FEN without prior moves. Native search
  counts forward from that root; web/room adjudicators retain the full actual
  game history and remain responsible for historical draws.
- `checkGameEnd` replays history that callers have already validated;
  `applyMove` is not a standalone untrusted-move validator.
- `src/server/gameEnd.ts` still duplicates adjudication. Prefix parity tests
  reduce drift risk; future rule changes must update both paths.
- Deprecated `checkDrawRule` still implements an immediate material-only check
  but has no application call sites. The separate legacy Kivy program
  `nd_upgraded/nigerian_draughts.py` also retains immediate draw behavior and was
  not repaired or run as part of the web workflow.
- Original standalone engine documentation describes simplified immediate
  draws; the move-counted web behavior and regression fixtures above are the
  audited contract. The original external manual remains unavailable.
- Real-device interaction and physical nearby pairing require the separate
  browser/device evidence; rules tests alone do not establish that experience.
