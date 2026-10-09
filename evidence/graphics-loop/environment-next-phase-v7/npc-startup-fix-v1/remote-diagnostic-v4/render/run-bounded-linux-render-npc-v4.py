#!/usr/bin/env python3
"""Run the pinned Chrome/SwiftShader scene review in one owned PGID under fixed caps."""
from __future__ import annotations

import hashlib
import json
import os
import secrets
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path.cwd()
HERE = Path('evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/remote-diagnostic-v4/render')
EXPECTED_REVIEW_REF = 'refs/heads/codex/graphics-environment-npc-startup-fix-v1-render-v4'
PINS = HERE / 'review-sources-npc-v4.json'
REVIEWER = HERE / 'review-render-cdp-npc-v4.mjs'
WORKFLOW_STAGED = HERE / 'workflow-review-npc-v4.yml'
WORKFLOW_ACTIVE = Path('.github/workflows/graphics-environment-npc-startup-fix-v1-render-v4.yml')
RESULTS = HERE / 'remote-results'
MAX_RSS_BYTES = 2048 * 1024 * 1024
TIMEOUT_SECONDS = 60
PINNED_CPU_PACKAGE_RUN_ID = '37911271949'
PINNED_CPU_PACKAGE_COMMIT = '0da02ca0f0e0c4350f2754615f58b2dcd6eaed37'
ZERO_RSS_GRACE_SECONDS = 1.25
NODE = ['node', '--max-old-space-size=96']


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def durable_jsonl_rows(file: Path) -> list[dict]:
    if not file.exists():
        return []
    text = file.read_text(encoding='utf-8')
    complete = text if text.endswith('\n') else text[:text.rfind('\n') + 1]
    return [json.loads(line) for line in complete.splitlines() if line]


def verify_image_receipts(rows: list[dict], result_dir: Path) -> bool:
    root = result_dir.resolve()
    for row in rows:
        image = row.get('image')
        if not isinstance(image, dict):
            return False
        relative = image.get('path')
        expected_hash = image.get('sha256')
        expected_bytes = image.get('bytes')
        if not isinstance(relative, str) or not isinstance(expected_hash, str) or not isinstance(expected_bytes, int):
            return False
        target = root / relative
        try:
            resolved = target.resolve()
            resolved.relative_to(root)
        except (OSError, ValueError):
            return False
        if target.is_symlink() or not target.is_file() or resolved == root or target.stat().st_size != expected_bytes:
            return False
        digest = hashlib.sha256()
        with target.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(chunk)
        if digest.hexdigest() != expected_hash:
            return False
    return True


def verify_recipe(expected: str) -> tuple[dict, dict[str, str]]:
    raw = PINS.read_bytes()
    if sha(raw) != expected:
        raise RuntimeError('NPC startup render recipe pin digest mismatch')
    record = json.loads(raw)
    if record.get('schema') != 'environment-next-phase-v7-npc-startup-remote-review-pins/4':
        raise RuntimeError('unexpected NPC startup remote review source pin schema')
    limits = record.get('limits', {})
    if limits.get('ownedProcessGroupRssBytes') != MAX_RSS_BYTES or limits.get('timeoutSeconds') != TIMEOUT_SECONDS or limits.get('nodeOldSpaceMiB') != 96 or limits.get('maxParallel') != 3 or limits.get('screenshotTimeoutMs') != 7000:
        raise RuntimeError('render recipe limits differ from the fixed remote review harness')
    expected_package = {'runId': PINNED_CPU_PACKAGE_RUN_ID, 'commit': PINNED_CPU_PACKAGE_COMMIT,
                        'artifact': f'environment-npc-startup-fix-v1-package-v1-{PINNED_CPU_PACKAGE_RUN_ID}'}
    if record.get('selectedPackage') != expected_package:
        raise RuntimeError('review pin manifest does not bind the exact root-verified CPU artifact')
    if record.get('cpuSourceCheckout') != {'commit': PINNED_CPU_PACKAGE_COMMIT, 'sourcePinsSha256': 'a09ae72bb74ff945317129d4fd5533b1695c4db21733a3f099f28cd6d9f8c719'}:
        raise RuntimeError('review recipe does not pin the exact full CPU source attestation')
    expected_scopes = {f'{place}-{method}' for place in ('market', 'beach') for method in ('surface-true', 'surface-false', 'canvas-clip')}
    if set(record.get('scopes', [])) != expected_scopes or record.get('perScope') != {
        'screenshots': ['home-control', 'single target'], 'exactTargetCaptureAttempts': 1, 'peerTransitionsWithoutScreenshot': 1
    }:
        raise RuntimeError('review pin manifest does not describe the exact six-scope/two-capture protocol')
    if not WORKFLOW_ACTIVE.is_file() or sha(WORKFLOW_ACTIVE.read_bytes()) != sha(WORKFLOW_STAGED.read_bytes()):
        raise RuntimeError('active NPC workflow must exactly match its staged reviewed workflow')
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
    for required in (str(REVIEWER), str(HERE / 'scope-plan-npc-v4.mjs'), str(HERE / 'remote-control-npc-v4.mjs')):
        if required not in hashes:
            raise RuntimeError(f'required render control is not part of the sealed recipe: {required}')
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
    if len(sys.argv) != 6 or sys.argv[1] != 'browser':
        raise SystemExit('usage: run-bounded-linux-render-npc-v4.py browser expected-recipe-sha256 package-run-id package-commit-sha review-scope')
    if sys.platform != 'linux':
        raise SystemExit('Remote Linux only; refusing local execution')
    if os.environ.get('GITHUB_REF') != EXPECTED_REVIEW_REF:
        raise SystemExit(f'Refusing non-review branch: {os.environ.get("GITHUB_REF")}')
    expected, package_run_id, package_commit, review_scope = sys.argv[2:]
    if package_run_id != PINNED_CPU_PACKAGE_RUN_ID or package_commit != PINNED_CPU_PACKAGE_COMMIT:
        raise SystemExit('CPU package run/commit must match the root-verified pinned artifact')
    allowed_scopes = {f'{place}-{method}': 2 for place in ('market', 'beach') for method in ('surface-true', 'surface-false', 'canvas-clip')}
    if review_scope not in allowed_scopes:
        raise SystemExit('review scope must be a sealed Market/Beach × screenshot-method pair')
    review_commit = subprocess.run(['git', 'rev-parse', 'HEAD'], check=True, capture_output=True, text=True, timeout=3).stdout.strip()
    if review_commit != os.environ.get('GITHUB_SHA'):
        raise SystemExit('checkout does not match the render-review workflow commit')
    recipe, source_hashes = verify_recipe(expected)
    run_id = os.environ.get('GITHUB_RUN_ID')
    if not run_id or not run_id.isdigit():
        raise SystemExit('GITHUB_RUN_ID is required for unique remote results')
    if not review_scope.replace('-', '').isalnum():
        raise SystemExit('invalid review scope path component')
    result_dir = ROOT / RESULTS / f'{run_id}-{review_scope}'
    result_dir.mkdir(parents=True, exist_ok=False)
    log = result_dir / 'browser.log'
    receipt = result_dir / 'browser.receipt.json'
    stage_log = result_dir / 'supervisor-events.jsonl'
    owner_token = secrets.token_hex(16)
    with stage_log.open('x', encoding='utf-8') as stream:
        stream.write(json.dumps({'at': 0, 'stage': 'supervisor-initialized', 'ownerToken': owner_token,
                                 'runId': run_id, 'reviewScope': review_scope, 'processGroupRssLimitBytes': MAX_RSS_BYTES}) + '\n')
        stream.flush()
        os.fsync(stream.fileno())
    if not os.path.isabs(os.environ.get('CHROME_BIN', '')):
        raise SystemExit('CHROME_BIN must be an absolute runner-provided binary path')
    package_root = ROOT / HERE / 'package-input'
    artifact = f'environment-npc-startup-fix-v1-package-v1-{package_run_id}'
    cpu_source_root = ROOT / 'cpu-source-input'
    if not cpu_source_root.is_dir():
        raise SystemExit('cpu-source-input checkout is required for sealed source verification')
    env = {**os.environ, 'RESULT_DIR': str(result_dir), 'PACKAGE_ROOT': str(package_root), 'CPU_SOURCE_ROOT': str(cpu_source_root), 'PINNED_CPU_PACKAGE_COMMIT': package_commit, 'PINNED_CPU_PACKAGE_RUN_ID': package_run_id, 'PINNED_CPU_PACKAGE_ARTIFACT': artifact, 'GITHUB_RUN_ID': run_id, 'REVIEW_SCOPE': review_scope, 'SUPERVISOR_OWNER_TOKEN': owner_token}
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
    def log_stage(stage: str, **fields: object) -> None:
        event = {'at': round(time.monotonic() - started, 3), 'stage': stage, 'ownerToken': owner_token, **fields}
        with stage_log.open('a', encoding='utf-8') as stream:
            stream.write(json.dumps(event, separators=(',', ':')) + '\n')
            stream.flush()
    try:
        with log.open('xb') as stream:
            process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
            group = process.pid
            log_stage('controller-started', pid=process.pid, pgid=group, nodeOldSpaceMiB=96, rssLimitBytes=MAX_RSS_BYTES, timeoutSeconds=TIMEOUT_SECONDS)
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
                    if now - lastProgress >= 1:
                        log_stage('process-sample', processGroupRssBytes=rss, peakProcessGroupRssBytes=peak,
                                  processes=rows, perProcessPeakRss=per_process_peak)
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
                    status, failure = 'memory-limit', 'renderer/server/controller PGID exceeded 2048 MiB remote diagnostic RSS'
                    log_stage('memory-limit', rssBytes=rss, limitBytes=MAX_RSS_BYTES, processes=rows)
                    break
                if elapsed > TIMEOUT_SECONDS:
                    status, failure = 'timeout', 'renderer/server/controller PGID exceeded 60 seconds'
                    log_stage('timeout', elapsedSeconds=round(elapsed, 3), processes=rows)
                    break
                if elapsed - lastProgress >= 1:
                    print(json.dumps({'stage': 'render-review-running', 'elapsedSeconds': round(elapsed, 2), 'processGroup': group,
                                      'rssBytes': rss, 'peakRssBytes': peak, 'limitBytes': MAX_RSS_BYTES}), flush=True)
                    lastProgress = elapsed
                time.sleep(0.05)
            if status == 'completed' and code not in (0, None):
                status = 'browser-failed'
            log_stage('controller-exited', status=status, exitCode=code)
    except BaseException as error:
        status, failure = 'runner-error', str(error)
        if stage_log.exists():
            log_stage('runner-error', error=str(error), processGroup=group)
        if process is not None and group is not None:
            kill_group(group, process)
    finally:
        if process is not None and group is not None:
            log_stage('cleanup-start', status=status, processGroup=group)
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
        if stage_log.exists():
            log_stage('cleanup-complete', cleanupVerified=cleanup_verified, status=status, exitCode=code,
                      peakProcessGroupRssBytes=peak, perProcessPeakRss=per_process_peak)
        try:
            detail = json.loads((result_dir / 'render-review-results.json').read_text())
        except (OSError, json.JSONDecodeError):
            detail = None
    report = {'schema': 'environment-next-phase-v7-npc-startup-render-run-receipt/2', 'mode': 'browser', 'status': status, 'failure': failure,
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
    capture_progress = result_dir / 'captures-progress.jsonl'
    captures_persisted = durable_jsonl_rows(capture_progress)
    report['reviewScope'] = review_scope
    report['persistedCaptureCount'] = len(captures_persisted)
    report['expectedCaptureCount'] = allowed_scopes[review_scope]
    report['persistedCaptureReceiptsValid'] = all(row.get('valid') is True for row in captures_persisted)
    report['persistedCaptureImagesValid'] = verify_image_receipts(captures_persisted, result_dir)
    report['partialReceiptCount'] = len(captures_persisted)
    report['detailCaptureCount'] = len(detail.get('captures', [])) if detail else None
    report['preCaptureProofCount'] = len(durable_jsonl_rows(result_dir / 'pre-capture-proofs.jsonl'))
    report['captureAttemptCount'] = len(durable_jsonl_rows(result_dir / 'capture-attempts.jsonl'))
    report['peerTransitionProofCount'] = len(durable_jsonl_rows(result_dir / 'peer-transition-progress.jsonl'))
    report['startupProgressSampleCount'] = len(durable_jsonl_rows(result_dir / 'startup-progress.jsonl'))
    report['scopeSuccess'] = (len(captures_persisted) == allowed_scopes[review_scope]
        and report['persistedCaptureReceiptsValid'] and report['persistedCaptureImagesValid']
        and report['preCaptureProofCount'] == allowed_scopes[review_scope]
        and report['captureAttemptCount'] == allowed_scopes[review_scope] * 2
        and report['peerTransitionProofCount'] == 1 and bool(detail and detail.get('success') is True))
    receipt.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2), flush=True)
    return 0 if status == 'completed' and code == 0 and peak <= MAX_RSS_BYTES and samples > 0 and cleanup_verified and unchanged and report['scopeSuccess'] else 125 if status in ('memory-limit', 'monitor-error', 'source-changed', 'cleanup-error') else 124 if status == 'timeout' else (code or 1)


if __name__ == '__main__':
    raise SystemExit(main())
