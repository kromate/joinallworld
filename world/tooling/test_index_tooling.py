"""Prepared read-only tooling fixtures; only own disposable synthetic source trees."""
from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from index_tooling import (FILES, FORMAT, MAX_SOURCE_BYTES, encode_tooling_manifest,
                           decode_tooling_manifest, verify_index_tooling)


def pin(raw):
    return {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}


@contextmanager
def fixture():
    with tempfile.TemporaryDirectory(prefix="allworld-index-tools-fixture-") as temporary:
        root = Path(temporary).resolve(strict=True)
        files = {}
        for name in FILES:
            file = root/name; file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            raw = ("synthetic input: "+name).encode("ascii")
            file.write_bytes(raw); file.chmod(0o600); files[name] = pin(raw)
        value = {"format": FORMAT, "files": files}
        raw = encode_tooling_manifest(value)
        yield root, value, raw, pin(raw)


class IndexToolingTests(unittest.TestCase):
    def test_all_fixed_inputs_are_compared_without_writes_or_execution(self):
        with fixture() as (root, value, raw, expected):
            before = {name: (root/name).read_bytes() for name in FILES}
            report = verify_index_tooling(root, raw, expected)
            self.assertEqual(report["files"], len(FILES))
            self.assertEqual(report["sourceBytes"], sum(p["bytes"] for p in value["files"].values()))
            self.assertEqual({name: (root/name).read_bytes() for name in FILES}, before)

    def test_missing_extra_and_escaping_paths_are_refused_before_file_reads(self):
        with fixture() as (root, value, _, __):
            for bad in ["missing", "extra", "escape"]:
                changed = {"format": FORMAT, "files": dict(value["files"])}
                if bad == "missing": changed["files"].pop(FILES[0])
                else: changed["files"]["../outside" if bad == "escape" else "world/unknown.ts"] = pin(b"x")
                with patch("index_tooling._source_pin") as read:
                    with self.assertRaises(ValueError): encode_tooling_manifest(changed)
                    read.assert_not_called()

    def test_altered_bytes_and_missing_source_fail_without_repinning(self):
        for bad in ["changed", "missing"]:
            with fixture() as (root, _, raw, expected):
                file = root/FILES[0]
                if bad == "changed": file.write_bytes(b"x"*file.stat().st_size)
                else: file.unlink()
                with self.assertRaises((ValueError, OSError)):
                    verify_index_tooling(root, raw, expected)
                if bad == "changed": self.assertEqual(file.read_bytes(), b"x"*file.stat().st_size)

    def test_symlink_directory_and_file_and_hardlink_are_refused(self):
        for bad in ["directory", "file", "hardlink"]:
            with fixture() as (root, _, raw, expected):
                outside = root/"owned-target"; outside.write_bytes(b"preserved"); outside.chmod(0o600)
                if bad == "directory":
                    (root/"world").rename(root/"moved-world")
                    (root/"world").symlink_to(root/"moved-world", target_is_directory=True)
                else:
                    file = root/FILES[0]; file.unlink()
                    if bad == "file": file.symlink_to(outside)
                    else: file.hardlink_to(outside)
                with self.assertRaises((ValueError, OSError)):
                    verify_index_tooling(root, raw, expected)
                self.assertEqual(outside.read_bytes(), b"preserved")

    def test_group_writable_inputs_or_roots_are_refused(self):
        for bad in ["root", "directory", "file"]:
            with fixture() as (root, _, raw, expected):
                target = root if bad == "root" else root/"world" if bad == "directory" else root/FILES[0]
                target.chmod(0o770 if bad != "file" else 0o660)
                with self.assertRaises(ValueError): verify_index_tooling(root, raw, expected)

    def test_manifest_hash_size_canonicality_and_source_bounds_are_enforced(self):
        with fixture() as (_, value, raw, expected):
            for bad, retained in [(bytearray(raw), expected), (raw+b"\n", expected),
                                  (raw, {"sha256": "0"*64, "bytes": len(raw)}),
                                  (raw+b"\n", pin(raw+b"\n"))]:
                with self.assertRaises(ValueError): decode_tooling_manifest(bad, retained)
            duplicate = raw.replace(b'"format":', b'"format":"ignored","format":', 1)
            self.assertNotEqual(duplicate, raw)
            with self.assertRaisesRegex(ValueError, "duplicate"):
                decode_tooling_manifest(duplicate, pin(duplicate))
            for bad in [True, MAX_SOURCE_BYTES+1, 0]:
                value["files"][FILES[0]]["bytes"] = bad
                with self.assertRaises(ValueError): encode_tooling_manifest(value)

    def test_file_change_observed_during_read_is_refused(self):
        with fixture() as (root, _, raw, expected):
            original_read = os.read; changed = False

            def changing_read(descriptor, length):
                nonlocal changed
                chunk = original_read(descriptor, length)
                if not changed:
                    changed = True
                    file = root/FILES[0]; file.write_bytes(file.read_bytes()+b"changed")
                return chunk

            with patch("index_tooling.os.read", side_effect=changing_read):
                with self.assertRaises(ValueError): verify_index_tooling(root, raw, expected)
            self.assertTrue(changed)


if __name__ == "__main__":
    unittest.main()
