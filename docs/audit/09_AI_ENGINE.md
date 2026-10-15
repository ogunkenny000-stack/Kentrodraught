# AI engine audit — 15 October 2026

The web application's Ken AI uses the shipped SCAN-derived C++ engine through
the Node server's `/api/engine/move` endpoint. It requires that server; this
checkout does not contain the offline browser AI worker described by an older
README. No playing-strength, Elo or training improvement is claimed.

## Verified structure and repairs

| Component | Findings |
| --- | --- |
| Generator | Native bitboard generator with Nigerian free-choice captures; repaired landing-specific continuation and move-list overflow/sentinel errors |
| Search | Iterative deepening, alpha-beta/PVS, quiescence, move ordering, transposition caching and late move reductions in `search.cpp` |
| Evaluation | Shipped pattern weights plus existing positional terms; a separate simpler PST evaluator remains configured for levels 1–4 |
| Evaluator changes | Clear the native transposition table when the persistent HUB process changes between PST and pattern; otherwise an earlier difficulty's scores can be reused by the new evaluator |
| Hash/table | Piece/turn keys; clustered four-entry replacement with depth and age. `scan.ini` uses one thread and `tt-size=24`, meaning 2²⁴ entries × 16 bytes = 256 MiB for the table |
| Endgames | Node history now handles 10/32/50-ply draw counts; a current FEN alone has no prior-game counters |
| Process | One long-lived HUB process in `src/server/nativeEngine.ts`, initialized once, serialized through `engineMutex.ts`; completed-result caches and in-flight coalescing reduce duplicate work |
| Pressure/cancellation | Bounded queues (128 high priority, 32 low priority); superseded/disconnected waiting promises reject, active requests receive `stop`, and the lock transfers after release. Browser tabs have separate cancellation namespaces; unrelated streams cannot cancel each other through shared in-flight results |
| Time/depth | Public requests cap time at 5 seconds and depth at 99. Every search explicitly sets depth so easy-level state cannot constrain a later time-controlled search |
| Invalid input | Exact dense FEN validation, integer depth validation and bounded cancellation keys prevent HUB command injection through these fields |
| Invalid output | Both server and browser match parsed engine choices to their canonical legal list and require a finite score. HUB `go analyze` obtains a real evaluation even for forced choices that `go think` can return without an `info` record |
| Lifecycle | Initialization has a 15-second limit; child exit, stdin errors, malformed output and search timeout reject the current request and retire the process. A later request can start a fresh child. Shutdown aborts queued work and waits for native exit, escalating termination after 500 ms |
| Game reviews | Replay starts from recorded custom board/first mover, validates every move, and shares classification with browser reviews. Engine failure leaves the review pending; unavailable searches are never saved as invented zero scores |
| Native build | Source/configuration/weights/build-script/platform/compiler fingerprints and a binary digest prevent reuse of a previously built executable after relevant edits; initialization and a real search must also succeed |

The 128-entry inline move list remains allocation-free for ordinary positions;
unusually large lists use geometric vector growth. Copying preserves scores,
and sorting has dedicated sentinel capacity. These are correctness and memory
safety repairs, not an asserted search-speed optimization.

Evaluator contamination was reproduced before the repair on the ordinary
opening at depth 8. A cold PST search reported score 0.01 after 32,860 nodes;
switching to pattern reused that score after only 286 nodes. Clearing the table
first produced a pattern score of 0.00 after 36,252 nodes and a different move.
Switching back reused the pattern score. The real-HUB regression compares fresh
search work against cached repeats across both switches; it failed against the
old executable before rebuilding the repair.

`scripts/build-engine.cjs` is the supported build path on Linux/macOS. Its
compiler flags avoid CPU-specific `-march=native`, force recompilation when
needed, retain the supplied evaluation weights, and never silently substitute
a weaker engine. The ignored `data/engine-build.json` records build provenance.
Direct legacy Makefiles still have different flags. Windows requires the
documented container or WSL path and was not tested here.

## Executed checks

```bash
NATIVE_RULES_SANITIZE=1 npx vitest run src/rules.audit.test.ts src/nativeRules.audit.test.ts src/engineBuild.audit.test.ts
# 39 tests passed; temporary native probe uses address/undefined sanitizers

npx vitest run src/rules.test.ts src/rules.regression.test.ts src/server/engineRequest.test.ts
# 62 tests passed, including native choices over five 20-ply games

node --experimental-strip-types scripts/engine-mutex-smoke.mjs
# cancellation, queue bounds, priority and idempotent release: PASS

npx vitest run src/server/nativeEngine.test.ts src/server/nativeEngine.integration.test.ts src/lib/kenEngine.test.ts src/lib/analysis.test.ts
# 4 files, 45 tests passed; lifecycle fixtures plus actual opening/forced capture/king/endgame searches

ENGINE_AUDIT_URL=http://127.0.0.1:8141 node scripts/audit/engine-http.mjs
# Actual current-source local HTTP server: PASS (no hosted credentials)

node --experimental-strip-types scripts/engine-benchmark.mjs 0.1
# Historical checkpoint benchmark below; not rerun for the HTTP lifecycle changes
```

The native probe checks every legal choice in 300 seeded mixed positions,
ordinary-start playout positions, a 154-choice stress position, draw histories
and list boundary operations. Sanitizers cover this generator/adjudicator
probe, not the complete optimized search process. The fingerprint regression
mutates source, header, makefile, weights, configuration, build-script and
executable inputs in a temporary directory and verifies freshness changes.
The current source/binary fingerprint check returned `fresh: true`. The HTTP
check covered native score delivery, malformed-FEN rejection, terminal loss,
cached-position supersession, client-disconnect queue recovery, and subsequent
health ping. It uses unique streams and refuses external targets; run it only
against an isolated local fixture server because it deliberately starts searches.

## Reproducible measurement

The previously saved [engine-benchmark.json](engine-benchmark.json) records a Linux x64 run
with full pattern evaluation, depth limit 8 and a nominal 0.1-second budget.
Each case clears the transposition table. Elapsed times include HUB traffic and
that table clear, and forced moves may return without searching. The benchmark
validates each returned choice against the complete canonical TypeScript list.
Zero depth/nodes for the forced move are the script's defaults when the engine
returns a choice without an `info` record.

That benchmark talks directly to `go think`. The repaired HTTP bridge uses
`go analyze` and verifies an actual finite evaluation, so these saved timings
do not describe the current forced-move HTTP path.

| Position | Legal choices | Elapsed ms | Reported depth | Reported nodes |
| --- | ---: | ---: | ---: | ---: |
| Ordinary opening | 9 | 52.92 | 8 | 23,321 |
| Free-choice king | 4 | 50.92 | 8 | 1,840 |
| Forced looping man capture | 1 | 45.98 | 0 | 0 |
| Uncounted lone-king position | 16 | 48.25 | 8 | 276 |
| Free-choice stress position | 154 | 72.70 | 8 | 132,571 |

Initialization took 234.43 ms in this saved run.
[engine-benchmark-resources.json](engine-benchmark-resources.json) records the
Node benchmark and reaped native child: 0.627 seconds wall time, 0.536 user CPU
seconds, 0.145 system CPU seconds and a maximum resident set of 306,576 KiB.
Linux child-process accounting supplies these resource values; they are not
continuous memory or concurrent-server measurements.

Timing varied across repeated runs: an earlier same-configuration stress case
took 173.21 ms and initialization 824 ms. This machine was shared with other
audit work. No controlled original-code baseline or hot-path sampling profile
was captured, so these values support reproducibility and sizing, not a claimed
before/after speedup or latency guarantee. Native time limits are cooperative;
the server additionally sends `stop` at the budget and kills a stuck search
after budget + 2.5 seconds.

## Remaining limits

- The public engine endpoint accepts depth/time/evaluator parameters without
  enforcing account-specific purchased difficulty entitlements. Browser level
  locks are advisory. Product authorization needs a defined server-side level
  contract before it can protect paid levels.
- API searches receive FEN only. Actual game repetition and elapsed draw counts
  stay with the full-history web/room adjudicators; search cannot infer them
  from a bare board. Native game termination uses threefold repetition while
  the existing search uses a twofold repetition cutoff as a search heuristic.
- HTTP caches include position and search options; native table keys encode the
  board and side to move, with invalidation on evaluator changes. Neither carries
  the full actual game history. This limits analysis of historical draws;
  authoritative room adjudication uses its retained history.
- Queue bounds and request rate limits bound individual admission; they do not
  establish production throughput or prevent a distributed caller from keeping
  the single search process busy. Waiting low-priority work can be delayed by
  sustained high-priority traffic.
- Standalone queue smoke verifies promise settlement and stop hooks. Full
  transport disconnect, process-crash/restart, long-running load and memory
  stability require further integration/load evidence; they are not established
  by the five-position benchmark.
- The shipped evaluation is pattern/PST based. No NNUE implementation, training
  validation, match-based strength calibration or measured Elo was established.
  Difficulty names such as Grandmaster are product labels.
- Other native variants and the separate Kivy interface were not validated.
  Sampled move agreement cannot establish that every possible search output is
  legal; the browser's canonical validation remains essential.
