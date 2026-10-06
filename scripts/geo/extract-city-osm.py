"""Build one deterministic city surface from the pinned Nigeria Geofabrik PBF.

The output is an intermediate source file. The TypeScript city generator reads it
without Python or network access, so ``--check`` stays offline and reproducible.

Requires Python osmium 4.3.1 and Shapely 2.1.2.
"""

import argparse
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory

import osmium
from shapely import set_precision
from shapely.geometry import LineString, box, mapping, shape
from shapely.ops import unary_union


ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.cache' / 'geo'
RELEASE = '9469f09'
PBF_URL = 'https://download.geofabrik.de/africa/nigeria-261003.osm.pbf'
PBF_DATE = '2026-10-03'
PBF_SHA256 = '6dfa568106792fb8a9bba0b12a91e1edfb789d38c452087b2c48bc58326880b5'
PBF_BYTES = 709_273_731
ADM1_SHA256 = '64fa218ac3d453cc1e66412ff461c5dfa1a4a1ade0da93b239a9891b587d28f9'
ADM2_SHA256 = 'bef7f2cfa45e012f4772eaa61c7b99e5188aeba4d5c6badae7e9f9aae8c02fcd'
HIGHWAYS = {
    'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
    'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
}
RAILS = {'rail', 'light_rail', 'tram'}


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        while block := source.read(1 << 20):
            digest.update(block)
    return digest.hexdigest()


def pinned_json(path, expected_hash):
    if not path.is_file():
        raise ValueError(f'Missing pinned source {path}')
    if sha256_file(path) != expected_hash:
        raise ValueError(f'{path.name}: pinned SHA-256 mismatch')
    return json.loads(path.read_text())


def rounded(value):
    if isinstance(value, (float, int)):
        return round(value, 7)
    return [rounded(item) for item in value]


def polygonal(geometry):
    pieces = [
        item for item in (geometry.geoms if hasattr(geometry, 'geoms') else [geometry])
        if item.geom_type == 'Polygon' and not item.is_empty and item.area > 0
    ]
    if not pieces:
        return None
    return pieces[0] if len(pieces) == 1 else unary_union(pieces)


def polygon_feature(kind, identity, local_unit_id, name, geometry):
    polygon = polygonal(geometry)
    if polygon is None:
        return None
    output = mapping(polygon)
    return {
        'type': 'Feature',
        'properties': {
            'kind': kind,
            'id': identity,
            'localUnitId': local_unit_id,
            'name': name,
        },
        'geometry': {'type': output['type'], 'coordinates': rounded(output['coordinates'])},
    }


def line_features(kind, record, clip):
    line = LineString(record['points']).intersection(clip)
    pieces = [
        item for item in (line.geoms if hasattr(line, 'geoms') else [line])
        if item.geom_type == 'LineString' and not item.is_empty and len(item.coords) >= 2
    ]
    features = []
    for index, piece in enumerate(sorted(pieces, key=lambda item: (item.bounds, list(item.coords)[0]))):
        simplified = piece.simplify(0.00008, preserve_topology=True)
        tags = record['tags']
        mode = tags.get('highway') or tags.get('railway') or kind
        name = tags.get('name') or tags.get('ref') or f'Unnamed mapped {mode}'
        features.append({
            'type': 'Feature',
            'properties': {
                'kind': kind,
                'id': f'{kind}-{record["osmId"]}-{index}',
                'name': name,
                'osmWay': record['osmId'],
                'major': tags.get('highway') in {'motorway', 'trunk', 'primary'},
                'bridge': tags.get('bridge') in {'yes', 'viaduct'},
            },
            'geometry': {'type': 'LineString', 'coordinates': rounded(list(simplified.coords))},
        })
    return features


class CityExtract(osmium.SimpleHandler):
    def __init__(self, bounds):
        super().__init__()
        self.bounds = bounds
        self.factory = osmium.geom.GeoJSONFactory()
        self.water = []
        self.roads = []
        self.rail = []

    def area(self, area):
        tags = dict(area.tags)
        is_water = (
            tags.get('natural') == 'water'
            or tags.get('water') in {'reservoir', 'lake'}
            or tags.get('waterway') in {'riverbank', 'dock'}
            or tags.get('landuse') == 'reservoir'
        )
        if not is_water:
            return
        try:
            geometry = shape(json.loads(self.factory.create_multipolygon(area)))
        except Exception:
            return
        if geometry.intersects(self.bounds):
            self.water.append({
                'osmType': 'way' if area.from_way() else 'relation',
                'osmId': area.orig_id(),
                'geometry': geometry.intersection(self.bounds),
            })

    def way(self, way):
        tags = dict(way.tags)
        road = tags.get('highway') in HIGHWAYS
        rail = tags.get('railway') in RAILS and not tags.get('service')
        if not road and not rail:
            return
        try:
            points = [[round(node.lon, 7), round(node.lat, 7)] for node in way.nodes]
        except Exception:
            return
        if len(points) < 2 or not LineString(points).intersects(self.bounds):
            return
        record = {'osmId': way.id, 'tags': tags, 'points': points}
        if road:
            self.roads.append(record)
        if rail:
            self.rail.append(record)


def local_unit_argument(value):
    if '=' not in value:
        raise argparse.ArgumentTypeError('Expected ID=geoBoundaries source name')
    identity, source_name = value.split('=', 1)
    if not identity or not source_name:
        raise argparse.ArgumentTypeError('Expected non-empty ID=geoBoundaries source name')
    return identity, source_name


def select_source(adm1, adm2, state_source_name, requested_units):
    states = [item for item in adm1['features'] if item['properties']['shapeName'] == state_source_name]
    if len(states) != 1:
        raise ValueError(f'{state_source_name}: expected one ADM1 feature, found {len(states)}')
    state = set_precision(shape(states[0]['geometry']), 1e-7)
    units = {}
    for identity, source_name in requested_units:
        named = [item for item in adm2['features'] if item['properties']['shapeName'] == source_name]
        matched = [item for item in named if state.covers(shape(item['geometry']).representative_point())]
        if len(matched) != 1:
            raise ValueError(f'{source_name}: expected one ADM2 feature in state, found {len(matched)} of {len(named)} national matches')
        units[identity] = set_precision(shape(matched[0]['geometry']), 1e-7)
    for left, left_geometry in units.items():
        for right, right_geometry in units.items():
            if left >= right:
                continue
            overlap = left_geometry.intersection(right_geometry).area
            if overlap > 1e-12:
                raise ValueError(f'{left} and {right} overlap by {overlap} square degrees')
    return state, units


def derive(args):
    pbf = args.pbf
    if not pbf.is_file() or pbf.stat().st_size != PBF_BYTES or sha256_file(pbf) != PBF_SHA256:
        raise ValueError('Nigeria PBF bytes or SHA-256 do not match the pinned 2026-10-03 file')
    adm1 = pinned_json(CACHE / f'geoBoundaries-NGA-ADM1-{RELEASE}.geojson', ADM1_SHA256)
    adm2 = pinned_json(CACHE / f'geoBoundaries-NGA-ADM2-{RELEASE}.geojson', ADM2_SHA256)
    state, units = select_source(adm1, adm2, args.state_source_name, args.local_unit)
    footprint = unary_union(list(units.values()))
    extraction_bounds = box(*footprint.bounds).buffer(0.05)
    extract = CityExtract(extraction_bounds)
    CACHE.mkdir(parents=True, exist_ok=True)
    # A national PBF has too many node locations for pyosmium's default in-memory index on a small workstation.
    # The file-backed sparse index lives in a temporary directory and is removed after this one sequential pass.
    with TemporaryDirectory(prefix=f'{args.city_id}-osmium-', dir=CACHE) as temporary:
        node_index = Path(temporary) / 'nodes.idx'
        extract.apply_file(str(pbf), locations=True, idx=f'sparse_file_array,{node_index}')
    water_records = sorted(extract.water, key=lambda item: (item['osmType'], item['osmId']))
    mapped_water = polygonal(unary_union([item['geometry'] for item in water_records]).intersection(footprint)) if water_records else None
    water = set_precision(mapped_water if mapped_water is not None else footprint.difference(footprint), 1e-7)
    state_feature = polygon_feature('state', f'state:{args.state_id}', args.state_id, args.state_source_name, state)
    if state_feature is None:
        raise ValueError(f'{args.state_id}: state boundary is empty')
    features = [state_feature]
    for identity, source_name in args.local_unit:
        administrative = polygon_feature('administrative', f'administrative:{identity}', identity, source_name, units[identity])
        if administrative is None:
            raise ValueError(f'{identity}: administrative boundary is empty')
        features.append(administrative)
    for identity, source_name in args.local_unit:
        unit = units[identity]
        land_feature = polygon_feature('land', identity, identity, source_name, unit.difference(water))
        if land_feature is None:
            raise ValueError(f'{identity}: mapped water removes the whole local unit')
        features.append(land_feature)
        water_feature = polygon_feature('water', f'water:{identity}', identity, f'Mapped water in {source_name}', unit.intersection(water))
        if water_feature is not None:
            features.append(water_feature)
    for record in sorted(extract.roads, key=lambda item: item['osmId']):
        features.extend(line_features('road', record, footprint))
    for record in sorted(extract.rail, key=lambda item: item['osmId']):
        features.extend(line_features('rail', record, footprint))
    return {
        'type': 'FeatureCollection',
        'metadata': {
            'source': 'Geofabrik Nigeria OSM extract, OpenStreetMap contributors, ODbL 1.0; geoBoundaries gbOpen GRID3 2022, CC BY 4.0',
            'surfaceFormatVersion': 1,
            'pbfUrl': PBF_URL,
            'pbfDate': PBF_DATE,
            'pbfSha256': PBF_SHA256,
            'pbfBytes': PBF_BYTES,
            'boundaryRelease': RELEASE,
            'adm1Sha256': ADM1_SHA256,
            'adm2Sha256': ADM2_SHA256,
            'cityId': args.city_id,
            'stateId': args.state_id,
            'stateSourceName': args.state_source_name,
            'localUnits': [list(item) for item in args.local_unit],
            'coordinatePrecisionDegrees': 1e-7,
            'transportSimplificationDegrees': 0.00008,
            'locationIndex': 'sparse_file_array',
            'waterObjects': [[item['osmType'], item['osmId']] for item in water_records],
        },
        'features': features,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--city-id', required=True)
    parser.add_argument('--state-id', required=True)
    parser.add_argument('--state-source-name', required=True)
    parser.add_argument('--local-unit', action='append', required=True, type=local_unit_argument, metavar='ID=SOURCE_NAME')
    parser.add_argument('--pbf', type=Path, default=CACHE / 'nigeria-261003.osm.pbf')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if len({identity for identity, _ in args.local_unit}) != len(args.local_unit):
        raise ValueError('Local-unit ids must be unique')
    if len({source_name for _, source_name in args.local_unit}) != len(args.local_unit):
        raise ValueError('Local-unit source names must be unique')
    output = args.output or ROOT / 'scripts' / 'geo' / 'sources' / 'formula' / f'{args.city_id}-surface.geojson'
    raw = (json.dumps(derive(args), separators=(',', ':'), ensure_ascii=False) + '\n').encode()
    digest = hashlib.sha256(raw).hexdigest()
    if args.check:
        if not output.is_file() or output.read_bytes() != raw:
            raise ValueError(f'{output}: generated source differs, SHA-256 {digest}')
        print(f'{output}: matches {len(raw)} bytes, SHA-256 {digest}')
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_suffix(f'{output.suffix}.{hashlib.sha256(raw).hexdigest()[:12]}.part')
        temporary.write_bytes(raw)
        temporary.replace(output)
        print(f'{output}: wrote {len(raw)} bytes, SHA-256 {digest}')


if __name__ == '__main__':
    main()
