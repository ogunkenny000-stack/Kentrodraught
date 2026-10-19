> **October 15 Supabase review:** See [Supabase completion and migration status](docs/SUPABASE_COMPLETION_STATUS_2026-10-15.md). The live project has schema drift; do not auto-apply combined SQL or run test fixtures on it.

---
title: Kentro Draught
emoji: 👑
colorFrom: yellow
colorTo: gray
sdk: docker
app_port: 3000
pinned: false
---

# Kentro Draughts

## Nigerian king capture upgrade (17 October 2026)

The TypeScript referee and native C++ Ken engine implement **compulsory continuation per jumped king victim**. A king cannot stop after a capture by landing on a square that avoids a further available capture behind the same victim. Different first capture opportunities remain free choices regardless of capture length (Nigerian rule 2.9).

Check both implementations on the screenshot trap and 300 seeded test positions without installing JavaScript dependencies (requires Node 22 and a C++14 compiler):

```bash
npm run build:engine
npm run test:capture-rules
npm run test:captures
```

See `docs/NIGERIAN_KING_CONTINUATION_ENGINE_2026-10-17.md` for the rule contract, example moves and limitations. No Supabase changes are part of this engine upgrade.


Nigerian Draughts with React, real-time multiplayer, a native SCAN-derived Ken
engine, tournament scheduling, persistent groups, replay/analysis and a PWA.
This source continues the owner's GitHub audit on
`codex-audit-recovery-20261014`. **Local development and staging integration are
verified within the audit's scope; hosted Supabase and production acceptance
remain pending.** No production infrastructure was modified.

Read [executed checks](docs/audit/13_TEST_RESULTS.md),
[remaining constraints](docs/audit/14_REMAINING_ISSUES.md) and the
[Supabase handoff](docs/SUPABASE_HANDOFF.md) before deployment.

## Local development

Requires Node 22 or newer, npm, make and a C++14 compiler (`g++`). Keep the
tracked `nd_upgraded/data/eval_nigerian` weights; empty/substituted data will
not produce a working native engine.

```sh
npm ci --include=dev
npm run dev
```

The lockfile install builds and search-verifies the actual native engine.
The complete server supplies HTTP, WebSocket and native search; Vite preview
alone does not provide those services. Supabase is optional for local guest
UI, Ken levels 1–3 and development socket fixtures. Hosted account/paid/social
features need the reviewed SQL and secure bindings from `.env.example`.

```sh
npm run lint
npm test
npm run migrations:check
npm run build
npm start
```

`npm start` runs the built production server. Paid AI levels are checked against
canonical account access on the server. The engine is not an offline browser
worker. Nearby can open offline after the service worker prepares it; successful
real-device pairing still depends on supported local networking/ICE.

## Supabase and hosting

For a new empty project, apply `supabase/schema.sql` once and then every ordered
migration. For an existing project, inspect/back up its current schema/data and
rehearse reviewed incremental upgrades in staging. The base schema alone is not
a complete secured installation. Keep startup migrations disabled with
`SKIP_DB_MIGRATION=1`; see [migration and rollback instructions](docs/SUPABASE_HANDOFF.md).

Browser build values `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` are public.
Server `SUPABASE_SECRET_KEY`, optional TURN secret and VAPID keys belong only in
runtime secret settings. Never compile private provider/server keys into `VITE_*`.
See `.env.example`; no working secrets or runtime user data are included.

The multi-stage Dockerfile builds native/client/server code and runs as UID 1000.
Compose persists `/app/data`, enables an init process and a ten-second stop grace
period. Set `APP_URL` to the deployed HTTPS origin for account recovery. Use a
WebSocket-capable persistent host and exactly one Node authority per data directory.

Live rooms and the tournament outbox now recover from private atomic snapshots.
Clocks freeze during outages, with roughly one-second crash checkpoint tolerance.
This is single-writer recovery; horizontal replicas need shared authority/storage.
Do not delete persistent volumes on ordinary redeploy or rollback.

## Integration and audit

`scripts/audit/local-regression.sh` runs core checks and optional disposable local
PostgreSQL tests. Additional commands include `test:database`, `test:tournaments`,
`test:restart`, `test:multiplayer`, `test:groups`, browser/TV/offline and container
smokes. Browser commands require Chromium. The local database harness refuses
non-loopback targets and creates/drops its own fixture database.

`npm run test:hosted` is a separate opt-in disposable staging suite; missing
bindings report PENDING and exit 2. Its template is
`supabase/.env.staging-test.example`. Local synthetic Auth claims never establish
that hosted Auth, PostgREST or Realtime passed.

The [16 audit reports](docs/audit/README.md) include evidence, operating limits
and release gates. [Cloud setup](docs/CLOUD_ENVIRONMENT.md),
[optional Go edge](PERFORMANCE_UPGRADE.md),
[performance notes](MAX_PERFORMANCE_README.md) and
[deployment/rollback](docs/audit/15_DEPLOYMENT_AND_ROLLBACK.md) provide more context.
Prefer current audit evidence when older performance documents describe earlier
checkpoints. Save/download the reviewed branch or exact Git commit archive from
GitHub so source delivery does not depend on a temporary workspace attachment.

The archive includes `SOURCE_MANIFEST.sha256`. From the extracted root, run
`sha256sum --check SOURCE_MANIFEST.sha256` to verify the packaged source bytes.
The manifest excludes itself; never edit files before checking it.


Latest merge handoff: `docs/COMBINED_CAPTURE_TV_SUPABASE_HANDOFF.md`. The live Supabase project was inspected read-only; migrations are **not** applied.


Latest merge handoff: `docs/COMBINED_CAPTURE_TV_SUPABASE_HANDOFF.md`. The live Supabase project was inspected read-only; migrations are **not** applied.
