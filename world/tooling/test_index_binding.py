"""Prepared source-only binding fixtures; no real pins, files or database access."""
from copy import deepcopy
import hashlib
import json
import unittest

from index_binding import VERSIONS, MAX_BYTES, MIB, encode_index_binding, decode_index_binding, index_binding_hash


def fixture():
    return {**VERSIONS,
        "source": {"provider": "overture", "release": "2026-01-21.0", "layers": ["buildings", "roads"],
                   "configuration": {"sha256": "a"*64, "bytes": 1297}},
        "toolingManifest": {"sha256": "b"*64, "bytes": 2000},
        "runtime": {"nodeVersion": "v22.19.0", "sqliteVersion": "3.50.4",
                    "nodeSha256": "d"*64, "nodeBytes": 160*MIB},
        "engineLimits": {"databaseBytes": 4*MIB, "captures": 8, "occurrences": 4000,
                         "versions": 3000, "observations": 16},
        "processLimits": {"fileBytes": 4*MIB, "cpuSeconds": 10, "wallSeconds": 15,
                          "heapMiB": 256, "rssBytes": 384*MIB},
        "reservedBytes": 32*MIB}


class IndexBindingTests(unittest.TestCase):
    def test_exact_roundtrip_is_stable_and_does_not_mutate_caller_data(self):
        value = fixture(); before = deepcopy(value)
        raw = encode_index_binding(value)
        self.assertLessEqual(len(raw), MAX_BYTES)
        self.assertEqual(decode_index_binding(raw), before)
        self.assertEqual(value, before)
        self.assertEqual(index_binding_hash(raw), hashlib.sha256(raw).hexdigest())
        decoded = decode_index_binding(raw); decoded["engineLimits"]["captures"] = 1
        self.assertEqual(decode_index_binding(raw), before)

    def test_object_insertion_order_does_not_change_identity(self):
        value = fixture(); reversed_value = dict(reversed(list(value.items())))
        reversed_value["engineLimits"] = dict(reversed(list(value["engineLimits"].items())))
        self.assertEqual(encode_index_binding(value), encode_index_binding(reversed_value))

    def test_changed_source_tools_runtime_or_budget_requires_a_different_index(self):
        original = encode_index_binding(fixture())
        changes = [("source", "release", "2026-02-18.0"),
                   ("toolingManifest", "sha256", "c"*64),
                   ("runtime", "sqliteVersion", "3.50.5"),
                   ("runtime", "nodeSha256", "e"*64),
                   ("engineLimits", "captures", 9), ("processLimits", "wallSeconds", 16)]
        for group, key, new in changes:
            value = fixture(); value[group][key] = new
            self.assertNotEqual(index_binding_hash(encode_index_binding(value)), index_binding_hash(original))
        value = fixture(); value["reservedBytes"] += MIB
        self.assertNotEqual(index_binding_hash(encode_index_binding(value)), index_binding_hash(original))

    def test_missing_unknown_and_unsupported_version_fields_are_refused(self):
        for group in [None, "source", "engineLimits", "processLimits", "runtime", "toolingManifest"]:
            for mode in ["missing", "extra"]:
                value = fixture(); target = value if group is None else value[group]
                if mode == "missing": target.pop(next(iter(target)))
                else: target["unexpected"] = 1
                with self.subTest(group=group, mode=mode), self.assertRaises(ValueError):
                    encode_index_binding(value)
        for key in VERSIONS:
            value = fixture(); value[key] = "unsupported"
            with self.subTest(key=key), self.assertRaises(ValueError): encode_index_binding(value)

    def test_duplicate_decoded_fields_and_nonfinite_numbers_are_refused(self):
        raw = encode_index_binding(fixture())
        for malformed in [raw.replace(b'{"captureVersion":', b'{"captureVersion":"ignored","captureVersion":', 1),
                          raw.replace(b'"reservedBytes":33554432', b'"reservedBytes":NaN'),
                          raw.replace(b'"captures":8', b'"captures":8,"cap\\u0074ures":8')]:
            self.assertNotEqual(malformed, raw)
            with self.assertRaises(ValueError): decode_index_binding(malformed)

    def test_alternate_json_whitespace_and_escapes_are_not_normalized_on_reopen(self):
        raw = encode_index_binding(fixture())
        for alternate in [raw+b"\n", b" "+raw,
                          json.dumps(fixture(), sort_keys=True).encode("ascii"),
                          raw.replace(b'"overture"', b'"\\u006fverture"')]:
            with self.assertRaisesRegex(ValueError, "not canonical"):
                decode_index_binding(alternate)

    def test_invalid_layers_release_and_pins_are_refused(self):
        for layers in [[], ["roads", "buildings"], ["roads", "roads"], ["transportation"], ("roads",)]:
            value = fixture(); value["source"]["layers"] = layers
            with self.subTest(layers=layers), self.assertRaises(ValueError): encode_index_binding(value)
        for release in ["latest", "2026-01-21", "２０２６-01-21.0"]:
            value = fixture(); value["source"]["release"] = release
            with self.assertRaises(ValueError): encode_index_binding(value)
        for group in ["configuration", "toolingManifest"]:
            for key, bad in [("sha256", "A"*64), ("bytes", True), ("bytes", 64001)]:
                value = fixture()
                target = value["source"][group] if group == "configuration" else value[group]
                target[key] = bad
                with self.assertRaises(ValueError): encode_index_binding(value)

    def test_boolean_fractional_oversized_and_inconsistent_bounds_are_refused(self):
        for group, key, bad in [("engineLimits", "captures", True), ("engineLimits", "versions", 0),
                               ("engineLimits", "databaseBytes", 65537), ("engineLimits", "captures", 4097),
                               ("processLimits", "heapMiB", 1537), ("processLimits", "wallSeconds", 1.5),
                               ("runtime", "nodeBytes", 256*MIB+1),
                               ("processLimits", "fileBytes", 65536)]:
            value = fixture(); value[group][key] = bad
            with self.subTest(group=group, key=key), self.assertRaises(ValueError): encode_index_binding(value)
        value = fixture(); value["reservedBytes"] = 65536
        with self.assertRaises(ValueError): encode_index_binding(value)

    def test_raw_mutable_oversized_nonascii_and_deep_inputs_are_refused(self):
        raw = encode_index_binding(fixture())
        for bad in [bytearray(raw), memoryview(raw), b"", b"x"*(MAX_BYTES+1),
                    b"\xef\xbb\xbf"+raw, b"["*1500+b"0"+b"]"*1500]:
            with self.subTest(size=len(bad)), self.assertRaises(ValueError): decode_index_binding(bad)


if __name__ == "__main__":
    unittest.main()
