"""Focused tests for disposable copies of the fixed index execution inputs."""
from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import shutil
import tempfile
import unittest

from index_execution_snapshot import (CONFIGURATION, verified_execution_snapshot)
from index_tooling import FILES, FORMAT, encode_tooling_manifest
from index_resource_limits import IndexWorkerUnreaped


def pin(raw):
    return {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}


@contextmanager
def fixture():
    with tempfile.TemporaryDirectory(prefix="allworld-index-snapshot-source-") as temporary:
        root = Path(temporary).resolve(strict=True)
        files = {}
        for name in FILES:
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            raw = ("synthetic input: " + name).encode("ascii")
            path.write_bytes(raw)
            path.chmod(0o600)
            files[name] = pin(raw)
        config = b'{"format":"synthetic-source-config-v1"}'
        config_path = root / CONFIGURATION
        config_path.write_bytes(config)
        config_path.chmod(0o600)
        manifest = encode_tooling_manifest({"format": FORMAT, "files": files})
        yield root, manifest, pin(manifest), config, pin(config)


class IndexExecutionSnapshotTests(unittest.TestCase):
    def test_fixed_copy_is_read_only_bounded_and_leaves_source_untouched(self):
        with fixture() as (root, raw, manifest_pin, config, source_pin):
            source_before = {name: (root / name).read_bytes() for name in (*FILES, CONFIGURATION)}
            with verified_execution_snapshot(root, raw, manifest_pin, config, source_pin) as snapshot:
                self.assertEqual(snapshot.manifest_bytes, raw)
                self.assertEqual(snapshot.source_configuration, config)
                self.assertEqual(snapshot.root, snapshot.root.resolve(strict=True))
                self.assertNotEqual(os.path.commonpath((str(root), str(snapshot.root))), str(root))
                actual = {path.relative_to(snapshot.root).as_posix()
                          for path in snapshot.root.rglob("*") if path.is_file()}
                self.assertEqual(actual, set(FILES) | {CONFIGURATION})
                self.assertFalse((snapshot.root / ".cache").exists())
                self.assertLessEqual(snapshot.charged_bytes, 16 * 1024 * 1024 + 1024 * 1024)
                self.assertEqual(os.stat(snapshot.root).st_mode & 0o777, 0o700)
                self.assertEqual(os.stat(snapshot.root / "world").st_mode & 0o777, 0o700)
                for name in (*FILES, CONFIGURATION):
                    copied = snapshot.root / name
                    self.assertEqual(copied.read_bytes(), source_before[name])
                    self.assertEqual(os.stat(copied).st_mode & 0o777, 0o400)
            self.assertEqual({name: (root / name).read_bytes() for name in (*FILES, CONFIGURATION)},
                             source_before)

    def test_wrong_manifest_or_configuration_pin_refuses_to_yield(self):
        with fixture() as (root, raw, manifest_pin, config, source_pin):
            for bad_manifest_pin, bad_source_pin in [
                    ({"sha256": "0" * 64, "bytes": len(raw)}, source_pin),
                    (manifest_pin, {"sha256": "0" * 64, "bytes": len(config)})]:
                with self.assertRaises(ValueError):
                    with verified_execution_snapshot(root, raw, bad_manifest_pin, config,
                                                     bad_source_pin):
                        self.fail("invalid pin reached snapshot yield")
            with self.assertRaises(ValueError):
                with verified_execution_snapshot(root, raw, manifest_pin, config + b" ", source_pin):
                    self.fail("altered configuration reached snapshot yield")

    def test_altered_repository_source_is_refused(self):
        with fixture() as (root, raw, manifest_pin, config, source_pin):
            source = root / FILES[0]
            source.write_bytes(b"x" * source.stat().st_size)
            with self.assertRaises((ValueError, OSError)):
                with verified_execution_snapshot(root, raw, manifest_pin, config, source_pin):
                    self.fail("altered source reached snapshot yield")

    def test_temporary_tree_is_removed_after_caller_exception(self):
        with fixture() as (root, raw, manifest_pin, config, source_pin):
            snapshot_root = None
            with self.assertRaisesRegex(RuntimeError, "caller failure"):
                with verified_execution_snapshot(root, raw, manifest_pin, config, source_pin) as snapshot:
                    snapshot_root = snapshot.root
                    raise RuntimeError("caller failure")
            self.assertIsNotNone(snapshot_root)
            self.assertFalse(snapshot_root.exists())

    def test_unconfirmed_worker_reap_preserves_the_owned_execution_tree(self):
        # Inject lifecycle status only; no real child is left running by this test.
        class Handle:
            pid = 123
        with fixture() as (root, raw, manifest_pin, config, source_pin):
            retained = None
            try:
                with self.assertRaises(IndexWorkerUnreaped) as caught:
                    with verified_execution_snapshot(root, raw, manifest_pin, config, source_pin) as snapshot:
                        retained = snapshot.root
                        raise IndexWorkerUnreaped(Handle(), root, retained, "injected wait timeout")
                self.assertEqual(caught.exception.retained_snapshot, retained)
                self.assertTrue(retained.exists())
                self.assertEqual((retained/CONFIGURATION).read_bytes(), config)
            finally:
                if retained is not None: shutil.rmtree(retained)


if __name__ == "__main__":
    unittest.main()
