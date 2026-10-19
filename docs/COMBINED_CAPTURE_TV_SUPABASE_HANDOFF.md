# Kentro Draughts — combined capture, TV and Supabase integration handoff

Source base: uploaded `Kentrodraught-b41c8eaa5f54747e54571a7bb4e1d0fe59d32c50.zip`, preserving its recent persistent-room, tournament, group and native-engine changes.

## Added / verified

1. **Kentro TV:** the previously verified explicit 10x10 equal-size replay grid, CSS frame locking and move-by-move browser layout regression were cherry-picked without reverting any later components. The grid no longer collapses empty rows.
2. **Nigerian capture:** kept the project's free-choice capture rules and complete-sequence validation unchanged. Added the precise screenshot-based Black king 49 over White 38 fixture; both the TypeScript referee and the real rebuilt native C++ AI were tested. The engine selected a *legal capture*. Nigerian free-choice means it need not choose a particular longer continuation if a different complete capture is allowed; quiet moves remain forbidden while any capture exists.
3. **Supabase:** inspected the live `draught.com` project's metadata read-only, identified missing hosted objects and privileged function warnings, documented a staged rollout. Added a safe environment consistency preflight with five tests; **no server secret is embedded and no live schema was changed**. See `docs/SUPABASE_CONNECTION_PREFLIGHT_2026-10-15.md` and `docs/SUPABASE_HANDOFF.md`.

## Local validation (this integration turn)

- Real C++ engine: compiled with g++, performed initialization/search and selected a legal compulsory capture in the Black-49 screenshot position — passed.
- Rules: screenshot fixture confirms mandatory capture, branching complete king captures and captured-piece removal — passed via dependency-free Node checks.
- Kentro TV: isolated headless Chromium grid layout at 320/360/390/414/768 viewport widths; equal rows and fixed size with/without pieces — passed. Full app E2E remains pending.
- `scripts/audit/supabase-config-preflight.test.mjs`: 5/5 passed. This validates variable format, **not real hosted keys/auth**.
- `npm run migrations:check` — passed.
- TypeScript/TSX source syntax parsing and CSS parsing — passed; **not** equivalent to full typecheck/build.
- Full `npm ci`: blocked because npm cache lacks `zod@4.6.7` and network dependencies are unavailable in this sandbox. Full browser build, existing suite, hosted Auth/RLS, push delivery and two-device multiplayer not re-executed in this merge.

## Important production actions

Do not run `supabase/all_migrations_combined.sql`, `supabase/schema.sql` or `supabase/reset_all_data.sql` on the existing hosted project. It has user data and a schema behind this source. Clone it to staging; back up and reconcile the ordered migrations, grants, policies and missing tables before any live change. The app needs matching VITE public configuration at build time, server-only secret configuration at runtime, and SKIP_DB_MIGRATION=1. See Supabase preflight report.

## Commands

```sh
npm ci --include=dev
npm run lint
npm test
npm run build
npm run test:tv            # with Chromium and a running safe test server
npm run test:captures      # after native engine compilation
npm run test:preflight
npm run migrations:check
npm run supabase:preflight # reads deployment environment without revealing credentials
```

The compact archive excludes an optional generated documentation preview (`docs/royal-nigerian-board-preview.png`), rebuildable C++ `.o` files and compiled binaries, and an exact duplicate weights file `data/eval_nigerian`; the primary model weights `nd_upgraded/data/eval_nigerian` and full engine source are preserved. Running `npm ci` or `node scripts/build-engine.cjs` rebuilds the binary and restores the root data copy.
