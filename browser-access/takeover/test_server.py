import asyncio
import json
from pathlib import Path
import sys
import time
import unittest
from aiohttp.test_utils import TestClient, TestServer

sys.path.insert(0, str(Path(__file__).resolve().parent))
import server

OWNER, AGENT = 'owner-' + 'o' * 40, 'agent-' + 'a' * 40


class FakeBrowser:
    def __init__(self):
        self.owner_active = False
        self.url = 'https://www.kaggle.com/code'
        self.is_protected = False
        self.ready = True
        self.inputs = self.agent_calls = 0

    async def healthy(self): return self.ready

    async def protected(self): return self.is_protected
    async def metadata(self):
        return {'url': self.url, 'protected': self.is_protected, 'sandboxed': self.ready,
                'upstream_tls_verification': True, 'credential_entry_ready': self.ready,
                'account_authentication': 'not_verified', 'width': 1280, 'height': 800}
    async def frame(self): return b'fake-browser-frame'
    async def navigate(self, url, owner=False):
        if not server.guards.allowed_url(url) and not (owner and server.guards.permitted_navigation(url)):
            raise server.Refused('NAVIGATION_OUT_OF_SCOPE')
        self.url = url
        self.is_protected = server.guards.auth_url(url)
    async def input(self, data):
        if self.is_protected and not self.ready:
            raise server.Refused('PUBLIC_PREVIEW_CANNOT_ENTER_CREDENTIALS')
        self.inputs += 1
    async def agent_action(self, data):
        self.agent_calls += 1
        if data.get('action') == 'raise': raise ValueError('test-secret-must-not-be-returned')
        return {'text': 'ordinary Kaggle page'}


class HttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.browser = FakeBrowser()
        self.app = server.create_app(self.browser, OWNER, AGENT)
        self.client = TestClient(TestServer(self.app))
        await self.client.start_server()
        self.lease = None

    async def asyncTearDown(self): await self.client.close()

    def headers(self, role='owner', lease=True):
        headers = {'Authorization': 'Bearer ' + (OWNER if role == 'owner' else AGENT)}
        if lease and self.lease: headers['X-Owner-Lease'] = self.lease
        return headers

    async def acquire(self):
        response = await self.client.post('/owner/acquire', json={}, headers=self.headers())
        self.assertEqual(response.status, 200)
        self.lease = (await response.json())['lease']

    async def test_capabilities_are_distinct_and_never_returned_by_status(self):
        for path in ['/owner/status', '/agent/status']:
            response = await self.client.get(path)
            self.assertEqual(response.status, 401)
        response = await self.client.get('/owner/status', headers=self.headers('agent'))
        self.assertEqual(response.status, 401)
        response = await self.client.get('/owner/status', headers=self.headers())
        text = await response.text()
        self.assertEqual(response.status, 200)
        self.assertNotIn(OWNER, text); self.assertNotIn(AGENT, text)
        self.assertNotIn('image', text)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')

    async def test_health_requires_a_live_browser(self):
        response = await self.client.get('/health')
        self.assertEqual(response.status, 200)
        self.browser.ready = False
        response = await self.client.get('/health')
        self.assertEqual(response.status, 503)
        self.assertEqual((await response.json())['error'], 'BROWSER_UNAVAILABLE')

    async def test_owner_takeover_blocks_agent_until_explicit_safe_release(self):
        await self.acquire()
        response = await self.client.post('/agent/action', json={'action':'snapshot'}, headers=self.headers('agent'))
        self.assertEqual(response.status, 423); self.assertEqual(self.browser.agent_calls, 0)
        self.browser.is_protected = True
        response = await self.client.post('/owner/release', json={}, headers=self.headers())
        self.assertEqual(response.status, 409)
        self.browser.is_protected = False
        response = await self.client.post('/owner/release', json={}, headers=self.headers())
        self.assertEqual(response.status, 200)
        response = await self.client.post('/agent/action', json={'action':'snapshot'}, headers=self.headers('agent'))
        self.assertEqual(response.status, 200); self.assertEqual(self.browser.agent_calls, 1)

    async def test_only_owner_can_view_authentication_frame(self):
        await self.acquire(); self.browser.is_protected = True
        response = await self.client.get('/owner/frame', headers=self.headers('agent'))
        self.assertEqual(response.status, 401)
        response = await self.client.get('/owner/frame', headers=self.headers())
        self.assertEqual(response.status, 200); self.assertEqual(await response.read(), b'fake-browser-frame')
        response = await self.client.get('/agent/status', headers=self.headers('agent'))
        text = await response.text(); self.assertNotIn('fake-browser-frame', text)
        self.assertEqual((await response.json())['mode'], 'human_control')

    async def test_owner_stream_requires_lease_and_frames_are_private(self):
        response = await self.client.get('/owner/stream', headers=self.headers())
        self.assertEqual(response.status, 409)
        await self.acquire()
        response = await self.client.get('/owner/stream', headers=self.headers())
        self.assertEqual(response.status, 200)
        self.assertTrue((await response.content.readline()).startswith(b'data:'))
        response.close()

    async def test_preview_rejects_credentials_and_exception_values_are_redacted(self):
        await self.acquire(); self.browser.is_protected = True; self.browser.ready = False
        response = await self.client.post('/owner/action', json={'kind':'text','text':'test-secret-must-not-be-returned'}, headers=self.headers())
        self.assertEqual(response.status, 403)
        self.assertNotIn('test-secret-must-not-be-returned', await response.text())
        self.assertEqual(self.browser.inputs, 0)
        self.browser.is_protected = False; self.app[server.SERVICE].lease = None
        response = await self.client.post('/agent/action', json={'action':'raise'}, headers=self.headers('agent'))
        self.assertEqual(response.status, 502)
        self.assertNotIn('test-secret-must-not-be-returned', await response.text())

    async def test_no_capabilities_in_query_and_cross_origin_requests_rejected(self):
        response = await self.client.get('/owner/status?token=' + OWNER)
        self.assertEqual(response.status, 400)
        self.assertNotIn(OWNER, await response.text())
        headers = self.headers(); headers['Origin'] = 'https://untrusted.example'
        response = await self.client.post('/owner/acquire', json={}, headers=headers)
        self.assertEqual(response.status, 403)
        self.assertEqual((await response.json())['error'], 'ORIGIN_REJECTED')

    async def test_expired_owner_lease_cannot_type(self):
        await self.acquire(); self.app[server.SERVICE].expires = time.monotonic() - 1
        response = await self.client.post('/owner/action', json={'kind':'text','text':'test-only'}, headers=self.headers())
        self.assertEqual(response.status, 409)
        self.assertFalse(self.browser.owner_active)
        self.assertEqual(self.browser.inputs, 0)

    async def test_owner_body_forwarding_is_not_echoed_in_response(self):
        await self.acquire()
        response = await self.client.post('/owner/action', json={'kind':'text','text':'ordinary test text'}, headers=self.headers())
        self.assertEqual(response.status, 200)
        self.assertNotIn('ordinary test text', await response.text())
        self.assertEqual(self.browser.inputs, 1)

    async def test_production_requires_tls_or_explicit_trusted_loopback_proxy(self):
        for trusted, expected in [(False,403), (True,200)]:
            app = server.create_app(FakeBrowser(), OWNER, AGENT, public_origin='https://private.example',
                                    trust_loopback_proxy=trusted)
            client = TestClient(TestServer(app)); await client.start_server()
            try:
                headers = {'Host':'private.example', 'Origin':'https://private.example',
                           'Authorization':'Bearer ' + AGENT, 'X-Forwarded-Proto':'https'}
                response = await client.get('/agent/status', headers=headers)
                self.assertEqual(response.status, expected)
                headers['Host'] = 'untrusted.example'
                response = await client.get('/agent/status', headers=headers)
                self.assertEqual(response.status, 403)
            finally: await client.close()

    async def test_browser_view_is_canvas_not_a_password_collection_form(self):
        response = await self.client.get('/')
        text = await response.text()
        self.assertIn('<canvas', text)
        self.assertNotIn('<input', text)
        self.assertNotIn('<form', text)
        self.assertIn("frame-ancestors 'none'", response.headers['Content-Security-Policy'])


class ConfigurationTests(unittest.TestCase):
    def test_unsandboxed_account_browser_is_refused(self):
        with self.assertRaises(server.Refused):
            server.PlaywrightBrowser('/tmp/unused', public_preview=False, unsandboxed=True)
    def test_production_origin_must_be_https(self):
        with self.assertRaises(ValueError):
            server.create_app(FakeBrowser(), OWNER, AGENT, public_origin='http://example.com')
    def test_identical_or_short_role_capabilities_are_rejected(self):
        for owner, agent in [('x','y'), (OWNER,OWNER)]:
            with self.assertRaises(ValueError): server.create_app(FakeBrowser(), owner, agent)


if __name__ == '__main__': unittest.main()
