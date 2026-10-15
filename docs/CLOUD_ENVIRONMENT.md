# Cloud development environment

Use the existing checkout at `/workspace/Kentrodraught`. This task already has an isolated environment; do not create a worktree unless the user asks. The selected GitHub source is the reviewed audit recovery branch rather than the old main-branch checkpoint.

Core prerequisites are Node 22 or newer, npm, make and a C++14 compiler. The tested cloud image has Node 24.19.0/npm 11.9.0 and g++/make. Install and verify from the checkout:

```sh
npm ci --include=dev --cache /workspace/.npm
npm run lint
npm run build
npm test
```

The install hook builds or verifies the actual native engine. Never replace the required `nd_upgraded/data/eval_nigerian` with an empty file. The standard application does not need Go, Docker, Chromium or database credentials to develop guest UI, native AI and local socket workflows. Those tools are needed for the corresponding optional audit checks.

For development, run `npm run dev`. For a production build use `npm run build` followed by `npm start`. A representative readiness check requests `/api/health`, then posts a valid 51-character Scan FEN with a small depth/time budget to `/api/engine/move` and requires a legal move with a finite score. Vite preview alone does not start the API or native service.

`KENTRO_DATA_DIR` must point to the intended writable persistent directory. Leave `SKIP_DB_MIGRATION=1` unless a reviewed database change is deliberately authorized. Configure the public browser URL/publishable key at build time and the server key in the host's secret manager only when exercising real hosted features. Consult `.env.example` and the staging requirements in `docs/audit/14_REMAINING_ISSUES.md`.

The environment configuration draft saves installation and startup instructions separately from these files. Saving a draft does not run it, restart services, publish a snapshot or verify restoration in a fresh task. Processes and authentication do not survive snapshots automatically. Review and publish through environment settings when ready; use GitHub commits/downloads for durable source backup.

Current locally verified completion also covers active-room restart, authoritative
tournament outbox/CAS and persistent groups. Optional regression entry points are
`test:restart`, `test:multiplayer`, `test:database`, `test:tournaments` and
`test:groups`. Use only disposable loopback PostgreSQL for local fixtures.
`npm start` explicitly sets production mode; the development entry stays `dev`.
For later hosted integration use `docs/SUPABASE_HANDOFF.md`, not the local Auth
fixture. Hosted tests remain PENDING until real staging bindings and acceptance.
