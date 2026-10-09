"""Plan-aware registry startup refuses before launch unless bound by V3 state."""
import hashlib
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

from index_registry_startup import startup_index_namespace
from test_index_bootstrap import pin, source_fixture
from test_index_registry_worker import planner_fixture

MIB = 1024 * 1024


class IndexShardStartupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.python = Path(sys.executable).resolve(strict=True)
        raw = cls.python.read_bytes()
        cls.runtime = {"pythonVersion": sys.version.split()[0], "sqliteVersion": sqlite3.sqlite_version,
                       "pythonBytes": len(raw), "pythonSha256": hashlib.sha256(raw).hexdigest()}

    def invoke(self, namespace, source, *, aggregate=64*MIB, plan_input=None, binding_bytes=None):
        repository, manifest, configuration = source
        return startup_index_namespace(namespace, aggregate, repository, manifest, pin(manifest),
            configuration, pin(configuration), self.python, dict(self.runtime),
            _binding_bytes=binding_bytes, _plan_input=plan_input)

    def prepared_namespace(self):
        temporary = tempfile.TemporaryDirectory(prefix="allworld-shard-startup-")
        root = Path(temporary.name).resolve(strict=True) / "namespace"
        root.mkdir(mode=0o700)
        return temporary, root

    def test_plan_operation_requires_actual_held_lease_and_execution_snapshot_before_launch(self):
        raw, plan_pin, base, _ = planner_fixture()
        with source_fixture() as source:
            temporary, namespace = self.prepared_namespace()
            try:
                plan_input = {"raw": raw, "pin": plan_pin}
                with patch("index_registry_startup._run_fixed_process") as launch:
                    with self.assertRaisesRegex(ValueError, "persistent controller and held lease"):
                        self.invoke(namespace, source, plan_input=plan_input, binding_bytes=base)
                    launch.assert_not_called()
                self.assertEqual(list(namespace.iterdir()), [])
            finally:
                temporary.cleanup()

    def test_plan_aggregate_must_match_namespace_budget_before_any_registry_launch(self):
        raw, plan_pin, base, plan = planner_fixture()
        with source_fixture() as source:
            temporary, namespace = self.prepared_namespace()
            try:
                with patch("index_registry_startup._run_fixed_process") as launch:
                    with self.assertRaisesRegex(ValueError, "aggregate differs"):
                        self.invoke(namespace, source, aggregate=65*MIB,
                                    plan_input={"raw": raw, "pin": plan_pin}, binding_bytes=base)
                    launch.assert_not_called()
                self.assertEqual(list(namespace.iterdir()), [])
            finally:
                temporary.cleanup()

    def test_plan_input_has_exact_immutable_raw_and_pin_fields(self):
        raw, plan_pin, base, _ = planner_fixture()
        malformed = {"raw": raw, "pin": plan_pin, "extra": True}
        with source_fixture() as source:
            temporary, namespace = self.prepared_namespace()
            try:
                with patch("index_registry_startup._run_fixed_process") as launch:
                    with self.assertRaisesRegex(ValueError, "exact immutable raw bytes and pin"):
                        self.invoke(namespace, source, plan_input=malformed, binding_bytes=base)
                    launch.assert_not_called()
                self.assertEqual(list(namespace.iterdir()), [])
            finally:
                temporary.cleanup()


if __name__ == "__main__": unittest.main()
