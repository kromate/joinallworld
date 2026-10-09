"""Prepared publication fixtures; own disposable synthetic namespace state only."""
from dataclasses import replace
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

import index_binding_publish as binding_publish
from index_binding_publish import publish_index_binding, publish_index_shard_binding
from index_root import (charged_index_root, precharged_index_shard_root,
                        prepare_index_shard_plan_authority, planned_index_reservations)
from index_writer_lock import index_writer_lease
from test_index_root import fixture, binding
from test_index_registry_worker import planner_fixture


class IndexBindingPublicationTests(unittest.TestCase):
    def _authority(self, *, requests=None):
        raw, pin, base, _ = planner_fixture(requests=requests)
        return prepare_index_shard_plan_authority(raw, pin, base), base

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

    def test_exact_v2_plan_binding_publication_and_replay(self):
        authority, _ = self._authority()
        entries = planned_index_reservations(authority)
        self.assertEqual(len(entries), 1)
        with fixture() as (_, namespace, registry):
            registry.reserve_many([{"indexHash": key, "bindingBytes": raw, "reservedBytes": amount}
                                   for key, raw, amount in entries])
            key, raw, _ = entries[0]
            with precharged_index_shard_root(namespace, registry, authority, key) as admitted:
                report = publish_index_shard_binding(admitted, authority)
                self.assertFalse(report["replayed"])
                target = admitted.lease.root/"binding.json"
                first = target.stat()
                self.assertEqual(target.read_bytes(), raw)
                replay = publish_index_shard_binding(admitted, authority)
                self.assertTrue(replay["replayed"])
                second = target.stat()
                self.assertEqual((first.st_ino, first.st_mtime_ns, first.st_ctime_ns),
                                 (second.st_ino, second.st_mtime_ns, second.st_ctime_ns))
                with self.assertRaises((ValueError, TypeError)):
                    publish_index_binding(admitted)
            self.assertEqual(registry.snapshot()["reservations"], len(entries))

    def test_exact_v2_pending_prefix_resumes_without_changing_inode_or_charge(self):
        authority, _ = self._authority()
        entries = planned_index_reservations(authority)
        key, raw, _ = entries[0]
        with fixture() as (_, namespace, registry):
            registry.reserve_many([{"indexHash": h, "bindingBytes": value, "reservedBytes": amount}
                                   for h, value, amount in entries])
            with precharged_index_shard_root(namespace, registry, authority, key) as admitted:
                pending = admitted.lease.root/"binding.pending"
                pending.write_bytes(raw[:19]); pending.chmod(0o600)
                inode = pending.stat().st_ino
            with precharged_index_shard_root(namespace, registry, authority, key) as admitted:
                report = publish_index_shard_binding(admitted, authority)
                self.assertTrue(report["resumedPending"])
                self.assertEqual(report["resumedBytes"], 19)
                final = admitted.lease.root/"binding.json"
                self.assertEqual(final.read_bytes(), raw)
                self.assertEqual(final.stat().st_ino, inode)
                self.assertFalse(pending.exists())
            self.assertEqual(registry.snapshot()["reservations"], len(entries))

    def test_wrong_or_foreign_authority_and_missing_or_wrong_parent_lease_preserve_stage(self):
        authority, _ = self._authority()
        other_authority, _ = self._authority(requests=[
            {"requestHash": "7"*64, "captureInputHash": "8"*64,
             "requiredObservationSetHash": "9"*64, "requiredObservationCount": 1,
             "auditDescriptorBytes": 100},
        ])
        entries = planned_index_reservations(authority)
        key, raw, _ = entries[0]
        with fixture() as (parent, namespace, registry):
            registry.reserve_many([{"indexHash": h, "bindingBytes": value, "reservedBytes": amount}
                                   for h, value, amount in entries])
            with precharged_index_shard_root(namespace, registry, authority, key) as admitted:
                root = admitted.lease.root
                for wrong in (other_authority, object()):
                    with self.assertRaises((ValueError, TypeError)):
                        publish_index_shard_binding(admitted, wrong)
                    self.assertFalse((root/"binding.pending").exists())
                for changed in (replace(admitted, index_hash="f"*64),
                                replace(admitted, reserved_bytes=admitted.reserved_bytes-1)):
                    with self.assertRaisesRegex(ValueError, "frozen shard plan"):
                        publish_index_shard_binding(changed, authority)
                    self.assertFalse((root/"binding.pending").exists())
                with self.assertRaisesRegex(ValueError, "namespace lease"):
                    publish_index_shard_binding(replace(admitted, namespace_lease=None), authority)
                self.assertFalse((root/"binding.pending").exists())

                unrelated = parent/"unrelated-namespace"
                unrelated.mkdir(mode=0o700)
                with index_writer_lease(unrelated) as wrong_lease:
                    with self.assertRaisesRegex(ValueError, "parent namespace lease"):
                        publish_index_shard_binding(replace(admitted, namespace_lease=wrong_lease), authority)
                self.assertFalse((root/"binding.pending").exists())
                self.assertFalse((root/"binding.json").exists())
                self.assertEqual(registry.snapshot()["reservations"], len(entries))

    def test_v1_base_is_not_a_shard_publication_member(self):
        authority, base = self._authority()
        with fixture() as (_, namespace, registry):
            with charged_index_root(namespace, registry, base) as admitted:
                root = admitted.lease.root
                with self.assertRaisesRegex(ValueError, "frozen shard plan"):
                    publish_index_shard_binding(admitted, authority)
                self.assertFalse((root/"binding.pending").exists())
                self.assertFalse((root/"binding.json").exists())

    def test_namespace_lease_replacement_after_publish_prevents_success_report(self):
        authority, _ = self._authority()
        entries = planned_index_reservations(authority)
        key, raw, _ = entries[0]
        with fixture() as (_, namespace, registry):
            registry.reserve_many([{"indexHash": h, "bindingBytes": value, "reservedBytes": amount}
                                   for h, value, amount in entries])
            root = namespace.root/key
            with self.assertRaisesRegex(ValueError, "namespace lease inode changed"):
                with precharged_index_shard_root(namespace, registry, authority, key) as admitted:
                    original = binding_publish._publish_binding

                    def replace_parent_lock(*args, **kwargs):
                        report = original(*args, **kwargs)
                        lock = namespace.root/"writer.lock"
                        os.rename(lock, namespace.root/"writer.lock.saved")
                        descriptor = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                        os.close(descriptor)
                        return report

                    with patch("index_binding_publish._publish_binding", side_effect=replace_parent_lock):
                        publish_index_shard_binding(admitted, authority)
            self.assertEqual((root/"binding.json").read_bytes(), raw)
            self.assertTrue((namespace.root/"writer.lock.saved").is_file())
            self.assertEqual(registry.snapshot()["reservations"], len(entries))


if __name__ == "__main__":
    unittest.main()
