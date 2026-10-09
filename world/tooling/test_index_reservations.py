"""Prepared serial reservation-engine fixtures; own disposable databases only."""
from contextlib import contextmanager
import hashlib
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from index_reservations import IndexReservations, REGISTRY_ALLOWANCE, MAX_RESERVATIONS, MIB


def binding(value):
    # Opaque synthetic bytes only, not an admitted production index binding.
    raw = value.encode("ascii")
    return hashlib.sha256(raw).hexdigest(), raw


@contextmanager
def fixture():
    with tempfile.TemporaryDirectory(prefix="allworld-index-reservation-fixture-") as temporary:
        file = Path(temporary).resolve(strict=True) / "registry.sqlite"
        db = sqlite3.connect(file, isolation_level=None)
        try:
            yield db, file
        finally:
            db.close()


class IndexReservationTests(unittest.TestCase):
    def test_foreign_database_is_refused_without_changing_settings_or_data(self):
        with fixture() as (db, _):
            db.executescript("CREATE TABLE saves(id TEXT); INSERT INTO saves VALUES('preserved');")
            mode = db.execute("PRAGMA journal_mode").fetchone()
            with self.assertRaisesRegex(ValueError, "recognized"):
                IndexReservations(db, 64*MIB)
            self.assertEqual(db.execute("PRAGMA journal_mode").fetchone(), mode)
            self.assertEqual(db.execute("SELECT id FROM saves").fetchone(), ("preserved",))

    def test_empty_database_with_foreign_version_is_preserved(self):
        with fixture() as (db, _):
            db.execute("PRAGMA user_version=47")
            mode = db.execute("PRAGMA journal_mode").fetchone()
            with self.assertRaisesRegex(ValueError, "recognized"):
                IndexReservations(db, 64*MIB)
            self.assertEqual(db.execute("PRAGMA user_version").fetchone(), (47,))
            self.assertEqual(db.execute("PRAGMA journal_mode").fetchone(), mode)
            self.assertEqual(db.execute("SELECT count(*) FROM sqlite_schema").fetchone(), (0,))

    def test_empty_registry_applies_actual_durability_and_charges_its_overhead(self):
        with fixture() as (db, _):
            registry = IndexReservations(db, 64*MIB)
            self.assertEqual(db.execute("PRAGMA journal_mode").fetchone(), ("wal",))
            self.assertEqual(db.execute("PRAGMA synchronous").fetchone(), (2,))
            self.assertEqual(db.execute("PRAGMA max_page_count").fetchone(), (1024,))
            self.assertEqual(registry.snapshot(), {"reservations": 0, "heldBytes": 0,
                "registryAllowanceBytes": REGISTRY_ALLOWANCE, "chargedBytes": REGISTRY_ALLOWANCE,
                "aggregateLimitBytes": 64*MIB})
            with self.assertRaises(AttributeError):
                registry.aggregate_bytes = 128*MIB

    def test_exact_replay_and_new_connection_reopen_never_charge_twice(self):
        with fixture() as (db, file):
            registry = IndexReservations(db, 64*MIB)
            key, raw = binding("fixture binding")
            self.assertFalse(registry.reserve(key, raw, 8*MIB)["replayed"])
            before = registry.snapshot()
            self.assertTrue(registry.reserve(key, raw, 8*MIB)["replayed"])
            self.assertEqual(registry.snapshot(), before)
            reopened = sqlite3.connect(file, isolation_level=None)
            try:
                recovered = IndexReservations(reopened, 64*MIB)
                self.assertTrue(recovered.reserve(key, raw, 8*MIB)["replayed"])
                self.assertEqual(recovered.snapshot(), before)
            finally:
                reopened.close()

    def test_existing_namespace_budget_cannot_be_reinterpreted_as_a_larger_budget(self):
        with fixture() as (db, file):
            registry = IndexReservations(db, 32*MIB)
            key, raw = binding("fixed budget"); registry.reserve(key, raw, MIB)
            before = registry.snapshot()
            other = sqlite3.connect(file, isolation_level=None)
            try:
                with self.assertRaisesRegex(ValueError, "no quota reset"):
                    IndexReservations(other, 64*MIB)
            finally:
                other.close()
            self.assertEqual(registry.snapshot(), before)

    def test_existing_reservation_cannot_be_refunded_or_resized(self):
        with fixture() as (db, _):
            registry = IndexReservations(db, 64*MIB)
            key, raw = binding("held allowance"); registry.reserve(key, raw, 8*MIB)
            before = registry.snapshot()
            with self.assertRaisesRegex(ValueError, "resizing/refunds"):
                registry.reserve(key, raw, 4*MIB)
            self.assertEqual(registry.snapshot(), before)
            with self.assertRaisesRegex(RuntimeError, "must reopen"):
                registry.reserve(key, raw, 8*MIB)

    def test_namespace_overflow_rolls_back_new_charge_and_retains_previous_allowance(self):
        with fixture() as (db, _):
            registry = IndexReservations(db, REGISTRY_ALLOWANCE+8*MIB)
            key, raw = binding("first"); registry.reserve(key, raw, 8*MIB)
            before = registry.snapshot(); key, raw = binding("second")
            with self.assertRaisesRegex(ValueError, "namespace budget"):
                registry.reserve(key, raw, 65536)
            self.assertEqual(registry.snapshot(), before)
            self.assertEqual(db.execute("SELECT count(*) FROM reservations").fetchone(), (1,))

    def test_changed_binding_or_lowered_amount_without_its_stamp_is_rejected(self):
        for damaged in ["binding", "amount"]:
            with fixture() as (db, _):
                registry = IndexReservations(db, 64*MIB)
                key, raw = binding("corruption"); registry.reserve(key, raw, 8*MIB)
                if damaged == "binding": db.execute("UPDATE reservations SET binding=?", (b"changed",))
                else: db.execute("UPDATE reservations SET reserved_bytes=?", (4*MIB,))
                with self.assertRaisesRegex(ValueError, "contradictory"):
                    registry.snapshot()
                with self.assertRaisesRegex(ValueError, "contradictory"):
                    IndexReservations(db, 64*MIB)

    def test_mutated_metadata_or_unexpected_view_blocks_further_charges(self):
        for damaged in ["metadata", "view"]:
            with fixture() as (db, _):
                registry = IndexReservations(db, 64*MIB)
                if damaged == "metadata": db.execute("UPDATE meta SET value='changed' WHERE key='format'")
                else: db.execute("CREATE VIEW unexpected AS SELECT 1")
                key, raw = binding("new")
                with self.assertRaises(ValueError):
                    registry.reserve(key, raw, MIB)
                self.assertEqual(db.execute("SELECT count(*) FROM reservations").fetchone(), (0,))

    def test_deleted_reservation_never_becomes_available_capacity(self):
        with fixture() as (db, file):
            registry = IndexReservations(db, 64*MIB)
            key, raw = binding("permanent charge"); registry.reserve(key, raw, 8*MIB)
            db.execute("DELETE FROM reservations WHERE hash=?", (key,))
            with self.assertRaisesRegex(ValueError, "charge ledger differs"):
                registry.snapshot()
            next_key, next_raw = binding("new charge")
            with self.assertRaisesRegex(ValueError, "charge ledger differs"):
                registry.reserve(next_key, next_raw, MIB)
            reopened = sqlite3.connect(file, isolation_level=None)
            try:
                with self.assertRaisesRegex(ValueError, "charge ledger differs"):
                    IndexReservations(reopened, 64*MIB)
            finally:
                reopened.close()
            self.assertEqual(db.execute("SELECT value FROM meta WHERE key='held_bytes'").fetchone(), (str(8*MIB),))

    def test_damaged_charge_summary_is_not_rebuilt_from_remaining_rows(self):
        for key, value in [("held_bytes", "0"), ("reservation_count", "0"),
                           ("records_digest", "0"*64)]:
            with fixture() as (db, _):
                registry = IndexReservations(db, 64*MIB)
                index_hash, raw = binding("summary"); registry.reserve(index_hash, raw, MIB)
                db.execute("UPDATE meta SET value=? WHERE key=?", (value, key))
                with self.assertRaisesRegex(ValueError, "charge ledger differs"):
                    registry.snapshot()
                with self.assertRaisesRegex(ValueError, "charge ledger differs"):
                    IndexReservations(db, 64*MIB)
                self.assertEqual(db.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone(), (value,))

    def test_pre_transaction_checkpoint_failure_poisons_writer_without_new_charge(self):
        with fixture() as (db, _):
            registry = IndexReservations(db, 64*MIB)
            key, raw = binding("checkpoint failure")
            with patch.object(registry, "_checkpoint", side_effect=OSError("injected checkpoint I/O error")):
                with self.assertRaisesRegex(OSError, "checkpoint I/O error"):
                    registry.reserve(key, raw, MIB)
            self.assertEqual(registry.snapshot()["reservations"], 0)
            with self.assertRaisesRegex(RuntimeError, "must reopen"):
                registry.reserve(key, raw, MIB)

    def test_external_transaction_is_refused_without_rollback_or_commit(self):
        with fixture() as (db, _):
            registry = IndexReservations(db, 64*MIB)
            key, raw = binding("external transaction")
            db.execute("BEGIN IMMEDIATE")
            try:
                with self.assertRaisesRegex(RuntimeError, "caller transaction is preserved"):
                    registry.reserve(key, raw, MIB)
                self.assertTrue(db.in_transaction)
                self.assertEqual(db.execute("SELECT count(*) FROM reservations").fetchone(), (0,))
            finally:
                db.execute("ROLLBACK")
            self.assertFalse(registry.reserve(key, raw, MIB)["replayed"])

    def test_partial_charge_summary_failure_rolls_back_row_and_metadata_together(self):
        with fixture() as (db, _):
            registry = IndexReservations(db, 64*MIB)
            key, raw = binding("existing charge"); registry.reserve(key, raw, MIB)
            before = registry.snapshot()
            key, raw = binding("charge interrupted before commit")

            def interrupted_summary():
                # Explicit fault after one metadata write, before COMMIT.
                db.execute("UPDATE meta SET value=? WHERE key='held_bytes'", (str(2*MIB),))
                raise sqlite3.OperationalError("injected summary write failure")

            with patch.object(registry, "_write_totals", side_effect=interrupted_summary):
                with self.assertRaisesRegex(sqlite3.OperationalError, "summary write failure"):
                    registry.reserve(key, raw, MIB)
            self.assertFalse(db.in_transaction)
            self.assertEqual(registry.snapshot(), before)
            self.assertEqual(db.execute("SELECT count(*) FROM reservations WHERE hash=?", (key,)).fetchone(), (0,))
            with self.assertRaisesRegex(RuntimeError, "must reopen"):
                registry.reserve(key, raw, MIB)

    def test_invalid_binding_and_allowance_fail_before_writes(self):
        with fixture() as (db, _):
            registry = IndexReservations(db, 64*MIB)
            key, raw = binding("valid")
            for args in [(key, bytearray(raw), MIB), (key, b"different", MIB),
                         ("bad", raw, MIB), (key, raw, True), (key, raw, 65535),
                         (hashlib.sha256(b"x"*4097).hexdigest(), b"x"*4097, MIB)]:
                with self.subTest(args=args), self.assertRaises(ValueError):
                    registry.reserve(*args)
            self.assertEqual(registry.snapshot()["reservations"], 0)

    def test_row_limit_stops_expansion_without_dropping_held_entries(self):
        with fixture() as (db, _):
            registry = IndexReservations(db, 64*MIB)
            for i in range(MAX_RESERVATIONS):
                key, raw = binding(str(i)); registry.reserve(key, raw, 65536)
            before = registry.snapshot(); key, raw = binding("over row cap")
            with self.assertRaisesRegex(ValueError, "reservation rows"):
                registry.reserve(key, raw, 65536)
            self.assertEqual(registry.snapshot(), before)

    def test_post_commit_checkpoint_failure_keeps_charge_and_replay_requires_reopen(self):
        with fixture() as (db, file):
            registry = IndexReservations(db, 64*MIB)
            key, raw = binding("baseline"); registry.reserve(key, raw, MIB)
            reader = sqlite3.connect(file, isolation_level=None)
            key, raw = binding("committed while checkpoint blocked")
            try:
                reader.execute("BEGIN"); reader.execute("SELECT count(*) FROM reservations").fetchone()
                with self.assertRaisesRegex(RuntimeError, "checkpoint incomplete"):
                    registry.reserve(key, raw, MIB)
                self.assertEqual(registry.snapshot()["reservations"], 2)
                with self.assertRaisesRegex(RuntimeError, "must reopen"):
                    registry.reserve(key, raw, MIB)
            finally:
                reader.execute("ROLLBACK"); reader.close()
            recovered_db = sqlite3.connect(file, isolation_level=None)
            try:
                recovered = IndexReservations(recovered_db, 64*MIB)
                self.assertTrue(recovered.reserve(key, raw, MIB)["replayed"])
                self.assertEqual(recovered.snapshot()["heldBytes"], 2*MIB)
            finally:
                recovered_db.close()


if __name__ == "__main__":
    unittest.main()
