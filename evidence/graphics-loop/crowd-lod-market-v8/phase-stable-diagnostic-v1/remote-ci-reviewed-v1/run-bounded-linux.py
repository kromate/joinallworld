#!/usr/bin/env python3
"""Package the pinned v8 viewer under 220 MiB RSS / 25 s Linux process-group limits."""
import hashlib
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path.cwd()
HERE = Path("evidence/graphics-loop/crowd-lod-market-v8/phase-stable-diagnostic-v1/remote-ci-reviewed-v1")
BUILDER = Path("evidence/graphics-loop/crowd-lod-market-v8/phase-stable-diagnostic-v1/remote-ci-reviewed-v1/prepare-phase-stable.mjs")
OUTPUT = Path("evidence/graphics-loop/crowd-lod-market-v8/phase-stable-diagnostic-v1/remote-ci-reviewed-v1/static-fixture-market-gpu-v8-phase-stable-v1")
RESULTS = HERE / "remote-results"
MAX_RSS_BYTES = 220 * 1024 * 1024
TIMEOUT_SECONDS = 25
ZERO_RSS_GRACE_SECONDS = 1.0


def digest_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_manifest(expected_sha: str) -> dict:
    path = ROOT / HERE / "snapshot-files.json"
    actual_sha = digest_file(path)
    if actual_sha != expected_sha:
        raise RuntimeError(f"Snapshot manifest mismatch: expected {expected_sha}, got {actual_sha}")
    record = json.loads(path.read_text(encoding="utf-8"))
    if record.get("schema") != "allworld-market-lod-v8-phase-stable-cpu-snapshot-v1":
        raise RuntimeError("Unexpected v8 CPU snapshot schema")
    return record


def source_hashes(manifest: dict) -> dict[str, str]:
    return {item["path"]: digest_file(ROOT / item["path"]) for item in manifest["files"]}


def process_rows(pgid: int) -> list[dict]:
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
        if int(group_s) == pgid:
            rows.append({"pid": int(pid_s), "rssBytes": int(rss_s) * 1024,
                         "state": state, "command": command})
    return rows


def terminate_group(process: subprocess.Popen) -> bool:
    """TERM, wait, KILL if needed, then verify no process remains in the owned PGID."""
    pgid = process.pid
    try:
        rows = process_rows(pgid)
    except (OSError, RuntimeError, subprocess.SubprocessError, ValueError):
        rows = [{"pid": pgid, "state": "unknown"}]
    if rows:
        try:
            os.killpg(pgid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=1.5)
    except subprocess.TimeoutExpired:
        pass
    deadline = time.monotonic() + 1.0
    while time.monotonic() < deadline:
        try:
            rows = process_rows(pgid)
        except (OSError, RuntimeError, subprocess.SubprocessError, ValueError):
            return False
        if not rows:
            return True
        try:
            os.killpg(pgid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        time.sleep(0.05)
    try:
        return not process_rows(pgid)
    except (OSError, RuntimeError, subprocess.SubprocessError, ValueError):
        return False


def artifact_inventory() -> tuple[list[dict], str | None, bool]:
    root = ROOT / OUTPUT
    manifest_path = root / "build-manifest.json"
    if not root.is_dir() or not manifest_path.is_file():
        return [], None, False
    try:
        build_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return [], None, False
    if build_manifest.get("status") != "phase-stable-diagnostic-package-only-not-visual-or-runtime-acceptance":
        return [], None, False
    if build_manifest.get("builderSha256") != digest_file(ROOT / BUILDER):
        return [], None, False
    closure_path = ROOT / HERE / "production-import-closure.json"
    closure = json.loads(closure_path.read_text(encoding="utf-8"))
    input_guards = build_manifest.get("inputShaGuards", {})
    closure_relative = (HERE / "production-import-closure.json").as_posix()
    if input_guards.get(closure_relative) != digest_file(closure_path):
        return [], None, False
    for item in [*closure.get("runtimeFiles", []), *closure.get("typeOnlyFiles", [])]:
        if input_guards.get(item.get("path")) != item.get("sha256"):
            return [], None, False
    declared_outputs = build_manifest.get("outputs")
    if not isinstance(declared_outputs, list):
        return [], None, False
    declared = {item.get("path"): item for item in declared_outputs if isinstance(item, dict)}
    records = []
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise RuntimeError(f"Packaged output contains symlink: {path}")
        if path.is_file():
            relative = path.relative_to(root).as_posix()
            if relative != "build-manifest.json":
                expected = declared.get(relative)
                if not expected or expected.get("bytes") != path.stat().st_size or expected.get("sha256") != digest_file(path):
                    return [], None, False
            records.append({"path": relative, "bytes": path.stat().st_size, "sha256": digest_file(path)})
    if set(declared) != {record["path"] for record in records if record["path"] != "build-manifest.json"}:
        return [], None, False
    canonical = json.dumps(records, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return records, hashlib.sha256(canonical).hexdigest(), True


def main() -> int:
    if sys.platform != "linux":
        raise SystemExit("Remote-only Linux runner; local execution is refused")
    expected_manifest = os.environ.get("EXPECTED_SNAPSHOT_SHA256", "")
    if len(expected_manifest) != 64 or any(char not in "0123456789abcdef" for char in expected_manifest):
        raise SystemExit("EXPECTED_SNAPSHOT_SHA256 must pin the v8 CPU recipe")
    manifest = verify_manifest(expected_manifest)
    before = source_hashes(manifest)
    if any(before[item["path"]] != item["sha256"] for item in manifest["files"]):
        raise SystemExit("Snapshot source mismatch before v8 package build")
    if not (ROOT / BUILDER).is_file():
        raise SystemExit(f"Pinned package builder is missing: {BUILDER}")
    if (ROOT / OUTPUT).exists() and any((ROOT / OUTPUT).iterdir()):
        raise SystemExit("Refusing to package over an existing v8 output; use a fresh CI checkout")
    RESULTS.mkdir(parents=True, exist_ok=True)
    log = RESULTS / "v8-phase-stable-v1-cpu-package.log"
    receipt = RESULTS / "v8-phase-stable-v1-cpu-package.receipt.json"
    if log.exists() or receipt.exists():
        raise SystemExit("Refusing to overwrite a result; use a fresh CI checkout")

    command = ["node", "--max-old-space-size=96", str(BUILDER)]
    started = time.monotonic()
    peak_rss = 0
    monitor_samples = 0
    per_process_peak: dict[int, dict] = {}
    peak_process_rows: list[dict] = []
    zero_rss_breadcrumbs: list[dict] = []
    status, failure, child_code = "running", None, None
    process = None
    cleanup_verified = False
    try:
        with log.open("xb") as log_file:
            process = subprocess.Popen(command, cwd=ROOT, stdout=log_file, stderr=subprocess.STDOUT,
                                       start_new_session=True)
            while True:
                child_code = process.poll()
                if child_code is not None:
                    status = "completed" if monitor_samples else "monitor_error"
                    if not monitor_samples:
                        failure = "owned process group exited before the first positive RSS sample"
                    break
                try:
                    rows = process_rows(process.pid)
                    rss = sum(row["rssBytes"] for row in rows)
                    if rss <= 0:
                        first_rows = rows
                        deadline = time.monotonic() + ZERO_RSS_GRACE_SECONDS
                        while time.monotonic() < deadline and process.poll() is None:
                            time.sleep(0.025)
                            rows = process_rows(process.pid)
                            rss = sum(row["rssBytes"] for row in rows)
                            if rss > 0:
                                break
                        child_code = process.poll()
                        zero_rss_breadcrumbs.append({"atSeconds": round(time.monotonic() - started, 3),
                            "initialRows": first_rows, "finalRows": rows, "childExitCode": child_code})
                        if rss <= 0:
                            if child_code is not None and monitor_samples > 0:
                                status = "completed"
                                break
                            live_rows = [row for row in rows if not row["state"].startswith("Z")]
                            status, failure = "monitor_error", f"zero RSS remained after grace; live={live_rows!r}; rows={rows!r}"
                            break
                    monitor_samples += 1
                    if rss > peak_rss:
                        peak_rss, peak_process_rows = rss, rows
                    for row in rows:
                        previous = per_process_peak.get(row["pid"], {})
                        if row["rssBytes"] >= previous.get("rssBytes", 0):
                            per_process_peak[row["pid"]] = {**row, "atSeconds": round(time.monotonic() - started, 3)}
                    if rss > MAX_RSS_BYTES:
                        status, failure = "memory_limit", "owned v8 package process group exceeded 220 MiB RSS"
                        break
                except (OSError, RuntimeError, subprocess.SubprocessError, ValueError) as error:
                    child_code = process.poll()
                    if child_code is not None and monitor_samples > 0:
                        status = "completed"
                        break
                    status, failure = "monitor_error", str(error)
                    break
                if time.monotonic() - started > TIMEOUT_SECONDS:
                    status, failure = "timeout", "25 second v8 CPU packaging limit"
                    break
                time.sleep(0.025)
    except BaseException as error:
        status, failure = "runner_error", str(error)
    finally:
        if process is not None:
            if process.poll() is not None:
                child_code = process.returncode
            cleanup_verified = terminate_group(process)
            if process.returncode is not None:
                child_code = process.returncode
        try:
            after = source_hashes(manifest)
        except Exception as error:
            after = {"verificationError": str(error)}
        unchanged = before == after
        if not unchanged:
            status, failure = "source_changed", "one or more pinned v8 inputs changed during packaging"
        if process is not None and not cleanup_verified:
            status, failure = "cleanup_error", "owned process group did not fully terminate"
        try:
            output_records, artifact_sha, package_valid = artifact_inventory()
        except Exception as error:
            output_records, artifact_sha, package_valid = [], None, False
            if status == "completed":
                status, failure = "artifact_invalid", str(error)
        if status == "completed" and child_code != 0:
            failure = f"builder exited with status {child_code}"
        receipt_data = {
            "schema": "allworld-market-lod-v8-phase-stable-cpu-package-receipt-v1", "status": status,
            "failure": failure, "command": command, "processGroup": process.pid if process else None,
            "processGroupCleanupVerified": cleanup_verified, "childExitCode": child_code,
            "elapsedSeconds": round(time.monotonic() - started, 3), "peakGroupRssBytes": peak_rss,
            "peakGroupProcesses": peak_process_rows,
            "perProcessPeakRss": {str(pid): item for pid, item in sorted(per_process_peak.items())},
            "zeroRssTerminalBreadcrumbs": zero_rss_breadcrumbs,
            "rssLimitBytes": MAX_RSS_BYTES, "timeoutSeconds": TIMEOUT_SECONDS,
            "nodeHeapMiB": 96, "monitorSamples": monitor_samples,
            "sourceManifestSha256": expected_manifest, "sourceHashesBefore": before,
            "sourceHashesAfter": after, "sourceUnchanged": unchanged,
            "packageManifestExists": (ROOT / OUTPUT / "build-manifest.json").is_file(),
            "packageManifestStatusValid": package_valid, "sourceArtifactSha256": artifact_sha,
            "sourceArtifactFiles": output_records, "log": str(log),
            "scope": "Bounded CPU packaging only. No browser, visual, motion, or mobile acceptance.",
        }
        receipt.write_text(json.dumps(receipt_data, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(receipt_data, indent=2), flush=True)

    if status == "completed" and child_code == 0 and peak_rss <= MAX_RSS_BYTES and monitor_samples > 0 and cleanup_verified and unchanged and package_valid and artifact_sha:
        return 0
    if status in ("memory_limit", "source_changed", "monitor_error", "cleanup_error"):
        return 125
    if status == "timeout":
        return 124
    return child_code or 1


if __name__ == "__main__":
    raise SystemExit(main())
