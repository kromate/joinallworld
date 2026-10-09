import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[2] / 'scripts/world/check-source-packet.py'


class SourcePacketCliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.path = 'src/cities/example/facts.ts'
        self.blob = b'export const sourcedFact = true\n'
        (self.repo / self.path).parent.mkdir(parents=True)
        (self.repo / self.path).write_bytes(self.blob)
        self.git('init', '-q')
        self.git('config', 'user.email', 'source-packet-test@example.invalid')
        self.git('config', 'user.name', 'Source Packet Test')
        self.git('add', self.path)
        self.git('commit', '-q', '-m', 'fixture source')
        self.ref = self.git('rev-parse', 'HEAD').stdout.decode().strip()
        self.packet = self.root / 'packet.json'

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.run(
            ['git', '-C', str(self.repo), *args], check=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10,
        )

    def write_packet(self, entries=None):
        if entries is None:
            entries = [{'path': self.path, 'bytes': len(self.blob), 'sha256': hashlib.sha256(self.blob).hexdigest()}]
        self.packet.write_text(json.dumps({'schemaVersion': 1, 'sourceFiles': entries}))
        return self.packet

    def run_checker(self, *extra, ref=None, packets=None):
        command = [sys.executable, str(SCRIPT), '--target', str(self.repo), '--ref', ref or self.ref]
        for packet in packets or [self.packet]:
            command.extend(['--packet', str(packet)])
        command.extend(extra)
        return subprocess.run(command, check=False, capture_output=True, text=True, timeout=20)

    def result(self, completed):
        self.assertTrue(completed.stdout, completed.stderr)
        return json.loads(completed.stdout)

    def test_exact_commit_audit_ignores_mutable_worktree_changes(self):
        self.write_packet()
        (self.repo / self.path).write_bytes(b'changed after the pinned commit\n')
        completed = self.run_checker()
        result = self.result(completed)
        self.assertEqual(completed.returncode, 0)
        self.assertEqual(result['targetSha'], self.ref)
        self.assertEqual(result['packetSha256'], [hashlib.sha256(self.packet.read_bytes()).hexdigest()])
        self.assertEqual(result['selectedPaths'], [self.path])
        self.assertEqual(result['omittedPaths'], [])
        self.assertEqual(result['mismatches'], [])
        self.assertTrue(result['sourceIdentity'])
        self.assertFalse(result['releaseReady'])

    def test_wrong_committed_blob_hash_fails(self):
        self.write_packet([{'path': self.path, 'bytes': len(self.blob), 'sha256': '0' * 64}])
        completed = self.run_checker()
        result = self.result(completed)
        self.assertNotEqual(completed.returncode, 0)
        self.assertFalse(result['sourceIdentity'])
        self.assertEqual(result['mismatches'][0]['path'], self.path)

    def test_missing_path_at_commit_fails(self):
        self.write_packet([{'path': 'src/cities/example/missing.ts', 'bytes': 1, 'sha256': '0' * 64}])
        completed = self.run_checker()
        result = self.result(completed)
        self.assertNotEqual(completed.returncode, 0)
        self.assertEqual(result['mismatches'][0]['path'], 'src/cities/example/missing.ts')

    def test_regular_file_modes_only_and_symlink_tree_are_refused(self):
        symlink = 'src/cities/example/link.ts'
        (self.repo / symlink).symlink_to('facts.ts')
        self.git('add', symlink)
        self.git('commit', '-q', '-m', 'fixture symlink')
        self.ref = self.git('rev-parse', 'HEAD').stdout.decode().strip()
        link_bytes = b'facts.ts'
        self.write_packet([{'path': symlink, 'bytes': len(link_bytes), 'sha256': hashlib.sha256(link_bytes).hexdigest()}])
        symlink_result = self.result(self.run_checker())
        self.assertFalse(symlink_result['sourceIdentity'])
        self.assertIn('regular committed file', symlink_result['mismatches'][0]['reason'])

        self.write_packet([{'path': 'src/cities/example', 'bytes': 0, 'sha256': hashlib.sha256(b'').hexdigest()}])
        tree_result = self.result(self.run_checker())
        self.assertFalse(tree_result['sourceIdentity'])
        self.assertIn('regular committed file', tree_result['mismatches'][0]['reason'])

    def test_unsafe_path_refuses_packet(self):
        self.write_packet([{'path': '../outside.ts', 'bytes': 1, 'sha256': '0' * 64}])
        completed = self.run_checker()
        result = self.result(completed)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn('normalized', result['mismatches'][0]['reason'])

    def test_fifo_packet_refuses_without_waiting_for_a_writer(self):
        os.mkfifo(self.packet)
        completed = self.run_checker()
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn('regular', self.result(completed)['mismatches'][0]['reason'])

    def test_duplicate_packet_pin_and_duplicate_selection_refuse(self):
        entry = {'path': self.path, 'bytes': len(self.blob), 'sha256': hashlib.sha256(self.blob).hexdigest()}
        self.write_packet([entry, entry])
        duplicate_pin = self.run_checker()
        self.assertNotEqual(duplicate_pin.returncode, 0)
        self.assertIn('duplicate source path', self.result(duplicate_pin)['mismatches'][0]['reason'])

        self.write_packet()
        duplicate_selection = self.run_checker('--path', self.path, '--path', self.path)
        self.assertNotEqual(duplicate_selection.returncode, 0)
        self.assertIn('duplicate --path', self.result(duplicate_selection)['mismatches'][0]['reason'])

        empty_selection = self.run_checker('--path', '')
        self.assertNotEqual(empty_selection.returncode, 0)

    def test_undeclared_selection_and_invalid_sha_refuse(self):
        self.write_packet()
        undeclared = self.run_checker('--path', 'src/cities/other.ts')
        self.assertNotEqual(undeclared.returncode, 0)
        self.assertIn('not declared', self.result(undeclared)['mismatches'][0]['reason'])

        invalid_sha = self.run_checker(ref='not-a-commit')
        self.assertNotEqual(invalid_sha.returncode, 0)
        self.assertIn('exact 40-character', self.result(invalid_sha)['mismatches'][0]['reason'])

    def test_selected_disjoint_packet_paths_report_the_omitted_path(self):
        self.write_packet()
        second_path = 'src/cities/example/extra.ts'
        second_blob = b'export const extra = 1\n'
        (self.repo / second_path).write_bytes(second_blob)
        self.git('add', second_path)
        self.git('commit', '-q', '-m', 'second fixture source')
        self.ref = self.git('rev-parse', 'HEAD').stdout.decode().strip()
        second_packet = self.root / 'second-packet.json'
        second_packet.write_text(json.dumps({
            'schemaVersion': 1,
            'sourceFiles': [{'path': second_path, 'bytes': len(second_blob), 'sha256': hashlib.sha256(second_blob).hexdigest()}],
        }))
        completed = self.run_checker('--path', self.path, packets=[self.packet, second_packet])
        result = self.result(completed)
        self.assertEqual(completed.returncode, 0)
        self.assertEqual(result['selectedPaths'], [self.path])
        self.assertEqual(result['omittedPaths'], [second_path])
        self.assertEqual(len(result['packetSha256']), 2)

    def test_packet_and_blob_size_headers_refuse_overlimits_and_boolean_byte_counts(self):
        self.write_packet([{'path': self.path, 'bytes': True, 'sha256': hashlib.sha256(self.blob).hexdigest()}])
        bool_bytes = self.result(self.run_checker())
        self.assertIn('integer', bool_bytes['mismatches'][0]['reason'])

        self.write_packet([{'path': self.path, 'bytes': 16_777_217, 'sha256': '0' * 64}])
        blob_limit = self.result(self.run_checker())
        self.assertIn('16 MiB', blob_limit['mismatches'][0]['reason'])

        self.packet.write_text(json.dumps({'schemaVersion': 1, 'sourceFiles': [], 'padding': 'x' * 1_048_576}))
        packet_limit = self.result(self.run_checker())
        self.assertIn('1 MiB', packet_limit['mismatches'][0]['reason'])


if __name__ == '__main__':
    unittest.main()
