"""Pending serial fixtures for retained roots and inherited Node descriptors."""
import json
import os
from pathlib import Path
import shutil
import select
import selectors
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from index_resource_limits import _run_fixed_process, run_worker, IndexWorkerUnreaped
from index_writer_lock import index_writer_lease, IndexWriterBusy


class IndexProcessBoundaryTests(unittest.TestCase):
    node = os.environ.get("WORLD_TEST_NODE") or shutil.which("node") or "/missing-node-runtime"

    def test_reaped_leader_with_live_inherited_pipe_is_bounded_and_preserved(self):
        # Inject a real fork into the test launch only. Production fixed workers
        # never select arbitrary scripts and currently do not spawn descendants.
        root = Path(tempfile.mkdtemp(prefix="allworld-index-pipe-fixture-")).resolve(strict=True)
        native_launch = subprocess.Popen; child = []
        code = "import os,time; p=os.fork(); os.write(1,(str(p)+'\\n').encode()) if p else None; time.sleep(2) if not p else None; os._exit(0)"
        def launch(command, **kwargs):
            process = native_launch([sys.executable, "-I", "-B", "-c", code], **kwargs)
            if not select.select([process.stdout], [], [], 3)[0]:
                raise RuntimeError("fork fixture did not report its descendant")
            child.append(int(process.stdout.readline(64)))
            return process
        confirmed = False
        try:
            with index_writer_lease(root) as lease, patch("index_resource_limits.subprocess.Popen", side_effect=launch), patch(
                    "index_resource_limits.rss_bytes", return_value=1024*1024):
                with self.assertRaises(IndexWorkerUnreaped) as caught:
                    _run_fixed_process(self.node, "lease-witness", root, lease_descriptor=lease.descriptor,
                                       wall_seconds=1, heap_mib=64)
                self.assertEqual(caught.exception.reason, "inherited-pipe-exit-unconfirmed")
                self.assertEqual(caught.exception.process.returncode, 0)
                self.assertTrue(caught.exception.process.stdout.closed and caught.exception.process.stderr.closed)
            with self.assertRaises(IndexWriterBusy), index_writer_lease(root):
                self.fail("the actual descendant lost its inherited lease")
        finally:
            # The fixture descendant exits itself after two seconds. No generic
            # process-group kill or state deletion while its identity is unknown.
            if child and child[0] > 2:
                deadline = time.monotonic()+5
                while time.monotonic() < deadline:
                    status = subprocess.run(["/bin/ps", "-o", "args=", "-p", str(child[0])], capture_output=True, timeout=1)
                    if status.returncode == 1 and not status.stdout.strip():
                        confirmed = True; break
                    if status.returncode != 0 or code.encode() not in status.stdout:
                        raise RuntimeError(f"fixture descendant identity unavailable; preserve {root}")
                    time.sleep(0.02)
            if confirmed:
                with index_writer_lease(root): pass
                shutil.rmtree(root)
            else:
                raise RuntimeError(f"fixture descendant exit unconfirmed; preserve {root}")

    def test_selector_setup_failure_reaps_actual_spawned_worker_and_closes_pipes(self):
        native_launch = subprocess.Popen; owned = []
        def launch(*args, **kwargs):
            process = native_launch(*args, **kwargs); owned.append(process); return process
        with tempfile.TemporaryDirectory(prefix="allworld-index-guard-setup-fixture-") as temporary:
            root = Path(temporary).resolve(strict=True)
            with patch("index_resource_limits.subprocess.Popen", side_effect=launch), patch(
                    "index_resource_limits.selectors.DefaultSelector", side_effect=OSError("injected selector setup failure")):
                with self.assertRaisesRegex(OSError, "selector setup"):
                    _run_fixed_process(self.node, "witness", root, case="wall-limit", heap_mib=64)
            self.assertEqual(len(owned), 1)
            self.assertIsNotNone(owned[0].returncode)
            self.assertTrue(owned[0].stdout.closed and owned[0].stderr.closed)
            self.assertTrue(root.exists())

    def test_fixed_guard_inherits_both_namespace_and_child_leases(self):
        with tempfile.TemporaryDirectory(prefix="allworld-index-boundary-fixture-") as temporary:
            namespace = Path(temporary).resolve(strict=True); root = namespace/"child"; root.mkdir(mode=0o700)
            with index_writer_lease(namespace) as parent, index_writer_lease(root) as child:
                result = _run_fixed_process(self.node, "lease-witness", root,
                    lease_descriptor=child.descriptor, namespace_descriptor=parent.descriptor, heap_mib=64)
                self.assertEqual(result["returnCode"], 0, result["stderr"])
                self.assertTrue(result["inheritedNamespaceLease"])
                self.assertEqual(json.loads(result["stdout"])["namespace"], {"dev": parent.device, "ino": parent.inode})

    def test_live_node_keeps_both_leases_after_coordinator_references_close(self):
        # Actual Node and actual flock, but reference closure rather than controller SIGKILL.
        process = None
        with tempfile.TemporaryDirectory(prefix="allworld-index-boundary-fixture-") as temporary:
            namespace = Path(temporary).resolve(strict=True); root = namespace/"child"; root.mkdir(mode=0o700)
            try:
                with index_writer_lease(namespace) as parent, index_writer_lease(root) as child:
                    script = Path(__file__).resolve().parent/"index_lease_witness.ts"
                    process = subprocess.Popen([self.node, "--max-old-space-size=64", "--experimental-strip-types", str(script), "hold"],
                        env={"TMPDIR": str(root), "WORLD_INDEX_LEASE_DESCRIPTOR": str(child.descriptor),
                             "WORLD_INDEX_NAMESPACE_DESCRIPTOR": str(parent.descriptor)},
                        pass_fds=(parent.descriptor, child.descriptor), stdin=subprocess.PIPE,
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                    self.assertTrue(select.select([process.stdout], [], [], 3)[0], "Node did not confirm readiness")
                    report = json.loads(process.stdout.readline(4096))
                    self.assertEqual(report["namespace"], {"dev": parent.device, "ino": parent.inode})
                self.assertIsNone(process.poll())
                for directory in [namespace, root]:
                    with self.assertRaises(IndexWriterBusy), index_writer_lease(directory):
                        self.fail("live Node lost an inherited lease")
                stdout, stderr = process.communicate(b"X", timeout=3)
                self.assertEqual((process.returncode, stdout), (0, b""), stderr)
                with index_writer_lease(namespace), index_writer_lease(root): pass
            finally:
                if process is not None:
                    if process.poll() is None: process.kill()
                    process.communicate(timeout=3)

    def test_wrong_namespace_descriptor_refuses_before_launch(self):
        with tempfile.TemporaryDirectory(prefix="allworld-index-boundary-fixture-") as temporary:
            namespace = Path(temporary).resolve(strict=True); root = namespace/"child"; root.mkdir(mode=0o700)
            other = namespace/"other"; other.mkdir(mode=0o700)
            with index_writer_lease(namespace) as parent, index_writer_lease(root) as child, index_writer_lease(other) as unrelated:
                for descriptor in [unrelated.descriptor, child.descriptor, True, 2]:
                    with self.subTest(descriptor=descriptor), patch("index_resource_limits.subprocess.Popen") as launch:
                        with self.assertRaises(ValueError):
                            _run_fixed_process(self.node, "lease-witness", root,
                                lease_descriptor=child.descriptor, namespace_descriptor=descriptor)
                        launch.assert_not_called()
                with self.assertRaises(ValueError), patch("index_resource_limits.subprocess.Popen") as launch:
                    _run_fixed_process(self.node, "lease-witness", root, namespace_descriptor=parent.descriptor)
                launch.assert_not_called()

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
        native_selector = selectors.DefaultSelector
        owned = []

        def faulty_selector():
            selector = native_selector(); native_close = selector.close
            def close():
                native_close()
                raise OSError("injected selector cleanup failure")
            selector.close = close
            return selector

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
            with patch("index_resource_limits.subprocess.Popen", side_effect=launch), patch(
                    "index_resource_limits.selectors.DefaultSelector", side_effect=faulty_selector):
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
