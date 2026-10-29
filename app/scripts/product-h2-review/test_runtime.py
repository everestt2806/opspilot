"""Nghiệm thu Linux độc lập: guard/file/HMAC thật, Docker giả có state và journal.

Không socket/network; không dùng mock receipt thành công để thay thế target runtime.
"""
from __future__ import annotations

import copy
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, '/subject')
import target_product_runtime as runtime
import target_execution_guard as guard

FIXTURE = json.loads(Path('/fixtures.json').read_text())
SECRET = bytes(range(32))


class StatefulDocker:
    def __init__(self, context):
        self.context = context
        self.active = False
        self.cancelled = runtime.threading.Event()
        self.calls = []
        self.records = {}
        self.images = {}
        self.unhealthy = False
        self.fail = None
        if context['previous']:
            previous = context['previous']
            self.images[previous['image_tag']] = self.image('1', previous['deployment_id'], previous['source_sha'])
            self.add('1', context['app_name'] + '-app', '1', previous['deployment_id'], previous['source_sha'])
            self.add('a', context['app_name'] + '-collector', 'd', previous['deployment_id'], previous['source_sha'])
        if context['candidate_image_id']:
            self.images[context['candidate_image_tag']] = self.image('2', context['deployment_id'], context['source_sha'])

    def labels(self, deployment, sha):
        return {'opspilot.app_id': str(self.context['claim']['app_id']),
                'opspilot.deployment_id': str(deployment), 'org.opencontainers.image.revision': sha}

    def image(self, digit, deployment, sha):
        return {'Id': 'sha256:' + digit * 64, 'Config': {'Labels': self.labels(deployment, sha)}}

    def add(self, digit, name, image, deployment, sha):
        identity = digit * 64
        self.records[identity] = {'Id': identity, 'Name': '/' + name, 'Image': 'sha256:' + image * 64,
            'Config': {'Labels': self.labels(deployment, sha)}, 'HostConfig': {}, 'Mounts': [],
            'State': {'Running': True}}
        return identity

    def container(self, name):
        return next((copy.deepcopy(r) for r in self.records.values() if r['Name'] == '/' + name), None)

    def inspect(self, kind, reference):
        if kind == 'image':
            result = self.images[reference]
        elif kind == 'network':
            c = self.context
            result = {'Name': c['app_name'] + '-network', 'Labels': {
                'opspilot.app_id': str(c['claim']['app_id']),
                'opspilot.controller_id': c['claim']['controller_id'],
                'opspilot.ownership_generation': str(c['claim']['ownership_generation'])}}
        else:
            result = self.records[reference]
        return copy.deepcopy(result)

    def run(self, args, timeout=10, capture=True):
        self.calls.append(list(args))
        if self.fail == args[0]:
            raise runtime.RuntimeUnknown('SSH_RUNTIME_COMMAND_FAILED')
        operation = args[0]
        if operation == 'network':
            return 'fixture-network'
        if operation == 'build':
            tag = args[args.index('-t') + 1]
            self.images[tag] = self.image('d', self.context['deployment_id'], self.context['source_sha'])
        elif operation == 'stop':
            self.records[args[-1]]['State']['Running'] = False
        elif operation == 'start':
            self.records[args[-1]]['State']['Running'] = True
        elif operation == 'rename':
            self.records[args[1]]['Name'] = '/' + args[2]
        elif operation == 'run':
            name = args[args.index('--name') + 1]
            digit = 'c' if name.endswith('-collector') else '2'
            return self.add(digit, name, 'd' if digit == 'c' else '2',
                            self.context['deployment_id'], self.context['source_sha'])
        elif operation == 'exec':
            return json.dumps({'http_status': 503 if args[1] == '2' * 64 and self.unhealthy else 200})
        return ''


class TargetReview(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='h2-leader-')
        self.base = Path(self.temporary.name)
        self.handles = []

    def tearDown(self):
        for handle in reversed(self.handles):
            handle.__exit__(None, None, None)
        self.temporary.cleanup()

    def create(self, previous=True, build_failed=False, app_id=1, root=None):
        context = copy.deepcopy(FIXTURE['failed' if build_failed else 'succeeded']['context'])
        context['claim']['app_id'] = app_id
        context['health_timeout_ms'] = 100
        if not previous:
            context['previous'] = None
        state = root or self.base / 'state'
        guard.initialize_enrollment(state, context['claim']['controller_id'], str(app_id), 1)
        runtime.initialize_runtime_enrollment(state, context['claim']['controller_id'], str(app_id), 1, SECRET)
        identity = guard.ExecutionIdentity(context['claim']['controller_id'], str(app_id), 1,
            context['claim']['job_id'], context['claim']['attempt_id'], context['claim']['app_fence'])
        execution = guard.acquire_execution(state, identity)
        execution.__enter__()
        self.handles.append(execution)
        subject = runtime.ProductRuntime(execution, self.base / 'transfer', context['deployment_id'],
            'failed' if build_failed else 'succeeded', context['candidate_image_tag'], context['source_sha'])
        subject.configure(context)
        subject.commands = StatefulDocker(context)
        return subject

    def step(self, subject, name):
        subject.start_step(name)
        subject.worker.join(3)
        self.assertFalse(subject.worker.is_alive())
        result = subject.poll()
        self.assertEqual(result.get('step'), name)
        return result

    def healthy(self):
        subject = self.create()
        for name in ('prepare', 'activate', 'health', 'publish'):
            self.assertEqual(self.step(subject, name)['state'], 'step_succeeded')
        return subject

    def attestation(self, subject, envelope):
        context = subject.context
        payload = {'version': 1, 'kind': 'product-h2-commit', 'commit_id': 'fixture-commit',
            'receipt_sha256': envelope['receipt_sha256'], 'context_sha256': runtime.hash_h2(context),
            'execution_nonce': context['execution_nonce'], 'attempt_id': context['claim']['attempt_id'],
            'deployment_id': context['deployment_id'], 'outcome': envelope['receipt']['outcome']}
        return {'payload': payload, 'signature': runtime.sign_h2(SECRET, 'product-h2:commit', payload)}

    def test_golden_crypto_interoperability(self):
        for item in FIXTURE['goldens']:
            self.assertEqual(runtime.canonical_json(item['value']).decode(), item['canonical'])
            self.assertEqual(runtime.hash_h2(item['value']), item['hash'])
            for domain, signature in item['signatures'].items():
                self.assertEqual(runtime.sign_h2(SECRET, 'product-h2:' + domain, item['value']), signature)

    def test_success_real_target_seal_and_settle(self):
        subject = self.healthy()
        envelope = subject.seal()
        self.assertEqual(envelope['receipt']['outcome'], 'succeeded')
        self.assertEqual(json.loads(subject.receipt_path.read_text()), envelope)
        self.assertEqual(subject.receipt_path.stat().st_mode & 0o777, 0o600)
        ack = subject.settle(self.attestation(subject, envelope))
        self.assertEqual(json.loads(subject.ack_path.read_text()), ack)
        self.assertEqual(guard._read_marker(subject.execution._marker_path)['execution_state'], 'idle')

    def test_failed_build_preserves_previous_and_emits_optional_boundary(self):
        subject = self.create(build_failed=True)
        progress = self.step(subject, 'prepare')
        self.assertNotIn('boundary', progress)
        self.assertFalse(any(call[0] in {'stop', 'start', 'run', 'build', 'rename'} for call in subject.commands.calls))
        envelope = subject.seal()
        self.assertEqual(envelope['receipt']['failed_step'], 'BUILD')
        self.assertIsNone(envelope['receipt']['boundary'])
        self.assertTrue(subject.commands.records['1' * 64]['State']['Running'])

    def test_rollback_boundary_and_previous_identity(self):
        subject = self.create()
        for step in ('prepare', 'activate'):
            self.step(subject, step)
        b0 = dict(subject.boundary)
        with subject.metrics_path.open('ab') as output:
            output.write(b'candidate-bytes\n')
        subject.commands.unhealthy = True
        self.assertEqual(self.step(subject, 'health')['state'], 'step_failed')
        self.assertEqual(self.step(subject, 'rollback')['state'], 'step_succeeded')
        envelope = subject.seal()
        self.assertEqual(envelope['receipt']['outcome'], 'rolled_back')
        self.assertGreater(envelope['receipt']['boundary']['next_offset'], b0['next_offset'])
        self.assertEqual(envelope['receipt']['active_runtime']['container_id'], '1' * 64)

    def test_first_deploy_unhealthy_never_forges_rollback(self):
        subject = self.create(previous=False)
        for step in ('prepare', 'activate'):
            self.step(subject, step)
        subject.commands.unhealthy = True
        self.step(subject, 'health')
        envelope = subject.seal()
        self.assertEqual(envelope['receipt']['outcome'], 'failed')
        self.assertIsNone(envelope['receipt']['active_runtime'])

    def test_wrong_candidate_image_fails_before_activation(self):
        subject = self.create()
        subject.commands.images[subject.context['candidate_image_tag']]['Id'] = 'sha256:' + '9' * 64
        self.assertEqual(self.step(subject, 'prepare')['state'], 'unknown')
        self.assertFalse(any(call[0] == 'run' for call in subject.commands.calls))
        with self.assertRaises(runtime.RuntimeRejected):
            subject.seal()

    def test_collector_build_failure_is_unknown_and_never_seals(self):
        subject = self.create()
        subject.commands.fail = 'build'
        self.assertEqual(self.step(subject, 'prepare')['state'], 'unknown')
        with self.assertRaises(runtime.RuntimeRejected):
            subject.seal()

    def test_seal_refuses_live_worker_or_command(self):
        subject = self.healthy()
        subject.commands.active = True
        with self.assertRaises(runtime.RuntimeRejected):
            subject.seal()

    def test_seal_refuses_app_that_died_after_health(self):
        subject = self.healthy()
        subject.commands.records['2' * 64]['State']['Running'] = False
        with self.assertRaises(runtime.RuntimeRejected):
            subject.seal()

    def test_seal_refuses_collector_that_died_after_health(self):
        subject = self.healthy()
        subject.commands.records['c' * 64]['State']['Running'] = False
        with self.assertRaises(runtime.RuntimeRejected):
            subject.seal()

    def test_seal_refuses_http_regression_after_publish(self):
        subject = self.healthy()
        subject.commands.unhealthy = True
        with self.assertRaises(runtime.RuntimeRejected):
            subject.seal()

    def test_seal_refuses_collector_image_or_config_drift(self):
        for field in ('Image', 'Config'):
            with self.subTest(field=field):
                # Mỗi subtest dùng state root riêng để không overwrite enrollment.
                old_base = self.base
                self.base = old_base / field
                self.base.mkdir()
                subject = self.healthy()
                if field == 'Image':
                    subject.commands.records['c' * 64]['Image'] = 'sha256:' + '9' * 64
                else:
                    subject.commands.records['c' * 64]['Config']['Unexpected'] = 'fixture'
                with self.assertRaises(runtime.RuntimeRejected):
                    subject.seal()
                self.base = old_base

    def test_private_secret_permissions_and_symlink_rejected(self):
        subject = self.create()
        secret = runtime._secret_path(subject.root, subject.execution.identity)
        secret.chmod(0o644)
        with self.assertRaises(runtime.RuntimeRejected):
            runtime._read_private(secret, 32)
        secret.chmod(0o600)
        link = self.base / 'secret-link'
        link.symlink_to(secret)
        with self.assertRaises(runtime.RuntimeRejected):
            runtime._read_private(link, 32)

    def test_enrollment_refuses_implicit_rotation(self):
        subject = self.create()
        with self.assertRaises(runtime.RuntimeRejected):
            runtime.initialize_runtime_enrollment(subject.root, subject.context['claim']['controller_id'],
                '1', 1, bytes([255] * 32))
        self.assertEqual(runtime._read_private(runtime._secret_path(subject.root, subject.execution.identity), 32), SECRET)

    def test_stale_target_fence_blocks_before_any_docker_mutation(self):
        subject = self.create()
        marker = guard._read_marker(subject.execution._marker_path)
        marker['highest_accepted_fence'] += 1
        guard._write_marker_atomic(subject.execution._marker_path, marker)
        with self.assertRaises(guard.TargetGuardError):
            subject.start_step('prepare')
        self.assertEqual(subject.commands.calls, [])

    def test_wrong_hmac_domain_cannot_settle(self):
        subject = self.healthy()
        envelope = subject.seal()
        attestation = self.attestation(subject, envelope)
        attestation['signature'] = runtime.sign_h2(SECRET, 'product-h2:receipt', attestation['payload'])
        with self.assertRaises(runtime.RuntimeRejected):
            subject.settle(attestation)
        self.assertFalse(subject.ack_path.exists())

    def test_seal_write_failure_never_returns_undurable_receipt(self):
        subject = self.healthy()
        with patch.object(runtime, '_write_private', side_effect=OSError('FIXTURE_DISK_FAILURE')):
            with self.assertRaises(OSError):
                subject.seal()
        self.assertFalse(subject.receipt_path.exists())
        envelope = subject.seal()
        self.assertTrue(subject.receipt_path.exists(), 'receipt returned without durable file')
        self.assertEqual(json.loads(subject.receipt_path.read_text()), envelope)

    def test_metrics_path_matches_existing_monitor_contract(self):
        subject = self.create()
        self.assertEqual(subject.metrics_path,
            Path('/opt/opspilot') / subject.context['app_name'] / 'metrics' / 'metrics.jsonl')

    def test_boundary_generation_matches_ssh_monitor_identity(self):
        subject = self.create()
        self.step(subject, 'prepare')
        boundary = subject.boundary
        self.assertEqual(boundary['generation'], f"{boundary['device']}:{boundary['inode']}")

    def test_existing_collector_metric_file_0644_is_preserved(self):
        subject = self.create()
        directory = runtime._metrics_directory(subject.context['app_name'])
        metric = directory / 'metrics.jsonl'
        metric.write_bytes(b'previous-metric\n')
        metric.chmod(0o644)
        try:
            progress = self.step(subject, 'prepare')
            self.assertEqual(progress['state'], 'step_succeeded')
            self.assertEqual(progress['boundary']['next_offset'], len(b'previous-metric\n') + 1)
            self.assertEqual(metric.read_bytes(), b'previous-metric\n')
            self.assertEqual(metric.stat().st_mode & 0o777, 0o644)
        finally:
            metric.chmod(0o600)

    def test_ack_durable_before_idle_and_recovery_idempotent_without_runtime_replay(self):
        subject = self.healthy()
        envelope = subject.seal()
        attestation = self.attestation(subject, envelope)
        with patch.object(runtime, '_write_marker_atomic', side_effect=OSError('FIXTURE_CRASH_AFTER_ACK')):
            with self.assertRaises(OSError):
                subject.settle(attestation)
        first_ack = json.loads(subject.ack_path.read_text())
        self.assertEqual(guard._read_marker(subject.execution._marker_path)['execution_state'], 'unknown')
        subject.execution.__exit__(None, None, None)
        recovery = runtime.RecoveryRuntime(str(subject.root), subject.context, attestation)
        try:
            self.assertEqual(recovery.settle(attestation), first_ack)
            self.assertEqual(recovery.settle(attestation), first_ack)
            with self.assertRaises(guard.TargetGuardError):
                recovery.execution.authorize_write_phase('activate')
        finally:
            recovery.close()

    def test_forged_attestation_never_clears_unknown(self):
        subject = self.healthy()
        envelope = subject.seal()
        attestation = self.attestation(subject, envelope)
        attestation['signature'] = '0' * 64
        with self.assertRaises(runtime.RuntimeRejected):
            subject.settle(attestation)
        self.assertFalse(subject.ack_path.exists())
        self.assertEqual(guard._read_marker(subject.execution._marker_path)['execution_state'], 'unknown')

    def test_unknown_attempt_cannot_reopen_for_normal_mutation(self):
        subject = self.create()
        subject.execution.__exit__(None, None, None)
        with self.assertRaises(guard.TargetGuardError):
            with guard.acquire_execution(subject.root, subject.execution.identity):
                self.fail('normal unknown replay accepted')


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(TargetReview)
    result = unittest.TestResult()
    suite.run(result)
    failures = [{'id': case.id().split('.')[-1], 'status': 'FAIL'} for case, _ in result.failures]
    errors = [{'id': case.id().split('.')[-1], 'status': 'ERROR'} for case, _ in result.errors]
    print(json.dumps({'scope': 'LINUX_REAL_TARGET_CONTROLLED_DOCKER', 'total': result.testsRun,
        'passed': result.testsRun - len(failures) - len(errors), 'failures': failures, 'errors': errors}))
    raise SystemExit(1 if failures or errors else 0)
