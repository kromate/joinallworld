"""Actual pinned Python worker in disposable sources/namespaces; no real ledgers."""
from contextlib import contextmanager
from dataclasses import replace
import hashlib
import json
import resource
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

from index_execution_snapshot import verified_execution_snapshot
from index_registry_startup import startup_index_namespace
from index_resource_limits import _run_fixed_process, IndexWorkerUnreaped
from index_writer_lock import index_writer_lease, IndexWriterBusy
from index_namespace import open_index_namespace
from index_binding import decode_index_binding, encode_index_binding
from test_index_bootstrap import source_fixture, pin
from test_index_root import binding

MIB = 1024*1024


class IndexRegistryStartupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.python = Path(sys.executable).resolve(strict=True)
        raw = cls.python.read_bytes()
        cls.runtime = {"pythonVersion": sys.version.split()[0], "sqliteVersion": sqlite3.sqlite_version,
                       "pythonBytes": len(raw), "pythonSha256": hashlib.sha256(raw).hexdigest()}

    @contextmanager
    def prepared(self):
        with source_fixture() as source, tempfile.TemporaryDirectory(prefix="allworld-registry-startup-") as temp:
            root = Path(temp).resolve(strict=True)
            namespace = root/"namespace"; namespace.mkdir(mode=0o700)
            yield namespace, source

    def run_startup(self, namespace, source, **changes):
        repository, manifest, configuration = source
        args = {"namespace_root": namespace, "aggregate_bytes": 64*MIB,
                "repository_root": repository, "manifest_bytes": manifest, "manifest_pin": pin(manifest),
                "source_configuration": configuration, "source_pin": pin(configuration),
                "python": self.python, "python_runtime": dict(self.runtime)}
        args.update(changes)
        return startup_index_namespace(**args)

    def test_actual_worker_initializes_and_reopens_same_inode_without_parent_sql(self):
        with self.prepared() as (namespace, source):
            with patch("index_namespace.sqlite3.connect", side_effect=AssertionError("parent SQL is not supervised")):
                first = self.run_startup(namespace, source)
                inode = (namespace/"reservations.sqlite").stat().st_ino
                second = self.run_startup(namespace, source)
            self.assertFalse(first["registry"]["replayed"])
            self.assertTrue(second["registry"]["replayed"])
            self.assertEqual((namespace/"reservations.sqlite").stat().st_ino, inode)
            self.assertEqual(first["registry"]["stats"], second["registry"]["stats"])
            self.assertEqual(first["registry"]["stats"]["reservations"], 0)
            self.assertTrue(first["guard"]["inheritedNamespaceLease"])
            self.assertIsNone(first["guard"]["limits"]["v8HeapMiB"])
            self.assertEqual(first["guard"]["limits"]["fileBytes"], 4*MIB)
            self.assertLess(first["executionSnapshotChargedBytes"], MIB)
            self.assertEqual(sorted(p.name for p in namespace.iterdir()), ["namespace.json", "reservations.sqlite", "writer.lock"])

    def test_bad_runtime_binary_pin_or_source_refuses_before_namespace_lock(self):
        with self.prepared() as (namespace, source):
            with self.assertRaisesRegex(ValueError, "runtime pin"):
                self.run_startup(namespace, source, python_runtime={**self.runtime, "pythonSha256": "0"*64})
            self.assertEqual(list(namespace.iterdir()), [])
            (source[0]/"world/tooling/index_registry_worker.py").write_bytes(b"raise RuntimeError('mutated source')")
            with self.assertRaisesRegex(ValueError, "tooling"):
                self.run_startup(namespace, source)
            self.assertEqual(list(namespace.iterdir()), [])

    def test_runtime_versions_fail_in_actual_worker_before_sql(self):
        for field, wrong in [("pythonVersion", "3.12.99"), ("sqliteVersion", "3.53.99")]:
            with self.subTest(field=field), self.prepared() as (namespace, source):
                with self.assertRaisesRegex(RuntimeError, "registry worker failed"):
                    self.run_startup(namespace, source, python_runtime={**self.runtime, field: wrong})
                self.assertEqual(sorted(p.name for p in namespace.iterdir()), ["writer.lock"])

    def test_changed_budget_is_refused_without_registry_mutation_or_launch(self):
        with self.prepared() as (namespace, source):
            self.run_startup(namespace, source)
            before = (namespace/"reservations.sqlite").read_bytes()
            with patch("index_registry_startup._run_fixed_process") as launch:
                with self.assertRaisesRegex(ValueError, "metadata"):
                    self.run_startup(namespace, source, aggregate_bytes=65*MIB)
                launch.assert_not_called()
            self.assertEqual((namespace/"reservations.sqlite").read_bytes(), before)

    def test_live_namespace_blocks_snapshot_allocation_before_launch(self):
        with self.prepared() as (namespace, source), index_writer_lease(namespace):
            with patch("index_registry_startup.verified_execution_snapshot") as snapshot:
                with self.assertRaises(IndexWriterBusy): self.run_startup(namespace, source)
                snapshot.assert_not_called()
            self.assertFalse((namespace/"reservations.sqlite").exists())

    def test_frozen_python_worker_survives_original_source_mutation_and_snapshot_is_removed(self):
        with self.prepared() as (namespace, source):
            snapshots = []
            def run(*args, **kwargs):
                snapshots.append(kwargs["execution_root"])
                (source[0]/"world/tooling/index_registry_worker.py").write_bytes(b"raise RuntimeError('mutable worker')")
                return _run_fixed_process(*args, **kwargs)
            with patch("index_registry_startup._run_fixed_process", side_effect=run):
                result = self.run_startup(namespace, source)
            self.assertEqual(result["guard"]["returnCode"], 0)
            self.assertFalse(snapshots[0].exists())

    def test_snapshot_cannot_consume_the_registry_disk_margin(self):
        @contextmanager
        def oversized(*args, **kwargs):
            with verified_execution_snapshot(*args, **kwargs) as snapshot:
                yield replace(snapshot, charged_bytes=MIB)
        with self.prepared() as (namespace, source), patch("index_registry_startup.verified_execution_snapshot", side_effect=oversized):
            with patch("index_registry_startup._run_fixed_process") as launch:
                with self.assertRaisesRegex(ValueError, "snapshot cannot fit"):
                    self.run_startup(namespace, source)
                launch.assert_not_called()
            self.assertFalse((namespace/"reservations.sqlite").exists())

    def test_unconfirmed_reap_preserves_snapshot_and_actual_error_handle(self):
        class InjectedHandle:
            pid = 123
        paths = []
        def unconfirmed(python, worker, root, **kwargs):
            paths.append(kwargs["execution_root"])
            raise IndexWorkerUnreaped(InjectedHandle(), root, paths[-1], "injected unconfirmed wait")
        try:
            with self.prepared() as (namespace, source), patch("index_registry_startup._run_fixed_process", side_effect=unconfirmed):
                with self.assertRaises(IndexWorkerUnreaped) as caught: self.run_startup(namespace, source)
                self.assertEqual(caught.exception.retained_snapshot, paths[0])
                self.assertTrue(paths[0].exists())
                self.assertEqual(caught.exception.root, namespace)
        finally:
            for path in paths: shutil.rmtree(path)

    def test_invalid_report_counters_fail_closed_after_terminal_worker(self):
        def invalid(*args, **kwargs):
            result = _run_fixed_process(*args, **kwargs)
            self.assertEqual(result["returnCode"], 0, result["stderr"])
            report = json.loads(result["stdout"]); report["stats"]["heldBytes"] = True
            return {**result, "stdout": json.dumps(report)}
        with self.prepared() as (namespace, source), patch("index_registry_startup._run_fixed_process", side_effect=invalid):
            with self.assertRaisesRegex(ValueError, "report charges"):
                self.run_startup(namespace, source)
            self.assertTrue((namespace/"reservations.sqlite").is_file())

    def test_reported_transient_peak_above_ceiling_is_refused_and_registry_preserved(self):
        def over_peak(*args, **kwargs):
            result = _run_fixed_process(*args, **kwargs)
            self.assertEqual(result["returnCode"], 0, result["stderr"])
            report = json.loads(result["stdout"]); report["maximumRssKiB"] = 96*1024+1
            return {**result, "stdout": json.dumps(report)}
        with self.prepared() as (namespace, source), patch("index_registry_startup._run_fixed_process", side_effect=over_peak):
            with self.assertRaisesRegex(RuntimeError, "peak RSS exceeds"):
                self.run_startup(namespace, source)
            self.assertTrue((namespace/"reservations.sqlite").is_file())

    def test_actual_namespace_with_eighty_charged_roots_is_not_limited_to_experiment_file_count(self):
        with self.prepared() as (namespace, source):
            self.run_startup(namespace, source)
            saved = resource.getrlimit(resource.RLIMIT_FSIZE)
            soft = min([4*MIB]+[x for x in saved if x != resource.RLIM_INFINITY])
            resource.setrlimit(resource.RLIMIT_FSIZE, (soft, saved[1]))
            try:
                with open_index_namespace(namespace, 64*MIB) as opened:
                    for ordinal in range(80):
                        value = decode_index_binding(binding())
                        value["engineLimits"]["databaseBytes"] = 65536
                        value["processLimits"]["fileBytes"] = 65536
                        value["reservedBytes"] = 65536
                        value["toolingManifest"]["sha256"] = f"{ordinal:064x}"
                        raw = encode_index_binding(value); key = hashlib.sha256(raw).hexdigest()
                        opened.registry.reserve(key, raw, 65536)
                        child = namespace/key; child.mkdir(mode=0o700)
                        with index_writer_lease(child): pass
            finally:
                resource.setrlimit(resource.RLIMIT_FSIZE, saved)
            result = self.run_startup(namespace, source)
            self.assertEqual(result["registry"]["stats"]["reservations"], 80)
            self.assertEqual(result["registry"]["stats"]["heldBytes"], 80*65536)
            self.assertEqual(len(result["guard"]["scratchFilesBeforeRecovery"]), 3)


if __name__ == "__main__": unittest.main()
