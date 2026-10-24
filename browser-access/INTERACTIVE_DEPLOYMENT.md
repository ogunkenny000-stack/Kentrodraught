# Interactive browser connection: feasibility evidence

Inspected on 2026-10-24 UTC. This note describes observed transport capabilities;
it does not claim that a public URL, interactive browser view, or Kaggle account
connection exists.

## Current boundaries

- The current execution environment supplies an HTTP egress proxy at
  `http://proxy:8080` and a separate TCP CONNECT proxy at `http://proxy:8088`.
- `/etc/codex/network-policy.json` reports no granted TCP domains or IP ranges
  and no configured VPN. Direct general Internet connections are not supported.
- The managed tool catalog has no port-forward, public-preview, secure sign-in,
  or Cloud Browser control tool.
- The normal installed browser activation command failed because its platform
  access token has not been provisioned. The platform context and credentials
  must not be fabricated or extracted from private runtime state.
- Docker's daemon is reachable: version 28.4.0, built-in seccomp and cgroupns
  security options. No Docker images were cached when checked. This supports
  investigating a dedicated browser container, but sandbox functionality and a
  remote interactive view have not been tested inside one.

## Why a stock Cloudflare Quick Tunnel does not solve this connection

The official cloudflared source was read through the existing proxy from
`raw.githubusercontent.com`; no tunnel or Cloudflare service was provisioned.

Sources:

- <https://github.com/cloudflare/cloudflared/blob/master/edgediscovery/dial.go>
- <https://github.com/cloudflare/cloudflared/blob/master/supervisor/tunnel.go>
- <https://github.com/cloudflare/cloudflared/blob/master/cmd/cloudflared/tunnel/quick_tunnel.go>
- <https://github.com/cloudflare/cloudflared/blob/master/edgediscovery/allregions/discovery.go>

Observed implementation:

1. `DialEdge` constructs `net.Dialer{}` and calls `DialContext` directly on the
   discovered edge TCP address, then performs its TLS handshake. It does not
   use `http.ProxyFromEnvironment` for this path.
2. Quick Tunnel provisioning creates an `http.Transport` without a `Proxy`
   callback. Merely setting `HTTP_PROXY` does not make that transport use the
   managed HTTP proxy.
3. The edge data transport normally requires outbound TCP port 7844 for HTTP/2,
   or UDP port 7844 for QUIC. The `argotunnel.com` service discovery supplies
   edge addresses; associated edge hosts include the Cloudflare regional tunnel
   service. Current runtime TCP grants are empty.

Adding only `api.trycloudflare.com` or `*.trycloudflare.com` to the HTTP allowlist
would therefore be insufficient. Selecting HTTP/2 does not turn this into a
regular HTTPS-proxy request on port 443. Do not unset proxy settings, attempt a
direct route, change platform flags, or use an unrelated allowed service as an
undeclared tunnel.

The current source also contains optional recipient-email protection for Quick
Tunnels. That feature does not resolve the missing supported egress transport.
A deployment using it would still need explicit runtime network support and a
real successfully tested relay connection.

## A transport that can fit this runtime

A custom application relay can use ordinary outbound HTTPS long-polling through
the configured HTTP proxy, with normal CA and hostname verification. It needs an
actual externally reachable HTTPS server that the user owns or authorizes, or a
platform-provided private ingress route.

The relay endpoint should have:

- A real DNS name and valid HTTPS certificate.
- Separate, scoped operator and browser-worker capabilities with expiry.
- A bounded outbound-poll API for the cloud worker, avoiding raw TCP or UDP.
- A browser-visible operator page, authenticated screenshot/frame retrieval,
  and authenticated input delivery.
- Agent automation paused during sign-in; password/input events excluded from
  logs and from the agent-facing API. The person types into the real browser
  page rather than a copied Google/Kaggle credential form.
- Exact allowed origin checks, bounded messages, protected WebSocket/poll
  requests, and no open unauthenticated browser-control/CDP endpoint.

The cloud worker can then post frames and poll input through standard HTTPS
requests. The person's browser uses the same relay's HTTPS page. A loopback-only
server inside `/workspace` is not a user-accessible cloud URL by itself.

## The remaining concrete prerequisite

One of these must be supplied before an interactive cloud sign-in can be tested:

1. A supported platform private HTTPS/desktop ingress route connected to this
   cloud worker; or
2. An authorized HTTPS relay/server hostname and deployment access, with that
   hostname permitted through the existing environment configuration workflow.

The second option does not require a Kaggle API key. It does require somewhere
real to host the connection between the person and the browser. No such server,
account authorization, hostname, or deployment credentials are configured in the
current session. A localhost listener, a ZIP download, or an ordinary Kaggle
login link cannot supply that connection.

## Deployment/testing sequence

1. Finish and locally test the takeover UI, relay authentication, input handling,
   and agent/human handoff before requesting new external access.
2. Test a dedicated browser runtime with a functioning sandbox, an owned private
   profile, verified HTTPS trust, and resource limits. Docker availability alone
   is not proof that these checks pass.
3. Deploy the relay only to an authorized host. Add its exact hostname through
   the supported network settings, preserving existing destinations.
4. Confirm that both the cloud worker and the person's actual browser can reach
   it using authenticated HTTPS. An internal self-request is insufficient.
5. The person signs in directly on Kaggle/Google in the live browser view; the
   assistant resumes only after the human sign-in handoff ends.

The existing `--public-only --allow-unsandboxed --verified-proxy-fetch` CLI is a
verified public browsing mode. It is not an authenticated-session deployment or
an interactive sign-in route.

No network rules, accounts, profiles, engine processes, or external services were
modified during this feasibility inspection.
