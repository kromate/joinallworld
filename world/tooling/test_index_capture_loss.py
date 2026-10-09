"""Native controller death during a real fixed capture worker, owned scratch only."""
import json
import os
from pathlib import Path
import resource
import select
import shutil
import signal
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from index_admission import supervised_charged_index
from index_capture_controller import ingest_capture_job
from index_capture_record import decode_capture_record
from index_capture_state import RECORD
from index_capture_snapshot import CAPTURE_EXECUTION
from index_writer_lock import IndexWriterBusy, index_writer_lease
import test_index_admission as admission_fixture
from test_index_ingest import inputs
from test_index_registry_controller import owned_worker_live, wait_terminal
import test_index_bootstrap as bootstrap_fixture

MIB = 1024*1024


class CaptureControllerLossTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): admission_fixture.IndexAdmissionTests.setUpClass.__func__(cls)
    arguments = admission_fixture.IndexAdmissionTests.arguments
    bound = admission_fixture.IndexAdmissionTests.bound

    def test_actual_controller_sigkill_retains_capture_input_and_blocks_fresh_writer(self):
        self._controller_loss("before-ingestion")

    def test_actual_controller_sigkill_after_commit_preserves_wal_and_raw_replay(self):
        self._controller_loss("after-commit")

    def _controller_loss(self, boundary):
        base = Path(tempfile.mkdtemp(prefix="allworld-capture-controller-loss-")).resolve(strict=True)
        namespace = base/"namespace"; namespace.mkdir(mode=0o700)
        coordinator = None; worker_pid = None; worker_script = None; terminal = False
        code = r'''
import json,os,sys,select
from pathlib import Path
sys.path.insert(0,str(Path(sys.argv[1])/"world/tooling"))
import index_resource_limits as guard
from index_admission import supervised_charged_index
from index_capture_controller import ingest_capture_job
from hashlib import sha256
manifest=bytes.fromhex(sys.argv[3]); configuration=bytes.fromhex(sys.argv[4]); runtime=json.loads(sys.argv[5]); binding=bytes.fromhex(sys.argv[6])
capture=json.loads(sys.argv[8])
def pin(raw): return {"bytes":len(raw),"sha256":sha256(raw).hexdigest()}
native=guard.subprocess.Popen
def launch(command,**kwargs):
    if Path(command[-1]).name!="index_ingest.ts": return native(command,**kwargs)
    script=command[-1]
    if sys.argv[9]=="after-commit":
        wrapper="const script=process.argv[1]; process.argv=[process.argv[0],'fixture-owned']; import(require('node:url').pathToFileURL(script).href).then(({ingestFeatureIndex}) => { const report=ingestFeatureIndex(boundary => { if(boundary==='after-commit') { require('node:fs').writeSync(1,'ready\\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,2000); } }); console.log(JSON.stringify(report)); });"
    else:
        wrapper="process.stdout.write('ready\\n'); setTimeout(() => { import(require('node:url').pathToFileURL(process.argv[1]).href); }, 2000)"
    process=native([*command[:-1],"-e",wrapper,script],**kwargs)
    if not select.select([process.stdout],[],[],3)[0] or process.stdout.readline(64)!=b"ready\n":
        raise RuntimeError("actual capture worker did not reach pause")
    os.write(1,(json.dumps({"pid":process.pid,"script":script})+"\n").encode())
    return process
guard.subprocess.Popen=launch
with supervised_charged_index(Path(sys.argv[2]),64*1024*1024,Path(sys.argv[1]),manifest,pin(manifest),configuration,pin(configuration),sys.executable,runtime,binding) as (admitted,report):
    ingest_capture_job(admitted,Path(sys.argv[1]),manifest,configuration,Path(sys.argv[7]),Path(capture[0]),Path(capture[1]),capture[2])
    raise RuntimeError("controller should have been killed before capture completion")
'''
        def limits():
            resource.setrlimit(resource.RLIMIT_FSIZE, (4*MIB,4*MIB))
            resource.setrlimit(resource.RLIMIT_CPU, (5,5)); resource.setrlimit(resource.RLIMIT_CORE,(0,0))
        try:
            with bootstrap_fixture.source_fixture() as source:
                repository, manifest, configuration = source; arguments = self.arguments(namespace, source)
                ep,rp,expected = inputs()[0]
                coordinator = subprocess.Popen([str(self.python),"-I","-B","-c",code,str(repository),str(namespace),
                    manifest.hex(),configuration.hex(),json.dumps(self.python_runtime),arguments["binding_bytes"].hex(),
                    str(self.node),json.dumps([str(ep),str(rp),expected]),boundary],stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,preexec_fn=limits)
                if not select.select([coordinator.stdout],[],[],5)[0]:
                    raise RuntimeError("capture controller did not report its actual worker")
                ready = coordinator.stdout.readline(4096)
                try: observed = json.loads(ready)
                except Exception as error:
                    if coordinator.poll() is not None:
                        _, errors = coordinator.communicate(timeout=3)
                        raise RuntimeError(f"controller failed before pause: {errors[-4096:]!r}") from error
                    raise
                worker_pid = observed["pid"]; worker_script = Path(observed["script"])
                self.assertTrue(owned_worker_live(worker_pid,worker_script))
                root = worker_script.parents[3]
                self.assertEqual(worker_script.parents[2].name, CAPTURE_EXECUTION)
                before = decode_capture_record((root/RECORD).read_bytes())
                self.assertEqual(before["jobs"][0]["attempts"][-1]["phase"],"prepared")
                if boundary == "after-commit":
                    self.assertGreater((root/"features.sqlite-wal").stat().st_size,0)
                snapshot_inode = (root/CAPTURE_EXECUTION).stat().st_ino
                os.kill(coordinator.pid,signal.SIGKILL); coordinator.communicate(timeout=3)
                self.assertEqual(coordinator.returncode,-signal.SIGKILL)
                with patch("sqlite3.connect",side_effect=AssertionError("parent SQL forbidden")), patch(
                        "index_capture_controller.copy_capture_snapshot") as allocate:
                    with self.assertRaises(IndexWriterBusy):
                        with supervised_charged_index(**arguments): self.fail("lost inherited namespace lease")
                    allocate.assert_not_called()
                self.assertEqual((root/CAPTURE_EXECUTION).stat().st_ino,snapshot_inode)
                terminal = wait_terminal(worker_pid,worker_script,seconds=6)
                if not terminal: raise RuntimeError(f"capture worker exit unconfirmed; preserve {base}")
                with patch("sqlite3.connect",side_effect=AssertionError("parent SQL forbidden")):
                    with supervised_charged_index(**arguments) as (admitted, admission):
                        result = ingest_capture_job(admitted,repository,manifest,configuration,self.node,ep,rp,expected)
                        self.assertEqual(result["captureController"]["attempts"],2)
                        self.assertEqual(result["captureController"]["reconciledInterruptedAttempts"],1)
                        self.assertEqual(result["ingest"]["stats"]["captures"],1)
                        self.assertEqual(result["ingest"]["stats"]["occurrences"],473)
                        if boundary == "after-commit":
                            self.assertTrue(result["ingest"]["result"]["replayed"])
                            self.assertEqual(result["ingest"]["result"]["insertedVersions"],0)
                        self.assertEqual(admission["registry"]["stats"]["reservations"],1)
                        self.assertFalse((root/CAPTURE_EXECUTION).exists())
                        after = decode_capture_record((root/RECORD).read_bytes())
                        self.assertEqual(len(after["jobs"][0]["attempts"]),2)
                        self.assertTrue(all(a["phase"]=="terminal" for a in after["jobs"][0]["attempts"]))
        finally:
            if coordinator is not None:
                if coordinator.poll() is None:
                    os.killpg(coordinator.pid,signal.SIGKILL); coordinator.wait(timeout=3)
                for stream in [coordinator.stdout,coordinator.stderr]:
                    if stream is not None: stream.close()
            if worker_pid is None:
                # Unknown possibly launched worker has no ownership proof.
                terminal = not any(namespace.glob("*/capture.execution"))
            elif not terminal:
                terminal = wait_terminal(worker_pid,worker_script,seconds=6)
            if terminal:
                with index_writer_lease(namespace): pass
                shutil.rmtree(base)
            else: raise RuntimeError(f"capture fixture worker exit unconfirmed; preserve {base}")


if __name__ == "__main__": unittest.main()
