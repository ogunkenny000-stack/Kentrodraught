# Kaggle browser tool

This project gives an execution-capable assistant a persistent Playwright browser
through a private Unix socket. It also provides ten MCP tools through a stdio
adapter. It was created and exercised in the current cloud environment.

## Verified here

- Chromium navigated to `https://www.kaggle.com/account/login` and rendered
  **Login or Register | Kaggle**, including Google and email sign-in buttons.
- The CLI and MCP adapter returned that live browser's status.
- Nine tests passed, including actual browser clicks, text entry, selection,
  upload, download, screenshot, artifact preservation, and authentication guards.
- Upstream HTTPS certificate verification remained enabled. No browser profile,
  cookies, credentials, or download directory is included in the ZIP.

**The Kaggle account is not connected.** This cloud session has no user-facing
interactive browser view or platform secure sign-in form. The installed platform
browser activation command reports that its platform access token has not been
provisioned. This project cannot provision that token or register new native
ChatGPT tools. The assistant can already call the custom CLI through its execution
tool; an MCP-compatible host can separately register the stdio adapter.

## Cloud public browsing

Python 3.10+, Chromium, and Playwright 1.62.0 are available in the tested cloud.
From the extracted project directory:

```sh
python3 browser_tool.py start --public-only --allow-unsandboxed --verified-proxy-fetch
python3 browser_tool.py navigate --url https://www.kaggle.com/account/login
python3 browser_tool.py status
python3 browser_tool.py stop
```

`--allow-unsandboxed` is an explicit concession for public, unauthenticated pages
in this container, where both Chromium sandbox options fail. The tool rejects
using that mode for an account session. A real account session requires a
sandbox-capable browser and a visible desktop connection.

`--verified-proxy-fetch` routes requests through Playwright's Node HTTPS client,
which validates every upstream certificate against the installed public CA
bundle and uses the configured network proxy. It preserves browser redirects
using `max_redirects=0`, aborts on verification/transport errors, and blocks
WebSockets. It is restricted to public-only browsing. It preserves the managed
network destination policy and does not disable HTTPS verification.

The browser stops agent reads, screenshots, and form entry on authentication
pages. A login page's `human_required` status is expected. A headless cloud
browser is not an interactive sign-in link for a person.

## Manual sign-in on a visible, sandbox-capable desktop

On a Linux/macOS desktop with a suitable Chromium installation and normal HTTPS
trust, use a **new account-session directory**:

```sh
python3 browser_tool.py --state-dir .account-session start --headed --executable /usr/bin/chromium
python3 browser_tool.py --state-dir .account-session signin
# The person signs in directly inside the visible Chromium window.
python3 browser_tool.py --state-dir .account-session resume
```

Set `--executable` to the installed Chromium path on that desktop. The code uses
Unix sockets; Windows needs a compatible Linux environment or a transport adapter.
For initial dependency installation, use `python3 -m pip install -r requirements.txt`.
The cloud lacks the visible desktop connection required by this section. An
accessible, appropriately protected desktop/forwarding route would need to be
provided before a person could sign in to its browser.

This is a manual browser handoff, not ChatGPT's platform secure credential form.
The tool never accepts passwords through a dedicated API and never exports
cookies, browser storage, arbitrary JavaScript results, or authentication values.
Account authentication is reported as `not_verified`; account identity must be
checked through the intended site's normal interface after a real sign-in.

## Commands and artifacts

`navigate`, `snapshot`, `click --selector`, `fill --selector --value`,
`select --selector --value`, `upload --selector --path`,
`download --selector --name`, `screenshot --name`, `status`, and `stop`.

Automation is restricted to Kaggle. Google authentication redirects are reserved
for human handoff. The explicit `--test-origin` exception accepts only an owned
loopback fixture server. Authentication/settings paths and credential fields
are protected. Existing files are not overwritten.

Stage ordinary upload files in the session's `artifacts/` directory. Download and
screenshot paths remain in that directory; traversals and escaping symlinks are
rejected. Profiles remain in the private state directory with restrictive file
permissions. Public-only and account profiles cannot be reused interchangeably.

## MCP adapter

Start a suitable browser session, then configure an MCP-compatible local client:

```json
{
  "mcpServers": {
    "kaggle-browser": {
      "command": "python3",
      "args": ["/absolute/path/to/kaggle-browser-tool/mcp_server.py"]
    }
  }
}
```

`mcp_server.py --state-dir DIR` selects a nondefault session. It exposes ten
`kaggle_browser_*` tools and deliberately omits sign-in/resume, cookie/storage,
and arbitrary script tools. This stdio configuration requires a client that
supports local MCP servers; it does not create an HTTPS endpoint or add tools to
this chat automatically.

## Validation

```sh
python3 -m unittest discover -s tests -v
BROWSER_BRIDGE_LIVE_TEST=1 python3 -m unittest discover -s tests -v
```

The first command runs seven lightweight checks and explicitly skips two browser
integration tests. The second command ran all nine checks successfully here,
using an isolated browser and owned local fixture without credentials.

`evidence/validation.json` records the checks and precise account-access limit.
`evidence/cloud-browser-status.json` records the real Kaggle navigation;
`evidence/mcp-smoke.jsonl` records the actual MCP exchange.
`probe/verified-transport-login.png` is a static screenshot of the public login
page, not an interactive or authenticated browser session.
