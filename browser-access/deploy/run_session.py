#!/usr/bin/env python3
"""Run an expiring, isolated GitHub Actions browser; publish public metadata only.

This file does not log in to Kaggle, collect credentials, or generate agent keys.
The only committed session values are a public HTTPS URL and public provenance.
"""
from __future__ import annotations

import argparse
import base64
from collections import deque
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from urllib import request
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
PYTHON_IMAGE = 'python@sha256:57d96f71de145a98e7ceca18ee4ade77bba4103a33a72dfaea026b23625c6bf0'
TUNNEL_IMAGE = 'cloudflare/cloudflared@sha256:c3f24df7c5e68c1467afc5486c155689f247eb02246b3a124fc5f42458728672'
TUNNEL_PATTERN = re.compile(r'https://([a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com)(?![a-z0-9.-])')
BRANCH_PATTERN = re.compile(r'^tools/kaggle-browser-access-[A-Za-z0-9_-]+$')
METADATA_FIELDS = {'schema_version', 'state', 'url', 'repository', 'branch', 'source_commit',
                   'run_id', 'run_url', 'started_at', 'expires_at', 'agent_key_fingerprint'}
STAGES = {'staging', 'build', 'container_start', 'browser_smoke', 'tunnel_start',
          'tunnel_discovery', 'server_start', 'public_health', 'publish_session', 'monitor'}
DIAGNOSTIC_FIELDS = {'schema_version', 'stage', 'error_class', 'returncode', 'source_commit',
                     'run_id', 'recorded_at', 'build_tail', 'build_tail_withheld', 'smoke',
                     'prelogin_container_tail', 'prelogin_container_tail_withheld',
                     'smoke_command_tail', 'smoke_command_tail_withheld'}
CREDENTIAL_PATTERN = re.compile(r'password|passwd|authorization|bearer\s|cookie|private[ _-]?key|'
    r'owner[ _-]?token|agent[ _-]?token|(?:access|refresh|api|github)[ _-]?token|'
    r'\b(?:ghp_|github_pat_|gho_|gocspx-)[A-Za-z0-9_-]+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|'
    r'https?://[^\s/@]+:[^\s/@]+@|(?:secret|credential)\s*[:=]', re.I)


class PreloginCommandError(subprocess.CalledProcessError):
    """Bounded, never automatically printed output from a pre-login command."""
    pass


def run(argv, *, capture=False, check=True, cwd=None, bounded=False):
    """No shell expansion, no environment dumps, no inherited credential copies."""
    if bounded:
        if not capture:
            raise ValueError('Bounded commands require capture')
        process = subprocess.Popen([str(part) for part in argv], cwd=cwd, text=True,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        tail = deque(maxlen=30)
        with process.stdout:
            while True:
                line = process.stdout.readline(4097)
                if not line:
                    break
                tail.append(line[:1024])
        status = process.wait()
        output = ''.join(tail)[-16384:]
        if check and status:
            raise PreloginCommandError(status, [str(part) for part in argv], output=output)
        return subprocess.CompletedProcess(argv, status, stdout=output, stderr='')
    return subprocess.run([str(part) for part in argv], check=check, cwd=cwd,
                          text=True, stdout=subprocess.PIPE if capture else None,
                          stderr=subprocess.PIPE if capture else None)


def tunnel_origin(logs):
    matches = TUNNEL_PATTERN.findall(logs)
    if not matches:
        return None
    value = 'https://' + matches[-1]
    parsed = urlsplit(value)
    if parsed.port is not None or parsed.username or parsed.password:
        raise ValueError('Unexpected tunnel origin')
    return value


def public_key_fingerprint(path):
    """Parse only the deployment's public Ed25519 SubjectPublicKeyInfo PEM."""
    pem = Path(path).read_text()
    match = re.fullmatch(r'-----BEGIN PUBLIC KEY-----\s+([A-Za-z0-9+/=\s]+)-----END PUBLIC KEY-----\s*', pem)
    if not match:
        raise ValueError('A public key PEM is required')
    der = base64.b64decode(''.join(match[1].split()), validate=True)
    # RFC8410 Ed25519 SPKI: sequence(algorithm(1.3.101.112), 32-byte bitstring).
    if len(der) != 44 or der[:12] != bytes.fromhex('302a300506032b6570032100'):
        raise ValueError('Only an Ed25519 public key is accepted')
    return hashlib.sha256(der).hexdigest()


def utcstamp(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat().replace('+00:00', 'Z')


def metadata(*, state, origin, repository, branch, source_commit, run_id, fingerprint, started, expires):
    if state not in {'ready', 'closed', 'failed'} or not BRANCH_PATTERN.fullmatch(branch):
        raise ValueError('Invalid deployment metadata')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise ValueError('Invalid repository name')
    if not re.fullmatch(r'[0-9a-f]{40}', source_commit) or not str(run_id).isdigit():
        raise ValueError('Invalid public provenance')
    if not re.fullmatch(r'[0-9a-f]{64}', fingerprint) or tunnel_origin(origin or '') != origin:
        raise ValueError('Invalid public deployment address or key')
    result = dict(schema_version=1, state=state, url=origin, repository=repository, branch=branch,
                  source_commit=source_commit, run_id=str(run_id),
                  run_url=f'https://github.com/{repository}/actions/runs/{run_id}',
                  started_at=utcstamp(started), expires_at=utcstamp(expires), agent_key_fingerprint=fingerprint)
    assert set(result) == METADATA_FIELDS
    return result


def publish_metadata(checkout, value):
    """Use Actions' scoped checkout credential; never read or print its value."""
    if set(value) != METADATA_FIELDS:
        raise ValueError('Unexpected session metadata fields')
    publish_public_json(checkout, value['branch'], 'session.json', value)


def publish_public_json(checkout, branch, filename, value):
    checkout = Path(checkout)
    if filename not in {'session.json', 'diagnostics.json'}:
        raise ValueError('Only fixed public reporting paths are allowed')
    if not BRANCH_PATTERN.fullmatch(branch):
        raise ValueError('Refusing to push to a non-session branch')
    relative = '.browser-access/' + filename
    path = checkout / relative
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n')
    run(['git', 'add', '--', relative], cwd=checkout)
    changed = run(['git', 'diff', '--cached', '--quiet', '--', relative],
                  cwd=checkout, check=False, capture=True)
    if changed.returncode == 0:
        return
    if changed.returncode != 1:
        raise RuntimeError('Could not inspect session metadata change')
    run(['git', '-c', 'user.name=Browser Session', '-c', 'user.email=browser-session@users.noreply.github.com',
         'commit', '-m', 'Update public ephemeral browser status', '--', relative], cwd=checkout)
    run(['git', 'push', 'origin', f'HEAD:refs/heads/{branch}'], cwd=checkout)


def safe_prelogin_tail(output):
    """Reject a whole tail if credential-like content is present; never redact-and-hope."""
    if not isinstance(output, str):
        return [], False
    if CREDENTIAL_PATTERN.search(output) or any(ord(char) < 32 and char not in '\n\r\t' for char in output):
        return [], True
    lines = output.splitlines()[-30:]
    return [line[:512] for line in lines][-30:], False


def smoke_report(browser_name):
    """Read the independent pre-login smoke JSON, never a browser profile or page."""
    result = run(['docker', 'exec', browser_name, 'cat', '/browser-state/browser-smoke.json'],
                 capture=True, check=False, bounded=True)
    if result.returncode:
        return None
    try:
        raw = json.loads(result.stdout)
    except (ValueError, TypeError):
        return None
    if not isinstance(raw, dict) or raw.get('authenticated') is not False:
        return None
    flags = {'authenticated', 'browser_tested', 'tls_tested', 'ignore_https_errors', 'chromium_sandbox',
             'setuid_helper_disabled', 'namespace_sandbox_reported', 'seccomp_sandbox_reported'}
    safe = {key: value for key, value in raw.items() if key in flags and type(value) is bool}
    if raw.get('state') in {'passed', 'failed'}:
        safe['state'] = raw['state']
    if type(raw.get('http_status')) is int and 100 <= raw['http_status'] <= 599:
        safe['http_status'] = raw['http_status']
    if raw.get('error_type') in {'RuntimeError', 'TimeoutError', 'Error', 'TargetClosedError', 'OSError'}:
        safe['error_type'] = raw['error_type']
    if raw.get('failure_reason') in {'thread_creation_failed', 'namespace_creation_denied', 'sandbox_unavailable',
            'tls_certificate_rejected', 'configured_proxy_failed', 'browser_executable_missing',
            'shared_library_missing', 'kernel_permission_denied', 'unclassified_browser_failure'}:
        safe['failure_reason'] = raw['failure_reason']
    if raw.get('browser_exit_signal') in {'SIGTRAP', 'SIGABRT', 'SIGSEGV', 'SIGKILL', 'SIGILL', 'SIGSYS'}:
        safe['browser_exit_signal'] = raw['browser_exit_signal']
    stderr = raw.get('prelogin_browser_stderr')
    if isinstance(stderr, list) and all(isinstance(line, str) for line in stderr):
        lines, withheld = safe_prelogin_tail('\n'.join(stderr))
        safe['prelogin_browser_stderr'], safe['prelogin_browser_stderr_withheld'] = lines, withheld
    return safe


def failure_diagnostics(stage, error, *, run_id, source_commit, smoke=None, container_tail=None):
    if stage not in STAGES or not str(run_id).isdigit() or not re.fullmatch(r'[0-9a-f]{40}', source_commit):
        raise ValueError('Invalid diagnostic provenance')
    error_class = type(error).__name__
    if error_class not in {'PreloginCommandError', 'CalledProcessError', 'RuntimeError', 'ValueError',
                           'OSError', 'FileNotFoundError', 'PermissionError'}:
        error_class = 'Exception'
    code = getattr(error, 'returncode', None)
    if type(code) is not int or not -255 <= code <= 255:
        code = None
    result = dict(schema_version=1, stage=stage, error_class=error_class, returncode=code,
                  source_commit=source_commit, run_id=str(run_id), recorded_at=utcstamp(time.time()))
    # Only fixed pre-login phases may contribute process output. Later exceptions
    # expose stage/class/code only, never server logs or exception/request values.
    if stage in {'build', 'browser_smoke'}:
        tail, withheld = safe_prelogin_tail(getattr(error, 'output', None))
        prefix = 'build' if stage == 'build' else 'smoke_command'
        result[prefix + '_tail'], result[prefix + '_tail_withheld'] = tail, withheld
    if stage in {'container_start', 'browser_smoke'} and container_tail is not None:
        result['prelogin_container_tail'], result['prelogin_container_tail_withheld'] = safe_prelogin_tail(container_tail)
    if smoke is not None:
        # The caller supplies only smoke_report's strict field allowlist.
        result['smoke'] = smoke
    return result


def publish_diagnostics(checkout, branch, value):
    if set(value) - DIAGNOSTIC_FIELDS:
        raise ValueError('Unexpected diagnostic fields')
    publish_public_json(checkout, branch, 'diagnostics.json', value)


def browser_run_args(name, image, seccomp, ca):
    return ['docker', 'run', '--detach', '--name', name, '--init', '--user', '1000:1000',
            '--cap-drop=ALL', '--security-opt', 'no-new-privileges=true',
            '--security-opt', f'seccomp={Path(seccomp).resolve()}', '--pids-limit', '512',
            '--shm-size', '256m', '--memory', '2g', '--cpus', '2',
            '--mount', f'type=bind,src={Path(ca).resolve()},dst=/run/public-ca.pem,readonly',
            '--env', 'BROWSER_PUBLIC_CA_FILE=/run/public-ca.pem',
            '--env', 'SSL_CERT_FILE=/run/public-ca.pem', '--env', 'NODE_EXTRA_CA_CERTS=/run/public-ca.pem',
            image, 'sleep', 'infinity']


def tunnel_run_args(name, browser_name, ca):
    return ['docker', 'run', '--detach', '--name', name, '--cap-drop=ALL',
            '--security-opt', 'no-new-privileges=true', '--pids-limit', '128', '--memory', '256m',
            '--network', f'container:{browser_name}',
            '--mount', f'type=bind,src={Path(ca).resolve()},dst=/run/public-ca.pem,readonly',
            '--env', 'SSL_CERT_FILE=/run/public-ca.pem', TUNNEL_IMAGE,
            'tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', 'http://127.0.0.1:8765',
            '--metrics', '127.0.0.1:49312']


def serve_args(browser_name, origin):
    return ['docker', 'exec', '--detach', browser_name,
            'python', '/app/takeover/server.py', 'serve', '--listen', '127.0.0.1', '--port', '8765',
            '--state', '/browser-state/account', '--public-origin', origin, '--trust-loopback-proxy',
            '--agent-public-key', '/app/deploy/agent-public.pem', '--owner-pairing']


def container_alive(name):
    result = run(['docker', 'inspect', '--format', '{{.State.Running}}', name], capture=True, check=False)
    return result.returncode == 0 and result.stdout.strip() == 'true'


class NoRedirects(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('The public browser health endpoint must not redirect')


def public_health(origin):
    try:
        opener = request.build_opener(request.ProxyHandler(), NoRedirects())
        # Normal system CA validation remains enabled. No credential is sent.
        with opener.open(origin + '/health', timeout=10) as response:
            data = json.loads(response.read(4096))
            return response.status == 200 and data == {'ok': True, 'service': 'browser-takeover'}
    except Exception:
        return False


def bounded_wait(predicate, timeout, *, interval=2, clock=time.monotonic, pause=time.sleep):
    deadline = clock() + timeout
    while clock() < deadline:
        result = predicate()
        if result:
            return result
        pause(min(interval, max(0, deadline - clock())))
    raise RuntimeError('Browser deployment readiness timed out')


def monitor_session(browser_name, tunnel_name, origin, seconds, *, clock=time.monotonic,
                    pause=time.sleep, health=None, alive=None):
    """A detached server can fail while its sleep-container remains running."""
    health = health or public_health
    alive = alive or container_alive
    deadline = clock() + seconds
    failures = 0
    while clock() < deadline:
        if not alive(browser_name) or not alive(tunnel_name):
            raise RuntimeError('An owned browser service exited')
        failures = 0 if health(origin) else failures + 1
        if failures >= 3:
            raise RuntimeError('The public browser health check failed three times')
        pause(min(15, max(0, deadline - clock())))


def session(args):
    checkout = args.checkout.resolve()
    if args.seconds < 60 or args.seconds > 7200:
        raise ValueError('Browser lifetime must be between60and7200seconds')
    repository, branch, run_id, source_commit = [os.environ.get(name, '') for name in
        ['GITHUB_REPOSITORY', 'GITHUB_REF_NAME', 'GITHUB_RUN_ID', 'GITHUB_SHA']]
    fingerprint = public_key_fingerprint(ROOT / 'deploy' / 'agent-public.pem')
    # Validate provenance before Docker work, using a syntactically valid placeholder.
    metadata(state='ready', origin='https://preflight-only.trycloudflare.com', repository=repository,
             branch=branch, source_commit=source_commit, run_id=run_id, fingerprint=fingerprint,
             started=time.time(), expires=time.time() + args.seconds)
    owned = 'kaggle-browser-' + run_id
    browser_name, tunnel_name = owned + '-app', owned + '-tunnel'
    image = owned + ':local'
    context = Path(tempfile.mkdtemp(prefix='kaggle-browser-context-')) / 'build'
    origin = None
    record = None
    stage = 'staging'
    smoke = None
    try:
        run([sys.executable, ROOT / 'runtime' / 'prepare_build_context.py', '--destination', context])
        stage = 'build'
        run(['docker', 'build', '--build-arg', f'BASE_IMAGE={PYTHON_IMAGE}', '--secret',
             f'id=proxy_ca,src={args.ca.resolve()}', '--tag', image, context], capture=True, bounded=True)
        stage = 'container_start'
        run(browser_run_args(browser_name, image, ROOT / 'runtime' / 'playwright-seccomp.json', args.ca), capture=True)
        # A real normal-TLS Chrome check with namespace + seccomp assertions. A failure
        # stops deployment; no unsandboxed or certificate-bypass fallback is offered.
        stage = 'browser_smoke'
        run(['docker', 'exec', browser_name, 'python', '/app/runtime/browser_smoke.py'], capture=True, bounded=True)
        smoke = smoke_report(browser_name)
        stage = 'tunnel_start'
        run(tunnel_run_args(tunnel_name, browser_name, args.ca), capture=True)
        def locate():
            if not container_alive(tunnel_name):
                raise RuntimeError('The tunnel exited before readiness')
            logs = run(['docker', 'logs', tunnel_name], capture=True)
            return tunnel_origin(logs.stdout + logs.stderr)
        stage = 'tunnel_discovery'
        origin = bounded_wait(locate, 60)
        stage = 'server_start'
        run(serve_args(browser_name, origin), capture=True)
        stage = 'public_health'
        bounded_wait(lambda: public_health(origin), 60)
        started = time.time()
        record = metadata(state='ready', origin=origin, repository=repository, branch=branch,
                          source_commit=source_commit, run_id=run_id, fingerprint=fingerprint,
                          started=started, expires=started + args.seconds)
        stage = 'publish_session'
        publish_metadata(checkout, record)
        print(json.dumps(record), flush=True)
        stage = 'monitor'
        monitor_session(browser_name, tunnel_name, origin, args.seconds)
        record['state'] = 'closed'
    except Exception as error:
        if record:
            record['state'] = 'failed'
        summary = failure_diagnostics(stage, error, run_id=run_id, source_commit=source_commit)
        print('::error title=Ephemeral browser deployment failed::'
              f"stage={stage} error_class={summary['error_class']} returncode={summary['returncode']}", flush=True)
        try:
            container_tail = None
            if stage in {'container_start', 'browser_smoke'}:
                logs = run(['docker', 'logs', browser_name], capture=True, check=False, bounded=True)
                container_tail = logs.stdout
            if stage == 'browser_smoke' and smoke is None:
                smoke = smoke_report(browser_name)
            diagnostic = failure_diagnostics(stage, error, run_id=run_id, source_commit=source_commit,
                                             smoke=smoke, container_tail=container_tail)
            publish_diagnostics(checkout, branch, diagnostic)
            print(json.dumps({'public_diagnostics': '.browser-access/diagnostics.json', 'stage': stage}), flush=True)
        except Exception:
            print('Public sanitized failure report could not be saved.', flush=True)
        raise
    finally:
        # Only deterministic, run-owned containers are touched. Profiles are not
        # bind-mounted and are discarded with their private writable layer.
        run(['docker', 'rm', '--force', tunnel_name, browser_name], capture=True, check=False)
        run(['docker', 'image', 'rm', image], capture=True, check=False)
        shutil.rmtree(context.parent, ignore_errors=True)
        if record:
            publish_metadata(checkout, record)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkout', type=Path, required=True)
    parser.add_argument('--seconds', type=int, default=7200)
    parser.add_argument('--ca', type=Path, default=Path('/etc/ssl/certs/ca-certificates.crt'))
    args = parser.parse_args()
    try:
        session(args)
    except Exception:
        # Raw SDK/browser exceptions and request inputs are intentionally absent.
        parser.exit(1, 'Ephemeral browser deployment failed; no account connection is established.\n')


if __name__ == '__main__':
    main()
