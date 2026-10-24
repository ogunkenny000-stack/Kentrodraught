"""Reject stale/misdirected deployments before signing any HTTP request."""
from datetime import datetime, timedelta, timezone
import tempfile
from pathlib import Path
import unittest

from cryptography.hazmat.primitives.asymmetric import ed25519
import remote_client


class RemoteClientTests(unittest.TestCase):
    def setUp(self):
        self.key = ed25519.Ed25519PrivateKey.generate()
        now = datetime.now(timezone.utc)
        self.metadata = dict(schema_version=1, state='ready',
            started_at=(now - timedelta(seconds=1)).isoformat(),
            expires_at=(now + timedelta(seconds=60)).isoformat(),
            url='https://owned-browser.trycloudflare.com',
            agent_key_fingerprint=remote_client.public_fingerprint(self.key.public_key()))

    def test_ready_origin_with_matching_public_key(self):
        self.assertEqual(remote_client.service_origin(self.metadata, self.key), self.metadata['url'])

    def test_nonready_expired_and_excessive_lifetime_are_rejected(self):
        bad = [dict(self.metadata, state='failed'), dict(self.metadata, state='closed'),
            dict(self.metadata, schema_version=2),
            dict(self.metadata, expires_at='2020-01-01T00:00:00+00:00'),
            dict(self.metadata, expires_at='2099-01-01T00:00:00+00:00')]
        for record in bad:
            with self.subTest(record=record), self.assertRaises(ValueError):
                remote_client.service_origin(record, self.key)

    def test_key_mismatch_and_non_https_or_private_origins_are_rejected(self):
        other = ed25519.Ed25519PrivateKey.generate()
        with self.assertRaises(ValueError):
            remote_client.service_origin(self.metadata, other)
        for origin in ['http://example.com', 'https://127.0.0.1', 'https://10.0.0.1',
                       'https://localhost', 'https://example.com/?token=x',
                       'https://example.com/#token=x', 'https://user:pass@example.com']:
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                remote_client.service_origin(dict(self.metadata, url=origin), self.key)

    def test_keygen_preserves_existing_files_and_restricts_private_permissions(self):
        with tempfile.TemporaryDirectory() as temporary:
            private, public = [Path(temporary) / name for name in ['private.pem', 'public.pem']]
            result = remote_client.generate(private, public)
            self.assertEqual(private.stat().st_mode & 0o777, 0o600)
            self.assertEqual(result['agent_key_fingerprint'], remote_client.public_fingerprint(remote_client.private_key(private).public_key()))
            with self.assertRaises(ValueError):
                remote_client.generate(private, public)
            private.chmod(0o644)
            with self.assertRaises(ValueError):
                remote_client.private_key(private)
