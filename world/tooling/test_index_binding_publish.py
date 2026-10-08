"""Prepared publication fixtures; own disposable synthetic namespace state only."""
from dataclasses import replace
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

from index_binding_publish import publish_index_binding
from index_root import charged_index_root
from test_index_root import fixture, binding


class IndexBindingPublicationTests(unittest.TestCase):
    def test_atomic_publication_and_exact_replay_keep_bytes_and_inode(self):
        with fixture() as (_, namespace, registry):
            raw = binding()
            with charged_index_root(namespace, registry, raw) as admitted:
                report = publish_index_binding(admitted)
                self.assertFalse(report["replayed"])
                file = admitted.lease.root/"binding.json"; before = file.stat()
                self.assertEqual(file.read_bytes(), raw)
                self.assertFalse((admitted.lease.root/"binding.pending").exists())
                self.assertTrue(publish_index_binding(admitted)["replayed"])
                after = file.stat()
                self.assertEqual((before.st_ino,before.st_mtime_ns,before.st_ctime_ns),
                                 (after.st_ino,after.st_mtime_ns,after.st_ctime_ns))
            self.assertEqual(registry.snapshot()["reservations"], 1)

    def test_expected_empty_or_partial_prefix_resumes_without_rewriting_charge(self):
        for size in [0, 7, 100]:
            with fixture() as (_, namespace, registry):
                raw = binding()
                with charged_index_root(namespace, registry, raw) as admitted:
                    root = admitted.lease.root
                    staged = root/"binding.pending"; staged.write_bytes(raw[:size]); staged.chmod(0o600)
                with charged_index_root(namespace, registry, raw) as admitted:
                    report = publish_index_binding(admitted)
                    self.assertTrue(report["resumedPending"])
                    self.assertEqual(report["resumedBytes"], size)
                    self.assertEqual((root/"binding.json").read_bytes(), raw)
                    self.assertFalse(staged.exists())
                self.assertEqual(registry.snapshot()["reservations"], 1)

    def test_contradictory_prefix_is_preserved_without_final_publication(self):
        with fixture() as (_, namespace, registry):
            raw = binding()
            with self.assertRaisesRegex(ValueError, "binding"):
                with charged_index_root(namespace, registry, raw) as admitted:
                    staged = admitted.lease.root/"binding.pending"
                    staged.write_bytes(b"contradictory"); staged.chmod(0o600)
                    publish_index_binding(admitted)
            self.assertEqual(staged.read_bytes(), b"contradictory")
            self.assertFalse((staged.parent/"binding.json").exists())
            self.assertEqual(registry.snapshot()["reservations"], 1)

    def test_rename_failure_retains_complete_stage_for_exact_retry(self):
        with fixture() as (_, namespace, registry):
            raw = binding()
            with self.assertRaisesRegex(OSError, "rename failure"):
                with charged_index_root(namespace, registry, raw) as admitted:
                    root = admitted.lease.root
                    with patch("index_binding_publish.os.rename", side_effect=OSError("injected rename failure")):
                        publish_index_binding(admitted)
            staged = root/"binding.pending"; inode = staged.stat().st_ino
            self.assertEqual(staged.read_bytes(), raw)
            self.assertFalse((root/"binding.json").exists())
            with charged_index_root(namespace, registry, raw) as admitted:
                report = publish_index_binding(admitted)
                self.assertTrue(report["resumedPending"])
                self.assertEqual(report["resumedBytes"], len(raw))
                self.assertEqual((root/"binding.json").stat().st_ino, inode)
            self.assertEqual(registry.snapshot()["reservations"], 1)

    def test_changed_final_binding_is_never_overwritten(self):
        with fixture() as (_, namespace, registry):
            raw = binding()
            with self.assertRaisesRegex(ValueError, "binding"):
                with charged_index_root(namespace, registry, raw) as admitted:
                    publish_index_binding(admitted)
                    file = admitted.lease.root/"binding.json"
                    file.write_bytes(b"x"*len(raw))
                    publish_index_binding(admitted)
            self.assertEqual(file.read_bytes(), b"x"*len(raw))
            self.assertFalse((file.parent/"binding.pending").exists())

    def test_charged_root_mismatch_fails_before_creating_stage(self):
        with fixture() as (_, namespace, registry):
            with charged_index_root(namespace, registry, binding()) as admitted:
                with self.assertRaisesRegex(ValueError, "differs"):
                    publish_index_binding(replace(admitted, index_hash="f"*64))
                self.assertFalse((admitted.lease.root/"binding.pending").exists())

    def test_symlink_stage_preserves_its_target(self):
        with fixture() as (parent, namespace, registry):
            target = parent/"owned-target"; target.write_bytes(b"preserved"); target.chmod(0o600)
            with self.assertRaises((ValueError, OSError)):
                with charged_index_root(namespace, registry, binding()) as admitted:
                    staged = admitted.lease.root/"binding.pending"; staged.symlink_to(target)
                    publish_index_binding(admitted)
            self.assertEqual(target.read_bytes(), b"preserved")
            self.assertTrue(staged.is_symlink())

    def test_replay_refuses_replaced_open_descriptor(self):
        with fixture() as (parent, namespace, registry):
            raw = binding()
            with charged_index_root(namespace, registry, raw) as admitted:
                publish_index_binding(admitted)
                final = admitted.lease.root/"binding.json"
                replacement = parent/"replacement"
                replacement.write_bytes(raw); replacement.chmod(0o600)
                replacement_inode = replacement.stat().st_ino
                native_open = os.open

                def replaced_open(name, flags, *args, **kwargs):
                    descriptor = native_open(name, flags, *args, **kwargs)
                    if name == "binding.json" and flags & os.O_RDWR:
                        os.replace(replacement, final)
                    return descriptor

                with patch("index_binding_publish.os.open", side_effect=replaced_open):
                    with self.assertRaisesRegex(ValueError, "opened binding inode"):
                        publish_index_binding(admitted)
                self.assertEqual(final.read_bytes(), raw)
                self.assertEqual(final.stat().st_ino, replacement_inode)

    def test_abrupt_binding_worker_exit_reopens_exact_state_without_second_charge(self):
        # Fixed fixture worker only: no engine, network, real ledger or game data.
        worker = r'''
import os, resource, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from index_binding_publish import publish_index_binding
from index_root import ChargedIndexRoot
from index_writer_lock import IndexWriterLease
resource.setrlimit(resource.RLIMIT_CPU, (5, 5))
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
root = Path(sys.argv[2]); fd = int(sys.argv[3]); mode = sys.argv[4]
info = os.fstat(fd)
raw = bytes.fromhex(sys.argv[5])
admitted = ChargedIndexRoot(IndexWriterLease(root, fd, info.st_dev, info.st_ino),
                           root.name, raw, 32*1024*1024, False)
if mode == "prefix":
    native_write = os.write
    def interrupted_write(descriptor, data):
        native_write(descriptor, data[:17])
        os._exit(77)
    os.write = interrupted_write
else:
    native_rename = os.rename
    def interrupted_rename(*args, **kwargs):
        if mode == "after-rename":
            native_rename(*args, **kwargs)
        os._exit(78 if mode == "before-rename" else 79)
    os.rename = interrupted_rename
publish_index_binding(admitted)
raise RuntimeError("fixture did not reach its abrupt-exit boundary")
'''
        for mode, code, size in [("prefix", 77, 17), ("before-rename", 78, None),
                                  ("after-rename", 79, None)]:
            with self.subTest(mode=mode), fixture() as (_, namespace, registry):
                raw = binding()
                with charged_index_root(namespace, registry, raw) as admitted:
                    root = admitted.lease.root
                    completed = subprocess.run(
                        [sys.executable, "-I", "-c", worker, str(Path(__file__).resolve().parent),
                         str(root), str(admitted.lease.descriptor), mode, raw.hex()],
                        pass_fds=(admitted.lease.descriptor,), capture_output=True, timeout=10)
                    self.assertEqual(completed.returncode, code, completed.stderr.decode())
                    name = "binding.json" if mode == "after-rename" else "binding.pending"
                    file = root/name
                    self.assertEqual(file.read_bytes(), raw[:size] if size is not None else raw)
                    inode = file.stat().st_ino
                with charged_index_root(namespace, registry, raw) as admitted:
                    report = publish_index_binding(admitted)
                    self.assertEqual(report["replayed"], mode == "after-rename")
                    self.assertEqual((root/"binding.json").read_bytes(), raw)
                    self.assertEqual((root/"binding.json").stat().st_ino, inode)
                    self.assertFalse((root/"binding.pending").exists())
                self.assertEqual(registry.snapshot()["reservations"], 1)


if __name__ == "__main__":
    unittest.main()
