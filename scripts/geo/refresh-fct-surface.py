"""Recreate the FCT land/water and transport source from pinned public data.

Optional source refresh; normal geo:boundaries --fct needs no Python packages.
Requires pyosmium 4.3.1 and Shapely 2.1.2. Reuse verified extracted records with
--extracted-dir, or replay their extraction from the pinned PBF with --pbf.
"""
import argparse
import hashlib
import json
from pathlib import Path
from shapely import set_precision
from shapely.geometry import LineString, box, mapping, shape
from shapely.ops import linemerge, unary_union

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'scripts/geo/sources/fct-surface.geojson'
CACHE = ROOT / '.cache/geo'
PBF_SHA256 = '6dfa568106792fb8a9bba0b12a91e1edfb789d38c452087b2c48bc58326880b5'
ADM1_SHA256 = '64fa218ac3d453cc1e66412ff461c5dfa1a4a1ade0da93b239a9891b587d28f9'
ADM2_SHA256 = 'bef7f2cfa45e012f4772eaa61c7b99e5188aeba4d5c6badae7e9f9aae8c02fcd'
RECORD_HASHES = {
    'water-areas': '6736585fda0d06b5e455ada8179f0014688205f781b8f73730a7eecdf16cb78a',
    'roads': '905d3d9991255bc80c1f82d8a61e90881f3145ff715596f0520144ed26c5515b',
    'rail': 'f6f937ed05e0a8494428a9b5e013af3a8f68a2257d6549bf389df8bf510c7250',
}
UNITS = [('Municipal Area Council', 'abuja-municipal'), ('Bwari', 'bwari'),
         ('Gwagwalada', 'gwagwalada'), ('Kuje', 'kuje'), ('Kwali', 'kwali'), ('Abaji', 'abaji')]
BBOX = box(6.65, 8.3, 7.85, 9.6)
ROAD_NAMES = {
    "Umaru Musa Yar'Adua Expressway", 'Murtala Mohammed Expressway', 'Nnamdi Azikiwe Expressway',
    'Constitution Avenue', 'Independence Avenue', 'Ahmadu Bello Way', 'Shehu Shagari Way',
    'Sani Abacha Way', 'Sani Abacha Way North', 'Sani Abacha Way South', 'Bill Clinton Drive',
    'Yakubu Gowon Crescent', 'Aminu Kano Crescent', 'Ibrahim Babangida Way', 'Aguiyi Ironsi Street',
    'Herbert Macaulay Way', 'Obafemi Awolowo Way', 'Abuja-Kaduna Highway', 'Abuja-Keffi Expressway',
    'Ring Road 2', 'Goodluck Ebele Jonathan Expressway', 'Zuba Garki Road', 'Gwagwalada Road',
}


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as f:
        while block := f.read(1 << 20):
            result.update(block)
    return result.hexdigest()


def pinned_json(path, sha):
    if digest(path) != sha:
        raise ValueError(f'{path.name}: pinned SHA-256 mismatch')
    return json.loads(path.read_text())


def rounded(value):
    if isinstance(value, (float, int)):
        return round(value, 7)
    return [rounded(x) for x in value]


def extract(pbf):
    import osmium
    if pbf.stat().st_size != 709273731 or digest(pbf) != PBF_SHA256:
        raise ValueError('Nigeria PBF bytes or SHA-256 mismatch')

    class Extract(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.areas, self.roads, self.rail = [], [], []
            self.factory = osmium.geom.GeoJSONFactory()

        def area(self, area):
            if area.tags.get('natural') != 'water' and area.tags.get('water') not in ('reservoir', 'lake') and area.tags.get('landuse') != 'reservoir':
                return
            try:
                g = shape(json.loads(self.factory.create_multipolygon(area)))
            except Exception:
                return
            if not g.intersects(BBOX):
                return
            m = mapping(g.intersection(BBOX))
            self.areas.append({'osmType': 'way' if area.from_way() else 'relation', 'osmId': area.orig_id(),
                'tags': {k: v for k, v in dict(area.tags).items() if k in ('name', 'natural', 'water', 'waterway', 'landuse', 'reservoir', 'alt_name')},
                'geometry': {'type': m['type'], 'coordinates': rounded(m['coordinates'])}})

        def way(self, way):
            road = way.tags.get('highway') in ('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link')
            rail = way.tags.get('railway') in ('rail', 'light_rail', 'tram')
            if not road and not rail:
                return
            try:
                pts = [[round(n.lon, 7), round(n.lat, 7)] for n in way.nodes]
            except Exception:
                return
            if len(pts) < 2 or not LineString(pts).intersects(BBOX):
                return
            rec = {'osmType': 'way', 'osmId': way.id,
                'tags': {k: v for k, v in dict(way.tags).items() if k in ('name', 'alt_name', 'ref', 'highway', 'railway', 'service', 'operator', 'network', 'route', 'electrified', 'usage')}, 'points': pts}
            if road:
                self.roads.append(rec)
            if rail:
                self.rail.append(rec)

    h = Extract()
    h.apply_file(str(pbf), locations=True)
    records = {'water-areas': h.areas, 'roads': h.roads, 'rail': h.rail}
    for stem, data in records.items():
        raw = (json.dumps(data, separators=(',', ':')) + '\n').encode()
        if hashlib.sha256(raw).hexdigest() != RECORD_HASHES[stem]:
            raise ValueError(f'{stem}: replay differs from accepted extraction')
    return records


def polygonal(g):
    parts = [p for p in (g.geoms if hasattr(g, 'geoms') else [g]) if p.geom_type == 'Polygon' and not p.is_empty]
    return unary_union(parts)


def feature(kind, identity, g, **extra):
    m = mapping(g)
    return {'type': 'Feature', 'properties': {'kind': kind, 'id': identity, **extra},
            'geometry': {'type': m['type'], 'coordinates': rounded(m['coordinates'])}}


def lines(g):
    return [p for p in (g.geoms if hasattr(g, 'geoms') else [g]) if p.geom_type == 'LineString' and p.length > 0]


def transport(records, state, kind):
    selected = [r for r in records if (r['tags'].get('name') in ROAD_NAMES or r['tags'].get('ref') in ('A2', 'A124'))] if kind == 'road' else [r for r in records if not r['tags'].get('service')]
    groups = {}
    for r in selected:
        name = r['tags'].get('name') or r['tags'].get('ref') or ('Abuja–Kaduna railway' if r['tags'].get('railway') == 'rail' else 'Abuja light rail')
        key = (name, r['tags'].get('railway', 'road'))
        groups.setdefault(key, []).append(r)
    features = []
    for (name, mode), group in sorted(groups.items()):
        raw = unary_union([LineString(r['points']) for r in group])
        merged = linemerge(raw) if raw.geom_type != 'LineString' else raw
        # Railway context ends at the extraction edge, never at an invented Kaduna coordinate.
        clip = BBOX if mode == 'rail' else state
        segments = lines(merged.intersection(clip))
        for i, line in enumerate(sorted(segments, key=lambda p: (p.bounds, list(p.coords)[0]))):
            if mode == 'rail' and not line.intersects(state):
                continue
            simplified = line.simplify(0.00008, preserve_topology=True)
            features.append(feature(kind, f'{kind}-{len(features)}', simplified, name=name, mode=mode,
                                    osmWays=sorted(r['osmId'] for r in group)))
    return features


def derive(records):
    adm1 = pinned_json(CACHE / 'geoBoundaries-NGA-ADM1-9469f09.geojson', ADM1_SHA256)['features']
    adm2 = pinned_json(CACHE / 'geoBoundaries-NGA-ADM2-9469f09.geojson', ADM2_SHA256)['features']
    state = set_precision(shape(next(f['geometry'] for f in adm1 if f['properties']['shapeName'] == 'Abuja Federal Capital Territory')), 1e-7)
    units = {identity: set_precision(shape(next(f['geometry'] for f in adm2 if f['properties']['shapeName'] == name)), 1e-7) for name, identity in UNITS}
    if unary_union(list(units.values())).symmetric_difference(state).area > 1e-12:
        raise ValueError('Six councils do not exactly partition pinned FCT ADM1')
    water_records = [r for r in records['water-areas'] if shape(r['geometry']).intersects(state)]
    water = set_precision(polygonal(unary_union([shape(r['geometry']) for r in water_records]).intersection(state)), 1e-7)
    features = []
    for identity, unit in units.items():
        features.append(feature('land', identity, polygonal(unit.difference(water))))
        wet = polygonal(unit.intersection(water))
        if not wet.is_empty:
            features.append(feature('water', identity, wet))
    features.extend(transport(records['roads'], state, 'road'))
    features.extend(transport(records['rail'], state, 'rail'))
    return {'type': 'FeatureCollection', 'metadata': {
        'source': '© OpenStreetMap contributors, ODbL 1.0; geoBoundaries gbOpen GRID3 2022, CC BY 4.0',
        'pbfUrl': 'https://download.geofabrik.de/africa/nigeria-261003.osm.pbf', 'pbfDate': '2026-10-03',
        'retrieved': '2026-10-05', 'pbfSha256': PBF_SHA256, 'pbfBytes': 709273731,
        'admRelease': '9469f09', 'adm1Sha256': ADM1_SHA256, 'adm2Sha256': ADM2_SHA256,
        'extractedRecordSha256': RECORD_HASHES, 'coordinatePrecisionDegrees': 1e-7,
        'waterObjects': [[r['osmType'], r['osmId']] for r in water_records],
        'waterSimplificationDegrees': 0, 'transportSimplificationDegrees': 0.00008,
        'railPreviewExtent': [6.65, 8.3, 7.85, 9.6],
        'railPreviewNote': 'Sourced FCT/northbound section only, not the full route to Kaduna; no invented connectors',
        'roadNames': 'Mapped source names retained; Airport Road is Umaru Musa Yar’Adua Expressway; northern/southern expressways are Murtala Mohammed/Nnamdi Azikiwe Expressways',
    }, 'features': features}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument('--pbf', type=Path)
    group.add_argument('--extracted-dir', type=Path)
    p.add_argument('--check', action='store_true')
    args = p.parse_args()
    records = extract(args.pbf) if args.pbf else {stem: pinned_json(args.extracted_dir / f'{stem}.json', sha) for stem, sha in RECORD_HASHES.items()}
    raw = (json.dumps(derive(records), separators=(',', ':'), ensure_ascii=False) + '\n').encode()
    sha = hashlib.sha256(raw).hexdigest()
    if args.check:
        if SOURCE.read_bytes() != raw:
            raise ValueError(f'FCT source differs: generated SHA-256 {sha}')
        print(f'FCT source matches: {len(raw)} bytes, SHA-256 {sha}')
    else:
        SOURCE.write_bytes(raw)
        print(f'FCT source wrote {len(raw)} bytes, SHA-256 {sha}')


if __name__ == '__main__':
    main()
