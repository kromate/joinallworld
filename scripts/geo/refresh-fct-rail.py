"""Reproduce the Idu–Rigasa source-node railway from the pinned Nigeria PBF.

Requires pyosmium 4.3.1 for --pbf; --extracted-file can reuse verified records.
Native way/tag filters avoid Python callbacks for national node tags. No GIS
package is needed. Normal geo:boundaries --fct reads the committed source only.
"""
import argparse
from collections import deque
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'scripts/geo/sources/fct-kaduna-rail.geojson'
PBF_SHA256 = '6dfa568106792fb8a9bba0b12a91e1edfb789d38c452087b2c48bc58326880b5'
RECORD_SHA256 = 'c492f20a94060492a91eb29d24da6034153fa92bdcac0b9f202ebf80c9466bf7'
IDU_TRACK_NODE, RIGASA_TRACK_NODE = 4597112607, 7449693942


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as f:
        while block := f.read(1 << 20):
            result.update(block)
    return result.hexdigest()


def extract(pbf):
    import osmium
    if pbf.stat().st_size != 709273731 or digest(pbf) != PBF_SHA256:
        raise ValueError('Pinned Nigeria PBF bytes or SHA-256 mismatch')
    records = []
    processor = osmium.FileProcessor(str(pbf), entities=osmium.osm.WAY | osmium.osm.NODE).with_locations()
    processor.with_filter(osmium.filter.EntityFilter(osmium.osm.WAY))
    processor.with_filter(osmium.filter.TagFilter(('railway', 'rail')))
    for way in processor:
        if way.tags.get('service'):
            continue
        pts = [[round(n.lon, 7), round(n.lat, 7)] for n in way.nodes]
        if not any(7.1 <= x <= 7.9 and 9.0 <= y <= 10.8 for x, y in pts):
            continue
        records.append({'osmId': way.id, 'tags': dict(way.tags), 'nodeIds': [n.ref for n in way.nodes], 'points': pts})
    raw = (json.dumps(records, separators=(',', ':')) + '\n').encode()
    if hashlib.sha256(raw).hexdigest() != RECORD_SHA256:
        raise ValueError('Corridor extraction differs from accepted records')
    return records


def derive(records):
    graph, nodes = {}, {}
    for way in records:
        if way['tags'].get('gauge') != '1435':
            continue
        for node, point in zip(way['nodeIds'], way['points']):
            if node in nodes and nodes[node] != point:
                raise ValueError('Shared source node coordinates disagree')
            nodes[node] = point
        for a, b in zip(way['nodeIds'], way['nodeIds'][1:]):
            graph.setdefault(a, []).append((b, way['osmId']))
            graph.setdefault(b, []).append((a, way['osmId']))
    previous = {IDU_TRACK_NODE: None}
    queue = deque([IDU_TRACK_NODE])
    while queue:
        at = queue.popleft()
        if at == RIGASA_TRACK_NODE:
            break
        for nxt, way in graph.get(at, []):
            if nxt not in previous:
                previous[nxt] = (at, way)
                queue.append(nxt)
    if RIGASA_TRACK_NODE not in previous:
        raise ValueError('No source-node connection from Idu to Rigasa')
    path, ways = [], set()
    at = RIGASA_TRACK_NODE
    while at is not None:
        path.append(at)
        parent = previous[at]
        if parent is None:
            break
        at, way = parent
        ways.add(way)
    path.reverse()
    return {'type': 'FeatureCollection', 'metadata': {
        'source': '© OpenStreetMap contributors, ODbL 1.0',
        'pbfUrl': 'https://download.geofabrik.de/africa/nigeria-261003.osm.pbf',
        'pbfDate': '2026-10-03', 'retrieved': '2026-10-05', 'pbfBytes': 709273731,
        'pbfSha256': PBF_SHA256, 'extractedRecordSha256': RECORD_SHA256,
        'selection': 'railway=rail, no service tag, gauge=1435; corridor 7.1..7.9 E, 9.0..10.8 N; connected only by exact source node identity',
        'osmWays': sorted(ways), 'osmNodeIds': path,
        'simplificationDegrees': 0, 'inventedConnectors': 0,
        'iduStation': {'osmType': 'node', 'osmId': 10660810222, 'lon': 7.342506, 'lat': 9.0469758},
        'rigasaStation': {'osmType': 'node', 'osmId': 3677156385, 'lon': 7.3549356, 'lat': 10.5487117},
        'rigasaTerminal': {'osmType': 'way', 'osmId': 488660318, 'lon': 7.3551313, 'lat': 10.5487356},
        'endpointNote': 'Ends at existing track nodes nearest the station references, approximately 104 m from Idu station and 93 m from Rigasa terminal centroid; no schematic connector to station buildings',
    }, 'features': [{'type': 'Feature', 'properties': {'id': 'abuja-kaduna-rail', 'name': 'Idu–Rigasa railway', 'a': 'abuja', 'b': 'kaduna', 'mode': 'rail'},
                     'geometry': {'type': 'LineString', 'coordinates': [nodes[node] for node in path]}}]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--pbf', type=Path)
    group.add_argument('--extracted-file', type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.pbf:
        records = extract(args.pbf)
    else:
        if digest(args.extracted_file) != RECORD_SHA256:
            raise ValueError('Rail extracted record SHA-256 mismatch')
        records = json.loads(args.extracted_file.read_text())
    raw = (json.dumps(derive(records), separators=(',', ':'), ensure_ascii=False) + '\n').encode()
    sha = hashlib.sha256(raw).hexdigest()
    if args.check:
        if SOURCE.read_bytes() != raw:
            raise ValueError(f'Rail source differs; generated SHA-256 {sha}')
        print(f'FCT railway matches: {len(raw)} bytes, SHA-256 {sha}')
    else:
        SOURCE.write_bytes(raw)
        print(f'FCT railway wrote {len(raw)} bytes, SHA-256 {sha}')


if __name__ == '__main__':
    main()
