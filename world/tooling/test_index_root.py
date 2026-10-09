"""Prepared serial admission fixtures; own disposable namespace databases only."""
from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import resource
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from index_binding import VERSIONS, encode_index_binding
from index_reservations import IndexReservations, DATABASE_BYTES, MIB
from index_root import charged_index_root
from index_writer_lock import index_writer_lease, IndexWriterBusy


def binding(tag="a"):
    return encode_index_binding({**VERSIONS,
        "source": {"provider": "overture", "release": "2026-01-21.0", "layers": ["buildings", "roads"],
                   "configuration": {"sha256": "a"*64, "bytes": 1297}},
        "toolingManifest": {"sha256": tag*64, "bytes": 2000},
        "runtime": {"nodeVersion": "v22.19.0", "sqliteVersion": "3.50.4",
                    "nodeSha256": "d"*64, "nodeBytes": 160*MIB},
        "engineLimits": {"databaseBytes": 4*MIB, "captures": 8, "occurrences": 4000,
                         "versions": 3000, "observations": 16},
        "processLimits": {"fileBytes": 4*MIB, "cpuSeconds": 10, "wallSeconds": 15,
                          "heapMiB": 256, "rssBytes": 384*MIB}, "reservedBytes": 32*MIB})


@contextmanager
def fixture():
    saved = resource.getrlimit(resource.RLIMIT_FSIZE)
    soft = min([DATABASE_BYTES]+[x for x in saved if x != resource.RLIM_INFINITY])
    resource.setrlimit(resource.RLIMIT_FSIZE, (soft, saved[1]))
    try:
        with tempfile.TemporaryDirectory(prefix="allworld-index-root-fixture-") as temporary:
            parent = Path(temporary).resolve(strict=True)
            root = parent/"namespace"; root.mkdir(mode=0o700)
            descriptor = os.open(root/"reservations.sqlite", os.O_RDWR|os.O_CREAT|os.O_EXCL, 0o600)
            os.close(descriptor)
            db = sqlite3.connect(root/"reservations.sqlite", isolation_level=None)
            try:
                with index_writer_lease(root) as lease:
                    registry = IndexReservations(db, 64*MIB)
                    yield parent, lease, registry
            finally:
                db.close()
    finally:
        resource.setrlimit(resource.RLIMIT_FSIZE, saved)


class IndexRootTests(unittest.TestCase):
    def test_charge_precedes_private_root_and_exact_replay_retains_one_inode(self):
        with fixture() as (_, namespace, registry):
            raw = binding(); key = hashlib.sha256(raw).hexdigest()
            with charged_index_root(namespace, registry, raw) as admitted:
                self.assertEqual(registry.snapshot()["heldBytes"], 32*MIB)
                self.assertEqual(admitted.lease.root, namespace.root/key)
                self.assertEqual(sorted(p.name for p in admitted.lease.root.iterdir()), ["writer.lock"])
                self.assertFalse(admitted.replayed_reservation)
                inode = admitted.lease.inode
            with charged_index_root(namespace, registry, raw) as admitted:
                self.assertTrue(admitted.replayed_reservation)
                self.assertEqual(admitted.lease.inode, inode)
            self.assertEqual(registry.snapshot()["reservations"], 1)

    def test_budget_overflow_stops_before_new_directory_allocation(self):
        with fixture() as (_, namespace, registry):
            with charged_index_root(namespace, registry, binding()): pass
            raw = binding("b"); key = hashlib.sha256(raw).hexdigest()
            with self.assertRaisesRegex(ValueError, "namespace budget"):
                with charged_index_root(namespace, registry, raw): pass
            self.assertFalse((namespace.root/key).exists())
            self.assertEqual(registry.snapshot()["reservations"], 1)

    def test_directory_creation_failure_retains_charge_and_can_replay(self):
        with fixture() as (_, namespace, registry):
            raw = binding(); key = hashlib.sha256(raw).hexdigest()
            with patch("index_root.os.mkdir", side_effect=OSError("injected allocation failure")):
                with self.assertRaisesRegex(OSError, "allocation failure"):
                    with charged_index_root(namespace, registry, raw): pass
            self.assertEqual(registry.snapshot()["reservations"], 1)
            self.assertFalse((namespace.root/key).exists())
            with charged_index_root(namespace, registry, raw) as admitted:
                self.assertTrue(admitted.replayed_reservation)
            self.assertEqual(registry.snapshot()["heldBytes"], 32*MIB)

    def test_unrelated_data_without_binding_is_preserved_before_lock_creation(self):
        for name in ["saves.sqlite", "features.sqlite"]:
            with fixture() as (_, namespace, registry):
                raw = binding(); key = hashlib.sha256(raw).hexdigest()
                registry.reserve(key, raw, 32*MIB)
                root = namespace.root/key; root.mkdir(mode=0o700)
                file = root/name; file.write_bytes(b"preserved unrelated bytes"); file.chmod(0o600)
                with self.assertRaises(ValueError):
                    with charged_index_root(namespace, registry, raw): pass
                self.assertEqual(file.read_bytes(), b"preserved unrelated bytes")
                self.assertFalse((root/"writer.lock").exists())
                self.assertEqual(registry.snapshot()["heldBytes"], 32*MIB)

    def test_symlink_root_and_unreserved_directory_are_preserved(self):
        for bad in ["symlink", "unreserved"]:
            with fixture() as (parent, namespace, registry):
                raw = binding(); key = hashlib.sha256(raw).hexdigest()
                if bad == "symlink":
                    registry.reserve(key, raw, 32*MIB)
                    target = parent/"target"; target.mkdir(mode=0o700)
                    (namespace.root/key).symlink_to(target, target_is_directory=True)
                else: (namespace.root/key).mkdir(mode=0o700)
                before = registry.snapshot()
                with self.assertRaisesRegex(ValueError, "unreserved namespace"):
                    with charged_index_root(namespace, registry, raw): pass
                self.assertEqual(registry.snapshot(), before)
                self.assertTrue((namespace.root/key).exists())

    def test_changed_binding_is_not_repaired_or_adopted(self):
        with fixture() as (_, namespace, registry):
            raw = binding(); key = hashlib.sha256(raw).hexdigest()
            registry.reserve(key, raw, 32*MIB)
            root = namespace.root/key; root.mkdir(mode=0o700)
            file = root/"binding.json"; file.write_bytes(b"changed"); file.chmod(0o600)
            with self.assertRaisesRegex(ValueError, "binding"):
                with charged_index_root(namespace, registry, raw): pass
            self.assertEqual(file.read_bytes(), b"changed")
            self.assertFalse((root/"writer.lock").exists())

    def test_missing_kernel_file_cap_refuses_before_charge_or_creation(self):
        with fixture() as (_, namespace, registry):
            raw = binding(); key = hashlib.sha256(raw).hexdigest()
            with patch("index_root.resource.getrlimit", return_value=(resource.RLIM_INFINITY, resource.RLIM_INFINITY)):
                with self.assertRaisesRegex(RuntimeError, "already enforced"):
                    with charged_index_root(namespace, registry, raw): pass
            self.assertEqual(registry.snapshot()["reservations"], 0)
            self.assertFalse((namespace.root/key).exists())

    def test_unknown_namespace_file_is_preserved_without_charging(self):
        with fixture() as (_, namespace, registry):
            file = namespace.root/"foreign.sqlite"; file.write_bytes(b"preserved"); file.chmod(0o600)
            with self.assertRaisesRegex(ValueError, "unknown"):
                with charged_index_root(namespace, registry, binding()): pass
            self.assertEqual(file.read_bytes(), b"preserved")
            self.assertEqual(registry.snapshot()["reservations"], 0)

    def test_live_index_lease_blocks_another_allocation_before_its_charge(self):
        with fixture() as (_, namespace, registry):
            with charged_index_root(namespace, registry, binding()) as live:
                raw = binding("b"); key = hashlib.sha256(raw).hexdigest()
                with self.assertRaises(IndexWriterBusy):
                    with charged_index_root(namespace, registry, raw): pass
                self.assertEqual(registry.snapshot()["reservations"], 1)
                self.assertFalse((namespace.root/key).exists())
                self.assertEqual(os.fstat(live.lease.descriptor).st_ino, live.lease.inode)

    def test_record_amount_must_match_its_binding_before_any_new_charge(self):
        with fixture() as (_, namespace, registry):
            raw = binding(); key = hashlib.sha256(raw).hexdigest()
            registry.reserve(key, raw, MIB)  # Opaque primitive alone permits this declaration.
            before = registry.snapshot()
            with self.assertRaisesRegex(ValueError, "immutable charged allowance"):
                with charged_index_root(namespace, registry, raw): pass
            self.assertEqual(registry.snapshot(), before)
            self.assertFalse((namespace.root/key).exists())

    def test_existing_root_footprint_overflow_stops_next_admission(self):
        with fixture() as (_, namespace, registry):
            raw = binding(); key = hashlib.sha256(raw).hexdigest()
            registry.reserve(key, raw, 32*MIB)
            root = namespace.root/key; root.mkdir(mode=0o700)
            file = root/"binding.json"; file.write_bytes(raw); file.chmod(0o600)
            audit = root/"audit.json"; audit.write_bytes(b"x"*(2*MIB)); audit.chmod(0o600)
            other = binding("b"); other_key = hashlib.sha256(other).hexdigest()
            with self.assertRaisesRegex(ValueError, "byte bound"):
                with charged_index_root(namespace, registry, other): pass
            self.assertEqual(registry.snapshot()["reservations"], 1)
            self.assertFalse((namespace.root/other_key).exists())
            self.assertEqual(audit.stat().st_size, 2*MIB)


if __name__ == "__main__":
    unittest.main()
