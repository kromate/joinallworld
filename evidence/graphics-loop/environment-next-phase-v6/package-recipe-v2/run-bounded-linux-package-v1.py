#!/usr/bin/env python3
"""Run isolated v6 compile/finalization under explicit remote diagnostic limits."""
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path.cwd()
HERE = Path('evidence/graphics-loop/environment-next-phase-v6')
REVIEWED = HERE / 'package-recipe-v2'
RESULTS = REVIEWED / 'remote-results'
MAX_RSS_BYTES = 384 * 1024 * 1024
TIMEOUT_SECONDS = 25
EXPECTED_REF = 'refs/heads/codex/graphics-environment-next-phase-v6-package-v2'
NODE = ['node', '--max-old-space-size=96']
PHASES = [
    ('source-seal', [*NODE, str(REVIEWED / 'seal-source-pins-v6.mjs')]),
    ('full-precompile-verification', [*NODE, str(REVIEWED / 'verify-source-pins-v6.mjs'), 'precompile']),
    ('three-vendor-compile', [*NODE, str(REVIEWED / 'compile-vendor-v6.mjs')]),
    ('three-addon-compile', [*NODE, str(REVIEWED / 'compile-addons-v6.mjs')]),
    ('full-app-compile', [*NODE, str(REVIEWED / 'compile-app-v6.mjs')]),
    ('compiled-output-seal', [*NODE, str(REVIEWED / 'seal-compiled-output-v6.mjs')]),
    ('full-postcompile-verification', [*NODE, str(REVIEWED / 'verify-source-pins-v6.mjs'), 'postcompile']),
    ('finalizer-seal', [*NODE, str(REVIEWED / 'seal-finalizer-v6.mjs')]),
    ('single-public-copy-finalize', [*NODE, str(REVIEWED / 'finalize-package-v6.mjs')]),
    ('review-host-stage', [*NODE, str(REVIEWED / 'prepare-review-host-v6.mjs')]),
]


def process_rows(group: int) -> list[tuple[int, int, str]]:
    # Read procfs directly so the monitor does not spawn a `ps` process into
    # the owned group and inflate the memory sample it is trying to measure.
    rows = []
    page_bytes = os.sysconf('SC_PAGE_SIZE')
    try:
        entries = os.scandir('/proc')
    except OSError:
        raise
    with entries:
        for entry in entries:
            if not entry.name.isdigit():
                continue
            try:
                raw = Path(entry.path, 'stat').read_text()
                close = raw.rfind(')')
                if close < 0:
                    continue
                pid = int(entry.name)
                comm = raw[raw.find('(') + 1:close]
                fields = raw[close + 2:].split()  # begins with field 3 (state)
                if len(fields) <= 21 or int(fields[2]) != group:
                    continue
                rss_pages = max(0, int(fields[21]))
                rows.append((pid, rss_pages * page_bytes, comm))
            except FileNotFoundError:
                # A process may exit between readdir and reading its stat file.
                continue
            except PermissionError as error:
                raise RuntimeError(f'Cannot inspect owned process {entry.name}: {error}') from error
            except (OSError, ValueError, IndexError) as error:
                raise RuntimeError(f'Cannot parse /proc/{entry.name}/stat: {error}') from error
    return rows


def signal_owned_children(group: int, self_pid: int, sig: int) -> None:
    for pid, _rss, _comm in process_rows(group):
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


def cleanup_group(group: int, self_pid: int) -> bool:
    for sig, delay in ((signal.SIGTERM, 0.25), (signal.SIGKILL, 0)):
        try:
            signal_owned_children(group, self_pid, sig)
        except Exception:
            return False
        if sig == signal.SIGKILL:
            break
        deadline = time.monotonic() + delay
        while time.monotonic() < deadline:
            try:
                if not [pid for pid, _rss, _comm in process_rows(group) if pid != self_pid]:
                    break
            except Exception:
                return False
            time.sleep(0.025)
    try:
        # A successful final scan must positively find this wrapper and no
        # other member of its private session/process group.
        final_rows = process_rows(group)
    except Exception:
        return False
    return any(pid == self_pid for pid, _rss, _comm in final_rows) and not any(pid != self_pid for pid, _rss, _comm in final_rows)


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
    log, events, receipt = RESULTS / 'v6-package-v2.log', RESULTS / 'v6-package-v2-events.jsonl', RESULTS / 'v6-package-v2.receipt.json'
    if any(path.exists() for path in (log, events, receipt)):
        raise SystemExit('Refusing to overwrite existing v6 remote result')
    start = time.monotonic()
    peak = 0
    peak_processes: dict[tuple[str, int], dict[str, object]] = {}
    rows = []
    status, failure, child_code = 'running', None, None
    current = None
    command = None
    cleanup_verified = False
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
                phase_peak_group = 0
                phase_processes: dict[int, dict[str, object]] = {}
                while current.poll() is None:
                    try:
                        observed = process_rows(group)
                        rss = sum(value for _pid, value, _comm in observed)
                        peak = max(peak, rss)
                        phase_peak_group = max(phase_peak_group, rss)
                        for pid, value, comm in observed:
                            item = phase_processes.setdefault(pid, {'pid': pid, 'command': comm, 'peakRssBytes': 0})
                            item['peakRssBytes'] = max(int(item['peakRssBytes']), value)
                            peak_item = peak_processes.setdefault((name, pid), {'phase': name, 'pid': pid, 'command': comm, 'peakRssBytes': 0})
                            peak_item['peakRssBytes'] = max(int(peak_item['peakRssBytes']), value)
                    except Exception as error:
                        status, failure = 'monitor-error', str(error)
                        terminate_phase(group, os.getpid(), current)
                        child_code = current.returncode
                        break
                    if rss > MAX_RSS_BYTES:
                        status, failure = 'memory-limit', 'owned process group exceeded 384 MiB remote diagnostic RSS limit'
                        terminate_phase(group, os.getpid(), current)
                        child_code = current.returncode
                        break
                    if time.monotonic() - start > TIMEOUT_SECONDS:
                        status, failure = 'timeout', 'unchanged 25-second total pipeline bound'
                        terminate_phase(group, os.getpid(), current)
                        child_code = current.returncode
                        break
                    time.sleep(0.025)
                try:
                    for pid, value, comm in process_rows(group):
                        item = phase_processes.setdefault(pid, {'pid': pid, 'command': comm, 'peakRssBytes': 0})
                        item['peakRssBytes'] = max(int(item['peakRssBytes']), value)
                        peak_item = peak_processes.setdefault((name, pid), {'phase': name, 'pid': pid, 'command': comm, 'peakRssBytes': 0})
                        peak_item['peakRssBytes'] = max(int(peak_item['peakRssBytes']), value)
                except Exception:
                    pass
                if status != 'running':
                    child_code = current.returncode
                    duration = round(time.monotonic() - phase_start, 3)
                    phase_result = {'phase': name, 'exitCode': child_code, 'elapsedSeconds': duration, 'status': status,
                                    'peakOwnedGroupRssBytes': phase_peak_group,
                                    'peakProcesses': sorted(phase_processes.values(), key=lambda item: int(item['peakRssBytes']), reverse=True)}
                    rows.append(phase_result)
                    event('phase-interrupted', **phase_result)
                    break
                child_code = current.wait()
                duration = round(time.monotonic() - phase_start, 3)
                rows.append({'phase': name, 'exitCode': child_code, 'elapsedSeconds': duration, 'peakOwnedGroupRssBytes': phase_peak_group, 'peakProcesses': sorted(phase_processes.values(), key=lambda item: int(item['peakRssBytes']), reverse=True)})
                event('phase-terminal', phase=name, exitCode=child_code, elapsedSeconds=duration, peakOwnedGroupRssBytes=phase_peak_group, peakProcesses=sorted(phase_processes.values(), key=lambda item: int(item['peakRssBytes']), reverse=True))
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
        cleanup_verified = cleanup_group(group, os.getpid())
        if not cleanup_verified and status == 'completed':
            status, failure = 'cleanup-unverified', 'owned process group cleanup could not be positively verified'
        manifest_path = HERE / 'static-v6/build-manifest.json'
        host_manifest_path = HERE / 'static-fixture-v6/build-manifest.json'
        compile_path = HERE / 'compile-v6-record.json'
        finalization_path = HERE / 'finalization-v6-observed.json'
        try:
            pins_bytes = (HERE / 'source-pins-v6.json').read_bytes()
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
            'peakProcessRssBytesByPhaseAndPid': sorted(peak_processes.values(), key=lambda item: int(item['peakRssBytes']), reverse=True),
            'cleanupVerified': cleanup_verified,
            'rssLimitBytes': MAX_RSS_BYTES, 'totalTimeoutSeconds': TIMEOUT_SECONDS, 'sourcePinsSha256': pins_sha,
            'sourcePinsSchema': 'environment-next-phase-v6-source-pins/3' if pins_sha else None,
            'compileRecordExists': compile_path.is_file(), 'compiledOutputCount': output_count,
            'buildManifestExists': manifest_path.is_file(), 'reviewHostManifestExists': host_manifest_path.is_file(),
            'finalizationReceiptExists': finalization_path.is_file(), 'log': str(log), 'events': str(events),
            'scope': 'Full source verification before/after in separate fresh processes; vendor/addon/app compilers are isolated. The 384 MiB owned-process-group ceiling is remote CI diagnostic headroom only, not a production, game, mobile, visual, GPU, or phone budget. Node old-space remains 96 MiB and the pipeline remains bounded to 25 seconds.',
        }
        receipt.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(report, indent=2), flush=True)
    if status == 'completed' and child_code == 0 and cleanup_verified and peak <= MAX_RSS_BYTES and manifest_path.is_file() and host_manifest_path.is_file() and finalization_path.is_file():
        return 0
    if status in ('memory-limit', 'source-changed', 'monitor-error', 'cleanup-unverified') or not cleanup_verified:
        return 125
    if status == 'timeout':
        return 124
    return child_code or 1


if __name__ == '__main__':
    raise SystemExit(main())
