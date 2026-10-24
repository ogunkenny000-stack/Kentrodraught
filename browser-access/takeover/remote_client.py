#!/usr/bin/env python3
"""Sign remote bridge requests without printing private keys or auth headers."""
from __future__ import annotations
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import secrets
import ssl
import sys
import time
from urllib import error, request
from urllib.parse import urlsplit

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519
from pairing import canonical_request, public_fingerprint


class NoRedirects(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('A bridge request must not redirect to another endpoint')


def private_key(path):
    path = Path(path)
    if path.stat().st_mode & 0o077:
        raise ValueError('Private-key file permissions must be0600')
    key = serialization.load_pem_private_key(path.read_bytes(), password=None)
    if not isinstance(key, ed25519.Ed25519PrivateKey):
        raise ValueError('An Ed25519 private key is required')
    return key


def generate(private_path, public_path):
    private_path, public_path = Path(private_path), Path(public_path)
    if private_path.exists() or public_path.exists():
        raise ValueError('Existing key files are preserved')
    private_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    public_path.parent.mkdir(parents=True, exist_ok=True)
    key = ed25519.Ed25519PrivateKey.generate()
    contents = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    fd = os.open(private_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'wb') as file:
        file.write(contents)
    public_path.write_bytes(key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo))
    return {'ok': True, 'private_key_file': str(private_path.resolve()), 'public_key_file': str(public_path.resolve()),
            'agent_key_fingerprint': public_fingerprint(key.public_key())}


def service_origin(metadata, key):
    if not isinstance(metadata, dict):
        raise ValueError('A deployment metadata object is required')
    if metadata.get('state') != 'ready' or metadata.get('schema_version') != 1:
        raise ValueError('The deployment is not ready')
    started = datetime.fromisoformat(metadata.get('started_at', '').replace('Z', '+00:00'))
    expires = datetime.fromisoformat(metadata.get('expires_at', '').replace('Z', '+00:00'))
    now = datetime.now(timezone.utc)
    if (started.tzinfo is None or expires.tzinfo is None or not started <= now < expires
            or not 0 < (expires - started).total_seconds() <= 7200):
        raise ValueError('The deployment has expired or has an invalid lifetime')
    origin = metadata.get('url') or metadata.get('public_url')
    p = urlsplit(origin or '')
    if p.scheme != 'https' or not p.hostname or p.username or p.password or p.path not in ['', '/'] or p.query or p.fragment or p.port not in [None, 443]:
        raise ValueError('A root HTTPS service origin is required')
    if p.hostname in ['localhost', 'localhost.localdomain'] or p.hostname.endswith('.localhost'):
        raise ValueError('Use the authenticated deployment HTTPS address')
    import ipaddress
    try:
        if not ipaddress.ip_address(p.hostname).is_global:
            raise ValueError('Private service addresses are not accepted')
    except ValueError as exc:
        # A normal DNS name is expected; literal private IPs must remain errors.
        if str(exc) == 'Private service addresses are not accepted':
            raise
    expected = public_fingerprint(key.public_key())
    if metadata.get('agent_key_fingerprint') != expected:
        raise ValueError('Deployment metadata belongs to another agent key')
    return origin.rstrip('/')


def signed_headers(key, method, path, body, *, now=None, nonce=None):
    timestamp = str(int(time.time() if now is None else now))
    nonce = nonce or secrets.token_hex(16)
    signature = key.sign(canonical_request(method, path, timestamp, nonce, body))
    return {'X-Agent-Timestamp': timestamp, 'X-Agent-Nonce': nonce,
            'X-Agent-Signature': base64.b64encode(signature).decode(), 'Content-Type': 'application/json'}


def redact(value):
    if isinstance(value, dict):
        forbidden = ['password', 'secret', 'cookie', 'authorization', 'private_key', 'owner_token', 'agent_token']
        return {key: redact(item) for key, item in value.items() if not any(word in key.lower() for word in forbidden)}
    if isinstance(value, list):
        return [redact(item) for item in value]
    return value


def call(metadata_path, key_path, method, path, data=None):
    if not path.startswith('/agent/') or '\n' in path or '\r' in path or '?' in path or '#' in path or '://' in path:
        raise ValueError('Only fixed agent API paths without query credentials are permitted')
    key = private_key(key_path)
    origin = service_origin(json.loads(Path(metadata_path).read_text()), key)
    body = b'' if data is None else json.dumps(data, separators=(',', ':'), ensure_ascii=True).encode()
    if len(body) > 16384:
        raise ValueError('Agent requests are limited to16384bytes')
    headers = signed_headers(key, method, path, body)
    context = ssl.create_default_context(cafile=os.environ.get('SSL_CERT_FILE') or None)
    opener = request.build_opener(request.ProxyHandler(), NoRedirects(), request.HTTPSHandler(context=context))
    req = request.Request(origin + path, method=method, data=body if body else None, headers=headers)
    try:
        with opener.open(req, timeout=30) as response:
            raw = response.read(65537)
    except error.HTTPError as exc:
        raw = exc.read(65537)
    if len(raw) > 65536:
        raise ValueError('Bridge response exceeded its limit')
    return redact(json.loads(raw))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    new = sub.add_parser('keygen'); new.add_argument('--private-key', type=Path, required=True); new.add_argument('--public-key', type=Path, required=True)
    send = sub.add_parser('request'); send.add_argument('--metadata', type=Path, required=True); send.add_argument('--private-key', type=Path, required=True)
    send.add_argument('--method', choices=['GET', 'POST'], default='GET'); send.add_argument('--path', required=True); send.add_argument('--json-file', type=Path)
    args = parser.parse_args()
    try:
        if args.command == 'keygen':
            result = generate(args.private_key, args.public_key)
        else:
            data = json.loads(args.json_file.read_text()) if args.json_file else None
            result = call(args.metadata, args.private_key, args.method, args.path, data)
        print(json.dumps(result))
    except Exception:
        print(json.dumps({'ok': False, 'error': 'REMOTE_BRIDGE_OPERATION_FAILED',
                          'message': 'Check metadata, key permissions, request policy, and verified HTTPS connectivity; credentials and request contents were not logged.'}))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
