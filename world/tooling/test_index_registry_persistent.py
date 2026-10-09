"""Disposable actual registry restarts and deterministic interruption prefixes."""
from contextlib import contextmanager
import hashlib
from pathlib import Path
import os
import resource
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

import index_registry_controller as controller
from index_controller_record import decode_controller_record, encode_controller_record
from index_controller_state import RECORD,PENDING,EXECUTION,RECLAIM,read_private
import index_controller_state as state
from index_registry_startup import startup_index_namespace
from test_index_bootstrap import source_fixture,pin
from index_tooling import FILES
from index_namespace import open_index_namespace
from index_binding import decode_index_binding,encode_index_binding
from test_index_root import binding

MIB=1024*1024


class IndexRegistryPersistentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.python=Path(sys.executable).resolve(strict=True); binary=cls.python.read_bytes()
        cls.runtime={"pythonVersion":sys.version.split()[0],"sqliteVersion":sqlite3.sqlite_version,
                     "pythonBytes":len(binary),"pythonSha256":hashlib.sha256(binary).hexdigest()}

    @contextmanager
    def prepared(self):
        with source_fixture() as source,tempfile.TemporaryDirectory(prefix="allworld-persistent-fixture-") as temporary:
            root=Path(temporary).resolve(strict=True)
            namespace=root/"namespace"; namespace.mkdir(mode=0o700)
            yield namespace,source

    def run_startup(self,namespace,source,**changes):
        repository,manifest,configuration=source
        arguments={"namespace_root":namespace,"aggregate_bytes":64*MIB,"repository_root":repository,
                   "manifest_bytes":manifest,"manifest_pin":pin(manifest),"source_configuration":configuration,
                   "source_pin":pin(configuration),"python":self.python,"python_runtime":self.runtime}
        arguments.update(changes)
        return controller.restartable_registry_startup(**arguments)

    def record(self,namespace): return decode_controller_record(read_private(namespace/RECORD))

    def test_actual_initialize_reopen_without_parent_sql_preserves_charges_and_inodes(self):
        with self.prepared() as (namespace,source),patch("sqlite3.connect",side_effect=AssertionError("parent SQL forbidden")):
            initial=self.run_startup(namespace,source)
            inode=(namespace/"reservations.sqlite").stat().st_ino; lock=(namespace/"writer.lock").stat().st_ino
            reopened=self.run_startup(namespace,source)
            self.assertFalse(initial["registry"]["replayed"]); self.assertTrue(reopened["registry"]["replayed"])
            self.assertEqual(reopened["controller"]["attempts"],2)
            self.assertEqual(reopened["controller"]["reservedWallSeconds"],30)
            self.assertEqual(reopened["registry"]["stats"]["reservations"],0)
            self.assertEqual((namespace/"reservations.sqlite").stat().st_ino,inode)
            self.assertEqual((namespace/"writer.lock").stat().st_ino,lock)
            self.assertEqual([row["phase"] for row in self.record(namespace)["attempts"]],["terminal","terminal"])
            self.assertFalse((namespace/EXECUTION).exists() or (namespace/RECLAIM).exists())
            with self.assertRaisesRegex(ValueError,"persistent controller"):
                repository,manifest,configuration=source
                startup_index_namespace(namespace,64*MIB,repository,manifest,pin(manifest),configuration,
                                        pin(configuration),self.python,self.runtime)

    def test_attempt_exhaustion_preserves_record_and_database_without_new_allocation(self):
        with self.prepared() as (namespace,source):
            self.run_startup(namespace,source,attempt_limit=1)
            record=(namespace/RECORD).read_bytes(); database=(namespace/"reservations.sqlite").read_bytes()
            with patch("index_registry_controller._copy_snapshot") as allocate:
                with self.assertRaisesRegex(ValueError,"exhausted"):
                    self.run_startup(namespace,source,attempt_limit=1)
                allocate.assert_not_called()
            self.assertEqual((namespace/RECORD).read_bytes(),record)
            self.assertEqual((namespace/"reservations.sqlite").read_bytes(),database)

    def test_initial_ready_and_terminal_pending_prefixes_resume_without_refunds(self):
        for interruption in [1,2,3]:
            with self.subTest(interruption=interruption),self.prepared() as (namespace,source):
                original=controller.publish; calls=[]
                def publish(root,value):
                    calls.append(value)
                    if len(calls)==interruption:
                        path=root/PENDING
                        descriptor=os.open(path,os.O_CREAT | os.O_EXCL | os.O_WRONLY,0o600)
                        try: os.write(descriptor,encode_controller_record(value)[:91]); os.fsync(descriptor)
                        finally: os.close(descriptor)
                        raise RuntimeError("injected partial controller publication")
                    return original(root,value)
                with patch("index_registry_controller.publish",side_effect=publish):
                    with self.assertRaisesRegex(RuntimeError,"partial controller"):
                        self.run_startup(namespace,source)
                result=self.run_startup(namespace,source)
                self.assertEqual(result["controller"]["attempts"],2 if interruption==3 else 1)
                self.assertFalse((namespace/PENDING).exists())

    def test_partial_snapshot_copy_resumes_the_same_prelaunch_attempt(self):
        with self.prepared() as (namespace,source):
            def partial(root,repository,*args):
                execution=root/EXECUTION; execution.mkdir(mode=0o700)
                file=execution/FILES[0]; file.parent.mkdir(mode=0o700,parents=True)
                raw=(repository/FILES[0]).read_bytes()
                descriptor=os.open(file,os.O_CREAT | os.O_EXCL | os.O_WRONLY,0o600)
                try: os.write(descriptor,raw[:37]); os.fsync(descriptor)
                finally: os.close(descriptor)
                raise RuntimeError("injected partial snapshot copy")
            with patch("index_registry_controller._copy_snapshot",side_effect=partial):
                with self.assertRaisesRegex(RuntimeError,"partial snapshot"):
                    self.run_startup(namespace,source)
            result=self.run_startup(namespace,source)
            self.assertEqual(result["controller"]["attempts"],1)

    def test_interrupted_reclaim_reverifies_remaining_subset_and_finishes(self):
        with self.prepared() as (namespace,source):
            def partial(path):
                self.assertEqual(path,namespace/RECLAIM)
                (path/FILES[0]).unlink()
                raise RuntimeError("injected partial reclaim")
            with patch("index_registry_controller.shutil.rmtree",side_effect=partial):
                with self.assertRaisesRegex(RuntimeError,"partial reclaim"):
                    self.run_startup(namespace,source)
            self.assertEqual(self.record(namespace)["attempts"][-1]["phase"],"terminal")
            result=self.run_startup(namespace,source)
            self.assertEqual(result["controller"]["attempts"],2)
            self.assertFalse((namespace/RECLAIM).exists())

    def test_changed_immutable_limits_refuse_without_refunding_or_mutating(self):
        with self.prepared() as (namespace,source):
            self.run_startup(namespace,source)
            before=(namespace/RECORD).read_bytes()
            for change in [{"attempt_limit":15},{"wall_seconds":14},{"rss_limit_bytes":97*MIB}]:
                with self.assertRaisesRegex(ValueError,"binding changed"):
                    self.run_startup(namespace,source,**change)
                self.assertEqual((namespace/RECORD).read_bytes(),before)

    def test_initialized_registry_witness_refuses_missing_or_replaced_ledger(self):
        for loss in ["database","both","replaced"]:
            with self.subTest(loss=loss),self.prepared() as (namespace,source):
                self.run_startup(namespace,source)
                before=(namespace/RECORD).read_bytes(); witness=(namespace/state.REGISTRY).read_bytes()
                database=namespace/"reservations.sqlite"
                if loss=="replaced":
                    replacement=namespace/"fixture-replacement"
                    replacement.write_bytes(database.read_bytes()); replacement.chmod(0o600)
                    os.replace(replacement,database)
                else:
                    database.unlink()
                    if loss=="both": (namespace/"namespace.json").unlink()
                with patch("index_registry_controller._copy_snapshot") as allocate:
                    with self.assertRaises(ValueError): self.run_startup(namespace,source)
                    allocate.assert_not_called()
                self.assertEqual((namespace/RECORD).read_bytes(),before)
                self.assertEqual((namespace/state.REGISTRY).read_bytes(),witness)
                if loss!="replaced": self.assertFalse(database.exists())

    def test_real_prior_reservation_survives_restart_and_missing_ledger_cannot_reset_it(self):
        with self.prepared() as (namespace,source):
            self.run_startup(namespace,source)
            saved=resource.getrlimit(resource.RLIMIT_FSIZE)
            soft=min([4*MIB]+[v for v in saved if v!=resource.RLIM_INFINITY])
            resource.setrlimit(resource.RLIMIT_FSIZE,(soft,saved[1]))
            try:
                with open_index_namespace(namespace,64*MIB) as opened:
                    value=decode_index_binding(binding())
                    value["engineLimits"]["databaseBytes"]=65536
                    value["processLimits"]["fileBytes"]=65536
                    value["reservedBytes"]=65536
                    raw=encode_index_binding(value); key=hashlib.sha256(raw).hexdigest()
                    opened.registry.reserve(key,raw,65536)
                    # Charge-before-create interruption: no child directory yet.
            finally: resource.setrlimit(resource.RLIMIT_FSIZE,saved)
            reopened=self.run_startup(namespace,source)
            self.assertEqual(reopened["registry"]["stats"]["reservations"],1)
            self.assertEqual(reopened["registry"]["stats"]["heldBytes"],65536)
            record=(namespace/RECORD).read_bytes()
            (namespace/"reservations.sqlite").unlink(); (namespace/"namespace.json").unlink()
            with self.assertRaisesRegex(ValueError,"disappeared"):
                self.run_startup(namespace,source)
            self.assertFalse((namespace/"reservations.sqlite").exists())
            self.assertEqual((namespace/RECORD).read_bytes(),record)

    def test_partial_initialized_witness_prefix_resumes_and_keeps_interrupted_charge(self):
        with self.prepared() as (namespace,source):
            native=state._publish_bytes
            def partial(root,raw,final,pending,maximum):
                if final==state.REGISTRY:
                    path=root/pending; path.write_bytes(raw[:63]); path.chmod(0o600)
                    raise RuntimeError("injected registry witness prefix")
                return native(root,raw,final,pending,maximum)
            with patch("index_controller_state._publish_bytes",side_effect=partial):
                with self.assertRaisesRegex(RuntimeError,"witness prefix"):
                    self.run_startup(namespace,source)
            result=self.run_startup(namespace,source)
            self.assertEqual(result["controller"]["attempts"],2)
            self.assertFalse((namespace/state.REGISTRY_PENDING).exists())
            self.assertTrue((namespace/state.REGISTRY).exists())

    def test_lost_attempt_record_or_success_witness_never_resets_existing_quota(self):
        for loss in ["attempts","witness"]:
            with self.subTest(loss=loss),self.prepared() as (namespace,source):
                self.run_startup(namespace,source)
                database=(namespace/"reservations.sqlite").read_bytes()
                path=namespace/(RECORD if loss=="attempts" else state.REGISTRY); path.unlink()
                with patch("index_registry_controller._copy_snapshot") as allocate:
                    with self.assertRaisesRegex(ValueError,"disappeared"):
                        self.run_startup(namespace,source)
                    allocate.assert_not_called()
                self.assertFalse(path.exists())
                self.assertEqual((namespace/"reservations.sqlite").read_bytes(),database)

    def test_short_witness_prefix_cannot_anchor_a_replacement_inode(self):
        with self.prepared() as (namespace,source):
            native=state._publish_bytes
            def partial(root,raw,final,pending,maximum):
                if final==state.REGISTRY:
                    path=root/pending; path.write_bytes(raw[:8]); path.chmod(0o600)
                    raise RuntimeError("injected identity-free witness prefix")
                return native(root,raw,final,pending,maximum)
            with patch("index_controller_state._publish_bytes",side_effect=partial):
                with self.assertRaises(RuntimeError): self.run_startup(namespace,source)
            database=namespace/"reservations.sqlite"; replacement=namespace/"fixture-replacement"
            replacement.write_bytes(database.read_bytes()); replacement.chmod(0o600); os.replace(replacement,database)
            before=(namespace/RECORD).read_bytes(); pending=(namespace/state.REGISTRY_PENDING).read_bytes()
            with self.assertRaisesRegex(ValueError,"witness differs"):
                self.run_startup(namespace,source)
            self.assertEqual((namespace/RECORD).read_bytes(),before)
            self.assertEqual((namespace/state.REGISTRY_PENDING).read_bytes(),pending)
            self.assertFalse((namespace/state.REGISTRY).exists())

    def test_corrupt_retained_snapshot_is_preserved_and_never_reclaimed(self):
        with self.prepared() as (namespace,source):
            with patch("index_registry_controller.startup_index_namespace",side_effect=RuntimeError("fixture before launch")):
                with self.assertRaises(RuntimeError): self.run_startup(namespace,source)
            file=namespace/EXECUTION/FILES[0]; file.chmod(0o600); file.write_bytes(b"foreign"); file.chmod(0o400)
            with self.assertRaises(ValueError): self.run_startup(namespace,source)
            self.assertEqual(file.read_bytes(),b"foreign")
            self.assertEqual(len(self.record(namespace)["attempts"]),1)


if __name__=="__main__": unittest.main()
