#!/usr/bin/env python3
"""Run isolated v3 compile/finalization processes under the unchanged Linux limits."""
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path.cwd()
HERE = Path('evidence/graphics-loop/environment-next-phase-v5')
REVIEWED = HERE / 'remote-ci-preparation/reviewed-v3'
RESULTS = REVIEWED / 'remote-results'
MAX_RSS_BYTES = 220 * 1024 * 1024
TIMEOUT_SECONDS = 25
EXPECTED_REF = 'refs/heads/codex/graphics-environment-next-phase-v5-review-v3'
NODE = ['node', '--max-old-space-size=96']
PHASES = [
    ('source-seal', [*NODE, str(REVIEWED / 'seal-source-pins-v3.mjs')]),
    ('full-precompile-verification', [*NODE, str(REVIEWED / 'verify-source-pins-v3.mjs'), 'precompile']),
    ('three-vendor-compile', [*NODE, str(REVIEWED / 'compile-vendor-v3.mjs')]),
    ('three-addon-compile', [*NODE, str(REVIEWED / 'compile-addons-v3.mjs')]),
    ('full-app-compile', [*NODE, str(REVIEWED / 'compile-app-v3.mjs')]),
    ('compiled-output-seal', [*NODE, str(REVIEWED / 'seal-compiled-output-v3.mjs')]),
    ('full-postcompile-verification', [*NODE, str(REVIEWED / 'verify-source-pins-v3.mjs'), 'postcompile']),
    ('finalizer-seal', [*NODE, str(REVIEWED / 'seal-finalizer-v3.mjs')]),
    ('single-public-copy-finalize', [*NODE, str(REVIEWED / 'finalize-package-v3.mjs')]),
    ('review-host-stage', [*NODE, str(REVIEWED / 'prepare-review-host-v3.mjs')]),
]


def process_rows(group: int) -> list[tuple[int, int]]:
    result = subprocess.run(['ps', '-e', '-o', 'pid=,pgid=,rss='], check=True, capture_output=True, text=True, timeout=2)
    rows = []
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) == 3 and int(parts[1]) == group:
            rows.append((int(parts[0]), int(parts[2]) * 1024))
    return rows


def signal_owned_children(group: int, self_pid: int, sig: int) -> None:
    for pid, _rss in process_rows(group):
        if pid == self_pid:
            continue
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            pass


def terminate_phase(group: int, self_pid: int, child: subprocess.Popen) -> None:
    try:
        signal_owned_children(group, self_pid, signal.SIGTERM)
    except Exception:
        pass
    try:
        child.wait(timeout=1.5)
    except subprocess.TimeoutExpired:
        try:
            signal_owned_children(group, self_pid, signal.SIGKILL)
        except Exception:
            pass
        try:
            child.wait(timeout=1.0)
        except subprocess.TimeoutExpired:
            pass


def cleanup_group(group: int, self_pid: int) -> None:
    for sig, delay in ((signal.SIGTERM, 0.25), (signal.SIGKILL, 0)):
        try:
            signal_owned_children(group, self_pid, sig)
        except Exception:
            return
        if sig == signal.SIGKILL:
            return
        deadline = time.monotonic() + delay
        while time.monotonic() < deadline:
            try:
                if not [pid for pid, _rss in process_rows(group) if pid != self_pid]:
                    return
            except Exception:
                return
            time.sleep(0.025)


def main() -> int:
    if sys.platform != 'linux':
        raise SystemExit('Remote-only Linux runner; local execution is refused')
    if os.environ.get('GITHUB_REF') != EXPECTED_REF:
        raise SystemExit(f'Refusing non-review branch: {os.environ.get("GITHUB_REF")}')
    expected_sha = os.environ.get('GITHUB_SHA', '')
    actual_sha = subprocess.run(['git', 'rev-parse', 'HEAD'], check=True, capture_output=True, text=True, timeout=2).stdout.strip()
    if not expected_sha or actual_sha != expected_sha:
        raise SystemExit('Checkout commit differs from workflow event commit')
    if os.getpid() != os.getpgrp():
        os.setsid()
    group = os.getpgrp()
    RESULTS.mkdir(parents=True, exist_ok=True)
    log, events, receipt = RESULTS / 'v5-reviewed-v3.log', RESULTS / 'v5-reviewed-v3-events.jsonl', RESULTS / 'v5-reviewed-v3.receipt.json'
    if any(path.exists() for path in (log, events, receipt)):
        raise SystemExit('Refusing to overwrite existing v3 remote result')
    start = time.monotonic()
    peak = 0
    rows = []
    status, failure, child_code = 'running', None, None
    current = None
    command = None
    phase_env = os.environ.copy()
    # Bound esbuild's Go scheduler fan-out without changing any memory/time acceptance limit.
    phase_env['GOMAXPROCS'] = '1'

    def event(stage: str, **extra) -> None:
        data = {'elapsedSeconds': round(time.monotonic() - start, 3), 'stage': stage, **extra}
        with events.open('a', encoding='utf-8') as stream:
            stream.write(json.dumps(data) + '\n')
        print(json.dumps(data), flush=True)

    try:
        with log.open('xb') as output:
            for name, cmd in PHASES:
                script = Path(cmd[-1]) if cmd[-1].endswith(('.mjs', '.py')) else None
                if script is not None and not (ROOT / script).is_file():
                    status, failure = 'missing-phase', str(script)
                    break
                if time.monotonic() - start >= TIMEOUT_SECONDS:
                    status, failure = 'timeout', '25-second total pipeline bound before phase start'
                    break
                command = cmd
                event('phase-start', phase=name, command=cmd, processGroup=group)
                current = subprocess.Popen(cmd, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT, env=phase_env)
                phase_start = time.monotonic()
                while current.poll() is None:
                    try:
                        rss = sum(value for _pid, value in process_rows(group))
                        peak = max(peak, rss)
                    except Exception as error:
                        status, failure = 'monitor-error', str(error)
                        terminate_phase(group, os.getpid(), current)
                        child_code = current.returncode
                        break
                    if rss > MAX_RSS_BYTES:
                        status, failure = 'memory-limit', 'owned process group exceeded unchanged 220 MiB RSS limit'
                        terminate_phase(group, os.getpid(), current)
                        child_code = current.returncode
                        break
                    if time.monotonic() - start > TIMEOUT_SECONDS:
                        status, failure = 'timeout', 'unchanged 25-second total pipeline bound'
                        terminate_phase(group, os.getpid(), current)
                        child_code = current.returncode
                        break
                    time.sleep(0.025)
                if status != 'running':
                    break
                child_code = current.wait()
                duration = round(time.monotonic() - phase_start, 3)
                rows.append({'phase': name, 'exitCode': child_code, 'elapsedSeconds': duration})
                event('phase-terminal', phase=name, exitCode=child_code, elapsedSeconds=duration)
                if child_code != 0:
                    status, failure = 'phase-failed', f'{name} exited {child_code}'
                    break
        if status == 'running':
            status = 'completed'
    except BaseException as error:
        status, failure = 'runner-error', str(error)
        raise
    finally:
        if current is not None and current.poll() is None:
            terminate_phase(group, os.getpid(), current)
        cleanup_group(group, os.getpid())
        manifest_path = HERE / 'static-v3/build-manifest.json'
        host_manifest_path = HERE / 'static-fixture-v3/build-manifest.json'
        compile_path = HERE / 'compile-v3-record.json'
        finalization_path = HERE / 'finalization-v3-observed.json'
        try:
            pins_bytes = (HERE / 'source-pins-v3.json').read_bytes()
            pins_sha = __import__('hashlib').sha256(pins_bytes).hexdigest()
        except (OSError, ValueError):
            pins_sha = None
        try:
            compile_obj = json.loads(compile_path.read_text()) if compile_path.is_file() else None
            output_count = len(compile_obj.get('outputs', [])) if compile_obj else None
        except (OSError, json.JSONDecodeError, AttributeError):
            output_count = None
        report = {
            'status': status, 'failure': failure, 'childExitCode': child_code, 'commitSha': actual_sha,
            'workflowRef': os.environ.get('GITHUB_REF'), 'phaseCommandLast': command, 'phaseResults': rows,
            'processGroup': group, 'elapsedSeconds': round(time.monotonic() - start, 3), 'peakOwnedGroupRssBytes': peak,
            'rssLimitBytes': MAX_RSS_BYTES, 'totalTimeoutSeconds': TIMEOUT_SECONDS, 'sourcePinsSha256': pins_sha,
            'sourcePinsSchema': 'environment-next-phase-v5-source-pins/3' if pins_sha else None,
            'compileRecordExists': compile_path.is_file(), 'compiledOutputCount': output_count,
            'buildManifestExists': manifest_path.is_file(), 'reviewHostManifestExists': host_manifest_path.is_file(),
            'finalizationReceiptExists': finalization_path.is_file(), 'log': str(log), 'events': str(events),
            'scope': 'Full source verification before/after in separate fresh processes; vendor/addon/app compilers are isolated. Compile diagnostic only, not production budget, visual, GPU, or phone acceptance.',
        }
        receipt.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(report, indent=2), flush=True)
    if status == 'completed' and child_code == 0 and peak <= MAX_RSS_BYTES and manifest_path.is_file() and host_manifest_path.is_file() and finalization_path.is_file():
        return 0
    if status in ('memory-limit', 'source-changed', 'monitor-error'):
        return 125
    if status == 'timeout':
        return 124
    return child_code or 1


if __name__ == '__main__':
    raise SystemExit(main())
