"""Actual SIGKILL then new-controller recovery through the persistent API."""
import json
import os
from pathlib import Path
import resource
import select
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from index_controller_record import decode_controller_record
from index_controller_state import RECORD,EXECUTION
from index_writer_lock import index_writer_lease,IndexWriterBusy
from test_index_bootstrap import source_fixture,pin
import test_index_registry_persistent as persistent
from test_index_registry_controller import owned_worker_live,wait_terminal

MIB=1024*1024


class IndexRegistryRestartTests(unittest.TestCase):
    def test_actual_controller_sigkill_and_fresh_api_reconcile_without_pid_signalling(self):
        persistent.IndexRegistryPersistentTests.setUpClass()
        fixture=persistent.IndexRegistryPersistentTests()
        base=Path(tempfile.mkdtemp(prefix="allworld-real-controller-restart-")).resolve(strict=True)
        namespace=base/"namespace"; namespace.mkdir(mode=0o700)
        parent=None; pid=None; script=namespace/EXECUTION/"world/tooling/index_registry_worker.py"; preserve=False
        code=r'''
import json,os,sys
from pathlib import Path
sys.path.insert(0,str(Path(sys.argv[1])/"world/tooling"))
from hashlib import sha256
import index_resource_limits as guard
from index_registry_controller import restartable_registry_startup
manifest=bytes.fromhex(sys.argv[3]); config=bytes.fromhex(sys.argv[4]); runtime=json.loads(sys.argv[5])
native=guard.subprocess.Popen
def launch(command,**kwargs):
    if not str(command[-1]).endswith("index_registry_worker.py"): return native(command,**kwargs)
    # The test alone adds a two-second pause before the actual fixed worker's SQL.
    # Its namespace/runtime/descriptor validation and actual main remain unchanged.
    wrapper="import json,os,sys,time;from pathlib import Path;sys.path.insert(0,str(Path(sys.argv[1]).parent));import index_registry_worker as w;w._runtime_environment();print(json.dumps({'pid':os.getpid()}),flush=True);time.sleep(2);sys.argv=[sys.argv[1]];w.main()"
    worker=native([command[0],"-I","-B","-c",wrapper,command[-1]],**kwargs)
    ready=worker.stdout.readline(4096)
    os.write(1,(json.dumps({"pid":worker.pid,"ready":json.loads(ready)})+"\n").encode())
    return worker
guard.subprocess.Popen=launch
def pin(raw):return {"sha256":sha256(raw).hexdigest(),"bytes":len(raw)}
restartable_registry_startup(Path(sys.argv[2]),64*1024*1024,Path(sys.argv[1]),manifest,pin(manifest),config,pin(config),sys.executable,runtime,cpu_seconds=5,wall_seconds=5,attempt_limit=3)
'''
        def limits():
            resource.setrlimit(resource.RLIMIT_FSIZE,(4*MIB,4*MIB))
            resource.setrlimit(resource.RLIMIT_CPU,(5,5)); resource.setrlimit(resource.RLIMIT_CORE,(0,0))
        try:
            with source_fixture() as source:
                repository,manifest,configuration=source
                parent=subprocess.Popen([str(fixture.python),"-I","-B","-c",code,str(repository),str(namespace),
                    manifest.hex(),configuration.hex(),json.dumps(fixture.runtime)],
                    env={"PATH":str(fixture.python.parent),"LANG":"C.UTF-8","LC_ALL":"C.UTF-8"},
                    stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                    preexec_fn=limits,start_new_session=True)
                self.assertTrue(select.select([parent.stdout],[],[],5)[0],"worker did not report actual inherited lease")
                ready=json.loads(parent.stdout.readline(4096)); pid=ready["pid"]
                self.assertTrue(type(pid) is int and pid>2); self.assertEqual(pid,ready["ready"]["pid"])
                before=decode_controller_record((namespace/RECORD).read_bytes())
                self.assertEqual(before["attempts"][-1]["phase"],"prepared")
                self.assertGreater(before["attempts"][-1]["snapshotInode"],0)
                lock=(namespace/"writer.lock").stat().st_ino
                parent.kill(); parent.communicate(timeout=3)
                self.assertEqual(parent.returncode,-signal.SIGKILL)
                self.assertTrue(owned_worker_live(pid,script)); self.assertTrue((namespace/EXECUTION).exists())
                with patch("index_registry_controller._copy_snapshot") as allocate:
                    with self.assertRaises(IndexWriterBusy):
                        fixture.run_startup(namespace,source,cpu_seconds=5,wall_seconds=5,attempt_limit=3)
                    allocate.assert_not_called()
                self.assertTrue(wait_terminal(pid,script,5),"actual fixed worker did not exit")
                self.assertTrue((namespace/"reservations.sqlite").exists())
                database=(namespace/"reservations.sqlite").stat().st_ino
                # The new API uses only the durable namespace record and inherited
                # lock, without this fixture PID or old Popen object.
                with patch("os.killpg",side_effect=AssertionError("restart must not signal a remembered PID")):
                    result=fixture.run_startup(namespace,source,cpu_seconds=5,wall_seconds=5,attempt_limit=3)
                self.assertTrue(result["registry"]["replayed"])
                self.assertEqual(result["controller"]["attempts"],2)
                self.assertEqual(result["controller"]["reconciledInterruptedAttempts"],1)
                self.assertEqual(result["controller"]["reservedWallSeconds"],10)
                self.assertEqual((namespace/"writer.lock").stat().st_ino,lock)
                self.assertEqual((namespace/"reservations.sqlite").stat().st_ino,database)
                self.assertFalse((namespace/EXECUTION).exists())
        finally:
            try:
                if parent is not None:
                    if parent.poll() is None: parent.kill()
                    parent.communicate(timeout=3)
            except Exception:
                preserve=True
                raise
            finally:
                try:
                    if parent is not None and pid is None:
                        preserve=True
                    elif pid is not None and owned_worker_live(pid,script):
                        if not wait_terminal(pid,script,5):
                            group=subprocess.check_output(["/bin/ps","-o","pgid=","-p",str(pid)],timeout=1).strip()
                            if group==str(pid).encode() and owned_worker_live(pid,script): os.killpg(pid,signal.SIGKILL)
                            preserve=preserve or not wait_terminal(pid,script)
                    if not preserve:
                        with index_writer_lease(namespace): pass
                except Exception:
                    preserve=True
                    raise
                finally:
                    if preserve: raise RuntimeError(f"owned restart fixture exit unconfirmed; preserve {base}")
                    shutil.rmtree(base)


if __name__=="__main__": unittest.main()
