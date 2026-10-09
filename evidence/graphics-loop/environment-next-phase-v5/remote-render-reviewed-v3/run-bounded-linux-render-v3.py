#!/usr/bin/env python3
"""Run the pinned Chrome/SwiftShader scene review in one owned PGID under fixed caps."""
from __future__ import annotations

import hashlib
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path.cwd()
HERE = Path('evidence/graphics-loop/environment-next-phase-v5/remote-render-reviewed-v3')
FIXTURE = Path('evidence/graphics-loop/environment-next-phase-v5')
PINS = HERE / 'review-sources-v3.json'
REVIEWER = HERE / 'review-render-cdp-v3.mjs'
WORKFLOW_STAGED = HERE / 'workflow.yml'
WORKFLOW_ACTIVE = Path('.github/workflows/graphics-environment-next-phase-v5-render-review-v3.yml')
RESULTS = HERE / 'remote-results'
MAX_RSS_BYTES = 1280 * 1024 * 1024
TIMEOUT_SECONDS = 60
ZERO_RSS_GRACE_SECONDS = 1.25
NODE = ['node', '--max-old-space-size=96']


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def verify_recipe(expected: str) -> tuple[dict, dict[str, str]]:
    raw = PINS.read_bytes()
    if sha(raw) != expected:
        raise RuntimeError('remote render v3 recipe pin digest mismatch')
    record = json.loads(raw)
    if record.get('schema') != 'environment-next-phase-v5-remote-render-source-pins/3':
        raise RuntimeError('unexpected remote render recipe pin schema')
    if record.get('packageRunId') != '37892370818' or record.get('packageCommit') != '6ad217d26d02c268af70ccb69758bca75b19d6f4':
        raise RuntimeError('render recipe does not pin the requested successful v4 package')
    if record.get('packageArtifact') != 'environment-whole-slice-v5-reviewed-v4-37892370818':
        raise RuntimeError('render recipe artifact name is not the fixed successful v4 package')
    limits = record.get('limits', {})
    if limits.get('ownedProcessGroupRssBytes') != MAX_RSS_BYTES or limits.get('timeoutSeconds') != TIMEOUT_SECONDS or limits.get('nodeOldSpaceMiB') != 96:
        raise RuntimeError('render recipe limits differ from the fixed remote review harness')
    if not WORKFLOW_ACTIVE.is_file() or sha(WORKFLOW_ACTIVE.read_bytes()) != sha(WORKFLOW_STAGED.read_bytes()):
        raise RuntimeError('active v3 workflow must exactly match its staged reviewed workflow')
    hashes = {}
    for item in record.get('files', []):
        rel = Path(item['path'])
        if rel.is_absolute() or '..' in rel.parts:
            raise RuntimeError(f'unsafe recipe source path: {rel}')
        target = ROOT / rel
        if target.is_symlink() or target.resolve() != target or not target.is_file():
            raise RuntimeError(f'missing or symlinked recipe source: {rel}')
        got = sha(target.read_bytes())
        if got != item.get('sha256') or target.stat().st_size != item.get('bytes'):
            raise RuntimeError(f'recipe source hash mismatch: {rel}')
        hashes[str(rel)] = got
    if str(REVIEWER) not in hashes:
        raise RuntimeError('CDP reviewer is not part of the sealed recipe')
    return record, hashes


def process_snapshot(group: int) -> list[dict]:
    """Return PGID processes with state, so terminal zombies are distinguishable."""
    result = subprocess.run(['ps', '-e', '-o', 'pid=,pgid=,rss=,stat=,comm='], check=True, capture_output=True, text=True, timeout=2)
    rows = []
    for line in result.stdout.splitlines():
        parts = line.split(None, 4)
        if len(parts) != 5:
            continue
        pid_s, group_s, rss_s, state, command = parts
        if int(group_s) == group:
            rows.append({'pid': int(pid_s), 'rssBytes': int(rss_s) * 1024, 'state': state, 'command': command})
    return rows


def group_rss(rows: list[dict]) -> int:
    return sum(row['rssBytes'] for row in rows)


def kill_group(group: int, proc: subprocess.Popen) -> bool:
    """Terminate/reap the owned PGID and verify that no member remains."""
    try:
        initial = process_snapshot(group)
    except (OSError, RuntimeError, subprocess.SubprocessError, ValueError):
        try:
            os.killpg(group, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            proc.wait(timeout=1.5)
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(group, signal.SIGKILL)
        except ProcessLookupError:
            pass
        return False
    if initial:
        try:
            os.killpg(group, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        proc.wait(timeout=1.5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(group, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            proc.wait(timeout=1.5)
        except subprocess.TimeoutExpired:
            return False
    deadline = time.monotonic() + 1.0
    remaining = initial
    while time.monotonic() < deadline:
        try:
            remaining = process_snapshot(group)
        except (OSError, RuntimeError, subprocess.SubprocessError, ValueError):
            try:
                os.killpg(group, signal.SIGKILL)
            except ProcessLookupError:
                pass
            return False
        if not remaining:
            return proc.poll() is not None
        time.sleep(0.05)
    try:
        os.killpg(group, signal.SIGKILL)
    except ProcessLookupError:
        pass
    try:
        proc.wait(timeout=1.5)
    except subprocess.TimeoutExpired:
        return False
    deadline = time.monotonic() + 1.5
    while time.monotonic() < deadline:
        try:
            remaining = process_snapshot(group)
        except (OSError, RuntimeError, subprocess.SubprocessError, ValueError):
            return False
        if not remaining:
            return True
        time.sleep(0.05)
    return False


def main() -> int:
    if len(sys.argv) != 4 or sys.argv[1] != 'browser':
        raise SystemExit('usage: run-bounded-linux-render-v3.py browser expected-recipe-sha256 package-run-id package-commit-sha')
    if sys.platform != 'linux':
        raise SystemExit('Remote Linux only; refusing local execution')
    expected, package_run_id, package_commit = sys.argv[2:]
    if package_run_id != '37892370818' or package_commit != '6ad217d26d02c268af70ccb69758bca75b19d6f4':
        raise SystemExit('this review is pinned to package run 37892370818 and commit 6ad217d26d02c268af70ccb69758bca75b19d6f4')
    review_commit = subprocess.run(['git', 'rev-parse', 'HEAD'], check=True, capture_output=True, text=True, timeout=3).stdout.strip()
    if review_commit != os.environ.get('GITHUB_SHA'):
        raise SystemExit('checkout does not match the render-review workflow commit')
    recipe, source_hashes = verify_recipe(expected)
    run_id = os.environ.get('GITHUB_RUN_ID')
    if not run_id or not run_id.isdigit():
        raise SystemExit('GITHUB_RUN_ID is required for unique remote results')
    result_dir = ROOT / RESULTS / run_id
    result_dir.mkdir(parents=True, exist_ok=False)
    log = result_dir / 'browser.log'
    receipt = result_dir / 'browser.receipt.json'
    if not os.path.isabs(os.environ.get('CHROME_BIN', '')):
        raise SystemExit('CHROME_BIN must be an absolute runner-provided binary path')
    package_root = ROOT / HERE / 'package-input'
    env = {**os.environ, 'RESULT_DIR': str(result_dir), 'PACKAGE_ROOT': str(package_root), 'PACKAGE_COMMIT_SHA': package_commit, 'REVIEW_COMMIT_SHA': review_commit}
    command = NODE + [str(ROOT / REVIEWER), expected]
    started = time.monotonic()
    peak = 0
    samples = 0
    per_process_peak: dict[int, dict] = {}
    peak_group_processes: list[dict] = []
    breadcrumbs: list[dict] = []
    process = None
    group = None
    code = None
    status = 'running'
    failure = None
    cleanup_verified = False
    try:
        with log.open('xb') as stream:
            process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
            group = process.pid
            lastProgress = 0.0
            while True:
                code = process.poll()
                if code is not None:
                    status = 'completed' if samples > 0 else 'monitor-error'
                    if samples == 0:
                        failure = 'owned process group exited before the first positive RSS sample'
                    break
                try:
                    rows = process_snapshot(group)
                    rss = group_rss(rows)
                    if rss <= 0:
                        breadcrumb = {'atSeconds': round(time.monotonic() - started, 3), 'reason': 'zero-or-absent-rss', 'processes': rows}
                        deadline = time.monotonic() + ZERO_RSS_GRACE_SECONDS
                        while time.monotonic() < deadline:
                            code = process.poll()
                            if code is not None:
                                break
                            time.sleep(0.04)
                            rows = process_snapshot(group)
                            rss = group_rss(rows)
                            if rss > 0:
                                break
                        breadcrumb['afterGraceProcesses'] = rows
                        breadcrumb['childExitCode'] = process.poll()
                        breadcrumbs.append(breadcrumb)
                        if rss <= 0:
                            live = [row for row in rows if not row['state'].startswith('Z')]
                            if process.poll() is not None and samples > 0:
                                code, status = process.returncode, 'completed'
                            else:
                                status, failure = 'monitor-error', f'owned process group had no positive RSS after grace; liveProcesses={live!r}; childExitCode={process.poll()}'
                            break
                    samples += 1
                    if rss > peak:
                        peak, peak_group_processes = rss, rows
                    now = round(time.monotonic() - started, 3)
                    for row in rows:
                        old = per_process_peak.get(row['pid'], {})
                        if row['rssBytes'] >= old.get('rssBytes', 0):
                            per_process_peak[row['pid']] = {**row, 'atSeconds': now}
                except (OSError, RuntimeError, subprocess.SubprocessError, ValueError) as error:
                    code = process.poll()
                    breadcrumbs.append({'atSeconds': round(time.monotonic() - started, 3), 'reason': 'process-snapshot-error', 'error': str(error), 'childExitCode': code})
                    if code is not None and samples > 0:
                        status = 'completed'
                    else:
                        status, failure = 'monitor-error', str(error)
                    break
                elapsed = time.monotonic() - started
                if rss > MAX_RSS_BYTES:
                    status, failure = 'memory-limit', 'renderer/server/controller PGID exceeded 1280 MiB RSS'
                    break
                if elapsed > TIMEOUT_SECONDS:
                    status, failure = 'timeout', 'renderer/server/controller PGID exceeded 60 seconds'
                    break
                if elapsed - lastProgress >= 1:
                    print(json.dumps({'stage': 'render-review-running', 'elapsedSeconds': round(elapsed, 2), 'processGroup': group,
                                      'rssBytes': rss, 'peakRssBytes': peak, 'limitBytes': MAX_RSS_BYTES}), flush=True)
                    lastProgress = elapsed
                time.sleep(0.05)
            if status == 'completed' and code not in (0, None):
                status = 'browser-failed'
    except BaseException as error:
        status, failure = 'runner-error', str(error)
        if process is not None and group is not None:
            kill_group(group, process)
    finally:
        if process is not None and group is not None:
            cleanup_verified = kill_group(group, process)
            code = process.returncode if process.returncode is not None else code
        else:
            cleanup_verified = True
        try:
            _after_recipe, after_hashes = verify_recipe(expected)
        except Exception as error:
            status, failure = 'source-changed', str(error)
            after_hashes = {'verificationError': str(error)}
        unchanged = source_hashes == after_hashes
        if not unchanged:
            status, failure = 'source-changed', 'review source hashes changed during remote render'
        if not cleanup_verified:
            status, failure = 'cleanup-error', 'could not verify complete owned process group cleanup'
        try:
            detail = json.loads((result_dir / 'render-review-results.json').read_text())
        except (OSError, json.JSONDecodeError):
            detail = None
    report = {'schema': 'environment-next-phase-v5-remote-render-run-receipt/3', 'mode': 'browser', 'status': status, 'failure': failure,
              'exitCode': code, 'workflowRunId': run_id, 'packageRunId': package_run_id,
              'packageCommit': package_commit, 'reviewCommit': review_commit, 'reviewSourcePinsSha256': expected, 'reviewSourcesBefore': source_hashes,
              'reviewSourcesAfter': after_hashes, 'reviewSourcesUnchanged': unchanged, 'processGroup': group,
              'processGroupCleanupVerified': cleanup_verified, 'elapsedSeconds': round(time.monotonic() - started, 3),
              'peakProcessGroupRssBytes': peak, 'peakGroupProcesses': peak_group_processes,
              'perProcessPeakRss': {str(pid): item for pid, item in sorted(per_process_peak.items())},
              'terminalProcessBreadcrumbs': breadcrumbs[-12:], 'rssLimitBytes': MAX_RSS_BYTES,
              'timeLimitSeconds': TIMEOUT_SECONDS, 'zeroRssGraceSeconds': ZERO_RSS_GRACE_SECONDS, 'monitorSamples': samples,
              'detailStatus': detail.get('status') if detail else None, 'captureCount': len(detail.get('captures', [])) if detail else 0,
              'resultDirectory': str(result_dir.relative_to(ROOT)),
              'scope': 'Remote headless Chrome/ANGLE SwiftShader review. Screenshots and scene diagnostics only; no production GPU, mobile, or battery claim.'}
    receipt.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2), flush=True)
    return 0 if status == 'completed' and code == 0 and peak <= MAX_RSS_BYTES and samples > 0 and cleanup_verified and unchanged else 125 if status in ('memory-limit', 'monitor-error', 'source-changed', 'cleanup-error') else 124 if status == 'timeout' else (code or 1)


if __name__ == '__main__':
    raise SystemExit(main())
