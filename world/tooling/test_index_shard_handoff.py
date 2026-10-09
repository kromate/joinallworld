"""Actual, reaped batch handoff into one V2 child without parent registry SQL."""
import dataclasses
import os
import shutil
import unittest
from unittest.mock import patch

import test_index_admission as admission_fixture
from index_namespace import open_admitted_shard
from index_registry_controller import restartable_registry_startup
from index_controller_record import decode_controller_record
from index_controller_state import RECORD
from index_root import prepare_index_shard_plan_authority
from index_writer_lock import IndexWriterBusy, index_writer_lease
from test_index_registry_worker import planner_fixture


class IndexShardHandoffTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        admission_fixture.IndexAdmissionTests.setUpClass.__func__(cls)

    prepared = admission_fixture.IndexAdmissionTests.prepared
    arguments = admission_fixture.IndexAdmissionTests.arguments
    bound = admission_fixture.IndexAdmissionTests.bound

    def planned(self, namespace, source):
        args = self.arguments(namespace, source, aggregate_bytes=128*1024*1024)
        base = args.pop("binding_bytes")
        raw, pin, _, _ = planner_fixture(base, {"aggregateBytes":128*1024*1024,"maxCaptures":1})
        args.update(_binding_bytes=base, _plan_input={"raw":raw,"pin":pin})
        authority = prepare_index_shard_plan_authority(raw, pin, base)
        return args, authority

    def test_real_reaped_batch_allows_sequential_children_under_exact_inherited_lease(self):
        with self.prepared() as (namespace, source):
            args, authority = self.planned(namespace, source)
            with patch("sqlite3.connect", side_effect=AssertionError("parent registry SQL forbidden")):
                with index_writer_lease(namespace) as lease:
                    response = restartable_registry_startup(**args, _inherited_lease=lease)
                    handoff = response["_shardHandoff"]
                    actual_authority = handoff.authority
                    self.assertEqual(actual_authority.reservations, authority.reservations)
                    self.assertEqual(handoff.record_sha256, response["controller"]["recordSha256"])
                    record_before = (namespace/RECORD).read_bytes()
                    for key, _, _ in actual_authority.reservations:
                        with open_admitted_shard(handoff, lease, actual_authority, key) as child:
                            self.assertEqual(child.index_hash, key)
                            self.assertIs(child.namespace_lease, lease)
                    self.assertEqual((namespace/RECORD).read_bytes(), record_before)
                    self.assertEqual(len(decode_controller_record(record_before)["attempts"]), 1)
            with self.assertRaises((OSError, ValueError, TypeError)):
                with open_admitted_shard(handoff, lease, handoff.authority, handoff.authority.reservations[0][0]):
                    self.fail("closed namespace lease must not reopen a shard")

    def test_default_closed_controller_lease_never_returns_usable_handoff(self):
        with self.prepared() as (namespace, source):
            args, authority = self.planned(namespace, source)
            response = restartable_registry_startup(**args)
            self.assertNotIn("_shardHandoff", response)
            self.assertEqual(len(authority.reservations), 2)

    def test_changed_record_foreign_child_and_busy_child_are_refused(self):
        with self.prepared() as (namespace, source):
            args, authority = self.planned(namespace, source)
            with index_writer_lease(namespace) as lease:
                response = restartable_registry_startup(**args, _inherited_lease=lease)
                handoff = response["_shardHandoff"]
                actual_authority = handoff.authority
                changed = dataclasses.replace(handoff, record_sha256="0"*64)
                with self.assertRaises(TypeError):
                    with open_admitted_shard(changed, lease, actual_authority, actual_authority.reservations[0][0]):
                        pass
                with self.assertRaisesRegex(ValueError, "not in the settled immutable plan"):
                    with open_admitted_shard(handoff, lease, actual_authority, "f"*64):
                        pass
                child = namespace/actual_authority.reservations[0][0]
                with index_writer_lease(child):
                    with self.assertRaises(IndexWriterBusy):
                        with open_admitted_shard(handoff, lease, actual_authority, actual_authority.reservations[0][0]):
                            pass
                with self.assertRaises(TypeError):
                    with open_admitted_shard({}, lease, actual_authority, actual_authority.reservations[0][0]):
                        pass

    def test_durable_record_namespace_and_database_identity_changes_are_refused(self):
        with self.prepared() as (namespace, source):
            args, _ = self.planned(namespace, source)
            with index_writer_lease(namespace) as lease:
                response = restartable_registry_startup(**args, _inherited_lease=lease)
                handoff = response["_shardHandoff"]; authority = handoff.authority
                path = namespace/"controller.json"; original = path.read_bytes()
                try:
                    path.write_bytes(original+b"x")
                    with self.assertRaises(ValueError):
                        with open_admitted_shard(handoff, lease, authority, authority.reservations[0][0]):
                            pass
                finally: path.write_bytes(original)
                path = namespace/"namespace.json"; saved = namespace.parent/"namespace.saved"
                original = path.read_bytes(); os.replace(path, saved)
                try:
                    path.write_bytes(original+b"x"); path.chmod(0o600)
                    with self.assertRaises(ValueError):
                        with open_admitted_shard(handoff, lease, authority, authority.reservations[0][0]):
                            pass
                finally:
                    path.unlink(missing_ok=True); os.replace(saved, path)
                database = namespace/"reservations.sqlite"; backup = namespace.parent/"registry.saved"
                os.replace(database, backup)
                try:
                    shutil.copyfile(backup, database); database.chmod(0o600)
                    with self.assertRaises(ValueError):
                        with open_admitted_shard(handoff, lease, authority, authority.reservations[0][0]):
                            pass
                finally:
                    database.unlink(missing_ok=True); os.replace(backup, database)

    def test_unreaped_worker_exception_and_handle_are_not_masked_by_final_checks(self):
        with self.prepared() as (namespace, source):
            args, authority = self.planned(namespace, source)
            with index_writer_lease(namespace) as lease:
                response = restartable_registry_startup(**args, _inherited_lease=lease)
                handoff = response["_shardHandoff"]
                actual_authority = handoff.authority
                class Unreaped(RuntimeError): pass
                failure = Unreaped("worker terminal state is unknown")
                failure.worker_handle = object()
                with self.assertRaises(Unreaped) as caught:
                    with open_admitted_shard(handoff, lease, actual_authority, actual_authority.reservations[0][0]):
                        (namespace/"controller.json").write_bytes(b"changed")
                        raise failure
                self.assertIs(caught.exception, failure)
                self.assertIs(caught.exception.worker_handle, failure.worker_handle)

    def test_child_binding_root_and_lock_replacements_are_refused(self):
        with self.prepared() as (namespace, source):
            args, _ = self.planned(namespace, source)
            with index_writer_lease(namespace) as lease:
                response = restartable_registry_startup(**args, _inherited_lease=lease)
                handoff = response["_shardHandoff"]; authority = handoff.authority
                child = namespace/authority.reservations[0][0]
                binding = child/"binding.json"; original_binding = binding.read_bytes()
                try:
                    binding.write_bytes(original_binding+b"x")
                    with self.assertRaises(ValueError):
                        with open_admitted_shard(handoff, lease, authority, authority.reservations[0][0]):
                            pass
                finally: binding.write_bytes(original_binding)
                lock = child/"writer.lock"; saved_lock = namespace.parent/"child-lock.saved"
                os.replace(lock, saved_lock)
                try:
                    descriptor = os.open(lock, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600); os.close(descriptor)
                    with self.assertRaises(ValueError):
                        with open_admitted_shard(handoff, lease, authority, authority.reservations[0][0]):
                            pass
                finally:
                    lock.unlink(missing_ok=True); os.replace(saved_lock, lock)
                saved_root = namespace.parent/"child-root.saved"
                os.replace(child, saved_root)
                try:
                    child.mkdir(mode=0o700)
                    descriptor = os.open(child/"writer.lock", os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
                    os.close(descriptor)
                    with self.assertRaises((OSError, ValueError)):
                        with open_admitted_shard(handoff, lease, authority, authority.reservations[0][0]):
                            pass
                finally:
                    shutil.rmtree(child, ignore_errors=True); os.replace(saved_root, child)


if __name__ == "__main__": unittest.main()
