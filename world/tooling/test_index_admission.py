"""Actual supervised admission + retained capture ingestion; parent SQLite forbidden."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import resource
import select
import shutil
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from index_admission import supervised_charged_index
import index_admission_worker
from index_binding import decode_index_binding, encode_index_binding
from index_controller_record import decode_controller_record, FORMAT, FORMAT_V2
from index_controller_state import RECORD, EXECUTION
from index_ingest import ingest_index
from index_registry_controller import restartable_registry_startup
from index_resource_limits import _run_fixed_process
from index_writer_lock import index_writer_lease, IndexWriterBusy
import test_index_bootstrap as bootstrap_fixture
from test_index_ingest import inputs
from test_index_registry_controller import owned_worker_live, wait_terminal

MIB = 1024*1024
pin = bootstrap_fixture.pin


class IndexAdmissionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        bootstrap_fixture.IndexBootstrapTests.setUpClass.__func__(cls)
        cls.python = Path(sys.executable).resolve(strict=True); binary = cls.python.read_bytes()
        cls.python_runtime = {"pythonVersion":sys.version.split()[0], "sqliteVersion":sqlite3.sqlite_version,
                              "pythonBytes":len(binary), "pythonSha256":hashlib.sha256(binary).hexdigest()}

    bound = bootstrap_fixture.IndexBootstrapTests.bound

    @contextmanager
    def prepared(self):
        with bootstrap_fixture.source_fixture() as source, tempfile.TemporaryDirectory(prefix="allworld-admission-fixture-") as temporary:
            namespace = Path(temporary).resolve(strict=True)/"namespace"; namespace.mkdir(mode=0o700)
            yield namespace, source

    def arguments(self, namespace, source, binding_bytes=None, **changes):
        repository, manifest, config = source
        result = dict(namespace_root=namespace, aggregate_bytes=64*MIB, repository_root=repository,
            manifest_bytes=manifest, manifest_pin=pin(manifest), source_configuration=config, source_pin=pin(config),
            python=self.python, python_runtime=self.python_runtime,
            binding_bytes=self.bound(manifest, config) if binding_bytes is None else binding_bytes)
        result.update(changes); return result

    def record(self, namespace): return decode_controller_record((namespace/RECORD).read_bytes())

    def test_crash_worker_accepts_only_exact_fixed_boundary_arguments(self):
        for argv in (["index_admission_worker.py", "--crash"],
                     ["index_admission_worker.py", "--crash", "reserved", "extra"],
                     ["index_admission_worker.py", "--crash", "foreign"]):
            with self.subTest(argv=argv), patch.object(index_admission_worker.sys, "argv", list(argv)), \
                    patch.object(index_admission_worker, "_runtime_environment",
                                 side_effect=AssertionError("invalid CLI reached runtime setup")):
                with self.assertRaisesRegex(ValueError, "fixed boundary"):
                    index_admission_worker.main()

    def test_actual_admission_ingestion_and_reopen_never_open_parent_sql(self):
        with self.prepared() as (namespace, source), patch("sqlite3.connect", side_effect=AssertionError("parent SQL forbidden")):
            arguments = self.arguments(namespace, source); retained = inputs(); receipts = []
            for iteration in range(2):
                with supervised_charged_index(**arguments) as (admitted, admission):
                    receipts.append(admission)
                    self.assertEqual(admitted.replayed_reservation, iteration == 1)
                    for item in retained:
                        result = ingest_index(admitted, source[0], source[1], source[2], self.node, *item)
                        self.assertEqual(result["ingest"]["result"]["replayed"], iteration == 1)
                    self.assertEqual(result["ingest"]["stats"], {"captures":2,"occurrences":2283,"versions":1810,
                        "observations":0,"keys":1810,"conflictedKeys":0})
                    final = admitted.lease.root/"features.sqlite"
                    if iteration == 0:
                        inode = final.stat().st_ino; child_lock = admitted.lease.inode
                        registry_inode = (namespace/"reservations.sqlite").stat().st_ino
                    self.assertEqual(final.stat().st_ino, inode); self.assertEqual(admitted.lease.inode, child_lock)
                    self.assertEqual((namespace/"reservations.sqlite").stat().st_ino, registry_inode)
                    for root in [namespace, admitted.lease.root]:
                        with self.assertRaises(IndexWriterBusy), index_writer_lease(root):
                            self.fail("supervised handoff released a permanent writer lease")
                    self.assertEqual(admission["registry"]["stats"]["reservations"], 1)
                    self.assertEqual(admission["registry"]["stats"]["heldBytes"], admitted.reserved_bytes)
                    self.assertTrue(admission["guard"]["inheritedNamespaceLease"])
                self.assertFalse((namespace/EXECUTION).exists())
            self.assertEqual(self.record(namespace)["format"], FORMAT_V2)
            self.assertEqual(receipts[-1]["controller"]["attempts"], 2)
            self.assertEqual(receipts[-1]["controller"]["reservedWallSeconds"], 30)
            self.assertTrue(all(row["phase"] == "terminal" and row["operation"]["kind"] == "admit"
                                for row in self.record(namespace)["attempts"]))

    def test_actual_charge_before_mkdir_and_binding_published_crashes_resume_one_charge(self):
        for boundary in ["reserved", "binding-published"]:
            with self.subTest(boundary=boundary), self.prepared() as (namespace, source), patch(
                    "sqlite3.connect", side_effect=AssertionError("parent SQL forbidden")):
                arguments = self.arguments(namespace, source); observed = []
                index_hash = hashlib.sha256(arguments["binding_bytes"]).hexdigest(); child = namespace/index_hash
                def crash(node, worker, root, **kwargs):
                    result = _run_fixed_process(node, "index-registry-admit-crash", root, case=boundary, **kwargs)
                    observed.append(result); return result
                with patch("index_registry_startup._run_fixed_process", side_effect=crash):
                    with self.assertRaisesRegex(RuntimeError, "fixed registry worker failed"):
                        with supervised_charged_index(**arguments): self.fail("crash returned admission")
                self.assertEqual(observed[0]["terminationSignal"], "SIGKILL")
                self.assertFalse(observed[0]["stdout"])
                self.assertEqual(child.exists(), boundary == "binding-published")
                self.assertEqual(self.record(namespace)["attempts"][-1]["phase"], "prepared")
                if child.exists(): old_child_inode = child.stat().st_ino
                with supervised_charged_index(**arguments) as (admitted, report):
                    self.assertTrue(admitted.replayed_reservation)
                    self.assertEqual(report["registry"]["stats"]["reservations"], 1)
                    self.assertEqual(report["controller"]["attempts"], 2)
                    self.assertEqual(report["controller"]["reconciledInterruptedAttempts"], 1)
                    if boundary == "binding-published": self.assertEqual(admitted.lease.root.stat().st_ino, old_child_inode)
                    ingested = ingest_index(admitted, source[0], source[1], source[2], self.node, *inputs()[0])
                    self.assertEqual(ingested["ingest"]["stats"]["occurrences"], 473)

    def test_two_distinct_admissions_preserve_operation_pins_and_both_charges(self):
        with self.prepared() as (namespace, source), patch("sqlite3.connect", side_effect=AssertionError("parent SQL forbidden")):
            raw = self.arguments(namespace, source)["binding_bytes"]
            second = decode_index_binding(raw); second["engineLimits"]["observations"] = 8
            bindings = [raw, encode_index_binding(second)]
            for number, binding in enumerate(bindings, 1):
                with supervised_charged_index(**self.arguments(namespace, source, binding, aggregate_bytes=96*MIB)) as (_, report):
                    self.assertEqual(report["registry"]["stats"]["reservations"], number)
                    self.assertEqual(report["registry"]["stats"]["heldBytes"], number*32*MIB)
            self.assertEqual([row["operation"]["binding"] for row in self.record(namespace)["attempts"]],
                             [pin(binding) for binding in bindings])

    def test_v1_namespace_is_preserved_without_implicit_controller_migration(self):
        with self.prepared() as (namespace, source):
            arguments = self.arguments(namespace, source); arguments.pop("binding_bytes")
            restartable_registry_startup(**arguments)
            before = {name:(namespace/name).read_bytes() for name in [RECORD,"reservations.sqlite","namespace.json"]}
            with patch("sqlite3.connect", side_effect=AssertionError("parent SQL forbidden")):
                with self.assertRaisesRegex(ValueError, "controller binding changed"):
                    with supervised_charged_index(**self.arguments(namespace, source)): self.fail("implicit migration")
            self.assertEqual(self.record(namespace)["format"], FORMAT)
            self.assertEqual({name:(namespace/name).read_bytes() for name in before}, before)

    def test_invalid_binding_pins_refuse_before_lock_record_or_sql(self):
        with self.prepared() as (namespace, source):
            value = decode_index_binding(self.arguments(namespace, source)["binding_bytes"])
            value["toolingManifest"]["sha256"] = "0"*64
            with patch("index_admission.restartable_registry_startup") as run, patch("sqlite3.connect", side_effect=AssertionError("parent SQL")):
                with self.assertRaisesRegex(ValueError, "tooling/source pins"):
                    with supervised_charged_index(**self.arguments(namespace, source, encode_index_binding(value))): self.fail("bad pin")
                run.assert_not_called()
            self.assertEqual(list(namespace.iterdir()), [])

    def test_attempt_exhaustion_cannot_create_a_fresh_ledger_or_source_slot(self):
        with self.prepared() as (namespace, source), patch("sqlite3.connect", side_effect=AssertionError("parent SQL forbidden")):
            arguments = self.arguments(namespace, source, attempt_limit=1)
            with supervised_charged_index(**arguments): pass
            record = (namespace/RECORD).read_bytes(); database = (namespace/"reservations.sqlite").read_bytes()
            with patch("index_registry_controller._copy_snapshot") as allocate:
                with self.assertRaisesRegex(ValueError, "exhausted"):
                    with supervised_charged_index(**arguments): self.fail("reset exhausted attempts")
                allocate.assert_not_called()
            self.assertEqual((namespace/RECORD).read_bytes(), record)
            self.assertEqual((namespace/"reservations.sqlite").read_bytes(), database)

    def test_insufficient_aggregate_budget_leaves_no_child_and_keeps_failed_attempt(self):
        with self.prepared() as (namespace, source), patch("sqlite3.connect", side_effect=AssertionError("parent SQL forbidden")):
            arguments = self.arguments(namespace, source, aggregate_bytes=49*MIB-1)
            with self.assertRaisesRegex(RuntimeError, "namespace budget"):
                with supervised_charged_index(**arguments): self.fail("budget overrun")
            key = hashlib.sha256(arguments["binding_bytes"]).hexdigest()
            self.assertFalse((namespace/key).exists())
            self.assertEqual(len(self.record(namespace)["attempts"]), 1)
            self.assertEqual(self.record(namespace)["attempts"][-1]["phase"], "prepared")
            with self.assertRaisesRegex(ValueError, "controller binding changed|differs"):
                with supervised_charged_index(**{**arguments,"aggregate_bytes":64*MIB}): self.fail("budget reset")

    def test_missing_initialized_record_refuses_before_new_sql_or_allocation(self):
        with self.prepared() as (namespace, source), patch("sqlite3.connect", side_effect=AssertionError("parent SQL forbidden")):
            arguments = self.arguments(namespace, source)
            with supervised_charged_index(**arguments): pass
            (namespace/RECORD).unlink(); before = (namespace/"reservations.sqlite").read_bytes()
            with patch("index_registry_controller._copy_snapshot") as allocate:
                with self.assertRaisesRegex(ValueError, "attempt record disappeared"):
                    with supervised_charged_index(**arguments): self.fail("missing quota reset")
                allocate.assert_not_called()
            self.assertFalse((namespace/RECORD).exists())
            self.assertEqual((namespace/"reservations.sqlite").read_bytes(), before)

    def test_actual_controller_loss_preserves_anonymous_input_worker_and_fresh_admission(self):
        base = Path(tempfile.mkdtemp(prefix="allworld-admission-controller-loss-")).resolve(strict=True)
        namespace = base/"namespace"; namespace.mkdir(mode=0o700)
        coordinator = None; worker_pid = None; worker_script = None; terminal = False
        code = r'''
import json,os,sys
from pathlib import Path
sys.path.insert(0,str(Path(sys.argv[1])/"world/tooling"))
import index_resource_limits as guard
from index_admission import supervised_charged_index
from hashlib import sha256
manifest=bytes.fromhex(sys.argv[3]); configuration=bytes.fromhex(sys.argv[4]); runtime=json.loads(sys.argv[5]); binding=bytes.fromhex(sys.argv[6])
def pin(raw): return {"bytes":len(raw),"sha256":sha256(raw).hexdigest()}
native=guard.subprocess.Popen
def launch(command,**kwargs):
    if Path(command[-1]).name!="index_admission_worker.py": return native(command,**kwargs)
    script=command[-1]
    wrapper="import os,sys,time,runpy; os.write(1,b'ready\\n'); time.sleep(2); sys.argv=[sys.argv[1]]; runpy.run_path(sys.argv[0],run_name='__main__')"
    process=native([command[0],"-I","-B","-c",wrapper,script],**kwargs)
    import select
    if not select.select([process.stdout],[],[],3)[0] or process.stdout.readline(64)!=b"ready\n":
        raise RuntimeError("actual admission worker did not reach pause")
    os.write(1,(json.dumps({"pid":process.pid,"script":script})+"\n").encode())
    return process
guard.subprocess.Popen=launch
with supervised_charged_index(Path(sys.argv[2]),64*1024*1024,Path(sys.argv[1]),manifest,pin(manifest),configuration,pin(configuration),sys.executable,runtime,binding):
    raise RuntimeError("controller should have been killed before admission handoff")
'''
        def limits():
            resource.setrlimit(resource.RLIMIT_FSIZE,(4*MIB,4*MIB))
            resource.setrlimit(resource.RLIMIT_CPU,(5,5)); resource.setrlimit(resource.RLIMIT_CORE,(0,0))
        try:
            with bootstrap_fixture.source_fixture() as source:
                repository, manifest, configuration = source; arguments = self.arguments(namespace, source)
                coordinator = subprocess.Popen([str(self.python),"-I","-B","-c",code,str(repository),str(namespace),
                    manifest.hex(),configuration.hex(),json.dumps(self.python_runtime),arguments["binding_bytes"].hex()],
                    stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                    start_new_session=True,preexec_fn=limits)
                if not select.select([coordinator.stdout],[],[],5)[0]:
                    raise RuntimeError("admission controller did not report its actual worker")
                ready = coordinator.stdout.readline(4096)
                try: observed = json.loads(ready)
                except Exception as error:
                    if coordinator.poll() is not None:
                        _, errors = coordinator.communicate(timeout=3)
                        raise RuntimeError(f"controller failed before pause: {errors[-4096:]!r}") from error
                    raise
                worker_pid = observed["pid"]; worker_script = Path(observed["script"])
                self.assertGreater(worker_pid,2); self.assertTrue(owned_worker_live(worker_pid,worker_script))
                os.kill(coordinator.pid,signal.SIGKILL); coordinator.communicate(timeout=3)
                self.assertEqual(coordinator.returncode,-signal.SIGKILL)
                # Worker holds the namespace lease and anonymous binding despite
                # controller death. No new allocation can start in this gap.
                with patch("sqlite3.connect",side_effect=AssertionError("parent SQL forbidden")), patch(
                        "index_registry_controller._copy_snapshot") as allocate:
                    with self.assertRaises(IndexWriterBusy):
                        with supervised_charged_index(**arguments): self.fail("lost inherited namespace lease")
                    allocate.assert_not_called()
                terminal = wait_terminal(worker_pid,worker_script,seconds=5)
                if not terminal: raise RuntimeError(f"actual admission worker still live; preserve {base}")
                with patch("sqlite3.connect",side_effect=AssertionError("parent SQL forbidden")):
                    with supervised_charged_index(**arguments) as (admitted, report):
                        self.assertTrue(admitted.replayed_reservation)
                        self.assertEqual(report["registry"]["stats"]["reservations"],1)
                        self.assertEqual(report["controller"]["attempts"],2)
                        self.assertEqual(report["controller"]["reservedWallSeconds"],30)
                        result = ingest_index(admitted,repository,manifest,configuration,self.node,*inputs()[0])
                        self.assertEqual(result["ingest"]["stats"]["occurrences"],473)
        finally:
            if coordinator is not None:
                if coordinator.poll() is None:
                    os.killpg(coordinator.pid,signal.SIGKILL); coordinator.wait(timeout=3)
                for stream in [coordinator.stdout,coordinator.stderr]:
                    if stream is not None: stream.close()
            if worker_pid is None:
                # A failure before identifying a possible child is ambiguous if
                # any persistent execution was already published. Preserve it.
                terminal = not (namespace/EXECUTION).exists()
            elif not terminal:
                terminal = wait_terminal(worker_pid,worker_script,seconds=5)
            if terminal:
                with index_writer_lease(namespace): pass
                shutil.rmtree(base)
            else:
                raise RuntimeError(f"admission fixture child exit unconfirmed; preserve {base}")


if __name__ == "__main__": unittest.main()
