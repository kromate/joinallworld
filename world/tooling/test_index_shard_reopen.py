"""Actual no-attempt V3 registry verification across caller lease windows."""
import hashlib
import json
import os
import sqlite3
import shutil
import unittest
from unittest.mock import patch

import index_registry_controller as controller
import test_index_admission as admission_fixture
from index_controller_state import RECORD, REGISTRY
from index_controller_record import decode_controller_record
from index_binding import decode_index_binding, encode_index_binding
from index_root import prepare_index_shard_plan_authority, planned_index_reservations
from index_writer_lock import index_writer_lease
from test_index_registry_worker import planner_fixture

MIB = 1024*1024


class IndexShardReopenTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        admission_fixture.IndexAdmissionTests.setUpClass.__func__(cls)

    bound = admission_fixture.IndexAdmissionTests.bound
    prepared = admission_fixture.IndexAdmissionTests.prepared

    def arguments(self, namespace, source):
        args=admission_fixture.IndexAdmissionTests.arguments(self,namespace,source,aggregate_bytes=128*MIB)
        base=args.pop("binding_bytes")
        raw,pin,_,_=planner_fixture(base,{"aggregateBytes":128*MIB,"maxCaptures":1})
        args.update(_binding_bytes=base,_plan_input={"raw":raw,"pin":pin})
        return args

    def expected(self, namespace, admitted):
        return {"controllerRecordSha256":admitted["controller"]["recordSha256"],
            "registryAnchorSha256":hashlib.sha256((namespace/REGISTRY).read_bytes()).hexdigest(),
            "shardAdmission":admitted["registry"]["shardAdmission"]}

    def state(self, namespace, args):
        authority=prepare_index_shard_plan_authority(args["_plan_input"]["raw"],
            args["_plan_input"]["pin"],args["_binding_bytes"])
        names=["controller.json","controller.registry.json","namespace.json","writer.lock","reservations.sqlite"]
        fixed={name:((namespace/name).read_bytes() if name!="writer.lock" else None,
            ((namespace/name).stat().st_dev,(namespace/name).stat().st_ino,(namespace/name).stat().st_size,
             (namespace/name).stat().st_mtime_ns,(namespace/name).stat().st_ctime_ns)) for name in names}
        children={key:((namespace/key).stat().st_dev,(namespace/key).stat().st_ino,
            (namespace/key/"writer.lock").stat().st_dev,(namespace/key/"writer.lock").stat().st_ino,
            (namespace/key/"binding.json").read_bytes()) for key,_,_ in planned_index_reservations(authority)}
        return fixed,children

    def verify(self, namespace, args, lease, expected):
        return controller.verify_terminal_shard_admission(**args,_inherited_lease=lease,_expected=expected)

    def test_actual_plan_pipe_rejects_changed_nonblocking_flags(self):
        from index_admission_input import create_plan_pipe, verify_plan_parent_pipes
        with self.prepared() as (namespace,source), index_writer_lease(namespace) as lease:
            state=create_plan_pipe(lease.descriptor)
            descriptors=[state.readChild,state.writeParent,state.readParent,state.writeChild]
            try:
                verify_plan_parent_pipes(state)
                os.set_blocking(state.writeParent,True)
                with self.assertRaisesRegex(ValueError,"pipe changed"):
                    verify_plan_parent_pipes(state)
                os.set_blocking(state.writeParent,False)
                verify_plan_parent_pipes(state)
                self.assertEqual({entry.name for entry in namespace.iterdir()},{"writer.lock"})
            finally:
                for descriptor in descriptors: os.close(descriptor)

    def test_two_windows_reopen_same_terminal_batch_without_parent_sql_or_attempts(self):
        with self.prepared() as (namespace,source):
            args=self.arguments(namespace,source)
            with index_writer_lease(namespace) as lease:
                admitted=controller.restartable_registry_startup(**args,_inherited_lease=lease)
            expected=self.expected(namespace,admitted); before=self.state(namespace,args)
            record=(namespace/RECORD).read_bytes(); anchor=(namespace/REGISTRY).read_bytes()
            for _ in range(2):
                with index_writer_lease(namespace) as lease, patch(
                        "sqlite3.connect",side_effect=AssertionError("parent SQL is forbidden")):
                    reopened=self.verify(namespace,args,lease,expected)
                    self.assertTrue(reopened["controller"]["reopened"])
                    self.assertEqual(reopened["controller"]["attempts"],1)
                    children=self.state(namespace,args)[1]
                    identities=[{"indexHash":key,"rootDevice":value[0],"rootInode":value[1],
                        "lockDevice":value[2],"lockInode":value[3]} for key,value in sorted(children.items())]
                    summary=json.loads(reopened["_shardHandoff"].summary)
                    self.assertEqual(summary,expected["shardAdmission"])
                    identity_bytes=json.dumps(identities,sort_keys=True,separators=(",",":"),
                        ensure_ascii=True).encode("ascii")
                    self.assertEqual(summary["rootIdentitySha256"],
                        hashlib.sha256(identity_bytes).hexdigest())
                self.assertEqual((namespace/RECORD).read_bytes(),record)
                self.assertEqual((namespace/REGISTRY).read_bytes(),anchor)
                self.assertEqual(self.state(namespace,args),before)
            self.assertEqual(len(decode_controller_record(record)["attempts"]),1)

    def test_wrong_receipt_plan_or_unsettled_slot_refuses_before_fixed_worker(self):
        with self.prepared() as (namespace,source):
            args=self.arguments(namespace,source)
            with index_writer_lease(namespace) as lease:
                admitted=controller.restartable_registry_startup(**args,_inherited_lease=lease)
            expected=self.expected(namespace,admitted); before=self.state(namespace,args)
            bad=dict(expected,controllerRecordSha256="0"*64)
            with index_writer_lease(namespace) as lease, patch(
                    "index_registry_startup.verify_index_shard_namespace",
                    side_effect=AssertionError("fixed worker must not launch")):
                with self.assertRaisesRegex(ValueError,"receipt"):
                    self.verify(namespace,args,lease,bad)
            raw,pin,_,_=planner_fixture(args["_binding_bytes"],
                {"aggregateBytes":128*MIB,"maxCaptures":2})
            changed=dict(args,_plan_input={"raw":raw,"pin":pin})
            with index_writer_lease(namespace) as lease, patch(
                    "index_registry_startup.verify_index_shard_namespace",
                    side_effect=AssertionError("fixed worker must not launch")):
                with self.assertRaisesRegex(ValueError,"header|receipt"):
                    self.verify(namespace,changed,lease,expected)
            base_value=decode_index_binding(args["_binding_bytes"])
            base_value["engineLimits"]["observations"]+=1
            foreign_base=encode_index_binding(base_value)
            changed_base=dict(args,_binding_bytes=foreign_base)
            with index_writer_lease(namespace) as lease, patch(
                    "index_registry_startup.verify_index_shard_namespace",
                    side_effect=AssertionError("fixed worker must not launch")):
                with self.assertRaises(ValueError):
                    self.verify(namespace,changed_base,lease,expected)
            for field,value in (("cpu_seconds",11),("wall_seconds",14),
                                ("rss_limit_bytes",97*MIB),("attempt_limit",15)):
                changed_limits=dict(args,**{field:value})
                with self.subTest(field=field), index_writer_lease(namespace) as lease, patch(
                        "index_registry_startup.verify_index_shard_namespace",
                        side_effect=AssertionError("fixed worker must not launch")):
                    with self.assertRaises(ValueError):
                        self.verify(namespace,changed_limits,lease,expected)
            for field,value in (("manifest_pin",dict(args["manifest_pin"],sha256="f"*64)),
                                ("source_pin",dict(args["source_pin"],sha256="e"*64)),
                                ("python_runtime",dict(args["python_runtime"],sqliteVersion="3.50.5"))):
                changed_pin=dict(args,**{field:value})
                with self.subTest(field=field), index_writer_lease(namespace) as lease, patch(
                        "index_registry_startup.verify_index_shard_namespace",
                        side_effect=AssertionError("fixed worker must not launch")):
                    with self.assertRaises(ValueError): self.verify(namespace,changed_pin,lease,expected)
            pending=namespace/"controller.pending"; pending.write_bytes(b"unsettled"); pending.chmod(0o600)
            try:
                with index_writer_lease(namespace) as lease, patch(
                        "index_registry_startup.verify_index_shard_namespace",
                        side_effect=AssertionError("fixed worker must not launch")):
                    with self.assertRaisesRegex(ValueError,"unsettled"):
                        self.verify(namespace,args,lease,expected)
            finally: pending.unlink()
            self.assertEqual(self.state(namespace,args),before)

    def test_failed_latest_settlement_and_database_sidecar_are_refused(self):
        with self.prepared() as (namespace,source):
            args=self.arguments(namespace,source)
            with index_writer_lease(namespace) as lease:
                admitted=controller.restartable_registry_startup(**args,_inherited_lease=lease)
            expected=self.expected(namespace,admitted); record_path=namespace/RECORD
            original=record_path.read_bytes(); failed=decode_controller_record(original)
            prepared=decode_controller_record(original)
            prepared["attempts"][-1].update(phase="prepared",workerPid=None,resultSha256=None)
            from index_controller_record import settlement,encode_controller_record
            failed["attempts"][-1]["resultSha256"]=settlement(prepared)
            failed_raw=encode_controller_record(failed); record_path.write_bytes(failed_raw)
            failed_expected=dict(expected,controllerRecordSha256=hashlib.sha256(failed_raw).hexdigest())
            try:
                with index_writer_lease(namespace) as lease:
                    with self.assertRaises(RuntimeError):
                        self.verify(namespace,args,lease,failed_expected)
            finally: record_path.write_bytes(original)
            sidecar=namespace/"reservations.sqlite-wal"; sidecar.write_bytes(b""); sidecar.chmod(0o600)
            try:
                with index_writer_lease(namespace) as lease:
                    with self.assertRaises((RuntimeError,ValueError)):
                        self.verify(namespace,args,lease,expected)
            finally: sidecar.unlink(missing_ok=True)

    def test_child_binding_and_registry_anchor_replacements_are_preserved_and_refused(self):
        with self.prepared() as (namespace,source):
            args=self.arguments(namespace,source)
            with index_writer_lease(namespace) as lease:
                admitted=controller.restartable_registry_startup(**args,_inherited_lease=lease)
            expected=self.expected(namespace,admitted)
            authority=prepare_index_shard_plan_authority(args["_plan_input"]["raw"],
                args["_plan_input"]["pin"],args["_binding_bytes"])
            key=planned_index_reservations(authority)[0][0]
            binding=namespace/key/"binding.json"; original=binding.read_bytes()
            try:
                binding.write_bytes(original+b" ")
                with index_writer_lease(namespace) as lease:
                    with self.assertRaises(ValueError): self.verify(namespace,args,lease,expected)
            finally: binding.write_bytes(original)
            anchor=namespace/REGISTRY; saved=namespace.parent/"saved-controller-anchor"
            os.replace(anchor,saved)
            try:
                anchor.write_bytes(saved.read_bytes()+b" "); anchor.chmod(0o600)
                with index_writer_lease(namespace) as lease:
                    with self.assertRaises(ValueError): self.verify(namespace,args,lease,expected)
            finally:
                anchor.unlink(missing_ok=True); os.replace(saved,anchor)

    def test_child_root_and_lock_inode_replacements_are_refused(self):
        with self.prepared() as (namespace,source):
            args=self.arguments(namespace,source)
            with index_writer_lease(namespace) as lease:
                admitted=controller.restartable_registry_startup(**args,_inherited_lease=lease)
            expected=self.expected(namespace,admitted)
            authority=prepare_index_shard_plan_authority(args["_plan_input"]["raw"],
                args["_plan_input"]["pin"],args["_binding_bytes"])
            key=planned_index_reservations(authority)[0][0]
            child=namespace/key; saved=namespace.parent/"saved-shard-root"
            os.replace(child,saved)
            try:
                shutil.copytree(saved,child,copy_function=shutil.copy2)
                with index_writer_lease(namespace) as lease:
                    with self.assertRaises(ValueError): self.verify(namespace,args,lease,expected)
            finally:
                if child.exists(): shutil.rmtree(child)
                os.replace(saved,child)
            lock=child/"writer.lock"; saved_lock=namespace.parent/"saved-shard-lock"
            os.replace(lock,saved_lock)
            try:
                lock.touch(mode=0o600); lock.chmod(0o600)
                with index_writer_lease(namespace) as lease:
                    with self.assertRaises(ValueError): self.verify(namespace,args,lease,expected)
            finally:
                lock.unlink(missing_ok=True); os.replace(saved_lock,lock)

    def test_readonly_verifier_rejects_registry_rows_changed_without_changing_total(self):
        with self.prepared() as (namespace,source):
            args=self.arguments(namespace,source)
            base=args["_binding_bytes"]
            from test_index_registry_worker import planner_fixture
            requests=[{"requestHash":"1"*64,"captureInputHash":"2"*64,
                "requiredObservationSetHash":"3"*64,"requiredObservationCount":1,"auditDescriptorBytes":100},
                {"requestHash":"4"*64,"captureInputHash":"5"*64,
                "requiredObservationSetHash":"6"*64,"requiredObservationCount":1,"auditDescriptorBytes":100}]
            raw,pin,_,_=planner_fixture(base,{"aggregateBytes":128*MIB,"maxCaptures":1},requests)
            args["_plan_input"]={"raw":raw,"pin":pin}
            with index_writer_lease(namespace) as lease:
                admitted=controller.restartable_registry_startup(**args,_inherited_lease=lease)
            expected=self.expected(namespace,admitted)
            db=sqlite3.connect(namespace/"reservations.sqlite")
            try:
                rows=list(db.execute("SELECT hash,binding,reserved_bytes FROM reservations ORDER BY hash"))
                self.assertEqual(len(rows),2)
                amount=32*MIB
                import index_reservations
                digest=hashlib.sha256(f"{index_reservations.FORMAT}\n".encode("ascii"))
                for row,new_amount in zip(rows,(amount+65536,amount-65536)):
                    record_hash=index_reservations._record_hash(row[1],new_amount)
                    db.execute("UPDATE reservations SET reserved_bytes=?,record_hash=? WHERE hash=?",
                        (new_amount,record_hash,row[0]))
                    digest.update((row[0]+record_hash).encode("ascii"))
                db.execute("UPDATE meta SET value=? WHERE key='records_digest'",(digest.hexdigest(),))
                db.commit(); db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            finally: db.close()
            for suffix in ("-wal","-shm","-journal"):
                self.assertFalse((namespace/"reservations.sqlite").with_name("reservations.sqlite"+suffix).exists())
            with index_writer_lease(namespace) as lease:
                with self.assertRaises((RuntimeError,ValueError)):
                    self.verify(namespace,args,lease,expected)


if __name__ == "__main__": unittest.main()
