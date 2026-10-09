"""Actual fixed-worker audits over disposable indexes and retained raw captures.

Synthetic observation contexts exercise storage/required-set validation only;
they are not claims of membership in a real campaign or completed ledger job.
"""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from index_admission import supervised_charged_index, _session_audit_step
from index_audit_controller import AUDIT_EXECUTION, AUDIT_RECLAIM, AUDIT_ANCHOR, audit_capture_index
from index_capture_controller import ingest_capture_job
from index_capture_record import decode_capture_record
from index_capture_state import ANCHOR, RECORD
from index_ingest import observation_pin, prepare_audit_capture_descriptor
from index_ingest import ingest_index
from index_bootstrap import bootstrap_index
from index_resource_limits import _run_fixed_process
import test_index_admission as admission_fixture
from test_index_ingest import inputs, pin, retained_input_path
from index_controller_state import _publish_bytes as _publish_bytes_real
from index_audit_controller import _copy_file as _copy_file_real
from index_audit_controller import _capture_set, _json, _result_bytes, _result_prefix, _decode_result
from index_audit_controller import _encode_record, _anchor, _read_record
from index_writer_lock import index_writer_lease
from index_tooling import decode_tooling_manifest, encode_tooling_manifest
from index_registry_controller import _copy_snapshot as _copy_registry_real
from index_controller_state import footprint as controller_footprint


class IndexAuditCodecTests(unittest.TestCase):
    """Small file/codec checks; no Node workers or SQLite connections."""
    def test_descriptor_overflow_drains_bounded_frames_then_reports_error_without_a_worker(self):
        capture = inputs()[0]; expected = capture[2]
        audit = dict(count=2, attemptLimit=1, jobs={expected["requestHash"]: []}, captures=[],
                     size=512_000, ordinal=0, error=None, terminal=False)
        message = {"format": "feature-index-session-audit-capture-v1", "id": 1, "ordinal": 0,
                   "extractPath": str(capture[0]), "receiptPath": str(capture[1]),
                   "expected": expected, "requiredObservations": []}
        emitted = []
        with patch("index_admission._session_emit", side_effect=emitted.append), patch(
                "index_audit_controller.audit_capture_index", side_effect=AssertionError("must not start an audit")) as worker:
            self.assertFalse(_session_audit_step(message, audit, None, {}, b"", b"", "a"*64))
            self.assertEqual(audit["captures"], [])
            self.assertIn("512000", audit["error"])
            self.assertEqual(audit["ordinal"], 1)
            # Subsequent payloads are drained, not retained or interpreted after refusal.
            self.assertFalse(_session_audit_step({**message, "ordinal": 1, "expected": {}}, audit, None, {}, b"", b"", "a"*64))
            self.assertEqual(emitted, [])
            self.assertFalse(_session_audit_step({"format": "feature-index-session-audit-run-v1", "id": 1},
                audit, None, {}, b"", b"", "a"*64))
            worker.assert_not_called()
        self.assertEqual(emitted, [{"format": "feature-index-session-audit-result-v1", "id": 1,
                                  "indexHash": "a"*64, "error": audit["error"]}])
        self.assertTrue(audit["terminal"])
        self.assertEqual(audit["captures"], [])

    def test_session_descriptor_charges_ascii_base64_and_historical_pins_without_mutating_contexts(self):
        import base64
        capture = inputs()[0]
        contexts = [IndexAuditControllerTests._context(label) for label in ("unicode-\u00e9", "other")]
        expected = dict(capture[2]); expected["request"] = {**expected["request"], "id": "\u00e9"*40}
        historical = [observation_pin(context) for context in contexts]
        message = {"expected": expected, "extractPath": str(capture[0]), "receiptPath": str(capture[1]),
                   "requiredObservations": contexts}
        before = _json(message)
        descriptor, charged = prepare_audit_capture_descriptor(message, {expected["requestHash"]: historical})
        physical = {key: value for key, value in descriptor.items() if key != "expected"}
        physical["expectedBase64"] = base64.b64encode(_json(expected)).decode("ascii")
        self.assertEqual(charged, len(_json(physical)))
        self.assertGreater(len(base64.b64decode(physical["expectedBase64"])), len(json.dumps(expected, ensure_ascii=False).encode("utf-8")))
        self.assertEqual(_json(message), before)
        self.assertEqual(descriptor["requiredObservations"], sorted(contexts, key=lambda value: (
            observation_pin(value)["sha256"], observation_pin(value)["bytes"])))
        self.assertEqual(descriptor["allowedObservationPins"], historical)

    def test_session_descriptor_refuses_unknown_requests_or_oversized_required_contexts(self):
        capture = inputs()[0]
        message = {"expected": capture[2], "extractPath": str(capture[0]), "receiptPath": str(capture[1]),
                   "requiredObservations": []}
        with self.assertRaisesRegex(ValueError, "durable membership"):
            prepare_audit_capture_descriptor(message, {})
        message["requiredObservations"] = [IndexAuditControllerTests._context("oversize")]*9
        with self.assertRaisesRegex(ValueError, "observation bound"):
            prepare_audit_capture_descriptor(message, {capture[2]["requestHash"]: []})

    def test_witness_all_write_prefixes_and_full_canonical_payload(self):
        guard = {"returnCode": 0, "reason": "exit", "maximumObservedWorkerRssBytes": 123,
                 "inheritedLease": True, "inheritedNamespaceLease": True}
        report = {"format": "synthetic-codec-fixture"}
        raw = _result_bytes("a"*64, 2, "b"*64, report, guard)
        for length in range(len(raw)+1):
            self.assertTrue(_result_prefix(raw[:length], "a"*64, 2, "b"*64), length)
        self.assertEqual(_decode_result(raw, "a"*64, 2, "b"*64), {"report": report, "guard": guard})
        self.assertFalse(_result_prefix(raw, "c"*64, 2, "b"*64))
        self.assertFalse(_result_prefix(raw, "a"*64, 1, "b"*64))

    def test_witness_rejects_corruption_oversize_and_unsuccessful_guard(self):
        guard = {"returnCode": 0, "reason": "exit", "maximumObservedWorkerRssBytes": 123,
                 "inheritedLease": True, "inheritedNamespaceLease": True}
        raw = _result_bytes("a"*64, 1, "b"*64, {}, guard)
        for corrupted in (raw[:-1]+b"!", raw+b"\n", raw[:165]+b"!?", raw+b"A"*8192):
            self.assertFalse(_result_prefix(corrupted, "a"*64, 1, "b"*64))
        for key, bad in (("returnCode", True), ("inheritedLease", False),
                         ("maximumObservedWorkerRssBytes", -1), ("reason", "timeout")):
            invalid = _result_bytes("a"*64, 1, "b"*64, {}, {**guard, key: bad})
            with self.assertRaises(ValueError):
                _decode_result(invalid, "a"*64, 1, "b"*64)
        with self.assertRaises(ValueError):
            _result_bytes("a"*64, 1, "b"*64, {"oversize": "x"*8192}, guard)

    def test_required_contexts_keep_distinct_durable_attempt_membership(self):
        capture = inputs()[0]
        contexts = [IndexAuditControllerTests._context(label) for label in ("known-b", "known-a", "failed-c")]
        pins = [observation_pin(context) for context in contexts]
        requested = IndexAuditControllerTests._audit_inputs([capture], {capture[2]["requestHash"]: contexts[:2]})
        requested[0]["allowedObservationPins"] = pins
        expected_raw = _json(capture[2])
        record = {"jobs": [{"requestHash": capture[2]["requestHash"], "input": {
            "extractPath": str(capture[0]), "receiptPath": str(capture[1]),
            "expected": pin(expected_raw)}, "attempts": [{"observation": p} for p in pins]}]}
        normalized = _capture_set(record, requested)
        self.assertEqual(normalized[0]["requiredObservations"], sorted(contexts[:2],
            key=lambda c: (observation_pin(c)["sha256"], observation_pin(c)["bytes"])))
        self.assertEqual(len(normalized[0]["allowedObservationPins"]), 3)
        requested[0]["requiredObservations"].append(IndexAuditControllerTests._context("unknown"))
        with self.assertRaisesRegex(ValueError, "durable allowable pin"):
            _capture_set(record, requested)

    def test_substituted_snapshot_preserves_pending_reporting_record(self):
        # Exercise the filesystem publication boundary under actual paired leases,
        # without pretending this synthetic record is a successful worker result.
        with tempfile.TemporaryDirectory(prefix="allworld-audit-slot-fixture-") as temporary:
            base = Path(temporary).resolve(strict=True)
            namespace = base/"namespace"; namespace.mkdir(mode=0o700)
            root = namespace/("a"*64); root.mkdir(mode=0o700)
            with index_writer_lease(namespace), index_writer_lease(root) as lease:
                old_slot = base/"old-slot"; old_slot.mkdir(mode=0o700)
                replacement = root/AUDIT_EXECUTION; replacement.mkdir(mode=0o700)
                old = old_slot.stat(); current = replacement.stat(); info = root.stat()
                self.assertNotEqual(old.st_ino, current.st_ino)
                database = {"sha256": "c"*64, "bytes": 4096}
                record = {"format": "feature-index-audit-controller-v1", "index": {
                    "indexHash": root.name, "rootDevice": info.st_dev, "rootInode": info.st_ino,
                    "lockDevice": lease.device, "lockInode": lease.inode}, "limits": {"attempts": 2},
                    "input": {"captureRecordSha256": "d"*64, "captureRecordBytes": 100,
                        "captureSetSha256": "e"*64, "requiredObservationsSha256": "f"*64,
                        "auditInputSha256": "b"*64, "originalStateSha256": "c"*64},
                    "attempts": [{"number": 1, "phase": "prepared", "snapshotDevice": old.st_dev,
                        "snapshotInode": old.st_ino, "inputSha256": "b"*64,
                        "snapshotDatabase": database, "snapshotWal": None,
                        "resultSha256": None, "report": None, "guard": None, "launchPrepared": False}]}
                original = _encode_record(record)
                envelope = {"format": "feature-index-audit-input-v1", "indexHash": root.name,
                    "captureRecord": {"sha256": "d"*64, "bytes": 100},
                    "snapshotRoot": {"path": str(replacement), "device": current.st_dev, "inode": current.st_ino},
                    "database": database, "wal": None, "captures": []}
                staged = json.loads(original)
                staged["attempts"][-1].update(phase="reporting", launchPrepared=True,
                    inputSha256=hashlib.sha256(_json(envelope)).hexdigest())
                pending = _encode_record(staged)
                for name, raw in (("audit.json", original), (AUDIT_ANCHOR, _anchor(record)), ("audit.pending", pending)):
                    path = root/name; path.write_bytes(raw); path.chmod(0o600)
                with self.assertRaisesRegex(ValueError, "recoverable deterministic prefix"):
                    _read_record(root, record, canonical_captures=[])
                self.assertEqual((root/"audit.json").read_bytes(), original)
                self.assertEqual((root/"audit.pending").read_bytes(), pending)
                self.assertEqual(replacement.stat().st_ino, current.st_ino)


class IndexAuditControllerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        admission_fixture.IndexAdmissionTests.setUpClass.__func__(cls)

    bound = admission_fixture.IndexAdmissionTests.bound
    prepared = admission_fixture.IndexAdmissionTests.prepared
    arguments = admission_fixture.IndexAdmissionTests.arguments

    @staticmethod
    def _context(label):
        # A canonical engine observation fixture, not verified campaign membership.
        return {"campaignHash": "a"*64, "planHash": "b"*64, "jobId": label,
                "rootCellId": "geo-grid-v1:l0:x0:y0", "queryPath": "01"}

    def _ingest(self, admitted, source, capture, observation=None):
        return ingest_capture_job(admitted, source[0], source[1], source[2], self.node,
                                  *capture, observation=observation)

    @staticmethod
    def _audit_inputs(captures, observations=None):
        observations = observations or {}
        result = []
        for extract, receipt, expected in captures:
            contexts = observations.get(expected["requestHash"], [])
            result.append({"extractPath": str(extract), "receiptPath": str(receipt),
                "expected": expected, "requiredObservations": list(contexts),
                "allowedObservationPins": [observation_pin(value)
                                          for value in contexts]})
        return sorted(result, key=lambda item: item["expected"]["requestHash"])

    @staticmethod
    def _original_state(root):
        names = ("binding.json", "bootstrap.json", "bootstrap.sqlite", "features.sqlite",
                 "features.sqlite-wal", "features.sqlite-shm", RECORD, ANCHOR)
        result = {}
        for name in names:
            path = root/name
            if path.exists():
                info = path.lstat()
                result[name] = (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
                                info.st_ctime_ns, path.read_bytes())
        return result

    def test_actual_retained_captures_and_required_observations_are_audited_read_only(self):
        captures = inputs()
        first_context = self._context("synthetic-audit-job-a")
        second_context = self._context("synthetic-audit-job-b")
        synthetic = {captures[0][2]["requestHash"]: [first_context, second_context]}
        raw_before = {path: pin(path.read_bytes()) for capture in captures for path in capture[:2]}
        with self.prepared() as (namespace, source), patch(
                "sqlite3.connect", side_effect=AssertionError("parent SQLite is forbidden")):
            with supervised_charged_index(**self.arguments(namespace, source)) as (admitted, _):
                self._ingest(admitted, source, captures[0], first_context)
                self._ingest(admitted, source, captures[0], second_context)
                self._ingest(admitted, source, captures[1])
                root = admitted.lease.root
                original = self._original_state(root)
                request_inputs = self._audit_inputs(captures, synthetic)
                report = audit_capture_index(admitted, source[0], source[1], source[2],
                    self.node, request_inputs, attempt_limit=4)
                result = report["audit"]["result"]
                self.assertEqual(report["audit"]["format"], "feature-index-audit-worker-v1")
                self.assertEqual(result["format"], "feature-index-raw-audit-v1")
                self.assertEqual(result["scope"], "raw-feature-conservation-and-required-observations")
                self.assertEqual(result["qualifications"], {
                    "rawIndexConservation": "complete", "requiredObservations": "complete"})
                self.assertEqual(result["counts"]["captures"], 2)
                self.assertEqual(result["counts"]["rawFeatures"], 2283)
                self.assertEqual(result["counts"]["occurrences"], 2283)
                self.assertEqual(result["counts"]["observations"], 2)
                self.assertEqual(result["counts"]["requiredObservations"], 2)
                self.assertEqual(report["auditController"]["attempts"], 1)
                self.assertIn("global campaign membership is not established",
                              report["auditController"]["scope"])
                self.assertFalse((root/AUDIT_EXECUTION).exists())
                self.assertFalse((root/AUDIT_RECLAIM).exists())
                self.assertEqual(self._original_state(root), original)
                for write in (lambda: self._ingest(admitted, source, captures[0]),
                              lambda: ingest_index(admitted, *source, self.node, *captures[0]),
                              lambda: bootstrap_index(admitted, *source, self.node)):
                    with self.assertRaisesRegex(ValueError, "frozen for audit"):
                        write()
                self.assertEqual(self._original_state(root), original)
                replay = audit_capture_index(admitted, source[0], source[1], source[2],
                    self.node, request_inputs, attempt_limit=4)
                self.assertEqual(replay["audit"], report["audit"])
                self.assertIsNone(replay["guard"])
                self.assertEqual(replay["guardEvidence"]["format"],
                                 "feature-index-audit-retained-guard-v1")
                self.assertTrue(replay["auditController"]["replayed"])
                self.assertEqual(replay["auditController"]["attempts"], 1)
                self.assertEqual(self._original_state(root), original)
                record = decode_capture_record((root/RECORD).read_bytes())
                self.assertEqual(len(record["jobs"]), 2)
                self.assertEqual((root/ANCHOR).is_file(), True)
            self.assertEqual({path: pin(path.read_bytes()) for path in raw_before}, raw_before)

    def test_real_retained_zero_feature_query_is_audited_without_reacquisition(self):
        root = Path(__file__).resolve().parent.parent.parent
        checkpoint = json.loads((root/"world/grid-query.json").read_bytes())
        self.assertEqual(checkpoint["campaign"]["id"], "senegal-grid-query-v1")
        records = checkpoint["productPins"]
        extract_pin = next(p for p in records if p["kind"] == "captured-extract")
        receipt_pin = next(p for p in records if p["kind"] == "captured-acquisition-receipt"
                           and p["requestHash"] == extract_pin["requestHash"])
        extract, receipt = retained_input_path(extract_pin), retained_input_path(receipt_pin)
        original = {}
        for path, retained in ((extract, extract_pin), (receipt, receipt_pin)):
            actual = pin(path.read_bytes())
            self.assertEqual(actual, {key: retained[key] for key in ("sha256", "bytes")})
            original[path] = actual
        self.assertEqual(json.loads(extract.read_bytes())["features"], [])
        expected = {"requestHash": extract_pin["requestHash"],
            "request": json.loads(receipt.read_bytes())["request"],
            "extract": original[extract], "receipt": original[receipt]}
        capture = (extract, receipt, expected)
        # Retained real source-query evidence; no completed campaign observations
        # are invented and this does not establish physically empty geography.
        with self.prepared() as (namespace, source), patch(
                "sqlite3.connect", side_effect=AssertionError("parent SQLite is forbidden")):
            with supervised_charged_index(**self.arguments(namespace, source)) as (admitted, _):
                self._ingest(admitted, source, capture)
                before = self._original_state(admitted.lease.root)
                report = audit_capture_index(admitted, *source, self.node, self._audit_inputs([capture]))
                counts = report["audit"]["result"]["counts"]
                self.assertEqual(counts["captures"], 1)
                for key in ("rawFeatures", "occurrences", "versions", "keys", "observations"):
                    self.assertEqual(counts[key], 0)
                self.assertEqual(self._original_state(admitted.lease.root), before)
        self.assertEqual({path: pin(path.read_bytes()) for path in original}, original)

    def test_mismatched_historical_pin_refuses_before_audit_state_or_worker(self):
        capture = inputs()[0]
        context = self._context("synthetic-audit-bad-pin")
        with self.prepared() as (namespace, source), patch(
                "sqlite3.connect", side_effect=AssertionError("parent SQLite is forbidden")):
            with supervised_charged_index(**self.arguments(namespace, source)) as (admitted, _):
                self._ingest(admitted, source, capture, context)
                root = admitted.lease.root
                before = self._original_state(root)
                requested = self._audit_inputs([capture], {capture[2]["requestHash"]: [context]})
                requested[0]["allowedObservationPins"][0]["sha256"] = "0"*64
                with patch("index_audit_controller._run_fixed_process") as launch:
                    with self.assertRaisesRegex(ValueError, "allowed pins must equal"):
                        audit_capture_index(admitted, source[0], source[1], source[2],
                            self.node, requested)
                    launch.assert_not_called()
                self.assertEqual(self._original_state(root), before)
                self.assertFalse((root/"audit.json").exists())
                self.assertFalse((root/AUDIT_EXECUTION).exists())

    def test_oversized_tooling_refuses_before_namespace_publication(self):
        # No SQL/worker: exercise real pin verification and admission capacity
        # against a larger disposable source, preserving the original17MiB cap.
        with self.prepared() as (namespace, source):
            repository, raw_manifest, config = source
            manifest = decode_tooling_manifest(raw_manifest, pin(raw_manifest))
            name = "world/tooling/index_audit_controller.py"
            original = (repository/name).read_bytes()
            enlarged = original+b"\n"*(1024*1024-len(original))
            (repository/name).write_bytes(enlarged)
            manifest["files"][name] = pin(enlarged)
            changed = (repository, encode_tooling_manifest(manifest), config)
            with patch("index_registry_controller._copy_snapshot") as copy, patch(
                    "index_registry_controller.startup_index_namespace") as launch:
                with self.assertRaisesRegex(ValueError, "immutable registry allowance"):
                    with supervised_charged_index(**self.arguments(namespace, changed)):
                        self.fail("oversized source was admitted")
                copy.assert_not_called(); launch.assert_not_called()
            self.assertEqual([p.name for p in namespace.iterdir()], ["writer.lock"])
            self.assertEqual((namespace/"writer.lock").stat().st_size, 0)

    def test_actual_allocated_snapshot_refuses_before_registry_worker(self):
        # Pad each source to its8KiB estimate, keeping its bytes/hash exact.
        # Additional owned pending controls deliberately consume the remaining
        # physical reservation; no SQL or worker is launched in this fixture.
        with self.prepared() as (namespace, source):
            repository, raw_manifest, config = source
            manifest = decode_tooling_manifest(raw_manifest, pin(raw_manifest))
            for name, expected in manifest["files"].items():
                path = repository/name; raw = path.read_bytes()
                raw += b"\n"*((-len(raw)) % 8192)
                path.write_bytes(raw); expected.update(pin(raw))
            changed = (repository, encode_tooling_manifest(manifest), config)
            measured = []
            def consume_margin(root, *args):
                execution = _copy_registry_real(root, *args)
                record = root/"controller.json"
                raw = record.read_bytes(); record.write_bytes(raw+b" "*(64000-len(raw)))
                for name, size in (("controller.pending", 64000), ("controller.registry.pending", 4096), ("controller.registry.json", 4096)):
                    path = root/name; path.write_bytes(b"X"*size); path.chmod(0o600)
                measured.append(controller_footprint(root))
                return execution
            with patch("index_registry_controller._copy_snapshot", side_effect=consume_margin), patch(
                    "index_registry_controller.startup_index_namespace") as launch:
                with self.assertRaisesRegex(ValueError, "actual persistent snapshot cannot fit"):
                    with supervised_charged_index(**self.arguments(namespace, changed)):
                        self.fail("physical over-allocation was admitted")
                launch.assert_not_called()
            self.assertEqual(len(measured), 1)
            self.assertGreater(measured[0]+64000+65536+namespace.stat().st_blocks*512, 1024*1024)
            for name, size in (("controller.pending", 64000), ("controller.registry.pending", 4096), ("controller.registry.json", 4096)):
                self.assertEqual((namespace/name).read_bytes(), b"X"*size)

    def _interrupt_publish(self, phase):
        def publish(root, raw, final_name, pending_name, maximum):
            selected = False
            if final_name == "audit.result.json" and (phase.startswith("result-") or phase == "malformed-result"):
                selected = True
            elif final_name == "audit.json" and phase.startswith("reporting-"):
                value = json.loads(raw.decode("ascii"))
                selected = value["attempts"][-1]["phase"] == "reporting"
            elif final_name == "audit.json" and phase.startswith("terminal-"):
                value = json.loads(raw.decode("ascii"))
                selected = (value["attempts"][-1]["phase"] == "terminal"
                            and value["attempts"][-1]["report"] is not None)
            if not selected:
                return _publish_bytes_real(root, raw, final_name, pending_name, maximum)
            if phase.endswith("-rename"):
                data = raw
            else:
                data = raw[:max(1, min(len(raw)-1, len(raw)//3))]
            if phase == "malformed-result":
                attempt = json.loads((root/"audit.json").read_bytes())["attempts"][-1]
                data = (f"feature-index-audit-result-v1\n{root.name}\n{attempt['number']}\n"
                        f"{attempt['inputSha256']}\n!?").encode("ascii")
            fd = os.open(root/pending_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            try:
                view = memoryview(data)
                while view:
                    count = os.write(fd, view)
                    view = view[count:]
                os.fsync(fd)
            finally:
                os.close(fd)
            directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
            raise OSError("injected durable publication interruption")
        return publish

    def test_actual_worker_publication_interruptions_recover_or_preserve(self):
        # Each boundary uses an actual audit worker and a fresh paired-lease
        # acquisition for recovery; no successful report is fabricated.
        for phase in ("reporting-write", "reporting-rename", "result-write",
                      "result-rename", "terminal-write", "terminal-rename"):
            with self.subTest(phase=phase), self.prepared() as (namespace, source):
                capture = inputs()[0]
                request_inputs = self._audit_inputs([capture])
                with supervised_charged_index(**self.arguments(namespace, source)) as (admitted, _):
                    self._ingest(admitted, source, capture)
                    with patch("index_audit_controller._publish_bytes",
                               side_effect=self._interrupt_publish(phase)):
                        with self.assertRaisesRegex(OSError, "injected durable publication interruption"):
                            audit_capture_index(admitted, source[0], source[1], source[2],
                                self.node, request_inputs, attempt_limit=4)
                with supervised_charged_index(**self.arguments(namespace, source)) as (admitted, _):
                    resumed = audit_capture_index(admitted, source[0], source[1], source[2],
                        self.node, request_inputs, attempt_limit=4)
                    self.assertEqual(resumed["audit"]["result"]["counts"]["captures"], 1)
                    expected_attempts = 2 if phase.startswith(("reporting-", "result-write")) else 1
                    self.assertEqual(resumed["auditController"]["attempts"], expected_attempts)
                    self.assertFalse((admitted.lease.root/"audit.result.json").exists())

    def test_malformed_reporting_witness_is_preserved(self):
        capture = inputs()[0]
        request_inputs = self._audit_inputs([capture])
        with self.prepared() as (namespace, source):
            with supervised_charged_index(**self.arguments(namespace, source)) as (admitted, _):
                self._ingest(admitted, source, capture)
                with patch("index_audit_controller._publish_bytes",
                           side_effect=self._interrupt_publish("malformed-result")):
                    with self.assertRaisesRegex(OSError, "injected durable publication interruption"):
                        audit_capture_index(admitted, source[0], source[1], source[2],
                            self.node, request_inputs, attempt_limit=4)
            with supervised_charged_index(**self.arguments(namespace, source)) as (admitted, _):
                root = admitted.lease.root
                pending_before = (root/"audit.pending").read_bytes()
                with patch("index_audit_controller._run_fixed_process") as launch:
                    with self.assertRaisesRegex(ValueError, "staged reporting bytes"):
                        audit_capture_index(admitted, source[0], source[1], source[2],
                            self.node, request_inputs, attempt_limit=4)
                    launch.assert_not_called()
                self.assertEqual((root/"audit.pending").read_bytes(), pending_before)
                self.assertTrue((root/AUDIT_EXECUTION).is_dir())

    def test_actual_committed_wal_rows_are_visible_without_changing_original_sidecars(self):
        capture = inputs()[0]
        with self.prepared() as (namespace, source), patch(
                "sqlite3.connect", side_effect=AssertionError("parent SQLite is forbidden")):
            with supervised_charged_index(**self.arguments(namespace, source)) as (admitted, _):
                def crash(node, worker, root, **kwargs):
                    return _run_fixed_process(node, "index-ingest-crash", root,
                                              case="after-commit", **kwargs)
                with patch("index_ingest._run_fixed_process", side_effect=crash):
                    with self.assertRaisesRegex(RuntimeError, "fixed ingestion worker failed"):
                        self._ingest(admitted, source, capture)
                root = admitted.lease.root
                self.assertGreater((root/"features.sqlite-wal").stat().st_size, 0)
                original = self._original_state(root)
                report = audit_capture_index(admitted, *source, self.node,
                                             self._audit_inputs([capture]))
                self.assertEqual(report["audit"]["result"]["counts"]["rawFeatures"], 473)
                self.assertEqual(self._original_state(root), original)
                self.assertFalse((root/AUDIT_EXECUTION).exists())

    def test_interrupted_database_copy_resumes_or_preserves_corruption_and_quota(self):
        for outcome in ("resume", "exhausted", "corrupt"):
            with self.subTest(outcome=outcome), self.prepared() as (namespace, source):
                capture = inputs()[0]
                requested = self._audit_inputs([capture])
                limit = 1 if outcome == "exhausted" else 2
                def interrupted_copy(original, destination, maximum, **kwargs):
                    if destination.name != "features.sqlite":
                        return _copy_file_real(original, destination, maximum, **kwargs)
                    prefix = original.read_bytes()[:4096]
                    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                    try:
                        self.assertEqual(os.write(fd, prefix), len(prefix))
                        os.fsync(fd)
                    finally:
                        os.close(fd)
                    raise OSError("injected snapshot copy interruption")
                with supervised_charged_index(**self.arguments(namespace, source)) as (admitted, _):
                    self._ingest(admitted, source, capture)
                    original = self._original_state(admitted.lease.root)
                    with patch("index_audit_controller._copy_file", side_effect=interrupted_copy):
                        with self.assertRaisesRegex(OSError, "snapshot copy interruption"):
                            audit_capture_index(admitted, *source, self.node, requested, attempt_limit=limit)
                    partial = admitted.lease.root/AUDIT_EXECUTION/"features.sqlite"
                    self.assertEqual(partial.stat().st_size, 4096)
                    if outcome == "corrupt":
                        raw = partial.read_bytes()
                        partial.write_bytes(bytes([raw[0] ^ 1]) + raw[1:])
                        corrupted = partial.read_bytes()
                with supervised_charged_index(**self.arguments(namespace, source)) as (admitted, _):
                    if outcome == "resume":
                        report = audit_capture_index(admitted, *source, self.node, requested, attempt_limit=limit)
                        self.assertEqual(report["auditController"]["attempts"], 2)
                        self.assertEqual(report["audit"]["result"]["counts"]["rawFeatures"], 473)
                    else:
                        with patch("index_audit_controller._run_fixed_process") as launch:
                            with self.assertRaises(ValueError):
                                audit_capture_index(admitted, *source, self.node, requested, attempt_limit=limit)
                            launch.assert_not_called()
                        if outcome == "corrupt":
                            self.assertEqual(partial.read_bytes(), corrupted)
                        else:
                            self.assertFalse((admitted.lease.root/AUDIT_EXECUTION).exists())
                            self.assertEqual(len(json.loads((admitted.lease.root/"audit.json").read_bytes())["attempts"]), 1)
                    self.assertEqual(self._original_state(admitted.lease.root), original)

    def test_actual_worker_rejects_missing_sql_occurrence_without_repair(self):
        capture = inputs()[0]
        with self.prepared() as (namespace, source):
            with supervised_charged_index(**self.arguments(namespace, source)) as (admitted, _):
                self._ingest(admitted, source, capture)
                # Deliberately damage only this disposable fixture before the
                # frozen audit. Production parent code never opens index SQL.
                db = sqlite3.connect(admitted.lease.root/"features.sqlite")
                try:
                    db.execute("DELETE FROM occurrences WHERE ordinal=0")
                    db.commit()
                finally:
                    db.close()
                original = self._original_state(admitted.lease.root)
                for number in (1, 2):
                    with self.assertRaisesRegex(RuntimeError, "fixed audit worker"):
                        audit_capture_index(admitted, *source, self.node, self._audit_inputs([capture]), attempt_limit=2)
                    record = json.loads((admitted.lease.root/"audit.json").read_bytes())
                    self.assertEqual(len(record["attempts"]), number)
                    self.assertIsNone(record["attempts"][-1]["report"])
                    self.assertEqual(self._original_state(admitted.lease.root), original)
                with patch("index_audit_controller._run_fixed_process") as launch:
                    with self.assertRaisesRegex(ValueError, "attempt limit is exhausted"):
                        audit_capture_index(admitted, *source, self.node, self._audit_inputs([capture]), attempt_limit=2)
                    launch.assert_not_called()
                self.assertEqual(self._original_state(admitted.lease.root), original)
