"""Actual cryptographic and HTTP authorization tests; no real account data."""
import asyncio
import base64
import json
import importlib.util
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import unittest

from aiohttp.test_utils import TestClient, TestServer
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, padding, rsa

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pairing
import remote_client
import server
from test_server import FakeBrowser

NOW = 1792830000
OWNER = 'owner-capability-for-tests-' + 'x' * 40
AGENT = 'unused-agent-bearer-' + 'y' * 40
RSA = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def jwk(key=RSA.public_key()):
    numbers = key.public_numbers()
    def integer(n):
        return pairing.b64url(n.to_bytes((n.bit_length() + 7) // 8, 'big'))
    return {'kty': 'RSA', 'n': integer(numbers.n), 'e': integer(numbers.e),
            'alg': 'RSA-OAEP-256', 'ext': True, 'key_ops': ['encrypt']}


class MemoryRequest(dict):
    def __init__(self, key, *, body=b'', method='POST', path='/agent/action', now=NOW, nonce=None, gate=None):
        super().__init__()
        self.method, self.raw_path, self.body, self.gate = method, path, body, gate
        self.headers = remote_client.signed_headers(key, method, path, body, now=now, nonce=nonce)
    async def read(self):
        if self.gate:
            await self.gate()
        return self.body


class SignatureTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.key = ed25519.Ed25519PrivateKey.generate()
        self.now = NOW
        self.verifier = pairing.AgentVerifier(self.key.public_key(), clock=lambda: self.now)

    async def test_signed_request_is_idempotent_only_for_same_request_object(self):
        nonce = secrets.token_hex(16)
        request = MemoryRequest(self.key, body=b'{"action":"snapshot"}', nonce=nonce)
        self.assertIs(await self.verifier(request), True)
        self.assertIs(await self.verifier(request), True)
        self.assertIs(await self.verifier(MemoryRequest(self.key, body=request.body, nonce=nonce)), False)

    async def test_method_path_query_body_and_key_are_bound_to_signature(self):
        for component in ['method', 'path', 'query', 'body', 'key']:
            with self.subTest(component=component):
                request = MemoryRequest(self.key, body=b'{"action":"snapshot"}')
                if component == 'method': request.method = 'GET'
                elif component == 'path': request.raw_path = '/agent/status'
                elif component == 'query': request.raw_path += '?x=1'
                elif component == 'body': request.body = b'{"action":"navigate"}'
                elif component == 'key':
                    request = MemoryRequest(ed25519.Ed25519PrivateKey.generate())
                self.assertIs(await self.verifier(request), False)

    async def test_time_window_malformed_signatures_and_large_body_fail_closed(self):
        for offset in [-61, 61]:
            self.assertFalse(await self.verifier(MemoryRequest(self.key, now=NOW + offset)))
        request = MemoryRequest(self.key)
        request.headers['X-Agent-Signature'] = 'not base64!'
        self.assertFalse(await self.verifier(request))
        request = MemoryRequest(self.key)
        request.headers['X-Agent-Nonce'] = 'nonce-not-32-hex'
        self.assertFalse(await self.verifier(request))
        self.assertFalse(await self.verifier(MemoryRequest(self.key, body=b'x' * 16385)))

    async def test_replay_cache_is_bounded_and_expired_records_pruned(self):
        verifier = pairing.AgentVerifier(self.key.public_key(), clock=lambda: self.now, max_nonces=1)
        self.assertTrue(await verifier(MemoryRequest(self.key)))
        self.assertFalse(await verifier(MemoryRequest(self.key)))
        self.now += 121
        self.assertTrue(await verifier(MemoryRequest(self.key, now=self.now)))
        self.assertEqual(len(verifier.seen), 1)

    async def test_concurrent_duplicate_nonce_is_accepted_at_most_once(self):
        entered = 0
        gate = asyncio.Event()
        async def both_read():
            nonlocal entered
            entered += 1
            if entered == 2: gate.set()
            await gate.wait()
        nonce = secrets.token_hex(16)
        requests = [MemoryRequest(self.key, nonce=nonce, gate=both_read) for _ in range(2)]
        results = await asyncio.wait_for(asyncio.gather(*(self.verifier(r) for r in requests)), 2)
        self.assertEqual(sum(result is True for result in results), 1,
                         'Replay checking must be atomic across the await request.read() boundary')

    async def test_slow_body_cannot_extend_signature_freshness(self):
        async def delay():
            self.now += 61
        self.assertFalse(await self.verifier(MemoryRequest(self.key, gate=delay)))

    async def test_concurrent_distinct_requests_cannot_exceed_replay_capacity(self):
        verifier = pairing.AgentVerifier(self.key.public_key(), clock=lambda: self.now, max_nonces=1)
        entered = 0
        gate = asyncio.Event()
        async def both_read():
            nonlocal entered
            entered += 1
            if entered == 2: gate.set()
            await gate.wait()
        requests = [MemoryRequest(self.key, gate=both_read) for _ in range(2)]
        results = await asyncio.wait_for(asyncio.gather(*(verifier(r) for r in requests)), 2)
        self.assertEqual(sum(result is True for result in results), 1)
        self.assertEqual(len(verifier.seen), 1)


class PairingHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.key = ed25519.Ed25519PrivateKey.generate()
        self.now = NOW
        self.verifier = pairing.AgentVerifier(self.key.public_key(), clock=lambda: self.now)
        self.app = server.create_app(FakeBrowser(), OWNER, AGENT, agent_verifier=self.verifier, pairing_enabled=True)
        self.pairing = self.app[server.PAIRING]
        self.pairing.clock = lambda: self.now
        self.client = TestClient(TestServer(self.app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()

    async def signed(self, method, path, data=None, headers=None):
        body = b'' if data is None else json.dumps(data, separators=(',', ':')).encode()
        supplied = headers or remote_client.signed_headers(self.key, method, path, body, now=self.now)
        return await self.client.request(method, path, data=body, headers=supplied)

    async def register(self, public=None):
        response = await self.client.post('/pair/request', json={'public_key': public or jwk()})
        self.assertEqual(response.status, 200)
        return await response.json()

    async def test_pairing_delivers_only_rsa_encrypted_owner_capability(self):
        record = await self.register()
        self.assertEqual(record['fingerprint'], pairing.public_fingerprint(RSA.public_key()))
        pending = await self.client.get('/agent/pair/pending')
        self.assertEqual(pending.status, 401)
        pending = await self.signed('GET', '/agent/pair/pending')
        self.assertEqual(pending.status, 200)
        self.assertEqual(len((await pending.json())['pending']), 1)
        approval = {k: record[k] for k in ['pairing_id', 'fingerprint']}
        response = await self.signed('POST', '/agent/pair/approve', approval)
        self.assertEqual(response.status, 200)
        self.assertNotIn(OWNER, await response.text())
        response = await self.client.get('/pair/result/' + record['pairing_id'])
        result = await response.json()
        self.assertNotIn(OWNER, json.dumps(result))
        self.assertEqual(result['state'], 'approved')
        ciphertext = pairing.unb64url(result['ciphertext'])
        plaintext = RSA.decrypt(ciphertext, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
        self.assertEqual(plaintext.decode(), OWNER)
        wrong_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        with self.assertRaises(ValueError):
            wrong_key.decrypt(ciphertext, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
        response = await self.client.get('/owner/status', headers={'Authorization': 'Bearer ' + plaintext.decode()})
        self.assertEqual(response.status, 200)

    async def test_bad_fingerprint_does_not_approve_and_requests_expire(self):
        record = await self.register()
        response = await self.signed('POST', '/agent/pair/approve', {'pairing_id':record['pairing_id'], 'fingerprint':'0' * 64})
        self.assertEqual(response.status, 404)
        self.assertIsNone(self.pairing.approved_id)
        self.now += 301
        response = await self.client.get('/pair/result/' + record['pairing_id'])
        self.assertEqual(response.status, 404)

    async def test_only_one_owner_even_after_delivery_record_expires(self):
        record = await self.register()
        response = await self.signed('POST', '/agent/pair/approve', {k:record[k] for k in ['pairing_id','fingerprint']})
        self.assertEqual(response.status, 200)
        self.now += 301
        response = await self.client.post('/pair/request', json={'public_key':jwk()})
        self.assertEqual(response.status, 409)
        self.assertEqual((await response.json())['error'], 'OWNER_ALREADY_PAIRED')

    async def test_duplicate_public_key_reuses_pending_record(self):
        first, second = await self.register(), await self.register()
        self.assertEqual(first['pairing_id'], second['pairing_id'])
        self.assertEqual(len(self.pairing.pending), 1)

    async def test_pairing_rejects_private_weak_and_unexpected_key_members(self):
        invalid = [dict(jwk(), d='never-a-private-key'), dict(jwk(), surprise='x'),
                   dict(jwk(), alg='RSA1_5'), dict(jwk(), e='Aw'),
                   jwk(rsa.generate_private_key(public_exponent=65537, key_size=1024).public_key())]
        for key in invalid:
            with self.subTest(key_fields=list(key)):
                response = await self.client.post('/pair/request', json={'public_key':key})
                self.assertEqual(response.status, 400)
        self.assertEqual(len(self.pairing.pending), 0)

    async def test_signed_agent_request_cannot_use_legacy_bearer_or_be_replayed(self):
        response = await self.client.get('/agent/status', headers={'Authorization': 'Bearer ' + AGENT})
        self.assertEqual(response.status, 401)
        headers = remote_client.signed_headers(self.key, 'GET', '/agent/status', b'', now=self.now)
        response = await self.signed('GET', '/agent/status', headers=headers)
        self.assertEqual(response.status, 200)
        response = await self.signed('GET', '/agent/status', headers=headers)
        self.assertEqual(response.status, 401)

    async def test_config_and_javascript_return_no_capabilities(self):
        for path in ['/config', '/pairing.js', '/']:
            response = await self.client.get(path)
            self.assertEqual(response.status, 200)
            text = await response.text()
            self.assertNotIn(OWNER, text)
            self.assertNotIn(AGENT, text)
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
        script = Path(__file__).with_name('pairing.js').read_text()
        self.assertIn("hash: 'SHA-256'}, false", script)
        self.assertIn("exportKey('jwk', keys.publicKey)", script)
        self.assertNotIn("exportKey('jwk', keys.privateKey)", script)
        self.assertNotIn('localStorage', script)
        self.assertNotIn('sessionStorage', script)


class FrontendCryptoTests(unittest.TestCase):
    def test_actual_pairing_javascript_with_webcrypto(self):
        # Execute the shipped script against real WebCrypto, while replacing
        # only its DOM and same-origin HTTP interfaces. No browser/account or
        # external network is needed for this interoperability check.
        node = shutil.which('node')
        if not node:
            spec = importlib.util.find_spec('playwright')
            if spec and spec.submodule_search_locations:
                bundled = Path(next(iter(spec.submodule_search_locations))) / 'driver' / 'node'
                if bundled.is_file(): node = str(bundled)
        self.assertIsNotNone(node, 'Node or the installed Playwright Node driver is required')
        harness = r'''
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {webcrypto} = require('node:crypto');
globalThis.crypto = webcrypto;
globalThis.window = {isSecureContext: true, crypto: webcrypto};
const element = () => ({style: {}, append() {}, remove() {}});
globalThis.document = {createElement: element, body: {prepend() {}}};
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn) => realSetTimeout(fn, 0);
const realGenerate = webcrypto.subtle.generateKey.bind(webcrypto.subtle);
webcrypto.subtle.generateKey = async (...args) => {
  assert.equal(args[1], false);
  const keys = await realGenerate(...args);
  assert.equal(keys.privateKey.extractable, false);
  assert.equal(keys.publicKey.extractable, true);
  return keys;
};
const realExport = webcrypto.subtle.exportKey.bind(webcrypto.subtle);
webcrypto.subtle.exportKey = async (format, key) => {
  assert.notEqual(key.type, 'private', 'The page must never export its private key');
  return realExport(format, key);
};
const capability = 'test-owner-capability-' + 'x'.repeat(48);
let ciphertext, fingerprint, registrations = 0, deliveries = 0;
globalThis.fetch = async (path, options) => {
  assert.equal(options.cache, 'no-store');
  if (path === '/pair/request') {
    registrations++;
    const jwk = JSON.parse(options.body).public_key;
    for (const field of ['d','p','q','dp','dq','qi']) assert.equal(jwk[field], undefined);
    const key = await webcrypto.subtle.importKey('jwk', jwk, {name:'RSA-OAEP', hash:'SHA-256'}, true, ['encrypt']);
    const publicDer = await realExport('spki', key);
    fingerprint = Buffer.from(await webcrypto.subtle.digest('SHA-256', publicDer)).toString('hex');
    ciphertext = Buffer.from(await webcrypto.subtle.encrypt({name:'RSA-OAEP'}, key, Buffer.from(capability))).toString('base64url');
    return {ok: true, json: async () => ({ok: true, pairing_id:'test-pair', fingerprint, expires_at:Date.now()/1000+30})};
  }
  assert.equal(path, '/pair/result/test-pair');
  deliveries++;
  return {ok:true, json:async () => ({ok:true, state:'approved', fingerprint, ciphertext, algorithm:'RSA-OAEP-256'})};
};
eval(fs.readFileSync(process.argv[1], 'utf8'));
window.bridgePairing(async received => {assert.equal(received, capability);})
  .then(() => {assert.equal(registrations,1); assert.equal(deliveries,1); process.stdout.write('WEBCRYPTO_PAIRING_OK');})
  .catch(() => {process.stderr.write('WebCrypto pairing contract failed'); process.exitCode=1;});
'''
        result = subprocess.run([node, '-e', harness, str(Path(__file__).with_name('pairing.js'))],
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, 'WEBCRYPTO_PAIRING_OK')


if __name__ == '__main__':
    unittest.main()
