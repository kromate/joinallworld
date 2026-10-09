"""Actual fixed Node bootstrap in disposable charged roots; no real output writes."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from index_binding import decode_index_binding, encode_index_binding
from index_binding_publish import publish_index_binding
from index_bootstrap import bootstrap_index
from index_resource_limits import _run_fixed_process
from index_root import charged_index_root
from index_tooling import FILES, FORMAT, encode_tooling_manifest
from test_index_root import fixture, binding


def pin(raw):
    return {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}


@contextmanager
def source_fixture():
    actual = Path(__file__).resolve().parent.parent.parent
    with tempfile.TemporaryDirectory(prefix="allworld-bootstrap-source-fixture-") as temporary:
        root = Path(temporary).resolve(strict=True); pins = {}
        for name in FILES:
            source = actual/name
            with source.open("rb") as file: raw = file.read(1024*1024+1)
            if len(raw) > 1024*1024: raise ValueError("fixture source over cap")
            target = root/name; target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            target.write_bytes(raw); target.chmod(0o600); pins[name] = pin(raw)
        config = (actual/"world/acquisition-sources.json").read_bytes()
        target = root/"world/acquisition-sources.json"; target.write_bytes(config); target.chmod(0o600)
        manifest = encode_tooling_manifest({"format": FORMAT, "files": pins})
        yield root, manifest, config


class IndexBootstrapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.node = Path(os.environ.get("WORLD_TEST_NODE", "/usr/local/bin/node")).resolve(strict=True)
        digest = hashlib.sha256(); size = 0
        with cls.node.open("rb") as file:
            while chunk := file.read(65536): digest.update(chunk); size += len(chunk)
        cls.runtime = {"nodeVersion": "v22.19.0", "sqliteVersion": "3.50.4",
                       "nodeSha256": digest.hexdigest(), "nodeBytes": size}

    def bound(self, manifest, config, **changes):
        value = decode_index_binding(binding())
        value["runtime"] = dict(self.runtime)
        value["toolingManifest"] = pin(manifest)
        value["source"]["configuration"] = pin(config)
        value["source"]["release"] = json.loads(config)["release"]
        value["processLimits"]["heapMiB"] = 128
        value["processLimits"]["rssBytes"] = 256*1024*1024
        value.update(changes)
        return encode_index_binding(value)

    def test_actual_engine_atomic_start_and_replay_preserve_one_charge_and_inode(self):
        with source_fixture() as (source, manifest, config), fixture() as (_, namespace, registry):
            raw = self.bound(manifest, config)
            with charged_index_root(namespace, registry, raw) as admitted:
                first = bootstrap_index(admitted, source, manifest, config, self.node)
                final = admitted.lease.root/"features.sqlite"; inode = final.stat().st_ino
                self.assertFalse(first["bootstrap"]["replayed"])
                self.assertEqual(set(first["bootstrap"]["stats"].values()), {0})
                self.assertTrue(first["guard"]["inheritedLease"])
                self.assertFalse((final.parent/"bootstrap.sqlite").exists())
                self.assertFalse((final.parent/"features.sqlite-wal").exists())
                second = bootstrap_index(admitted, source, manifest, config, self.node)
                self.assertTrue(second["bootstrap"]["replayed"])
                self.assertEqual(final.stat().st_ino, inode)
                self.assertEqual(second["bootstrap"]["stats"], first["bootstrap"]["stats"])
            self.assertEqual(registry.snapshot()["reservations"], 1)

    def test_empty_interrupted_stage_initializes_and_publishes_same_inode(self):
        with source_fixture() as (source, manifest, config), fixture() as (_, namespace, registry):
            with charged_index_root(namespace, registry, self.bound(manifest, config)) as admitted:
                publish_index_binding(admitted)
                staged = admitted.lease.root/"bootstrap.sqlite"; staged.touch(mode=0o600)
                inode = staged.stat().st_ino
                report = bootstrap_index(admitted, source, manifest, config, self.node)
                self.assertFalse(report["bootstrap"]["replayed"])
                self.assertEqual((staged.parent/"features.sqlite").stat().st_ino, inode)

    def test_original_source_mutation_after_snapshot_cannot_change_executed_worker(self):
        with source_fixture() as (source, manifest, config), fixture() as (_, namespace, registry):
            with charged_index_root(namespace, registry, self.bound(manifest, config)) as admitted:
                snapshot = []

                def run_frozen(*args, **kwargs):
                    snapshot.append(kwargs["execution_root"])
                    (source/"world/tooling/index_bootstrap.ts").write_bytes(b"throw Error('changed mutable fixture');")
                    return _run_fixed_process(*args, **kwargs)

                with patch("index_bootstrap._run_fixed_process", side_effect=run_frozen):
                    result = bootstrap_index(admitted, source, manifest, config, self.node)
                self.assertEqual(result["guard"]["returnCode"], 0)
                self.assertFalse(snapshot[0].exists())

    def test_wrong_binary_pin_refuses_before_binding_or_database_creation(self):
        with source_fixture() as (source, manifest, config), fixture() as (_, namespace, registry):
            runtime = {**self.runtime, "nodeSha256": "0"*64}
            with charged_index_root(namespace, registry, self.bound(manifest, config, runtime=runtime)) as admitted:
                with patch("index_bootstrap._run_fixed_process") as launch:
                    with self.assertRaisesRegex(ValueError, "runtime pin"):
                        bootstrap_index(admitted, source, manifest, config, self.node)
                    launch.assert_not_called()
                self.assertEqual(sorted(p.name for p in admitted.lease.root.iterdir()), ["writer.lock"])

    def test_runtime_version_mismatch_fails_before_sql_and_preserves_binding(self):
        with source_fixture() as (source, manifest, config), fixture() as (_, namespace, registry):
            runtime = {**self.runtime, "nodeVersion": "v22.19.9"}
            raw = self.bound(manifest, config, runtime=runtime)
            with charged_index_root(namespace, registry, raw) as admitted:
                with self.assertRaisesRegex(RuntimeError, "bootstrap worker failed"):
                    bootstrap_index(admitted, source, manifest, config, self.node)
                self.assertEqual((admitted.lease.root/"binding.json").read_bytes(), raw)
                self.assertFalse((admitted.lease.root/"bootstrap.sqlite").exists())
                self.assertFalse((admitted.lease.root/"features.sqlite").exists())

    def test_foreign_database_is_preserved_without_schema_or_journal_change(self):
        with source_fixture() as (source, manifest, config), fixture() as (_, namespace, registry):
            with charged_index_root(namespace, registry, self.bound(manifest, config)) as admitted:
                publish_index_binding(admitted)
                final = admitted.lease.root/"features.sqlite"
                db = sqlite3.connect(final)
                db.execute("CREATE TABLE saves(id TEXT)"); db.execute("INSERT INTO saves VALUES('preserved')")
                db.commit(); db.close(); final.chmod(0o600)
                before = final.read_bytes()
                with self.assertRaisesRegex(RuntimeError, "bootstrap worker failed"):
                    bootstrap_index(admitted, source, manifest, config, self.node)
                self.assertEqual(final.read_bytes(), before)
                self.assertFalse((final.parent/"bootstrap.sqlite").exists())

    def test_mixed_final_and_staging_are_preserved_without_opening_sql(self):
        with source_fixture() as (source, manifest, config), fixture() as (_, namespace, registry):
            with charged_index_root(namespace, registry, self.bound(manifest, config)) as admitted:
                publish_index_binding(admitted)
                files = [admitted.lease.root/name for name in ["features.sqlite", "bootstrap.sqlite"]]
                for file in files: file.write_bytes(b"preserved fixture bytes"); file.chmod(0o600)
                with self.assertRaisesRegex(RuntimeError, "bootstrap worker failed"):
                    bootstrap_index(admitted, source, manifest, config, self.node)
                self.assertEqual([file.read_bytes() for file in files], [b"preserved fixture bytes"]*2)

    def test_uninitialized_nonempty_final_is_refused_instead_of_initialized_in_place(self):
        with source_fixture() as (source, manifest, config), fixture() as (_, namespace, registry):
            with charged_index_root(namespace, registry, self.bound(manifest, config)) as admitted:
                publish_index_binding(admitted)
                final = admitted.lease.root/"features.sqlite"
                db = sqlite3.connect(final)
                db.execute("CREATE TABLE temporary_fixture(id TEXT)")
                db.execute("DROP TABLE temporary_fixture"); db.commit(); db.close(); final.chmod(0o600)
                before = final.read_bytes(); self.assertGreater(len(before), 0)
                with self.assertRaisesRegex(RuntimeError, "bootstrap worker failed"):
                    bootstrap_index(admitted, source, manifest, config, self.node)
                self.assertEqual(final.read_bytes(), before)
                self.assertFalse((final.parent/"bootstrap.sqlite").exists())

    def test_actual_sigkill_at_four_startup_boundaries_recovers_same_sqlite_inode_and_charge(self):
        for boundary in ["empty-file", "schema-checkpointed", "before-rename", "after-rename"]:
            with self.subTest(boundary=boundary), source_fixture() as (source, manifest, config), fixture() as (_, namespace, registry):
                raw = self.bound(manifest, config)
                with charged_index_root(namespace, registry, raw) as admitted:
                    witness = []

                    def crash_worker(node, worker, root, **kwargs):
                        self.assertEqual(worker, "index-engine-bootstrap")
                        result = _run_fixed_process(node, "index-bootstrap-crash", root, case=boundary, **kwargs)
                        witness.append(result)
                        return result

                    with patch("index_bootstrap._run_fixed_process", side_effect=crash_worker):
                        with self.assertRaisesRegex(RuntimeError, "bootstrap worker failed"):
                            bootstrap_index(admitted, source, manifest, config, self.node)
                    self.assertEqual(witness[0]["returnCode"], -9)
                    self.assertEqual(witness[0]["terminationSignal"], "SIGKILL")
                    file = admitted.lease.root/("features.sqlite" if boundary == "after-rename" else "bootstrap.sqlite")
                    inode = file.stat().st_ino
                with charged_index_root(namespace, registry, raw) as admitted:
                    report = bootstrap_index(admitted, source, manifest, config, self.node)
                    self.assertEqual(report["bootstrap"]["replayed"], boundary == "after-rename")
                    self.assertEqual((admitted.lease.root/"features.sqlite").stat().st_ino, inode)
                    self.assertEqual(set(report["bootstrap"]["stats"].values()), {0})
                self.assertEqual(registry.snapshot()["reservations"], 1)


if __name__ == "__main__":
    unittest.main()
