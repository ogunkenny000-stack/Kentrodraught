#!/usr/bin/env python3
"""Stage only approved application source; never send browser state to Docker."""
import argparse
import base64
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', type=Path, required=True)
    parser.add_argument('--extra-source', action='append', default=[], help='an additional root-level Python service source filename')
    args = parser.parse_args()
    destination = args.destination.resolve()
    if destination.exists():
        raise SystemExit('Preserve existing build contexts; choose a new destination.')
    names = ['browser_tool.py', 'mcp_server.py', 'requirements.txt', *args.extra_source]
    for name in names:
        source = ROOT / name
        if (Path(name).name != name or source.is_symlink() or not source.is_file()
                or name not in ['requirements.txt'] and source.suffix != '.py'):
            raise SystemExit('Only existing root-level Python source and requirements may be staged.')
    destination.mkdir(parents=True)
    for name in names:
        shutil.copy2(ROOT / name, destination / name)
    shutil.copy2(RUNTIME / 'Dockerfile', destination / 'Dockerfile')
    (destination / 'runtime').mkdir()
    for name in ['entrypoint.py', 'browser_smoke.py']:
        shutil.copy2(RUNTIME / name, destination / 'runtime' / name)
    # Explicit source allowlists keep profiles, capability files and keys out of
    # the Docker context. The deployment contains an agent PUBLIC key only.
    (destination / 'takeover').mkdir()
    for name in ['server.py', 'pairing.py', 'pairing.js', 'viewer.html', 'viewer.js', 'viewer.css']:
        source = ROOT / 'takeover' / name
        if source.is_symlink() or not source.is_file():
            raise SystemExit('Expected a regular browser takeover source file.')
        shutil.copy2(source, destination / 'takeover' / name)
    public = ROOT / 'deploy' / 'agent-public.pem'
    if public.is_symlink() or not public.is_file():
        raise SystemExit('Generate the deployment agent public key first.')
    # This staging step runs on the host before container dependencies exist.
    match = re.fullmatch(r'-----BEGIN PUBLIC KEY-----\s+([A-Za-z0-9+/=\s]+)-----END PUBLIC KEY-----\s*', public.read_text())
    der = base64.b64decode(''.join(match[1].split()), validate=True) if match else b''
    if len(der) != 44 or der[:12] != bytes.fromhex('302a300506032b6570032100'):
        raise SystemExit('An Ed25519 PUBLIC key is required.')
    (destination / 'deploy').mkdir()
    shutil.copy2(public, destination / 'deploy' / 'agent-public.pem')
    shutil.copy2(RUNTIME / 'context.dockerignore', destination / '.dockerignore')
    print(destination)


if __name__ == '__main__':
    main()
