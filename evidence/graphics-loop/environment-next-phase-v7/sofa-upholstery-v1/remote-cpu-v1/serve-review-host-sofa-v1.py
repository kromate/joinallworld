"""Restricted, manifest-verified static host for the sofa-v1 diagnostic fixture. Never auto-launched."""
from __future__ import annotations

from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import datetime
import hashlib
import json
import mimetypes
import os
import re
import subprocess
import sys
import time
import urllib.parse

ROOT = Path(__file__).resolve().parents[5]
HERE = Path(__file__).resolve().parents[1]
OUTPUT = HERE / 'static-fixture-sofa-v1'
BUILT = HERE / 'static-sofa-v1'
PORT = 5184
MAX_LIFETIME = 180
GROUP_LIMIT = 128 * 1024 * 1024
STOP = HERE / 'static-server-package-v3-stop'
LIVE = HERE / 'static-server-package-v3-live.json'
RECEIPT = HERE / 'static-server-package-v3-observed.json'
MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
    '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.wasm': 'application/wasm',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.avif': 'image/avif', '.svg': 'image/svg+xml',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
}


def pressure() -> int | None:
    try:
        return int(subprocess.check_output(['sysctl', '-n', 'kern.memorystatus_vm_pressure_level'], text=True).strip())
    except Exception:
        return None


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            hasher.update(chunk)
    return hasher.hexdigest()


def inside(base: Path, relative: str) -> Path:
    rel = Path(relative)
    if rel.is_absolute() or any(part in ('..', '') for part in rel.parts):
        raise ValueError(f'unsafe manifest path: {relative}')
    target = (base / rel).resolve(strict=True)
    if not target.is_relative_to(base.resolve(strict=True)) or not target.is_file():
        raise ValueError(f'manifest path escapes its root or is not a file: {relative}')
    return target


def verify_inputs(source_pins: dict, host_manifest: dict, built_manifest: dict) -> None:
    pins_path = HERE / 'source-pins-sofa-v1.json'
    pins_hash = digest(pins_path)
    if pins_hash != built_manifest['sourcePinsSha256'] or pins_hash != host_manifest['fixtureSourcePinsSha256']:
        raise ValueError('source-pins hash does not match both manifests')
    if source_pins.get('schema') != 'sofa-upholstery-v1-source-pins/3' or source_pins.get('status') != 'PREBUILD_SEALED':
        raise ValueError('unexpected sofa-v1 source pin schema/status')
    expected_inputs = {item['path']: item['sha256'] for item in source_pins['files']}
    if host_manifest.get('inputs') != expected_inputs:
        raise ValueError('review-host input hashes differ from sealed source pins')
    for rel, expected in expected_inputs.items():
        file = inside(ROOT, rel)
        if digest(file) != expected:
            raise ValueError(f'pinned input hash mismatch: {rel}')


def verify_outputs(host_manifest: dict, built_manifest: dict) -> dict[str, Path]:
    expected = {item['path']: item['sha256'] for item in built_manifest['outputs']}
    provided = {item['path']: item['sha256'] for item in host_manifest.get('outputs', [])}
    if len(provided) != len(host_manifest.get('outputs', [])) or provided != expected:
        raise ValueError('review-host output routes differ from built output manifest')
    routes: dict[str, Path] = {}
    for rel, expected_hash in provided.items():
        file = inside(OUTPUT, rel)
        if digest(file) != expected_hash:
            raise ValueError(f'output hash mismatch: {rel}')
        routes['/' + rel] = file
    if '/index.html' not in routes:
        raise ValueError('index.html is missing from explicit output routes')
    return routes


def verify_importmap(built_manifest: dict, routes: dict[str, Path]) -> dict:
    imports = built_manifest.get('importMap')
    if not isinstance(imports, dict) or imports.get('three') != './vendor/three.module.js':
        raise ValueError('single shared Three import-map target missing')
    if len([p for p in routes if p.endswith('/three.module.js')]) != 1 or len([p for p in routes if p.endswith('/three.core.js')]) != 1:
        raise ValueError('expected exactly one emitted Three module and its core sibling')
    for specifier, target in imports.items():
        if not isinstance(target, str) or not target.startswith('./') or ('/' + target[2:]) not in routes:
            raise ValueError(f'import-map target has no explicit route: {specifier} -> {target}')
    html = routes['/index.html'].read_text(encoding='utf-8')
    match = re.search(r'<script type="importmap">([^<]+)</script>', html)
    if not match:
        raise ValueError('fixture HTML has no generated import map')
    html_imports = json.loads(match.group(1)).get('imports')
    if html_imports != imports:
        raise ValueError('HTML import map differs from the sealed bundle manifest')
    if 'src="./app/viewer-sofa-compare.js"' not in html:
        raise ValueError('actual host entry script path mismatch')
    required = {
        './vendor/addons/libs/meshopt_decoder.module.js',
        './vendor/addons/loaders/GLTFLoader.js',
        './vendor/addons/utils/BufferGeometryUtils.js',
        './vendor/addons/utils/SkeletonUtils.js',
    }
    if not required.issubset(set(imports.values())):
        raise ValueError('one or more actual production addon targets are not routed')
    observed = set()
    import_pattern = re.compile(r'(?:from\s*|import\s*(?:\(\s*)?)[\"\'](three(?:/[^\"\']*)?)[\"\']')
    for route, file in routes.items():
        if not route.endswith('.js'):
            continue
        code = file.read_text(encoding='utf-8')
        if '#city-map/' in code or '?raw' in code:
            raise ValueError(f'unresolved package or raw-import alias leaked into {route}')
        for specifier in import_pattern.findall(code):
            observed.add(specifier)
            if specifier not in imports:
                raise ValueError(f'compiled JS has an unmapped Three external: {specifier} in {route}')
    if observed != set(imports):
        raise ValueError(f'import map is not the exact compiled Three external set: emitted {sorted(observed)}')
    if built_manifest.get('importClosureVerified') is not True or not isinstance(built_manifest.get('importReferenceCount'), int):
        raise ValueError('compiled JavaScript import closure receipt is missing')
    return imports


def group_rss_bytes(group: int) -> int:
    output = subprocess.check_output(['ps', '-axo', 'pid=,pgid=,rss='], text=True)
    return sum(int(row.split()[2]) * 1024 for row in output.splitlines() if int(row.split()[1]) == group)


def main() -> int:
    if len(sys.argv) != 1:
        print('This sofa-v1 server uses its pinned fixture directory; no path override is accepted.', file=sys.stderr)
        return 2
    # Give the sampler an owned process group, rather than charging an inherited shell group.
    if os.getpid() != os.getpgrp():
        os.setsid()
    STOP.unlink(missing_ok=True)
    record = {
        'status': 'preflight', 'port': PORT, 'lifetimeSeconds': MAX_LIFETIME,
        'ownGroupLimitBytes': GROUP_LIMIT, 'pythonPid': os.getpid(), 'processGroup': os.getpgrp(),
        'pressureBefore': pressure(), 'servedRequests': 0,
        'scope': 'sofa-v1 static diagnostic only; no production, GPU, or phone claim',
    }
    if record['pressureBefore'] not in (1, 2):
        record.update(status='not-started', reason='memory pressure critical or unknown')
        RECEIPT.write_text(json.dumps(record, indent=2))
        print(json.dumps(record), flush=True)
        return 75
    if os.getpid() != os.getpgrp():
        raise RuntimeError('failed to establish an owned process group')
    try:
        host_manifest = json.loads((OUTPUT / 'build-manifest.json').read_text())
        built_manifest = json.loads((BUILT / 'build-manifest.json').read_text())
        source_pins = json.loads((HERE / 'source-pins-sofa-v1.json').read_text())
        staged_receipt = json.loads((HERE / 'review-host-sofa-v1-staged.json').read_text())
        finalized_receipt = json.loads((HERE / 'finalization-sofa-v1-observed.json').read_text())
        finalizer_pins_bytes = (HERE / 'finalizer-pins-sofa-v1.json').read_bytes()
        if built_manifest.get('status') != 'BUILT_DIAGNOSTIC_NOT_PRODUCTION_CERTIFICATE':
            raise ValueError('sofa-v1 static build manifest is not a completed diagnostic')
        if digest(OUTPUT / 'build-manifest.json') != staged_receipt.get('hostManifestSha256'):
            raise ValueError('review host manifest differs from its staging receipt')
        if digest(BUILT / 'build-manifest.json') != finalized_receipt.get('manifestSha256'):
            raise ValueError('bundle manifest differs from finalization receipt')
        if hashlib.sha256(finalizer_pins_bytes).hexdigest() != finalized_receipt.get('finalizerPinsSha256'):
            raise ValueError('finalizer pins differ from finalization receipt')
        if built_manifest.get('sourcePinsSha256') != staged_receipt.get('sourcePinsSha256'):
            raise ValueError('staged host and bundle source pins disagree')
        package_json = json.loads((ROOT / 'package.json').read_text())
        if package_json.get('imports', {}).get('#city-map/*', {}).get('browser') != './src/game/cities/*/map.ts':
            raise ValueError('actual browser #city-map package alias changed')
        verify_inputs(source_pins, host_manifest, built_manifest)
        routes = verify_outputs(host_manifest, built_manifest)
        import_map = verify_importmap(built_manifest, routes)
        pinned_city_maps = [item['path'] for item in source_pins['files'] if re.fullmatch(r'src/game/cities/[^/]+/map\.ts', item['path'])]
        emitted_map_chunks = [path for path in routes if re.fullmatch(r'/chunks/map-[A-Z0-9]{8}\.js', path)]
        if len(pinned_city_maps) != 40 or len(emitted_map_chunks) != len(pinned_city_maps):
            raise ValueError(f'full city map chunks mismatch: {len(pinned_city_maps)} pinned map modules / {len(emitted_map_chunks)} emitted map chunks')
        record.update(
            manifestStatus='verified', inputCount=len(host_manifest['inputs']), outputCount=len(routes),
            sourcePinsSha256=digest(HERE / 'source-pins-sofa-v1.json'), importMap=import_map,
            pinnedCityMapSources=len(pinned_city_maps), emittedCityMapChunks=len(emitted_map_chunks),
        )
    except Exception as error:
        record.update(status='not-started', reason=f'manifest verification failed: {type(error).__name__}: {error}')
        RECEIPT.write_text(json.dumps(record, indent=2))
        print(json.dumps(record), flush=True)
        return 1

    class Handler(BaseHTTPRequestHandler):
        def send_file(self, head_only: bool = False) -> None:
            raw = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
            if raw == '/':
                raw = '/index.html'
            file = routes.get(raw)
            if file is None:
                self.send_error(404)
                return
            size = file.stat().st_size
            self.send_response(200)
            self.send_header('Content-Type', MIME.get(file.suffix.lower(), 'application/octet-stream'))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Length', str(size))
            self.end_headers()
            if not head_only:
                with file.open('rb') as stream:
                    while chunk := stream.read(64 * 1024):
                        self.wfile.write(chunk)
            record['servedRequests'] += 1

        def do_GET(self) -> None:
            self.send_file()

        def do_HEAD(self) -> None:
            self.send_file(head_only=True)

        def log_message(self, *_args) -> None:
            return

    STOP.unlink(missing_ok=True)
    server = HTTPServer(('127.0.0.1', PORT), Handler)
    server.timeout = 0.5
    started = time.monotonic()
    peak = 0
    record.update(status='running', pidIsOwnProcessGroupLeader=True)
    LIVE.write_text(json.dumps(record, indent=2))
    print(json.dumps(record), flush=True)
    reason = None
    try:
        while True:
            server.handle_request()
            current_pressure = pressure()
            elapsed = time.monotonic() - started
            rss = group_rss_bytes(os.getpgrp())
            peak = max(peak, rss)
            record.update(lastPressure=current_pressure, sampledOwnGroupPeakBytes=peak, elapsedSeconds=elapsed)
            LIVE.write_text(json.dumps(record, indent=2))
            if STOP.exists():
                reason = 'owner requested stop'
                break
            if elapsed >= MAX_LIFETIME:
                reason = 'bounded 180 second lifetime reached'
                break
            if rss > GROUP_LIMIT:
                reason = 'own process-group RSS exceeded 128 MiB'
                break
            if current_pressure not in (1, 2):
                reason = 'memory pressure became critical or unknown'
                break
    finally:
        server.server_close()
        record.update(status='terminal', reason=reason, exit=0, elapsedSeconds=time.monotonic() - started)
        LIVE.write_text(json.dumps(record, indent=2))
        RECEIPT.write_text(json.dumps(record, indent=2))
        print(json.dumps(record), flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
