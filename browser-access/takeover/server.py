#!/usr/bin/env python3
"""Private browser takeover service. No account credentials are API outputs."""
from __future__ import annotations
import argparse
import asyncio
import base64
import ipaddress
import json
import os
from pathlib import Path
import secrets
import ssl
import sys
import time
from urllib.parse import urlsplit
from aiohttp import web

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import browser_tool as guards


class Refused(Exception):
    def __init__(self, code, status=403):
        self.code, self.status = code, status


def loopback(value):
    try:
        return ipaddress.ip_address(value).is_loopback
    except ValueError:
        return value == 'localhost'


class PlaywrightBrowser:
    """Normal verified Chromium on a sandbox-capable host, plus public preview."""
    def __init__(self, state, executable='/usr/bin/chromium', public_preview=False, unsandboxed=False):
        if unsandboxed and not public_preview:
            raise Refused('UNSANDBOXED_ACCOUNT_SESSION_REJECTED')
        self.state, self.executable = Path(state), executable
        self.public_preview, self.sandboxed = public_preview, not unsandboxed
        self.owner_active = False
        self.owner_authorized = lambda: self.owner_active
        self.runtime = self.context = None

    async def open(self):
        from playwright.async_api import async_playwright
        profile = self.state / 'browser'
        guards.prepare_state(profile, self.public_preview)
        env = os.environ.copy()
        env.update(XDG_CONFIG_HOME=str(profile / 'xdg-config'), XDG_CACHE_HOME=str(profile / 'xdg-cache'))
        self.runtime = await async_playwright().start()
        self.context = await self.runtime.chromium.launch_persistent_context(
            str(profile / 'profile'), executable_path=self.executable, headless=True,
            chromium_sandbox=self.sandboxed, ignore_https_errors=False,
            args=['--disable-setuid-sandbox'] if self.sandboxed else [],
            proxy=guards.proxy_configuration(), env=env, viewport={'width': 1280, 'height': 800},
            service_workers='block', timeout=20000)
        async def scope(route):
            request = route.request
            if request.is_navigation_request() and request.frame.parent_frame is None:
                google = urlsplit(request.url).hostname == 'accounts.google.com'
                if not guards.allowed_url(request.url) and not (self.owner_authorized() and google and guards.permitted_navigation(request.url)):
                    await route.abort('blockedbyclient'); return
            await route.continue_()
        await self.context.route('**/*', scope)
        if not self.context.pages:
            await self.context.new_page()

    def page(self):
        pages = [page for page in self.context.pages if not page.is_closed()]
        if not pages:
            raise Refused('NO_BROWSER_PAGE', 409)
        return pages[-1]

    async def protected(self):
        page = self.page()
        return guards.auth_url(page.url) or bool(await page.locator(guards.SECRET_FIELDS).count())

    async def metadata(self):
        page = self.page()
        return {'url': guards.public_url(page.url), 'protected': await self.protected(),
                'sandboxed': self.sandboxed, 'upstream_tls_verification': True,
                'credential_entry_ready': self.sandboxed and not self.public_preview,
                'account_authentication': 'not_verified', 'width': 1280, 'height': 800}

    async def frame(self):
        return await self.page().screenshot(type='jpeg', quality=70)

    async def healthy(self):
        return bool(self.context and self.context.browser and self.context.browser.is_connected()
                    and any(not page.is_closed() for page in self.context.pages))

    async def navigate(self, url, owner=False):
        allowed = guards.allowed_url(url) or (owner and guards.permitted_navigation(url))
        if not allowed:
            raise Refused('NAVIGATION_OUT_OF_SCOPE')
        await self.page().goto(url, wait_until='domcontentloaded', timeout=20000)

    async def input(self, data):
        if await self.protected() and (not self.sandboxed or self.public_preview):
            raise Refused('PUBLIC_PREVIEW_CANNOT_ENTER_CREDENTIALS')
        page = self.page(); kind = data.get('kind')
        if kind == 'click':
            x, y = data.get('x'), data.get('y')
            if not isinstance(x, (float, int)) or not isinstance(y, (float, int)) or not 0 <= x < 1280 or not 0 <= y < 800:
                raise Refused('INVALID_POINTER', 400)
            await page.mouse.click(x, y)
        elif kind == 'wheel':
            dx, dy = data.get('dx', 0), data.get('dy', 0)
            if not all(isinstance(n, (int, float)) and abs(n) <= 4096 for n in [dx, dy]):
                raise Refused('INVALID_WHEEL', 400)
            await page.mouse.wheel(dx, dy)
        elif kind == 'key':
            key = data.get('key', '')
            if not isinstance(key, str) or len(key) > 60 or not key:
                raise Refused('INVALID_KEY', 400)
            await page.keyboard.press(key)
        elif kind == 'text':
            text = data.get('text', '')
            if not isinstance(text, str) or len(text) > 4096:
                raise Refused('INVALID_TEXT', 400)
            await page.keyboard.insert_text(text)
        else:
            raise Refused('INVALID_INPUT', 400)

    async def agent_action(self, data):
        if await self.protected() or not guards.allowed_url(self.page().url):
            raise Refused('HUMAN_SIGNIN_REQUIRED', 423)
        action = data.get('action')
        if action == 'snapshot':
            return {'text': (await self.page().locator('body').inner_text())[:8000]}
        if action == 'navigate':
            await self.navigate(data.get('url', '')); return {}
        if action in ['click', 'fill']:
            selector = data.get('selector', '')
            if not isinstance(selector, str) or not selector or len(selector) > 2000 or guards.SENSITIVE_SELECTOR.search(selector):
                raise Refused('CREDENTIAL_OR_INVALID_SELECTOR')
            locator = self.page().locator(selector)
            if action == 'click':
                await locator.click(timeout=10000)
            else:
                value = data.get('value', '')
                if not isinstance(value, str) or len(value) > 10000:
                    raise Refused('INVALID_TEXT', 400)
                await locator.fill(value, timeout=10000)
            return {}
        raise Refused('INVALID_ACTION', 400)

    async def close(self):
        if self.context: await self.context.close()
        if self.runtime: await self.runtime.stop()


class Takeover:
    def __init__(self, browser, owner_token, agent_token, lease_seconds=60):
        if owner_token == agent_token or min(len(owner_token), len(agent_token)) < 32:
            raise ValueError('Use distinct high-entropy role capabilities')
        self.browser, self.owner_token, self.agent_token = browser, owner_token, agent_token
        self.lease_seconds = lease_seconds
        self.lease, self.expires = None, 0
        self.lock = asyncio.Lock()

    def active(self):
        if self.lease and time.monotonic() >= self.expires:
            self.lease = None
            self.browser.owner_active = False
        return self.lease is not None

    def require_lease(self, request):
        if not self.active() or not secrets.compare_digest(request.headers.get('X-Owner-Lease', ''), self.lease):
            raise Refused('OWNER_LEASE_REQUIRED', 409)
        self.expires = time.monotonic() + self.lease_seconds

    async def status(self):
        metadata = await self.browser.metadata()
        return {'ok': True, 'mode': 'human_control' if self.active() else 'agent_control', **metadata}


SERVICE = web.AppKey('takeover', Takeover)
PAIRING = web.AppKey('owner_pairing', object)

def create_app(browser, owner_token, agent_token, *, public_origin=None, trust_loopback_proxy=False, lease_seconds=60, agent_verifier=None, pairing_enabled=False, pairing_script=None):
    if pairing_enabled and agent_verifier is None:
        raise ValueError('Owner pairing requires signed agent authentication')
    if public_origin:
        p = urlsplit(public_origin)
        if p.scheme != 'https' or not p.hostname or p.username or p.password or p.query or p.fragment or p.path not in ['', '/']:
            raise ValueError('A production origin must be an HTTPS origin')
        public_origin = public_origin.rstrip('/')
    service = Takeover(browser, owner_token, agent_token, lease_seconds)
    browser.owner_authorized = service.active

    @web.middleware
    async def protection(request, handler):
        try:
            if request.query_string:
                raise Refused('URL_CREDENTIALS_NOT_ACCEPTED', 400)
            if public_origin:
                expected = public_origin
                if request.host != urlsplit(expected).netloc:
                    raise Refused('HOST_REJECTED')
                forwarded = trust_loopback_proxy and loopback(request.remote or '') and request.headers.get('X-Forwarded-Proto') == 'https'
                if not request.secure and not forwarded:
                    raise Refused('HTTPS_REQUIRED')
            else:
                parsed = urlsplit('http://' + request.host)
                if not loopback(request.remote or '') or not loopback(parsed.hostname or ''):
                    raise Refused('LOOPBACK_ONLY')
                expected = 'http://' + request.host
            if request.headers.get('Origin') not in [None, expected]:
                raise Refused('ORIGIN_REJECTED')
            role = 'owner' if request.path.startswith('/owner/') else 'agent' if request.path.startswith('/agent/') else None
            if role:
                if role == 'agent' and agent_verifier is not None:
                    valid = await agent_verifier(request)
                else:
                    supplied = request.headers.get('Authorization', '')
                    token = owner_token if role == 'owner' else agent_token
                    valid = secrets.compare_digest(supplied, 'Bearer ' + token)
                if valid is not True:
                    raise Refused('UNAUTHORIZED', 401)
            response = await handler(request)
        except Refused as error:
            response = web.json_response({'ok': False, 'error': error.code}, status=error.status)
        except Exception:
            # Never echo Playwright exceptions, input values, capabilities or request bodies.
            response = web.json_response({'ok': False, 'error': 'BROWSER_OPERATION_FAILED'}, status=502)
        response.headers.update({'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
            'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
            'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"})
        return response

    app = web.Application(middlewares=[protection], client_max_size=16384)
    app[SERVICE] = service
    async def security_headers(request, response):
        response.headers.update({'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
            'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
            'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"})
    app.on_response_prepare.append(security_headers)
    async def index(request): return web.FileResponse(HERE / 'viewer.html')
    async def javascript(request): return web.FileResponse(HERE / 'viewer.js')
    async def stylesheet(request): return web.FileResponse(HERE / 'viewer.css')
    async def config(request): return web.json_response({'pairing_enabled': pairing_enabled})
    async def pairing_javascript(request):
        script = Path(pairing_script) if pairing_script else HERE / 'pairing.js'
        if not pairing_enabled or not script.is_file():
            raise Refused('PAIRING_NOT_CONFIGURED', 404)
        return web.FileResponse(script)
    async def health(request):
        if not await browser.healthy():
            return web.json_response({'ok': False, 'error': 'BROWSER_UNAVAILABLE'}, status=503)
        return web.json_response({'ok': True, 'service': 'browser-takeover'})
    async def status(request): return web.json_response(await service.status())
    async def acquire(request):
        async with service.lock:
            if service.active():
                raise Refused('OWNER_ALREADY_CONTROLLING', 409)
            service.lease = secrets.token_urlsafe(24); service.expires = time.monotonic() + lease_seconds
            browser.owner_active = True
            return web.json_response({'ok': True, 'lease': service.lease, **(await browser.metadata())})
    async def release(request):
        async with service.lock:
            service.require_lease(request)
            if await browser.protected() or not guards.allowed_url((await browser.metadata())['url']):
                raise Refused('LEAVE_SIGNIN_PAGE_BEFORE_RELEASING', 409)
            service.lease = None; service.expires = 0; browser.owner_active = False
            return web.json_response({'ok': True, 'mode': 'agent_control'})
    async def owner_action(request):
        data = await request.json()
        async with service.lock:
            service.require_lease(request)
            if data.get('kind') == 'navigate':
                await browser.navigate(data.get('url', ''), owner=True)
            else:
                await browser.input(data)
            return web.json_response(await service.status())
    async def frame(request):
        async with service.lock:
            service.require_lease(request)
            return web.Response(body=await browser.frame(), content_type='image/jpeg')
    async def stream(request):
        service.require_lease(request)
        response = web.StreamResponse(headers={'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'})
        await response.prepare(request)
        try:
            while service.active():
                async with service.lock:
                    service.require_lease(request)
                    value = {'image': base64.b64encode(await browser.frame()).decode(), **(await service.status())}
                await response.write(('data:' + json.dumps(value) + '\n\n').encode())
                await asyncio.sleep(.75)
        except (ConnectionError, asyncio.CancelledError, Refused):
            pass
        return response
    async def agent_action(request):
        data = await request.json()
        async with service.lock:
            if service.active(): raise Refused('OWNER_CONTROLS_BROWSER', 423)
            if await browser.protected(): raise Refused('HUMAN_SIGNIN_REQUIRED', 423)
            result = await browser.agent_action(data)
            return web.json_response({'ok': True, **result})
    app.add_routes([web.get('/', index), web.get('/viewer.js', javascript), web.get('/viewer.css', stylesheet),
        web.get('/health', health), web.get('/config', config), web.get('/pairing.js', pairing_javascript), web.get('/owner/status', status), web.post('/owner/acquire', acquire),
        web.post('/owner/release', release), web.post('/owner/action', owner_action), web.get('/owner/frame', frame),
        web.get('/owner/stream', stream), web.get('/agent/status', status), web.post('/agent/action', agent_action)])
    if pairing_enabled:
        from pairing import install_pairing
        app[PAIRING] = install_pairing(app, owner_token, agent_verifier)
    return app


def capabilities(state):
    state = Path(state)
    state.mkdir(parents=True, exist_ok=True, mode=0o700); state.chmod(0o700)
    path = state / 'capabilities.json'
    if path.exists():
        if path.is_symlink(): raise ValueError('Capability file cannot be a symlink')
        value = json.loads(path.read_text())
    else:
        value = {'owner': secrets.token_urlsafe(32), 'agent': secrets.token_urlsafe(32)}
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as output: json.dump(value, output)
    path.chmod(0o600)
    return value


async def run(args):
    keys = capabilities(args.state)
    verifier = None
    if args.agent_public_key:
        from pairing import AgentVerifier
        verifier = AgentVerifier(args.agent_public_key)
    browser = PlaywrightBrowser(args.state, args.executable, args.public_preview, args.allow_unsandboxed)
    await browser.open()
    app = create_app(browser, keys['owner'], keys['agent'], public_origin=args.public_origin,
                     trust_loopback_proxy=args.trust_loopback_proxy,
                     agent_verifier=verifier, pairing_enabled=args.owner_pairing)
    runner = web.AppRunner(app, access_log=None); await runner.setup()
    tls = None
    if args.tls_cert:
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); tls.minimum_version = ssl.TLSVersion.TLSv1_2
        tls.load_cert_chain(args.tls_cert, args.tls_key)
    site = web.TCPSite(runner, args.listen, args.port, ssl_context=tls)
    await site.start()
    print('Browser takeover service started; account login is not yet verified.', flush=True)
    try: await asyncio.Event().wait()
    finally: await runner.cleanup(); await browser.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['serve', 'owner-link'])
    parser.add_argument('--state', type=Path, default=HERE / '.state')
    parser.add_argument('--listen', default='127.0.0.1'); parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--public-origin'); parser.add_argument('--trust-loopback-proxy', action='store_true')
    parser.add_argument('--tls-cert'); parser.add_argument('--tls-key')
    parser.add_argument('--executable', default='/usr/bin/chromium')
    parser.add_argument('--public-preview', action='store_true'); parser.add_argument('--allow-unsandboxed', action='store_true')
    parser.add_argument('--agent-public-key', type=Path)
    parser.add_argument('--owner-pairing', action='store_true')
    args = parser.parse_args()
    if args.owner_pairing and not args.agent_public_key:
        parser.error('Owner pairing requires an Ed25519 agent public key')
    if args.command == 'owner-link':
        if not sys.stdout.isatty(): parser.error('Display the owner capability only in the trusted operator terminal')
        origin = args.public_origin or f'http://127.0.0.1:{args.port}'
        print(origin.rstrip('/') + '/#owner=' + capabilities(args.state)['owner']); return
    if not loopback(args.listen) and (not args.public_origin or not args.tls_cert):
        parser.error('Direct external serving requires an HTTPS origin and TLS certificate; a reverse proxy should connect to loopback')
    if bool(args.tls_cert) != bool(args.tls_key): parser.error('Supply both TLS certificate and key')
    try: asyncio.run(run(args))
    except KeyboardInterrupt: pass
    except Exception: parser.exit(1, 'Browser takeover startup failed. No credentials or input values were logged.\n')


if __name__ == '__main__': main()
