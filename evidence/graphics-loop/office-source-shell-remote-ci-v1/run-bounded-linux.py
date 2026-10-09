#!/usr/bin/env python3
"""Run one diagnostic in its own Linux process group with fixed memory/time guards."""
import json
import hashlib
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path.cwd()
HERE = Path("evidence/graphics-loop/office-source-shell-remote-ci-v1")
PROBE = Path("evidence/graphics-loop/garment-quality-v1/shoulder-topology-v1/office-source-shell-v1/probe-office-source-shell-diagnostic-reviewed-v2.mjs")
MAX_RSS_BYTES = 220 * 1024 * 1024
TIMEOUT_SECONDS = 20


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] not in ("man", "woman"):
        raise SystemExit("usage: run-bounded-linux.py man|woman output.json")
    body, output_arg = sys.argv[1], Path(sys.argv[2])
    output = output_arg if output_arg.is_absolute() else ROOT / output_arg
    output.parent.mkdir(parents=True, exist_ok=True)
    log = output.with_suffix(".log")
    receipt = output.with_suffix(".receipt.json")
    if output.exists() or log.exists() or receipt.exists():
        raise SystemExit("refusing to overwrite an existing result")

    if sys.platform != "linux":
        raise SystemExit("Remote-only Linux runner; no local Mac admission")
    manifest = json.loads((HERE / "snapshot-files.json").read_text())
    source_before = {entry["path"]: hashlib.sha256((ROOT / entry["path"]).read_bytes()).hexdigest() for entry in manifest["files"]}
    if any(source_before[entry["path"]] != entry["sha256"] for entry in manifest["files"]):
        raise SystemExit("Snapshot input mismatch before probe")
    command = ["node", "--max-old-space-size=128", "--experimental-strip-types", str(PROBE), body, str(output)]
    start = time.monotonic()
    peak = 0
    status = "running"
    child_code = None
    process = None
    try:
        with log.open("xb") as log_file:
            process = subprocess.Popen(command, cwd=ROOT, stdout=log_file, stderr=subprocess.STDOUT, start_new_session=True)
            pgid = process.pid
            while True:
                child_code = process.poll()
                if child_code is not None:
                    status = "completed" if peak else "monitor_error"
                    break
                try:
                    listing = subprocess.run(["ps", "-e", "-o", "pid=,pgid=,rss="], check=False, capture_output=True, text=True, timeout=2)
                    if listing.returncode != 0 or not listing.stdout.strip():
                        raise RuntimeError(f"ps could not inspect process group {pgid}: {listing.stderr.strip()}")
                    rss_values = [int(parts[2]) * 1024 for row in listing.stdout.splitlines() if len(parts := row.split()) == 3 and int(parts[1]) == pgid]
                    if not rss_values:
                        raise RuntimeError(f"ps returned no RSS values for process group {pgid}")
                    group_rss = sum(rss_values)
                    peak = max(peak, group_rss)
                except (OSError, RuntimeError, subprocess.TimeoutExpired, ValueError):
                    child_code = process.poll()
                    if child_code is not None and peak:
                        status = "completed"
                        break
                    status = "monitor_error"
                    try:
                        os.killpg(pgid, signal.SIGTERM)
                        process.wait(timeout=1.5)
                    except (OSError, subprocess.TimeoutExpired):
                        try:
                            os.killpg(pgid, signal.SIGKILL)
                            process.wait()
                        except OSError:
                            pass
                    child_code = process.returncode
                    break
                if child_code is not None:
                    status = "completed"
                    break
                if group_rss > MAX_RSS_BYTES:
                    status = "memory_limit"
                    os.killpg(pgid, signal.SIGTERM)
                    try:
                        process.wait(timeout=1.5)
                    except subprocess.TimeoutExpired:
                        os.killpg(pgid, signal.SIGKILL)
                        process.wait()
                    child_code = process.returncode
                    break
                if time.monotonic() - start > TIMEOUT_SECONDS:
                    status = "timeout"
                    os.killpg(pgid, signal.SIGTERM)
                    try:
                        process.wait(timeout=1.5)
                    except subprocess.TimeoutExpired:
                        os.killpg(pgid, signal.SIGKILL)
                        process.wait()
                    child_code = process.returncode
                    break
                time.sleep(0.025)
    except BaseException:
        status = "runner_error"
        if process is not None and process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=1.5)
            except (OSError, subprocess.TimeoutExpired):
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                except OSError:
                    pass
        raise
    finally:
        elapsed = time.monotonic() - start
        source_after = {entry["path"]: hashlib.sha256((ROOT / entry["path"]).read_bytes()).hexdigest() for entry in manifest["files"]}
        if source_before != source_after:
            status = "source_changed"
        report = {
            "body": body,
            "platform": sys.platform,
            "scope": "Node probe owned group sampled RSS; Python wrapper and CI host memory are separate. No Mac/GPU/phone claim.",
            "sourceHashesBefore": source_before,
            "sourceHashesAfter": source_after,
            "command": command,
            "processGroup": process.pid if process is not None else None,
            "status": status,
            "childExitCode": child_code,
            "elapsedSeconds": round(elapsed, 3),
            "peakGroupRssBytes": peak,
            "rssLimitBytes": MAX_RSS_BYTES,
            "timeoutSeconds": TIMEOUT_SECONDS,
            "probeReportExists": output.exists(),
            "preflightExists": output.with_name(output.stem + "-preflight.json").exists(),
            "log": str(log),
        }
        receipt.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report, indent=2))
    if status == "completed" and child_code == 0 and peak <= MAX_RSS_BYTES:
        return 0
    return 125 if status in ("memory_limit", "source_changed", "monitor_error") else 124 if status == "timeout" else (child_code or 1)


if __name__ == "__main__":
    raise SystemExit(main())
