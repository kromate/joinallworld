"""Pure codec and state-transition checks for per-capture ownership records."""
import unittest

from index_capture_record import (
    FORMAT, FORMAT_V2, MAX_JOBS, MAX_RECORD_BYTES, begin_capture, capture_snapshot_ready,
    decode_capture_record, encode_capture_record, finish_capture, settled_capture_observation_pins,
)


SHA_A = "a" * 64
SHA_B = "b" * 64
SHA_C = "c" * 64


def record(*, attempts=2, jobs=2, format=FORMAT):
    return {
        "format": format,
        "index": {
            "indexHash": SHA_A,
            "rootDevice": 0,
            "rootInode": 1,
            "lockDevice": 0,
            "lockInode": 2,
        },
        "limits": {"attempts": attempts, "jobs": jobs},
        "current": None,
        "jobs": [],
    }


def capture_input():
    return {
        "expected": {"sha256": SHA_B, "bytes": 123},
        "extractPath": "/cache/extract.json",
        "receiptPath": "/cache/receipt.json",
    }


class CaptureRecordTests(unittest.TestCase):
    def test_audit_pins_deduplicate_settled_attempts_without_claiming_sql_observations(self):
        for format, observation in ((FORMAT, None), (FORMAT_V2, {"sha256": SHA_C, "bytes": 64})):
            value = record(format=format)
            for _ in range(2):
                value = begin_capture(value, SHA_B, capture_input(), observation)
                value = capture_snapshot_ready(value, SHA_B, 0, 3)
                value = finish_capture(value, SHA_B, SHA_A)
            raw = encode_capture_record(value)
            self.assertEqual(settled_capture_observation_pins(raw), {SHA_B: [] if observation is None else [observation]})
            self.assertEqual(encode_capture_record(value), raw)

    def test_audit_pins_refuse_prepared_or_noncanonical_records(self):
        value = begin_capture(record(format=FORMAT_V2), SHA_B, capture_input(), {"sha256": SHA_C, "bytes": 64})
        with self.assertRaisesRegex(ValueError, "unsettled"):
            settled_capture_observation_pins(encode_capture_record(value))
        with self.assertRaisesRegex(ValueError, "canonical"):
            settled_capture_observation_pins(encode_capture_record(record()).rstrip(b"\n"))

    def test_v1_encoding_and_default_transition_remain_exact(self):
        value = record()
        expected = (b'{"current":null,"format":"feature-index-capture-controller-v1",'
                    b'"index":{"indexHash":"' + SHA_A.encode("ascii") +
                    b'","lockDevice":0,"lockInode":2,"rootDevice":0,"rootInode":1},'
                    b'"jobs":[],"limits":{"attempts":2,"jobs":2}}\n')
        self.assertEqual(encode_capture_record(value), expected)
        self.assertEqual(decode_capture_record(expected), value)
        pending = begin_capture(value, SHA_B, capture_input())
        self.assertEqual(set(pending["jobs"][0]["attempts"][0]), {
            "number", "phase", "snapshotDevice", "snapshotInode", "resultSha256",
        })
        with self.assertRaisesRegex(ValueError, "v1 capture records"):
            begin_capture(value, SHA_B, capture_input(), {"sha256": SHA_C, "bytes": 8})

    def test_round_trip_is_canonical_ascii_with_newline(self):
        value = record()
        raw = encode_capture_record(value)
        self.assertTrue(raw.endswith(b"\n"))
        self.assertTrue(raw.isascii())
        self.assertEqual(decode_capture_record(raw), value)

    def test_decoder_rejects_duplicate_fields_noncanonical_bytes_and_nonfinite_values(self):
        canonical = encode_capture_record(record())
        with self.assertRaises(ValueError):
            decode_capture_record(canonical.replace(b'"jobs":[]', b'"jobs":[],"jobs":[]'))
        with self.assertRaises(ValueError):
            decode_capture_record(canonical.replace(b"\n", b"", 1))
        with self.assertRaises(ValueError):
            decode_capture_record(b'{"format":NaN}\n')

    def test_encoder_rejects_invalid_index_limits_jobs_and_paths(self):
        invalid_values = []
        value = record(); value["index"]["rootDevice"] = True; invalid_values.append(value)
        value = record(); value["limits"]["attempts"] = 9; invalid_values.append(value)
        value = record(); value["jobs"] = [{"requestHash": SHA_A, "input": capture_input(), "attempts": []}]; value["current"] = SHA_A; invalid_values.append(value)
        for path in ("relative/file", "/cache/../extract", "/cache//extract", "/cache/a\\b", "/cache/a\x00b", "/cache/"):
            value = record()
            item = capture_input(); item["extractPath"] = path
            value["jobs"] = [{"requestHash": SHA_A, "input": item, "attempts": [{
                "number": 1, "phase": "prepared", "snapshotDevice": None,
                "snapshotInode": None, "resultSha256": None,
            }]}]
            value["current"] = SHA_A
            invalid_values.append(value)
        for invalid in invalid_values:
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    encode_capture_record(invalid)

    def test_encoder_rejects_unsorted_duplicate_jobs_and_multiple_prepared_attempts(self):
        value = record()
        value["jobs"] = [
            {"requestHash": SHA_B, "input": capture_input(), "attempts": [{
                "number": 1, "phase": "prepared", "snapshotDevice": None,
                "snapshotInode": None, "resultSha256": None,
            }]},
            {"requestHash": SHA_A, "input": capture_input(), "attempts": [{
                "number": 1, "phase": "prepared", "snapshotDevice": None,
                "snapshotInode": None, "resultSha256": None,
            }]},
        ]
        value["current"] = SHA_B
        with self.assertRaises(ValueError):
            encode_capture_record(value)
        value["jobs"].reverse()
        value["current"] = SHA_A
        with self.assertRaises(ValueError):
            encode_capture_record(value)

    def test_begin_capture_freezes_input_and_returns_a_defensive_copy(self):
        original = record()
        supplied = capture_input()
        pending = begin_capture(original, SHA_A, supplied)
        supplied["extractPath"] = "/cache/changed.json"
        self.assertEqual(original["jobs"], [])
        self.assertEqual(pending["jobs"][0]["input"]["extractPath"], "/cache/extract.json")
        pending["index"]["rootInode"] = 99
        self.assertEqual(original["index"]["rootInode"], 1)

    def test_attempt_settlement_requires_snapshot_and_preserves_input_pins(self):
        pending = begin_capture(record(), SHA_A, capture_input())
        with self.assertRaises(ValueError):
            finish_capture(pending, SHA_A, SHA_C)
        ready = capture_snapshot_ready(pending, SHA_A, 0, 42)
        with self.assertRaises(ValueError):
            capture_snapshot_ready(ready, SHA_A, 0, 43)
        done = finish_capture(ready, SHA_A, SHA_C)
        attempt = done["jobs"][0]["attempts"][0]
        self.assertEqual(attempt["phase"], "terminal")
        self.assertEqual(attempt["resultSha256"], SHA_C)
        self.assertEqual(done["jobs"][0]["input"], capture_input())
        self.assertEqual(decode_capture_record(encode_capture_record(done)), done)

    def test_v2_observation_pin_is_defensive_and_per_attempt(self):
        first = {"sha256": SHA_B, "bytes": 123}
        second = {"sha256": SHA_C, "bytes": 456}
        pending = begin_capture(record(format=FORMAT_V2), SHA_A, capture_input(), first)
        first["sha256"] = SHA_A
        self.assertEqual(pending["jobs"][0]["attempts"][0]["observation"],
                         {"sha256": SHA_B, "bytes": 123})
        ready = capture_snapshot_ready(pending, SHA_A, 0, 42)
        self.assertEqual(ready["jobs"][0]["attempts"][0]["observation"],
                         {"sha256": SHA_B, "bytes": 123})
        done = finish_capture(ready, SHA_A, SHA_C)
        self.assertEqual(done["jobs"][0]["attempts"][0]["observation"],
                         {"sha256": SHA_B, "bytes": 123})
        retry = begin_capture(done, SHA_A, capture_input(), second)
        self.assertEqual(retry["current"], SHA_A)
        self.assertEqual([attempt["observation"] for attempt in retry["jobs"][0]["attempts"]],
                         [{"sha256": SHA_B, "bytes": 123}, {"sha256": SHA_C, "bytes": 456}])
        self.assertEqual(decode_capture_record(encode_capture_record(retry)), retry)

    def test_v2_observation_pins_are_strict_and_v1_rejects_v2_attempt_fields(self):
        for pin in ({"sha256": "A" * 64, "bytes": 10},
                    {"sha256": SHA_A, "bytes": 0},
                    {"sha256": SHA_A, "bytes": 4097},
                    {"sha256": SHA_A, "bytes": True}):
            with self.subTest(pin=pin), self.assertRaises(ValueError):
                begin_capture(record(format=FORMAT_V2), SHA_B, capture_input(), pin)

        value = record(format=FORMAT_V2)
        pending = begin_capture(value, SHA_A, capture_input())
        pending["jobs"][0]["attempts"][0]["observation"] = {"sha256": SHA_A, "bytes": 4097}
        with self.assertRaises(ValueError):
            encode_capture_record(pending)

        legacy = begin_capture(record(), SHA_A, capture_input())
        legacy["jobs"][0]["attempts"][0]["observation"] = None
        with self.assertRaises(ValueError):
            encode_capture_record(legacy)

    def test_begin_capture_enforces_one_prepared_attempt_and_immutable_job_input(self):
        pending = begin_capture(record(), SHA_A, capture_input())
        with self.assertRaises(ValueError):
            begin_capture(pending, SHA_B, capture_input())
        ready = capture_snapshot_ready(pending, SHA_A, 0, 42)
        done = finish_capture(ready, SHA_A, SHA_C)
        altered = capture_input(); altered["receiptPath"] = "/cache/other-receipt.json"
        with self.assertRaises(ValueError):
            begin_capture(done, SHA_A, altered)
        retry = begin_capture(done, SHA_A, capture_input())
        self.assertEqual(retry["jobs"][0]["attempts"][-1]["number"], 2)
        self.assertEqual(retry["jobs"][0]["attempts"][-1]["phase"], "prepared")

    def test_job_and_attempt_budgets_are_independent_and_immutable(self):
        one_job = record(attempts=1, jobs=1)
        pending = begin_capture(one_job, SHA_A, capture_input())
        ready = capture_snapshot_ready(pending, SHA_A, 0, 42)
        done = finish_capture(ready, SHA_A, SHA_C)
        with self.assertRaises(ValueError):
            begin_capture(done, SHA_A, capture_input())
        with self.assertRaises(ValueError):
            begin_capture(done, SHA_B, capture_input())

    def test_encoded_record_has_a_hard_decimal_byte_limit(self):
        value = record()
        item = capture_input()
        item["extractPath"] = "/" + "x" * 4095
        item["receiptPath"] = "/" + "y" * 4095
        value["jobs"] = [{"requestHash": SHA_A, "input": item, "attempts": [{
            "number": 1, "phase": "prepared", "snapshotDevice": None,
            "snapshotInode": None, "resultSha256": None,
        }]}]
        value["current"] = SHA_A
        self.assertLessEqual(len(encode_capture_record(value)), MAX_RECORD_BYTES)
        # The path bounds keep a single record small; supplying many legal,
        # terminal jobs independently exercises the record byte cap.
        many = record(jobs=MAX_JOBS)
        many["jobs"] = [
            {"requestHash": f"{number:064x}", "input": item, "attempts": [{
                "number": 1, "phase": "terminal", "snapshotDevice": 0,
                "snapshotInode": 1, "resultSha256": SHA_C,
            }]}
            for number in range(1, 257)
        ]
        many["current"] = f"{256:064x}"
        with self.assertRaises(ValueError):
            encode_capture_record(many)


if __name__ == "__main__":
    unittest.main()
