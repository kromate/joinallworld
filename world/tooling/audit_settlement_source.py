#!/usr/bin/env python3
"""Read-only bounded selected-place audit from local pins; no compiler imports."""
import hashlib
import json
import math
import resource
import time
from collections import Counter
from pathlib import Path

started = time.monotonic()
root = Path(__file__).resolve().parents[2]
if not __debug__:
    raise RuntimeError('This audit requires assertions; do not invoke Python with -O')

def check():
    if time.monotonic() - started >= 120:
        raise RuntimeError('independent audit deadline exceeded')
    if resource.getrusage(resource.RUSAGE_SELF).ru_maxrss > 512 * 1024 * 1024:
        raise RuntimeError('independent audit RSS exceeded on this macOS runtime')

def duplicates(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('duplicate JSON key')
        value[key] = item
    return value

def parse(raw):
    return json.loads(raw.decode('utf-8'), object_pairs_hook=duplicates,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite JSON')),
                      parse_float=lambda value: float(value) if math.isfinite(float(value)) else (_ for _ in ()).throw(ValueError('nonfinite JSON')))

def read_bound(filename, maximum):
    relative = Path(filename)
    if relative.is_absolute() or '..' in relative.parts:
        raise ValueError('audit input escapes repository root')
    target = root / relative
    cursor = root
    for part in relative.parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise ValueError('audit input has a symlink ancestor')
    if target.is_symlink() or not target.is_file() or target.stat().st_size > maximum:
        raise ValueError('unsafe or oversized source input')
    with target.open('rb') as stream:
        raw = stream.read(maximum + 1)
    if len(raw) > maximum:
        raise ValueError('read exceeds cap')
    check()
    return raw

pin = parse(read_bound('world/settlement-sources.json', 65536))
assert set(pin) == {'schemaVersion','source','input','gitBlobSha1'} and pin['schemaVersion'] == 1
source_pin = pin['source']
raw = read_bound(pin['input'], 32 * 1024 * 1024)
assert len(raw) == source_pin['bytes']
assert hashlib.sha256(raw).hexdigest() == source_pin['sha256']
spec = parse(read_bound('world/settlement-capture.json', 65536))
assert pin['gitBlobSha1'] == spec['expectedGitBlobSha1']
assert source_pin['bytes'] == spec['expectedBytes']
assert source_pin['release'] == spec['release']
assert source_pin['id'] == 'natural-earth-places-10m-' + spec['release']
assert source_pin['url'] == 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/' + spec['release'] + '/geojson/ne_10m_populated_places.geojson'
assert source_pin['license'] == spec['license'] and source_pin['attribution'] == spec['attribution']
assert hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest() == spec['expectedGitBlobSha1']
document = parse(raw)
assert document['type'] == 'FeatureCollection'
assert 'crs' not in document or document['crs'] == {'type':'name','properties':{'name':'urn:ogc:def:crs:OGC:1.3:CRS84'}}
features = document['features']
assert isinstance(features, list) and 0 < len(features) <= 100000
check()

parent_pin = parse(read_bound('world/settlement-parent.json', 65536))
parent_raw = read_bound(parent_pin['input'], 16 * 1024 * 1024)
assert len(parent_raw) == parent_pin['source']['bytes']
assert hashlib.sha256(parent_raw).hexdigest() == parent_pin['source']['sha256']
parent = parse(parent_raw)
parent_manifest_bytes = read_bound(parent_pin['directoryRoot'] + '/manifests/' + parent_pin['manifestHash'] + '.json', 1024 * 1024)
assert hashlib.sha256(parent_manifest_bytes).hexdigest() == parent_pin['manifestHash']
parent_manifest = parse(parent_manifest_bytes)
assert parent_manifest['source'] == parent_pin['source']
identity_bytes = read_bound(parent_pin['directoryRoot'] + '/' + parent_manifest['identityPath'], 512 * 1024)
assert hashlib.sha256(identity_bytes).hexdigest() == Path(parent_manifest['identityPath']).stem
identity = parse(identity_bytes)
country_by_key = {}
for item in identity['retained'] + identity['added']:
    assert item['featureKey'] not in country_by_key
    country_by_key[item['featureKey']] = item['countryId']
codes = {}
for feature in parent['features']:
    properties = feature['properties']
    key = 'NE_ID:' + str(properties['NE_ID'])
    code = properties['ADM0_A3']
    assert key in country_by_key and code not in codes
    codes[code] = country_by_key[key]
assert len(codes) == 258 and codes['NGA'] == 'legacy-ng'

field_stats = {}
geometry_types = Counter()
point_issues = []
coordinate_lengths = Counter()
key_fields = {key: {'present':0, 'valid':0, 'invalid':0, 'duplicates':0, 'seen':set()} for key in ('NE_ID','ne_id')}
country_fields = {key:Counter() for key in ('ADM0_A3','adm0_a3','ISO_A2','iso_a2')}
point_count = 0
for ordinal, feature in enumerate(features):
    check()
    assert isinstance(feature, dict) and feature.get('type') == 'Feature'
    properties = feature.get('properties')
    assert isinstance(properties, dict) and len(properties) <= 256
    assert len(json.dumps(properties, ensure_ascii=False).encode()) <= 32768
    for key, value in properties.items():
        if key not in field_stats:
            assert len(field_stats) < 256
            field_stats[key] = {'present':0,'null':0,'types':Counter(),'minimum':None,'maximum':None,'maxTextBytes':0}
        info = field_stats[key]; info['present'] += 1; info['null'] += value is None
        info['types'][type(value).__name__] += 1
        if type(value) in (float,int):
            assert math.isfinite(value)
            info['minimum'] = value if info['minimum'] is None else min(info['minimum'], value)
            info['maximum'] = value if info['maximum'] is None else max(info['maximum'], value)
        elif isinstance(value, str):
            info['maxTextBytes'] = max(info['maxTextBytes'], len(value.encode()))
    for field, info in key_fields.items():
        if field not in properties:
            continue
        info['present'] += 1; value = properties[field]
        numeric = type(value) in (int,float) and math.isfinite(value) and float(value).is_integer() and 0 < value <= 9007199254740991
        valid = numeric or isinstance(value,str) and value.isascii() and value.isdigit() and not value.startswith('0') and 0 < int(value) <= 9007199254740991
        info['valid' if valid else 'invalid'] += 1
        if valid:
            canonical = str(int(value)) if numeric else value
            if canonical in info['seen']:
                info['duplicates'] += 1
            info['seen'].add(canonical)
    for field, counts in country_fields.items():
        if field in properties:
            counts[json.dumps(properties[field], ensure_ascii=True)] += 1
    geometry = feature.get('geometry')
    kind = geometry.get('type') if isinstance(geometry,dict) else None
    geometry_types[str(kind)] += 1
    coordinates = geometry.get('coordinates') if isinstance(geometry,dict) else None
    valid = kind == 'Point' and isinstance(coordinates,list) and 2 <= len(coordinates) <= 4 and all(type(item) in (int,float) and math.isfinite(item) for item in coordinates) and -180 <= coordinates[0] <= 180 and -90 <= coordinates[1] <= 90
    if valid:
        point_count += 1; coordinate_lengths[len(coordinates)] += 1
    else:
        if len(point_issues) >= 100:
            raise ValueError('more than100 point issues require separately bounded report')
        point_issues.append({'ordinal':ordinal,'kind':kind})

for info in field_stats.values():
    info['types'] = dict(sorted(info['types'].items())); info['missing'] = len(features) - info['present']
for info in key_fields.values():
    info['unique'] = len(info.pop('seen')); info['missing'] = len(features) - info['present']
candidate_joins = {}
for field in ('ADM0_A3','adm0_a3'):
    rows = []
    totals = Counter()
    for serialized, count in sorted(country_fields[field].items()):
        value = json.loads(serialized)
        country = codes.get(value) if isinstance(value,str) else None
        status = 'protected' if country == 'legacy-ng' else 'linked' if country is not None else 'unlinked'
        totals[status] += count
        rows.append({'code':value,'countryId':country,'status':status,'rows':count})
    totals['missing-field'] = len(features) - sum(country_fields[field].values())
    candidate_joins[field] = {'counts':dict(totals),'codes':rows}
examples = []
for ordinal, feature in enumerate(features):
    properties = feature['properties']
    if any(properties.get(field) in ('Accra','London','Nairobi','Cape Town','Lagos','Tokyo') for field in ('NAME','name','NAMEASCII','nameascii')):
        examples.append({'ordinal':ordinal,'coordinates':feature['geometry']['coordinates'], 'properties':{field:properties[field] for field in ('NE_ID','ne_id','NAME','name','NAMEASCII','nameascii','ADM0_A3','adm0_a3','ADM1NAME','adm1name','SCALERANK','scalerank','POP_MAX','pop_max','FEATURECLA','featurecla') if field in properties}})
assert len(examples) <= 50
check()
report = {'schemaVersion':1,'source':source_pin,'sourceGitBlobSha1':spec['expectedGitBlobSha1'], 'parentManifestHash':parent_pin['manifestHash'],'features':len(features),'topLevelFields':sorted(document),'fields':dict(sorted(field_stats.items())),'candidateKeys':key_fields,'candidateCountryCodes':{key:dict(sorted(counts.items())) for key,counts in country_fields.items()},'candidateJoins':candidate_joins,'geometryTypes':dict(geometry_types),'validPoints':point_count,'coordinateLengths':dict(coordinate_lengths),'pointIssues':point_issues,'examples':examples,'parentsWithoutSelectedPlaces':[{'code':code,'countryId':country} for code,country in sorted(codes.items()) if code not in {row['code'] for row in candidate_joins['ADM0_A3']['codes'] if row['countryId'] is not None}],'elapsedMs':round((time.monotonic()-started)*1000),'peakRssBytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'scope':'Independent discovery audit; no compiler imports, no city bounds, admin1 relation or playable coverage implied.'}
output = json.dumps(report, sort_keys=True, separators=(',',':'),ensure_ascii=False,allow_nan=False).encode() + b'\n'
assert len(output) <= 512*1024
import sys
sys.stdout.buffer.write(output)
