"""Unix resource guard for fixed, disposable index experiments.

Not a sandbox or durable campaign runner. No arbitrary command/script is accepted.
FSIZE is per file; RSS is sampled, not a kernel hard total-memory guarantee.
"""
import argparse
import json
import os
from pathlib import Path
import resource
import re
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
WORKERS = {
    "capacity": HERE / "profile_feature_identity.ts",
    "witness": HERE / "index_resource_witness.ts",
    "identity-stress": HERE / "index_identity_stress.ts",
    # Direct node:test module entry (no --test subprocess): sampled RSS covers the writer.
    "index-engine-tests": HERE.parent / "feature-index.test.ts",
    "index-engine-capacity": HERE / "profile_feature_index.ts",
    "lease-witness": HERE / "index_lease_witness.ts",
    "index-engine-bootstrap": HERE / "index_bootstrap.ts",
    "index-bootstrap-crash": HERE / "index_bootstrap_crash.ts",
    "index-registry-startup": HERE / "index_registry_worker.py",
    "index-registry-lease-witness": HERE / "index_registry_lease_witness.py",
}
CASES = {"commit", "file-limit", "heap-capability", "page-limit", "crash", "wall-limit", "cpu-limit", "rss-limit", "output-limit"}
BOOTSTRAP_CASES = {"empty-file", "schema-checkpointed", "before-rename", "after-rename"}
MIB = 1024 * 1024


class IndexWorkerUnreaped(RuntimeError):
    """Guard failed to confirm exit; preserve roots and retain the actual handle."""
    def __init__(self, process, root, execution_root, reason):
        self.process = process
        self.root = Path(root)
        self.execution_root = Path(execution_root)
        self.reason = reason
        super().__init__(f"index worker pid {process.pid} was not confirmed terminal; "
                         f"preserve {self.root} and execution {self.execution_root}")


def bounded_integer(value, minimum, maximum, label):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f"{label} must be an integer in [{minimum}, {maximum}]")
    return value


def reduced_limit(kind, requested):
    inherited = resource.getrlimit(kind)
    actual = min([requested] + [x for x in inherited if x != resource.RLIM_INFINITY])
    return actual, actual


def rss_bytes(pid):
    # Exact owned pid only; a failed reading is handled as a guard failure if live.
    result = subprocess.run(["/bin/ps", "-o", "rss=", "-p", str(pid)],
                            stdin=subprocess.DEVNULL, capture_output=True, timeout=1)
    raw = result.stdout.strip()
    if result.returncode or len(raw) > 32 or not raw.isdigit():
        raise RuntimeError("owned worker RSS measurement unavailable")
    return int(raw) * 1024


def scratch_sizes(root):
    sizes = {}
    for directory, dirs, files in os.walk(root, followlinks=False):
        if len(dirs) + len(files) + len(sizes) > 64:
            raise RuntimeError("disposable experiment exceeded its file-count bound")
        for name in dirs:
            if (Path(directory) / name).is_symlink():
                raise RuntimeError("symlink in disposable scratch")
        for name in files:
            file = Path(directory) / name
            info = file.lstat()
            if not stat.S_ISREG(info.st_mode):
                raise RuntimeError("nonregular disposable scratch file")
            sizes[str(file.relative_to(root))] = info.st_size
    return sizes


def _registry_sizes(root):
    """Bounded fixed-file namespace inventory, without unsupervised parent SQL.

    The pinned worker verifies charged child semantics/footprints. Do not recurse
    with the experiment's 64-file limit: a legitimate namespace permits256 roots.
    """
    from index_namespace import FIXED_FILES, META_BYTES
    from index_reservations import DATABASE_BYTES, MAX_RESERVATIONS, REGISTRY_ALLOWANCE
    from index_root import _names
    from index_controller_state import CONTROLS, EXECUTION, RECLAIM, footprint, verify_registry_anchor
    sizes = {}; overhead = root.lstat().st_blocks * 512
    overhead += footprint(root)
    verify_registry_anchor(root)
    for name in _names(root, MAX_RESERVATIONS + len(FIXED_FILES)):
        info = (root/name).lstat()
        if name in CONTROLS:
            if name not in {EXECUTION, RECLAIM}: sizes[name] = info.st_size
            continue
        if name not in FIXED_FILES:
            if (not re.fullmatch(r"[a-f0-9]{64}", name) or not stat.S_ISDIR(info.st_mode)
                    or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700):
                raise ValueError("unknown registry entry is preserved")
            continue
        maximum = 0 if name == "writer.lock" else META_BYTES if name.startswith("namespace.") else DATABASE_BYTES
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1
                or stat.S_IMODE(info.st_mode) != 0o600 or not 0 <= info.st_size <= maximum):
            raise ValueError("unsafe registry file is preserved")
        overhead += max(info.st_size, info.st_blocks * 512)
        sizes[name] = info.st_size
    if overhead > REGISTRY_ALLOWANCE:
        raise ValueError("actual registry overhead exceeds its allowance")
    return sizes


def recovered_witness(root):
    # Reopen only our own disposable database after its worker is terminal.
    # This may recover its WAL; never point this function at the real index/ledger.
    import sqlite3
    database = root / "witness.sqlite"
    if not database.exists():
        return None
    connection = sqlite3.connect(str(database), timeout=1)
    try:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        rows = [list(row) for row in connection.execute("SELECT id, length(payload) FROM durable ORDER BY id")]
        return {"sqliteVersion": sqlite3.sqlite_version, "integrity": integrity, "rows": rows}
    finally:
        connection.close()


def _run_fixed_process(node, worker, root, *, case=None, file_bytes=4*MIB, cpu_seconds=10,
                       wall_seconds=15, heap_mib=256, rss_limit_bytes=384*MIB, lease_descriptor=None,
                       execution_root=None, namespace_descriptor=None, registry_configuration=None):
    """Private fixed-worker boundary. Never dispose caller-owned database/WAL.

    Caller supplies the actual held kernel lease; inode checks cannot prove flock
    ownership. This is not a public durable opener or aggregate-budget admission.
    """
    allowed_cases = CASES if worker == "witness" else BOOTSTRAP_CASES if worker == "index-bootstrap-crash" else {None}
    if worker not in WORKERS or case not in allowed_cases:
        raise ValueError("only a registered worker and its fixed cases are accepted")
    bounded_integer(file_bytes, 65536, 64*MIB, "file bytes")
    bounded_integer(cpu_seconds, 1, 60, "CPU seconds")
    bounded_integer(wall_seconds, 1, 60, "wall seconds")
    bounded_integer(heap_mib, 64, 1536, "V8 heap MiB")
    bounded_integer(rss_limit_bytes, 64*MIB, 512*MIB, "sampled RSS bytes")
    registry_worker = worker in {"index-registry-startup", "index-registry-lease-witness"}
    if registry_worker:
        from index_namespace import _aggregate
        if (type(registry_configuration) is not dict
                or set(registry_configuration) != {"aggregateBytes", "pythonVersion", "sqliteVersion"}
                or lease_descriptor is None or namespace_descriptor is not None or file_bytes > 4*MIB):
            raise ValueError("fixed registry worker requires its exact configuration and namespace lease")
        _aggregate(registry_configuration["aggregateBytes"])
        for key in ["pythonVersion", "sqliteVersion"]:
            if (type(registry_configuration[key]) is not str
                    or not re.fullmatch(r"[0-9]{1,3}(?:\.[0-9]{1,3}){2}", registry_configuration[key])):
                raise ValueError("registry runtime version must be an exact bounded version")
    elif registry_configuration is not None:
        raise ValueError("registry configuration is accepted only by the fixed registry worker")
    root = Path(root)
    if not root.is_absolute() or root.resolve(strict=True) != root:
        raise ValueError("worker root must be an existing canonical absolute path")
    root_info = root.lstat()
    if not stat.S_ISDIR(root_info.st_mode) or root_info.st_uid != os.getuid() or stat.S_IMODE(root_info.st_mode) != 0o700:
        raise ValueError("worker root must be an owned private 0700 directory")
    inherited = ()
    if lease_descriptor is not None:
        if type(lease_descriptor) is not int or not 2 < lease_descriptor <= 2147483647:
            raise ValueError("worker lease must be a dedicated descriptor")
        lease = os.fstat(lease_descriptor)
        named = (root / "writer.lock").lstat()
        if (not stat.S_ISREG(lease.st_mode) or lease.st_uid != os.getuid()
                or stat.S_IMODE(lease.st_mode) != 0o600 or lease.st_nlink != 1 or lease.st_size != 0
                or (lease.st_dev, lease.st_ino) != (named.st_dev, named.st_ino)):
            raise ValueError("worker lease descriptor differs from the private permanent inode")
        inherited = (lease_descriptor,)
    if namespace_descriptor is not None:
        if (lease_descriptor is None or type(namespace_descriptor) is not int
                or not 2 < namespace_descriptor <= 2147483647 or namespace_descriptor == lease_descriptor):
            raise ValueError("worker namespace lease requires a distinct dedicated descriptor and child lease")
        parent = root.parent
        info = parent.lstat()
        if (parent.resolve(strict=True) != parent or not stat.S_ISDIR(info.st_mode)
                or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700):
            raise ValueError("worker namespace must remain owned and private")
        held = os.fstat(namespace_descriptor); named = (parent/"writer.lock").lstat()
        if (not stat.S_ISREG(held.st_mode) or held.st_uid != os.getuid() or held.st_nlink != 1
                or stat.S_IMODE(held.st_mode) != 0o600 or held.st_size != 0
                or (held.st_dev, held.st_ino) != (named.st_dev, named.st_ino)):
            raise ValueError("worker namespace lease descriptor differs from its permanent inode")
        inherited += (namespace_descriptor,)
    node = Path(node)
    if not node.is_absolute():
        raise ValueError("Node executable must be absolute")
    node = node.resolve(strict=True)
    if not node.is_file() or not os.access(node, os.X_OK):
        raise ValueError("Node executable must be an executable regular file")
    script = WORKERS[worker]
    execution = HERE.parent.parent
    if execution_root is not None:
        execution = Path(execution_root)
        if not execution.is_absolute() or execution.resolve(strict=True) != execution:
            raise ValueError("execution snapshot must remain canonical")
        info = execution.lstat()
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) != 0o700):
            raise ValueError("execution snapshot must remain owned and private")
        script = execution/script.relative_to(HERE.parent.parent)
    if script.is_symlink() or not script.is_file() or script.resolve(strict=True) != script:
        raise ValueError("registered worker path is unsafe")
    limits = {resource.RLIMIT_FSIZE: reduced_limit(resource.RLIMIT_FSIZE, file_bytes),
              resource.RLIMIT_CPU: reduced_limit(resource.RLIMIT_CPU, cpu_seconds),
              resource.RLIMIT_CORE: (0, 0)}

    def apply_limits():
        os.umask(0o077)
        for kind, limit in limits.items():
            resource.setrlimit(kind, limit)
            if resource.getrlimit(kind) != limit:
                raise RuntimeError("kernel resource limit did not apply")
        signal.signal(signal.SIGXFSZ, signal.SIG_DFL)
        signal.signal(signal.SIGXCPU, signal.SIG_DFL)

    # No inherited NODE_OPTIONS, loader, shell, credentials or ambient worker flags.
    environment = {"PATH": str(node.parent), "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "TMPDIR": str(root)}
    if lease_descriptor is not None:
        environment["WORLD_INDEX_LEASE_DESCRIPTOR"] = str(lease_descriptor)
    if namespace_descriptor is not None:
        environment["WORLD_INDEX_NAMESPACE_DESCRIPTOR"] = str(namespace_descriptor)
    if registry_worker:
        environment.update({"WORLD_INDEX_NAMESPACE_BUDGET": str(registry_configuration["aggregateBytes"]),
            "WORLD_INDEX_PYTHON_VERSION": registry_configuration["pythonVersion"],
            "WORLD_INDEX_PYTHON_SQLITE_VERSION": registry_configuration["sqliteVersion"],
            "WORLD_INDEX_NAMESPACE_DESCRIPTOR": str(lease_descriptor)})
        command = [str(node), "-I", "-B", str(script)]
    else:
        command = [str(node), f"--max-old-space-size={heap_mib}", "--experimental-strip-types", str(script)]
    if case is not None:
        command.append(case)
    started = time.monotonic()
    output = {"stdout": bytearray(), "stderr": bytearray()}
    maximum_rss = 0
    reason = "exit"
    selector = None
    process = None
    next_rss = started
    inherited_pipe_exit_unconfirmed = False
    try:
        process = subprocess.Popen(command, cwd=execution, env=environment,
                                   stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   start_new_session=True, preexec_fn=apply_limits, pass_fds=inherited)
        selector = selectors.DefaultSelector()
        for name, stream in (("stdout", process.stdout), ("stderr", process.stderr)):
            selector.register(stream, selectors.EVENT_READ, name)
        while selector.get_map() or process.poll() is None:
            now = time.monotonic()
            if now - started >= wall_seconds:
                # A reaped leader does not prove that descendants which inherited
                # pipes or leases have exited. Never wait indefinitely or reclaim
                # their state on that weaker evidence.
                inherited_pipe_exit_unconfirmed = process.poll() is not None and bool(selector.get_map())
                reason = "wall-limit"
                break
            if process.poll() is None and now >= next_rss:
                try:
                    maximum_rss = max(maximum_rss, rss_bytes(process.pid))
                except Exception:
                    if process.poll() is None:
                        reason = "RSS-measurement-failed"
                        break
                if maximum_rss > rss_limit_bytes:
                    reason = "sampled-RSS-limit"
                    break
                next_rss = now + 0.1
            for key, _ in selector.select(0.05):
                data = os.read(key.fileobj.fileno(), 8192)
                if not data:
                    selector.unregister(key.fileobj)
                    continue
                cap = (8192 if registry_worker else 1_000_000) if key.data == "stdout" else 64_000
                if len(output[key.data]) + len(data) > cap:
                    reason = "output-limit"
                    break
                output[key.data].extend(data)
            if reason != "exit":
                break
    finally:
        # This process group was created exclusively by this call. No generic kill.
        try:
            try:
                if process is not None and process.poll() is None:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        # The worker may finish between poll and kill. Still reap.
                        pass
            finally:
                try:
                    if process is not None:
                        process.wait(timeout=3)
                    if inherited_pipe_exit_unconfirmed:
                        raise IndexWorkerUnreaped(process, root, execution, "inherited-pipe-exit-unconfirmed")
                except subprocess.TimeoutExpired as error:
                    raise IndexWorkerUnreaped(process, root, execution, reason) from error
        finally:
            # Cleanup must not mask IndexWorkerUnreaped: callers retain snapshots
            # based on that exception, and every owned pipe still needs closing.
            unwinding = sys.exc_info()[0] is not None
            cleanup_error = None
            handles = ([selector] if selector is not None else [])
            if process is not None:
                handles.extend([process.stdout, process.stderr])
            for handle in handles:
                try:
                    handle.close()
                except Exception as error:
                    if cleanup_error is None:
                        cleanup_error = error
            if cleanup_error is not None and not unwinding:
                raise cleanup_error
    # A caller-owned durable directory may never be silently replaced or followed
    # through a changed root before inventory/recovery.
    after = root.lstat()
    if (root.resolve(strict=True) != root or not stat.S_ISDIR(after.st_mode)
            or after.st_uid != root_info.st_uid or stat.S_IMODE(after.st_mode) != 0o700
            or (after.st_dev, after.st_ino) != (root_info.st_dev, root_info.st_ino)):
        raise RuntimeError("worker root changed; preserve state for explicit recovery")
    physical = _registry_sizes(root) if registry_worker else scratch_sizes(root)
    if any(size > limits[resource.RLIMIT_FSIZE][0] for size in physical.values()):
        raise RuntimeError("a scratch file exceeded the applied kernel file limit")
    result = {"worker": worker, "case": case, "returnCode": process.returncode,
              "inheritedLease": lease_descriptor is not None,
              "inheritedNamespaceLease": namespace_descriptor is not None or registry_worker,
              "terminationSignal": signal.Signals(-process.returncode).name if process.returncode < 0 else None,
              "reason": reason, "elapsedMs": (time.monotonic() - started)*1000,
              "maximumObservedWorkerRssBytes": maximum_rss,
              "limits": {"fileBytes": limits[resource.RLIMIT_FSIZE][0], "cpuSeconds": limits[resource.RLIMIT_CPU][0],
                         "coreBytes": 0, "wallSeconds": wall_seconds, "v8HeapMiB": None if registry_worker else heap_mib,
                         "sampledRssBytes": rss_limit_bytes},
              "scratchFilesBeforeRecovery": physical,
              "stdout": output["stdout"].decode("utf-8", errors="strict"),
              "stderr": output["stderr"].decode("utf-8", errors="replace")}
    return result


def run_worker(node, worker, *, case=None, file_bytes=4*MIB, cpu_seconds=10,
               wall_seconds=15, heap_mib=256, rss_limit_bytes=384*MIB):
    # Public experiment runner owns disposal. The private process boundary does
    # not delete its caller's root, enabling future durable crash/replay wiring.
    root = Path(tempfile.mkdtemp(prefix="allworld-index-guard-")).resolve(strict=True)
    preserve = False
    try:
        result = _run_fixed_process(node, worker, root, case=case, file_bytes=file_bytes,
                                    cpu_seconds=cpu_seconds, wall_seconds=wall_seconds,
                                    heap_mib=heap_mib, rss_limit_bytes=rss_limit_bytes)
        if worker == "witness":
            result["recovery"] = recovered_witness(root)
    except IndexWorkerUnreaped:
        preserve = True
        raise
    finally:
        if not preserve:
            shutil.rmtree(root)
    if root.exists():
        raise RuntimeError("owned disposable scratch was not removed")
    result["scratchRemovedAfterReturn"] = True
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", required=True)
    parser.add_argument("--worker", choices=WORKERS, required=True)
    parser.add_argument("--case", choices=sorted(CASES | BOOTSTRAP_CASES))
    parser.add_argument("--file-bytes", type=int, default=4*MIB)
    parser.add_argument("--cpu-seconds", type=int, default=10)
    parser.add_argument("--wall-seconds", type=int, default=15)
    args = parser.parse_args()
    result = run_worker(args.node, args.worker, case=args.case, file_bytes=args.file_bytes,
                        cpu_seconds=args.cpu_seconds, wall_seconds=args.wall_seconds)
    print(json.dumps(result, sort_keys=True))
    return 0 if result["returnCode"] == 0 and result["reason"] == "exit" else 1


if __name__ == "__main__":
    raise SystemExit(main())
