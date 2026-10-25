"""Download, verify and optionally extract the Kentrodraught research handoff."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile

BASE = 'https://raw.githubusercontent.com/ogunkenny000-stack/Kentrodraught/kaggle-handoff-2026-10-25/'


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('research-download'))
    parser.add_argument('--extract', action='store_true')
    args = parser.parse_args()
    local = Path(__file__).with_name('research-parts.json')
    if local.exists():
        manifest = json.loads(local.read_text())
    else:
        with urllib.request.urlopen(BASE + 'research-parts.json', timeout=60) as response:
            manifest = json.load(response)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    archive = output / manifest['archive_name']
    if not archive.exists() or sha(archive) != manifest['sha256']:
        for part in manifest['parts']:
            destination = output / part['name']
            if destination.exists() and destination.stat().st_size == part['bytes'] and sha(destination) == part['sha256']:
                print('Verified existing', part['name'], flush=True)
                continue
            temporary = destination.with_suffix(destination.suffix + '.tmp')
            print('Downloading', part['name'], flush=True)
            with urllib.request.urlopen(BASE + 'downloads/' + part['name'], timeout=120) as response, temporary.open('wb') as stream:
                shutil.copyfileobj(response, stream, 1 << 20)
                stream.flush()
                os.fsync(stream.fileno())
            if temporary.stat().st_size != part['bytes'] or sha(temporary) != part['sha256']:
                raise ValueError('Download differs from its registered checksum: ' + part['name'])
            temporary.replace(destination)
        temporary = archive.with_suffix('.tmp')
        with temporary.open('wb') as stream:
            for part in manifest['parts']:
                with (output / part['name']).open('rb') as source:
                    shutil.copyfileobj(source, stream, 1 << 20)
            stream.flush()
            os.fsync(stream.fileno())
        if temporary.stat().st_size != manifest['bytes'] or sha(temporary) != manifest['sha256']:
            raise ValueError('Reassembled archive checksum differs')
        temporary.replace(archive)
    print('Verified research archive:', archive, flush=True)
    if args.extract:
        with zipfile.ZipFile(archive) as bundle:
            for member in bundle.infolist():
                if not (output / member.filename).resolve().is_relative_to(output):
                    raise ValueError('Unexpected archive path')
            bundle.extractall(output)
        subprocess.run([sys.executable, str(output / 'research/restore_duplicates.py')], check=True)
        print('Read', output / 'research/HANDOFF.md', flush=True)


if __name__ == '__main__':
    main()
