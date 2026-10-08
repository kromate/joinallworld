"""Serial, disposable kernel/native SQL/recovery checks; no network or ledger access."""
import json
import hashlib
import os
from pathlib import Path
import shutil
import unittest
from unittest.mock import patch

from index_resource_limits import MIB, reduced_limit, resource, run_worker


class ResourceGuardTests(unittest.TestCase):
    node = os.environ.get("WORLD_TEST_NODE") or shutil.which("node") or "/missing-node-runtime"
    results = []

    @classmethod
    def tearDownClass(cls):
        files = ["index_resource_limits.py", "index_resource_witness.mjs", "test_index_resource_limits.py"]
        print(json.dumps({"scope": "disposable resource/recovery witnesses, not durable index acceptance",
                          "sourceHashes": {file: hashlib.sha256((Path(__file__).parent / file).read_bytes()).hexdigest() for file in files},
                          "results": cls.results}, sort_keys=True))

    def witness(self, case, **limits):
        result = run_worker(self.node, "witness", case=case, **limits)
        receipt = {key: value for key, value in result.items() if key not in ["stdout", "stderr"]}
        receipt["stdoutBytes"] = len(result["stdout"].encode())
        receipt["stderrBytes"] = len(result["stderr"].encode())
        if case not in ["output-limit"] and result["stdout"]:
            receipt["workerResult"] = json.loads(result["stdout"])
        self.results.append(receipt)
        self.assertTrue(result["scratchRemovedAfterReturn"])
        self.assertTrue(all(size <= result["limits"]["fileBytes"] for size in result["scratchFilesBeforeRecovery"].values()))
        self.assertEqual(result["recovery"]["integrity"], "ok")
        return result

    def test_invalid_worker_and_limits_rejected_before_launch(self):
        for args in [dict(worker="arbitrary"), dict(worker="witness", case="../../other"),
                     dict(worker="capacity", case="commit"), dict(worker="capacity", file_bytes=64*MIB+1),
                     dict(worker="capacity", cpu_seconds=0), dict(worker="capacity", wall_seconds=61),
                     dict(worker="capacity", heap_mib=1537), dict(worker="capacity", rss_limit_bytes=513*MIB),
                     dict(worker="capacity", file_bytes=True)]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                run_worker(self.node, **args)
        with self.assertRaises(ValueError):
            run_worker("node", "capacity")

    def test_inherited_stricter_limits_are_never_raised(self):
        for inherited, requested, expected in [((20, 30), 40, (20, 20)),
                                               ((resource.RLIM_INFINITY, resource.RLIM_INFINITY), 40, (40, 40)),
                                               ((20, 30), 10, (10, 10))]:
            with patch.object(resource, "getrlimit", return_value=inherited):
                self.assertEqual(reduced_limit(resource.RLIMIT_FSIZE, requested), expected)

    def test_committed_transaction_survives_independent_reopen(self):
        result = self.witness("commit")
        self.assertEqual((result["returnCode"], result["reason"]), (0, "exit"))
        self.assertEqual(result["recovery"]["rows"], [[0, 1]] + [[n, 16384] for n in range(1, 5)])
        self.assertEqual(json.loads(result["stdout"])["committedRows"], 5)

    def test_native_sqlite_heap_capability_is_measured_not_assumed(self):
        result = self.witness("heap-capability")
        self.assertEqual(result["returnCode"], 0, result["stderr"])
        measured = json.loads(result["stdout"])
        self.assertTrue(measured["nativeHeapEnforcedByWitness"] or measured["returnedTextBytes"] == 8*MIB)
        self.assertEqual(measured["sqliteErrorCode"], 7 if measured["nativeHeapEnforcedByWitness"] else None)
        self.assertEqual(result["recovery"]["rows"], [[0, 1]])

    def test_sampled_process_guard_covers_native_allocation(self):
        result = self.witness("rss-limit", rss_limit_bytes=64*MIB, wall_seconds=5)
        self.assertEqual(result["reason"], "sampled-RSS-limit")
        self.assertEqual(result["terminationSignal"], "SIGKILL")
        self.assertGreater(result["maximumObservedWorkerRssBytes"], 64*MIB)
        self.assertEqual(result["recovery"]["rows"], [[0, 1]])

    def test_oversized_output_stops_worker_without_unbounded_buffer(self):
        result = self.witness("output-limit", wall_seconds=5)
        self.assertEqual(result["reason"], "output-limit")
        self.assertEqual(result["terminationSignal"], "SIGKILL")
        self.assertLessEqual(len(result["stdout"].encode()), 1_000_000)
        self.assertEqual(result["recovery"]["rows"], [[0, 1]])

    def test_database_page_limit_rolls_back_complete_transaction(self):
        result = self.witness("page-limit")
        self.assertEqual(result["returnCode"], 0, result["stderr"])
        self.assertEqual(json.loads(result["stdout"])["sqliteErrorCode"], 13)
        self.assertEqual(result["recovery"]["rows"], [[0, 1]])

    def test_kernel_file_limit_bounds_wal_before_commit(self):
        result = self.witness("file-limit", file_bytes=128*1024)
        self.assertNotEqual(result["returnCode"], 0, "write must fail or terminate, never commit")
        self.assertEqual(result["reason"], "exit")
        self.assertEqual(result["recovery"]["rows"], [[0, 1]])
        self.assertEqual(result["scratchFilesBeforeRecovery"]["witness.sqlite-wal"], 128*1024)
        if result["terminationSignal"] is None:
            failure = json.loads(result["stdout"])
            self.assertEqual(failure["code"], "ERR_SQLITE_ERROR")
            self.assertIn(failure["sqliteErrorCode"] & 255, [10, 13])

    def test_abrupt_worker_death_does_not_publish_partial_transaction(self):
        result = self.witness("crash")
        self.assertEqual(result["terminationSignal"], "SIGKILL")
        self.assertEqual(result["recovery"]["rows"], [[0, 1]])
        self.assertGreater(result["scratchFilesBeforeRecovery"]["witness.sqlite-wal"], 0)
        self.assertEqual(json.loads(result["stdout"])["uncommittedWalBytes"], result["scratchFilesBeforeRecovery"]["witness.sqlite-wal"])

    def test_missing_live_rss_measurement_fails_closed(self):
        with patch("index_resource_limits.rss_bytes", side_effect=RuntimeError("injected unavailable RSS")):
            result = run_worker(self.node, "witness", case="wall-limit")
        self.assertEqual(result["reason"], "RSS-measurement-failed")
        self.assertEqual(result["terminationSignal"], "SIGKILL")
        self.assertTrue(result["scratchRemovedAfterReturn"])

    def test_wall_guard_kills_only_owned_worker_and_waits_terminal(self):
        result = self.witness("wall-limit", wall_seconds=1)
        self.assertEqual(result["reason"], "wall-limit")
        self.assertEqual(result["terminationSignal"], "SIGKILL")
        self.assertLess(result["elapsedMs"], 4000)
        self.assertEqual(result["recovery"]["rows"], [[0, 1]])

    def test_kernel_cpu_guard_stops_busy_worker(self):
        result = self.witness("cpu-limit", cpu_seconds=1, wall_seconds=5)
        self.assertIn(result["terminationSignal"], ["SIGXCPU", "SIGKILL"])
        self.assertEqual(result["reason"], "exit")
        self.assertLess(result["elapsedMs"], 5000)
        self.assertEqual(result["recovery"]["rows"], [[0, 1]])


if __name__ == "__main__":
    unittest.main()
