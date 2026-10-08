"""Pending serial fixtures for retained roots and inherited Node descriptors."""
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from index_resource_limits import _run_fixed_process
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


if __name__ == "__main__":
    unittest.main()
