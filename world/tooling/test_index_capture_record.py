"""Pure codec and state-transition checks for per-capture ownership records."""
import unittest

from index_capture_record import (
    FORMAT, MAX_JOBS, MAX_RECORD_BYTES, begin_capture, capture_snapshot_ready,
    decode_capture_record, encode_capture_record, finish_capture,
)


SHA_A = "a" * 64
SHA_B = "b" * 64
SHA_C = "c" * 64


def record(*, attempts=2, jobs=2):
    return {
        "format": FORMAT,
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
