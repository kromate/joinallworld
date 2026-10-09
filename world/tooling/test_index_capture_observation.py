"""Synthetic observation contexts, real retained data and disposable indexes.

These contexts prove transaction/recovery behavior, not frozen campaign membership.
No actual campaign/cache/output writes, network, or parent SQLite.
"""
import hashlib
import json
import unittest
from unittest.mock import patch

from index_admission import supervised_charged_index
from index_capture_controller import ingest_capture_job
from index_capture_record import FORMAT, FORMAT_V2, decode_capture_record
from index_capture_state import RECORD
from index_ingest import observation_pin
from index_resource_limits import _run_fixed_process
import test_index_admission as admission_fixture
from test_index_ingest import inputs


def context(job="synthetic-index-job"):
    return {"campaignHash": hashlib.sha256(b"synthetic-campaign").hexdigest(),
            "planHash": hashlib.sha256(b"synthetic-plan").hexdigest(),
            "jobId": job, "rootCellId": "geo-grid-v1:l1:x324:y209", "queryPath": "0"}


class IndexCaptureObservationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        admission_fixture.IndexAdmissionTests.setUpClass.__func__(cls)

    bound = admission_fixture.IndexAdmissionTests.bound
    prepared = admission_fixture.IndexAdmissionTests.prepared
    arguments = admission_fixture.IndexAdmissionTests.arguments

    def ingest(self, admitted, source, capture, observation=None):
        return ingest_capture_job(admitted, *source, self.node, *capture, observation=observation)

    def state(self, admitted):
        return decode_capture_record((admitted.lease.root/RECORD).read_bytes())

    def test_same_raw_capture_keeps_distinct_charged_observations_and_allows_plain_replay(self):
        with self.prepared() as (namespace, source), patch("sqlite3.connect", side_effect=AssertionError("parent SQL forbidden")):
            with supervised_charged_index(**self.arguments(namespace, source)) as (admitted, admission):
                capture = inputs()[0]; first_context = context("synthetic-é-😀")
                first = self.ingest(admitted, source, capture, first_context)
                replay = self.ingest(admitted, source, capture, first_context)
                second_context = context("second-synthetic-job")
                second = self.ingest(admitted, source, capture, second_context)
                plain = self.ingest(admitted, source, capture)
                self.assertFalse(first["ingest"]["result"]["replayed"])
                self.assertTrue(replay["ingest"]["result"]["replayed"])
                self.assertEqual(first["ingest"]["result"]["observationHash"], observation_pin(first_context)["sha256"])
                self.assertEqual(replay["ingest"]["stats"]["observations"], 1)
                self.assertEqual(second["ingest"]["stats"]["observations"], 2)
                self.assertEqual(plain["ingest"]["result"]["observationHash"], None)
                self.assertEqual(plain["ingest"]["stats"]["observations"], 2)
                state = self.state(admitted)
                self.assertEqual(state["format"], FORMAT_V2)
                attempts = state["jobs"][0]["attempts"]
                self.assertEqual([item["observation"] for item in attempts],
                                 [observation_pin(first_context), observation_pin(first_context), observation_pin(second_context), None])
                self.assertTrue(all(item["phase"] == "terminal" for item in attempts))
                self.assertEqual(admission["registry"]["stats"]["reservations"], 1)

    def test_observation_change_of_unlaunched_attempt_refuses_without_spending_another_attempt(self):
        with self.prepared() as (namespace, source):
            with supervised_charged_index(**self.arguments(namespace, source)) as (admitted, _):
                capture = inputs()[0]; original = context()
                with patch("index_capture_controller.copy_capture_snapshot", side_effect=RuntimeError("fixture-before-snapshot")):
                    with self.assertRaisesRegex(RuntimeError, "fixture-before-snapshot"):
                        self.ingest(admitted, source, capture, original)
                before = (admitted.lease.root/RECORD).read_bytes()
                with patch("index_ingest._run_fixed_process") as launch:
                    with self.assertRaisesRegex(ValueError, "different input or observation"):
                        self.ingest(admitted, source, capture, context("changed-synthetic-job"))
                    launch.assert_not_called()
                self.assertEqual((admitted.lease.root/RECORD).read_bytes(), before)
                report = self.ingest(admitted, source, capture, original)
                self.assertEqual(report["captureController"]["attempts"], 1)

    def test_v1_record_cannot_silently_migrate_or_reset_its_quota(self):
        with self.prepared() as (namespace, source):
            with supervised_charged_index(**self.arguments(namespace, source)) as (admitted, _):
                capture = inputs()[0]
                self.ingest(admitted, source, capture)
                before = (admitted.lease.root/RECORD).read_bytes()
                self.assertEqual(self.state(admitted)["format"], FORMAT)
                with patch("index_ingest._run_fixed_process") as launch:
                    with self.assertRaisesRegex(ValueError, "cannot be migrated"):
                        self.ingest(admitted, source, capture, context())
                    launch.assert_not_called()
                self.assertEqual((admitted.lease.root/RECORD).read_bytes(), before)

    def test_actual_worker_crashes_preserve_atomic_observation_and_fresh_replay(self):
        for boundary in ("before-transaction", "after-commit", "after-checkpoint"):
            with self.subTest(boundary=boundary), self.prepared() as (namespace, source), patch("sqlite3.connect", side_effect=AssertionError("parent SQL forbidden")):
                with supervised_charged_index(**self.arguments(namespace, source)) as (admitted, _):
                    capture = inputs()[0]; observation = context()
                    def crash(node, worker, root, **kwargs):
                        return _run_fixed_process(node, "index-ingest-crash", root, case=boundary, **kwargs)
                    with patch("index_ingest._run_fixed_process", side_effect=crash):
                        with self.assertRaisesRegex(RuntimeError, "fixed ingestion worker failed"):
                            self.ingest(admitted, source, capture, observation)
                    first_attempt = self.state(admitted)["jobs"][0]["attempts"][0]
                    self.assertEqual(first_attempt["observation"], observation_pin(observation))
                    self.assertEqual(first_attempt["phase"], "terminal")
                    replay = self.ingest(admitted, source, capture, observation)
                    self.assertEqual(replay["captureController"]["attempts"], 2)
                    self.assertEqual(replay["ingest"]["result"]["replayed"], boundary != "before-transaction")
                    self.assertEqual(replay["ingest"]["stats"]["observations"], 1)
                    self.assertEqual(replay["ingest"]["result"]["observationHash"], observation_pin(observation)["sha256"])


if __name__ == "__main__": unittest.main()
