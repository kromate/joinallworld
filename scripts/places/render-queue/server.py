"""Shared render-queue server: ONE long-lived Blender that builds, exports and renders place jobs for every agent.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/places/render-queue/server.py -- \\
        --root scripts/places/render-queue/q --workers-id A [--out scripts/places/out] [--max-jobs 300]

Protocol (all moves are atomic renames inside <root>):
  in/<jobid>.json        a job: {city, venueId, spec, style, facts?, views?, photo?}  or  {kind: "compare", photo, render, out}
  work/<jobid>__<id>.json  claimed by worker <id> (rename)
  done/<jobid>.json      result: {jobid, status ok|rejected|error, report, images[], warnings[], errors[], triangles, seconds, worker}
  workers/<id>.json      heartbeat: pid, jobs done, rss MB, last activity
  stop                   if this file exists every server exits cleanly after its current job
The server restarts itself (exit 75, the wrapper starts a fresh Blender) when any .py under blender/ changes, so edits to lib/parts/archetypes are picked up.
A job is built exactly like worker.py (LOD0/1/2 GLBs, standard preview, photo-matched render) into <out>/<city>/. A `photo` path in the
job also writes <out>/cmp-<city>-<venueId>.png (photo left, render right). After --max-jobs jobs the server exits with code 75 so the
run.sh wrapper starts a fresh Blender (bounds memory growth).
"""
import argparse
import importlib.util
import json
import os
import subprocess
import sys
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
BLENDER_DIR = HERE.parent / 'blender'
sys.path.insert(0, str(BLENDER_DIR))

RESTART_CODE = 75


def load_worker():
    spec = importlib.util.spec_from_file_location('places_worker', BLENDER_DIR / 'worker.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)   # __name__ != '__main__', so its main() does not run
    return mod


def atomic_write(path, data):
    tmp = path.with_name('.' + path.name + '.tmp')
    tmp.write_text(json.dumps(data, indent=1) + '\n')
    os.replace(tmp, path)


def source_signature():
    """Newest mtime and count of every .py under blender/ (lib, parts, archetypes): a change means this process runs stale code."""
    newest, n = 0.0, 0
    for p in BLENDER_DIR.rglob('*.py'):
        try:
            newest = max(newest, p.stat().st_mtime)
            n += 1
        except OSError:
            pass
    return (round(newest, 3), n)


def rss_mb():
    try:
        out = subprocess.run(['ps', '-o', 'rss=', '-p', str(os.getpid())], capture_output=True, text=True, timeout=5).stdout.strip()
        return round(int(out) / 1024, 1)
    except Exception:  # noqa: BLE001
        return None


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=str(HERE / 'q'))
    ap.add_argument('--workers-id', default='A')
    ap.add_argument('--out', default=str(HERE.parent / 'out'))
    ap.add_argument('--max-jobs', type=int, default=300)
    ap.add_argument('--idle-exit', type=float, default=0, help='exit after this many idle seconds (0 = never; for tests)')
    a = ap.parse_args(argv)
    root, wid, out = Path(a.root), a.workers_id, Path(a.out)
    dirs = {k: root / k for k in ('in', 'work', 'done', 'workers')}
    for d in dirs.values():
        d.mkdir(parents=True, exist_ok=True)
    out.mkdir(parents=True, exist_ok=True)
    worker = load_worker()
    import lib  # noqa: F401  (worker put blender/ on sys.path)

    # a crashed predecessor with the same id left claimed jobs behind: put them back
    for f in dirs['work'].glob(f'*__{wid}.json'):
        try:
            os.replace(f, dirs['in'] / (f.name.rsplit('__', 1)[0] + '.json'))
        except OSError:
            pass

    started = time.time()
    sig0 = source_signature()
    sig_checked = 0.0
    done_n = 0
    last_activity = time.time()
    hb = dirs['workers'] / f'{wid}.json'

    last_beat = [0.0]

    def beat(state):
        last_beat[0] = time.time()
        atomic_write(hb, {'id': wid, 'pid': os.getpid(), 'jobs': done_n, 'state': state, 'rssMB': rss_mb(), 'started': started, 'last': time.time()})

    print(f'[queue {wid}] pid {os.getpid()} watching {dirs["in"]}', flush=True)
    beat('idle')
    while True:
        if (root / 'stop').exists():
            beat('stopped')
            print(f'[queue {wid}] stop file seen, exiting', flush=True)
            sys.exit(0)
        if time.time() - sig_checked > 2.0:
            sig_checked = time.time()
            if source_signature() != sig0:
                beat('restarting')
                print(f'[queue {wid}] lib/parts/archetype sources changed, exiting for a restart with fresh code', flush=True)
                sys.exit(RESTART_CODE)
        if done_n >= a.max_jobs:
            beat('restarting')
            print(f'[queue {wid}] {done_n} jobs done, exiting for a clean restart', flush=True)
            sys.exit(RESTART_CODE)
        claimed = None
        for f in sorted(dirs['in'].glob('*.json'), key=lambda p: (p.stat().st_mtime if p.exists() else 0, p.name)):
            target = dirs['work'] / f'{f.stem}__{wid}.json'
            try:
                os.rename(f, target)
            except OSError:
                continue   # another server got it
            claimed = (f.stem, target)
            break
        if not claimed:
            if a.idle_exit and time.time() - last_activity > a.idle_exit:
                beat('idle-exit')
                sys.exit(0)
            if time.time() - last_beat[0] > 5:
                beat('idle')
            time.sleep(0.25)
            continue
        jobid, path = claimed
        last_activity = time.time()
        beat('working')
        result = {'jobid': jobid, 'worker': wid, 'status': 'error', 'images': [], 'warnings': [], 'errors': []}
        t0 = time.time()
        try:
            job = json.loads(path.read_text())
            if job.get('kind') == 'compare':
                import side_by_side
                side_by_side.compose(job['photo'], job['render'], job['out'], int(job.get('height') or 0))
                result.update(status='ok', out=job['out'], images=[job['out']])
            else:
                for k in ('city', 'venueId'):
                    if not job.get(k):
                        raise ValueError(f'job has no {k}')
                if job.get('spec') is None and job.get('brief') is None:
                    raise ValueError('job needs a spec (or a brief)')
                views = set(job.get('views') or [])
                report = worker.run_job(job, out, render=True, views=views)
                base = out / job['city'] / job['venueId']
                result.update(status=report['status'], report=str(base) + '.json', warnings=report.get('warnings', []), errors=report.get('errors', []),
                              triangles=report.get('triangles'), bounds=report.get('bounds'), breakdown=(report.get('breakdown') or {}).get('lod0'))
                imgs = [p for p in (report.get('images') or []) if Path(p).exists()]
                if not imgs:
                    imgs = [str(p) for p in (base.with_suffix('.png'),) if p.exists()]
                result['images'] = imgs
                if job.get('photo'):
                    photo = Path(job['photo'])
                    target_img = Path(str(base) + '.photo.png')
                    if not target_img.exists():
                        target_img = Path(str(base) + '.png')
                    if photo.exists() and target_img.exists():
                        import side_by_side
                        cmp_path = out / f"cmp-{job['city']}-{job['venueId']}.png"
                        side_by_side.compose(photo, target_img, cmp_path, int(job.get('compareHeight') or 0))
                        result['cmp'] = str(cmp_path)
                        result['images'].append(str(cmp_path))
                    else:
                        result['warnings'].append(f'no comparison written: photo {photo} or render {target_img} missing')
        except BaseException as exc:  # noqa: BLE001
            if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                raise
            result['status'] = 'error'
            result['errors'].append(f'{type(exc).__name__}: {exc}')
            result['traceback'] = traceback.format_exc()
            print(result['traceback'], file=sys.stderr, flush=True)
        result['seconds'] = round(time.time() - t0, 2)
        atomic_write(dirs['done'] / f'{jobid}.json', result)
        try:
            path.unlink()
        except OSError:
            pass
        done_n += 1
        last_activity = time.time()
        print(f"[queue {wid}] {jobid} {result['status']} {result['seconds']}s", flush=True)
        beat('idle')


main()
