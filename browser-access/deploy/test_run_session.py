"""Deployment safety/flow checks; no live Docker, hosting or account is used."""
import base64
import json
import os
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest
from unittest.mock import patch
from types import SimpleNamespace

import run_session as deploy


class DeploymentTests(unittest.TestCase):
    def test_only_exact_quick_tunnel_hosts_are_accepted(self):
        self.assertEqual(deploy.tunnel_origin('ready https://quiet-king-123.trycloudflare.com |'),
                         'https://quiet-king-123.trycloudflare.com')
        for wrong in ['http://quiet.trycloudflare.com', 'https://quiet.trycloudflare.com.evil.test',
                      'https://evil.test', 'https://-broken.trycloudflare.com']:
            self.assertIsNone(deploy.tunnel_origin(wrong))

    def test_public_metadata_contains_no_capabilities(self):
        value = self.metadata()
        self.assertEqual(set(value), deploy.METADATA_FIELDS)
        self.assertEqual(value['run_url'], 'https://github.com/owner/repository/actions/runs/42')
        self.assertNotIn('token', json.dumps(value))

    def metadata(self, **changes):
        arguments = dict(state='ready', origin='https://quiet-king.trycloudflare.com',
                         repository='owner/repository', branch='tools/kaggle-browser-access-test',
                         source_commit='a' * 40, run_id='42', fingerprint='b' * 64, started=100, expires=200)
        arguments.update(changes)
        return deploy.metadata(**arguments)

    def test_provenance_cannot_select_main_or_inject_shell(self):
        for change in [dict(branch='main'), dict(run_id='42;uname'), dict(source_commit='a' * 39),
                       dict(repository='owner/repo/extra'), dict(origin='https://evil.example'),
                       dict(fingerprint='short')]:
            with self.assertRaises(ValueError):
                self.metadata(**change)

    def test_public_key_only_ed25519_is_accepted(self):
        der = bytes.fromhex('302a300506032b6570032100') + b'X' * 32
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'public.pem'
            path.write_text('-----BEGIN PUBLIC KEY-----\n' + base64.b64encode(der).decode() + '\n-----END PUBLIC KEY-----\n')
            self.assertEqual(len(deploy.public_key_fingerprint(path)), 64)
            path.write_text('-----BEGIN PRIVATE KEY-----\nNOPE\n-----END PRIVATE KEY-----\n')
            with self.assertRaises(ValueError):
                deploy.public_key_fingerprint(path)

    def test_browser_run_has_no_host_port_or_privilege(self):
        command = deploy.browser_run_args('owned-app', 'local:test', '/public/seccomp.json', '/public/ca.pem')
        self.assertIn('--cap-drop=ALL', command)
        self.assertIn('1000:1000', command)
        self.assertIn('no-new-privileges=true', command)
        for prohibited in ['--privileged', '--cap-add', '--publish', '-p', '--network=host', '--network', '--no-sandbox']:
            self.assertNotIn(prohibited, command)
        mounts = [command[index + 1] for index, item in enumerate(command[:-1]) if item == '--mount']
        self.assertEqual(len(mounts), 1)
        self.assertTrue(mounts[0].endswith(',readonly'))
        self.assertNotIn('/browser-state', mounts[0])

    def test_tunnel_shares_only_owned_container_network(self):
        command = deploy.tunnel_run_args('owned-tunnel', 'owned-app', '/public/ca.pem')
        self.assertEqual(command[command.index('--network') + 1], 'container:owned-app')
        self.assertIn(deploy.TUNNEL_IMAGE, command)
        self.assertIn('http2', command)
        self.assertNotIn('--network=host', command)
        self.assertNotIn('--privileged', command)

    def test_server_requires_signed_agent_and_pairing(self):
        command = deploy.serve_args('owned', 'https://quiet-king.trycloudflare.com')
        self.assertIn('--owner-pairing', command)
        self.assertIn('--agent-public-key', command)
        for forbidden in ['--public-preview', '--allow-unsandboxed', '--no-sandbox']:
            self.assertNotIn(forbidden, command)

    def test_metadata_stages_and_pushes_only_session_path(self):
        calls = []
        def fake(command, **kwargs):
            calls.append(command)
            return SimpleNamespace(returncode=1 if command[:3] == ['git', 'diff', '--cached'] else 0)
        with tempfile.TemporaryDirectory() as directory, patch.object(deploy, 'run', fake):
            deploy.publish_metadata(Path(directory), self.metadata())
            self.assertTrue((Path(directory) / '.browser-access/session.json').is_file())
        self.assertEqual(calls[0], ['git', 'add', '--', '.browser-access/session.json'])
        self.assertEqual(calls[-1], ['git', 'push', 'origin', 'HEAD:refs/heads/tools/kaggle-browser-access-test'])
        self.assertNotIn('--force', calls[-1])

    def test_unexpected_metadata_field_cannot_be_published(self):
        value = self.metadata(); value['owner_token'] = 'should never publish'
        with self.assertRaises(ValueError), patch.object(deploy, 'run') as command:
            deploy.publish_metadata(Path('/unused'), value)
        command.assert_not_called()

    def test_wait_is_bounded_and_accepts_only_success(self):
        ticks = [0]
        def pause(seconds): ticks[0] += seconds
        with self.assertRaises(RuntimeError):
            deploy.bounded_wait(lambda: False, 5, clock=lambda: ticks[0], pause=pause)
        self.assertEqual(ticks[0], 5)
        self.assertEqual(deploy.bounded_wait(lambda: 'ready', 5), 'ready')

    def test_three_failed_health_checks_stop_even_when_containers_remain_up(self):
        ticks = [0]
        attempts = []
        def pause(seconds): ticks[0] += seconds
        def health(origin): attempts.append(origin); return False
        with self.assertRaises(RuntimeError):
            deploy.monitor_session('owned-app', 'owned-tunnel', 'https://quiet.trycloudflare.com',
                                   120, clock=lambda: ticks[0], pause=pause, health=health,
                                   alive=lambda _: True)
        self.assertEqual(len(attempts), 3)
        self.assertEqual(ticks[0], 30)

    def test_successful_health_resets_the_failure_counter_and_timer_expires(self):
        ticks = [0]
        outcomes = iter([False, False, True, False, False])
        def pause(seconds): ticks[0] += seconds
        deploy.monitor_session('owned-app', 'owned-tunnel', 'https://quiet.trycloudflare.com',
                               75, clock=lambda: ticks[0], pause=pause, health=lambda _: next(outcomes),
                               alive=lambda _: True)
        self.assertEqual(ticks[0], 75)

    def test_dead_container_stops_without_waiting_for_health(self):
        with self.assertRaises(RuntimeError), patch.object(deploy, 'public_health') as health:
            deploy.monitor_session('owned-app', 'owned-tunnel', 'https://quiet.trycloudflare.com',
                                   75, clock=lambda: 0, alive=lambda _: False)
        health.assert_not_called()

    def test_workflow_has_no_recursive_metadata_trigger_or_account_secret(self):
        workflow = (Path(__file__).parent / 'kaggle-browser.yml').read_text()
        self.assertIn("- 'browser-access/**'", workflow)
        self.assertNotIn('.browser-access/session.json', workflow)
        self.assertNotIn('.browser-access/diagnostics.json', workflow)
        self.assertNotIn('secrets.', workflow)
        self.assertIn('timeout-minutes: 150', workflow)
        self.assertIn('runs-on: ubuntu-22.04', workflow)
        self.assertIn('--seconds 7200', workflow)
        self.assertIn('cancel-in-progress: false', workflow)
        self.assertNotIn('upload-artifact', workflow)

    def test_invalid_ttl_stops_before_docker(self):
        for duration in [0, 7201]:
            args = SimpleNamespace(checkout=Path('/unused'), seconds=duration)
            with self.assertRaises(ValueError), patch.object(deploy, 'run') as command:
                deploy.session(args)
            command.assert_not_called()

    def test_failed_real_browser_smoke_never_publishes_and_cleans_owned_containers(self):
        calls = []
        def fake(command, **kwargs):
            command = [str(item) for item in command]; calls.append(command)
            if command[-1] == '/app/runtime/browser_smoke.py':
                raise subprocess.CalledProcessError(1, command)
            return SimpleNamespace(returncode=0, stdout='', stderr='')
        environment = dict(GITHUB_REPOSITORY='owner/repository',
                           GITHUB_REF_NAME='tools/kaggle-browser-access-test',
                           GITHUB_RUN_ID='42', GITHUB_SHA='a' * 40)
        with tempfile.TemporaryDirectory() as directory:
            args = SimpleNamespace(checkout=Path(directory), seconds=60, ca=Path('/public/ca.pem'))
            with patch.dict(os.environ, environment), patch.object(deploy, 'run', fake), \
                 patch.object(deploy, 'public_key_fingerprint', return_value='b' * 64), \
                 patch.object(deploy, 'publish_metadata') as publish:
                with self.assertRaises(subprocess.CalledProcessError):
                    deploy.session(args)
                publish.assert_not_called()
        self.assertIn(['docker', 'rm', '--force', 'kaggle-browser-42-tunnel', 'kaggle-browser-42-app'], calls)
        self.assertFalse(any(deploy.TUNNEL_IMAGE in command for command in calls))

    def test_public_health_failure_cleans_up_without_ready_metadata(self):
        calls = []
        def fake(command, **kwargs):
            calls.append([str(item) for item in command])
            return SimpleNamespace(returncode=0, stdout='', stderr='')
        environment = dict(GITHUB_REPOSITORY='owner/repository',
                           GITHUB_REF_NAME='tools/kaggle-browser-access-test',
                           GITHUB_RUN_ID='42', GITHUB_SHA='a' * 40)
        with tempfile.TemporaryDirectory() as directory:
            args = SimpleNamespace(checkout=Path(directory), seconds=60, ca=Path('/public/ca.pem'))
            with patch.dict(os.environ, environment), patch.object(deploy, 'run', fake), \
                 patch.object(deploy, 'public_key_fingerprint', return_value='b' * 64), \
                 patch.object(deploy, 'bounded_wait', side_effect=['https://quiet.trycloudflare.com', RuntimeError('TLS health failed')]), \
                 patch.object(deploy, 'publish_metadata') as publish:
                with self.assertRaises(RuntimeError):
                    deploy.session(args)
                publish.assert_not_called()
        self.assertIn(['docker', 'rm', '--force', 'kaggle-browser-42-tunnel', 'kaggle-browser-42-app'], calls)

    def test_build_failure_report_has_fixed_stage_and_bounded_tail(self):
        error = deploy.PreloginCommandError(7, ['docker', 'build'], output='\n'.join(f'build line {i}' for i in range(100)))
        value = deploy.failure_diagnostics('build', error, run_id='42', source_commit='a' * 40)
        self.assertEqual(value['stage'], 'build')
        self.assertEqual(value['returncode'], 7)
        self.assertEqual(len(value['build_tail']), 30)
        self.assertEqual(value['build_tail'][0], 'build line 70')
        self.assertNotIn('message', value)

    def test_sensitive_prelogin_output_is_withheld_entirely(self):
        for text in ['password=hidden', 'Authorization: Bearer hidden', 'https://name:password@example.test/path',
                     'owner_token: hidden', 'private_key: hidden', 'api_token=hidden', 'secret=hidden']:
            tail, withheld = deploy.safe_prelogin_tail('normal line\n' + text)
            self.assertEqual(tail, [])
            self.assertTrue(withheld)

    def test_late_failure_cannot_include_process_or_container_output(self):
        error = deploy.PreloginCommandError(1, ['unpublished'], output='sensitive late browser output')
        value = deploy.failure_diagnostics('monitor', error, run_id='42', source_commit='a' * 40,
                                          container_tail='sensitive late container output')
        self.assertNotIn('sensitive', json.dumps(value))
        self.assertNotIn('prelogin_container_tail', value)
        self.assertNotIn('smoke_command_tail', value)

    def test_unknown_error_name_and_message_are_not_reported(self):
        class SecretException(Exception): pass
        value = deploy.failure_diagnostics('server_start', SecretException('hidden message'),
                                          run_id='42', source_commit='a' * 40)
        self.assertEqual(value['error_class'], 'Exception')
        self.assertNotIn('hidden', json.dumps(value))

    def test_smoke_report_allows_only_public_prelogin_flags(self):
        raw = dict(authenticated=False, chromium_sandbox=True, state='failed', error_type='TargetClosedError',
                   sandbox_diagnostic='untrusted text', owner_token='must not appear', http_status=200,
                   title='never include titles', target='never include addresses')
        with patch.object(deploy, 'run', return_value=SimpleNamespace(returncode=0, stdout=json.dumps(raw))):
            value = deploy.smoke_report('owned-app')
        self.assertEqual(value, dict(authenticated=False, chromium_sandbox=True, state='failed',
                                     error_type='TargetClosedError', http_status=200))
        raw['authenticated'] = True
        with patch.object(deploy, 'run', return_value=SimpleNamespace(returncode=0, stdout=json.dumps(raw))):
            self.assertIsNone(deploy.smoke_report('owned-app'))

    def test_bounded_capture_keeps_only_last_thirty_lines(self):
        result = deploy.run([sys.executable, '-c', 'for i in range(100): print(i)'], capture=True, bounded=True)
        self.assertEqual(result.stdout.splitlines(), [str(i) for i in range(70, 100)])

    def test_diagnostics_push_has_no_recursive_source_path(self):
        value = deploy.failure_diagnostics('container_start', RuntimeError('do not publish this'),
                                          run_id='42', source_commit='a' * 40)
        calls = []
        def fake(command, **kwargs):
            calls.append(command)
            return SimpleNamespace(returncode=1 if command[:3] == ['git', 'diff', '--cached'] else 0)
        with tempfile.TemporaryDirectory() as directory, patch.object(deploy, 'run', fake):
            deploy.publish_diagnostics(directory, 'tools/kaggle-browser-access-test', value)
            self.assertTrue((Path(directory) / '.browser-access/diagnostics.json').is_file())
        self.assertEqual(calls[0], ['git', 'add', '--', '.browser-access/diagnostics.json'])
        self.assertEqual(calls[-1][-1], 'HEAD:refs/heads/tools/kaggle-browser-access-test')


if __name__ == '__main__':
    unittest.main()
