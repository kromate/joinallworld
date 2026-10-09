"""Pure startup-worker checks using only disposable private namespace roots."""
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import resource
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import index_registry_worker as worker
from index_reservations import DATABASE_BYTES, REGISTRY_ALLOWANCE
from index_writer_lock import index_writer_lease

MIB = 1024 * 1024
BUDGET = REGISTRY_ALLOWANCE + 2 * MIB


class IndexRegistryWorkerTests(unittest.TestCase):
    def setUp(self):
        self.saved_fsize = resource.getrlimit(resource.RLIMIT_FSIZE)
        limits = [DATABASE_BYTES] + [limit for limit in self.saved_fsize if limit != resource.RLIM_INFINITY]
        resource.setrlimit(resource.RLIMIT_FSIZE, (min(limits), self.saved_fsize[1]))
        self.temp = tempfile.TemporaryDirectory(prefix="allworld-registry-worker-")
        self.parent = Path(self.temp.name).resolve(strict=True)
        self.root = self.parent / "namespace"
        self.root.mkdir(mode=0o700)
        os.chmod(self.root, 0o700)

    def tearDown(self):
        self.temp.cleanup()
        resource.setrlimit(resource.RLIMIT_FSIZE, self.saved_fsize)

    def environment(self, descriptor, **changes):
        values = {
            "TMPDIR": str(self.root),
            "WORLD_INDEX_NAMESPACE_BUDGET": str(BUDGET),
            "WORLD_INDEX_PYTHON_VERSION": __import__("sys").version.split()[0],
            "WORLD_INDEX_PYTHON_SQLITE_VERSION": sqlite3.sqlite_version,
            "WORLD_INDEX_NAMESPACE_DESCRIPTOR": str(descriptor),
        }
        values.update(changes)
        return values

    def test_budget_parser_accepts_only_bounded_ascii_decimal(self):
        self.assertEqual(worker._budget(str(BUDGET)), BUDGET)
        self.assertEqual(worker._budget("0" + str(BUDGET)), BUDGET)
        for invalid in ["", "+123", "-1", " 123", "123 ", "1e6", "True", "１２３", "12345678901"]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                worker._budget(invalid)
        for out_of_range in ["1", str(worker.MAX_AGGREGATE_BYTES + 1)]:
            with self.subTest(out_of_range=out_of_range), self.assertRaises(ValueError):
                worker._budget(out_of_range)

    def test_runtime_pin_mismatch_and_missing_values_fail_before_namespace_lock(self):
        with self.assertRaisesRegex(RuntimeError, "Python runtime"):
            worker._runtime_environment(self.environment("3", WORLD_INDEX_PYTHON_VERSION="0.0"))
        with self.assertRaisesRegex(RuntimeError, "SQLite runtime"):
            worker._runtime_environment(self.environment("3", WORLD_INDEX_PYTHON_SQLITE_VERSION="0.0"))
        with self.assertRaisesRegex(ValueError, "ASCII decimal"):
            worker._runtime_environment(self.environment("3", WORLD_INDEX_NAMESPACE_BUDGET=" "))
        with index_writer_lease(self.root) as lease:
            environment = self.environment(str(lease.descriptor))
            environment.pop("WORLD_INDEX_NAMESPACE_DESCRIPTOR")
            with self.assertRaisesRegex(ValueError, "incomplete"):
                worker._runtime_environment(environment)
            for invalid in ["2", "invalid", "9999999999"]:
                environment = self.environment(invalid)
                with self.subTest(descriptor=invalid), self.assertRaises(ValueError):
                    worker._runtime_environment(environment)
        self.assertFalse((self.root / "reservations.sqlite").exists())

    def test_unrelated_namespace_descriptor_is_refused(self):
        other = self.parent / "other"
        other.mkdir(mode=0o700)
        os.chmod(other, 0o700)
        with index_writer_lease(self.root), index_writer_lease(other) as unrelated:
            with self.assertRaisesRegex(ValueError, "differs"):
                worker._runtime_environment(self.environment(str(unrelated.descriptor)))
        self.assertFalse((self.root / "reservations.sqlite").exists())

    def test_fixed_worker_initializes_then_reopens_without_changing_registry_inode(self):
        with index_writer_lease(self.root) as lease:
            first = json.loads(worker._run(self.root, BUDGET, lease))
        database = self.root / "reservations.sqlite"
        inode = database.stat().st_ino
        self.assertEqual(set(first), {
            "format", "namespaceBindingSha256", "aggregateBytes", "replayed", "pythonVersion",
            "sqliteVersion", "stats", "databaseBytes", "maximumRssKiB",
        })
        self.assertEqual(first["format"], "feature-index-registry-startup-v1")
        self.assertFalse(first["replayed"])
        self.assertEqual(first["aggregateBytes"], BUDGET)
        self.assertEqual(first["stats"]["reservations"], 0)
        self.assertEqual(first["stats"]["heldBytes"], 0)
        self.assertEqual(first["stats"]["aggregateLimitBytes"], BUDGET)
        self.assertEqual(first["databaseBytes"], database.stat().st_size)
        self.assertGreater(first["maximumRssKiB"], 0)
        with index_writer_lease(self.root) as lease:
            second = json.loads(worker._run(self.root, BUDGET, lease))
            self.assertTrue(second["replayed"])
            self.assertEqual(second["stats"], first["stats"])
        self.assertEqual(database.stat().st_ino, inode)

    def test_main_prints_one_canonical_report_after_namespace_close(self):
        output = io.StringIO()
        with index_writer_lease(self.root) as lease:
            env = self.environment(str(lease.descriptor))
            with patch.dict(os.environ, env, clear=True), patch.object(worker.sys, "argv", ["index_registry_worker.py"]), redirect_stdout(output):
                self.assertEqual(worker.main(), 0)
        raw = output.getvalue()
        self.assertTrue(raw.endswith("\n"))
        report = json.loads(raw)
        self.assertEqual(raw, json.dumps(report, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n")
        self.assertTrue((self.root / "reservations.sqlite").is_file())

    def test_main_rejects_cli_arguments_without_opening_the_namespace(self):
        output = io.StringIO()
        with patch.dict(os.environ, {}, clear=True), patch.object(worker.sys, "argv", ["index_registry_worker.py", "extra"]), redirect_stdout(output):
            with self.assertRaisesRegex(ValueError, "no arguments"):
                worker.main()
        self.assertEqual(output.getvalue(), "")
        self.assertFalse((self.root / "writer.lock").exists())


if __name__ == "__main__":
    unittest.main()
