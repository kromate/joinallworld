"""Independent source-part audit of an existing local fan-out campaign.

Run the separate regional ownership verifier first. This audit checks the durable
campaign result against every pinned derived input, not ownership correctness.
"""
import argparse
import hashlib
import json
import pathlib
import re


def need(condition, message):
    if not condition:
        raise ValueError(message)


def parse(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            need(key not in result, 'duplicate JSON key')
            result[key] = value
        return result
    def bad_constant(value):
        raise ValueError('nonfinite JSON constant: ' + value)
    return json.loads(raw.decode('utf-8'), object_pairs_hook=pairs, parse_constant=bad_constant)


def read(root, relative, maximum, digest=None, length=None):
    need(isinstance(relative, str) and relative and '\\' not in relative, 'unsafe artifact reference')
    item = pathlib.PurePosixPath(relative)
    need(not item.is_absolute() and all(part not in ('', '.', '..') for part in relative.split('/')), 'unsafe artifact reference')
    current = root
    for part in item.parts:
        current = current / part
        need(not current.is_symlink(), 'symlink artifact reference')
    need(current.is_file() and current.stat().st_size <= maximum, 'missing or oversized artifact')
    raw = current.read_bytes()
    need(len(raw) <= maximum, 'artifact changed beyond cap')
    if length is not None:
        need(len(raw) == length, 'artifact length mismatch')
    if digest is not None:
        need(isinstance(digest, str) and re.fullmatch('[a-f0-9]{64}', digest) and hashlib.sha256(raw).hexdigest() == digest, 'artifact hash mismatch')
    return raw


def expected_parts(collection, source_id):
    expected = {}
    need(collection.get('type') == 'FeatureCollection' and isinstance(collection.get('features'), list), 'invalid derived source')
    need(len(collection['features']) <= 5000, 'derived feature cap')
    for feature in collection['features']:
        props = feature['properties'] or {}
        geom = feature['geometry']
        coords = geom['coordinates']
        identifier = feature['id']
        need(isinstance(identifier, (str, int)) and not isinstance(identifier, bool), 'invalid feature identity')
        base = source_id + ':' + str(identifier)
        building = 'building' in props and props['building'] is not None and props['building'] is not False and props['building'] != 'no'
        if building and geom['type'] in ('Polygon', 'MultiPolygon'):
            parts = [coords] if geom['type'] == 'Polygon' else coords
            for ordinal, rings in enumerate(parts):
                key = f'{base}/building/{ordinal}'
                need(key not in expected, 'duplicate source part')
                expected[key] = ('building', [[p[:2] for p in ring] for ring in rings])
        elif props.get('highway') is not None and geom['type'] in ('LineString', 'MultiLineString'):
            parts = [coords] if geom['type'] == 'LineString' else coords
            for ordinal, points in enumerate(parts):
                key = f'{base}/road/{ordinal}'
                need(key not in expected, 'duplicate source part')
                expected[key] = ('road', [p[:2] for p in points])
        else:
            raise ValueError('unsupported feature in an owned derived input')
    return expected


def verify(root_value, index_path, index_hash, report_path, report_hash):
    root = pathlib.Path(root_value)
    need(root.is_absolute() and root.resolve() == root and root.is_dir(), 'root must be canonical directory')
    for parent in [root, *root.parents]:
        need(not parent.is_symlink(), 'root has symlink ancestor')
    index = parse(read(root, index_path, 30_000_000, index_hash))
    report = parse(read(root, report_path, 20_000_000, report_hash))
    need(index['schemaVersion'] == 1 and index['compilerVersion'] == 'regional-whole-feature-fanout-v1' and index['coverage'] == 'foundation', 'unsupported regional index')
    cells = index['cells']
    need(isinstance(cells, list) and 1 <= len(cells) <= 64, 'invalid cell denominator')
    need(report['status'] == 'complete' and not report['failures'] and report['stopped'] is None, 'campaign is not successfully terminal')
    jobs = report['jobs']
    owners = [c for c in cells if c['status'] == 'owned-features']
    need(len(jobs) == len(owners) + 1 and all(j['status'] == 'completed' for j in jobs), 'campaign denominator or states differ')
    by_cell = {}
    protected = 0
    for job in jobs:
        unit = job['payload']['unit']
        need(job['payload']['inventoryHash'] == index['request']['inventoryHash'], 'campaign inventory pin differs')
        if unit['kind'] == 'protected':
            need(unit['id'] == 'legacy-ng' and unit['inventoryUnitId'] == 'legacy-ng' and job['result']['status'] == 'protected', 'unexpected protected result')
            protected += 1
        else:
            need(unit['kind'] == 'local' and unit['inventoryUnitId'] == index['request']['inventoryUnitId'], 'nonlocal or foreign campaign unit')
            need(unit['id'] not in by_cell, 'duplicate campaign cell')
            by_cell[unit['id']] = job
    need(protected == 1 and set(by_cell) == {c['region']['id'] for c in owners}, 'campaign lost declared owner cells or Nigeria protection')
    output = f"campaigns/{report['id']}/output"
    fanout = str(pathlib.PurePosixPath(index_path).parent.parent)
    seen_global = set()
    summaries = []
    total_bytes = 0
    for cell in cells:
        pinned = cell['input']
        source_raw = read(root, fanout + '/' + pinned['path'], 20_000_000, pinned['sha256'], pinned['bytes'])
        if cell['status'] == 'empty-owned':
            need(not cell['ownedFeatureKeys'] and not expected_parts(parse(source_raw), cell['plan']['source']['id']), 'empty-owned input has source parts')
            summaries.append({'cellId': cell['region']['id'], 'status': 'empty-owned', 'parts': 0, 'tiles': 0, 'bytes': 0, 'ownerDependencies': cell['ownerDependencies']})
            continue
        job = by_cell[cell['region']['id']]
        result = job['result']
        plan = {**cell['plan'], 'input': {**cell['plan']['input'], 'path': str(root / fanout / pinned['path'])}}
        need(job['payload']['unit']['plan'] == plan and result['plan'] == plan, 'campaign plan differs from pinned regional plan')
        manifest_raw = read(root, output + '/' + result['manifestPath'], 10_000_000, result['manifestHash'])
        manifest = parse(manifest_raw)
        need(manifest['region'] == plan['region'] and manifest['sources'] == [plan['source']] and manifest['coverage'] == 'foundation' and manifest['climate'] is None, 'manifest semantics differ from derived plan')
        expected = expected_parts(parse(source_raw), plan['source']['id'])
        indexed = {part for feature in index['features'] if feature['ownerCellId'] == cell['region']['id'] for part in feature['partIds']}
        need(indexed == set(expected), 'index part set differs from derived input')
        emitted = set()
        size = len(manifest_raw)
        for ref in manifest['tiles']:
            tile_raw = read(root, output + '/' + ref['path'], 10_000_000, ref['sha256'], ref['bytes'])
            tile = parse(tile_raw)
            need(tile['schemaVersion'] == 1 and tile['id'] == ref['id'] and tile['regionId'] == cell['region']['id'] and tile['bounds'] == ref['bounds'], 'tile identity differs')
            size += len(tile_raw)
            for plural, kind, field in [('buildings', 'building', 'rings'), ('roads', 'road', 'points')]:
                for item in tile[plural]:
                    key = item['id']
                    need(key not in emitted and key not in seen_global, 'duplicate emitted part across cells')
                    need(key in expected and expected[key] == (kind, item[field]) and item['sourceId'] == plan['source']['id'], 'changed or foreign emitted source part')
                    emitted.add(key)
                    seen_global.add(key)
        need(emitted == set(expected) and size == result['bytes'], 'missing part or logical output count mismatch')
        total_bytes += size
        summaries.append({'cellId': cell['region']['id'], 'manifestHash': result['manifestHash'], 'parts': len(emitted), 'tiles': len(manifest['tiles']), 'bytes': size})
    need(len(seen_global) == index['counts']['emittedParts'], 'global emitted count mismatch')
    return {'status': 'verified-exact-regional-campaign-source-parts', 'indexHash': index_hash, 'reportHash': report_hash, 'cells': summaries, 'emittedParts': len(seen_global), 'packBytes': total_bytes, 'protectedNigeria': protected, 'limitations': ['Ownership correctness is checked by the separate raw-parent regional verifier.', 'This checks exact captured part coordinates/identities, not source completeness, topology, height accuracy, distribution rights or gameplay.']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for flag in ('root', 'index-path', 'index-hash', 'report-path', 'report-hash'):
        parser.add_argument('--' + flag, required=True)
    args = parser.parse_args()
    print(json.dumps(verify(args.root, args.index_path, args.index_hash, args.report_path, args.report_hash), indent=2, allow_nan=False))
