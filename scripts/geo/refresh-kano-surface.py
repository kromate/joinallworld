"""Reproduce Kano land/water and local transport from the pinned Nigeria PBF.

Optional refresh requires pyosmium 4.3.1 and Shapely 2.1.2. Normal Node.js
geo:boundaries --kano reads the committed GeoJSON and needs no GIS package.
Native tag/entity filters select relevant source ways and water areas.
"""
import argparse
import hashlib
import json
from pathlib import Path
from shapely import set_precision
from shapely.geometry import LineString, box, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.cache/geo'
SOURCE = ROOT / 'scripts/geo/sources/kano-surface.geojson'
PBF_SHA256 = '6dfa568106792fb8a9bba0b12a91e1edfb789d38c452087b2c48bc58326880b5'
ADM1_SHA256 = '64fa218ac3d453cc1e66412ff461c5dfa1a4a1ade0da93b239a9891b587d28f9'
ADM2_SHA256 = 'bef7f2cfa45e012f4772eaa61c7b99e5188aeba4d5c6badae7e9f9aae8c02fcd'
RECORD_HASHES = {
    'water-areas': '837cc41f27916a6f6b65a56a8cac12aaf0a72362b2c5416d4660183b7df13996',
    'roads': '32e5c4564702df1bf9be7978eb81aa419364c25d7929ea224186244cdf9230b2',
    'rail': '0faca00a0d986929c937e34da14d10dc0f392a92aed608b95beb39bbe1b4067b',
}
UNITS = [('Kano Municipal', 'kano-municipal'), ('Dala', 'dala'), ('Fagge', 'fagge'),
         ('Gwale', 'gwale'), ('Nassarawa', 'nassarawa'), ('Tarauni', 'tarauni'),
         ('Kumbotso', 'kumbotso'), ('Ungogo', 'ungogo')]
STATE_BBOX = box(7.675, 10.54, 9.361, 12.605)
CITY_BBOX = box(8.1, 11.6, 8.9, 12.4)
HIGHWAYS = ('motorway', 'trunk', 'primary', 'secondary', 'tertiary')


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as f:
        while block := f.read(1 << 20):
            result.update(block)
    return result.hexdigest()


def pinned_json(path, expected):
    if digest(path) != expected:
        raise ValueError(f'{path.name}: pinned SHA-256 mismatch')
    return json.loads(path.read_text())


def extract(pbf):
    import osmium
    if pbf.stat().st_size != 709273731 or digest(pbf) != PBF_SHA256:
        raise ValueError('Pinned Nigeria PBF bytes or SHA-256 mismatch')
    roads, rail, water = [], [], []
    criteria = [('historic', 'citywalls'), ('historic', 'city_gate'), ('barrier', 'city_wall'),
                ('barrier', 'wall'), ('railway', 'rail')] + [('highway', v) for v in HIGHWAYS]
    fp = osmium.FileProcessor(str(pbf), entities=osmium.osm.NODE | osmium.osm.WAY).with_locations()
    fp.with_filter(osmium.filter.EntityFilter(osmium.osm.WAY)).with_filter(osmium.filter.TagFilter(*criteria))
    for way in fp:
        pts = [[round(n.lon, 7), round(n.lat, 7)] for n in way.nodes]
        if len(pts) < 2 or not any(8.1 <= x <= 8.9 and 11.6 <= y <= 12.4 for x, y in pts):
            continue
        tags = dict(way.tags)
        rec = {'osmId': way.id, 'nodeIds': [n.ref for n in way.nodes], 'tags': tags, 'points': pts}
        if tags.get('highway') in HIGHWAYS:
            roads.append(rec)
        if tags.get('railway') == 'rail':
            rail.append(rec)
    factory = osmium.geom.GeoJSONFactory()
    waterfilter = osmium.filter.TagFilter(('natural', 'water'), ('water', 'reservoir'), ('water', 'lake'), ('landuse', 'reservoir'))
    fp = osmium.FileProcessor(str(pbf)).with_areas(waterfilter).with_filter(osmium.filter.EntityFilter(osmium.osm.AREA)).with_filter(waterfilter)
    for area in fp:
        try:
            g = shape(json.loads(factory.create_multipolygon(area)))
        except Exception:
            continue
        if not g.intersects(STATE_BBOX):
            continue
        water.append({'osmType': 'way' if area.from_way() else 'relation', 'osmId': area.orig_id(),
                      'tags': dict(area.tags), 'geometry': mapping(g.intersection(STATE_BBOX))})
    records = {'roads': roads, 'rail': rail, 'water-areas': water}
    for stem, data in records.items():
        raw = (json.dumps(data, separators=(',', ':')) + '\n').encode()
        if hashlib.sha256(raw).hexdigest() != RECORD_HASHES[stem]:
            raise ValueError(f'{stem}: replay differs from accepted extraction')
    return records


def rounded(value):
    if isinstance(value, (float, int)):
        return round(value, 7)
    return [rounded(x) for x in value]


def polygonal(g):
    return unary_union([p for p in (g.geoms if hasattr(g, 'geoms') else [g]) if p.geom_type == 'Polygon' and not p.is_empty])


def feature(kind, identity, g, **extra):
    m = mapping(g)
    return {'type': 'Feature', 'properties': {'kind': kind, 'id': identity, **extra},
            'geometry': {'type': m['type'], 'coordinates': rounded(m['coordinates'])}}


def transport(records, city, kind):
    features = []
    for rec in records:
        tags = rec['tags']
        if kind == 'road' and (tags.get('highway') == 'tertiary' or not (tags.get('name') or tags.get('ref'))):
            continue
        if kind == 'rail' and tags.get('service'):
            continue
        clipped = LineString(rec['points']).intersection(city)
        pieces = [p for p in (clipped.geoms if hasattr(clipped, 'geoms') else [clipped]) if p.geom_type == 'LineString' and not p.is_empty]
        for i, line in enumerate(pieces):
            features.append(feature(kind, f'{kind}-{rec["osmId"]}-{i}', line.simplify(0.00006, preserve_topology=True),
                                    name=tags.get('name') or tags.get('ref') or 'Kano railway',
                                    osmWay=rec['osmId'], bridge=tags.get('bridge') == 'yes'))
    return features


def derive(records):
    adm1 = pinned_json(CACHE / 'geoBoundaries-NGA-ADM1-9469f09.geojson', ADM1_SHA256)['features']
    adm2 = pinned_json(CACHE / 'geoBoundaries-NGA-ADM2-9469f09.geojson', ADM2_SHA256)['features']
    state = set_precision(shape(next(f['geometry'] for f in adm1 if f['properties']['shapeName'] == 'Kano')), 1e-7)
    state_units = [f for f in adm2 if shape(f['geometry']).representative_point().within(state)]
    if len(state_units) != 44 or unary_union([set_precision(shape(f['geometry']), 1e-7) for f in state_units]).symmetric_difference(state).area > 1e-12:
        raise ValueError('44 original Kano ADM2 polygons must exactly partition the pinned ADM1 outline')
    by_name = {f['properties']['shapeName']: f for f in state_units}
    units = {identity: set_precision(shape(by_name[name]['geometry']), 1e-7) for name, identity in UNITS}
    city = unary_union(list(units.values()))
    wet_records = [r for r in records['water-areas'] if shape(r['geometry']).intersects(state)]
    water = set_precision(polygonal(unary_union([shape(r['geometry']) for r in wet_records]).intersection(state)), 1e-7)
    features = []
    for identity, unit in units.items():
        features.append(feature('land', identity, polygonal(unit.difference(water))))
        wet = polygonal(unit.intersection(water))
        if not wet.is_empty:
            features.append(feature('water', identity, wet))
    features.append(feature('state-water', 'kano', water.simplify(0.00002, preserve_topology=True)))
    features.extend(transport(records['roads'], city, 'road'))
    features.extend(transport(records['rail'], city, 'rail'))
    return {'type': 'FeatureCollection', 'metadata': {
        'source': '© OpenStreetMap contributors, ODbL 1.0; geoBoundaries gbOpen GRID3 2022, CC BY 4.0',
        'pbfUrl': 'https://download.geofabrik.de/africa/nigeria-261003.osm.pbf', 'pbfDate': '2026-10-03',
        'retrieved': '2026-10-05', 'pbfSha256': PBF_SHA256, 'pbfBytes': 709273731,
        'admRelease': '9469f09', 'adm1Sha256': ADM1_SHA256, 'adm2Sha256': ADM2_SHA256,
        'extractedRecordSha256': RECORD_HASHES, 'coordinatePrecisionDegrees': 1e-7,
        'waterObjects': [[r['osmType'], r['osmId']] for r in wet_records],
        'waterSimplificationDegrees': 0, 'overviewWaterSimplificationDegrees': 0.00002,
        'transportSimplificationDegrees': 0.00006, 'roadSelection': 'Named/ref primary, secondary, trunk and motorway ways in the eight-LGA footprint',
        'railNote': 'Local source railway segments only; no inferred national route or service availability',
        'wallNote': 'No identified ancient Kano wall line in the pinned OSM extract; unnamed modern walls and road embankments are not relabelled',
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
            raise ValueError(f'Kano source differs: generated SHA-256 {sha}')
        print(f'Kano source matches: {len(raw)} bytes, SHA-256 {sha}')
    else:
        SOURCE.write_bytes(raw)
        print(f'Kano source wrote {len(raw)} bytes, SHA-256 {sha}')


if __name__ == '__main__':
    main()
