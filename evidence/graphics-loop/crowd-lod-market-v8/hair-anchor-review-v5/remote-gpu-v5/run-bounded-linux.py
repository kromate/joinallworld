#!/usr/bin/env python3
"""Run the pinned remote Chrome comparison in one 2048 MiB / 60 s process group.

This v3 wrapper tolerates the short ps/Popen terminal race seen in v2 while
still requiring at least one positive RSS sample before a successful receipt.
"""
import hashlib
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
ARTIFACT = HERE / "downloaded-artifact"
RESULTS = HERE / "remote-results"
MANIFEST = HERE / "source-snapshot.json"
MAX_RSS = 2048 * 1024 * 1024
TIMEOUT = 60
ZERO_RSS_GRACE = 1.25


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def digest_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def frozen(expected: str) -> dict[str, str]:
    raw = MANIFEST.read_bytes()
    if digest_bytes(raw) != expected:
        raise RuntimeError("remote review source-manifest digest mismatch")
    record = json.loads(raw)
    if record.get("schema") != "allworld-market-lod-v8-hair-anchor-live-source-snapshot-v5":
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


def process_snapshot(pgid: int) -> list[dict]:
    """Return per-process RSS and state; stat distinguishes zombies from live rows."""
    listing = subprocess.run(
        ["ps", "-e", "-o", "pid=,pgid=,rss=,stat=,comm="],
        check=True, capture_output=True, text=True, timeout=2,
    ).stdout
    rows = []
    for line in listing.splitlines():
        fields = line.split(None, 4)
        if len(fields) != 5:
            continue
        pid_s, group_s, rss_s, state, command = fields
        if int(group_s) != pgid:
            continue
        rows.append({"pid": int(pid_s), "rssBytes": int(rss_s) * 1024,
                     "state": state, "command": command})
    return rows


def group_rss(rows: list[dict]) -> int:
    return sum(row["rssBytes"] for row in rows)


def terminal_result() -> dict | None:
    path = RESULTS / "review-results.json"
    if not path.is_file():
        return None
    try:
        result = json.loads(path.read_text())
        return {key: result.get(key) for key in ("status", "success", "failure", "captures")}
    except (OSError, json.JSONDecodeError):
        return {"status": "unreadable", "success": False}


def terminate_group(pgid: int, process: subprocess.Popen) -> bool:
    """Always reap the controller and verify no browser/server descendant remains."""
    try:
        alive = [row["pid"] for row in process_snapshot(pgid)]
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
            remaining = [row["pid"] for row in process_snapshot(pgid)]
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
                remaining = [row["pid"] for row in process_snapshot(pgid)]
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
    per_process_peak: dict[int, dict] = {}
    peak_group_processes: list[dict] = []
    breadcrumbs: list[dict] = []
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
                    rows = process_snapshot(process_group)
                    current = group_rss(rows)
                    if current <= 0:
                        # ps can observe only a terminal/zombie row just before Popen.poll()
                        # collects the exit status. Give that transition a short bounded grace.
                        breadcrumb = {"atSeconds": round(time.monotonic() - started, 3),
                                      "reason": "zero-or-absent-rss", "processes": rows}
                        deadline = time.monotonic() + ZERO_RSS_GRACE
                        while time.monotonic() < deadline:
                            code = process.poll()
                            if code is not None:
                                break
                            time.sleep(0.04)
                            rows = process_snapshot(process_group)
                            current = group_rss(rows)
                            if current > 0:
                                break
                        breadcrumb["afterGraceProcesses"] = rows
                        breadcrumb["childExitCode"] = process.poll()
                        breadcrumbs.append(breadcrumb)
                        if current > 0:
                            monitor_samples += 1
                            if current > peak:
                                peak = current
                                peak_group_processes = rows
                            for row in rows:
                                previous = per_process_peak.get(row["pid"], {})
                                if row["rssBytes"] >= previous.get("rssBytes", 0):
                                    per_process_peak[row["pid"]] = {**row, "atSeconds": round(time.monotonic() - started, 3)}
                            if current > MAX_RSS:
                                status, failure = "memory_limit", "browser/runner process group exceeded 2048 MiB RSS"
                                break
                        elif process.poll() is not None and monitor_samples > 0:
                            code, status = process.returncode, "completed"
                            break
                        else:
                            live = [row for row in rows if not row["state"].startswith("Z")]
                            status, failure = "monitor_error", (
                                "owned process group had no positive RSS after terminal grace; "
                                f"liveProcesses={live!r}, rows={rows!r}, childExitCode={process.poll()}"
                            )
                            break
                    else:
                        monitor_samples += 1
                        if current > peak:
                            peak = current
                            peak_group_processes = rows
                        for row in rows:
                            previous = per_process_peak.get(row["pid"], {})
                            if row["rssBytes"] >= previous.get("rssBytes", 0):
                                per_process_peak[row["pid"]] = {**row, "atSeconds": round(time.monotonic() - started, 3)}
                        if current > MAX_RSS:
                            status, failure = "memory_limit", "browser/runner process group exceeded 2048 MiB RSS"
                            break
                except (OSError, RuntimeError, subprocess.SubprocessError, ValueError) as error:
                    code = process.poll()
                    breadcrumbs.append({"atSeconds": round(time.monotonic() - started, 3),
                                        "reason": "process-snapshot-error", "error": str(error),
                                        "childExitCode": code})
                    if code is not None and monitor_samples > 0:
                        status = "completed"
                        break
                    status, failure = "monitor_error", str(error)
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
            if process.returncode is not None:
                code = process.returncode
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
        record = {"schema": "allworld-market-lod-v8-hair-anchor-live-process-receipt-v5", "status": status,
            "failure": failure, "childExitCode": code, "command": command,
            "processGroup": process_group, "processGroupCleanupVerified": cleanup_ok,
            "elapsedSeconds": round(time.monotonic() - started, 3), "peakGroupRssBytes": peak,
            "perProcessPeakRss": {str(pid): item for pid, item in sorted(per_process_peak.items())},
            "peakGroupProcesses": peak_group_processes,
            "terminalProcessBreadcrumbs": breadcrumbs[-12:], "rssLimitBytes": MAX_RSS,
            "timeoutSeconds": TIMEOUT, "zeroRssGraceSeconds": ZERO_RSS_GRACE,
            "monitorSamples": monitor_samples, "sourceManifestSha256": expected,
            "sourceHashesBefore": before, "sourceHashesAfter": after, "sourceUnchanged": unchanged,
            "log": str(log), "resultFileExists": (RESULTS / "review-results.json").is_file(),
            "browserResult": terminal_result(),
            "scope": "Remote headless Linux Chrome/SwiftShader diagnostic only; 2048 MiB is a remote browser harness ceiling, not an application/mobile budget or production acceptance."}
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
