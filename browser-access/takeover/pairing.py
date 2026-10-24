"""Signed agent requests and browser-only encryption of the owner capability.

This is a custom remote-desktop authorization layer, not a platform credential
form. Account keystrokes belong to the separate owner channel. This module
never returns owner capabilities in plaintext or asks for account credentials.
"""
from __future__ import annotations

import base64
from collections import OrderedDict
import hashlib
import json
import re
import secrets
import time
from pathlib import Path

from aiohttp import web
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, padding, rsa

NONCE = re.compile(r"^[0-9a-f]{32}$")
FINGERPRINT = re.compile(r"^[0-9a-f]{64}$")
PRIVATE_RSA_MEMBERS = {'d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'}


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode('ascii').rstrip('=')


def unb64url(value: str) -> bytes:
    if not isinstance(value, str) or len(value) > 2048 or not re.fullmatch(r'[A-Za-z0-9_-]+', value):
        raise ValueError('Invalid public-key encoding')
    return base64.b64decode(value + '=' * (-len(value) % 4), altchars=b'-_', validate=True)


def public_fingerprint(key) -> str:
    public = key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return hashlib.sha256(public).hexdigest()


def canonical_request(method: str, raw_path: str, timestamp: str, nonce: str, body: bytes) -> bytes:
    if any('\n' in item or '\r' in item for item in [method, raw_path, timestamp, nonce]):
        raise ValueError('Invalid signed-request components')
    return '\n'.join([method.upper(), raw_path, timestamp, nonce, hashlib.sha256(body).hexdigest()]).encode('utf-8')


class AgentVerifier:
    """Verify Ed25519 agent requests with time limits and bounded replay storage."""
    def __init__(self, public_key, *, clock=time.time, skew_seconds=60, nonce_ttl_seconds=120, max_nonces=10000):
        if isinstance(public_key, (str, Path)):
            public_key = serialization.load_pem_public_key(Path(public_key).read_bytes())
        elif isinstance(public_key, bytes):
            public_key = serialization.load_pem_public_key(public_key)
        if not isinstance(public_key, ed25519.Ed25519PublicKey):
            raise ValueError('An Ed25519 public key is required')
        if not 1 <= skew_seconds <= 300 or nonce_ttl_seconds < 2 * skew_seconds or not 1 <= max_nonces <= 100000:
            raise ValueError('Unsafe signed-request bounds')
        self.key, self.clock = public_key, clock
        self.skew, self.ttl, self.max_nonces = skew_seconds, nonce_ttl_seconds, max_nonces
        self.seen = OrderedDict()
        self.fingerprint = public_fingerprint(public_key)
        self._request_key = '__verified_agent_' + secrets.token_hex(16)

    async def __call__(self, request):
        # An aiohttp middleware and the pairing endpoint may both validate the
        # same in-memory request. Never consume its nonce twice.
        if request.get(self._request_key) is self:
            return True
        try:
            timestamp = request.headers.get('X-Agent-Timestamp', '')
            nonce = request.headers.get('X-Agent-Nonce', '')
            signature = request.headers.get('X-Agent-Signature', '')
            if not re.fullmatch(r'[0-9]{10,12}', timestamp) or not NONCE.fullmatch(nonce):
                return False
            now = self.clock()
            if abs(now - int(timestamp)) > self.skew:
                return False
            while self.seen and next(iter(self.seen.values())) <= now:
                self.seen.popitem(last=False)
            if nonce in self.seen or len(self.seen) >= self.max_nonces:
                return False
            decoded = base64.b64decode(signature, validate=True)
            if len(decoded) != 64:
                return False
            body = await request.read()
            if len(body) > 16384:
                return False
            # Reading a slow request body yields to other requests. Recheck
            # both freshness and replay storage afterwards: another request
            # may have consumed this nonce while the body was arriving. There
            # are no awaits between this check and recording a valid nonce.
            now = self.clock()
            if abs(now - int(timestamp)) > self.skew:
                return False
            while self.seen and next(iter(self.seen.values())) <= now:
                self.seen.popitem(last=False)
            if nonce in self.seen or len(self.seen) >= self.max_nonces:
                return False
            self.key.verify(decoded, canonical_request(request.method, request.raw_path, timestamp, nonce, body))
            self.seen[nonce] = now + self.ttl
            request[self._request_key] = self
            return True
        except (ValueError, TypeError, InvalidSignature, OverflowError):
            return False


def rsa_public_jwk(jwk):
    if not isinstance(jwk, dict) or jwk.get('kty') != 'RSA' or PRIVATE_RSA_MEMBERS & set(jwk):
        raise ValueError('Supply an RSA public key only')
    if set(jwk) - {'kty', 'n', 'e', 'alg', 'ext', 'key_ops', 'use'}:
        raise ValueError('Unexpected public-key members')
    if jwk.get('alg', 'RSA-OAEP-256') != 'RSA-OAEP-256' or jwk.get('use', 'enc') != 'enc':
        raise ValueError('RSA-OAEP-256 is required')
    key_ops = jwk.get('key_ops', ['encrypt'])
    if not isinstance(key_ops, list) or set(key_ops) - {'encrypt', 'wrapKey'}:
        raise ValueError('Public encryption operations only')
    n, e = int.from_bytes(unb64url(jwk.get('n')), 'big'), int.from_bytes(unb64url(jwk.get('e')), 'big')
    if e != 65537:
        raise ValueError('RSA exponent 65537 is required')
    key = rsa.RSAPublicNumbers(e, n).public_key()
    if key.key_size < 2048 or key.key_size > 4096:
        raise ValueError('RSA public key must contain 2048 through 4096 bits')
    return key


class OwnerPairing:
    """Bounded one-owner pairing; approvals require the full public fingerprint."""
    def __init__(self, owner_token: str, verifier, *, clock=time.time, ttl_seconds=300, maximum=16):
        if not isinstance(owner_token, str) or not 32 <= len(owner_token.encode()) <= 120:
            raise ValueError('Owner capability must be high entropy and fit RSA-OAEP')
        if not 1 <= ttl_seconds <= 300 or not 1 <= maximum <= 16:
            raise ValueError('Unsafe owner-pairing bounds')
        self._token, self.verifier, self.clock = owner_token, verifier, clock
        self.ttl, self.maximum = ttl_seconds, maximum
        self.pending, self.approved_id = {}, None
        self._lock = __import__('asyncio').Lock()

    def prune(self):
        now = self.clock()
        self.pending = {k: v for k, v in self.pending.items() if v['expires'] > now}
        # An approved owner keeps the capability for this server lifetime.
        # Expiring the public delivery record must not permit a second owner.

    async def request(self, request):
        async with self._lock:
            self.prune()
            if self.approved_id is not None:
                return web.json_response({'ok': False, 'error': 'OWNER_ALREADY_PAIRED'}, status=409)
            if len(self.pending) >= self.maximum:
                return web.json_response({'ok': False, 'error': 'PAIRING_QUEUE_FULL'}, status=429)
            try:
                data = await request.json()
                if not isinstance(data, dict) or set(data) != {'public_key'}:
                    raise ValueError('A public key is required')
                key = rsa_public_jwk(data['public_key'])
            except (ValueError, TypeError, KeyError, json.JSONDecodeError):
                return web.json_response({'ok': False, 'error': 'INVALID_PAIRING_KEY'}, status=400)
            fingerprint = public_fingerprint(key)
            # Refreshes cannot fill the queue with duplicate requests.
            for pair_id, old in self.pending.items():
                if old['fingerprint'] == fingerprint:
                    return web.json_response({'ok': True, 'pairing_id': pair_id, 'fingerprint': fingerprint,
                                              'expires_at': old['expires']})
            pair_id = secrets.token_urlsafe(24)
            record = dict(key=key, fingerprint=fingerprint, expires=self.clock() + self.ttl, ciphertext=None)
            self.pending[pair_id] = record
            return web.json_response({'ok': True, 'pairing_id': pair_id, 'fingerprint': fingerprint,
                                      'expires_at': record['expires']})

    async def result(self, request):
        self.prune()
        record = self.pending.get(request.match_info['pair_id'])
        if record is None:
            return web.json_response({'ok': False, 'error': 'PAIRING_NOT_FOUND_OR_EXPIRED'}, status=404)
        result = {'ok': True, 'fingerprint': record['fingerprint'], 'state': 'approved' if record['ciphertext'] else 'pending'}
        if record['ciphertext']:
            result.update(ciphertext=record['ciphertext'], algorithm='RSA-OAEP-256')
        return web.json_response(result)

    async def listing(self, request):
        if await self.verifier(request) is not True:
            return web.json_response({'ok': False, 'error': 'UNAUTHORIZED'}, status=401)
        self.prune()
        return web.json_response({'ok': True, 'pending': [dict(pairing_id=k, fingerprint=v['fingerprint'],
            expires_at=v['expires']) for k, v in self.pending.items() if not v['ciphertext']],
            'owner_paired': self.approved_id is not None})

    async def approve(self, request):
        if await self.verifier(request) is not True:
            return web.json_response({'ok': False, 'error': 'UNAUTHORIZED'}, status=401)
        async with self._lock:
            self.prune()
            try:
                data = await request.json()
                if not isinstance(data, dict) or set(data) != {'pairing_id', 'fingerprint'}:
                    raise ValueError()
                pair_id, fingerprint = data['pairing_id'], data['fingerprint']
                if not isinstance(pair_id, str) or not isinstance(fingerprint, str) or not FINGERPRINT.fullmatch(fingerprint):
                    raise ValueError()
            except (ValueError, TypeError, KeyError, json.JSONDecodeError):
                return web.json_response({'ok': False, 'error': 'INVALID_PAIRING_APPROVAL'}, status=400)
            record = self.pending.get(pair_id)
            if record is None or not secrets.compare_digest(record['fingerprint'], fingerprint):
                return web.json_response({'ok': False, 'error': 'PAIRING_NOT_FOUND_OR_MISMATCH'}, status=404)
            if self.approved_id is not None and self.approved_id != pair_id:
                return web.json_response({'ok': False, 'error': 'OWNER_ALREADY_PAIRED'}, status=409)
            if not record['ciphertext']:
                encrypted = record['key'].encrypt(self._token.encode(), padding.OAEP(
                    mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
                record['ciphertext'] = b64url(encrypted)
                self.approved_id = pair_id
            return web.json_response({'ok': True, 'state': 'approved', 'pairing_id': pair_id,
                                      'fingerprint': fingerprint})


def install_pairing(app, owner_token, verifier):
    pairing = OwnerPairing(owner_token, verifier)
    app.router.add_post('/pair/request', pairing.request)
    app.router.add_get('/pair/result/{pair_id}', pairing.result)
    app.router.add_get('/agent/pair/pending', pairing.listing)
    app.router.add_post('/agent/pair/approve', pairing.approve)
    return pairing
