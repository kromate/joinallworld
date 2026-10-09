"""Disposable namespace opener fixtures; never touch user or production databases."""
import hashlib
import os
from pathlib import Path
import resource
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from index_namespace import (
    MAX_AGGREGATE_BYTES, MIN_AGGREGATE_BYTES, namespace_binding,
    open_index_namespace, open_index_shard_namespace,
)
from index_binding import decode_index_binding
from index_reservations import DATABASE_BYTES, MIB
from index_root import (charged_index_root, prepare_index_shard_plan_authority,
                        planned_index_reservations, precharged_index_shard_root)
from index_binding_publish import publish_index_shard_binding
from index_writer_lock import index_writer_lease, IndexWriterBusy
from test_index_root import binding
from test_index_registry_worker import planner_fixture


class IndexNamespaceTests(unittest.TestCase):
    def setUp(self):
        self.saved_fsize = resource.getrlimit(resource.RLIMIT_FSIZE)
        soft = min([DATABASE_BYTES] + [v for v in self.saved_fsize if v != resource.RLIM_INFINITY])
        resource.setrlimit(resource.RLIMIT_FSIZE, (soft, self.saved_fsize[1]))
        self.temp = tempfile.TemporaryDirectory(prefix="allworld-index-namespace-")
        self.parent = Path(self.temp.name).resolve(strict=True)
        self.root = self.parent / "namespace"
        self.root.mkdir(mode=0o700)
        os.chmod(self.root, 0o700)

    def tearDown(self):
        self.temp.cleanup()
        resource.setrlimit(resource.RLIMIT_FSIZE, self.saved_fsize)

    def _shard_authority(self, *, aggregate=128*MIB, max_captures=1):
        raw, pin, base, _ = planner_fixture(policy_changes={
            "aggregateBytes": aggregate, "maxCaptures": max_captures,
        })
        return prepare_index_shard_plan_authority(raw, pin, base), base

    @staticmethod
    def _reservation_rows(entries):
        return [{"indexHash": key, "bindingBytes": raw, "reservedBytes": amount}
                for key, raw, amount in entries]

    def test_initialization_and_exact_reopen_keep_metadata_database_inode_and_budget(self):
        budget = 64 * MIB
        raw = namespace_binding(budget)
        held = binding()
        with open_index_namespace(self.root, budget) as opened:
            database = self.root / "reservations.sqlite"
            inode = database.stat().st_ino
            self.assertFalse(opened.replayed)
            self.assertEqual(opened.binding_bytes, raw)
            self.assertEqual((self.root / "namespace.json").read_bytes(), raw)
            self.assertEqual(opened.registry.aggregate_bytes, budget)
            opened.registry.reserve(hashlib.sha256(held).hexdigest(), held, 32 * MIB)
        with open_index_namespace(self.root, budget) as opened:
            self.assertTrue(opened.replayed)
            self.assertEqual((self.root / "reservations.sqlite").stat().st_ino, inode)
            self.assertEqual(opened.registry.aggregate_bytes, budget)
            self.assertEqual(opened.registry.snapshot()["chargedBytes"], 17 * MIB + 32 * MIB)

    def test_empty_final_registry_reopens_without_initializing_or_changing_budget(self):
        budget = 64 * MIB
        with open_index_namespace(self.root, budget) as opened:
            self.assertEqual(opened.registry.snapshot()["reservations"], 0)
            inode = (self.root / "reservations.sqlite").stat().st_ino
        with open_index_namespace(self.root, budget) as opened:
            self.assertTrue(opened.replayed)
            self.assertEqual(opened.registry.snapshot()["reservations"], 0)
            self.assertEqual(opened.registry.aggregate_bytes, budget)
            self.assertEqual((self.root / "reservations.sqlite").stat().st_ino, inode)

    def test_actual_empty_bootstrap_file_resumes_and_retains_inode(self):
        (self.root/"namespace.json").write_bytes(namespace_binding(64*MIB))
        (self.root/"namespace.json").chmod(0o600)
        staged = self.root/"reservations.bootstrap.sqlite"; staged.touch(mode=0o600)
        inode = staged.stat().st_ino
        with open_index_namespace(self.root, 64*MIB) as opened:
            self.assertEqual(opened.registry.snapshot()["reservations"], 0)
            self.assertEqual((self.root/"reservations.sqlite").stat().st_ino, inode)

    def test_foreign_empty_user_version_is_preserved_before_lock(self):
        metadata = self.root/"namespace.json"; metadata.write_bytes(namespace_binding(64*MIB)); metadata.chmod(0o600)
        staged = self.root/"reservations.bootstrap.sqlite"
        db = sqlite3.connect(staged); db.execute("PRAGMA user_version=99"); db.close(); staged.chmod(0o600)
        before = staged.read_bytes()
        with self.assertRaisesRegex(ValueError, "foreign"):
            with open_index_namespace(self.root, 64*MIB): pass
        self.assertEqual(staged.read_bytes(), before)
        self.assertFalse((self.root/"writer.lock").exists())

    def test_corrupt_empty_bootstrap_is_preserved_before_rw_initialization(self):
        metadata = self.root/"namespace.json"; metadata.write_bytes(namespace_binding(64*MIB)); metadata.chmod(0o600)
        staged = self.root/"reservations.bootstrap.sqlite"
        db = sqlite3.connect(staged)
        db.execute("CREATE TABLE disposable(id TEXT)"); db.execute("DROP TABLE disposable"); db.commit(); db.close()
        raw = bytearray(staged.read_bytes())
        self.assertEqual(int.from_bytes(raw[68:72], "big"), 0)
        raw[32:36] = (len(raw)//4096+10).to_bytes(4, "big")  # Invalid freelist trunk, no user schema.
        staged.write_bytes(raw); staged.chmod(0o600)
        before = staged.read_bytes()
        with patch("index_namespace._open_connection") as rw:
            with self.assertRaises((ValueError, sqlite3.DatabaseError)):
                with open_index_namespace(self.root, 64*MIB): pass
            rw.assert_not_called()
        self.assertEqual(staged.read_bytes(), before)
        self.assertFalse((self.root/"reservations.sqlite").exists())

    def test_orphan_registry_sidecars_are_preserved_before_lock(self):
        metadata = self.root/"namespace.json"; metadata.write_bytes(namespace_binding(64*MIB)); metadata.chmod(0o600)
        for base in ["reservations.sqlite", "reservations.bootstrap.sqlite"]:
            for ending in ["-wal", "-shm", "-journal"]:
                sidecar = self.root/(base+ending); sidecar.write_bytes(b"orphan"); sidecar.chmod(0o600)
                try:
                    with self.subTest(name=sidecar.name), self.assertRaisesRegex(ValueError, "orphan"):
                        with open_index_namespace(self.root, 64*MIB): pass
                    self.assertEqual(sidecar.read_bytes(), b"orphan")
                    self.assertFalse((self.root/"writer.lock").exists())
                finally: sidecar.unlink()

    def test_empty_stage_with_sidecars_is_preserved_before_sqlite_open(self):
        metadata = self.root/"namespace.json"; metadata.write_bytes(namespace_binding(64*MIB)); metadata.chmod(0o600)
        staged = self.root/"reservations.bootstrap.sqlite"; staged.touch(mode=0o600)
        for ending in ["-wal", "-shm", "-journal"]:
            sidecar = self.root/(staged.name+ending); sidecar.write_bytes(b"preserved"); sidecar.chmod(0o600)
            try:
                with self.subTest(ending=ending), patch("index_namespace.sqlite3.connect") as connect:
                    with self.assertRaisesRegex(ValueError, "empty namespace"):
                        with open_index_namespace(self.root, 64*MIB): pass
                    connect.assert_not_called()
                    self.assertEqual(sidecar.read_bytes(), b"preserved")
                    self.assertEqual(staged.stat().st_size, 0)
            finally: sidecar.unlink()

    def test_actual_abrupt_namespace_worker_exit_resumes_exact_state(self):
        # Fixed fixture-only worker; actual abrupt exits, not controller/power-loss certification.
        worker = r'''
import os, resource, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import index_namespace as module
resource.setrlimit(resource.RLIMIT_CPU, (5, 5))
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
root = Path(sys.argv[2]); boundary = sys.argv[3]
if boundary == "metadata-prefix":
    native_write = os.write
    def write(fd, raw):
        native_write(fd, raw[:17]); os._exit(77)
    module.os.write = write
elif boundary in {"metadata-before-rename", "metadata-after-rename", "registry-before-rename", "registry-after-rename"}:
    native_rename = os.rename
    def rename(source, destination, *args, **kwargs):
        expected = "namespace.pending" if boundary.startswith("metadata") else "reservations.bootstrap.sqlite"
        if Path(source).name == expected:
            if "after" in boundary: native_rename(source, destination, *args, **kwargs)
            os._exit(78)
        return native_rename(source, destination, *args, **kwargs)
    module.os.rename = rename
elif boundary == "registry-empty":
    native_open = module._open_connection
    def connect(root, name):
        if name == "reservations.bootstrap.sqlite": os._exit(79)
        return native_open(root, name)
    module._open_connection = connect
elif boundary == "registry-schema-checkpointed":
    module._strict_registry = lambda db: os._exit(80)
else: raise ValueError("unknown fixed fixture boundary")
with module.open_index_namespace(root, 64*1024*1024): pass
raise RuntimeError("fixture failed to exit at its boundary")
'''
        for boundary in ["metadata-prefix", "metadata-before-rename", "metadata-after-rename",
                         "registry-empty", "registry-schema-checkpointed", "registry-before-rename", "registry-after-rename"]:
            root = self.parent/boundary; root.mkdir(mode=0o700)
            with self.subTest(boundary=boundary):
                completed = subprocess.run([sys.executable, "-I", "-c", worker,
                    str(Path(__file__).resolve().parent), str(root), boundary],
                    capture_output=True, timeout=10)
                self.assertIn(completed.returncode, [77, 78, 79, 80], completed.stderr.decode())
                original = root/("namespace.pending" if (root/"namespace.pending").exists() else "namespace.json")
                metadata_inode = original.stat().st_ino
                database = next((root/name for name in ["reservations.bootstrap.sqlite", "reservations.sqlite"] if (root/name).exists()), None)
                database_inode = database.stat().st_ino if database else None
                with open_index_namespace(root, 64*MIB) as opened:
                    self.assertEqual((root/"namespace.json").stat().st_ino, metadata_inode)
                    self.assertEqual((root/"namespace.json").read_bytes(), namespace_binding(64*MIB))
                    self.assertEqual(opened.registry.snapshot()["reservations"], 0)
                    if database_inode is not None:
                        self.assertEqual((root/"reservations.sqlite").stat().st_ino, database_inode)

    def test_sqlite_is_not_opened_before_actual_namespace_lease(self):
        with open_index_namespace(self.root, 64*MIB): pass
        from index_writer_lock import IndexWriterBusy
        with index_writer_lease(self.root), patch("index_namespace.sqlite3.connect") as connect:
            with self.assertRaises(IndexWriterBusy):
                with open_index_namespace(self.root, 64*MIB): pass
            connect.assert_not_called()

    def test_namespace_binding_has_strict_integer_bounds_and_canonical_bytes(self):
        for invalid in [True, 17 * MIB, MIN_AGGREGATE_BYTES - 1, MAX_AGGREGATE_BYTES + 1, 64.0 * MIB]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                namespace_binding(invalid)
        self.assertEqual(namespace_binding(64 * MIB), namespace_binding(64 * MIB))
        self.assertTrue(namespace_binding(64 * MIB).endswith(b"\n"))

    def test_changed_budget_or_metadata_refuses_before_creating_lock(self):
        metadata = self.root / "namespace.json"
        metadata.write_bytes(namespace_binding(64 * MIB))
        metadata.chmod(0o600)
        with self.assertRaisesRegex(ValueError, "metadata"):
            with open_index_namespace(self.root, 65 * MIB):
                pass
        self.assertFalse((self.root / "writer.lock").exists())
        original = metadata.read_bytes()
        metadata.write_bytes(b"changed")
        with self.assertRaises(ValueError):
            with open_index_namespace(self.root, 64 * MIB):
                pass
        self.assertEqual(metadata.read_bytes(), b"changed")
        self.assertFalse((self.root / "writer.lock").exists())
        metadata.write_bytes(original)

    def test_unknown_file_and_foreign_sqlite_are_preserved_before_lock(self):
        foreign = self.root / "foreign.bin"
        foreign.write_bytes(b"keep me")
        with self.assertRaisesRegex(ValueError, "unknown"):
            with open_index_namespace(self.root, 64 * MIB):
                pass
        self.assertEqual(foreign.read_bytes(), b"keep me")
        self.assertFalse((self.root / "writer.lock").exists())
        foreign.unlink()
        metadata = namespace_binding(64 * MIB)
        (self.root / "namespace.json").write_bytes(metadata)
        (self.root / "namespace.json").chmod(0o600)
        db = self.root / "reservations.sqlite"
        db.write_bytes(b"foreign SQLite bytes")
        db.chmod(0o600)
        before = db.read_bytes()
        with self.assertRaises(Exception):
            with open_index_namespace(self.root, 64 * MIB):
                pass
        self.assertEqual(db.read_bytes(), before)
        self.assertFalse((self.root / "writer.lock").exists())

    def test_valid_partial_metadata_prefixes_resume_and_empty_bootstrap_keeps_inode(self):
        budget = 64 * MIB
        expected = namespace_binding(budget)
        for size in [0, 7, len(expected) // 2, len(expected)]:
            with self.subTest(size=size):
                root = self.parent / f"namespace-prefix-{size}"
                root.mkdir(mode=0o700)
                os.chmod(root, 0o700)
                with index_writer_lease(root):
                    pending = root / "namespace.pending"
                    pending.write_bytes(expected[:size])
                    pending.chmod(0o600)
                with open_index_namespace(root, budget) as opened:
                    self.assertTrue(opened.replayed)
                    self.assertEqual((root / "namespace.json").read_bytes(), expected)
                    self.assertEqual(opened.registry.snapshot()["reservations"], 0)

        # A failed bootstrap rename leaves a valid empty registry to resume in place.
        root = self.parent / "namespace-bootstrap-resume"
        root.mkdir(mode=0o700)
        os.chmod(root, 0o700)
        with self.assertRaisesRegex(OSError, "interrupt bootstrap publication"):
            native_rename = os.rename

            def fail_bootstrap(source, destination, *args, **kwargs):
                if Path(source).name == "reservations.bootstrap.sqlite":
                    raise OSError("interrupt bootstrap publication")
                return native_rename(source, destination, *args, **kwargs)

            with patch("index_namespace.os.rename", side_effect=fail_bootstrap):
                with open_index_namespace(root, budget):
                    pass
        bootstrap = root / "reservations.bootstrap.sqlite"
        inode = bootstrap.stat().st_ino
        with open_index_namespace(root, budget) as opened:
            self.assertTrue(opened.replayed)
            self.assertFalse(bootstrap.exists())
            self.assertEqual((root / "reservations.sqlite").stat().st_ino, inode)

    def test_contradictory_metadata_prefix_is_preserved_before_lock_or_append(self):
        expected = namespace_binding(64 * MIB)
        pending = self.root / "namespace.pending"
        with index_writer_lease(self.root):
            pending.write_bytes(b"x" + expected[1:8])
            pending.chmod(0o600)
        before = pending.read_bytes()
        with self.assertRaisesRegex(ValueError, "contradictory"):
            with open_index_namespace(self.root, 64 * MIB):
                pass
        self.assertEqual(pending.read_bytes(), before)
        self.assertFalse((self.root / "namespace.json").exists())

    def test_mixed_bootstrap_and_final_registry_is_refused_and_preserved(self):
        with open_index_namespace(self.root, 64 * MIB):
            pass
        bootstrap = self.root / "reservations.bootstrap.sqlite"
        bootstrap.write_bytes(b"contradictory bootstrap")
        bootstrap.chmod(0o600)
        before = bootstrap.read_bytes()
        with self.assertRaisesRegex(ValueError, "mixed bootstrap"):
            with open_index_namespace(self.root, 64 * MIB):
                pass
        self.assertEqual(bootstrap.read_bytes(), before)

    def test_registry_reservation_replay_charges_once_and_child_root_keeps_inode(self):
        budget = 96 * MIB
        raw = binding()
        with open_index_namespace(self.root, budget) as opened:
            first = opened.registry.reserve(hashlib.sha256(raw).hexdigest(), raw, 32 * MIB)
            self.assertFalse(first["replayed"])
            with charged_index_root(opened.lease, opened.registry, raw) as admitted:
                child_inode = admitted.lease.inode
                self.assertTrue(admitted.replayed_reservation)
        with open_index_namespace(self.root, budget) as opened:
            self.assertEqual(opened.registry.snapshot()["heldBytes"], 32 * MIB)
            with charged_index_root(opened.lease, opened.registry, raw) as admitted:
                self.assertEqual(admitted.lease.inode, child_inode)
                self.assertTrue(admitted.replayed_reservation)
            replay = opened.registry.reserve(hashlib.sha256(raw).hexdigest(), raw, 32 * MIB)
            self.assertTrue(replay["replayed"])
            self.assertEqual(opened.registry.snapshot()["heldBytes"], 32 * MIB)

    def test_native_file_limit_and_invalid_root_refuse_before_lock(self):
        with patch("index_namespace.resource.getrlimit", return_value=(resource.RLIM_INFINITY, resource.RLIM_INFINITY)):
            with self.assertRaisesRegex(RuntimeError, "already enforced"):
                with open_index_namespace(self.root, 64 * MIB):
                    pass
        self.assertFalse((self.root / "writer.lock").exists())
        link = self.parent / "namespace-link"
        link.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            with open_index_namespace(link, 64 * MIB):
                pass
        self.assertFalse((self.root / "writer.lock").exists())

    def test_changed_final_registry_budget_is_preserved(self):
        with open_index_namespace(self.root, 64 * MIB):
            pass
        path = self.root / "reservations.sqlite"
        connection = sqlite3.connect(path, isolation_level=None)
        try:
            connection.execute("UPDATE meta SET value=? WHERE key='aggregate_bytes'", (str(65 * MIB),))
        finally:
            connection.close()
        with self.assertRaises(ValueError):
            with open_index_namespace(self.root, 64 * MIB):
                pass
        self.assertTrue(path.exists())

    def test_shard_namespace_atomically_charges_and_reopens_exact_v2_children(self):
        authority, _ = self._shard_authority()
        entries = planned_index_reservations(authority)
        self.assertEqual(len(entries), 2)
        published = {}
        with index_writer_lease(self.root) as inherited:
            with open_index_shard_namespace(self.root, authority, inherited_lease=inherited) as opened:
                self.assertEqual(opened.registry.snapshot()["reservations"], 0)
                receipts = opened.registry.reserve_many(self._reservation_rows(entries))
                self.assertTrue(all(not receipt["replayed"] for receipt in receipts))
                self.assertEqual(opened.registry.snapshot()["chargedBytes"],
                    17*MIB + sum(amount for _, _, amount in entries))
                for key, _, _ in entries:
                    with precharged_index_shard_root(opened.lease, opened.registry, authority, key) as child:
                        report = publish_index_shard_binding(child, authority)
                        target = child.lease.root / "binding.json"
                        self.assertFalse(report["replayed"])
                        self.assertEqual(target.read_bytes(), child.binding_bytes)
                        published[key] = (child.lease.inode, target.stat().st_ino,
                                           target.read_bytes())
            with self.assertRaises(IndexWriterBusy):
                with index_writer_lease(self.root):
                    pass
            os.fstat(inherited.descriptor)
        with open_index_shard_namespace(self.root, authority) as reopened:
            self.assertTrue(reopened.replayed)
            self.assertEqual(reopened.registry.snapshot()["reservations"], 2)
            for key, _, _ in entries:
                with precharged_index_shard_root(reopened.lease, reopened.registry, authority, key) as child:
                    report = publish_index_shard_binding(child, authority)
                    target = child.lease.root / "binding.json"
                    self.assertTrue(report["replayed"])
                    self.assertEqual((child.lease.inode, target.stat().st_ino, target.read_bytes()),
                                     published[key])

    def test_legacy_namespace_opener_still_rejects_v2_plan_rows(self):
        authority, _ = self._shard_authority()
        entries = planned_index_reservations(authority)
        with open_index_shard_namespace(self.root, authority) as opened:
            opened.registry.reserve_many(self._reservation_rows(entries))
        database = self.root / "reservations.sqlite"
        uri = "file:" + str(database) + "?mode=ro"
        connection = sqlite3.connect(uri, uri=True)
        try:
            before = connection.execute(
                "SELECT hash,binding,reserved_bytes FROM reservations ORDER BY hash").fetchall()
        finally:
            connection.close()
        with self.assertRaises(ValueError):
            with open_index_namespace(self.root, authority.aggregate_bytes):
                self.fail("legacy opener yielded a V2 registry")
        connection = sqlite3.connect(uri, uri=True)
        try:
            after = connection.execute(
                "SELECT hash,binding,reserved_bytes FROM reservations ORDER BY hash").fetchall()
        finally:
            connection.close()
        self.assertEqual(after, before)

    def test_plan_opener_preserves_partial_foreign_and_wrong_amount_rows(self):
        authority, _ = self._shard_authority()
        entries = planned_index_reservations(authority)
        self.assertEqual(len(entries), 2)
        foreign = binding("f")
        cases = {
            "partial": self._reservation_rows(entries[:1]),
            "foreign": [{"indexHash": hashlib.sha256(foreign).hexdigest(),
                         "bindingBytes": foreign, "reservedBytes": 32*MIB}],
            "wrong-amount": [{"indexHash": entries[0][0], "bindingBytes": entries[0][1],
                              "reservedBytes": entries[0][2] + 1}],
        }
        for name, rows in cases.items():
            root = self.parent / f"namespace-{name}"
            root.mkdir(mode=0o700)
            os.chmod(root, 0o700)
            with open_index_namespace(root, authority.aggregate_bytes):
                pass
            if name == "foreign":
                with open_index_namespace(root, authority.aggregate_bytes) as opened:
                    opened.registry.reserve_many(rows)
            else:
                with self.assertRaises(ValueError):
                    with open_index_namespace(root, authority.aggregate_bytes) as opened:
                        opened.registry.reserve_many(rows)
            database = root / "reservations.sqlite"
            uri = "file:" + str(database) + "?mode=ro"
            connection = sqlite3.connect(uri, uri=True)
            try:
                before = connection.execute(
                    "SELECT hash,binding,reserved_bytes FROM reservations ORDER BY hash").fetchall()
            finally:
                connection.close()
            names = set(path.name for path in root.iterdir())
            with self.subTest(case=name), self.assertRaises(ValueError):
                with open_index_shard_namespace(root, authority):
                    self.fail("partial or foreign rows reached the body")
            connection = sqlite3.connect(uri, uri=True)
            try:
                after = connection.execute(
                    "SELECT hash,binding,reserved_bytes FROM reservations ORDER BY hash").fetchall()
            finally:
                connection.close()
            self.assertEqual(after, before)
            self.assertEqual(set(path.name for path in root.iterdir()), names)

    def test_shard_opener_accepts_only_the_exact_optional_base_row(self):
        authority, base_bytes = self._shard_authority(aggregate=128*MIB)
        entries = planned_index_reservations(authority)
        base = decode_index_binding(base_bytes)
        with open_index_namespace(self.root, authority.aggregate_bytes) as opened:
            opened.registry.reserve(hashlib.sha256(base_bytes).hexdigest(), base_bytes,
                                    base["reservedBytes"])
        with open_index_shard_namespace(self.root, authority) as opened:
            self.assertEqual(opened.registry.snapshot()["reservations"], 1)
            opened.registry.reserve_many(self._reservation_rows(entries))
        self.assertEqual(len(entries), 2)

        wrong_root = self.parent / "namespace-base-wrong"
        wrong_root.mkdir(mode=0o700)
        os.chmod(wrong_root, 0o700)
        wrong_amount = base["reservedBytes"] + 1
        with self.assertRaises(ValueError):
            with open_index_namespace(wrong_root, 128*MIB) as opened:
                opened.registry.reserve_many([{
                    "indexHash": hashlib.sha256(base_bytes).hexdigest(),
                    "bindingBytes": base_bytes,
                    "reservedBytes": wrong_amount,
                }])
        wrong_database = wrong_root / "reservations.sqlite"
        wrong_uri = "file:" + str(wrong_database) + "?mode=ro"
        connection = sqlite3.connect(wrong_uri, uri=True)
        try:
            before = connection.execute(
                "SELECT hash,binding,reserved_bytes FROM reservations").fetchall()
        finally:
            connection.close()
        with self.assertRaises(ValueError):
            with open_index_shard_namespace(wrong_root, authority):
                self.fail("wrong base amount reached the body")
        connection = sqlite3.connect(wrong_uri, uri=True)
        try:
            after = connection.execute(
                "SELECT hash,binding,reserved_bytes FROM reservations").fetchall()
        finally:
            connection.close()
        self.assertEqual(after, before)

    def test_shard_namespace_aggregate_mismatch_refuses_without_rewriting_state(self):
        authority, _ = self._shard_authority(aggregate=128*MIB)
        root = self.parent / "namespace-other-budget"
        root.mkdir(mode=0o700)
        os.chmod(root, 0o700)
        with open_index_namespace(root, 129*MIB):
            pass
        metadata = (root / "namespace.json").read_bytes()
        inode = (root / "reservations.sqlite").stat().st_ino
        with self.assertRaises(ValueError):
            with open_index_shard_namespace(root, authority):
                self.fail("different aggregate reached the body")
        self.assertEqual((root / "namespace.json").read_bytes(), metadata)
        self.assertEqual((root / "reservations.sqlite").stat().st_ino, inode)

    def test_successful_empty_or_base_only_shard_context_must_not_skip_full_batch(self):
        authority, base_bytes = self._shard_authority(aggregate=128*MIB)
        base = decode_index_binding(base_bytes)
        cases = ("empty", "base-only")
        for case in cases:
            root = self.parent / f"namespace-unsettled-{case}"
            root.mkdir(mode=0o700)
            os.chmod(root, 0o700)
            if case == "base-only":
                with open_index_namespace(root, authority.aggregate_bytes) as opened:
                    opened.registry.reserve(hashlib.sha256(base_bytes).hexdigest(), base_bytes,
                                            base["reservedBytes"])
            before_metadata = root / "namespace.json"
            before_rows = []
            if before_metadata.exists():
                connection = sqlite3.connect("file:" + str(root / "reservations.sqlite") + "?mode=ro", uri=True)
                try:
                    before_rows = connection.execute(
                        "SELECT hash,binding,reserved_bytes FROM reservations ORDER BY hash").fetchall()
                finally:
                    connection.close()
                metadata_bytes = before_metadata.read_bytes()
            else:
                metadata_bytes = None
            with self.subTest(state=case), self.assertRaises(ValueError):
                with open_index_shard_namespace(root, authority):
                    pass
            self.assertEqual(before_metadata.read_bytes(),
                             metadata_bytes if metadata_bytes is not None else namespace_binding(authority.aggregate_bytes))
            connection = sqlite3.connect("file:" + str(root / "reservations.sqlite") + "?mode=ro", uri=True)
            try:
                after_rows = connection.execute(
                    "SELECT hash,binding,reserved_bytes FROM reservations ORDER BY hash").fetchall()
            finally:
                connection.close()
            self.assertEqual(after_rows, before_rows)


if __name__ == "__main__":
    unittest.main()
