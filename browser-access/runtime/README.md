# Dedicated browser runtime

The minimal nonroot Docker namespace test has actually run. The full browser
image and normal Chromium HTTPS test have **not** run.

## Observed results

- The managed Docker daemon has no cached images. No image was pulled.
- A 2,365,440-byte root filesystem was assembled from already installed public
  `unshare`, `true`, and their libraries. No account/profile data was included.
- A nonroot UID1000 container under Docker's default seccomp policy received
  `Operation not permitted` for `unshare --user --map-root-user true`.
- The same test succeeded under Playwright's official **default-deny** seccomp
  profile. This profile permits the namespace creation syscalls required by its
  browser sandbox. No privileged mode, host network, or added capability was
  used. The probe containers had no network and their owned images were removed.
- The imported profile is pinned to Microsoft Playwright commit
  `b4695e3eb2e6736d1a7b1fd255c4e94f78553660`; SHA256
  `cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849`.
  `seccomp-source.json` preserves its verified HTTPS source.

See `namespace-probe.json` and `namespace-probe-playwright.json`. This proves
unprivileged user namespaces can be available to a dedicated container with the
restricted policy. It does not yet prove that Chromium starts sandboxed, that
its certificate store trusts the proxy, or that Kaggle authentication succeeds.

## Browser recipe

`Dockerfile` installs Chromium, NSS certificate tools and the pinned application
requirements into an independent nonroot image. The build needs Internet access
and disk space; it was deliberately deferred while timed engine matches run.
Resolve and use an official base image digest for a reproducible deployment.

Build context staging deliberately copies only approved application source:

```sh
python3 runtime/prepare_build_context.py --destination /tmp/kaggle-browser-build
# If the interactive service is in a separate root-level Python file, pass its
# actual filename with --extra-source. Include its dependencies in requirements.
```

On a configured Docker host, build the staged context with the provided public
CA bundle mounted as a BuildKit secret. Preserve its configured proxy and Docker
credentials. The bundle is not copied into image layers:

```sh
docker build \
  --secret id=proxy_ca,src=/etc/ssl/certs/ca-certificates.crt \
  --build-arg BASE_IMAGE=python:3.12-slim-bookworm \
  -t kaggle-browser-runtime:local /tmp/kaggle-browser-build
```

Replace the base image tag with its resolved official digest before treating a
build as reproducible. The tag above is a recipe, not a recorded tested image.

The runtime entrypoint imports a mounted **public** managed CA into only the
container user's own `/home/browser/.pki/nssdb`. It never reads or changes the
outer environment's existing private browser/NSS database. Docker supplies the
ordinary user home from `/etc/passwd`; the outer HOME variable is not changed.

An actual first browser smoke, when a CPU window is available, is:

```sh
docker volume create kaggle-browser-state
docker run --rm \
  --user browser --security-opt seccomp="$PWD/runtime/playwright-seccomp.json" \
  --shm-size=256m --memory=1g --pids-limit=256 --cpus=1 \
  --mount type=volume,src=kaggle-browser-state,dst=/browser-state \
  --mount type=bind,src="$CODEX_PROXY_CERT",dst=/run/managed-ca.pem,readonly \
  -e BROWSER_PUBLIC_CA_FILE=/run/managed-ca.pem \
  kaggle-browser-runtime:local
```

Use the managed environment's normal reachable proxy defaults. A missing or
blocked destination requires the supported network-configuration workflow;
never switch to host networking or bypass the proxy. On a regular trusted host
without that managed CA, use its appropriate public certificate configuration.

`browser_smoke.py` requires `chromium_sandbox=True`, selects the user-namespace
sandbox rather than the setuid helper, inspects `chrome://sandbox` for namespace
and seccomp protection, and then visits Kaggle with ordinary Chromium certificate
verification. It has no certificate-error or sandbox-off fallback. Its result is
written to the container state directory, including failure honestly.

The interactive service can replace the image command after this smoke passes.
A user-reachable private HTTPS ingress is independently required; a Docker
container by itself does not expose a sign-in page to the person in this chat.
