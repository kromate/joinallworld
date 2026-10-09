#!/usr/bin/env python3
"""Run the reviewed v5 phases serially under one owned Linux process-group limit."""
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path.cwd()
HERE = Path('evidence/graphics-loop/environment-next-phase-v5')
REVIEWED = HERE / 'remote-ci-preparation/reviewed-v2'
RESULTS = REVIEWED / 'remote-results'
MAX_RSS_BYTES = 220 * 1024 * 1024
TIMEOUT_SECONDS = 25
EXPECTED_REF = 'refs/heads/codex/graphics-environment-next-phase-v5-review'
NODE = ['node', '--max-old-space-size=96', '--expose-gc', '--experimental-strip-types']
PHASES = [
    ('source-seal', REVIEWED / 'seal-source-pins-reviewed-v5.mjs'),
    ('compile-only', REVIEWED / 'build-compile-v5.mjs'),
    ('compile-output-seal', REVIEWED / 'seal-finalizer-reviewed-v5.mjs'),
    ('single-public-copy-finalize', REVIEWED / 'finalize-package-v5.mjs'),
    ('review-host-stage', REVIEWED / 'prepare-review-host-reviewed-v5.mjs'),
]


def process_rows(group: int) -> list[tuple[int, int]]:
    result = subprocess.run(['ps', '-e', '-o', 'pid=,pgid=,rss='], check=True, capture_output=True, text=True, timeout=2)
    rows = []
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) == 3 and int(parts[1]) == group:
            rows.append((int(parts[0]), int(parts[2]) * 1024))
    return rows


def stop_children(group: int, self_pid: int, sig: int = signal.SIGTERM) -> None:
    try:
        for pid, _rss in process_rows(group):
            if pid != self_pid:
                try:
                    os.kill(pid, sig)
                except ProcessLookupError:
                    pass
    except Exception:
        pass


def terminate_phase(group: int, self_pid: int, child: subprocess.Popen) -> None:
    """Bound cleanup to this runner's isolated PGID and never signal its parent."""
    stop_children(group, self_pid, signal.SIGTERM)
    try:
        child.wait(timeout=2)
    except subprocess.TimeoutExpired:
        stop_children(group, self_pid, signal.SIGKILL)
        try:
            child.wait(timeout=1)
        except subprocess.TimeoutExpired:
            # The phase leader should be dead after SIGKILL; preserve the receipt
            # path even if the OS reports a short-lived uninterruptible process.
            pass


def cleanup_group(group: int, self_pid: int) -> None:
    stop_children(group, self_pid, signal.SIGTERM)
    deadline = time.monotonic() + 0.5
    while time.monotonic() < deadline:
        try:
            if not [pid for pid, _rss in process_rows(group) if pid != self_pid]:
                return
        except Exception:
            return
        time.sleep(0.025)
    stop_children(group, self_pid, signal.SIGKILL)


def main() -> int:
    if sys.platform != 'linux':
        raise SystemExit('Remote-only Linux runner; local execution is refused')
    if os.environ.get('GITHUB_REF') != EXPECTED_REF:
        raise SystemExit(f'Refusing non-review branch: {os.environ.get("GITHUB_REF")}')
    expected_sha = os.environ.get('GITHUB_SHA', '')
    actual_sha = subprocess.run(['git', 'rev-parse', 'HEAD'], check=True, capture_output=True, text=True, timeout=2).stdout.strip()
    if not expected_sha or actual_sha != expected_sha:
        raise SystemExit('Checkout commit differs from the workflow event commit')
    if os.getpid() != os.getpgrp():
        os.setsid()
    owned_group = os.getpgrp()
    RESULTS.mkdir(parents=True, exist_ok=True)
    log = RESULTS / 'v5-reviewed-package.log'
    events = RESULTS / 'v5-reviewed-events.jsonl'
    receipt = RESULTS / 'v5-reviewed-package.receipt.json'
    if log.exists() or events.exists() or receipt.exists():
        raise SystemExit('Refusing to overwrite prior result; use a clean workflow checkout')
    started = time.monotonic()
    peak = 0
    phase_rows = []
    failure = None
    status = 'running'
    child_code = None
    current = None
    command = None

    def event(stage: str, **extra) -> None:
        row = {'elapsedSeconds': round(time.monotonic() - started, 3), 'stage': stage, **extra}
        with events.open('a', encoding='utf-8') as stream:
            stream.write(json.dumps(row) + '\n')
        print(json.dumps(row), flush=True)

    try:
        with log.open('xb') as log_file:
            for name, script in PHASES:
                if not (ROOT / script).is_file():
                    status, failure = 'missing-phase', str(script)
                    break
                if time.monotonic() - started >= TIMEOUT_SECONDS:
                    status, failure = 'timeout', '25-second total pipeline bound before next phase'
                    break
                command = NODE + [str(script)]
                event('phase-start', phase=name, command=command, processGroup=owned_group)
                current = subprocess.Popen(command, cwd=ROOT, stdout=log_file, stderr=subprocess.STDOUT)
                phase_started = time.monotonic()
                while current.poll() is None:
                    try:
                        rows = process_rows(owned_group)
                        rss = sum(value for _pid, value in rows)
                        peak = max(peak, rss)
                    except (OSError, RuntimeError, subprocess.SubprocessError, ValueError, IndexError) as error:
                        status, failure = 'monitor-error', str(error)
                        terminate_phase(owned_group, os.getpid(), current)
                        child_code = current.returncode
                        break
                    if rss > MAX_RSS_BYTES:
                        status, failure = 'memory-limit', 'owned serial Node process group exceeded 220 MiB RSS'
                        terminate_phase(owned_group, os.getpid(), current)
                        child_code = current.returncode
                        break
                    if time.monotonic() - started > TIMEOUT_SECONDS:
                        status, failure = 'timeout', '25-second total pipeline bound'
                        terminate_phase(owned_group, os.getpid(), current)
                        child_code = current.returncode
                        break
                    time.sleep(0.025)
                if status != 'running':
                    break
                child_code = current.wait()
                phase_elapsed = round(time.monotonic() - phase_started, 3)
                phase_rows.append({'phase': name, 'exitCode': child_code, 'elapsedSeconds': phase_elapsed})
                event('phase-terminal', phase=name, exitCode=child_code, elapsedSeconds=phase_elapsed)
                if child_code != 0:
                    status, failure = 'phase-failed', f'{name} exited {child_code}'
                    break
        if status == 'running':
            status = 'completed'
    except BaseException as error:
        status, failure = 'runner-error', str(error)
        if current is not None and current.poll() is None:
            terminate_phase(owned_group, os.getpid(), current)
        raise
    finally:
        # Remove any helper descendants left behind by a phase before writing
        # the terminal receipt. The PGID was created by this process via setsid.
        if current is not None and current.poll() is None:
            terminate_phase(owned_group, os.getpid(), current)
        cleanup_group(owned_group, os.getpid())
        elapsed = time.monotonic() - started
        source_pins = HERE / 'source-pins.json'
        compile_record = HERE / 'compile-v5-record.json'
        build_manifest = HERE / 'static-v5/build-manifest.json'
        host_manifest = HERE / 'static-fixture/build-manifest.json'
        finalization = HERE / 'finalization-v5-observed.json'
        try:
            pins = json.loads(source_pins.read_text(encoding='utf-8')) if source_pins.is_file() else None
        except (OSError, json.JSONDecodeError):
            pins = None
        try:
            manifest = json.loads(build_manifest.read_text(encoding='utf-8')) if build_manifest.is_file() else None
        except (OSError, json.JSONDecodeError):
            manifest = None
        try:
            compile_outputs = len(json.loads(compile_record.read_text(encoding='utf-8')).get('outputs', [])) if compile_record.is_file() else None
        except (OSError, json.JSONDecodeError, TypeError, AttributeError):
            compile_outputs = None
        report = {
            'status': status, 'failure': failure, 'childExitCode': child_code,
            'commitSha': actual_sha, 'workflowRef': os.environ.get('GITHUB_REF'),
            'phaseCommandLast': command, 'phaseResults': phase_rows, 'processGroup': owned_group,
            'elapsedSeconds': round(elapsed, 3), 'peakOwnedGroupRssBytes': peak,
            'rssLimitBytes': MAX_RSS_BYTES, 'totalTimeoutSeconds': TIMEOUT_SECONDS,
            'sourcePinsSha256': __import__('hashlib').sha256(source_pins.read_bytes()).hexdigest() if source_pins.is_file() else None,
            'sourcePinsSchema': pins.get('schema') if pins else None,
            'compileRecordExists': compile_record.is_file(), 'compiledOutputCount': compile_outputs,
            'buildManifestExists': build_manifest.is_file(), 'buildManifestStatus': manifest.get('status') if manifest else None,
            'reviewHostManifestExists': host_manifest.is_file(), 'finalizationReceiptExists': finalization.is_file(),
            'log': str(log), 'events': str(events),
            'scope': 'Separate Node source-seal, compile-only, compile-seal, single public-copy finalizer, and route-host staging phases. Diagnostic package only; no production budgets, pixels, GPU, or phone claim.',
        }
        receipt.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(report, indent=2), flush=True)
    if status == 'completed' and child_code == 0 and peak <= MAX_RSS_BYTES and build_manifest.is_file() and host_manifest.is_file() and finalization.is_file():
        return 0
    if status in ('memory-limit', 'source-changed', 'monitor-error'):
        return 125
    if status == 'timeout':
        return 124
    return child_code or 1


if __name__ == '__main__':
    raise SystemExit(main())
