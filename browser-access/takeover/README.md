# Private browser takeover

This component creates the missing human interface: a private webpage showing
pixels from the **real remote Chromium tab**, with mouse and keyboard control.
The address above the image comes from that browser. The webpage contains no
Google/Kaggle password form. When the person takes control, agent page reads and
actions pause; the person completes the real site's sign-in and explicitly
returns control after leaving the authentication page.

## Deployment requirements

A person must be able to reach the server through a private, authenticated HTTPS
route. A loopback service in this cloud is not a user-accessible sign-in link.
This code does not provision a public endpoint, a platform browser token, DNS,
TLS certificates, or native ChatGPT tools.

Account mode requires a Chromium installation that successfully starts with its
sandbox enabled and normal HTTPS verification. It uses its own private browser
profile. The current managed cloud's sandbox/trust limitations are independent
from the viewer; public preview mode refuses credential input. No authenticated
Google/Kaggle account, public relay, or remote login has been tested by this
component.

The server transiently handles input events in memory to forward them to the
browser, as a remote desktop normally does. It does not log keystrokes, request
bodies, passwords, or capabilities. Auth-screen frames are available only to the
owner capability; agent endpoints return no screenshots or DOM during takeover.
This is a custom remote desktop, not ChatGPT's platform secure credential form.
Use it only on a host you trust.

## Run on a compatible host

From the parent project directory, install `aiohttp` and the pinned Playwright
requirements, and make Chromium available. The server binds to loopback by
default:

```sh
python3 takeover/server.py serve --state takeover/.state --port 8765
```

This creates distinct random owner and agent capabilities in a mode-0600 file
inside the mode-0700 state directory. It does not print the tokens. On the same
trusted operator terminal, display the local owner link with:

```sh
python3 takeover/server.py owner-link --state takeover/.state --port 8765
```

The owner capability is an initial URL fragment, removed from browser history by
the viewer before API calls. API authentication uses HTTP Bearer headers. Never
put capabilities in URL query parameters; those requests are rejected. State and
capability files are private deployment state and must not be packaged.

For remote operation, put a trusted TLS reverse proxy in front of the loopback
service, or provide TLS certificate/key paths for direct serving. A loopback
reverse proxy must preserve the public Host and set X-Forwarded-Proto=https:

```sh
python3 takeover/server.py serve --state takeover/.state \
  --public-origin https://your-private-host.example --trust-loopback-proxy
```

The example host is a placeholder, not a deployed endpoint. Only the explicitly
configured origin is accepted. An untrusted remote client cannot assert forwarded
TLS because the proxy exception requires a loopback peer. Direct nonloopback
serving additionally requires `--tls-cert` and `--tls-key`. TLS verification in
the target browser is never disabled.

A separate optional pairing module can replace manual owner-link delivery; see
that module's own authentication and deployment requirements. Optional public-key
agent verification is supported by the `agent_verifier` factory callback. Neither
capability is enabled merely by creating this UI.

## Browser controls

Open the private owner link, choose **Take control**, then **Open Kaggle** or
**Open Kaggle sign-in**. Click the canvas to focus it and type with the keyboard;
clipboard paste forwards directly to the remote page. After signing in through
the intended site, return to Kaggle and select **Finish and return control**.
Releasing control while still on an authentication page is refused. Use a browser
with keyboard input; a mobile virtual-keyboard integration is not included.

The owner view uses a Bearer-authenticated SSE stream and a separate expiring
owner lease. No token appears in a stream URL. Owner input, frame and release
requests also require the lease header. A disconnected owner's lease eventually
expires, while authentication pages remain blocked to agent access.

## API

`create_app(browser, owner_token, agent_token, public_origin=None,
trust_loopback_proxy=False, lease_seconds=60, agent_verifier=None,
pairing_enabled=False, pairing_script=None)` accepts a small browser abstraction
and returns an aiohttp application. `app[server.SERVICE]` contains lease state.
Production defaults use `PlaywrightBrowser`; tests use `FakeBrowser`.

Owner routes: POST `/owner/acquire`, POST `/owner/release`, POST `/owner/action`,
GET `/owner/frame`, GET `/owner/stream`, GET `/owner/status`.
All require the owner Bearer capability; all except acquire/status require
`X-Owner-Lease`. Owner actions support navigation, clicks, wheel, keys, and text.

Agent routes: GET `/agent/status`, POST `/agent/action`. They require the agent
capability, or a successful optional `agent_verifier(request)` callback. Only
status remains available during an owner lease. Normal actions are bounded
Kaggle navigation, snapshots, clicks, and ordinary text entry. Cookie/storage
exports and arbitrary scripts are unavailable.

When configured, `/config` advertises only `pairing_enabled`; `/pairing.js` loads
the supplied module. The viewer calls `window.bridgePairing(callbackOwnerToken)`
when there is no owner fragment. It keeps the returned owner token only in the
viewer closure, not in storage or DOM text.

## Validation

```sh
python3 -m unittest discover -s takeover -p 'test_*.py' -v
node --check takeover/viewer.js
```

Thirteen real aiohttp HTTP/SSE tests with a fake browser passed. They exercise
role separation, lease ownership/expiry, authentication-frame protection,
credential refusal in public mode, secret redaction, origin/Host enforcement,
explicit trusted-proxy handling, and agent pause/release. These are not live
Google-login tests. No browser was started by these tests.
