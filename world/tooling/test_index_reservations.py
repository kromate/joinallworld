"""Prepared serial reservation-engine fixtures; own disposable databases only."""
from contextlib import contextmanager
import hashlib
import multiprocessing
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
import time
import unittest
from unittest.mock import patch

import index_reservations as reservations_module
from index_reservations import IndexReservations, REGISTRY_ALLOWANCE, MAX_RESERVATIONS, MIB


def binding(value):
    # Opaque synthetic bytes only, not an admitted production index binding.
    raw = value.encode("ascii")
    return hashlib.sha256(raw).hexdigest(), raw


def item(value, amount=65536):
    index_hash, raw = binding(value)
    return {"indexHash": index_hash, "bindingBytes": raw, "reservedBytes": amount}


def _crash_batch_child(database, entries, stage, ready):
    db = sqlite3.connect(database, isolation_level=None)
    registry = IndexReservations(db, 64*MIB)
    if stage == "before-commit":
        original = reservations_module._record_hash
        calls = 0

        def pause_after_one(binding_bytes, amount):
            nonlocal calls
            calls += 1
            if calls == 2:
                ready.set()
                time.sleep(20)
            return original(binding_bytes, amount)

        reservations_module._record_hash = pause_after_one
    else:
        original = registry._checkpoint
        calls = 0

        def pause_after_commit():
            nonlocal calls
            calls += 1
            if calls == 2:
                ready.set()
                time.sleep(20)
            return original()

        registry._checkpoint = pause_after_commit
    registry.reserve_many(entries)


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
    def test_batch_is_sorted_atomic_and_mixed_replay_does_not_double_charge(self):
        with fixture() as (db, _):
            registry = IndexReservations(db, 64*MIB)
            first, second, third = item("batch-z", MIB), item("batch-a", 2*MIB), item("batch-m", MIB)
            initial = registry.reserve_many([first, second])
            self.assertEqual([row["indexHash"] for row in initial], sorted([first["indexHash"], second["indexHash"]]))
            self.assertTrue(all(not row["replayed"] for row in initial))
            before = registry.snapshot()
            mixed = registry.reserve_many([third, second, first])
            self.assertEqual([row["indexHash"] for row in mixed], sorted([first["indexHash"], second["indexHash"], third["indexHash"]]))
            self.assertEqual({row["indexHash"]: row["replayed"] for row in mixed}, {
                first["indexHash"]: True, second["indexHash"]: True, third["indexHash"]: False})
            self.assertEqual(registry.snapshot()["chargedBytes"], before["chargedBytes"] + third["reservedBytes"])
            self.assertEqual(registry.reserve(first["indexHash"], first["bindingBytes"], first["reservedBytes"]),
                {"indexHash": first["indexHash"], "reservedBytes": first["reservedBytes"], "replayed": True})
            charged = registry.snapshot()
            replay = registry.reserve_many([first, third, second])
            self.assertTrue(all(row["replayed"] for row in replay))
            self.assertEqual(registry.snapshot(), charged)
            self.assertEqual([row["indexHash"] for row in replay], [row["indexHash"] for row in mixed])

    def test_batch_capacity_or_slot_exhaustion_adds_no_partial_rows(self):
        with fixture() as (db, _):
            registry = IndexReservations(db, REGISTRY_ALLOWANCE+2*MIB)
            baseline = item("batch-baseline", MIB)
            registry.reserve_many([baseline])
            before = registry.snapshot()
            with self.assertRaisesRegex(ValueError, "namespace budget"):
                registry.reserve_many([item("batch-fits-alone", 65536), item("batch-does-not-fit", MIB)])
            self.assertEqual(registry.snapshot(), before)
            self.assertEqual(db.execute("SELECT count(*) FROM reservations").fetchone(), (1,))

        with fixture() as (db, _):
            registry = IndexReservations(db, 64*MIB)
            registry.reserve_many([item(f"slot-{number}") for number in range(MAX_RESERVATIONS-1)])
            before = registry.snapshot()
            with self.assertRaisesRegex(ValueError, "reservation rows"):
                registry.reserve_many([item("last-slot-a"), item("last-slot-b")])
            self.assertEqual(registry.snapshot(), before)
            self.assertEqual(db.execute("SELECT count(*) FROM reservations").fetchone(), (MAX_RESERVATIONS-1,))

    def test_batch_mismatched_replay_refuses_all_new_entries_and_poisons_writer(self):
        with fixture() as (db, _):
            registry = IndexReservations(db, 64*MIB)
            old = item("fixed-existing", MIB)
            registry.reserve_many([old])
            before = registry.snapshot()
            changed = dict(old, reservedBytes=2*MIB)
            new = item("must-not-appear", MIB)
            with self.assertRaisesRegex(ValueError, "resizing/refunds"):
                registry.reserve_many([new, changed])
            self.assertEqual(registry.snapshot(), before)
            self.assertEqual(db.execute("SELECT count(*) FROM reservations").fetchone(), (1,))
            with self.assertRaisesRegex(RuntimeError, "must reopen"):
                registry.reserve_many([new])

    def test_batch_preflight_refuses_duplicates_bad_pins_oversize_and_external_transactions(self):
        with fixture() as (db, _):
            registry = IndexReservations(db, 64*MIB)
            good = item("preflight")
            with self.assertRaisesRegex(ValueError, "duplicate"):
                registry.reserve_many([good, good])
            too_many = [item(f"wide-{number}") for number in range(MAX_RESERVATIONS+1)]
            with self.assertRaisesRegex(ValueError, "1..256"):
                registry.reserve_many(too_many)
            with self.assertRaisesRegex(ValueError, "exact fields"):
                registry.reserve_many([dict(good, extra=True)])
            bad = dict(good, bindingBytes=bytearray(good["bindingBytes"]))
            with self.assertRaisesRegex(ValueError, "immutable binding"):
                registry.reserve_many([bad])
            bad = dict(good, reservedBytes=True)
            with self.assertRaisesRegex(ValueError, "declared reservation"):
                registry.reserve_many([bad])
            with self.assertRaisesRegex(ValueError, "finite list"):
                registry.reserve_many(iter([good]))
            db.execute("BEGIN IMMEDIATE")
            try:
                with self.assertRaisesRegex(RuntimeError, "caller transaction is preserved"):
                    registry.reserve_many([good])
                self.assertTrue(db.in_transaction)
                self.assertEqual(db.execute("SELECT count(*) FROM reservations").fetchone(), (0,))
            finally:
                db.execute("ROLLBACK")
            self.assertEqual(registry.snapshot()["reservations"], 0)

    def test_batch_midtransaction_error_rolls_back_every_insert_and_requires_reopen(self):
        with fixture() as (db, file):
            registry = IndexReservations(db, 64*MIB)
            entries = [item("interrupt-a", MIB), item("interrupt-b", MIB)]
            original = reservations_module._record_hash
            calls = 0

            def fail_second(binding_bytes, amount):
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise sqlite3.OperationalError("injected second-row failure")
                return original(binding_bytes, amount)

            with patch.object(reservations_module, "_record_hash", side_effect=fail_second):
                with self.assertRaisesRegex(sqlite3.OperationalError, "second-row failure"):
                    registry.reserve_many(entries)
            self.assertFalse(db.in_transaction)
            self.assertEqual(registry.snapshot()["reservations"], 0)
            self.assertEqual(db.execute("SELECT count(*) FROM reservations").fetchone(), (0,))
            with self.assertRaisesRegex(RuntimeError, "must reopen"):
                registry.reserve_many(entries)
            reopened = sqlite3.connect(file, isolation_level=None)
            try:
                self.assertEqual(IndexReservations(reopened, 64*MIB).snapshot()["reservations"], 0)
            finally:
                reopened.close()

    def test_batch_postcommit_checkpoint_failure_keeps_every_charge_for_exact_replay(self):
        with fixture() as (db, file):
            registry = IndexReservations(db, 64*MIB)
            entries = [item("checkpoint-a", MIB), item("checkpoint-b", MIB)]
            original = registry._checkpoint
            calls = 0

            def fail_after_commit():
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise sqlite3.OperationalError("injected postcommit checkpoint failure")
                return original()

            with patch.object(registry, "_checkpoint", side_effect=fail_after_commit):
                with self.assertRaisesRegex(sqlite3.OperationalError, "postcommit checkpoint"):
                    registry.reserve_many(entries)
            self.assertFalse(db.in_transaction)
            self.assertEqual(registry.snapshot()["heldBytes"], 2*MIB)
            with self.assertRaisesRegex(RuntimeError, "must reopen"):
                registry.reserve_many(entries)
            reopened = sqlite3.connect(file, isolation_level=None)
            try:
                resumed = IndexReservations(reopened, 64*MIB)
                before = resumed.snapshot()
                self.assertTrue(all(row["replayed"] for row in resumed.reserve_many(entries)))
                self.assertEqual(resumed.snapshot(), before)
            finally:
                reopened.close()

    @unittest.skipUnless(os.name == "posix", "SIGKILL recovery fixture requires POSIX")
    def test_batch_sigkill_before_and_after_commit_preserves_sqlite_atomicity(self):
        context = multiprocessing.get_context("fork")
        entries = [item("crash-a", MIB), item("crash-b", MIB)]
        for stage, expected in [("before-commit", 0), ("after-commit", 2)]:
            scratch = Path(tempfile.mkdtemp(prefix="allworld-reservation-crash-"))
            child = None
            confirmed_dead = False
            try:
                database = scratch / "registry.sqlite"
                bootstrap = sqlite3.connect(database, isolation_level=None)
                IndexReservations(bootstrap, 64*MIB)
                bootstrap.close()
                ready = context.Event()
                child = context.Process(target=_crash_batch_child, args=(str(database), entries, stage, ready))
                child.start()
                self.assertTrue(ready.wait(5), f"child did not reach {stage}; preserve {scratch}")
                child.kill()
                child.join(5)
                confirmed_dead = not child.is_alive() and child.exitcode is not None
                self.assertTrue(confirmed_dead, f"crash fixture child termination was not confirmed; preserve {scratch}")
                recovered_db = sqlite3.connect(database, isolation_level=None)
                try:
                    recovered = IndexReservations(recovered_db, 64*MIB)
                    self.assertEqual(recovered.snapshot()["reservations"], expected)
                    if expected:
                        self.assertEqual(recovered.snapshot()["heldBytes"], 2*MIB)
                finally:
                    recovered_db.close()
            finally:
                if child is not None and child.is_alive():
                    child.kill()
                    child.join(5)
                    confirmed_dead = not child.is_alive() and child.exitcode is not None
                if confirmed_dead or child is None:
                    shutil.rmtree(scratch)
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
