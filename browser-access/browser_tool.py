#!/usr/bin/env python3
"""A local Playwright tool for Kaggle, with an explicit manual sign-in handoff.

The private Unix socket is usable through an execution tool. It does not create
a ChatGPT browser panel, a remote desktop, or a platform secure credential form.
Passwords, cookies, browser storage and arbitrary JavaScript are never API outputs.
"""
from __future__ import annotations

import argparse
import asyncio
import ipaddress
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
from urllib.parse import urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parent
AUTH_PATH = re.compile(r"/(?:account|accounts|settings|login|signin|sign-in|signup|register|oauth|auth|verify|verification)(?:/|$)", re.I)
SENSITIVE_SELECTOR = re.compile(r"password|one.time.code|verification|\botp\b|credential|secret|api.?key", re.I)
SECRET_FIELDS = 'input[type="password"],input[autocomplete="one-time-code"],input[autocomplete="current-password"],input[autocomplete="new-password"]'
MAX_MESSAGE = 65536


class ToolError(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message
        super().__init__(message)


def atomic(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value) + '\n')
    temporary.chmod(0o600)
    temporary.replace(path)


def public_url(url):
    """Never return OAuth codes, query parameters, fragments or user information."""
    parsed = urlsplit(url)
    host = parsed.hostname or ''
    if ':' in host:
        host = '[' + host + ']'
    if parsed.port:
        host += ':' + str(parsed.port)
    return urlunsplit((parsed.scheme, host, parsed.path, '', ''))


def test_origin(value):
    if not value:
        return None
    try:
        p = urlsplit(value)
        p.port
        local = p.hostname == 'localhost' or ipaddress.ip_address(p.hostname or '').is_loopback
    except (ValueError, TypeError):
        raise ToolError('INVALID_TEST_ORIGIN', 'Test origins must name an owned loopback HTTP(S) server.')
    if not local or p.scheme not in ['http', 'https'] or p.username or p.password or p.path not in ['', '/'] or p.query or p.fragment:
        raise ToolError('INVALID_TEST_ORIGIN', 'Test origins must name an owned loopback HTTP(S) server.')
    return f'{p.scheme}://{p.netloc}'


def prepare_state(state, public_only):
    marker = state / 'tool-session.json'
    if marker.exists():
        prior = json.loads(marker.read_text())
        if prior.get('format') != 'kaggle-browser-tool-v1' or prior.get('public_only') != public_only:
            raise ToolError('SESSION_MODE_CHANGED', 'Use a separate new state directory when changing between public-only and account sessions.')
    elif state.exists() and any(state.iterdir()):
        raise ToolError('SESSION_NOT_OWNED', 'Use an empty state directory; existing browser profiles are not imported.')
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    state.chmod(0o700)
    for name in ['profile', 'xdg-config', 'xdg-cache']:
        if (state / name).is_symlink():
            raise ToolError('SESSION_PATH_REJECTED', 'Session profile and cache directories must not be symbolic links.')
    if not marker.exists():
        atomic(marker, dict(format='kaggle-browser-tool-v1', public_only=public_only))


def allowed_url(url, local_origin=None):
    if not isinstance(url, str) or not url or any(ord(c) < 33 for c in url):
        return False
    try:
        p = urlsplit(url)
        if p.username or p.password:
            return False
        port = p.port  # Also reject malformed or out-of-range port strings.
        if local_origin and f'{p.scheme}://{p.netloc}' == local_origin:
            return True
        return p.scheme == 'https' and p.hostname in ['www.kaggle.com', 'kaggle.com'] and port in [None, 443]
    except (ValueError, TypeError):
        return False


def permitted_navigation(url, local_origin=None):
    if allowed_url(url, local_origin):
        return True
    try:
        p = urlsplit(url)
        return (isinstance(url, str) and not any(ord(c) < 33 for c in url)
                and p.scheme == 'https' and p.hostname == 'accounts.google.com'
                and p.port in [None, 443] and not p.username and not p.password)
    except (ValueError, TypeError):
        return False


def auth_url(url):
    p = urlsplit(url)
    return p.hostname == 'accounts.google.com' or bool(AUTH_PATH.search(p.path))


def confined_file(root, value, *, existing=False):
    root = root.resolve()
    path = Path(value)
    if not path.is_absolute():
        path = root / path
    path = path.resolve()
    if not path.is_relative_to(root) or path == root:
        raise ToolError('ARTIFACT_PATH_REJECTED', 'Files must stay inside this session artifact directory.')
    if existing and not path.is_file():
        raise ToolError('ARTIFACT_MISSING', 'The requested artifact does not exist.')
    if not existing and path.exists():
        raise ToolError('ARTIFACT_EXISTS', 'Choose a new artifact filename; existing files are preserved.')
    return path


def proxy_configuration():
    value = os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY')
    if not value:
        return None
    p = urlsplit(value)
    if not p.hostname or p.scheme not in ['http', 'https', 'socks5']:
        raise ToolError('PROXY_CONFIGURATION_INVALID', 'The inherited browser proxy is invalid.')
    server = f'{p.scheme}://{p.hostname}' + (f':{p.port}' if p.port else '')
    result = dict(server=server, bypass='localhost,127.0.0.1,[::1]')
    if p.username:
        result['username'] = p.username
    if p.password:
        result['password'] = p.password
    return result


def safe_error(error):
    if isinstance(error, ToolError):
        return {'ok': False, 'error': error.code, 'message': error.message}
    detail = str(error)
    for needle, code, message in [
        ('ERR_CERT_AUTHORITY_INVALID', 'TLS_CA_NOT_TRUSTED', 'Chromium does not trust the configured HTTPS certificate authority; TLS verification remains enabled.'),
        ('No usable sandbox', 'SANDBOX_UNAVAILABLE', 'This environment cannot provide a Chromium sandbox.'),
        ('chrome-sandbox', 'SANDBOX_UNAVAILABLE', 'This environment cannot provide a Chromium sandbox.'),
        ('Timeout', 'BROWSER_TIMEOUT', 'The browser operation exceeded its time limit.'),
    ]:
        if needle in detail:
            return {'ok': False, 'error': code, 'message': message}
    return {'ok': False, 'error': type(error).__name__, 'message': 'Browser operation failed; request values and browser secrets were not logged.'}


class Browser:
    def __init__(self, args):
        self.args = args
        self.state = args.state_dir.resolve()
        self.artifacts = self.state.parent / 'artifacts'
        self.local_origin = test_origin(args.test_origin)
        self.human_paused = False
        self.shutdown = asyncio.Event()
        self.lock = asyncio.Lock()
        self.context = None
        self.verified_requests = 0
        self.failed_requests = 0
        self.blocked_navigations = 0

    async def open(self):
        from playwright.async_api import async_playwright
        if self.args.allow_unsandboxed and not self.args.public_only:
            raise ToolError('UNSAFE_MODE_REJECTED', 'Unsandboxed cloud browsing is restricted to public-only sessions.')
        if self.args.verified_proxy_fetch and not self.args.public_only:
            raise ToolError('PUBLIC_ONLY', 'Verified proxy fetch is restricted to public-only sessions; it is not an account sign-in transport.')
        if self.args.headed and sys.platform.startswith('linux') and not os.environ.get('DISPLAY') and not os.environ.get('WAYLAND_DISPLAY'):
            raise ToolError('HUMAN_VIEW_UNAVAILABLE', 'Headed browsing requires a visible desktop connection; this command cannot create one.')
        prepare_state(self.state, self.args.public_only)
        if self.artifacts.is_symlink():
            raise ToolError('ARTIFACT_PATH_REJECTED', 'The artifact directory must not be a symbolic link.')
        self.artifacts.mkdir(parents=True, exist_ok=True, mode=0o700)
        for path in [self.state, self.artifacts]:
            path.chmod(0o700)
        env = os.environ.copy()
        env.update(XDG_CONFIG_HOME=str(self.state / 'xdg-config'), XDG_CACHE_HOME=str(self.state / 'xdg-cache'))
        if self.args.verified_proxy_fetch:
            # Set before the Node driver starts. These are the managed runtime's
            # public trust anchors; certificate checking is never disabled.
            bundle = os.environ.get('SSL_CERT_FILE', '/etc/ssl/certs/ca-certificates.crt')
            if not Path(bundle).is_file():
                raise ToolError('CA_BUNDLE_MISSING', 'The configured public certificate authority bundle is unavailable.')
            os.environ['NODE_EXTRA_CA_CERTS'] = bundle
        self.runtime = await async_playwright().start()
        self.context = await self.runtime.chromium.launch_persistent_context(
            str(self.state / 'profile'), executable_path=self.args.executable,
            headless=not self.args.headed, chromium_sandbox=not self.args.allow_unsandboxed,
            env=env, proxy=proxy_configuration(), accept_downloads=True,
            downloads_path=str(self.artifacts), timeout=self.args.timeout,
            ignore_https_errors=False, service_workers='block',
        )
        async def scoped_transport(route):
            req = route.request
            url = req.url
            try:
                main_navigation = req.is_navigation_request() and req.frame.parent_frame is None
            except Exception:
                main_navigation = req.is_navigation_request()
            if main_navigation and not permitted_navigation(url, self.local_origin):
                self.blocked_navigations += 1
                await route.abort('blockedbyclient')
                return
            if self.args.verified_proxy_fetch:
                parsed = urlsplit(url)
                local = self.local_origin and f'{parsed.scheme}://{parsed.netloc}' == self.local_origin
                if parsed.scheme != 'https' and not local:
                    self.failed_requests += 1
                    await route.abort('blockedbyclient')
                    return
                try:
                    # Node's APIRequestContext verifies the upstream certificate
                    # against the configured roots through the inherited proxy.
                    # Redirects remain browser requests and are verified in turn.
                    response = await route.fetch(timeout=self.args.timeout, max_redirects=0)
                    self.verified_requests += 1
                    await route.fulfill(response=response)
                except Exception:
                    self.failed_requests += 1
                    await route.abort('failed')
            else:
                await route.continue_()
        await self.context.route('**/*', scoped_transport)
        def attach(page):
            def navigated(frame):
                if frame == page.main_frame and auth_url(frame.url) and not self.args.public_only:
                    self.human_paused = True
            page.on('framenavigated', navigated)
        self.context.on('page', attach)
        for page in self.context.pages:
            attach(page)
        if self.args.verified_proxy_fetch:
            if hasattr(self.context, 'route_web_socket'):
                await self.context.route_web_socket('**', lambda ws: ws.close())
        self.context.set_default_timeout(self.args.timeout)
        if not self.context.pages:
            await self.context.new_page()

    def page(self):
        pages = [p for p in self.context.pages if not p.is_closed()]
        if not pages:
            raise ToolError('NO_BROWSER_PAGE', 'The browser window has no open page.')
        return pages[-1]

    async def metadata(self):
        page = self.page()
        sensitive = auth_url(page.url) or await page.locator(SECRET_FIELDS).count() > 0
        return dict(ok=True, pid=os.getpid(), url=public_url(page.url),
                    mode='human_required' if self.human_paused or sensitive else 'automation',
                    public_only=self.args.public_only, headed=self.args.headed,
                    sandboxed=not self.args.allow_unsandboxed,
                    human_view_available=self.args.headed, account_authentication='not_verified',
                    artifacts=str(self.artifacts), tls_verification=True,
                    verified_proxy_fetch=self.args.verified_proxy_fetch,
                    verified_requests=self.verified_requests, failed_requests=self.failed_requests,
                    blocked_navigations=self.blocked_navigations)

    async def guard(self):
        page = self.page()
        if self.human_paused or auth_url(page.url) or await page.locator(SECRET_FIELDS).count():
            raise ToolError('HUMAN_SIGNIN_REQUIRED', 'Authentication pages and credential fields require the user in a visible browser; agent reading, screenshots and form entry are paused.')
        if not allowed_url(page.url, self.local_origin):
            raise ToolError('OUT_OF_SCOPE_PAGE', 'Automation is restricted to Kaggle and the explicitly owned loopback test origin.')
        return page

    async def action(self, request):
        action = request.get('action')
        if action == 'status':
            return await self.metadata()
        if action == 'stop':
            self.shutdown.set()
            return dict(ok=True, state='stopping')
        if action == 'navigate':
            url = request.get('url', '')
            if not allowed_url(url, self.local_origin):
                raise ToolError('NAVIGATION_REJECTED', 'Only HTTPS Kaggle URLs and the owned loopback test origin are permitted.')
            if self.human_paused:
                raise ToolError('HUMAN_SIGNIN_REQUIRED', 'The user currently controls the sign-in browser.')
            await self.page().goto(url, wait_until='domcontentloaded')
            return await self.metadata()
        if action == 'signin':
            if self.args.public_only:
                raise ToolError('PUBLIC_ONLY', 'This public-only session cannot be used for account authentication.')
            if not self.args.headed:
                raise ToolError('HUMAN_VIEW_UNAVAILABLE', 'Sign-in requires a visible browser connection for the user.')
            self.human_paused = True
            await self.page().goto('https://www.kaggle.com/account/login', wait_until='domcontentloaded')
            return await self.metadata()
        if action == 'resume':
            if self.args.public_only or not self.args.headed:
                raise ToolError('HUMAN_VIEW_UNAVAILABLE', 'A public/headless session cannot claim a completed manual sign-in.')
            page = self.page()
            if auth_url(page.url) or await page.locator(SECRET_FIELDS).count() or not allowed_url(page.url, self.local_origin):
                raise ToolError('SIGNIN_NOT_FINISHED', 'Leave the authentication page in the visible browser before resuming.')
            self.human_paused = False
            return await self.metadata()
        page = await self.guard()
        if action == 'snapshot':
            # This fixed DOM read deliberately never reads input values,
            # cookies, storage, arbitrary scripts, or hidden page text.
            return dict(ok=True, url=public_url(page.url), title=await page.title(),
                        text=(await page.locator('body').inner_text())[:8000],
                        elements=await page.locator('a,button,input,select,textarea').evaluate_all(
                            "els => els.filter(e => e.getClientRects().length).slice(0,50).map(e => ({tag:e.tagName.toLowerCase(),type:e.getAttribute('type')||'',label:(e.getAttribute('aria-label')||e.innerText||e.getAttribute('placeholder')||'').slice(0,120)}))"))
        if action == 'screenshot':
            path = confined_file(self.artifacts, request.get('name') or f'page-{time.time_ns()}.png')
            path.parent.mkdir(parents=True, exist_ok=True)
            await page.screenshot(path=str(path))
            return dict(ok=True, artifact=str(path))
        selector = request.get('selector', '')
        if not isinstance(selector, str) or not selector or len(selector) > 2000:
            raise ToolError('SELECTOR_REQUIRED', 'Supply a bounded Playwright selector.')
        if SENSITIVE_SELECTOR.search(selector):
            raise ToolError('CREDENTIAL_OPERATION_REJECTED', 'Credential selectors are not supported by agent automation.')
        element = page.locator(selector)
        if action == 'click':
            await element.click()
        elif action == 'fill':
            value = request.get('value', '')
            if not isinstance(value, str) or len(value) > 10000:
                raise ToolError('VALUE_REJECTED', 'Text input must be a bounded string.')
            await element.fill(value)
        elif action == 'select':
            await element.select_option(request.get('value', ''))
        elif action == 'upload':
            path = confined_file(self.artifacts, request.get('path', ''), existing=True)
            await element.set_input_files(str(path))
        elif action == 'download':
            path = confined_file(self.artifacts, request.get('name', 'download.bin'))
            path.parent.mkdir(parents=True, exist_ok=True)
            async with page.expect_download() as event:
                await element.click()
            download = await event.value
            await download.save_as(str(path))
            return dict(ok=True, artifact=str(path))
        else:
            raise ToolError('UNKNOWN_ACTION', 'The requested browser action is not supported.')
        return await self.metadata()

    async def close(self):
        if self.context:
            await self.context.close()
        if hasattr(self, 'runtime'):
            await self.runtime.stop()


async def serve(args):
    browser = Browser(args)
    state = args.state_dir.resolve()
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    startup = state / 'startup.json'
    socket = state / 'browser.sock'
    try:
        await browser.open()
        if socket.exists():
            socket.unlink()
        async def handle(reader, writer):
            try:
                line = await asyncio.wait_for(reader.readline(), 5)
                if not line or len(line) > MAX_MESSAGE:
                    raise ToolError('INVALID_REQUEST', 'The request must be one bounded JSON object.')
                request = json.loads(line)
                if not isinstance(request, dict):
                    raise ToolError('INVALID_REQUEST', 'The request must be a JSON object.')
                async with browser.lock:
                    reply = await asyncio.wait_for(browser.action(request), args.timeout / 1000 + 2)
            except BaseException as error:
                reply = safe_error(error)
            writer.write(json.dumps(reply).encode() + b'\n')
            await writer.drain()
            writer.close()
            await writer.wait_closed()
        server = await asyncio.start_unix_server(handle, str(socket), limit=MAX_MESSAGE + 1)
        socket.chmod(0o600)
        atomic(startup, dict(ok=True, pid=os.getpid(), state='ready', public_only=args.public_only, headed=args.headed))
        for sig in [signal.SIGINT, signal.SIGTERM]:
            asyncio.get_running_loop().add_signal_handler(sig, browser.shutdown.set)
        async with server:
            await browser.shutdown.wait()
    except BaseException as error:
        atomic(startup, safe_error(error))
        raise SystemExit(1)
    finally:
        await browser.close()
        if socket.exists():
            socket.unlink()


async def request(state, payload):
    try:
        reader, writer = await asyncio.wait_for(asyncio.open_unix_connection(str(state / 'browser.sock')), 5)
    except (FileNotFoundError, ConnectionRefusedError):
        raise ToolError('BROWSER_NOT_RUNNING', 'Start this browser session before sending actions.')
    writer.write(json.dumps(payload).encode() + b'\n')
    await writer.drain()
    response = await asyncio.wait_for(reader.readline(), 65)
    writer.close()
    await writer.wait_closed()
    return json.loads(response)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir', type=Path, default=ROOT / '.state')
    parser.add_argument('action', choices=['start', '_serve', 'status', 'navigate', 'snapshot', 'click', 'fill', 'select', 'upload', 'screenshot', 'download', 'stop', 'signin', 'resume'])
    parser.add_argument('--headed', action='store_true')
    parser.add_argument('--public-only', action='store_true')
    parser.add_argument('--allow-unsandboxed', action='store_true')
    parser.add_argument('--verified-proxy-fetch', action='store_true',
                        help='public-only rendering through strictly verified Node HTTPS fetch; no WebSocket/account authentication')
    parser.add_argument('--executable', default='/usr/bin/chromium')
    parser.add_argument('--test-origin')
    parser.add_argument('--timeout', type=int, default=20000)
    parser.add_argument('--url')
    parser.add_argument('--selector')
    parser.add_argument('--value')
    parser.add_argument('--path')
    parser.add_argument('--name')
    args = parser.parse_args()
    try:
        if not 1000 <= args.timeout <= 60000:
            raise ToolError('TIMEOUT_REJECTED', 'Timeout must be between1000 and60000 milliseconds.')
        state = args.state_dir.resolve()
        if args.action == '_serve':
            asyncio.run(serve(args))
            return
        if args.action == 'start':
            prepare_state(state, args.public_only)
            if len(str(state / 'browser.sock').encode()) > 100:
                raise ToolError('STATE_PATH_TOO_LONG', 'Choose a shorter local state directory for the Unix socket.')
            if (state / 'browser.sock').exists():
                raise ToolError('SESSION_EXISTS', 'A browser socket already exists; inspect or stop the existing session first.')
            startup = state / 'startup.json'
            if startup.exists():
                startup.unlink()
            command = [sys.executable, str(Path(__file__).resolve()), '--state-dir', str(state), '_serve',
                       '--executable', args.executable, '--timeout', str(args.timeout)]
            for option in ['headed', 'public_only', 'allow_unsandboxed', 'verified_proxy_fetch']:
                if getattr(args, option):
                    command.append('--' + option.replace('_', '-'))
            if args.test_origin:
                test_origin(args.test_origin)
                command += ['--test-origin', args.test_origin]
            process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                       stderr=subprocess.DEVNULL, start_new_session=True)
            deadline = time.monotonic() + 30
            while not startup.exists():
                if process.poll() is not None or time.monotonic() > deadline:
                    if process.poll() is None:
                        process.terminate()
                    raise ToolError('START_FAILED', 'Browser startup did not produce its readiness record.')
                time.sleep(.1)
            reply = json.loads(startup.read_text())
        else:
            payload = {key: getattr(args, key) for key in ['url', 'selector', 'value', 'path', 'name'] if getattr(args, key) is not None}
            payload['action'] = args.action
            reply = asyncio.run(request(state, payload))
        print(json.dumps(reply))
        if not reply.get('ok'):
            raise SystemExit(1)
    except ToolError as error:
        print(json.dumps(safe_error(error)))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
