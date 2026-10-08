"""Unix resource guard for fixed, disposable index experiments.

Not a sandbox or durable campaign runner. No arbitrary command/script is accepted.
FSIZE is per file; RSS is sampled, not a kernel hard total-memory guarantee.
"""
import argparse
import json
import os
from pathlib import Path
import resource
import selectors
import signal
import stat
import subprocess
import tempfile
import time

HERE = Path(__file__).resolve().parent
WORKERS = {
    "capacity": HERE / "profile_feature_identity.mjs",
    "witness": HERE / "index_resource_witness.mjs",
    "identity-stress": HERE / "index_identity_stress.mjs",
}
CASES = {"commit", "file-limit", "heap-capability", "page-limit", "crash", "wall-limit", "cpu-limit", "rss-limit", "output-limit"}
MIB = 1024 * 1024


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


def run_worker(node, worker, *, case=None, file_bytes=4*MIB, cpu_seconds=10,
               wall_seconds=15, heap_mib=256, rss_limit_bytes=384*MIB):
    if worker not in WORKERS or (worker != "witness" and case is not None) or (worker == "witness" and case not in CASES):
        raise ValueError("only a registered worker and its fixed cases are accepted")
    bounded_integer(file_bytes, 65536, 64*MIB, "file bytes")
    bounded_integer(cpu_seconds, 1, 60, "CPU seconds")
    bounded_integer(wall_seconds, 1, 60, "wall seconds")
    bounded_integer(heap_mib, 64, 1536, "V8 heap MiB")
    bounded_integer(rss_limit_bytes, 64*MIB, 512*MIB, "sampled RSS bytes")
    node = Path(node)
    if not node.is_absolute():
        raise ValueError("Node executable must be absolute")
    node = node.resolve(strict=True)
    if not node.is_file() or not os.access(node, os.X_OK):
        raise ValueError("Node executable must be an executable regular file")
    script = WORKERS[worker]
    if script.is_symlink() or not script.is_file() or script.resolve(strict=True) != script:
        raise ValueError("registered worker path is unsafe")
    limits = {resource.RLIMIT_FSIZE: reduced_limit(resource.RLIMIT_FSIZE, file_bytes),
              resource.RLIMIT_CPU: reduced_limit(resource.RLIMIT_CPU, cpu_seconds),
              resource.RLIMIT_CORE: (0, 0)}

    def apply_limits():
        for kind, limit in limits.items():
            resource.setrlimit(kind, limit)
            if resource.getrlimit(kind) != limit:
                raise RuntimeError("kernel resource limit did not apply")
        signal.signal(signal.SIGXFSZ, signal.SIG_DFL)
        signal.signal(signal.SIGXCPU, signal.SIG_DFL)

    with tempfile.TemporaryDirectory(prefix="allworld-index-guard-") as temporary:
        root = Path(temporary)
        # No inherited NODE_OPTIONS, loader, shell, credentials or ambient worker flags.
        environment = {"PATH": str(node.parent), "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "TMPDIR": str(root)}
        command = [str(node), f"--max-old-space-size={heap_mib}", "--experimental-strip-types", str(script)]
        if case is not None:
            command.append(case)
        started = time.monotonic()
        process = subprocess.Popen(command, cwd=HERE.parent.parent, env=environment,
                                   stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   start_new_session=True, preexec_fn=apply_limits)
        output = {"stdout": bytearray(), "stderr": bytearray()}
        maximum_rss = 0
        reason = "exit"
        selector = selectors.DefaultSelector()
        for name, stream in (("stdout", process.stdout), ("stderr", process.stderr)):
            selector.register(stream, selectors.EVENT_READ, name)
        next_rss = started
        try:
            while selector.get_map() or process.poll() is None:
                now = time.monotonic()
                if process.poll() is None and now - started >= wall_seconds:
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
                    cap = 1_000_000 if key.data == "stdout" else 64_000
                    if len(output[key.data]) + len(data) > cap:
                        reason = "output-limit"
                        break
                    output[key.data].extend(data)
                if reason != "exit":
                    break
        finally:
            # This process group was created exclusively by this call. No generic kill.
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    # The worker may finish between poll and kill. Still wait/reap it.
                    pass
            process.wait(timeout=3)
            selector.close()
            process.stdout.close()
            process.stderr.close()
        physical = scratch_sizes(root)
        if any(size > limits[resource.RLIMIT_FSIZE][0] for size in physical.values()):
            raise RuntimeError("a scratch file exceeded the applied kernel file limit")
        result = {"worker": worker, "case": case, "returnCode": process.returncode,
                  "terminationSignal": signal.Signals(-process.returncode).name if process.returncode < 0 else None,
                  "reason": reason, "elapsedMs": (time.monotonic() - started)*1000,
                  "maximumObservedWorkerRssBytes": maximum_rss,
                  "limits": {"fileBytes": limits[resource.RLIMIT_FSIZE][0], "cpuSeconds": limits[resource.RLIMIT_CPU][0],
                             "coreBytes": 0, "wallSeconds": wall_seconds, "v8HeapMiB": heap_mib,
                             "sampledRssBytes": rss_limit_bytes},
                  "scratchFilesBeforeRecovery": physical,
                  "stdout": output["stdout"].decode("utf-8", errors="strict"),
                  "stderr": output["stderr"].decode("utf-8", errors="replace")}
        if worker == "witness":
            result["recovery"] = recovered_witness(root)
    if root.exists():
        raise RuntimeError("owned disposable scratch was not removed")
    result["scratchRemovedAfterReturn"] = True
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", required=True)
    parser.add_argument("--worker", choices=WORKERS, required=True)
    parser.add_argument("--case", choices=sorted(CASES))
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
