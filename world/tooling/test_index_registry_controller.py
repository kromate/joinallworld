"""Actual killed-controller lease/snapshot fixture, not persistent recovery service."""
import hashlib
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

from index_registry_startup import startup_index_namespace
from index_tooling import FILES, FORMAT, encode_tooling_manifest, verify_index_tooling
from index_writer_lock import IndexWriterBusy

MIB = 1024*1024


def pin(raw): return {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}


def owned_worker_live(pid, script):
    result = subprocess.run(["/bin/ps", "-ww", "-o", "args=", "-p", str(pid)], capture_output=True, timeout=1)
    if result.returncode == 1 and not result.stdout.strip(): return False
    if result.returncode != 0 or len(result.stdout) > 4096:
        raise RuntimeError("owned fixture process identity unavailable")
    # A different command at a reused PID is never killed as this fixture's worker.
    return str(script).encode() in result.stdout


def release_worker(execution):
    pending = execution/"lease.release.pending"; final = execution/"lease.release"
    if final.exists(): return
    descriptor = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try: os.write(descriptor, b"X"); os.fsync(descriptor)
    finally: os.close(descriptor)
    os.rename(pending, final)


def wait_terminal(pid, script, seconds=3):
    deadline = time.monotonic()+seconds
    while time.monotonic() < deadline:
        if not owned_worker_live(pid, script): return True
        time.sleep(0.02)
    return not owned_worker_live(pid, script)


class IndexRegistryControllerTests(unittest.TestCase):
    def test_actual_controller_sigkill_keeps_worker_lease_and_snapshot_until_terminal(self):
        # Manual disposable tree: preserve it on any genuinely unconfirmed worker exit.
        base = Path(tempfile.mkdtemp(prefix="allworld-controller-death-fixture-")).resolve(strict=True)
        namespace = base/"namespace"; namespace.mkdir(mode=0o700)
        source = base/"source"; source.mkdir(mode=0o700)
        actual = Path(__file__).resolve().parent.parent.parent
        pins = {}
        for name in FILES:
            raw = (actual/name).read_bytes(); self.assertLessEqual(len(raw), MIB)
            file = source/name; file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            file.write_bytes(raw); file.chmod(0o600); pins[name] = pin(raw)
        configuration = (actual/"world/acquisition-sources.json").read_bytes()
        (source/"world/acquisition-sources.json").write_bytes(configuration)
        (source/"world/acquisition-sources.json").chmod(0o600)
        manifest = encode_tooling_manifest({"format": FORMAT, "files": pins})
        python = Path(sys.executable).resolve(strict=True); binary = python.read_bytes()
        runtime = {"pythonVersion": sys.version.split()[0], "sqliteVersion": __import__("sqlite3").sqlite_version,
                   "pythonBytes": len(binary), "pythonSha256": hashlib.sha256(binary).hexdigest()}
        coordinator_code = r'''
import json,os,sys
from pathlib import Path
sys.path.insert(0,str(Path(sys.argv[1])/"world/tooling"))
import index_registry_startup as startup
import index_resource_limits as guard
from hashlib import sha256
manifest=bytes.fromhex(sys.argv[3]); config=bytes.fromhex(sys.argv[4]); runtime=json.loads(sys.argv[5])
def pin(raw): return {"bytes":len(raw),"sha256":sha256(raw).hexdigest()}
native_launch=guard.subprocess.Popen
def launch(*args,**kwargs):
    if args[0][0]=="/bin/ps": return native_launch(*args,**kwargs)
    if len(args[0])!=5 or args[0][1:3]!=["-I","-B"] or args[0][4]!="--lease-witness":
        raise ValueError("wrong fixed fixture worker command")
    process=native_launch(*args,**kwargs)
    execution=Path(args[0][3]).parent.parent.parent
    os.write(1,(json.dumps({"phase":"spawned","pid":process.pid,"executionRoot":str(execution)})+"\n").encode())
    ready=process.stdout.readline(4096)
    os.write(1,(json.dumps({"phase":"ready","report":json.loads(ready)})+"\n").encode())
    return process
guard.subprocess.Popen=launch
def fixed(python,worker,root,**kwargs):
    if worker!="index-registry-startup": raise ValueError("wrong fixed fixture endpoint")
    return guard._run_fixed_process(python,"index-registry-lease-witness",root,**kwargs)
startup._run_fixed_process=fixed
startup.startup_index_namespace(Path(sys.argv[2]),64*1024*1024,Path(sys.argv[1]),manifest,pin(manifest),config,pin(config),sys.executable,runtime)
raise RuntimeError("fixture controller unexpectedly completed")
'''
        def limits():
            resource.setrlimit(resource.RLIMIT_FSIZE, (4*MIB, 4*MIB))
            resource.setrlimit(resource.RLIMIT_CPU, (5, 5)); resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        controller = None; execution = None; worker_pid = None; worker_script = None; preserve = False
        try:
            controller = subprocess.Popen([str(python), "-I", "-B", "-c", coordinator_code, str(source),
                str(namespace), manifest.hex(), configuration.hex(), json.dumps(runtime)],
                env={"PATH": str(python.parent), "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"},
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                preexec_fn=limits, start_new_session=True)
            self.assertTrue(select.select([controller.stdout], [], [], 5)[0], "controller did not report spawn")
            spawned = json.loads(controller.stdout.readline(4096))
            self.assertEqual(spawned["phase"], "spawned")
            worker_pid = spawned["pid"]; execution = Path(spawned["executionRoot"])
            self.assertTrue(type(worker_pid) is int and worker_pid > 2)
            self.assertTrue(execution.is_absolute() and execution.resolve(strict=True) == execution)
            self.assertTrue(execution.name.startswith("allworld-index-execution-"))
            worker_script = execution/"world/tooling/index_registry_worker.py"
            verify_index_tooling(execution, manifest, pin(manifest))
            self.assertTrue(select.select([controller.stdout], [], [], 5)[0], "worker did not report readiness")
            ready = json.loads(controller.stdout.readline(4096)); self.assertEqual(ready["phase"], "ready")
            report = ready["report"]
            self.assertEqual((report["pid"], report["namespace"], report["executionRoot"]),
                             (worker_pid, str(namespace), str(execution)))
            self.assertEqual((report["fileLimit"], report["cpuLimit"], report["coreLimit"]), (4*MIB, 5, 0))
            controller.kill(); controller.communicate(timeout=3)
            self.assertEqual(controller.returncode, -signal.SIGKILL)
            self.assertTrue(owned_worker_live(worker_pid, worker_script))
            self.assertTrue(execution.exists())
            with patch("index_registry_startup.verified_execution_snapshot") as allocate:
                with self.assertRaises(IndexWriterBusy):
                    startup_index_namespace(namespace, 64*MIB, source, manifest, pin(manifest),
                                            configuration, pin(configuration), python, runtime)
                allocate.assert_not_called()
            self.assertEqual((namespace/"writer.lock").stat().st_ino, report["inode"])
            release_worker(execution)
            self.assertTrue(wait_terminal(worker_pid, worker_script), "owned worker exit was not confirmed")
            shutil.rmtree(execution)  # Known fixture snapshot only, after actual PID identity is terminal.
            result = startup_index_namespace(namespace, 64*MIB, source, manifest, pin(manifest),
                                             configuration, pin(configuration), python, runtime)
            self.assertEqual(result["registry"]["stats"]["reservations"], 0)
            self.assertEqual((namespace/"writer.lock").stat().st_ino, report["inode"])
        finally:
            try:
                if controller is not None:
                    if controller.poll() is None: controller.kill()
                    controller.communicate(timeout=3)
            except Exception:
                preserve = True
                raise
            finally:
                try:
                    if controller is not None and (worker_pid is None or worker_script is None):
                        # A launch may have happened before its identity arrived.
                        # No guessed PID, generic kill or source-tree deletion.
                        preserve = True
                    elif worker_pid is not None and owned_worker_live(worker_pid, worker_script):
                        release_worker(execution)
                        if not wait_terminal(worker_pid, worker_script):
                            group = subprocess.check_output(["/bin/ps", "-o", "pgid=", "-p", str(worker_pid)], timeout=1).strip()
                            if group == str(worker_pid).encode() and owned_worker_live(worker_pid, worker_script):
                                os.killpg(worker_pid, signal.SIGKILL)
                            preserve = preserve or not wait_terminal(worker_pid, worker_script)
                except Exception:
                    preserve = True
                    raise
                finally:
                    if not preserve:
                        if execution is not None and execution.exists(): shutil.rmtree(execution)
                        shutil.rmtree(base)
                    else:
                        raise RuntimeError(f"owned fixture worker {worker_pid} unconfirmed; preserve {base} and {execution}")


if __name__ == "__main__": unittest.main()
