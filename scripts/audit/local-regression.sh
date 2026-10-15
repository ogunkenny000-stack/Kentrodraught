#!/usr/bin/env bash
# Core local regression; no hosted secrets or infrastructure writes.
set -euo pipefail
cd "$(dirname "$0")/../.."
npm run lint
npm test
npm run migrations:check
npm run build
npm run test:multiplayer
npm run test:restart
if [ -n "${AUDIT_PG_URL:-}" ]; then
  npm run test:database
  npm run test:tournaments
else
  printf '%s\n' 'PENDING: disposable PostgreSQL checks; set AUDIT_PG_URL to a loopback test database.'
fi
