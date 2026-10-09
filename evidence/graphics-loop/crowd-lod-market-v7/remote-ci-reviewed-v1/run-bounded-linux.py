#!/usr/bin/env python3
"""Build the pinned v7 browser fixture under a Linux Node/process-group guard."""
import hashlib
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path.cwd()
HERE = Path("evidence/graphics-loop/crowd-lod-market-v7/remote-ci-reviewed-v1")
BUILDER = Path("evidence/graphics-loop/crowd-lod-market-v7/prepare-market-gpu-v7.mjs")
OUTPUT = Path("evidence/graphics-loop/crowd-lod-market-v7/static-fixture-market-gpu-v7")
MAX_RSS_BYTES = 220 * 1024 * 1024
TIMEOUT_SECONDS = 25


def digest_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_hashes(manifest: dict) -> dict[str, str]:
    return {entry["path"]: digest_file(ROOT / entry["path"]) for entry in manifest["files"]}


def sample_group_rss(pgid: int) -> int:
    listing = subprocess.run(["ps", "-e", "-o", "pid=,pgid=,rss="], check=True, capture_output=True, text=True, timeout=2)
    rows = []
    for line in listing.stdout.splitlines():
        parts = line.split()
        if len(parts) == 3 and int(parts[1]) == pgid:
            rows.append(int(parts[2]) * 1024)
    if not rows:
        raise RuntimeError(f"ps returned no RSS values for process group {pgid}")
    return sum(rows)


def stop_group(process: subprocess.Popen, force: bool = False) -> None:
    try:
        os.killpg(process.pid, signal.SIGKILL if force else signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=1.5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()


def main() -> int:
    if sys.platform != "linux":
        raise SystemExit("Remote-only Linux runner; local Mac execution is refused")
    manifest_path = HERE / "snapshot-files.json"
    expected_manifest = os.environ.get("EXPECTED_SNAPSHOT_SHA256", "")
    if len(expected_manifest) != 64 or any(character not in "0123456789abcdef" for character in expected_manifest):
        raise SystemExit("EXPECTED_SNAPSHOT_SHA256 must pin the diagnostic snapshot manifest")
    if digest_file(manifest_path) != expected_manifest:
        raise SystemExit("Snapshot manifest digest changed before CPU build")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema") != "allworld-crowd-lod-market-v7-cpu-snapshot-v1":
        raise SystemExit("Unexpected source snapshot schema")
    before = source_hashes(manifest)
    if any(before[item["path"]] != item["sha256"] for item in manifest["files"]):
        raise SystemExit("Snapshot source mismatch before CPU build")
    if not (ROOT / BUILDER).is_file():
        raise SystemExit(f"Pinned browser package builder is missing: {BUILDER}")

    result_dir = HERE / "remote-results"
    result_dir.mkdir(parents=True, exist_ok=True)
    log = result_dir / "v7-cpu-package.log"
    receipt = result_dir / "v7-cpu-package.receipt.json"
    if log.exists() or receipt.exists():
        raise SystemExit("Refusing to overwrite an existing remote result; use a fresh CI checkout")

    command = ["node", "--max-old-space-size=96", "--experimental-strip-types", str(BUILDER)]
    started = time.monotonic()
    peak = 0
    status = "running"
    child_code = None
    failure = None
    process = None
    try:
        with log.open("xb") as log_file:
            process = subprocess.Popen(command, cwd=ROOT, stdout=log_file, stderr=subprocess.STDOUT, start_new_session=True)
            while True:
                child_code = process.poll()
                if child_code is not None:
                    status = "completed"
                    break
                try:
                    rss = sample_group_rss(process.pid)
                    peak = max(peak, rss)
                except (OSError, RuntimeError, subprocess.SubprocessError, ValueError) as error:
                    if process.poll() is not None:
                        child_code, status = process.returncode, "completed"
                        break
                    status, failure = "monitor_error", str(error)
                    stop_group(process)
                    child_code = process.returncode
                    break
                if rss > MAX_RSS_BYTES:
                    status, failure = "memory_limit", "owned Node process group exceeded 220 MiB RSS"
                    stop_group(process)
                    child_code = process.returncode
                    break
                if time.monotonic() - started > TIMEOUT_SECONDS:
                    status, failure = "timeout", "25 second CPU packaging timeout"
                    stop_group(process)
                    child_code = process.returncode
                    break
                time.sleep(0.025)
    except BaseException as error:
        status, failure = "runner_error", str(error)
        if process is not None and process.poll() is None:
            stop_group(process)
        raise
    finally:
        elapsed = time.monotonic() - started
        after = source_hashes(manifest)
        if before != after:
            status, failure = "source_changed", "one or more pinned inputs changed during the build"
        package_manifest = ROOT / OUTPUT / "build-manifest.json"
        package_ready = False
        if package_manifest.is_file():
            try:
                record = json.loads(package_manifest.read_text(encoding="utf-8"))
                package_ready = record.get("status") == "static-packaging-only-not-visual-or-runtime-acceptance"
            except (OSError, json.JSONDecodeError):
                package_ready = False
        report = {
            "platform": sys.platform,
            "scope": "CPU esbuild package of the v7 browser fixture only; Meshopt recipe executes in the browser viewer, and this run cannot certify GPU pixels, near identity, or mobile performance.",
            "sourceHashesBefore": before,
            "sourceHashesAfter": after,
            "command": command,
            "processGroup": process.pid if process is not None else None,
            "status": status,
            "failure": failure,
            "childExitCode": child_code,
            "elapsedSeconds": round(elapsed, 3),
            "peakGroupRssBytes": peak,
            "rssLimitBytes": MAX_RSS_BYTES,
            "timeoutSeconds": TIMEOUT_SECONDS,
            "packageManifestExists": package_manifest.is_file(),
            "packageManifestStatusValid": package_ready,
            "log": str(log),
        }
        receipt.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report, indent=2), flush=True)
    if status == "completed" and child_code == 0 and peak <= MAX_RSS_BYTES and package_ready:
        return 0
    if status in ("memory_limit", "source_changed", "monitor_error"):
        return 125
    if status == "timeout":
        return 124
    return child_code or 1


if __name__ == "__main__":
    raise SystemExit(main())
