#!/usr/bin/env python3
"""Offline proof for Chromium's chroot inside its private user namespace.

Only installed public libraries and tiny probe binaries enter a scratch image.
No browser, account data, image pull, network, added capability or host mount.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
import time

ROOT = Path(__file__).resolve().parent
DOCKER = ['docker', '--host=unix:///var/run/docker.sock']
ENV = {key: value for key, value in os.environ.items() if key not in
       ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']}


def run(arguments, **options):
    return subprocess.run(arguments, capture_output=True, text=True, timeout=30, env=ENV, **options)


def derive_profile():
    original = ROOT / 'playwright-seccomp.json'
    derived = ROOT / 'browser-seccomp.json'
    base = json.loads(original.read_text())
    assert base['defaultAction'] == 'SCMP_ACT_ERRNO'
    rule = dict(names=['chroot'], action='SCMP_ACT_ALLOW', args=[], includes={}, excludes={},
                comment='Allow Chromium to chroot inside its own user namespace; kernel capability checks remain enforced and no container capabilities are added.')
    base['syscalls'].append(rule)
    derived.write_text(json.dumps(base, indent=2) + '\n')
    provenance = dict(base_profile='playwright-seccomp.json',
        base_source='https://raw.githubusercontent.com/microsoft/playwright/b4695e3eb2e6736d1a7b1fd255c4e94f78553660/utils/docker/seccomp_profile.json',
        base_commit='b4695e3eb2e6736d1a7b1fd255c4e94f78553660',
        base_sha256=hashlib.sha256(original.read_bytes()).hexdigest(),
        derived_profile='browser-seccomp.json', derived_sha256=hashlib.sha256(derived.read_bytes()).hexdigest(),
        only_change=dict(operation='append_syscall_rule', rule=rule),
        added_container_capabilities=[], privileged=False, no_new_privileges=True,
        explanation='The original conditional chroot rule is omitted when CAP_SYS_CHROOT is dropped. This rule permits the syscall while the kernel still requires CAP_SYS_CHROOT in the calling user namespace.')
    (ROOT / 'browser-seccomp-source.json').write_text(json.dumps(provenance, indent=2) + '\n')
    return original, derived


def main():
    original, derived = derive_profile()
    result = dict(started=time.time(), network=False, image_pull=False, user='1000:1000',
                  cap_drop='ALL', added_capabilities=[], no_new_privileges=True,
                  privileged=False, full_browser_tested=False, tls_tested=False, results=[])
    tag = 'kaggle-browser-chroot-probe:' + str(os.getpid())
    imported = False
    with tempfile.TemporaryDirectory(prefix='browser-chroot-', dir='/tmp') as temporary:
        temporary = Path(temporary)
        source, binary = temporary / 'probe.c', temporary / 'sandbox-probe'
        source.write_text(r'''#define _GNU_SOURCE
#include <pthread.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>
#include <unistd.h>
static void *work(void *x) { return x; }
int main(int argc, char **argv) {
    if (argc > 1 && !strcmp(argv[1], "chroot")) {
        errno = 0;
        int changed = chroot("/"), saved = errno;
        printf("{\"kind\":\"chroot\",\"uid\":%d,\"result\":%d,\"errno\":%d}\n", getuid(), changed, saved);
        return changed == 0 ? 0 : 1;
    }
    pthread_t thread;
    int status = pthread_create(&thread, NULL, work, NULL);
    if (!status) status = pthread_join(thread, NULL);
    printf("{\"kind\":\"pthread\",\"result\":%d}\n", status);
    return status == 0 ? 0 : 1;
}
''')
        compiled = run(['gcc', '-O2', '-pthread', str(source), '-o', str(binary)])
        compiled.check_returncode()
        paths = {Path('/usr/bin/unshare'), Path('/usr/bin/true')}
        for executable in [binary, *paths]:
            linked = run(['ldd', str(executable)])
            linked.check_returncode()
            paths.update(Path(path) for path in re.findall(r'/[^\s()]+', linked.stdout))
        archive = temporary / 'rootfs.tar'
        with tarfile.open(archive, 'w') as output:
            def add(name, data, mode=0o755):
                entry = tarfile.TarInfo(name)
                entry.size, entry.mode = len(data), mode
                output.addfile(entry, io.BytesIO(data))
            for path in sorted(paths):
                add(str(path).lstrip('/'), path.read_bytes())
            add('usr/bin/sandbox-probe', binary.read_bytes())
            add('etc/passwd', b'root:x:0:0:root:/root:/bin/sh\nbrowser:x:1000:1000:browser:/home/browser:/bin/sh\n', 0o644)
            add('etc/group', b'root:x:0:\nbrowser:x:1000:\n', 0o644)
        result['rootfs_tar_bytes'] = archive.stat().st_size
        try:
            with archive.open('rb') as source_file:
                imported_result = subprocess.run(DOCKER + ['import', '-', tag], stdin=source_file,
                    capture_output=True, text=True, timeout=30, env=ENV)
            imported_result.check_returncode()
            imported = True
            def test(profile, kind):
                command = DOCKER + ['run', '--rm', '--pull=never', '--network=none', '--user=1000:1000',
                    '--cap-drop=ALL', '--security-opt=no-new-privileges=true', '--pids-limit=32',
                    '--memory=32m', '--cpus=.25', '--security-opt', 'seccomp=' + str(profile), tag]
                if kind == 'namespace_chroot':
                    command += ['/usr/bin/unshare', '--user', '--map-root-user', '/usr/bin/sandbox-probe', 'chroot']
                elif kind == 'namespace':
                    command += ['/usr/bin/unshare', '--user', '--map-root-user', '/usr/bin/true']
                else:
                    command += ['/usr/bin/sandbox-probe', kind]
                tested = run(command)
                record = dict(profile=profile.name, kind=kind, exit_code=tested.returncode,
                              stdout=tested.stdout.strip(), stderr=tested.stderr.strip(),
                              profile_sha256=hashlib.sha256(profile.read_bytes()).hexdigest())
                if tested.stdout.strip():
                    try: record['probe'] = json.loads(tested.stdout)
                    except ValueError: pass
                result['results'].append(record)
                return record
            old = test(original, 'namespace_chroot')
            new = test(derived, 'namespace_chroot')
            outside = test(derived, 'chroot')
            thread = test(derived, 'pthread')
            namespace = test(derived, 'namespace')
            result['derived_qualified'] = (old['exit_code'] != 0 and new['exit_code'] == 0
                and outside['exit_code'] != 0 and outside.get('probe', {}).get('errno') == 1
                and thread['exit_code'] == namespace['exit_code'] == 0)
        finally:
            if imported:
                result['owned_image_removed'] = run(DOCKER + ['image', 'rm', tag]).returncode == 0
    result['finished'] = time.time()
    (ROOT / 'chroot-probe.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    if not result['derived_qualified']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
