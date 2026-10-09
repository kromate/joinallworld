#!/usr/bin/env python3
"""Run the pinned remote Chrome comparison in one 768 MiB / 60 s process group."""
import hashlib
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
ARTIFACT = HERE / "downloaded-artifact"
RESULTS = HERE / "remote-results"
MANIFEST = HERE / "source-snapshot.json"
MAX_RSS = 768 * 1024 * 1024
TIMEOUT = 60


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def frozen(expected: str) -> dict[str, str]:
    raw = MANIFEST.read_bytes()
    if digest_bytes(raw) != expected:
        raise RuntimeError("remote review source-manifest digest mismatch")
    record = json.loads(raw)
    if record.get("schema") != "allworld-market-lod-v7-remote-gpu-source-snapshot-v1":
        raise RuntimeError("unexpected remote source snapshot schema")
    hashes = {}
    for item in record.get("files", []):
        relative = Path(item["path"])
        target = (ROOT / relative).resolve()
        if relative.is_absolute() or ".." in relative.parts or target != ROOT / relative or target.is_symlink() or not target.is_file():
            raise RuntimeError(f"unsafe source pin {relative}")
        actual = digest(target)
        if actual != item.get("sha256") or target.stat().st_size != item.get("bytes"):
            raise RuntimeError(f"pinned source changed: {relative}")
        hashes[item["path"]] = actual
    return hashes


def digest_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def group_pids(pgid: int) -> list[int]:
    listing = subprocess.run(["ps", "-e", "-o", "pid=,pgid="], check=True, capture_output=True,
                             text=True, timeout=2).stdout
    return [int(fields[0]) for line in listing.splitlines()
            if len(fields := line.split()) == 2 and int(fields[1]) == pgid]


def group_rss(pgid: int) -> int:
    listing = subprocess.run(["ps", "-e", "-o", "pid=,pgid=,rss="], check=True, capture_output=True,
                             text=True, timeout=2).stdout
    rows = [fields for line in listing.splitlines() if len(fields := line.split()) == 3 and int(fields[1]) == pgid]
    if not rows:
        raise RuntimeError(f"No RSS rows for owned PGID {pgid}")
    return sum(int(row[2]) * 1024 for row in rows)


def terminate_group(pgid: int, process: subprocess.Popen) -> bool:
    """Always reap the controller and verify no browser/server descendant remains."""
    try:
        alive = group_pids(pgid)
    except (OSError, RuntimeError, subprocess.SubprocessError, ValueError):
        try:
            os.killpg(pgid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=1.5)
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(pgid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        return False
    if alive:
        try:
            os.killpg(pgid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=1.5)
    except subprocess.TimeoutExpired:
        pass
    deadline = time.monotonic() + 1.0
    remaining = alive
    while time.monotonic() < deadline:
        try:
            remaining = group_pids(pgid)
        except (OSError, RuntimeError, subprocess.SubprocessError, ValueError):
            try:
                os.killpg(pgid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            return False
        if not remaining:
            break
        time.sleep(0.05)
    if remaining:
        try:
            os.killpg(pgid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            pass
        deadline = time.monotonic() + 2.0
        while time.monotonic() < deadline:
            try:
                remaining = group_pids(pgid)
            except (OSError, RuntimeError, subprocess.SubprocessError, ValueError):
                return False
            if not remaining:
                return True
            time.sleep(0.05)
        return False
    return True


def main() -> int:
    if sys.platform != "linux":
        raise SystemExit("Remote Linux only; local execution is refused")
    expected = os.environ.get("EXPECTED_SOURCE_MANIFEST_SHA256", "")
    if len(expected) != 64 or any(char not in "0123456789abcdef" for char in expected):
        raise SystemExit("EXPECTED_SOURCE_MANIFEST_SHA256 must pin the review recipe")
    if not os.environ.get("CHROME_BIN"):
        raise SystemExit("CHROME_BIN must point at the installed runner Chrome launcher")
    if RESULTS.exists() and any(RESULTS.iterdir()):
        raise SystemExit("Refusing to overwrite remote results")
    RESULTS.mkdir(parents=True, exist_ok=True)
    before = frozen(expected)
    log = RESULTS / "review-cdp.log"
    command = ["node", "--max-old-space-size=96", str(HERE / "review-cdp.mjs")]
    started = time.monotonic()
    peak = 0
    monitor_samples = 0
    status = "running"
    failure = None
    code = None
    process = None
    process_group = None
    cleanup_ok = False
    try:
        with log.open("xb") as stream:
            process = subprocess.Popen(command, cwd=ROOT, env={**os.environ, "ARTIFACT_DIR": str(ARTIFACT),
                "RESULT_DIR": str(RESULTS)}, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
            process_group = process.pid
            while True:
                code = process.poll()
                if code is not None:
                    if monitor_samples == 0:
                        status, failure = "monitor_error", "owned process group exited before the first positive RSS sample"
                    else:
                        status = "completed"
                    break
                try:
                    current = group_rss(process_group)
                    if current <= 0:
                        raise RuntimeError("owned process group RSS sample was not positive")
                    monitor_samples += 1
                    peak = max(peak, current)
                except (OSError, RuntimeError, subprocess.SubprocessError, ValueError) as error:
                    if process.poll() is not None and monitor_samples > 0:
                        code, status = process.returncode, "completed"
                        break
                    status, failure = "monitor_error", str(error)
                    break
                if current > MAX_RSS:
                    status, failure = "memory_limit", "browser/runner process group exceeded 768 MiB RSS"
                    break
                if time.monotonic() - started > TIMEOUT:
                    status, failure = "timeout", "60 second remote review wall limit"
                    break
                time.sleep(0.04)
    except BaseException as error:
        status, failure = "runner_error", str(error)
    finally:
        if process is not None and process_group is not None:
            cleanup_ok = terminate_group(process_group, process)
        try:
            after = frozen(expected)
        except Exception as error:
            after = {"verificationError": str(error)}
            status, failure = "source_changed", str(error)
        unchanged = before == after
        if not unchanged:
            status, failure = "source_changed", "one or more pinned recipe inputs changed during the review"
        if not cleanup_ok:
            status, failure = "cleanup_error", "could not verify full owned process group termination"
        record = {"schema": "allworld-market-lod-v7-remote-gpu-process-receipt-v2", "status": status,
            "failure": failure, "childExitCode": code, "command": command,
            "processGroup": process_group, "processGroupCleanupVerified": cleanup_ok,
            "elapsedSeconds": round(time.monotonic() - started, 3), "peakGroupRssBytes": peak,
            "rssLimitBytes": MAX_RSS, "timeoutSeconds": TIMEOUT, "monitorSamples": monitor_samples,
            "sourceManifestSha256": expected, "sourceHashesBefore": before, "sourceHashesAfter": after,
            "sourceUnchanged": unchanged, "log": str(log),
            "resultFileExists": (RESULTS / "review-results.json").is_file(),
            "scope": "Remote headless Linux Chrome/SwiftShader diagnostic only; no mobile or production acceptance."}
        (RESULTS / "process-receipt.json").write_text(json.dumps(record, indent=2) + "\n")
        print(json.dumps(record, indent=2), flush=True)
    if status == "completed" and code == 0 and peak <= MAX_RSS and monitor_samples > 0 and cleanup_ok and unchanged:
        return 0
    if status in ("memory_limit", "source_changed", "monitor_error", "cleanup_error"):
        return 125
    if status == "timeout":
        return 124
    return code or 1


if __name__ == "__main__":
    raise SystemExit(main())
