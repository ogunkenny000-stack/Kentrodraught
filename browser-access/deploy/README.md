# Ephemeral GitHub-hosted browser

This is a deployment recipe, not an already running sign-in page. It has not
connected a Kaggle account or verified GitHub Actions workflow write permission.
The hosted browser is a custom remote desktop, not ChatGPT's native secure form.

The user opens the HTTPS viewer, shares its public pairing fingerprint, and enters
credentials in the real browser canvas after the agent approves that fingerprint.
Account inputs are transient owner-channel messages; the agent cannot read the
sign-in page or operate the browser during human control. The server remains part
of the trusted remote-desktop system. Never enter credentials until the browser
reports sandbox and TLS checks passed.

## Layout and launch

Use a dedicated `tools/kaggle-browser-access-*` branch in the user's repository.
Copy the reviewed project into `browser-access/`, excluding all state, profiles,
probe/artifact directories, Python caches, private keys, and generated output.
Copy `deploy/kaggle-browser.yml` into `.github/workflows/kaggle-browser.yml`.
Generate the Ed25519 key on the agent machine with `takeover/remote_client.py
keygen`; only its public PEM belongs at `browser-access/deploy/agent-public.pem`.
The private key stays in a mode-0600 local file. Never publish it or tokens.

Pushing the workflow/source branch requests one GitHub Actions run. GitHub may
require workflow permission, Actions enablement, or account/billing approval.
Respect any rejection. No Kaggle or Google credentials are required in GitHub
secrets. An official checkout action is pinned by commit; images are pinned to
linux/amd64 manifest digests recorded in the accompanying manifest files.

The Ubuntu22 runner avoids the newer host's default AppArmor restriction on
unprivileged user namespaces, without changing host kernel controls. The job
builds the dedicated nonroot image with normal CA verification and no
browser-state build context. It tests Chromium's namespace and seccomp sandbox
and a real verified HTTPS Kaggle response. On failure it stops without enabling
an insecure fallback. It then starts an official Cloudflare Quick Tunnel sidecar
in the browser container's network namespace. No host port is published; the
application binds only to that namespace's loopback address.

Once the public HTTPS health endpoint succeeds, `.browser-access/session.json`
is committed to the same branch. This contains public URL, source commit, run
identifier, expiry, state and agent-public-key fingerprint only. The metadata
path is outside the workflow's push path filter, so publishing it does not
create a run loop. Contents-write permission is used for this public file.

The browser lasts at most two hours after readiness; the workflow has a
150-minute overall build/run ceiling. Containers have no persistent profile
mount. Cleanup removes this run's two named containers and its local image;
GitHub also discards the hosted runner. Do not rely on login persistence.
Cloudflare Quick Tunnels provide no availability promise and do not support
server-sent events; the viewer must use its authenticated frame-polling transport.

## Connecting from the managed cloud

The agent reads the public session metadata through its existing authorized Git
connection. It must then obtain normal approved HTTP access to the exact HTTPS
tunnel hostname through environment settings. The current managed cloud has no
direct user-facing port, and this kit does not bypass its proxy or network policy.
The local remote client uses inherited proxy settings and verified HTTPS, and
signs requests with its private Ed25519 key. Public metadata/key fingerprints and
human confirmation authenticate pairing; no secret URL is sent through chat.

If the workflow is cancelled, a stale metadata file can briefly remain `ready`;
clients must enforce `expires_at` and live health. Cancel the Actions run to stop
the remote browser early. Do not publish browser logs, session artifacts, cookies,
profile directories, screenshots of sign-in pages, or arbitrary request bodies.
During operation both owned containers are checked and public HTTPS health is
polled every fifteen seconds. Three consecutive failed polls stop the session
even when a detached browser server has crashed inside an otherwise live container.

## Checks

Run `python -m unittest discover -s deploy -p 'test_*.py'` from this project's root.
These tests use mocks and inspect deployment arguments; they do not establish
that a public tunnel, Actions permission, real browser login, or Kaggle account
access works. The real browser/TLS smoke runs only during an actual deployment.
