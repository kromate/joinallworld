"""Actual supervised per-capture ownership and restart acceptance fixtures."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import unittest
from unittest.mock import patch

from index_admission import supervised_charged_index
from index_capture_controller import ingest_capture_job
from index_capture_record import decode_capture_record
from index_capture_state import ANCHOR, RECORD, anchor_bytes
from index_resource_limits import IndexWorkerUnreaped, _run_fixed_process
import test_index_admission as admission_fixture
from test_index_ingest import inputs, pin, source_fixture


class IndexCaptureControllerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Reuse the already accepted fixed source/runtime fixture setup without
        # inheriting and rerunning the admission test methods.
        admission_fixture.IndexAdmissionTests.setUpClass.__func__(cls)

    bound = admission_fixture.IndexAdmissionTests.bound
    prepared = admission_fixture.IndexAdmissionTests.prepared
    arguments = admission_fixture.IndexAdmissionTests.arguments

    def _ingest(self, admitted, source, capture, **limits):
        return ingest_capture_job(admitted, source[0], source[1], source[2], self.node,
                                  *capture, **limits)

    def _capture_state(self, root):
        return decode_capture_record((root / RECORD).read_bytes())

    def test_two_cached_captures_replay_and_keep_independent_durable_attempts(self):
        retained = inputs()
        raw_before = {path: pin(path.read_bytes()) for capture in retained for path in capture[:2]}
        with self.prepared() as (namespace, source), patch(
                "sqlite3.connect", side_effect=AssertionError("parent SQLite forbidden")):
            with supervised_charged_index(**self.arguments(namespace, source)) as (admitted, admission):
                reports = [self._ingest(admitted, source, retained[0]),
                           self._ingest(admitted, source, retained[0]),
                           self._ingest(admitted, source, retained[1])]
                self.assertEqual([report["ingest"]["result"]["replayed"] for report in reports],
                                 [False, True, False])
                self.assertEqual([report["captureController"]["attempts"] for report in reports],
                                 [1, 2, 1])
                self.assertEqual(reports[-1]["ingest"]["stats"], {
                    "captures": 2, "occurrences": 2283, "versions": 1810,
                    "observations": 0, "keys": 1810, "conflictedKeys": 0,
                })

                root = admitted.lease.root
                state = self._capture_state(root)
                self.assertEqual({job["requestHash"]:len(job["attempts"]) for job in state["jobs"]},
                                 {retained[0][2]["requestHash"]:2, retained[1][2]["requestHash"]:1})
                self.assertEqual([job["requestHash"] for job in state["jobs"]],
                                 sorted(job["requestHash"] for job in state["jobs"]))
                self.assertTrue((root / ANCHOR).is_file())
                self.assertEqual((root / ANCHOR).read_bytes(), anchor_bytes(state))

                database = root / "features.sqlite"
                database_inode = database.stat().st_ino
                root_inode = root.stat().st_ino
                child_lock_inode = admitted.lease.inode
                registry_inode = (namespace / "reservations.sqlite").stat().st_ino
                self.assertEqual(admission["registry"]["stats"]["reservations"], 1)
                self.assertEqual(admission["registry"]["stats"]["heldBytes"], admitted.reserved_bytes)
                for report in reports:
                    self.assertEqual(report["guard"]["inheritedLease"], True)
                    self.assertEqual(report["guard"]["inheritedNamespaceLease"], True)

            self.assertEqual((root / "features.sqlite").stat().st_ino, database_inode)
            self.assertEqual(root.stat().st_ino, root_inode)
            self.assertEqual((root / "writer.lock").stat().st_ino, child_lock_inode)
            self.assertEqual((namespace / "reservations.sqlite").stat().st_ino, registry_inode)
        self.assertEqual({path: pin(path.read_bytes()) for path in raw_before}, raw_before)

    def test_actual_ingest_crash_boundaries_recover_with_a_second_charged_attempt(self):
        for boundary in ("before-transaction", "after-commit", "after-checkpoint"):
            with self.subTest(boundary=boundary):
                capture = inputs()[0]
                with self.prepared() as (namespace, source), patch(
                        "sqlite3.connect", side_effect=AssertionError("parent SQLite forbidden")):
                    with supervised_charged_index(**self.arguments(namespace, source)) as (admitted, admission):
                        observed = []

                        def crash(node, worker, root, **kwargs):
                            result = _run_fixed_process(node, "index-ingest-crash", root,
                                                        case=boundary, **kwargs)
                            observed.append(result)
                            return result

                        with patch("index_ingest._run_fixed_process", side_effect=crash):
                            with self.assertRaisesRegex(RuntimeError, "fixed ingestion worker failed"):
                                self._ingest(admitted, source, capture)

                        self.assertEqual(observed[0]["terminationSignal"], "SIGKILL")
                        self.assertEqual(observed[0]["stdout"], "")
                        if boundary == "after-commit":
                            self.assertGreater(observed[0]["scratchFilesBeforeRecovery"]["features.sqlite-wal"], 0)
                        root = admitted.lease.root
                        state = self._capture_state(root)
                        self.assertEqual(len(state["jobs"][0]["attempts"]), 1)
                        self.assertEqual(state["jobs"][0]["attempts"][0]["phase"], "terminal")
                        database = root / "features.sqlite"
                        database_inode = database.stat().st_ino
                        self.assertEqual(admission["registry"]["stats"]["reservations"], 1)

                        replay = self._ingest(admitted, source, capture)
                        self.assertEqual(replay["ingest"]["result"]["replayed"],
                                         boundary != "before-transaction")
                        self.assertEqual(replay["captureController"]["attempts"], 2)
                        self.assertEqual(replay["ingest"]["stats"]["occurrences"], 473)
                        self.assertEqual(database.stat().st_ino, database_inode)
                        self.assertFalse((root / "features.sqlite-wal").exists())
                        self.assertEqual(len(self._capture_state(root)["jobs"][0]["attempts"]), 2)

    def test_request_input_and_header_limits_are_immutable_before_worker_launch(self):
        capture = inputs()[0]
        with self.prepared() as (namespace, source), patch(
                "sqlite3.connect", side_effect=AssertionError("parent SQLite forbidden")):
            with supervised_charged_index(**self.arguments(namespace, source)) as (admitted, _):
                self._ingest(admitted, source, capture)
                root = admitted.lease.root
                record_before = (root / RECORD).read_bytes()
                anchor_before = (root / ANCHOR).read_bytes()

                extract_copy = namespace.parent / "same-content-extract.geojson"
                extract_copy.write_bytes(capture[0].read_bytes())
                extract_copy.chmod(0o600)
                changed_input = (extract_copy, capture[1], capture[2])
                with patch("index_ingest._run_fixed_process") as launch:
                    with self.assertRaisesRegex(ValueError, "different immutable input"):
                        self._ingest(admitted, source, changed_input)
                    launch.assert_not_called()
                self.assertEqual((root / RECORD).read_bytes(), record_before)
                self.assertEqual((root / ANCHOR).read_bytes(), anchor_before)

                with patch("index_ingest._run_fixed_process") as launch:
                    with self.assertRaisesRegex(ValueError, "immutable attempt limits changed"):
                        self._ingest(admitted, source, capture, attempt_limit=7)
                    launch.assert_not_called()
                self.assertEqual((root / RECORD).read_bytes(), record_before)
                self.assertEqual((root / ANCHOR).read_bytes(), anchor_before)

    def test_per_capture_attempt_and_job_budgets_exhaust_without_launch_or_reset(self):
        capture_list = inputs()
        with self.subTest(bound="attempts"), self.prepared() as (namespace, source), patch(
                "sqlite3.connect", side_effect=AssertionError("parent SQLite forbidden")):
            with supervised_charged_index(**self.arguments(namespace, source)) as (admitted, _):
                first = self._ingest(admitted, source, capture_list[0], attempt_limit=1, job_limit=2)
                root = admitted.lease.root
                record_before = (root / RECORD).read_bytes()
                database_inode = (root / "features.sqlite").stat().st_ino
                with patch("index_ingest._run_fixed_process") as launch:
                    with self.assertRaisesRegex(ValueError, "attempt budget is exhausted"):
                        self._ingest(admitted, source, capture_list[0], attempt_limit=1, job_limit=2)
                    launch.assert_not_called()
                self.assertEqual((root / RECORD).read_bytes(), record_before)
                self.assertEqual((root / "features.sqlite").stat().st_ino, database_inode)
                self.assertEqual(first["captureController"]["attempts"], 1)

        with self.subTest(bound="jobs"), self.prepared() as (namespace, source), patch(
                "sqlite3.connect", side_effect=AssertionError("parent SQLite forbidden")):
            with supervised_charged_index(**self.arguments(namespace, source)) as (admitted, _):
                self._ingest(admitted, source, capture_list[0], attempt_limit=2, job_limit=1)
                root = admitted.lease.root
                record_before = (root / RECORD).read_bytes()
                with patch("index_ingest._run_fixed_process") as launch:
                    with self.assertRaisesRegex(ValueError, "job budget is exhausted"):
                        self._ingest(admitted, source, capture_list[1], attempt_limit=2, job_limit=1)
                    launch.assert_not_called()
                self.assertEqual((root / RECORD).read_bytes(), record_before)
                state = self._capture_state(root)
                self.assertEqual(len(state["jobs"]), 1)
                self.assertEqual(len(state["jobs"][0]["attempts"]), 1)

    def test_missing_capture_record_or_terminal_anchor_preserves_initialized_quota(self):
        capture = inputs()[0]
        with self.prepared() as (namespace, source), patch(
                "sqlite3.connect", side_effect=AssertionError("parent SQLite forbidden")):
            with supervised_charged_index(**self.arguments(namespace, source)) as (admitted, _):
                self._ingest(admitted, source, capture)
                root = admitted.lease.root
                record_path, anchor_path = root / RECORD, root / ANCHOR
                original_record, original_anchor = record_path.read_bytes(), anchor_path.read_bytes()

                record_path.unlink()
                try:
                    with patch("index_ingest._run_fixed_process") as launch:
                        with self.assertRaisesRegex(ValueError, "record disappeared"):
                            self._ingest(admitted, source, capture)
                        launch.assert_not_called()
                finally:
                    record_path.write_bytes(original_record)
                    record_path.chmod(0o600)

                anchor_path.unlink()
                try:
                    with patch("index_ingest._run_fixed_process") as launch:
                        with self.assertRaisesRegex(ValueError, "quota anchor disappeared"):
                            self._ingest(admitted, source, capture)
                        launch.assert_not_called()
                finally:
                    anchor_path.write_bytes(original_anchor)
                    anchor_path.chmod(0o600)
                self.assertEqual(record_path.read_bytes(), original_record)
                self.assertEqual(anchor_path.read_bytes(), original_anchor)

    def test_unconfirmed_worker_retains_state_until_fresh_leases_reconcile_it(self):
        capture = inputs()[0]
        retained_descriptors = ()
        retained_snapshot = None
        with self.prepared() as (namespace, source), patch(
                "sqlite3.connect", side_effect=AssertionError("parent SQLite forbidden")):
            arguments = self.arguments(namespace, source)
            with supervised_charged_index(**arguments) as (admitted, _):
                root = admitted.lease.root

                def unconfirmed(node, worker, worker_root, **kwargs):
                    fake_process = type("OwnedHandle", (), {"pid": 999})()
                    raise IndexWorkerUnreaped(fake_process, worker_root,
                                              kwargs["execution_root"], "fixture-unconfirmed")

                with patch("index_ingest._run_fixed_process", side_effect=unconfirmed):
                    with self.assertRaises(IndexWorkerUnreaped) as raised:
                        self._ingest(admitted, source, capture)
                error = raised.exception
                retained_descriptors = error.retained_capture_descriptors
                retained_snapshot = error.retained_snapshot
                self.assertTrue(retained_snapshot.is_dir())
                self.assertEqual(len(retained_descriptors), 3)
                self.assertTrue(all(os.fstat(fd).st_size >= 0 for fd in retained_descriptors))
                state = self._capture_state(root)
                attempt = state["jobs"][0]["attempts"][-1]
                snapshot_info = retained_snapshot.lstat()
                self.assertEqual(attempt["phase"], "prepared")
                self.assertEqual((attempt["snapshotDevice"], attempt["snapshotInode"]),
                                 (snapshot_info.st_dev, snapshot_info.st_ino))
                record_before = (root / RECORD).read_bytes()
                with self.assertRaisesRegex(RuntimeError, "reacquire actual leases"):
                    self._ingest(admitted, source, capture)
                self.assertEqual((root / RECORD).read_bytes(), record_before)

                # The injected failure launched no process, so these anonymous
                # descriptors belong to this fixture and can now be closed.
                for descriptor in retained_descriptors:
                    os.close(descriptor)
                retained_descriptors = ()

            # Reentering admission reacquires both kernel leases. The controller
            # settles the interrupted attempt, reclaims its own snapshot, and
            # performs a fresh raw ingestion as attempt two.
            with supervised_charged_index(**arguments) as (admitted, admission):
                replay = self._ingest(admitted, source, capture)
                self.assertEqual(replay["captureController"]["attempts"], 2)
                self.assertEqual(replay["captureController"]["reconciledInterruptedAttempts"], 1)
                self.assertFalse(replay["ingest"]["result"]["replayed"])
                self.assertEqual(replay["ingest"]["stats"]["occurrences"], 473)
                self.assertFalse((admitted.lease.root / "capture.execution").exists())
                self.assertEqual(admission["registry"]["stats"]["reservations"], 1)

        self.assertEqual(retained_descriptors, ())
        self.assertIsNotNone(retained_snapshot)
        # The recovered controller owns cleanup; this fixture only observes it.
        self.assertFalse(retained_snapshot.exists())


if __name__ == "__main__":
    unittest.main()
