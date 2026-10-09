import datetime, hashlib, json, os, pathlib, signal, subprocess, sys, time

root = pathlib.Path.cwd()
builder = root / 'evidence/graphics-loop/crowd-lod-market-v7/prepare-market-gpu-v7.mjs'
stem = root / 'evidence/graphics-loop/crowd-lod-market-v7/market-gpu-v7-build'
limit = 220 * 1024 * 1024
timeout = 25.0
pins = [
    builder, root / 'scripts/agent-slot.ts',
    root / 'evidence/graphics-loop/crowd-lod-market-v7/viewer-market-gpu-v7.ts',
    root / 'evidence/graphics-loop/crowd-lod-market-v7/market-gpu-v7.html',
    root / 'evidence/graphics-loop/crowd-lod-market-v7/static-market-gpu-v7-server.py',
    root / 'evidence/graphics-loop/venue-authored-people-browser-v1/candidate-market-day-12.json',
    root / 'src/scene/body/assets/base-body-male.glb', root / 'src/scene/body/assets/base-body-female.glb',
    root / 'src/scene/body/assets/clip-pack.glb', root / 'src/scene/body/skinned.ts', root / 'src/scene/body/poses.ts',
    root / 'src/scene/kit.ts', root / 'src/scene/wardrobe/geometry.ts', root / 'src/scene/wardrobe/renderer.ts',
    root / 'src/scene/avatar-look.ts', root / 'src/game/wardrobe/rules.ts',
]

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def pressure():
    try: return int(subprocess.check_output(['sysctl', '-n', 'kern.memorystatus_vm_pressure_level'], text=True).strip())
    except Exception: return None
def group_rss(pgid):
    rows = subprocess.check_output(['ps', '-axo', 'pid=,pgid=,rss='], text=True).splitlines()
    return sum(int(row.split()[2]) * 1024 for row in rows if int(row.split()[1]) == pgid)

receipt = stem.with_suffix('.json')
log = stem.with_suffix('.log')
record = {
    'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'heapMiB': 96, 'ownedGroupLimitBytes': limit, 'timeoutSeconds': timeout,
    'pressureBefore': pressure(), 'sourceHashesBefore': {str(path): digest(path) for path in pins},
    'started': False, 'status': 'preflight',
}
receipt.write_text(json.dumps(record, indent=2) + '\n')
if record['pressureBefore'] not in (1, 2):
    record.update(status='aborted', abort='critical or unknown initial memory pressure', exit=75)
    receipt.write_text(json.dumps(record, indent=2) + '\n')
    raise SystemExit(75)
if record['pressureBefore'] != 1:
    record.update(status='aborted', abort='initial pressure is not normal; root must confirm fresh normal pressure and easing memory-churn samples before admission', exit=75)
    receipt.write_text(json.dumps(record, indent=2) + '\n')
    raise SystemExit(75)

command = [
    '/usr/local/bin/node', '--max-old-space-size=32', '--experimental-strip-types', 'scripts/agent-slot.ts',
    'heavy', '--wait-ms', '0', '--', '/usr/bin/time', '-l', '/usr/local/bin/node',
    '--max-old-space-size=96', '--experimental-strip-types', str(builder),
]
record['command'] = command
record.update(status='running', started=True)
begin = time.monotonic()
peak = 0
abort = None
with log.open('w') as stream:
    proc = subprocess.Popen(command, stdout=stream, stderr=stream, start_new_session=True,
                            env={**os.environ, 'GOMAXPROCS': '1'})
    record['ownedGroupPid'] = proc.pid
    receipt.write_text(json.dumps(record, indent=2) + '\n')
    while proc.poll() is None:
        rss = group_rss(proc.pid)
        peak = max(peak, rss)
        level = pressure()
        if level not in (1, 2): abort = 'critical or unknown live memory pressure'
        elif rss > limit: abort = 'owned process group RSS exceeded 220 MiB'
        elif time.monotonic() - begin > timeout: abort = '25 second build timeout'
        if proc.poll() is not None: break
        if abort:
            try: os.killpg(proc.pid, signal.SIGTERM)
            except ProcessLookupError: pass
            try: proc.wait(timeout=1)
            except subprocess.TimeoutExpired:
                try: os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError: pass
            break
        time.sleep(0.025)
    code = proc.wait()

record.update(
    status='aborted' if abort else 'terminal', exit=code, abort=abort,
    elapsedSeconds=time.monotonic() - begin, sampledOwnedGroupPeakBytes=peak,
    pressureAfter=pressure(), sourceHashesAfter={str(path): digest(path) for path in pins}, log=str(log),
)
if record['sourceHashesAfter'] != record['sourceHashesBefore']:
    record.update(status='rejected', abort='pinned runner input changed during execution', exit=125)
    code = 125
receipt.write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps(record, indent=2))
print(log.read_text()[-4000:])
raise SystemExit(125 if abort else code)
