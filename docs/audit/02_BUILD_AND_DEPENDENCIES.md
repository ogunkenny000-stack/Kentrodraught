# Build and dependencies — 15 October 2026

The resumed audit starts from GitHub checkpoint `35bed25`. That checkpoint's
401-test, type-check and production-build results are historical evidence; the
new validation report records checks after the current repairs.

## Reproducible development setup

Use Node 22 or 24, npm, make and a C++14 compiler on Linux. The current cloud
workspace uses Node 24.19.0/npm 11.9.0. Run `npm ci` at the repository root.
The installation hook builds and search-tests the actual native engine.
Run `npm run dev` for the full application; Vite preview alone does not provide
the HTTP APIs, WebSockets or native AI service.

`npm run lint` runs TypeScript checking. `npm test` runs Vitest. `npm run build`
verifies/builds the native engine, builds Vite assets, injects the service-worker
precache, generates compressed assets and bundles the Node server.
`npm start` then runs `dist/server.cjs` and explicitly sets production mode,
including when the shell has no NODE_ENV binding. Large-chunk warnings remain relevant
to mobile initial downloads; a successful build does not remove that cost.

Native build fingerprints cover source, headers, makefiles, configuration,
weights, build-script contents and binary identity. Existing binaries must
initialize and complete a real search before reuse. The shipped
`nd_upgraded/data/eval_nigerian` is required and must remain in source archives.
Generated mutable `/data/` is ignored at the repository root; nested native
evaluation data is included. Windows users should use WSL or Docker.

## Optional Go edge

The standard application runs without Go. To evaluate the optional edge, use a
real Go compiler at least version 1.23, then run `npm run test:edge` and
`npm run build:edge`. A command named `go` in this cloud image is a board game,
so the audit downloaded Go 1.27.2 from go.dev and verified its archive size and
published SHA256 before extraction. It used writable `GOCACHE` and `GOPATH`.
No downloaded checksum or TLS verification was bypassed.

Fresh `go test -race ./...`, `go vet ./...` and a stripped Go build passed after
the static-file repairs. Go is an optional network proxy; it does not replace
Node room authority or the native engine.

## Dependency handling

The root audit maintains `package.json` and its npm lockfile together, replaces
the vulnerable browser-download dependency chain with compatible tooling and
checks a clean frozen-lock install. The consolidated validation report records
the final advisory counts and commands. Scanner results are dated evidence,
not proof that unknown vulnerabilities are absent. Neither `npm audit fix
--force` nor disabled TLS is part of the setup.

Container installation uses `npm ci --ignore-scripts --strict-ssl=true`; the
normal build step subsequently compiles and search-tests the native engine.
The runtime contains production dependencies and built assets rather than
compiler, Vite or development-test packages. A managed-network CA may be
provided to the dependency-install layer through the Docker BuildKit secret
`proxy_ca`; it is not copied into the final image.

See [deployment and rollback](15_DEPLOYMENT_AND_ROLLBACK.md) for environment
bindings and persistent storage. Hosted Supabase migration and authentication
acceptance remain separate staging work.
