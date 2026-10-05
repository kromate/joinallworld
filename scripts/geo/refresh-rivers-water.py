"""Recreate the pinned Rivers water source from the 2026-10-03 Geofabrik Nigeria PBF.

Optional source refresh tool. The normal `npm run geo:boundaries -- --rivers` build uses
only the committed GeoJSON and does not require Python GIS packages.
"""
import argparse
import hashlib
import heapq
import json
import math
from pathlib import Path

import numpy as np
import osmium
from shapely import contains_xy, set_precision
from shapely.geometry import LineString, Point, box, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.cache/geo'
SOURCE = ROOT / 'scripts/geo/sources/rivers-water.geojson'
PBF_URL = 'https://download.geofabrik.de/africa/nigeria-261003.osm.pbf'
PBF_SHA256 = '6dfa568106792fb8a9bba0b12a91e1edfb789d38c452087b2c48bc58326880b5'
ADM1_SHA256 = '64fa218ac3d453cc1e66412ff461c5dfa1a4a1ade0da93b239a9891b587d28f9'
ADM2_SHA256 = 'bef7f2cfa45e012f4772eaa61c7b99e5188aeba4d5c6badae7e9f9aae8c02fcd'
BBOX = box(6.65, 4.35, 7.60, 5.35)
ORIGIN = (7.0247212, 4.7576372)
DESTINATION = (7.0823282, 4.7471189)
UNITS = [
    ('Port-Harcourt', 'port-harcourt'), ('Obio/Akpor', 'obio-akpor'),
    ('Eleme', 'eleme'), ('Okrika', 'okrika'), ('Ikwerre', 'ikwerre'),
    ('Oyigbo', 'oyigbo'), ('Etche', 'etche'),
]
WATER_TAGS = {'natural': {'water', 'wetland'}, 'waterway': {'riverbank', 'dock'}}


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        while block := source.read(1 << 20):
            digest.update(block)
    return digest.hexdigest()


def pinned_json(path, expected):
    if sha256_file(path) != expected:
        raise ValueError(f'{path}: source SHA-256 does not match the pinned release')
    return json.loads(path.read_text())['features']


def rounded(value):
    if isinstance(value, (float, int)):
        return round(value, 7)
    return [rounded(item) for item in value]


class RiversAreas(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.records = []
        self.factory = osmium.geom.GeoJSONFactory()

    def area(self, area):
        if not any(area.tags.get(key) in values for key, values in WATER_TAGS.items()):
            return
        try:
            geometry = shape(json.loads(self.factory.create_multipolygon(area)))
        except Exception:
            return
        if not geometry.intersects(BBOX):
            return
        tags = dict(area.tags)
        clipped = mapping(geometry.intersection(BBOX))
        self.records.append({
            'osmType': 'way' if area.from_way() else 'relation',
            'osmId': area.orig_id(),
            'tags': {key: value for key, value in tags.items() if key in (
                'name', 'natural', 'water', 'waterway', 'wetland', 'landuse', 'place', 'amenity', 'shop')},
            'geometry': {'type': clipped['type'], 'coordinates': rounded(clipped['coordinates'])},
        })


def water_route(records, open_area):
    source_water = unary_union([shape(item['geometry']) for item in records if
                                item['tags'].get('natural') == 'water' or item['tags'].get('waterway') in ('riverbank', 'dock')])
    water = source_water.simplify(0.00005, preserve_topology=True).intersection(open_area)
    parts = list(water.geoms) if hasattr(water, 'geoms') else [water]
    part = next(p for p in parts if p.distance(Point(ORIGIN)) < 1e-6 and p.covers(Point(DESTINATION)))
    boardable = part.buffer(1e-7)
    for resolution in (0.0003, 0.0002, 0.00015, 0.0001):
        for x0, y0, x1, y1 in ((7.015, 4.70, 7.105, 4.77), (7.005, 4.67, 7.13, 4.80), (6.99, 4.63, 7.15, 4.82)):
            nx = int(math.ceil((x1 - x0) / resolution)) + 1
            ny = int(math.ceil((y1 - y0) / resolution)) + 1
            gx = x0 + np.arange(nx) * resolution
            gy = y0 + np.arange(ny) * resolution
            xx, yy = np.meshgrid(gx, gy, indexing='ij')
            valid = contains_xy(part, xx, yy)

            def nearest(point):
                ix = int(round((point[0] - x0) / resolution))
                iy = int(round((point[1] - y0) / resolution))
                candidates = []
                for radius in range(1, 12):
                    for i in range(max(0, ix - radius), min(nx, ix + radius + 1)):
                        for j in range(max(0, iy - radius), min(ny, iy + radius + 1)):
                            if valid[i, j] and boardable.covers(LineString([point, (gx[i], gy[j])])):
                                candidates.append((math.hypot(gx[i] - point[0], gy[j] - point[1]), (i, j)))
                    if candidates:
                        return min(candidates)[1]
                raise ValueError('No visible water grid node near endpoint')

            try:
                start, goal = nearest(ORIGIN), nearest(DESTINATION)
            except ValueError:
                continue
            heuristic = lambda node: math.hypot(node[0] - goal[0], node[1] - goal[1])
            queue = [(heuristic(start), 0, start)]
            previous = {start: None}
            best = {start: 0}
            while queue:
                _, cost, at = heapq.heappop(queue)
                if cost > best[at]:
                    continue
                if at == goal:
                    break
                i, j = at
                for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ni, nj = i + di, j + dj
                    if not (0 <= ni < nx and 0 <= nj < ny and valid[ni, nj]):
                        continue
                    nxt, new_cost = (ni, nj), cost + 1
                    if new_cost < best.get(nxt, math.inf):
                        best[nxt], previous[nxt] = new_cost, at
                        heapq.heappush(queue, (new_cost + heuristic(nxt), new_cost, nxt))
            if goal not in previous:
                continue
            grid_path = []
            at = goal
            while at is not None:
                grid_path.append((float(gx[at[0]]), float(gy[at[1]])))
                at = previous[at]
            path = [ORIGIN, *reversed(grid_path), DESTINATION]
            reduced = [path[0]]
            i = 0
            while i < len(path) - 1:
                for j in range(len(path) - 1, i, -1):
                    if boardable.covers(LineString([path[i], path[j]])):
                        break
                reduced.append(path[j])
                i = j
            if not all(boardable.covers(LineString([a, b])) for a, b in zip(reduced, reduced[1:])):
                raise ValueError('Derived boat route leaves mapped water')
            return [[round(x, 7), round(y, 7)] for x, y in reduced]
    raise ValueError('No boat route within the bounded water-grid search')


def polygonal(geometry):
    pieces = [part for part in (geometry.geoms if hasattr(geometry, 'geoms') else [geometry])
              if part.geom_type == 'Polygon' and not part.is_empty and part.area > 0]
    return pieces[0] if len(pieces) == 1 else unary_union(pieces)


def feature(kind, identity, geometry):
    geojson = mapping(polygonal(geometry))
    return {'type': 'Feature', 'properties': {'kind': kind, 'id': identity},
            'geometry': {'type': geojson['type'], 'coordinates': rounded(geojson['coordinates'])}}


def derive(pbf, adm1, adm2):
    if pbf.stat().st_size != 709273731 or sha256_file(pbf) != PBF_SHA256:
        raise ValueError('Geofabrik Nigeria PBF does not match the pinned file')
    state = set_precision(shape(next(item['geometry'] for item in adm1 if item['properties']['shapeName'] == 'Rivers')), 1e-7)
    units = {identity: set_precision(shape(next(item['geometry'] for item in adm2 if item['properties']['shapeName'] == name)), 1e-7)
             for name, identity in UNITS}
    open_area = unary_union(list(units.values()))
    areas = RiversAreas()
    areas.apply_file(str(pbf), locations=True)
    water_records = [item for item in areas.records if item['tags'].get('natural') == 'water'
                     or item['tags'].get('waterway') in ('riverbank', 'dock')]
    mangrove_records = [item for item in areas.records if item['tags'].get('wetland') == 'mangrove']
    route = water_route(areas.records, open_area)
    water = set_precision(unary_union([shape(item['geometry']) for item in water_records])
                          .intersection(state).simplify(0.00005, preserve_topology=True), 1e-7)
    mangrove = set_precision(unary_union([shape(item['geometry']) for item in mangrove_records])
                             .intersection(open_area).simplify(0.00005, preserve_topology=True), 1e-7)
    city_water = water.intersection(open_area)
    if not all(city_water.buffer(1e-7).covers(LineString([a, b])) for a, b in zip(route, route[1:])):
        raise ValueError('Boat route leaves the final water mask')
    features = []
    for _, identity in UNITS:
        unit = units[identity]
        features.append(feature('land', identity, unit.difference(water)))
        features.append(feature('water', identity, unit.intersection(water)))
    features.append(feature('state-water', 'rivers', water))
    features.append(feature('mangrove', 'port-harcourt', mangrove))
    return {'type': 'FeatureCollection', 'metadata': {
        'source': 'Geofabrik Nigeria OSM extract, © OpenStreetMap contributors, ODbL 1.0',
        'pbfUrl': PBF_URL, 'pbfSha256': PBF_SHA256, 'pbfBytes': 709273731, 'pbfDate': '2026-10-03',
        'admRelease': 'geoBoundaries gbOpen 9469f09', 'coordinatePrecisionDegrees': 1e-7,
        'waterObjects': [[item['osmType'], item['osmId']] for item in water_records],
        'mangroveObjects': [[item['osmType'], item['osmId']] for item in mangrove_records],
        'routeSource': 'Water-connected path derived within the OSM water mask; no ferry schedule or surveyed channel claim',
        'route': route, 'routeBoardingToleranceDegrees': 1e-7,
        'waterSimplificationDegrees': 0.00005, 'mangroveSimplificationDegrees': 0.00005,
    }, 'features': features}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pbf', type=Path, required=True, help='Downloaded pinned Nigeria PBF')
    parser.add_argument('--check', action='store_true', help='Compare generated bytes with the committed source')
    args = parser.parse_args()
    adm1 = pinned_json(CACHE / 'geoBoundaries-NGA-ADM1-9469f09.geojson', ADM1_SHA256)
    adm2 = pinned_json(CACHE / 'geoBoundaries-NGA-ADM2-9469f09.geojson', ADM2_SHA256)
    data = (json.dumps(derive(args.pbf, adm1, adm2), separators=(',', ':')) + '\n').encode()
    digest = hashlib.sha256(data).hexdigest()
    if args.check:
        if SOURCE.read_bytes() != data:
            raise ValueError(f'Rivers water source differs: generated SHA-256 {digest}')
        print(f'Rivers water source matches: {len(data)} bytes, SHA-256 {digest}')
    else:
        SOURCE.write_bytes(data)
        print(f'Wrote {SOURCE}: {len(data)} bytes, SHA-256 {digest}')


if __name__ == '__main__':
    main()
