"""Prepared source-only binding fixtures; no real pins, files or database access."""
from copy import deepcopy
import hashlib
import json
import unittest

from index_binding import (VERSIONS, MAX_BYTES, MIB, encode_index_binding, decode_index_binding,
                           index_binding_hash, encode_index_shard_binding,
                           decode_index_shard_binding, index_shard_binding_hash)


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
    def test_v1_frozen_bytes_remain_unchanged(self):
        expected = (b'{"captureVersion":"overture-pinned-capture-v1","engineLimits":{"captures":8,"databaseBytes":4194304,'
                    b'"observations":16,"occurrences":4000,"versions":3000},"engineVersion":"complete-feature-index-v1",'
                    b'"format":"feature-index-binding-v1","identityVersion":"overture-complete-feature-owner-v1",'
                    b'"processLimits":{"cpuSeconds":10,"fileBytes":4194304,"heapMiB":256,"rssBytes":402653184,"wallSeconds":15},'
                    b'"reservedBytes":33554432,"runtime":{"nodeBytes":167772160,"nodeSha256":"dddddddddddddddddddddddddddddddd'
                    b'dddddddddddddddddddddddddddddddd","nodeVersion":"v22.19.0","sqliteVersion":"3.50.4"},"source":{"configuration":'
                    b'{"bytes":1297,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"layers":["buildings","roads"],'
                    b'"provider":"overture","release":"2026-01-21.0"},"sourceCompiler":"world-source-compiler-v2",'
                    b'"toolingManifest":{"bytes":2000,"sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}')
        self.assertEqual(encode_index_binding(fixture()), expected)
        self.assertEqual(decode_index_binding(expected), fixture())
        self.assertEqual(hashlib.sha256(expected).hexdigest(), "809e15436e4348618c91f21a228cbccfdf9827d5d42559690e7a30d84ba2c418")

    def test_v2_shard_binding_is_deterministic_and_binds_the_exact_v1_bytes(self):
        base = encode_index_binding(fixture())
        pins = {"planHash": "c"*64, "shardId": "d"*64, "membershipHash": "e"*64,
                "baseIndexBindingHash": hashlib.sha256(base).hexdigest()}
        reordered = dict(reversed(list(pins.items())))
        encoded = encode_index_shard_binding(base, pins)
        self.assertEqual(encoded, encode_index_shard_binding(base, reordered))
        value = decode_index_shard_binding(encoded)
        self.assertEqual(value["format"], "feature-index-binding-v2")
        self.assertEqual(value["shard"], pins)
        self.assertEqual(index_shard_binding_hash(encoded), hashlib.sha256(encoded).hexdigest())
        self.assertEqual(index_shard_binding_hash(encoded), "7f37bcf935126aa36331b9144d976d5ec590618fd526beb6485554b337bfd09f")
        self.assertEqual(len(encoded), len(encoded.decode("ascii").encode("ascii")))
        for legacy in [lambda: decode_index_binding(encoded), lambda: encode_index_binding(value),
                       lambda: index_binding_hash(encoded)]:
            with self.assertRaisesRegex(ValueError, "exact binding fields"):
                legacy()

    def test_v2_membership_changes_identity_and_refuses_changed_base_pins(self):
        base = encode_index_binding(fixture())
        pins = {"planHash": "1"*64, "shardId": "2"*64, "membershipHash": "3"*64,
                "baseIndexBindingHash": hashlib.sha256(base).hexdigest()}
        first = encode_index_shard_binding(base, pins)
        pins["membershipHash"] = "4"*64
        second = encode_index_shard_binding(base, pins)
        self.assertNotEqual(index_shard_binding_hash(first), index_shard_binding_hash(second))
        with self.assertRaisesRegex(ValueError, "base binding hash"):
            encode_index_shard_binding(base, dict(pins, baseIndexBindingHash="5"*64))
        changed_base = fixture(); changed_base["reservedBytes"] += MIB
        with self.assertRaisesRegex(ValueError, "base binding hash"):
            encode_index_shard_binding(encode_index_binding(changed_base), pins)

    def test_v2_refuses_unknown_duplicate_noncanonical_mutable_boolean_and_oversized_input(self):
        base = encode_index_binding(fixture())
        pins = {"planHash": "1"*64, "shardId": "2"*64, "membershipHash": "3"*64,
                "baseIndexBindingHash": hashlib.sha256(base).hexdigest()}
        raw = encode_index_shard_binding(base, pins)
        with self.assertRaisesRegex(ValueError, "exact pin fields"):
            encode_index_shard_binding(base, dict(pins, extra="x"))
        with self.assertRaises(ValueError):
            encode_index_shard_binding(base, dict(pins, shardId=True))
        duplicate = raw.replace(b'"planHash":"'+b"1"*64+b'"',
                                b'"planHash":"'+b"1"*64+b'","planHash":"'+b"1"*64+b'"', 1)
        for malformed in [duplicate, raw+b"\n", b" "+raw, bytearray(raw), b"x"*(MAX_BYTES+1)]:
            with self.subTest(type=type(malformed).__name__, size=len(malformed)), self.assertRaises(ValueError):
                decode_index_shard_binding(malformed)
        value = json.loads(raw)
        changed = dict(value); changed["shard"] = dict(value["shard"], baseIndexBindingHash="f"*64)
        with self.assertRaisesRegex(ValueError, "base binding hash"):
            decode_index_shard_binding(json.dumps(changed, sort_keys=True, separators=(",", ":")).encode("ascii"))
        nested = dict(value); nested["shard"] = dict(value["shard"], unknown="x")
        with self.assertRaisesRegex(ValueError, "exact pin fields"):
            decode_index_shard_binding(json.dumps(nested, sort_keys=True, separators=(",", ":")).encode("ascii"))
        extra = dict(value, unknown="x")
        with self.assertRaisesRegex(ValueError, "exact binding fields"):
            decode_index_shard_binding(json.dumps(extra, sort_keys=True, separators=(",", ":")).encode("ascii"))
        invalid_base = dict(value)
        invalid_base["engineLimits"] = dict(value["engineLimits"], captures=4097)
        base = dict(invalid_base); del base["shard"]; base["format"] = VERSIONS["format"]
        base_raw = json.dumps(base, sort_keys=True, separators=(",", ":")).encode("ascii")
        invalid_base["shard"] = dict(value["shard"], baseIndexBindingHash=hashlib.sha256(base_raw).hexdigest())
        with self.assertRaisesRegex(ValueError, "captures"):
            decode_index_shard_binding(json.dumps(invalid_base, sort_keys=True, separators=(",", ":")).encode("ascii"))

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
