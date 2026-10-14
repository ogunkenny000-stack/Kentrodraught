# Kentro Draughts — Codex Ready (<10 MB)

This is the full Kentro Draughts **source** package, with all application source code, frontend visuals, original evaluation weights, migrations, tests, package lockfiles, engine C++ source and Go files retained.

## Removed only redundant or rebuildable large files

1. `nd_upgraded.zip` — duplicate full engine archive (removed in the previous Codex package; unpacked `nd_upgraded/` source is present).
2. `data/eval_nigerian` — duplicate 8.5 MB evaluation weights. The identical original is retained at `nd_upgraded/data/eval_nigerian`. `scripts/build-engine.cjs` **copies it back** during normal `npm install` (postinstall), `npm run build:engine`, or `npm run build` (prebuild).
3. `nd_upgraded/scan_nigerian` — compiled Linux engine executable, not source. It is **rebuilt from retained C++ source** for the target operating system when building. The removed Linux binary would not run natively on macOS.

No gameplay rules, user interface code, project source files, lockfiles, database migrations, runtime images, or evaluation weights were discarded. No application source was altered for compression.

## Codex first commands

Open a terminal in `kentro-draughts/`:

```sh
node --version
npm ci
npm run lint
npm run build
npm test
```

Requirements: Node.js 22; on Mac, Xcode command line tools (`xcode-select --install`) for the C++ engine. For Linux, install a C++14 compiler and `make`. The first install/build compiles the native engine and restores `data/eval_nigerian`; that is expected. Alternatively use the included Dockerfile on a compatible Docker host.

**Important:** The file `nd_upgraded/data/eval_nigerian` is the actual engine evaluation weights (8.5 MB), not an expendable generated asset. Do **not** delete it. Some tests require building the engine first. Use development/test infrastructure for databases and hosting; don't deploy or alter production without permission.

## Verification

The package has been checked against the preceding under-19-MB release. All other archived file bytes remain identical except this handoff note. ZIP CRC/integrity check passed. That is not a full build or deployment verification.
