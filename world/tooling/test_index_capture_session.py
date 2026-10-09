"""Actual isolated JSONL sessions over retained captures and disposable indexes.

Observation values here are synthetic contexts. These checks prove held-session
admission and replay behavior, not campaign membership or completion.
"""
import base64
import hashlib
import json
from pathlib import Path
import sqlite3
import signal
import subprocess
import sys
import time
import unittest

from index_binding import decode_index_binding, encode_index_binding
import test_index_admission as admission_fixture
from test_index_ingest import inputs
from index_capture_state import RECORD
from index_capture_snapshot import CAPTURE_EXECUTION
from index_writer_lock import index_writer_lease

TOOLING = Path(__file__).resolve().parent
SCRIPT = TOOLING / "index_admission.py"


def context(job):
    return {"campaignHash": hashlib.sha256(b"synthetic-campaign").hexdigest(),
            "planHash": hashlib.sha256(b"synthetic-plan").hexdigest(),
            "jobId": job, "rootCellId": "geo-grid-v1:l1:x324:y209", "queryPath": "0"}


def line(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode("ascii") + b"\n"


class IndexCaptureSessionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        admission_fixture.IndexAdmissionTests.setUpClass.__func__(cls)

    prepared = admission_fixture.IndexAdmissionTests.prepared
    arguments = admission_fixture.IndexAdmissionTests.arguments
    bound = admission_fixture.IndexAdmissionTests.bound

    def init(self, namespace, source):
        repository, manifest, configuration = source
        binding = self.bound(manifest, configuration)
        python = Path(sys.executable).resolve(strict=True).read_bytes()
        runtime = {"pythonVersion": sys.version.split()[0], "sqliteVersion": sqlite3.sqlite_version,
                   "pythonBytes": len(python), "pythonSha256": hashlib.sha256(python).hexdigest()}
        return {"format": "feature-index-session-init-v1", "namespaceRoot": str(namespace),
                "aggregateBytes": 64*1024*1024, "repositoryRoot": str(repository),
                "manifestBase64": base64.b64encode(manifest).decode("ascii"),
                "sourceConfigurationBase64": base64.b64encode(configuration).decode("ascii"),
                "bindingBase64": base64.b64encode(binding).decode("ascii"),
                "pythonRuntime": runtime, "node": str(self.node)}

    def run_session(self, payload):
        return subprocess.run([str(Path(sys.executable).resolve(strict=True)), "-I", "-B", str(SCRIPT),
                               "--capture-session"], input=payload, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, check=False)

    def open_session(self, init):
        process = subprocess.Popen([str(Path(sys.executable).resolve(strict=True)), "-I", "-B", str(SCRIPT),
                                    "--capture-session"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE)
        process.stdin.write(line(init)); process.stdin.flush()
        ready = json.loads(process.stdout.readline())
        self.assertEqual(ready["format"], "feature-index-session-ready-v1")
        return process, ready

    @staticmethod
    def worker_group_live(script_path):
        result = subprocess.run(["/bin/ps", "-axo", "pgid=,args="], capture_output=True,
                                timeout=2, check=True, text=True)
        for raw in result.stdout.splitlines():
            fields = raw.strip().split(None, 1)
            if len(fields) == 2 and script_path in fields[1]:
                try: return int(fields[0])
                except ValueError: pass
        return None

    def assert_leases_reopened(self, namespace, index_hash):
        with index_writer_lease(namespace): pass
        with index_writer_lease(namespace/index_hash): pass

    def capture_job(self, job_id, capture, observation):
        extract, receipt, expected = capture
        return {"format": "feature-index-session-capture-v1", "id": job_id,
                "extractPath": str(extract), "receiptPath": str(receipt),
                "expected": expected, "observation": observation}

    @staticmethod
    def audit_begin(count, attempt_limit=8):
        return {"format": "feature-index-session-audit-begin-v1", "id": 1,
                "count": count, "attemptLimit": attempt_limit}

    @staticmethod
    def audit_capture(capture, observation, ordinal, *, extract_path=None, receipt_path=None):
        extract, receipt, expected = capture
        return {"format": "feature-index-session-audit-capture-v1", "id": 1,
                "ordinal": ordinal, "extractPath": str(extract) if extract_path is None else extract_path,
                "receiptPath": str(receipt) if receipt_path is None else receipt_path,
                "expected": expected, "requiredObservations": [observation]}

    @staticmethod
    def audit_run():
        return {"format": "feature-index-session-audit-run-v1", "id": 1}

    def test_retained_captures_share_one_admission_per_session_and_reopen_replays(self):
        with self.prepared() as (namespace, source):
            init = self.init(namespace, source)
            retained = inputs()
            first_payload = line(init) + b"".join(line(self.capture_job(i, capture, context(f"synthetic-{i}")))
                                                       for i, capture in enumerate(retained, 1)) + line({"format": "feature-index-session-close-v1"})
            first = self.run_session(first_payload)
            self.assertEqual(first.returncode, 0, first.stderr.decode("utf-8", "replace"))
            messages = [json.loads(raw) for raw in first.stdout.splitlines()]
            self.assertEqual([item["format"] for item in messages], [
                "feature-index-session-ready-v1", "feature-index-session-result-v1",
                "feature-index-session-result-v1", "feature-index-session-done-v1"])
            index_hash = messages[0]["indexHash"]
            self.assertEqual(messages[0]["admission"]["indexHash"], index_hash)
            self.assertEqual([item["report"]["ingest"]["result"]["features"] for item in messages[1:3]], [473, 1810])
            self.assertEqual([item["report"]["captureController"]["attempts"] for item in messages[1:3]], [1, 1])
            self.assertEqual(messages[-1], {"format": "feature-index-session-done-v1", "indexHash": index_hash,
                                            "captures": 2})

            second_payload = line(init) + line(self.capture_job(1, retained[0], context("synthetic-1")))
            second = self.run_session(second_payload)  # EOF closes after the terminal actual call.
            self.assertEqual(second.returncode, 0, second.stderr.decode("utf-8", "replace"))
            reopened = [json.loads(raw) for raw in second.stdout.splitlines()]
            self.assertEqual([item["format"] for item in reopened], [
                "feature-index-session-ready-v1", "feature-index-session-result-v1",
                "feature-index-session-done-v1"])
            self.assertEqual(reopened[1]["report"]["captureController"]["attempts"], 2)
            self.assertTrue(reopened[1]["report"]["ingest"]["result"]["replayed"])
            self.assertEqual(reopened[-1]["captures"], 1)
            self.assertEqual(len(json.loads((namespace/"controller.json").read_bytes())["attempts"]), 2)
            self.assertTrue((namespace/index_hash/RECORD).is_file())

    def test_final_audit_and_reopened_audit_conserve_captures_without_new_ingestion(self):
        with self.prepared() as (namespace, source):
            init = self.init(namespace, source); retained = inputs()
            jobs = [self.capture_job(i, capture, context(f"audit-{i}")) for i, capture in enumerate(retained, 1)]
            descriptors = sorted((self.audit_capture(capture, job["observation"], 0)
                                  for capture, job in zip(retained, jobs)), key=lambda item: item["expected"]["requestHash"])
            for ordinal, item in enumerate(descriptors): item["ordinal"] = ordinal
            frames = line(self.audit_begin(len(descriptors))) + b"".join(line(item) for item in descriptors) + line(self.audit_run())
            first = self.run_session(line(init) + b"".join(line(job) for job in jobs) + frames + line({"format": "feature-index-session-close-v1"}))
            self.assertEqual(first.returncode, 0, first.stderr.decode("utf-8", "replace"))
            messages = [json.loads(raw) for raw in first.stdout.splitlines()]
            self.assertIn("report", messages[-2], messages[-2])
            report = messages[-2]["report"]
            self.assertEqual(report["audit"]["result"]["counts"]["rawFeatures"], 2283)
            self.assertEqual(report["audit"]["result"]["counts"]["requiredObservations"], 2)
            self.assertEqual(report["auditController"]["attempts"], 1)
            self.assertEqual(messages[-1]["captures"], 2)
            index_hash = messages[0]["indexHash"]; root = namespace/index_hash
            before = {name: (root/name).read_bytes() for name in ("capture.json", "audit.json", "features.sqlite")}
            second = self.run_session(line(init) + frames)  # EOF after a terminal audit is safe.
            self.assertEqual(second.returncode, 0, second.stderr.decode("utf-8", "replace"))
            replay = [json.loads(raw) for raw in second.stdout.splitlines()]
            self.assertEqual(replay[1]["report"]["auditController"]["attempts"], 1)
            self.assertTrue(replay[1]["report"]["auditController"]["replayed"])
            self.assertIsNone(replay[1]["report"]["guard"])
            self.assertEqual(replay[-1]["captures"], 0)
            for name, raw in before.items(): self.assertEqual((root/name).read_bytes(), raw)

    def test_audit_descriptor_order_and_close_before_run_fail_explicitly(self):
        for premature_close in (False, True):
            with self.subTest(premature_close=premature_close), self.prepared() as (namespace, source):
                capture = inputs()[0]; observation = context("audit-order")
                payload = line(self.init(namespace, source)) + line(self.capture_job(1, capture, observation))
                payload += line(self.audit_begin(1))
                if premature_close:
                    payload += line({"format": "feature-index-session-close-v1"})
                else:
                    payload += line(self.audit_capture(capture, observation, 1))
                result = self.run_session(payload)
                self.assertNotEqual(result.returncode, 0)
                messages = [json.loads(raw) for raw in result.stdout.splitlines()]
                self.assertEqual([item["format"] for item in messages], [
                    "feature-index-session-ready-v1", "feature-index-session-result-v1"])
                self.assertIn(b"audit", result.stderr.lower())
                self.assertFalse((namespace/messages[0]["indexHash"]/"audit.json").exists())

    def test_audit_descriptor_aggregate_limit_includes_expanded_expectations_and_pins(self):
        with self.prepared() as (namespace, source):
            capture = inputs()[0]; observation = context("audit-size")
            payload = line(self.init(namespace, source)) + line(self.capture_job(1, capture, observation))
            payload += line(self.audit_begin(256))
            for ordinal in range(256):
                payload += line(self.audit_capture(capture, observation, ordinal,
                    extract_path="/"+"e"*3900, receipt_path="/"+"r"*3900))
            payload += line(self.audit_run()) + line({"format": "feature-index-session-close-v1"})
            result = self.run_session(payload)
            self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", "replace"))
            messages = [json.loads(raw) for raw in result.stdout.splitlines()]
            self.assertEqual([item["format"] for item in messages], [
                "feature-index-session-ready-v1", "feature-index-session-result-v1",
                "feature-index-session-audit-result-v1", "feature-index-session-done-v1"])
            self.assertIn("512000", messages[2]["error"])
            self.assertEqual(messages[-1]["captures"], 1)
            self.assertFalse((namespace/messages[0]["indexHash"]/"audit.json").exists())

    def test_audit_error_is_terminal_but_still_allows_session_close(self):
        with self.prepared() as (namespace, source):
            capture = inputs()[0]; observation = context("audit-error")
            payload = line(self.init(namespace, source)) + line(self.capture_job(1, capture, observation))
            payload += line(self.audit_begin(1))
            payload += line(self.audit_capture(capture, observation, 0, extract_path="/wrong"))
            payload += line(self.audit_run()) + line({"format": "feature-index-session-close-v1"})
            result = self.run_session(payload)
            self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", "replace"))
            messages = [json.loads(raw) for raw in result.stdout.splitlines()]
            self.assertEqual([item["format"] for item in messages], [
                "feature-index-session-ready-v1", "feature-index-session-result-v1",
                "feature-index-session-audit-result-v1", "feature-index-session-done-v1"])
            self.assertIn("error", messages[2])
            self.assertEqual(messages[-1]["captures"], 1)

    def test_malformed_duplicate_or_oversized_init_fails_before_admission(self):
        cases = [b'{"format":"feature-index-session-init-v1","format":"x"}\n',
                 b'{"format":"feature-index-session-init-v1"}', b" "*256001 + b"\n"]
        for payload in cases:
            with self.subTest(length=len(payload)), self.prepared() as (namespace, source):
                result = self.run_session(payload)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, b"")
                self.assertLessEqual(len(result.stderr.rstrip(b"\n")), 4096)
                self.assertEqual(list(namespace.iterdir()), [])

    def test_bad_binding_pin_fails_before_admission(self):
        with self.prepared() as (namespace, source):
            init = self.init(namespace, source)
            raw = base64.b64decode(init["bindingBase64"])
            value = decode_index_binding(raw)
            value["toolingManifest"]["sha256"] = "0"*64
            init["bindingBase64"] = base64.b64encode(encode_index_binding(value)).decode("ascii")
            result = self.run_session(line(init))
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, b"")
            self.assertEqual(list(namespace.iterdir()), [])

    def test_confirmed_job_error_is_bounded_and_session_continues_to_close(self):
        with self.prepared() as (namespace, source):
            init = self.init(namespace, source)
            invalid = self.capture_job(1, inputs()[0], {"not": "an observation"})
            payload = line(init) + line(invalid) + line({"format": "feature-index-session-close-v1"})
            result = self.run_session(payload)
            self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", "replace"))
            messages = [json.loads(raw) for raw in result.stdout.splitlines()]
            self.assertEqual([item["format"] for item in messages], [
                "feature-index-session-ready-v1", "feature-index-session-result-v1",
                "feature-index-session-done-v1"])
            self.assertIn("error", messages[1])
            self.assertLessEqual(len(messages[1]["error"].encode("utf-8")), 4096)
            self.assertEqual(messages[-1]["captures"], 1)

    def test_exact_job_fields_and_contiguous_ids_refuse_without_capture_record(self):
        with self.prepared() as (namespace, source):
            init = self.init(namespace, source)
            bad = self.capture_job(2, inputs()[0], context("synthetic")); bad["extra"] = True
            result = self.run_session(line(init) + line(bad))
            self.assertNotEqual(result.returncode, 0)
            messages = [json.loads(raw) for raw in result.stdout.splitlines()]
            self.assertEqual([item["format"] for item in messages], ["feature-index-session-ready-v1"])
            child = namespace/messages[0]["indexHash"]
            self.assertFalse((child/RECORD).exists())

    def test_sigterm_while_idle_unwinds_held_session_then_emits_safe_done(self):
        with self.prepared() as (namespace, source):
            process, ready = self.open_session(self.init(namespace, source))
            process.send_signal(signal.SIGTERM)
            tail, stderr = process.communicate(timeout=60)
            messages = [ready, *(json.loads(raw) for raw in tail.splitlines())]
            self.assertEqual(process.returncode, 1, stderr.decode("utf-8", "replace"))
            self.assertEqual([item["format"] for item in messages], [
                "feature-index-session-ready-v1", "feature-index-session-done-v1"])
            self.assertEqual(messages[-1], {"format": "feature-index-session-done-v1",
                                            "indexHash": ready["indexHash"], "captures": 0})
            self.assert_leases_reopened(namespace, ready["indexHash"])

    def test_sigterm_during_fixed_capture_reaps_worker_before_safe_done(self):
        with self.prepared() as (namespace, source):
            process, ready = self.open_session(self.init(namespace, source))
            capture = inputs()[0]
            process.stdin.write(line(self.capture_job(1, capture, context("synthetic-sigterm"))))
            process.stdin.flush()
            worker_script = str(namespace/ready["indexHash"]/CAPTURE_EXECUTION/"world/tooling/index_ingest.ts")
            deadline = time.monotonic() + 30
            group = None
            while time.monotonic() < deadline:
                group = self.worker_group_live(worker_script)
                if group is not None: break
                time.sleep(0.02)
            self.assertIsNotNone(group, "fixed Node capture worker did not become visible within its bound")
            process.send_signal(signal.SIGTERM)
            tail, stderr = process.communicate(timeout=60)
            messages = [ready, *(json.loads(raw) for raw in tail.splitlines())]
            self.assertEqual(process.returncode, 1, stderr.decode("utf-8", "replace"))
            self.assertEqual([item["format"] for item in messages], [
                "feature-index-session-ready-v1", "feature-index-session-result-v1",
                "feature-index-session-done-v1"])
            self.assertIn("error", messages[1], "a cancelled actual capture is a charged failed result")
            self.assertEqual(messages[-1]["captures"], 1)
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline and self.worker_group_live(worker_script) == group: time.sleep(0.05)
            self.assertNotEqual(self.worker_group_live(worker_script), group, "fixed Node process group must be reaped before done")
            self.assert_leases_reopened(namespace, ready["indexHash"])


if __name__ == "__main__":
    unittest.main()
