# Kentro Nigerian draughts puzzle creator

A standalone **server program**. It never runs on players' phones, reads their games, or uploads user data. Node **22.13 or later** is required; Node 24 LTS is recommended. No npm installation, API key, GPU, Supabase or full app server is needed to run the bundled executable.

## Run

Extract the standalone ZIP and run:

```sh
node bin/kentro-puzzles.cjs generate --db ./puzzle-data/puzzles.sqlite --difficulty all --count 10 --seconds 3600
node bin/kentro-puzzles.cjs stats --db ./puzzle-data/puzzles.sqlite
node bin/kentro-puzzles.cjs export --db ./puzzle-data/puzzles.sqlite --out puzzles.json
node bin/kentro-puzzles.cjs verify --file puzzles.json
```

In the full repository the executable is `tools/puzzle-creator/bin/kentro-puzzles.cjs`. Rebuild from repository root with `npm run build:puzzle-creator`; run focused checks with `npm run test:puzzle-creator`.

`--count` requests that many **new** puzzles per selected tier in this run. `all` searches all tiers and export presents Easy → Medium → Hard. Generation can find tiers out of order. Higher tiers may require substantial CPU time; there is no guarantee of meeting a quota within the budget. Exit 0 means the quota was met; exit 2 means time/attempt limit or interruption left a shortfall. Previously accepted puzzles remain safely stored. Failures exit 1.

Defaults: one hour, 1,000,000 attempted positions, 100,000 search nodes and 1,500 milliseconds per candidate. Increase `--seconds`, `--nodes` and `--candidate-ms` for deeper research. Use `--difficulty easy`, `medium` or `hard` to target a tier. `--seed 123` reproduces the position stream, although time limits and an existing journal affect accepted output. SIGINT/SIGTERM finishes the current bounded candidate and closes the journal.

## What qualifies

Constructed study positions use the app's **unchanged Nigerian rules**, including free choice of capture length, complete captures, flying kings, delayed removal and promotion. They are not copied from international-draughts puzzles. Construction checks board validity, not a proof that the position arose from the standard starting array.

A puzzle needs at least two legal first moves, a quiet setup, an actual sacrifice and a multiple capture or captured king. Exact bounded AND/OR search proves a real game win against **every legal defensive reply**. It accounts for repetition/material draws. The first move must be unique at the smallest tested winning bound. A move that wins more slowly can exist: the stated objective is **win within N of your turns**, not an assertion that all other moves lose forever.

- **Easy:** forced win within two solver turns (three plies).
- **Medium:** three or four solver turns (five or seven plies), at least three legal first moves.
- **Hard:** five or six solver turns (nine or eleven plies), at least four legal first moves, at least two sacrificed pieces on the longest defense, and no immediate promotion on the setup move.

These are objective construction grades, not human-tested ratings. Hard does not guarantee every player will find a puzzle difficult. The verifier checks a saved strategy tree independently: one chosen solver move, **all** defensive choices, and a genuine win at every leaf. Export includes the complete tree and full capture paths. Timeout/node exhaustion **never** counts as a winning proof. `verify` also reruns the unique-first-move and difficulty search from scratch.

## No repeated positions

Every examined root position has a SHA-256 identity in a persistent SQLite journal. Identity ignores difficulty and proof version. A position rotated 180 degrees with colours and turn swapped has the same identity. Atomic primary keys prevent repeats across restarts and concurrent creators **using this same journal**. Keep the whole `puzzle-data` directory on persistent local storage; do not delete the journal between runs. Budget-exhausted/rejected candidates also remain registered, trading retry opportunities for no repeated work. A process interrupted after reservation can leave an examined candidate unused; it cannot publish it twice.

Separate databases on separate servers cannot coordinate uniqueness. Use one writer/journal for your puzzle library; run multiple creator processes against that journal on the same machine if desired. Do not place SQLite WAL on a network filesystem. To consolidate libraries, `import --file puzzles.json --db ...` verifies each puzzle again and ignores existing position identities. It does not retroactively prevent independent generators from trying the same position.

For backup, stop creator processes and copy the complete data directory, or use SQLite's online backup facility. Do not copy only the `.sqlite` file while WAL writes are active. Existing app/Supabase data is never modified by these commands.

## Use in Kentro

`export` produces a JSON array containing title, difficulty, FEN, solver/reply steps with full capture paths, explanations and proof metadata. Import the array through Kentro's existing admin puzzle importer. For the existing authenticated bulk API the body is `{ "puzzles": <exported array> }`; it needs your normal admin session. This tool does not automatically publish or change your live deployment. Keep the journal as the authoritative library and avoid importing the same export repeatedly into Supabase, whose existing bulk importer has no position uniqueness constraint.

The app displays the principal (longest-defense) solution. The full strategy tree remains in the export for verification; the existing app puzzle UI is not a branching analysis viewer.

## Docker

```sh
docker build -t kentro-puzzles .
docker run --rm -v "$PWD/puzzle-data:/data" kentro-puzzles generate --db /data/puzzles.sqlite --difficulty all --count 10 --seconds 3600
docker run --rm -v "$PWD/puzzle-data:/data" kentro-puzzles export --db /data/puzzles.sqlite --out /data/puzzles.json
```

In the full repository use `docker build -t kentro-puzzles tools/puzzle-creator`. A single process uses one CPU core. Choose a CPU/time budget suitable for your server. No ports or network access are required at runtime.
