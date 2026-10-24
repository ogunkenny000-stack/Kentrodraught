# Browser transport audit

This audit checks the current runtime without reading browser profiles, cookies,
credentials, or private runtime state. It does not change network policy or
launch an Internet tunnel.

## Observed capabilities

The callable tool catalog currently exposes shell execution and cloud environment
configuration/diagnostics. It has no browser automation, secure sign-in,
port-forward, or web-preview tool. The environment reports no configured
capabilities, no VPN, and no arbitrary TCP grants. Its HTTP egress policy permits
Kaggle, Google sign-in hosts, and package-manager destinations through the
inherited proxy.

Chromium and Playwright are installed. Browser-runtime assets are also installed:

- `/opt/codex/browser-runtime/entrypoint.sh`
- `/usr/local/bin/cloud-agent-browser-runtime`
- `/opt/codex/cua_node/bin/node_repl`

The entrypoint normally runs `cloud-agent-browser-runtime activate` unless
`CODEX_BROWSER_DEFER_ACTIVATION` requests deferred activation. That variable is
present in this runtime. The documented CLI usage is:

```
cloud-agent-browser-runtime [activate|ensure|show|serve LOCK_FD]
```

The parent implementation checked the launcher and received the explicit error:
`Orbit OS browser launcher requires ORBIT_OS=true and BROWSER_HEADLESS=false`.
The present runtime does not satisfy that platform prerequisite. Do not change
platform feature flags to impersonate an Orbit context. Installed assets alone
do not supply a usable native browser, human view, secure credential form, or new
callable tools. This audit did not activate the runtime.

## Human sign-in requirement

A cloud-only browser controller can open a public Kaggle page. It also needs a
supported, authenticated user-view route before the user can interactively sign
in. Serving a loopback HTTP page in the workspace does not create that route.
No externally reachable user-view URL or platform forwarding capability was
established by this audit. Do not present a localhost link as a working cloud
sign-in link.

If the installed browser runtime exposes a published browser API and user view
after normal activation, use those. If it does not, the concrete missing piece
is a platform-provided browser view or explicitly configured authenticated port
forwarding. A local headful browser can provide a human sign-in window on the
user's own machine, but remote agent control still requires a separate supported
connection; local startup alone does not connect it to this chat.

## Credential handling

Do not describe a custom application as ChatGPT's secure credential form. Human
sign-in should occur in the actual Kaggle/Google browser UI through a supported
user-view channel. Agent automation must pause during the handoff and avoid
password extraction, authentication-page DOM dumps, screenshots of sensitive
verification data, and input logging. Do not ask for passwords or OTPs in chat.

The installed browser runtime's shared-file documentation explicitly identifies
browser profiles, credentials, and trusted configuration as private runtime
state. Access those through published browser APIs, never by copying profile or
cookie files into the shared directory.

Preserve the inherited network proxy and CA trust. The network sidecar enforces
the HTTP destination policy; editing its local policy snapshot or installing a
VPN/tunnel cannot grant additional access.
