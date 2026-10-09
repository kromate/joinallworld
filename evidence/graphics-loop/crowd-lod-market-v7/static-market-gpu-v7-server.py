#!/usr/bin/env python3
"""Manifest-only bounded static host for the v7 feature-partition GPU A/B fixture."""
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
import datetime, hashlib, json, mimetypes, os, subprocess, sys, time, urllib.parse

root = Path(__file__).resolve().parents[3]
here = Path(__file__).resolve().parent
output = (here / 'static-fixture-market-gpu-v7').resolve()
live = here / 'market-gpu-v7-server-live.json'
receipt = here / 'market-gpu-v7-server-receipt.json'
stop = here / 'market-gpu-v7-server-stop'
stop.unlink(missing_ok=True)

def pressure():
    try:
        return int(subprocess.check_output(['sysctl', '-n', 'kern.memorystatus_vm_pressure_level'], text=True).strip())
    except Exception:
        return None

def sha256_stream(file):
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()

def within_output(file):
    resolved = file.resolve(strict=True)
    try:
        resolved.relative_to(output)
    except ValueError as error:
        raise ValueError(f'static route escapes package output: {resolved}') from error
    if not resolved.is_file():
        raise ValueError(f'static route is not a regular file: {resolved}')
    return resolved

def finish_startup_failure(record, reason, code=75):
    record.update(status='not-started', reason=reason, exit=code)
    receipt.write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps(record), flush=True)
    raise SystemExit(code)

record = {
    'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'port': 5188,
    'lifetimeSeconds': min(max(int(os.environ.get('GRAPHICS_REVIEW_SECONDS', '180')), 1), 180),
    'ownGroupLimitBytes': 128 * 1024 * 1024,
    'pressureBefore': pressure(),
    'pythonPid': os.getpid(),
    'servedRequests': 0,
    'scope': 'manifest-only source/compact A/B static host; no production or browser-memory claim',
}
if record['pressureBefore'] not in (1, 2):
    finish_startup_failure(record, 'initial pressure critical or unknown')

try:
    manifest_path = within_output(output / 'build-manifest.json')
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('status') != 'static-packaging-only-not-visual-or-runtime-acceptance':
        raise ValueError('unexpected build-manifest status')
    builder = (here / 'prepare-market-gpu-v7.mjs').resolve(strict=True)
    if sha256_stream(builder) != manifest.get('builderSha256'):
        raise ValueError('static builder SHA changed since packaging')
    static = manifest.get('staticServer', {})
    if static.get('denyAllUnlistedPaths') is not True:
        raise ValueError('manifest does not deny unlisted paths')

    # Attest all packaged inputs, but never make source paths routable.
    input_records = manifest.get('inputs', {})
    if not isinstance(input_records, dict) or not input_records:
        raise ValueError('manifest has no input hash inventory')
    for relative, expected_hash in input_records.items():
        source = (root / relative).resolve(strict=True)
        try:
            source.relative_to(root)
        except ValueError as error:
            raise ValueError(f'input hash path escapes repository root: {relative}') from error
        if sha256_stream(source) != expected_hash:
            raise ValueError(f'input hash changed: {relative}')

    output_records = manifest.get('outputs', [])
    output_by_path = {}
    for item in output_records:
        relative = item.get('path')
        if not isinstance(relative, str) or relative.startswith('/') or '..' in Path(relative).parts:
            raise ValueError(f'invalid output path in manifest: {relative!r}')
        file = within_output(output / relative)
        if sha256_stream(file) != item.get('sha256'):
            raise ValueError(f'packaged output hash mismatch: {relative}')
        if file.stat().st_size != item.get('bytes'):
            raise ValueError(f'packaged output size mismatch: {relative}')
        output_by_path[relative] = (file, item['sha256'])

    declared_routes = static.get('routes')
    if not isinstance(declared_routes, dict) or not declared_routes:
        raise ValueError('manifest has no explicit static routes')
    routes = {}
    for route, target in declared_routes.items():
        if not isinstance(route, str) or not route.startswith('/') or '*' in route or '?' in route:
            raise ValueError(f'non-exact static route rejected: {route!r}')
        if not isinstance(target, dict):
            raise ValueError(f'invalid route target: {route}')
        relative = target.get('file')
        if not isinstance(relative, str) or relative.startswith('/') or '..' in Path(relative).parts:
            raise ValueError(f'invalid route file: {route}')
        record_for_file = output_by_path.get(relative)
        if record_for_file is None:
            raise ValueError(f'route does not point to a declared packaged output: {route}')
        file, output_hash = record_for_file
        if output_hash != target.get('sha256'):
            raise ValueError(f'route SHA does not match packaged output: {route}')
        # Route targets must all remain inside the one generated package folder.
        routes[route] = within_output(file)

    required_routes = {
        '/',
        '/evidence/graphics-loop/venue-authored-people-browser-v1/candidate-market-day-12.json',
        '/src/scene/body/assets/base-body-male.glb',
        '/src/scene/body/assets/base-body-female.glb',
    }
    missing = required_routes.difference(routes)
    if missing:
        raise ValueError(f'manifest is missing required exact route(s): {sorted(missing)}')
    # Do not expose any project source tree, arbitrary evidence path, or other app route.
    if any(target.is_relative_to(root) and not target.is_relative_to(output) for target in routes.values()):
        raise ValueError('a static route resolved outside the generated package')
except SystemExit:
    raise
except Exception as error:
    finish_startup_failure(record, f'manifest validation failed: {error}', 76)

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        file = routes.get(parsed.path) if not parsed.query else None
        if file is None:
            self.send_error(404)
            return
        data = file.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', mimetypes.guess_type(file.name)[0] or 'application/octet-stream')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)
        record['servedRequests'] += 1

    def log_message(self, *_args):
        pass

try:
    server = HTTPServer(('127.0.0.1', record['port']), Handler)
except Exception as error:
    finish_startup_failure(record, f'server bind failed: {error}', 78)
server.timeout = 0.25
started = time.monotonic()
peak_rss = 0
group = os.getpgid(0)
if group != os.getpid():
    server.server_close()
    finish_startup_failure(record, 'server must run in its own process group', 77)
record.update(status='running', processGroup=group, explicitRouteCount=len(routes), outputFileCount=len(output_by_path))
print(json.dumps(record), flush=True)
reason = None
exit_code = 0
try:
    while True:
        server.handle_request()
        elapsed = time.monotonic() - started
        state = pressure()
        try:
            rows = subprocess.check_output(['ps', '-axo', 'pid=,pgid=,rss='], text=True).splitlines()
            rss = sum(int(row.split()[2]) * 1024 for row in rows if int(row.split()[1]) == group)
        except Exception:
            rss = None
        if rss is None:
            reason = 'own process group RSS sample unavailable'
            exit_code = 74
            break
        peak_rss = max(peak_rss, rss)
        record.update(lastPressure=state, sampledOwnGroupPeakBytes=peak_rss, elapsedSeconds=elapsed)
        live.write_text(json.dumps(record, indent=2) + '\n')
        if stop.exists():
            reason = 'owner stopped after review'
            break
        if elapsed > record['lifetimeSeconds']:
            reason = 'bounded lifetime'
            break
        if rss > record['ownGroupLimitBytes']:
            reason = 'own process group RSS limit'
            exit_code = 75
            break
        if state not in (1, 2):
            reason = 'critical or unknown live pressure'
            exit_code = 75
            break
except Exception as error:
    reason = f'server runtime failure: {error}'
    exit_code = 1
finally:
    server.server_close()
    record.update(status='terminal', reason=reason, exit=exit_code, elapsedSeconds=time.monotonic() - started,
                  sampledOwnGroupPeakBytes=peak_rss, pressureAfter=pressure())
    live.write_text(json.dumps(record, indent=2) + '\n')
    receipt.write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps(record), flush=True)
