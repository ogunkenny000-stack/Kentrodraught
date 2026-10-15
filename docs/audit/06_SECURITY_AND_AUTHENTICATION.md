# Security and authentication audit

Scope: local source repair and disposable tests; no production database, identity provider settings, email delivery, or deployment changed.

## Confirmed defects repaired

- The mutable profile name `kennykristkentro` granted every admin permission, even without an admins row. Authorization now uses explicit `admins.uid` grants. Initial provisioning accepts `BOOTSTRAP_ADMIN_UID`, validates it against an existing profile, and acts only when the admins table is empty. No account receives ownership by registering a name. Existing admin records are preserved; operators must review existing grants before public deployment.
- `/api/admin/simulate-ken8-batch` lacked authorization. It now requires `view_games` and an authenticated admin. Expensive engine operations remain rate limited.
- `/api/games/record` accepted arbitrary browser match results into trusted history. It now returns 403; authoritative game completion stays in server multiplayer code. Database client writes to `completed_games` are also denied by the hardening migration.
- A null `coin_wallets.ownerId` bypassed HTTP wallet privacy. Ownerless wallets now require an admin with `view_users`; authenticated strangers cannot read their history.
- Puzzle SQL uploads could fall through to arbitrary database SQL execution, reporting a fabricated fixed import count. Uploads now accept parsed puzzle rows only and report actual counts. They never execute uploaded SQL.
- Raw `X-Forwarded-For` controlled rate-limit identity. Limits now use Express's configured IP resolution/socket identity, have bounded memory, and fail closed at capacity. No proxy is implicitly trusted.
- Browser push subscriptions accepted invalid curve points and overly broad host suffixes. Validation now checks exact provider hosts/provider patterns, HTTPS port 443, canonical base64url keys, and actual P-256 curve membership. Redirects remain disabled for outbound push delivery.

## Username authentication

Public `resolve_username_to_email` execution is revoked. Server-only lookup backs `/api/auth/username-login` and `/api/auth/username-recovery`. Login returns a Supabase session only after password verification; unknown accounts, wrong passwords, and provider failures have generic failure responses. Each operation creates an isolated, nonpersistent auth client, avoiding session mutation on the shared privileged client.

Login and recovery have both IP and username limits. Recovery returns the same success body for absent accounts, errors and rate limits. Recovery redirects come exclusively from a validated configured `APP_URL` or `PUBLIC_APP_URL`. Requests cannot supply a reset destination. Without a valid configured destination the route deliberately sends no reset email. Supabase's own email/password authentication, email confirmation, session refresh and password recovery remain the identity provider's responsibility.

## Verification and limits

`src/server/adminService.test.ts` exercises immutable identity checks, malformed grants, and database failure. `src/server/coinsService.test.ts` exercises integer boundaries and failure propagation. HTTP tests in `usernameAuth.test.ts` and `securityMiddleware.test.ts` run real localhost requests, including spoofed forwarded headers, generic responses, isolated clients and redirect rejection. Push tests use real curve keys and reject off-curve input. Run `npm test` and `npm run test:database` for the complete recorded checks.

In-memory request limits are per process; deployments with multiple instances need shared limiting or edge limits. Provider calls and existence-dependent work may still have timing differences; generic response bodies are not a guarantee of constant timing. No live Supabase Auth flow or actual email/push delivery was exercised without deployment credentials. Administrator actions beyond the dedicated financial RPCs still perform audit insertion as a separate operation; a broader transactional admin action model remains future work. Security headers are installed; a strict CSP needs deployment-aware validation before rollout.
