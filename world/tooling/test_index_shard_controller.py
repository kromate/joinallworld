"""Actual bounded plan admission and same-plan restart in disposable namespaces."""
import json
import signal
import sqlite3
import unittest
from unittest.mock import patch

import index_registry_controller as controller
import index_registry_startup as startup
import test_index_admission as admission_fixture
from index_controller_record import FORMAT_V3, decode_controller_record
from index_controller_state import RECORD, EXECUTION, RECLAIM, REGISTRY
from index_root import prepare_index_shard_plan_authority, planned_index_reservations
from index_reservations import REGISTRY_ALLOWANCE
from test_index_registry_worker import planner_fixture

MIB = 1024 * 1024


class IndexShardControllerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        admission_fixture.IndexAdmissionTests.setUpClass.__func__(cls)

    prepared = admission_fixture.IndexAdmissionTests.prepared
    bound = admission_fixture.IndexAdmissionTests.bound

    def arguments(self, namespace, source, **changes):
        args = admission_fixture.IndexAdmissionTests.arguments(self, namespace, source,
                                                               aggregate_bytes=128*MIB)
        base = args.pop("binding_bytes")
        raw, plan_pin, _, _ = planner_fixture(base, {"aggregateBytes":128*MIB, "maxCaptures":1})
        args.update(_binding_bytes=base, _plan_input={"raw":raw, "pin":plan_pin})
        args.update(changes)
        return args

    def record(self, namespace):
        return decode_controller_record((namespace/RECORD).read_bytes())

    def charges(self, namespace):
        db = sqlite3.connect(f"file:{namespace/'reservations.sqlite'}?mode=ro", uri=True)
        try:
            return db.execute("SELECT hash,binding,reserved_bytes FROM reservations ORDER BY hash").fetchall()
        finally: db.close()

    def identities(self, namespace, args):
        authority = prepare_index_shard_plan_authority(args["_plan_input"]["raw"],
            args["_plan_input"]["pin"], args["_binding_bytes"])
        return [(key, (namespace/key).stat().st_ino, (namespace/key/"writer.lock").stat().st_ino,
                 (namespace/key/"binding.json").read_bytes())
                for key, _, _ in planned_index_reservations(authority)]

    def test_actual_batch_reopens_all_roots_without_parent_sql_or_recharging(self):
        with self.prepared() as (namespace, source):
            args = self.arguments(namespace, source)
            with patch("sqlite3.connect", side_effect=AssertionError("parent SQL forbidden")):
                first = controller.restartable_registry_startup(**args)
                before = self.identities(namespace, args)
                reopened = controller.restartable_registry_startup(**args)
                self.assertEqual(self.identities(namespace, args), before)
            self.assertEqual(first["registry"]["shardAdmission"], reopened["registry"]["shardAdmission"])
            self.assertEqual(reopened["registry"]["stats"]["reservations"], 2)
            self.assertEqual(reopened["registry"]["stats"]["chargedBytes"], REGISTRY_ALLOWANCE + 64*MIB)
            self.assertEqual(reopened["controller"]["attempts"], 2)
            self.assertEqual(self.record(namespace)["format"], FORMAT_V3)
            self.assertEqual([a["phase"] for a in self.record(namespace)["attempts"]], ["terminal","terminal"])
            self.assertEqual(len(self.charges(namespace)), 2)
            self.assertFalse((namespace/EXECUTION).exists() or (namespace/RECLAIM).exists())

    def test_actual_sigkill_at_charge_and_root_boundaries_resumes_exact_full_plan(self):
        native = startup._run_fixed_process
        for phase in ("before-charge", "charged", "root-published"):
            with self.subTest(phase=phase), self.prepared() as (namespace, source):
                args = self.arguments(namespace, source)
                observed = []
                def crash(executable, worker, root, **kwargs):
                    self.assertEqual(worker, "index-registry-admit-plan")
                    result = native(executable, "index-registry-admit-plan-crash", root,
                                    case=phase, **kwargs)
                    observed.append(result)
                    return result
                with patch("index_registry_startup._run_fixed_process", side_effect=crash), patch(
                        "sqlite3.connect", side_effect=AssertionError("parent SQL forbidden")):
                    with self.assertRaisesRegex(RuntimeError, "fixed registry worker failed"):
                        controller.restartable_registry_startup(**args)
                self.assertEqual(len(observed), 1)
                self.assertEqual(observed[0]["returnCode"], -signal.SIGKILL)
                self.assertEqual(observed[0]["reason"], "exit")
                anchor = json.loads((namespace/REGISTRY).read_bytes())
                database = (namespace/"reservations.sqlite").stat()
                self.assertEqual((anchor["databaseDevice"], anchor["databaseInode"]),
                                 (database.st_dev, database.st_ino))
                expected_count = 0 if phase == "before-charge" else 2
                original = self.charges(namespace)
                self.assertEqual(len(original), expected_count)
                existing = {key:(namespace/key).stat().st_ino for key, _, _ in original
                            if (namespace/key).exists()}
                with patch("sqlite3.connect", side_effect=AssertionError("parent SQL forbidden")):
                    resumed = controller.restartable_registry_startup(**args)
                self.assertEqual(resumed["controller"]["attempts"], 2)
                self.assertEqual(resumed["controller"]["reconciledInterruptedAttempts"], 1)
                final = self.charges(namespace)
                self.assertEqual(len(final), 2)
                if original: self.assertEqual(final, original)
                self.assertEqual({key:(namespace/key).stat().st_ino for key in existing}, existing)
                self.assertEqual(len(self.identities(namespace, args)), 2)

    def test_changed_coherent_plan_and_exhausted_attempts_preserve_original_state(self):
        with self.prepared() as (namespace, source):
            args = self.arguments(namespace, source, attempt_limit=1)
            controller.restartable_registry_startup(**args)
            record = (namespace/RECORD).read_bytes(); rows = self.charges(namespace)
            identities = self.identities(namespace, args)
            raw, plan_pin, _, _ = planner_fixture(args["_binding_bytes"],
                {"aggregateBytes":128*MIB, "maxCaptures":2})
            changed = dict(args, _plan_input={"raw":raw, "pin":plan_pin})
            for candidate, reason in ((changed, "controller binding changed"), (args, "exhausted")):
                with patch("index_registry_controller._copy_snapshot") as allocate:
                    with self.assertRaisesRegex(ValueError, reason):
                        controller.restartable_registry_startup(**candidate)
                    allocate.assert_not_called()
                self.assertEqual((namespace/RECORD).read_bytes(), record)
                self.assertEqual(self.charges(namespace), rows)
                self.assertEqual(self.identities(namespace, args), identities)


if __name__ == "__main__": unittest.main()
