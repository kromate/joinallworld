#!/usr/bin/env python3
"""One exact Node production-adapter test under a fixed Linux process-group budget."""
import hashlib, json, os, signal, subprocess, sys, time
from pathlib import Path

ROOT = Path.cwd()
HERE = Path('evidence/graphics-loop/actor-volume-boarding-slice-v5/remote-ci-v2')
MANIFEST = HERE / 'snapshot-files.json'
TEST = ROOT / 'evidence/graphics-loop/actor-volume-boarding-slice-v5/sample-actor-geometry.test.ts'
LIMIT_BYTES = 220 * 1024 * 1024
WALL_SECONDS = 25

def sha(data): return hashlib.sha256(data).hexdigest()
def frozen(expected):
    raw = MANIFEST.read_bytes()
    if sha(raw) != expected: raise RuntimeError('snapshot manifest hash mismatch')
    doc = json.loads(raw)
    if doc.get('schema') != 'allworld-actor-sampler-v5-source-snapshot-v1': raise RuntimeError('unexpected source snapshot')
    results = {}
    for item in doc['files']:
        path = Path(item['path']); target = (ROOT / path).resolve()
        if path.is_absolute() or '..' in path.parts or target != ROOT / path or target.is_symlink() or not target.is_file(): raise RuntimeError(f'unsafe snapshot path {path}')
        data = target.read_bytes(); digest = sha(data); results[item['path']] = digest
        if digest != item['sha256'] or len(data) != item['bytes']: raise RuntimeError(f'snapshot input mismatch {path}')
    return results

def group_rss(pgid):
    result = subprocess.run(['ps','-e','-o','pid=,pgid=,rss=,stat=,comm='], capture_output=True, text=True, timeout=2)
    if result.returncode or not result.stdout.strip(): raise RuntimeError('process monitor unavailable')
    rows = [row.split(None, 4) for row in result.stdout.splitlines()]
    own = [row for row in rows if len(row) == 5 and int(row[1]) == pgid and not row[3].startswith('Z') and int(row[2]) > 0]
    return sum(int(row[2]) * 1024 for row in own), [{'pid':int(row[0]),'rssBytes':int(row[2])*1024,'state':row[3],'command':row[4]} for row in own]

def cleanup(proc, pgid):
    ok = True
    for sig, delay in ((signal.SIGTERM, 1.0), (signal.SIGKILL, 1.0)):
        try: os.killpg(pgid, sig)
        except ProcessLookupError: pass
        try: proc.wait(timeout=delay)
        except subprocess.TimeoutExpired: pass
        deadline = time.monotonic() + delay
        while time.monotonic() < deadline:
            try: rss, _ = group_rss(pgid)
            except Exception: ok = False; break
            if rss == 0: return ok
            time.sleep(.025)
    try: return ok and group_rss(pgid)[0] == 0
    except Exception: return False

def main():
    if len(sys.argv) != 2 or sys.argv[1] != 'test': raise SystemExit('usage: run-bounded-linux.py test')
    if sys.platform != 'linux': raise SystemExit('remote Linux only')
    expected = os.environ.get('EXPECTED_SNAPSHOT_SHA256'); run_id = os.environ.get('GITHUB_RUN_ID')
    if not run_id or not run_id.isdigit(): raise SystemExit('GITHUB_RUN_ID required')
    before = frozen(expected); base = ROOT / HERE / 'remote-results' / run_id; base.mkdir(parents=True, exist_ok=False)
    log = base / 'test.log'; receipt = base / 'test.receipt.json'; started = time.monotonic(); peak = 0; peak_witness = []; sample_count = 0; cleanup_verified = False; status = 'running'; code = None; proc = None; pgid = None
    command = ['node','--max-old-space-size=96','--experimental-strip-types','--test','--test-concurrency=1',str(TEST)]
    try:
        with log.open('xb') as stream:
            proc = subprocess.Popen(command, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True); pgid = proc.pid
            while True:
                elapsed = time.monotonic() - started
                if elapsed > WALL_SECONDS:
                    status = 'timeout'; code = proc.poll(); break
                code = proc.poll()
                if code is not None:
                    status = 'completed'; break
                try: used, witness = group_rss(pgid)
                except Exception:
                    if proc.poll() is not None: code = proc.returncode; status = 'completed'; break
                    status = 'monitor_error'; break
                sample_count += 1
                if used > peak: peak = used; peak_witness = witness
                if used > LIMIT_BYTES: status = 'memory_limit'; break
                if time.monotonic() - started > WALL_SECONDS: status = 'timeout'; break
                time.sleep(.025)
    finally:
        if proc is not None and pgid is not None: cleanup_verified = cleanup(proc, pgid)
        try: after = frozen(expected)
        except Exception as exc: after = {'verificationError':str(exc)}; status = 'source_changed'
        unchanged = before == after
        if not unchanged: status = 'source_changed'
        if not cleanup_verified: status = 'cleanup_error'
        elapsed_seconds = round(time.monotonic()-started,3)
        if status == 'completed' and elapsed_seconds > WALL_SECONDS: status = 'timeout'
        if sample_count == 0 and status == 'completed': status = 'monitor_error'
        record = {'status':status,'childExitCode':code,'elapsedSeconds':elapsed_seconds,'peakProcessGroupRssBytes':peak,'rssSampleCount':sample_count,'rssLimitBytes':LIMIT_BYTES,'wallLimitSeconds':WALL_SECONDS,'peakProcessWitness':peak_witness,'processGroupId':pgid,'cleanupVerified':cleanup_verified,'sourceHashesBefore':before,'sourceHashesAfter':after,'sourceUnchanged':unchanged,'snapshotSha256':expected,'command':command,'log':str(log)}
        receipt.write_text(json.dumps(record,indent=2)+'\n')
        print(json.dumps(record,indent=2))
    return 0 if status == 'completed' and code == 0 and peak <= LIMIT_BYTES and unchanged and cleanup_verified else 125 if status in ('memory_limit','monitor_error','source_changed','cleanup_error') else 124 if status == 'timeout' else (code or 1)

if __name__ == '__main__': raise SystemExit(main())
