"""Pending serial fixtures for retained roots and inherited Node descriptors."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from index_resource_limits import _run_fixed_process, run_worker, IndexWorkerUnreaped
from index_writer_lock import index_writer_lease


class IndexProcessBoundaryTests(unittest.TestCase):
    node = os.environ.get("WORLD_TEST_NODE") or shutil.which("node") or "/missing-node-runtime"

    def test_fixed_node_receives_held_lease_and_private_root_is_retained(self):
        with tempfile.TemporaryDirectory(prefix="allworld-index-boundary-fixture-") as temporary:
            root = Path(temporary).resolve(strict=True)
            with index_writer_lease(root) as lease:
                result = _run_fixed_process(self.node, "lease-witness", root, lease_descriptor=lease.descriptor)
                self.assertEqual((result["returnCode"], result["reason"]), (0, "exit"), result["stderr"])
                report = json.loads(result["stdout"])
                self.assertTrue(report["descriptorSurvivedExec"])
                self.assertEqual((report["dev"], report["ino"]), (lease.device, lease.inode))
                self.assertTrue(result["inheritedLease"])
            self.assertTrue(root.exists())
            self.assertEqual(result["scratchFilesBeforeRecovery"], {"writer.lock": 0})
            self.assertTrue((root / "writer.lock").exists())

    def test_failed_fixed_worker_does_not_remove_caller_state(self):
        with tempfile.TemporaryDirectory(prefix="allworld-index-boundary-fixture-") as temporary:
            root = Path(temporary).resolve(strict=True)
            preserved = root / "retained.bin"
            preserved.write_bytes(b"fixture state only; not a real database")
            result = _run_fixed_process(self.node, "lease-witness", root)
            self.assertNotEqual(result["returnCode"], 0)
            self.assertEqual(preserved.read_bytes(), b"fixture state only; not a real database")
            self.assertFalse(result["inheritedLease"])

    def test_descriptor_for_another_inode_is_refused_before_launch(self):
        with tempfile.TemporaryDirectory(prefix="allworld-index-boundary-fixture-") as temporary:
            root = Path(temporary).resolve(strict=True)
            with index_writer_lease(root):
                other = root / "other.lock"
                other.touch(mode=0o600)
                descriptor = os.open(other, os.O_RDWR)
                try:
                    with self.assertRaisesRegex(ValueError, "differs"), patch("index_resource_limits.subprocess.Popen") as launch:
                        _run_fixed_process(self.node, "lease-witness", root, lease_descriptor=descriptor)
                    launch.assert_not_called()
                finally:
                    os.close(descriptor)

    def test_invalid_descriptors_and_nonprivate_roots_are_refused_before_launch(self):
        with tempfile.TemporaryDirectory(prefix="allworld-index-boundary-fixture-") as temporary:
            root = Path(temporary).resolve(strict=True)
            for descriptor in [True, 0, 1, 2, "3"]:
                with self.subTest(descriptor=descriptor), self.assertRaises(ValueError):
                    _run_fixed_process(self.node, "lease-witness", root, lease_descriptor=descriptor)
            root.chmod(0o755)
            with self.assertRaisesRegex(ValueError, "0700"):
                _run_fixed_process(self.node, "lease-witness", root)
            alias = root / "alias"; alias.symlink_to(root, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "canonical"):
                _run_fixed_process(self.node, "lease-witness", alias)

    def test_injected_wait_timeout_retains_handle_and_closes_guard_pipes(self):
        # Reap the actual owned worker before injecting the unconfirmed status;
        # this exercises preservation without leaving an actual orphan behind.
        native_launch = subprocess.Popen
        owned = []

        def launch(*args, **kwargs):
            process = native_launch(*args, **kwargs); owned.append(process)
            native_wait = process.wait

            def reported_timeout(timeout=None):
                native_wait(timeout=10)
                raise subprocess.TimeoutExpired(process.args, timeout)

            process.wait = reported_timeout
            return process

        with tempfile.TemporaryDirectory(prefix="allworld-index-guard-reap-fixture-") as temporary:
            root = Path(temporary).resolve(strict=True)
            with patch("index_resource_limits.subprocess.Popen", side_effect=launch):
                # Avoid patching the ps subprocess used for RSS measurement.
                with patch("index_resource_limits.rss_bytes", return_value=1024*1024):
                    with self.assertRaises(IndexWorkerUnreaped) as caught:
                        _run_fixed_process(self.node, "witness", root, case="wall-limit", wall_seconds=1)
            self.assertIs(caught.exception.process, owned[0])
            self.assertEqual(caught.exception.root, root)
            self.assertEqual(owned[0].returncode, -9)
            self.assertTrue(owned[0].stdout.closed and owned[0].stderr.closed)
            self.assertTrue(root.exists())

    def test_disposable_runner_preserves_scratch_on_unconfirmed_reap(self):
        class Handle:
            pid = 123
        retained = []

        def unconfirmed(node, worker, root, **kwargs):
            retained.append(root)
            raise IndexWorkerUnreaped(Handle(), root, root, "injected wait timeout")

        try:
            with patch("index_resource_limits._run_fixed_process", side_effect=unconfirmed):
                with self.assertRaises(IndexWorkerUnreaped) as caught:
                    run_worker(self.node, "lease-witness")
            self.assertEqual(caught.exception.root, retained[0])
            self.assertTrue(retained[0].exists())
        finally:
            for root in retained: shutil.rmtree(root)


if __name__ == "__main__":
    unittest.main()
