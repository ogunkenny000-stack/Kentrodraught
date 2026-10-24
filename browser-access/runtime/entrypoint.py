#!/usr/bin/env python3
"""Initialize only this dedicated container's own public Chromium trust store."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def main():
    if os.geteuid() == 0:
        raise SystemExit('Run this dedicated browser container as its nonroot browser user.')
    # HOME is set normally by Docker from /etc/passwd. Never repoint the outer
    # execution environment or use its existing private NSS/browser state.
    home = Path.home()
    if home != Path('/home/browser'):
        raise SystemExit('The dedicated container must resolve its browser home to /home/browser.')
    trust = home / '.pki/nssdb'
    trust.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not (trust / 'cert9.db').exists():
        subprocess.run(['certutil', '-N', '--empty-password', '-d', 'sql:' + str(trust)], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    ca = os.environ.get('BROWSER_PUBLIC_CA_FILE')
    count = 0
    if ca:
        source = Path(ca)
        data = source.read_bytes()
        certificates = re.findall(br'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----', data, re.S)
        if not certificates:
            raise SystemExit('The mounted public CA file has no PEM certificates.')
        for certificate in certificates:
            name = 'ManagedBrowserCA-' + hashlib.sha256(certificate).hexdigest()[:24]
            exists = subprocess.run(['certutil', '-L', '-n', name, '-d', 'sql:' + str(trust)],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
            if not exists:
                subprocess.run(['certutil', '-A', '-n', name, '-t', 'C,,', '-d', 'sql:' + str(trust)],
                               input=certificate + b'\n', stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                               check=True)
            count += 1
    print(json.dumps({'dedicated_container_trust_ready': True, 'public_ca_certificates': count}), flush=True)
    command = sys.argv[1:]
    if not command:
        raise SystemExit('Pass the browser smoke or interactive service command.')
    os.execvp(command[0], command)


if __name__ == '__main__':
    main()
