"""Prepared file-only inventory fixtures; no actual SQLite/input/ledger access."""
from dataclasses import replace
from pathlib import Path
import tempfile
import unittest

from index_storage_footprint import audit_execution_footprint, index_storage_footprint
from index_writer_lock import index_writer_lease


def put(root, name, body):
    file = root / name
    file.write_bytes(body); file.chmod(0o600)
    return file


class IndexStorageFootprintTests(unittest.TestCase):
    def test_audit_copy_and_private_wal_are_charged_inside_original_reservation(self):
        with tempfile.TemporaryDirectory(prefix="allworld-audit-footprint-fixture-") as temporary:
            root = Path(temporary).resolve(strict=True)
            with index_writer_lease(root) as lease:
                put(root, "features.sqlite", b"retained fixture")
                slot = root/"audit.execution"; slot.mkdir(mode=0o700)
                put(slot, "features.sqlite", b"owned snapshot fixture")
                put(slot, "features.sqlite-wal", b"")
                put(slot, "features.sqlite-shm", b"private generated sidecar")
                snapshot = audit_execution_footprint(root, file_bytes=65536, aggregate_bytes=1024*1024)
                report = index_storage_footprint(lease, file_bytes=65536, aggregate_bytes=1024*1024)
                self.assertEqual(report["files"]["auditExecution"]["allocatedBytes"], snapshot["chargedBytes"])
                self.assertEqual(snapshot["logicalBytes"],
                                 len(b"owned snapshot fixture") + len(b"private generated sidecar"))
                self.assertEqual((root/"features.sqlite").read_bytes(), b"retained fixture")

    def test_unknown_linked_or_oversized_audit_survivors_are_preserved(self):
        for damage in ("unknown", "symlink", "hardlink", "overflow"):
            with self.subTest(damage=damage), tempfile.TemporaryDirectory(
                    prefix="allworld-audit-footprint-fixture-") as temporary:
                root = Path(temporary).resolve(strict=True)
                target = put(root, "fixture", b"outside preserved")
                slot = root/"audit.reclaim"; slot.mkdir(mode=0o700)
                file = slot/("unknown" if damage == "unknown" else "features.sqlite")
                if damage == "symlink": file.symlink_to(target)
                elif damage == "hardlink": file.hardlink_to(target)
                else: put(slot, file.name, b"x"*(65537 if damage == "overflow" else 1))
                with self.assertRaises((OSError, ValueError)):
                    audit_execution_footprint(root, file_bytes=65536, aggregate_bytes=1024*1024)
                self.assertTrue(file.exists())
                self.assertEqual(target.read_bytes(), b"outside preserved")

    def test_durable_audit_result_witness_has_its_own_small_charge_and_limit(self):
        with tempfile.TemporaryDirectory(prefix="allworld-audit-result-footprint-") as temporary:
            root = Path(temporary).resolve(strict=True)
            with index_writer_lease(root) as lease:
                put(root, "features.sqlite", b"retained fixture")
                witness = put(root, "audit.result.json", b"x"*8192)
                report = index_storage_footprint(lease, file_bytes=65536, aggregate_bytes=1024*1024)
                self.assertEqual(report["files"]["audit.result.json"]["logicalBytes"], 8192)
                witness.write_bytes(b"x"*8193)
                with self.assertRaisesRegex(ValueError, "byte bound"):
                    index_storage_footprint(lease, file_bytes=65536, aggregate_bytes=1024*1024)
                self.assertEqual(witness.stat().st_size, 8193)

    def test_fixed_files_report_logical_and_real_allocated_bytes(self):
        with tempfile.TemporaryDirectory(prefix="allworld-index-footprint-fixture-") as temporary:
            root = Path(temporary).resolve(strict=True)
            with index_writer_lease(root) as lease:
                db = put(root, "features.sqlite", b"synthetic bytes, not a database")
                wal = put(root, "features.sqlite-wal", b"synthetic WAL bytes, not a journal")
                report = index_storage_footprint(lease, file_bytes=65536, aggregate_bytes=1024*1024)
                self.assertEqual(report["logicalBytes"], db.stat().st_size + wal.stat().st_size)
                self.assertEqual(report["files"]["features.sqlite-wal"]["allocatedBytes"], wal.stat().st_blocks*512)
                self.assertGreaterEqual(report["chargedBytes"], report["logicalBytes"])
                self.assertTrue(db.exists() and wal.exists())

    def test_missing_or_empty_sidecars_are_inventory_states_not_fake_rows(self):
        with tempfile.TemporaryDirectory(prefix="allworld-index-footprint-fixture-") as temporary:
            root = Path(temporary).resolve(strict=True)
            with index_writer_lease(root) as lease:
                put(root, "features.sqlite", b"fixture")
                first = index_storage_footprint(lease, file_bytes=65536, aggregate_bytes=1024*1024)
                self.assertNotIn("features.sqlite-wal", first["files"])
                put(root, "features.sqlite-wal", b"")
                second = index_storage_footprint(lease, file_bytes=65536, aggregate_bytes=1024*1024)
                self.assertEqual(second["files"]["features.sqlite-wal"]["logicalBytes"], 0)

    def test_orphan_sidecars_are_rejected_and_preserved(self):
        for base in ["features.sqlite", "bootstrap.sqlite"]:
            for ending in ["-wal", "-shm", "-journal"]:
                with tempfile.TemporaryDirectory(prefix="allworld-index-footprint-fixture-") as temporary:
                    root = Path(temporary).resolve(strict=True)
                    with index_writer_lease(root) as lease:
                        sidecar = put(root, base+ending, b"preserve unclassified fixture")
                        with self.assertRaisesRegex(ValueError, "orphan"):
                            index_storage_footprint(lease, file_bytes=65536, aggregate_bytes=1024*1024)
                        self.assertEqual(sidecar.read_bytes(), b"preserve unclassified fixture")

    def test_unknown_state_is_not_deleted_or_silently_excluded(self):
        with tempfile.TemporaryDirectory(prefix="allworld-index-footprint-fixture-") as temporary:
            root = Path(temporary).resolve(strict=True)
            with index_writer_lease(root) as lease:
                unknown = put(root, "unexpected.bin", b"preserved")
                with self.assertRaisesRegex(ValueError, "unknown index state"):
                    index_storage_footprint(lease, file_bytes=65536, aggregate_bytes=1024*1024)
                self.assertEqual(unknown.read_bytes(), b"preserved")

    def test_symlinks_and_hardlinks_are_refused_without_changing_targets(self):
        for linked in ["symlink", "hardlink"]:
            with tempfile.TemporaryDirectory(prefix="allworld-index-footprint-fixture-") as temporary:
                owned = Path(temporary).resolve(strict=True)
                root = owned / "store"; root.mkdir(mode=0o700)
                outside = owned / "target"
                outside.write_bytes(b"preserved target"); outside.chmod(0o600)
                with index_writer_lease(root) as lease:
                    if linked == "symlink": (root / "features.sqlite").symlink_to(outside)
                    else: (root / "features.sqlite").hardlink_to(outside)
                    with self.assertRaises((OSError, ValueError)):
                        index_storage_footprint(lease, file_bytes=65536, aggregate_bytes=1024*1024)
                    self.assertEqual(outside.read_bytes(), b"preserved target")

    def test_per_file_metadata_and_aggregate_overflow_preserve_every_file(self):
        for name, body, total in [("features.sqlite", b"x"*65537, 1024*1024),
                                  ("binding.json", b"x"*4097, 1024*1024),
                                  ("features.sqlite", b"x"*65536, 65536)]:
            with tempfile.TemporaryDirectory(prefix="allworld-index-footprint-fixture-") as temporary:
                root = Path(temporary).resolve(strict=True)
                with index_writer_lease(root) as lease:
                    file = put(root, name, body)
                    if total == 65536: put(root, "features.sqlite-wal", b"additional WAL fixture")
                    with self.assertRaisesRegex(ValueError, "bound"):
                        index_storage_footprint(lease, file_bytes=65536, aggregate_bytes=total)
                    self.assertEqual(file.read_bytes(), body)

    def test_nonprivate_file_and_wrong_lease_inode_are_refused(self):
        with tempfile.TemporaryDirectory(prefix="allworld-index-footprint-fixture-") as temporary:
            root = Path(temporary).resolve(strict=True)
            with index_writer_lease(root) as lease:
                file = put(root, "features.sqlite", b"fixture"); file.chmod(0o644)
                with self.assertRaisesRegex(ValueError, "nonprivate"):
                    index_storage_footprint(lease, file_bytes=65536, aggregate_bytes=1024*1024)
                with self.assertRaisesRegex(ValueError, "inode"):
                    index_storage_footprint(replace(lease, inode=lease.inode+1), file_bytes=65536, aggregate_bytes=1024*1024)

    def test_lease_and_all_bounds_are_mandatory(self):
        with self.assertRaises(TypeError):
            index_storage_footprint(None, file_bytes=65536, aggregate_bytes=1024*1024)
        with tempfile.TemporaryDirectory(prefix="allworld-index-footprint-fixture-") as temporary:
            root = Path(temporary).resolve(strict=True)
            with index_writer_lease(root) as lease:
                for file, aggregate in [(True, 1024*1024), (65535, 1024*1024),
                                        (64*1024*1024+1, 1024*1024), (65536, 512*1024*1024+1)]:
                    with self.subTest(bounds=(file,aggregate)), self.assertRaises(ValueError):
                        index_storage_footprint(lease, file_bytes=file, aggregate_bytes=aggregate)


if __name__ == "__main__":
    unittest.main()
