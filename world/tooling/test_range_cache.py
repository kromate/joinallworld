from pathlib import Path
import hashlib
import json
import os
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from range_cache import ExactRangeCache, RangeCacheError

RELEASE = "2026-09-23.1"
URL = f"https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/release/{RELEASE}/buildings/part-0.parquet"
ETAG = '"strong-1"'


class ExactRangeCacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.path.realpath(tempfile.gettempdir()))
        self.root = Path(self.temp.name).resolve()
        self.cache = self.make_cache()

    def tearDown(self):
        self.temp.cleanup()

    def make_cache(self, **limits):
        release = limits.pop("release", RELEASE)
        limits.setdefault("minimum_free_bytes", 0)
        return ExactRangeCache(self.root, self.root, release, **limits)

    def test_exact_body_reuses_only_full_identity_tuple(self):
        self.assertTrue(self.cache.put(URL, 8, ETAG, 0, 2, b"abc"))
        self.assertEqual(self.cache.get(URL, 8, ETAG, 0, 2), b"abc")
        self.assertIsNone(self.cache.get(URL, 8, ETAG, 1, 3))
        self.assertIsNone(self.cache.get(URL + ".other", 8, ETAG, 0, 2))
        self.assertIsNone(self.cache.get(URL, 8, '"strong-2"', 0, 2))
        self.assertIsNone(self.cache.get(URL, 9, ETAG, 0, 2))
        self.assertIsNone(self.make_cache(release="2026-09-24.1").get(URL.replace(RELEASE, "2026-09-24.1"), 8, ETAG, 0, 2))
        entry = next(iter(self.cache.cache_root.iterdir()))
        self.assertEqual(self.cache.written, 3 + (entry / "metadata.json").stat().st_size)

    def test_rejects_weak_or_invalid_pins_and_nonexact_payload(self):
        for etag in ("W/\"weak\"", "", "not-quoted"):
            with self.assertRaises(ValueError):
                self.cache.get(URL, 8, etag, 0, 2)
        with self.assertRaises(ValueError):
            self.cache.put(URL, 8, ETAG, 0, 2, b"ab")
        with self.assertRaises(ValueError):
            self.cache.get(URL + "?query=1", 8, ETAG, 0, 2)

    def test_corrupt_body_and_metadata_fail_closed(self):
        self.cache.put(URL, 8, ETAG, 0, 2, b"abc")
        entry = next(self.cache.cache_root.iterdir())
        (entry / "body.bin").write_bytes(b"abd")
        with self.assertRaisesRegex(RangeCacheError, "corrupt"):
            self.cache.get(URL, 8, ETAG, 0, 2)
        (entry / "body.bin").write_bytes(b"abc")
        (entry / "metadata.json").write_text("{}\n")
        with self.assertRaises(RangeCacheError):
            self.cache.get(URL, 8, ETAG, 0, 2)

    def test_http_validation_facts_are_persisted_and_checked_on_read(self):
        self.cache.put(URL, 8, ETAG, 0, 2, b"abc")
        entry = next(self.cache.cache_root.iterdir())
        metadata_path = entry / "metadata.json"
        original = json.loads(metadata_path.read_text())
        expected = {"status": 206, "contentRange": "bytes 0-2/8", "contentEncoding": "identity"}
        for key, value in expected.items():
            with self.subTest(key=key):
                candidate = {**original, key: value}
                metadata_path.write_bytes(self.cache._canonical(candidate))
                self.assertEqual(self.cache.get(URL, 8, ETAG, 0, 2), b"abc")
                for incorrect in (None, "wrong"):
                    corrupted = {**candidate, key: incorrect}
                    metadata_path.write_bytes(self.cache._canonical(corrupted))
                    with self.assertRaises(RangeCacheError):
                        self.cache.get(URL, 8, ETAG, 0, 2)
        metadata_path.write_bytes(self.cache._canonical(original))

    def test_symlinked_entry_file_is_rejected(self):
        self.cache.put(URL, 8, ETAG, 0, 2, b"abc")
        entry = next(self.cache.cache_root.iterdir())
        body = entry / "body.bin"
        body.unlink()
        target = self.root / "external-body"
        target.write_bytes(b"abc")
        body.symlink_to(target)
        with self.assertRaises(RangeCacheError):
            self.cache.get(URL, 8, ETAG, 0, 2)

    def test_entry_byte_growth_entry_count_and_free_space_caps_skip_writes(self):
        one_entry = self.make_cache(max_bytes=4_000, max_entries=1, max_entry_bytes=100, max_growth_bytes=4_000)
        self.assertTrue(one_entry.put(URL, 8, ETAG, 0, 2, b"abc"))
        other = f"{URL}?not-allowed"  # identity validation is fail-closed before quota behavior
        with self.assertRaises(ValueError):
            one_entry.put(other, 8, ETAG, 3, 5, b"def")
        second_url = URL + "/second"
        self.assertFalse(one_entry.put(second_url, 8, ETAG, 0, 2, b"def"))
        growth_root = self.root / "growth-root"
        small_growth = ExactRangeCache(growth_root, self.root, RELEASE, max_bytes=100, max_entries=10, max_entry_bytes=50, max_growth_bytes=1, minimum_free_bytes=0)
        self.assertFalse(small_growth.put(URL, 8, ETAG, 0, 2, b"abc"))
        free_root = self.root / "free-root"
        no_free = ExactRangeCache(free_root, self.root, RELEASE, max_bytes=100, max_entries=10, max_entry_bytes=50, max_growth_bytes=100, minimum_free_bytes=10**18)
        self.assertFalse(no_free.put(URL, 8, ETAG, 0, 2, b"abc"))

    def test_configured_limits_cannot_raise_frozen_hard_caps(self):
        for override in ({"max_bytes": 32_000_001}, {"max_entries": 257},
                         {"max_entry_bytes": 8_000_001}, {"max_growth_bytes": 8_000_001}):
            with self.subTest(override=override), self.assertRaises(ValueError):
                self.make_cache(**override)

    def test_parent_fsync_failure_after_rename_counts_immutable_publication(self):
        original = ExactRangeCache._fsync_directory
        calls = 0

        def fail_after_publish(directory):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("synthetic parent directory fsync failure")
            return original(directory)

        with patch.object(ExactRangeCache, "_fsync_directory", side_effect=fail_after_publish):
            with self.assertRaisesRegex(OSError, "parent directory fsync"):
                self.cache.put(URL, 8, ETAG, 0, 2, b"abc")
        # Rename is the publication point: even if the parent durability check
        # fails, the visible immutable entry and this invocation's growth count
        # must agree.
        self.assertEqual(self.cache.get(URL, 8, ETAG, 0, 2), b"abc")
        entry = next(iter(self.cache.cache_root.iterdir()))
        self.assertEqual(self.cache.written, 3 + (entry / "metadata.json").stat().st_size)

    def test_enospc_partial_write_is_a_skipped_write_but_charged(self):
        original = ExactRangeCache._write_new_file
        calls = 0

        def body_then_partial_metadata(target, payload):
            nonlocal calls
            calls += 1
            if calls == 1:
                return original(target, payload)
            # Retain real bounded partial bytes as if the filesystem filled
            # while writing metadata after the body was safely fsynced.
            descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            try:
                os.write(descriptor, payload[:2])
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
            raise OSError(28, "No space left on device")

        with patch.object(ExactRangeCache, "_write_new_file", side_effect=body_then_partial_metadata):
            result = self.cache.put(URL, 8, ETAG, 0, 2, b"abc")
        self.assertFalse(result)
        self.assertEqual(self.cache.written, 3 + 2)
        self.assertIsNone(self.cache.get(URL, 8, ETAG, 0, 2))

    def test_partial_bytes_consume_remaining_invocation_growth_allowance(self):
        tiny = self.make_cache(max_bytes=10_000, max_entries=10, max_entry_bytes=100,
                               max_growth_bytes=380, minimum_free_bytes=0)
        original = ExactRangeCache._write_new_file
        calls = 0

        def partial_write(target, payload):
            nonlocal calls
            calls += 1
            if calls == 1:
                return original(target, payload)
            descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            try:
                os.write(descriptor, payload[:8])
            finally:
                os.close(descriptor)
            raise OSError(28, "No space left on device")

        with patch.object(ExactRangeCache, "_write_new_file", side_effect=partial_write):
            self.assertFalse(tiny.put(URL, 8, ETAG, 0, 2, b"abc"))
        self.assertEqual(tiny.written, 3 + 8)
        # A later exact span cannot use the unused-looking remainder to bypass
        # the reserved metadata/body growth or count the incomplete bytes twice.
        self.assertFalse(tiny.put(URL, 8, ETAG, 3, 5, b"def"))
        self.assertEqual(tiny.written, 3 + 8)

    def test_interrupted_publication_leaves_no_hittable_hash_directory(self):
        original = ExactRangeCache._write_new_file
        calls = 0

        def interrupt(target, data):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("synthetic crash between body and metadata")
            return original(target, data)

        with patch.object(ExactRangeCache, "_write_new_file", side_effect=interrupt):
            with self.assertRaisesRegex(OSError, "synthetic crash"):
                self.cache.put(URL, 8, ETAG, 0, 2, b"abc")
        self.assertIsNone(self.cache.get(URL, 8, ETAG, 0, 2))
        self.assertTrue(any(path.name.startswith(".range-") for path in self.cache.cache_root.iterdir()))
        self.assertGreater(self.cache.written, 0)

    def test_flight_serializes_duplicate_miss_and_allows_follower_to_hit(self):
        outcomes = []
        body = b"abc"
        calls = 0
        guard = threading.Lock()
        barrier = threading.Barrier(2)

        def worker():
            nonlocal calls
            barrier.wait(timeout=2)
            with self.cache.flight(URL, 8, 0, 2):
                found = self.cache.get(URL, 8, ETAG, 0, 2)
                if found is None:
                    with guard:
                        calls += 1
                    self.assertTrue(self.cache.put(URL, 8, ETAG, 0, 2, body))
                    found = body
                outcomes.append(found)

        threads = [threading.Thread(target=worker) for _ in range(2)]
        for thread in threads: thread.start()
        for thread in threads: thread.join(timeout=5)
        self.assertTrue(all(not thread.is_alive() for thread in threads))
        self.assertEqual(calls, 1)
        self.assertEqual(outcomes, [body, body])

    def test_symlinked_cache_ancestor_fails_before_cache_creation(self):
        outside = Path(tempfile.mkdtemp(dir=os.path.realpath(tempfile.gettempdir())))
        try:
            link = self.root / "link"
            link.symlink_to(outside, target_is_directory=True)
            with self.assertRaises(RangeCacheError):
                ExactRangeCache(link, link, RELEASE, minimum_free_bytes=0)
        finally:
            import shutil
            shutil.rmtree(outside)


if __name__ == "__main__":
    unittest.main()
