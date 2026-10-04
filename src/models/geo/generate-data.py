"""Offline public-domain map compiler. Run after fetching the pinned NE sources.

Pinned inputs are fetched into ../.cache/geo; generated chunks never use the network.
Shared border chains are simplified once, in canonical orientation, for both sides.
"""
import json
import math
import hashlib
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CACHE = ROOT.parent / '.cache' / 'geo'
REVISION = 'ca96624a56bd078437bca8184e78163e5039ad19'


def load(name):
    source=json.loads((ROOT/'provenance.json').read_text())['sources'][name]
    path=CACHE/(name+'.json')
    if not path.exists():
        CACHE.mkdir(parents=True,exist_ok=True)
        with urllib.request.urlopen(source['url'],timeout=60) as response:raw=response.read()
        if hashlib.sha256(raw).hexdigest()!=source['sha256']:raise ValueError(f'Source hash changed: {name}')
        path.write_bytes(raw)
    raw=path.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=source['sha256']:raise ValueError(f'Cached source hash changed: {name}')
    return json.loads(raw)['features']


def area(ring):
    return abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:]))) / 2


def dp(points, tolerance):
    if len(points) <= 2:
        return points
    a, b = points[0], points[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = dx * dx + dy * dy
    best, index = 0, 0
    for i, p in enumerate(points[1:-1], 1):
        t = max(0, min(1, ((p[0]-a[0])*dx + (p[1]-a[1])*dy) / length)) if length else 0
        distance = (p[0]-a[0]-t*dx)**2 + (p[1]-a[1]-t*dy)**2
        if distance > best:
            best, index = distance, i
    if best <= tolerance * tolerance:
        return [a, b]
    return dp(points[:index+1], tolerance)[:-1] + dp(points[index:], tolerance)


def edge(a, b):
    return tuple(sorted((a, b)))


def node_edges(features):
    """Split collinear border segments at all existing vertices, including T junctions."""
    cells = {}
    for f in features:
        for polygon in f['polygons']:
            for ring in polygon:
                for p in ring:
                    cells.setdefault((math.floor(p[0]), math.floor(p[1])), set()).add(p)
    cache = {}
    def chain(a,b):
        key = edge(a,b)
        if key not in cache:
            start,end=key;dx=end[0]-start[0];dy=end[1]-start[1];length=dx*dx+dy*dy
            points={start:0,end:1}
            if length:
                for x in range(math.floor(min(start[0],end[0])),math.floor(max(start[0],end[0]))+1):
                    for y in range(math.floor(min(start[1],end[1])),math.floor(max(start[1],end[1]))+1):
                        for p in cells.get((x,y),()):
                            t=((p[0]-start[0])*dx+(p[1]-start[1])*dy)/length
                            if 0<t<1 and abs((p[0]-start[0])*dy-(p[1]-start[1])*dx)<1e-9:
                                points[p]=t
            cache[key]=sorted(points,key=points.get)
        result=cache[key]
        return result if a==key[0] else list(reversed(result))
    result=[]
    for feature in features:
        polygons=[]
        for polygon in feature['polygons']:
            rings=[]
            for ring in polygon:
                out=[]
                for a,b in zip(ring,ring[1:]):out.extend(chain(a,b)[:-1])
                out.append(out[0]);rings.append(out)
            polygons.append(rings)
        result.append({**feature,'polygons':polygons})
    return result


def simplify(features, tolerance):
    owners = {}
    for i, f in enumerate(features):
        for polygon in f['polygons']:
            for ring in polygon:
                for a, b in zip(ring, ring[1:]):
                    owners.setdefault(edge(a, b), set()).add(i)
    memo = {}
    output = []
    for f in features:
        polygons = []
        for polygon in f['polygons']:
            rings = []
            for ring in polygon:
                pts = ring[:-1]
                signatures = [tuple(sorted(owners[edge(pts[i], pts[(i+1) % len(pts)])])) for i in range(len(pts))]
                breaks = [i for i in range(len(pts)) if signatures[i-1] != signatures[i]]
                if len(breaks) < 2:
                    start = min(range(len(pts)), key=lambda i: pts[i])
                    far = max(range(len(pts)), key=lambda i: (pts[i][0]-pts[start][0])**2+(pts[i][1]-pts[start][1])**2)
                    breaks = sorted(set([*breaks, start, far]))
                reduced = []
                for j, begin in enumerate(breaks):
                    end = breaks[(j+1) % len(breaks)]
                    chain = pts[begin:end+1] if end > begin else pts[begin:] + pts[:end+1]
                    reverse = chain[0] > chain[-1]
                    canonical = tuple(reversed(chain)) if reverse else tuple(chain)
                    if canonical not in memo:
                        memo[canonical] = dp(list(canonical), tolerance)
                    result = list(reversed(memo[canonical])) if reverse else memo[canonical]
                    reduced.extend(result[:-1])
                if len(set(reduced)) < 3:
                    # Keep tiny islands as a minimal triangle instead of deleting a country.
                    reduced = [pts[0], pts[len(pts)//3], pts[2*len(pts)//3]]
                reduced = [[round(x, 4), round(y, 4)] for x, y in reduced]
                reduced.append(reduced[0])
                rings.append(reduced)
            polygons.append(rings)
        output.append({**f, 'polygons': polygons})
    return output


REGIONS = {
    'North': 'DZ EG LY MA SD TN EH',
    'West': 'BJ BF CV CI GM GH GN GW LR ML MR NE NG SN SL TG',
    'Central': 'AO CM CF TD CG CD GQ GA ST',
    'East': 'BI KM DJ ER ET KE MG MW MU MZ RW SC SO SS TZ UG ZM ZW',
    'Southern': 'BW SZ LS NA ZA',
}


def feature(raw, admin=False):
    p = raw['properties']
    code = p.get('iso_3166_2') if admin else p.get('ISO_A2_EH')
    if not admin and p.get('ISO_A2') == '-99' and p.get('TYPE') == 'Dependency':
        code = 'territory:' + p['ADM0_A3']
    if not code or code == '-99':
        code = 'disputed:' + p.get('ADM0_A3', p.get('adm1_code', 'unknown'))
    name = p.get('name') if admin else p['NAME_EN']
    if name == 'Nassarawa':
        name = 'Nasarawa'
    polys = raw['geometry']['coordinates']
    if raw['geometry']['type'] == 'Polygon':
        polys = [polys]
    # Keep the largest island and substantial secondary islands for small-scale display.
    largest = max(polys, key=lambda x: area(x[0]))
    polys = [poly for poly in polys if poly is largest or area(poly[0]) >= (0.02 if admin else 0.15)]
    rings = []
    for poly in polys:
        converted = []
        for ring in poly:
            points = []
            for x, y, *_ in ring:
                point = (round(x, 5), round(y, 5))
                if not points or points[-1] != point:
                    points.append(point)
            if points and points[0] != points[-1]:
                points.append(points[0])
            if len(set(points)) >= 3:
                converted.append(points)
        if converted:
            rings.append(converted)
    result = {'id': code, 'name': name, 'group': 'Africa' if code in ['MU','SC'] else p.get('CONTINENT', 'Nigeria'), 'polygons': rings}
    if code == 'EH' or code.startswith('disputed:') or p.get('BRK_DIFF') == 1:
        result['disputed'] = True
    return result


def write(name, features, limit, extras=None):
    features = node_edges(features)
    for tolerance in [0.005, 0.01, 0.02, 0.04, 0.06, 0.09, 0.12, 0.18, 0.25, 0.35, 0.5]:
        data = {'id': name, 'name': name.title(), 'source': 'Natural Earth', 'revision': REVISION,
                'license': 'Public domain', 'toleranceDegrees': tolerance,
                'features': simplify(features, tolerance), **(extras or {})}
        content = 'export default ' + json.dumps(data, separators=(',', ':'), ensure_ascii=False) + ';\n'
        size = len(content.encode())
        if size <= limit:
            (ROOT / 'data' / (name + '.js')).write_text(content)
            print(json.dumps({'chunk': name, 'features': len(features), 'bytes': size, 'limit': limit, 'tolerance': tolerance}), flush=True)
            return
    raise RuntimeError(f'{name} exceeds {limit} bytes: {size}')


if __name__ == '__main__':
    countries = load('ne_50m_admin_0_countries')
    all_features = [feature(f) for f in countries]
    africa = [feature(f) for f in countries if f['properties']['CONTINENT'] == 'Africa' or f['properties']['ISO_A2_EH'] in ['MU','SC']]
    for f in africa:
        f['group'] = next((region for region, codes in REGIONS.items() if f['id'] in codes.split()), 'Other territory')
    write('world', all_features, 120000)
    write('africa', africa, 80000)
    nigeria = [feature(f, True) for f in load('ne_10m_admin_1_states_provinces') if f['properties']['adm0_a3'] == 'NGA']
    places = [f['properties'] for f in load('ne_10m_populated_places')]
    state_ids = {f['name']: f['id'] for f in nigeria}
    cities = []
    for p in places:
        if p['ADM0_A3'] != 'NGA': continue
        if p['NAME'] in ['Onitsha', 'Gashua']: continue
        capital = p['FEATURECLA'] in ['Admin-1 capital', 'Admin-0 capital']
        if not capital and p['NAME'] not in ['Lagos','Warri','Zaria']: continue
        name = 'Osogbo' if p['NAME'] == 'Oshogbo' else p['NAME']
        city = {'id': name.lower().replace(' ','-'), 'name': name, 'lon': round(p['LONGITUDE'],4), 'lat': round(p['LATITUDE'],4)}
        if capital: city['capitalOf'] = state_ids[p['ADM1NAME'].replace('Nassarawa','Nasarawa')]
        cities.append(city)
    for p in json.loads((ROOT/'sources/capital-supplement.json').read_text()):
        state = {'Q1024647':'NG-LA','Q1061665':'NG-DE','Q304976':'NG-EB','Q648749':'NG-BY'}[p['id']]
        name = 'Yenagoa' if p['id']=='Q648749' else p['name']
        cities.append({'id':name.lower(),'name':name,'lon':p['lon'],'lat':p['lat'],'capitalOf':state,'wikidata':p['id']})
    by_name = {c['name']: [c['lon'],c['lat']] for c in cities}
    roads = [{'name':name,'schematic':True,'points':[by_name[c] for c in stops]} for name,stops in [
        ('Lagos–Ibadan',['Lagos','Ibadan']),('Lagos–Abuja corridor',['Lagos','Ibadan','Ilorin','Lokoja','Abuja']),
        ('Abuja–Kaduna–Kano',['Abuja','Kaduna','Zaria','Kano']),('East–West corridor',['Warri','Yenagoa','Port Harcourt','Uyo','Calabar']),
        ('Benin–Onitsha corridor',['Benin City','Asaba','Awka','Enugu']),('Abuja–Jos–Bauchi',['Abuja','Jos','Bauchi']),
    ]]
    rivers=[]
    for f in load('ne_10m_rivers_lake_centerlines'):
        if f['properties'].get('name') not in ['Niger','Benue']:continue
        paths=f['geometry']['coordinates']
        if f['geometry']['type']=='LineString':paths=[paths]
        # Clip the displayed source centerline to Nigeria's general country extent.
        clipped=[]
        for path in paths:
            run=[]
            for p in path:
                if 2.5<=p[0]<=14.7 and 4.2<=p[1]<=13.9:run.append(p[:2])
                elif len(run)>1:clipped.append(dp(run,.035));run=[]
                else:run=[]
            if len(run)>1:clipped.append(dp(run,.035))
        if clipped:rivers.append({'name':f['properties']['name'],'paths':[[[round(x,4),round(y,4)] for x,y in path] for path in clipped]})
    airports=json.loads((ROOT/'sources/airports.json').read_text())['airports']
    def coasts(west,south,east,north):
        output=[]
        for feature in load('ne_50m_coastline'):
            paths=feature['geometry']['coordinates']
            if feature['geometry']['type']=='LineString':paths=[paths]
            for path in paths:
                run=[]
                for p in path:
                    if west<=p[0]<=east and south<=p[1]<=north:run.append(p[:2])
                    else:
                        if len(run)>1:output.append(dp(run,.035))
                        run=[]
                if len(run)>1:output.append(dp(run,.035))
        return [[[round(x,4),round(y,4)] for x,y in path] for path in output]
    write('nigeria', nigeria, 60000, {'cities':cities,'roads':roads,'rivers':rivers,'coastlines':coasts(2.6,4.1,8.6,6.55),'airports':[a for a in airports if a['country']=='NG']})
    if 'kenya-counties' in json.loads((ROOT/'provenance.json').read_text())['sources']:
        county_features=[]
        for i,f in enumerate(load('kenya-counties')):
            p=f['properties'];name=p['shapeName'];polys=f['geometry']['coordinates']
            if f['geometry']['type']=='Polygon':polys=[polys]
            county_features.append({'id':p.get('shapeISO') or 'KE:'+name.lower().replace(' ','-'),'name':name,'group':'Kenya','polygons':[[[tuple(round(v,5) for v in point[:2]) for point in ring] for ring in poly] for poly in polys]})
        kenya_cities=[{'id':p['NAME'].lower(),'name':p['NAME'],'lon':round(p['LONGITUDE'],4),'lat':round(p['LATITUDE'],4)} for p in places if p['ADM0_A3']=='KEN' and p['NAME'] in ['Nairobi','Mombasa','Nakuru','Kisumu','Eldoret','Voi']]
        k={c['name']:[c['lon'],c['lat']] for c in kenya_cities}
        write('kenya',county_features,40000,{'source':'geoBoundaries / RCMRD GeoPortal, Africa GeoPortal','revision':'9469f09','license':'CC BY 4.0 collection; source metadata states Public Domain','boundaryID':'KEN-ADM1-32016919','year':2020,'cities':kenya_cities,'coastlines':coasts(39.1,-4.75,41.6,-1.5),'airports':[a for a in airports if a['country']=='KE'],'roads':[{'name':'Nairobi–Mombasa corridor','schematic':True,'points':[k['Nairobi'],k['Voi'],k['Mombasa']]},{'name':'Nairobi–Nakuru–Kisumu corridor','schematic':True,'points':[k['Nairobi'],k['Nakuru'],k['Kisumu']]}]})
