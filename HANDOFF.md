# Kentrodraught: handoff to the Kaggle-enabled ChatGPT conversation

Latest user instruction: move this work to another ChatGPT conversation that already has Kaggle browser access. This handoff supersedes earlier instructions to keep local compute running or to construct a browser bridge. Do not resume the browser bridge, copy account sessions, or ask for credentials in chat.

## Copy this message into the new conversation

> Continue my Kentrodraught Nigerian draughts project using your Kaggle browser access. Read HANDOFF.md and verify the supplied checksums first. Preserve the original C++ engine rules. Improve the existing Rust evaluator and search without weakening the opponent. Numerical training must remain in Rust; Python may coordinate jobs and audit fixed predictions. The target is at least seven actual wins in ten fresh color-balanced games against unchanged C++, at 1.0 second per move and one engine thread. Rule draws and move-limit cutoffs are not wins. Keep failed results and never replay a completed match block as if it were fresh. Use secure account sign-in through your available browser tools if required. Do not claim Kaggle execution or a 70% win rate until you have verified the evidence.

## Verified checkpoint

- Original C++ Nigerian rules, including its flying-king capture continuation behavior, remain authoritative.
- Thirteen warm-training rounds are complete. The controller exited normally at a completed round boundary; local training is paused for this transfer.
- Best retained model under the OLD qualification policy: warm-learning/round-012. Its model SHA-256 is `07002b819ddc3dbef3ddf003bd41587475cee5fddb257df2f73cbad517cf2aae`.
- That model's original Linux binary SHA-256 is `1593f67bd0c158ef7ba4dbb9541eec93944ad7a8427f0c391090fe3c4e0bc26b`.
- Its fresh 10-game confirmation: **0 wins, 0 losses, 9 rule draws, 1 move-limit cutoff**. Primary: **2W/0L/17 rule draws/1 cutoff in 20 games**, versus control 0W/0L/19 rule draws/1 cutoff.
- Defense: 19 losses/40 versus the control's 17. It qualified only because the old policy allowed up to four additional losses. Do not describe it as uniformly stronger or as meeting the new stricter defense policy.
- Seven wins in ten has NOT been achieved. Round 6 had seven primary wins in TWENTY games; its separate fresh ten-game confirmation was 2W/2L/5 rule draws/1 cutoff.
- Latest prepared data: 22,000 full-material games (10,000 original +12,000 new), plus the separate 500-game handicap curriculum. The native corpus has 2,794,256 weighted records. These are positions/records, not additional games.
- Round 13's four native Rust warm fits completed and ALL were ineligible. Repeating that exact model/data/seeds is reproduction, not new learning progress.
- Rust warm-start implementation previously passed 23 Rust tests and Clippy. Original engine integration checks and all 359 tactical/middlegame/king certificates passed for adopted models. Preserve and rerun appropriate checks for newly built artifacts.

## Files

1. `Kentrodraught-Kaggle-Starter.zip`: small, portable package containing the exact champion source/model, original C++ source, latest exported native corpus and true-outcome sidecar, native Rust trainer, portable training/audit launcher, notebook, and compact evidence. This is sufficient for baseline reproduction and further weight fitting after you register a genuinely new experiment. It is not the full historical cloud filesystem.
2. `Kentrodraught-Research-Checkpoint.zip`: optional larger research package with all 22,000 full-material game archives, the 500-game curriculum, latest dense/long-TD data, selected source/provenance dependencies, original validation helpers, and the prepared deep-conversion experiment. Old Cargo build caches, browser profiles and credentials are excluded. Extracted paths preserve the historical `workspace/rust-draughts` layout. Inspect its inventory and migration notes rather than blindly resuming old absolute commands.
3. `SHA256SUMS.txt`: hashes of the downloadable archives and this handoff.

## Next actual improvement experiment

Repeated static-core bootstraps produced little repeatable conversion gain despite improved offline loss. The next experiment is native Rust deep-search teaching on missed promotion/king conversions, followed by weight fine-tuning from the current qualified champion.

Prepared source is under `strength-v05/king-curriculum/broad-strength/nnue/conversion-teaching-20261025b`. It must be reviewed and tested in Kaggle before production. Select up to512 quiet TRAIN-only roots from known Rust draws/losses where recorded mover evaluation was at least0.75men; balance king-use/near-crown, at most2roots/game, at least256games if512available. Exclude held-out placement/color orbits and every recorded live/tactical board. Freeze actual feasibility rather than filling from held-out games or relaxing rules.

Search512roots at16seconds with the current qualified Rust engine; re-search64largest static/deep disagreements at32seconds. Preserve full legal history and identify results by archiveSHA+ply+fullhistorySHA+teachercontextSHA. Use past positions only in Search::run, not the current root as an extra repetition. Clear search state per root.

Replace only sparse TRAIN TD bootstrap values and retrace affected TRAIN games. Preserve actual terminal outcomes, zero-MC-weight unknown cutoffs, original direct static prior, all sample weights/core logits/features/order and EVERY held-out array. Byte/array audit the export. Replay prior accepted deep bootstrap overrides in later rounds so they are not forgotten.

Fit in Rust using exact current champion initialization and fresh Adam state; preserve epoch000 exact model bytes. The established four trials are seeds173/997 × anchors0.02/0.1,12epochs, batch256, lr0.003, L2 1e-5, gradient clip10,32hiddenunits, correction cap500 internal, groupmix0.7/0.2/0.1, active-anchor RMS<=150. New changes to these require explicit preregistration before looking at results. A checkpoint must improve held-out primary BCE and true known-outcome BCE versus the initializer AND frozen core before engine checks.

Then test exact compiled/native parity, unchanged rules, all359certificates, fresh paired primary/control20games, defense40perengine, fresh10C++confirmation and10publishedRust regressions. The NEW adoption policy additionally requires no more defense losses, no fewer proven nonlosses, no more unknown results, and a positive fresh confirmation net score. Save this extra acceptance decision separately; do not rewrite old validation evidence.

Use unique fresh match seeds;2056800000+round*100 was proposed for the next campaign but check existing reservations before registering. Only an accepted model with>=7actualwins in exactly10fresh C++confirmation games meets the target.

## Kaggle and portability

The supplied trainer runs on CPUs. Selecting a GPU/TPU in Kaggle does not automatically accelerate this native Rust executable. Do not claim TPU/GPU training without implementing and verifying an actual accelerator backend. Python launchers do not update weights. The starter notebook identifies available CPU affinity rather than assuming CPUs0-3 exist.

Kaggle uses `/kaggle/working` and `/kaggle/input`, different Python/toolchain paths, possibly a different CPU ISA, and a different Rust installation. The stable portable starter uses relative paths. Legacy full-research scripts retain historical absolute paths and frozen hashes; adapt a NEW copy with recorded changes and fresh registration before production, preserving originals. Linux evidence binaries may need rebuilding from their exact sources; rebuild both Rust and original C++ fairly, freeze the new hashes, validate rules/evaluations, and register fresh games. Never silently weaken C++, substitute an old model, or disable a guard to make an old absolute command run.

The prior two-hour limit was explicitly replaced by authorization to continue beyond two hours until stopped. This transfer itself does not start Kaggle computation. Retain checkpoints and executed notebooks, export outputs, and report actual resource use and results.

No Kaggle account was connected in this cloud session. The new conversation must use its own available browser tools and secure sign-in flow. These files contain code/data, not account access.
