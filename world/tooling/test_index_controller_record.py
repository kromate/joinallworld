"""Pure bounded tests for the durable registry-controller record state machine."""
import copy
import json
import unittest

from index_controller_record import (
    FORMAT, FORMAT_V2, FORMAT_V3, MAX_AGGREGATE_BYTES, MIN_AGGREGATE_BYTES, MAX_INT, MAX_ATTEMPTS, MIB,
    decode_controller_record,
    encode_controller_record, finish_attempt, snapshot_ready, start_attempt,
    worker_started,
)

SHA = "a" * 64
RESULT = "b" * 64
ADMISSION_SHA = "c" * 64


def record(*, attempts=2):
    return {
        "format": "feature-index-controller-v1",
        "namespace": {"device": 1, "inode": 2, "lockDevice": 1,
                       "lockInode": 3, "aggregateBytes": MIN_AGGREGATE_BYTES},
        "runtime": {"pythonVersion": "3.12.4", "sqliteVersion": "3.46.1",
                    "pythonBytes": 123456, "pythonSha256": SHA},
        "toolingManifest": {"bytes": 321, "sha256": SHA},
        "sourceConfiguration": {"bytes": 123, "sha256": RESULT},
        "limits": {"cpuSeconds": 10, "wallSeconds": 15,
                   "rssBytes": 96*MIB, "attempts": attempts},
        "attempts": [],
    }


def record_v2(*, attempts=2):
    value = record(attempts=attempts)
    value["format"] = FORMAT_V2
    return value


def record_v3(*, attempts=2):
    value = record(attempts=attempts)
    value["format"] = FORMAT_V3
    value["operation"] = {"kind": "admit-plan",
        "plan": {"sha256": "d"*64, "bytes": 2097152},
        "baseBinding": {"sha256": "e"*64, "bytes": 4096}}
    return value


def progressed(*, phase="running"):
    value = start_attempt(record())
    value = snapshot_ready(value, 1, 99)
    if phase == "running":
        value = worker_started(value, 1234)
    return value


class IndexControllerRecordTests(unittest.TestCase):
    def test_canonical_round_trip_and_exact_newline(self):
        value = record()
        raw = encode_controller_record(value)
        self.assertTrue(raw.endswith(b"\n"))
        self.assertLessEqual(len(raw), 64000)
        self.assertEqual(encode_controller_record(decode_controller_record(raw)), raw)
        self.assertEqual(decode_controller_record(raw), value)

    def test_v1_canonical_bytes_remain_exact(self):
        expected = (
            b'{"attempts":[],"format":"feature-index-controller-v1",'
            b'"limits":{"attempts":2,"cpuSeconds":10,"rssBytes":100663296,"wallSeconds":15},'
            b'"namespace":{"aggregateBytes":17891328,"device":1,"inode":2,"lockDevice":1,"lockInode":3},'
            b'"runtime":{"pythonBytes":123456,"pythonSha256":"' + SHA.encode("ascii") +
            b'","pythonVersion":"3.12.4","sqliteVersion":"3.46.1"},'
            b'"sourceConfiguration":{"bytes":123,"sha256":"' + RESULT.encode("ascii") +
            b'"},"toolingManifest":{"bytes":321,"sha256":"' + SHA.encode("ascii") + b'"}}\n'
        )
        self.assertEqual(encode_controller_record(record()), expected)
        self.assertEqual(encode_controller_record(decode_controller_record(expected)), expected)

    def test_decoder_rejects_duplicate_noncanonical_and_nonfinite_json(self):
        for raw in [
            b'{"format":"feature-index-controller-v1","format":"feature-index-controller-v1"}\n',
            encode_controller_record(record())[:-1] + b" \n",
            b'{"value":NaN}\n',
            b"\xff\n",
        ]:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                decode_controller_record(raw)

    def test_running_attempt_lifecycle_is_defensive_and_preserves_header(self):
        original = record()
        started = start_attempt(original)
        self.assertEqual(original["attempts"], [])
        self.assertEqual(started["attempts"][0]["phase"], "prepared")
        prepared = snapshot_ready(started, 5, 6)
        self.assertIsNone(started["attempts"][0]["snapshotDevice"])
        running = worker_started(prepared, 4321)
        terminal = finish_attempt(running, RESULT)
        self.assertEqual(terminal["attempts"][0]["phase"], "terminal")
        self.assertEqual(terminal["attempts"][0]["workerPid"], 4321)
        self.assertEqual(terminal["attempts"][0]["resultSha256"], RESULT)
        for stage in (started, prepared, running, terminal):
            for key in ("namespace", "runtime", "toolingManifest", "sourceConfiguration", "limits"):
                self.assertEqual(stage[key], original[key])
        self.assertEqual(original["attempts"], [])

    def test_prepared_failure_can_finish_only_after_snapshot_identity(self):
        prepared = start_attempt(record())
        with self.assertRaises(ValueError):
            finish_attempt(prepared, RESULT)
        ready = snapshot_ready(prepared, 0, 8)
        terminal = finish_attempt(ready, RESULT)
        self.assertEqual(terminal["attempts"][0]["workerPid"], None)
        self.assertEqual(terminal["attempts"][0]["phase"], "terminal")

    def test_attempts_are_contiguous_terminal_before_retry_and_never_refunded(self):
        first = finish_attempt(snapshot_ready(start_attempt(record()), 4, 8), RESULT)
        second = start_attempt(first)
        self.assertEqual([item["number"] for item in second["attempts"]], [1, 2])
        self.assertEqual(first["limits"]["attempts"], 2)
        with self.assertRaises(ValueError):
            start_attempt(second)
        with self.assertRaises(ValueError):
            start_attempt(record(attempts=1) | {"attempts": [first["attempts"][0], second["attempts"][1]]})
        with self.assertRaises(ValueError):
            start_attempt(record(attempts=1) | {"attempts": [first["attempts"][0]]})

    def test_transitions_refuse_reuse_and_missing_or_changed_snapshot(self):
        prepared = start_attempt(record())
        with self.assertRaises(ValueError):
            worker_started(prepared, 123)
        ready = snapshot_ready(prepared, 2, 3)
        with self.assertRaises(ValueError):
            snapshot_ready(ready, 2, 4)
        running = worker_started(ready, 123)
        with self.assertRaises(ValueError):
            worker_started(running, 124)
        with self.assertRaises(ValueError):
            snapshot_ready(running, 2, 3)
        terminal = finish_attempt(running, RESULT)
        with self.assertRaises(ValueError):
            finish_attempt(terminal, RESULT)

    def test_strict_integer_pins_versions_namespace_and_limits(self):
        invalid_values = []
        for field, bad in [
            ("aggregateBytes", True), ("aggregateBytes", MIN_AGGREGATE_BYTES - 1),
            ("aggregateBytes", MAX_AGGREGATE_BYTES + 1), ("device", True),
            ("inode", 0), ("lockDevice", MAX_INT + 1),
        ]:
            value = record(); key = "aggregateBytes" if field == "aggregateBytes" else field
            target = value["namespace"]
            target[key] = bad
            invalid_values.append(value)
        value = record(); value["runtime"]["pythonBytes"] = True; invalid_values.append(value)
        value = record(); value["runtime"]["pythonSha256"] = SHA.upper(); invalid_values.append(value)
        value = record(); value["runtime"]["pythonVersion"] = "3.1234.1"; invalid_values.append(value)
        value = record(); value["toolingManifest"]["bytes"] = 64001; invalid_values.append(value)
        value = record(); value["limits"]["rssBytes"] = 64*MIB - 1; invalid_values.append(value)
        value = record(); value["limits"]["attempts"] = 17; invalid_values.append(value)
        for value in invalid_values:
            with self.subTest(value=value), self.assertRaises(ValueError):
                encode_controller_record(value)

    def test_attempt_field_state_constraints_and_boolean_rejection(self):
        good = progressed()
        invalid = []
        value = copy.deepcopy(good); value["attempts"][0]["workerPid"] = True; invalid.append(value)
        value = copy.deepcopy(good); value["attempts"][0]["snapshotDevice"] = None; invalid.append(value)
        value = copy.deepcopy(good); value["attempts"][0]["resultSha256"] = RESULT; invalid.append(value)
        value = copy.deepcopy(good); value["attempts"][0]["phase"] = "terminal"; invalid.append(value)
        value = copy.deepcopy(good); value["attempts"][0]["number"] = 2; invalid.append(value)
        value = copy.deepcopy(good); value["attempts"][0]["extra"] = 1; invalid.append(value)
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                encode_controller_record(value)

    def test_v2_startup_lifecycle_preserves_operation(self):
        original = record_v2()
        started = start_attempt(original)
        operation = {"kind": "startup", "binding": None}
        self.assertEqual(started["attempts"][0]["operation"], operation)
        prepared = snapshot_ready(started, 10, 20)
        running = worker_started(prepared, 444)
        terminal = finish_attempt(running, RESULT)
        self.assertEqual(terminal["attempts"][0]["operation"], operation)
        self.assertEqual(decode_controller_record(encode_controller_record(terminal)), terminal)
        self.assertEqual(terminal["format"], FORMAT_V2)
        self.assertEqual(original["attempts"], [])

    def test_v2_admission_operation_is_pinned_copied_and_preserved(self):
        operation = {"kind": "admit", "binding": {"sha256": ADMISSION_SHA, "bytes": 4096}}
        started = start_attempt(record_v2(), operation=operation)
        operation["binding"]["sha256"] = RESULT
        operation["binding"]["bytes"] = 1
        expected = {"kind": "admit", "binding": {"sha256": ADMISSION_SHA, "bytes": 4096}}
        self.assertEqual(started["attempts"][0]["operation"], expected)
        ready = snapshot_ready(started, 9, 11)
        terminal = finish_attempt(ready, RESULT)
        self.assertEqual(terminal["attempts"][0]["operation"], expected)

    def test_v2_operation_schema_and_admission_pin_are_strict(self):
        invalid_operations = [
            {"kind": "other", "binding": None},
            {"kind": "startup", "binding": {}},
            {"kind": "startup", "binding": None, "extra": 1},
            {"kind": "admit", "binding": {"sha256": ADMISSION_SHA}},
            {"kind": "admit", "binding": {"sha256": ADMISSION_SHA, "bytes": True}},
            {"kind": "admit", "binding": {"sha256": ADMISSION_SHA, "bytes": 0}},
            {"kind": "admit", "binding": {"sha256": ADMISSION_SHA, "bytes": 4097}},
            {"kind": "admit", "binding": {"sha256": ADMISSION_SHA.upper(), "bytes": 4}},
            {"kind": "admit", "binding": {"sha256": ADMISSION_SHA, "bytes": 4, "extra": 1}},
            {"kind": True, "binding": None},
        ]
        for operation in invalid_operations:
            with self.subTest(operation=operation), self.assertRaises(ValueError):
                start_attempt(record_v2(), operation=operation)
        plan_operation = record_v3()["operation"]
        with self.assertRaises(ValueError):
            start_attempt(record_v2(), operation=plan_operation)

        malformed_attempts = []
        value = start_attempt(record_v2()); del value["attempts"][0]["operation"]
        malformed_attempts.append(value)
        value = start_attempt(record_v2()); value["attempts"][0]["operation"]["extra"] = 1
        malformed_attempts.append(value)
        for value in malformed_attempts:
            with self.subTest(value=value), self.assertRaises(ValueError):
                encode_controller_record(value)

    def test_v1_has_no_implicit_migration_or_operation_extension(self):
        value = record()
        raw = encode_controller_record(value)
        self.assertEqual(decode_controller_record(raw)["format"], FORMAT)
        self.assertEqual(encode_controller_record(decode_controller_record(raw)), raw)
        with self.assertRaises(ValueError):
            start_attempt(value, operation={"kind": "startup", "binding": None})
        malformed = start_attempt(value)
        malformed["attempts"][0]["operation"] = {"kind": "startup", "binding": None}
        with self.assertRaises(ValueError):
            encode_controller_record(malformed)

        v2_without_operation = start_attempt(record_v2())
        del v2_without_operation["attempts"][0]["operation"]
        with self.assertRaises(ValueError):
            encode_controller_record(v2_without_operation)

    def test_v3_plan_operation_is_immutable_across_two_attempts_and_roundtrips(self):
        original = record_v3()
        operation = copy.deepcopy(original["operation"])
        first = start_attempt(original)
        first = finish_attempt(snapshot_ready(first, 7, 8), RESULT)
        second = start_attempt(first)
        second = worker_started(snapshot_ready(second, 9, 10), 4321)
        terminal = finish_attempt(second, RESULT)
        self.assertEqual(terminal["operation"], operation)
        self.assertEqual([attempt["operation"] for attempt in terminal["attempts"]], [operation, operation])
        raw = encode_controller_record(terminal)
        decoded = decode_controller_record(raw)
        self.assertEqual(decoded, terminal)
        self.assertEqual(encode_controller_record(decoded), raw)

    def test_v3_changed_plan_or_base_is_refused_before_and_after_terminal(self):
        original = record_v3()
        changed_plan = copy.deepcopy(original["operation"])
        changed_plan["plan"]["sha256"] = "f"*64
        with self.assertRaisesRegex(ValueError, "immutable controller header"):
            start_attempt(original, operation=changed_plan)
        self.assertEqual(original["attempts"], [])
        current = finish_attempt(snapshot_ready(start_attempt(original), 1, 2), RESULT)
        changed_base = copy.deepcopy(original["operation"])
        changed_base["baseBinding"]["bytes"] -= 1
        with self.assertRaisesRegex(ValueError, "immutable controller header"):
            start_attempt(current, operation=changed_base)
        forged = copy.deepcopy(current)
        forged["attempts"][0]["operation"]["baseBinding"]["sha256"] = "f"*64
        with self.assertRaisesRegex(ValueError, "immutable controller operation"):
            encode_controller_record(forged)
        forged = copy.deepcopy(current)
        forged["operation"]["plan"]["sha256"] = "f"*64
        with self.assertRaisesRegex(ValueError, "immutable controller operation"):
            encode_controller_record(forged)

    def test_v3_operation_schema_copy_and_lifetime_attempt_limit_are_strict(self):
        invalid = []
        for field, value in [("kind", "admit"), ("plan", {"sha256": "d"*64, "bytes": True}),
                             ("plan", {"sha256": "d"*64, "bytes": 2097153}),
                             ("baseBinding", {"sha256": "e"*64, "bytes": 4097}),
                             ("baseBinding", {"sha256": "E"*64, "bytes": 4})]:
            value_record = record_v3(); value_record["operation"][field] = value; invalid.append(value_record)
        value = record_v3(); value["operation"]["unknown"] = 1; invalid.append(value)
        value = record_v3(); del value["operation"]["plan"]; invalid.append(value)
        value = record_v3(); value["operation"]["plan"]["extra"] = 1; invalid.append(value)
        value = record_v3(); value["operation"]["baseBinding"]["bytes"] = 0; invalid.append(value)
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                encode_controller_record(value)

        source = record_v3(attempts=MAX_ATTEMPTS)
        operation = copy.deepcopy(source["operation"])
        started = start_attempt(source)
        source["operation"]["baseBinding"]["bytes"] = 1
        self.assertEqual(started["operation"], operation)
        self.assertEqual(started["attempts"][0]["operation"], operation)
        current = started
        for number in range(MAX_ATTEMPTS):
            if current["attempts"][-1]["phase"] == "prepared":
                current = finish_attempt(snapshot_ready(current, number, number+1), RESULT)
            if len(current["attempts"]) < MAX_ATTEMPTS:
                current = start_attempt(current)
        with self.assertRaisesRegex(ValueError, "budget is exhausted"):
            start_attempt(current)
        with self.assertRaises(ValueError):
            decode_controller_record(b"x"*64001)


if __name__ == "__main__":
    unittest.main()
