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

    def test_retained_captures_share_one_admission_per_session_and_reopen_replays(self):
        with self.prepared() as (namespace, source):
            init = self.init(namespace, source)
            retained = inputs()
            first_payload = line(init) + b"".join(line(self.capture_job(i, capture, context(f"synthetic-{i}")))
                                                       for i, capture in enumerate(retained, 1)) + line(
                {"format": "feature-index-session-close-v1"})
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
