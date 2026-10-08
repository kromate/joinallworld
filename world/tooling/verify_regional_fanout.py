#!/usr/bin/env python3
"""Independent, read-only verifier for one regional whole-feature fan-out index.

This module imports no World compiler, publisher, pack or validation code. It rebuilds
feature identity, ownership, bounds, child membership and canonical hashes from the
pinned parent GeoJSON. It certifies only this local derivation, not source legality,
worldwide coverage, exact geometry intersection, or playability.
"""
from __future__ import annotations
import argparse, hashlib, json, math, os, re, resource, stat, sys, time
from pathlib import Path, PurePosixPath
from typing import Any

SHA = re.compile(r"^[a-f0-9]{64}$")
MAX_REQUEST=256_000; MAX_INPUT=20_000_000; MAX_FEATURES=5_000; MAX_COORDS=200_000; MAX_CHILDREN=64; MAX_OUTPUT=30_000_000; MAX_INDEX=30_000_000; MAX_READ=128*1024*1024; MAX_JSON_TOKENS=3_000_000; MAX_JSON_NODES=3_000_000; MAX_RSS=512*1024*1024
START=time.monotonic(); READ_BYTES=0
class VerifyError(Exception): pass
def fail(msg:str)->None: raise VerifyError(msg)
def digest(b:bytes|str)->str: return hashlib.sha256(b.encode() if isinstance(b,str) else b).hexdigest()
def live()->None:
    if time.monotonic()-START>120: fail('verification exceeded 120 seconds')
    peak=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*(1 if sys.platform=='darwin' else 1024)
    if peak>MAX_RSS:fail('verification exceeded 512 MiB RSS')
def preflight_json(data:bytes,label:str)->None:
    quoted=False;escaped=False;tokens=0
    for byte in data:
        if quoted:
            if escaped:escaped=False
            elif byte==92:escaped=True
            elif byte==34:quoted=False
        elif byte==34:quoted=True
        elif byte in (91,93,123,125,44,58):
            tokens+=1
            if tokens>MAX_JSON_TOKENS:fail(f'{label} exceeds JSON token cap')
def pairs(items:list[tuple[str,Any]])->dict[str,Any]:
    d={}
    for k,v in items:
        if k in d: fail(f'duplicate JSON key {k!r}')
        d[k]=v
    return d
def no_constant(v:str)->None: fail(f'non-finite JSON constant {v}')
def js_parse_int(text:str)->int|float:
    value=int(text)
    if abs(value)<=9_007_199_254_740_991:return value
    number=float(text)
    if not math.isfinite(number):fail('JSON integer exceeds JavaScript finite Number range')
    return number
def parse(data:bytes,label:str)->Any:
    live();preflight_json(data,label)
    try: value=json.loads(data.decode('utf-8','strict'),object_pairs_hook=pairs,parse_constant=no_constant,parse_int=js_parse_int)
    except VerifyError: raise
    except (ValueError,UnicodeError,RecursionError) as e: fail(f'{label} is not bounded UTF-8 JSON: {e}')
    stack=[(value,0)];nodes=0
    while stack:
        x,depth=stack.pop();nodes+=1
        if nodes>MAX_JSON_NODES:fail(f'{label} exceeds JSON node cap')
        if nodes%4096==0:live()
        if depth>64: fail(f'{label} exceeds nesting cap')
        if isinstance(x,float) and not math.isfinite(x): fail(f'{label} has non-finite number')
        if isinstance(x,dict): stack.extend((v,depth+1) for v in x.values())
        elif isinstance(x,list): stack.extend((v,depth+1) for v in x)
    return value

def _reject_symlinks(p:Path)->None:
    cur=Path(p.anchor)
    for part in p.parts[1:]:
        cur/=part
        st=os.lstat(cur)
        if stat.S_ISLNK(st.st_mode): fail('symlink path refused')
def root_path(s:str)->Path:
    p=Path(s)
    if not p.is_absolute() or str(p)!=s: fail('root must be canonical absolute path')
    _reject_symlinks(p)
    if not stat.S_ISDIR(os.lstat(p).st_mode) or p.resolve(strict=True)!=p: fail('root is not a canonical directory')
    return p
def relative(s:Any)->str:
    if not isinstance(s,str) or not s or '\\' in s or '\x00' in s or s.startswith('/') or any(x in ('','.','..') for x in s.split('/')): fail('unsafe relative path')
    return s
def read(root:Path,s:Any,cap:int,base:Path|None=None)->bytes:
    global READ_BYTES
    if isinstance(s,str) and os.path.isabs(s):
        p=Path(s)
        if str(p)!=s or not p.is_relative_to(root):fail(f'absolute pinned path escapes allowed root: {p}')
    else:
        rel=relative(s)
        if base is None and root.name=='world-build' and rel.startswith('.cache/world-build/'):
            rel=rel[len('.cache/world-build/'): ]
        p=(base or root).joinpath(*rel.split('/'))
        if not p.is_relative_to(root):fail('resolved pinned path escapes allowed root')
    _reject_symlinks(p)
    st=os.lstat(p)
    if not stat.S_ISREG(st.st_mode) or st.st_size>cap: fail(f'unsafe or oversized file: {rel}')
    fd=os.open(p,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
    try:
        before=os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size>cap: fail('file changed to unsafe/oversized')
        blocks=[]; n=0
        while True:
            live(); block=os.read(fd,min(65536,cap+1-n))
            if not block: break
            blocks.append(block); n+=len(block)
            if n>cap: fail('file exceeds byte cap')
        after=os.fstat(fd)
        if n!=before.st_size or after.st_size!=before.st_size or after.st_mtime_ns!=before.st_mtime_ns: fail('file changed during read')
        data=b''.join(blocks); READ_BYTES+=len(data)
        if READ_BYTES>MAX_READ:fail('aggregate bytes read exceeded 128 MiB')
        return data
    finally: os.close(fd)

# Python repr(float) provides shortest-roundtrip digits; this normalizes its spelling
# to ECMAScript JSON.stringify's fixed/scientific thresholds and exponent syntax.
def js_number(v:int|float)->str:
    if isinstance(v,bool): fail('boolean used as number')
    if isinstance(v,int):
        if abs(v)>9_007_199_254_740_991: fail('integer parser failed to normalize JavaScript Number')
        return str(v)
    if not math.isfinite(v): fail('non-finite canonical number')
    if v==0: return '0'
    neg=v<0; a=abs(v); spelling=repr(a).lower()
    if 'e' in spelling: mant,exponent=spelling.split('e'); exp=int(exponent)
    else: mant=spelling; exp=0
    if '.' in mant: before,after=mant.split('.'); digits=before+after; point=len(before)+exp
    else: digits=mant; point=len(mant)+exp
    leading=len(digits)-len(digits.lstrip('0'))
    digits=digits.lstrip('0') or '0'; point-=leading
    digits=digits.rstrip('0') or '0'
    if -6 < point <= 21:
        if point<=0: out='0.'+('0'*(-point))+digits
        elif point>=len(digits): out=digits+('0'*(point-len(digits)))
        else: out=digits[:point]+'.'+digits[point:]
    else:
        out=digits[0]+(('.'+digits[1:]) if len(digits)>1 else '')+'e'+('+' if point-1>=0 else '')+str(point-1)
    return ('-' if neg else '')+out

def canonical(v:Any,depth:int=0)->str:
    if depth>64: fail('canonical JSON nesting exceeded')
    if v is None:return 'null'
    if v is True:return 'true'
    if v is False:return 'false'
    if isinstance(v,(int,float)):return js_number(v)
    if isinstance(v,str):
        if any(0xD800<=ord(c)<=0xDFFF for c in v): fail('unpaired surrogate not supported')
        return json.dumps(v,ensure_ascii=False,separators=(',',':'))
    if isinstance(v,list):return '['+','.join(canonical(x,depth+1) for x in v)+']'
    if isinstance(v,dict):
        keys=list(v); indices=[k for k in keys if isinstance(k,str) and k.isascii() and k.isdigit() and (k=='0' or not k.startswith('0')) and int(k)<4_294_967_295]; indices.sort(key=int); rest=js_sort([k for k in keys if k not in indices]); ordered=indices+rest
        return '{'+','.join(canonical(k)+':'+canonical(v[k],depth+1) for k in ordered)+'}'
    fail('non-JSON value')
def same(a:Any,b:Any)->bool:return canonical(a)==canonical(b)
def js_sort(values:list[str])->list[str]: return sorted(values,key=lambda s:s.encode('utf-16-be','surrogatepass'))
def obj(v:Any,label:str)->dict:
    if not isinstance(v,dict):fail(f'{label} must be object')
    return v
def arr(v:Any,label:str)->list:
    if not isinstance(v,list):fail(f'{label} must be array')
    return v
def sha_pin(row:Any,label:str)->None:
    r=obj(row,label)
    if not isinstance(r.get('sha256'),str) or not SHA.fullmatch(r['sha256']):fail(f'{label} sha invalid')
    if isinstance(r.get('bytes'),bool) or not isinstance(r.get('bytes'),int) or r['bytes']<1:fail(f'{label} bytes invalid')
def bounds_ok(b:Any,label:str)->list:
    if not isinstance(b,list) or len(b)!=4 or any(isinstance(x,bool) or not isinstance(x,(int,float)) or not math.isfinite(x) for x in b): fail(f'{label} bounds invalid')
    w,s,e,n=b
    if not (-180<=w<=180 and -180<=e<=180 and w!=e and -90<=s<n<=90):fail(f'{label} bounds out of range')
    return b
def lon_frame(lon:float, midpoint:float)->float:
    # Match the compiler's nearest-frame Math.round rule, including +/-180 ties.
    return lon + 360 * math.floor((midpoint-lon)/360 + 0.5)
def region_extent(bounds:list, around:float)->tuple[float,float,float,float]:
    west,east=bounds[0],bounds[2]
    if east<west:east+=360
    shift=360*math.floor((around-(west+east)/2)/360+0.5)
    return west+shift,bounds[1],east+shift,bounds[3]
def wrapped(lon:float)->float:
    if -180<=lon<=180:return lon
    return ((lon+180)%360+360)%360-180
def positions(geom:Any)->list[list[float]]:
    if geom is None:return []
    g=obj(geom,'geometry'); typ=g.get('type'); out=[]
    if typ=='GeometryCollection':
        geoms=arr(g.get('geometries'),'GeometryCollection geometries')
        for child in geoms:out.extend(positions(child))
        return out
    if 'coordinates' not in g:return out
    coords=g['coordinates'];stack=[coords]
    while stack:
        x=stack.pop()
        if not isinstance(x,list):fail('geometry coordinate nesting invalid')
        if len(x)>=2 and all(isinstance(q,(int,float)) and not isinstance(q,bool) and math.isfinite(q) for q in x[:2]):
            if any(isinstance(q,bool) or not isinstance(q,(int,float)) or not math.isfinite(q) for q in x):fail('position ordinates must all be finite numbers')
            lon,lat=x[:2]
            if not -180<=lon<=180 or not -90<=lat<=90:fail('source position outside WGS84')
            out.append([lon,lat])
        else: stack.extend(reversed(x))
        if len(out)>MAX_COORDS:fail('coordinate cap exceeded')
    # Like the source contract, an unknown geometry type with a coordinates member
    # still contributes its actual coordinate vertices to the conservative bbox.
    return out
def classify(f:dict)->str:
    props=f.get('properties')
    if props is None: props={}
    if not isinstance(props,dict):fail('feature properties invalid')
    geom=f.get('geometry'); typ=geom.get('type') if isinstance(geom,dict) else None
    b=props.get('building')
    building=b is not None and b is not False and b!='no'
    hw=props.get('highway')
    if building and typ in ('Polygon','MultiPolygon'):return 'building'
    if hw is not None and typ in ('LineString','MultiLineString'):return 'road'
    return 'unsupported'
def feature_key(source_id:str,f:dict,ordinal:int)->str:
    fid=f.get('id')
    if isinstance(fid,bool) or not isinstance(fid,(str,int,float)):fail(f'feature {ordinal} lacks stable id')
    return f'{source_id}:{js_number(fid) if isinstance(fid,(int,float)) and not isinstance(fid,bool) else fid}'
def part_ids(key:str,kind:str,f:dict)->list[str]:
    if kind=='unsupported':return []
    typ=f['geometry']['type']; count=len(f['geometry']['coordinates']) if typ in ('MultiPolygon','MultiLineString') else 1
    if count<=0: fail('supported multipart geometry is empty')
    return [f'{key}/{kind}/{i}' for i in range(count)]
def owner_cell(point:list[float],children:list[dict])->str|None:
    x,y=point; x=-180 if x==180 else x; ids=[]
    for r in children:
        w,s,e,n=r['bounds']
        inside=(w<=x<=e) if w<=e else (x>=w or x<=e)
        if inside and s<=y<=n:ids.append(r['id'])
    return js_sort(ids)[0] if ids else None
def main_verify(root:Path,index_rel:str,expected:str)->dict:
    if not SHA.fullmatch(expected):fail('index hash must be lowercase SHA-256')
    raw_idx=read(root,index_rel,MAX_INDEX)
    index_abs=root.joinpath(*relative(index_rel).split('/'))
    if index_abs.parent.name!='indices' or index_abs.name!=f'{expected}.json':fail('index must use its exact content hash in an indices directory')
    output_root=index_abs.parent.parent
    if digest(raw_idx)!=expected:fail('index hash differs from requested pin')
    index=parse(raw_idx,'index')
    if raw_idx!= (canonical(index)+'\n').encode():fail('index is not canonical JSON plus newline')
    ix=obj(index,'index'); req=obj(ix.get('request'),'request')
    if set(ix)!={'schemaVersion','compilerVersion','requestHash','request','coverage','ownership','intersection','features','cells','counts','limitations'}:fail('index fields are not exact')
    if set(req)!={'schemaVersion','id','inventoryHash','inventoryUnitId','parentPlan','parentAcquisition','children','limits'}:fail('request fields are not exact')
    if ix.get('schemaVersion')!=1 or ix.get('compilerVersion')!='regional-whole-feature-fanout-v1' or ix.get('coverage')!='foundation' or ix.get('ownership')!='lexicographic-source-vertex-closed-cell-id-tie-v1' or ix.get('intersection')!='conservative-feature-bounds':fail('unsupported fan-out index contract')
    req_hash=digest(canonical(req))
    if ix.get('requestHash')!=req_hash:fail('request hash mismatch')
    if len(canonical(req).encode())>MAX_REQUEST:fail('request exceeds 256000 byte cap')
    if req.get('schemaVersion')!=1 or not isinstance(req.get('id'),str) or not 1<=len(req['id'])<=128 or not isinstance(req.get('inventoryHash'),str) or not SHA.fullmatch(req['inventoryHash']) or not isinstance(req.get('inventoryUnitId'),str) or not req['inventoryUnitId'] or req.get('inventoryUnitId')=='legacy-ng' or req.get('parentPlan',{}).get('region',{}).get('countryCode') in (None,'NG') or req.get('parentPlan',{}).get('region',{}).get('parentId')!=req.get('inventoryUnitId'):fail('unsupported request or protected/mismatched country parent')
    lim=obj(req.get('limits'),'limits')
    if set(lim)!={'inputBytes','features','coordinates','children','outputBytes'}:fail('request limits fields are not exact')
    caps={'inputBytes':MAX_INPUT,'features':MAX_FEATURES,'coordinates':MAX_COORDS,'children':MAX_CHILDREN,'outputBytes':MAX_OUTPUT}
    for k,hard in caps.items():
        n=lim.get(k)
        if isinstance(n,bool) or not isinstance(n,int) or n<1 or n>hard:fail(f'request limit {k} invalid')
    parent=obj(req.get('parentPlan'),'parentPlan'); source=obj(parent.get('source'),'parent source'); inp=obj(parent.get('input'),'parent input')
    if set(parent)-{'region','source','input','rawExtraction'} or set(source)!={'id','url','release','license','attribution','sha256','bytes'} or set(inp)!={'path','sha256','bytes'}:fail('parent plan/source/input fields are not exact')
    if 'rawExtraction' in parent and set(parent['rawExtraction'])!={'url','fetched','sha256','bytes'}:fail('parent raw extraction fields are not exact')
    sha_pin(source,'source');sha_pin(inp,'parent input')
    if source['sha256']!=inp['sha256'] or source['bytes']!=inp['bytes'] or inp['bytes']>lim['inputBytes']:fail('parent source/input pins disagree or exceed limit')
    raw_parent=read(root,inp['path'],min(lim['inputBytes'],MAX_INPUT))
    if len(raw_parent)!=inp['bytes'] or digest(raw_parent)!=inp['sha256']:fail('parent GeoJSON bytes differ from pin')
    parent_geo=parse(raw_parent,'parent GeoJSON')
    if not isinstance(parent_geo,dict) or parent_geo.get('type')!='FeatureCollection' or not isinstance(parent_geo.get('features'),list):fail('parent input is not a GeoJSON FeatureCollection')
    parent_meta=parent_geo.get('metadata')
    if parent_meta is not None and not isinstance(parent_meta,dict):fail('parent FeatureCollection metadata is not an object')
    if isinstance(parent_meta,dict) and 'regionalFanout' in parent_meta:fail('parent metadata already claims regional fan-out provenance')
    features=arr(parent_geo.get('features') if isinstance(parent_geo,dict) else None,'parent features')
    if len(features)>lim['features']:fail('parent feature cap exceeded')
    children=arr(req.get('children'),'children')
    if not 1<=len(children)<=lim['children'] or len(children)>MAX_CHILDREN:fail('child count cap invalid')
    child_ids=[r.get('id') for r in children]
    if any(not isinstance(x,str) or not x for x in child_ids) or len(set(child_ids))!=len(child_ids) or child_ids != js_sort(child_ids):fail('request children are not unique and code-unit sorted')
    # Parent source bytes and plan pins already bound the single bounded raw read above.
    if req.get('parentAcquisition') is not None:
        ac=obj(req['parentAcquisition'],'parent acquisition'); receipt=obj(ac.get('receipt'),'parent receipt'); sha_pin(receipt,'parent receipt')
        if set(ac)!={'requestHash','receipt'} or set(receipt)!={'path','sha256','bytes'} or not SHA.fullmatch(str(ac.get('requestHash'))):fail('acquisition reference fields are invalid')
        rb=read(root,receipt['path'],1_000_000)
        if len(rb)!=receipt['bytes'] or digest(rb)!=receipt['sha256']:fail('acquisition receipt bytes differ')
        rv=parse(rb,'acquisition receipt')
        if set(rv)!={'schemaVersion','requestHash','selection','request','completedAt','inputSha256','inputBytes','metrics','upstream','sources','exceptions'} or rv.get('schemaVersion')!=1 or rv.get('requestHash')!=ac.get('requestHash') or rv.get('inputSha256')!=inp['sha256'] or rv.get('inputBytes')!=inp['bytes'] or not isinstance(rv.get('completedAt'),str):fail('acquisition receipt does not bind parent input')
        rawprov=parent.get('rawExtraction'); receipt_request=obj(rv.get('request'),'acquisition request')
        layers=receipt_request.get('layers'); release=receipt_request.get('release'); region=receipt_request.get('region')
        if not isinstance(rawprov,dict) or not isinstance(layers,list) or not layers or any(layer not in ('buildings','roads') for layer in layers) or len(set(layers))!=len(layers) or not isinstance(release,str) or not isinstance(region,dict) or not same(region,parent.get('region')) or receipt_request.get('provider')!='overture' or receipt_request.get('inventoryUnitId')!=req.get('inventoryUnitId'):fail('acquisition request provider, layers, or region differ from parent')
        selection={k:receipt_request.get(k) for k in ('schemaVersion','id','inventoryUnitId','region','provider','release','layers')}
        if set(rv.get('selection',{}))!=set(selection) or not same(rv.get('selection'),selection):fail('acquisition receipt selection differs from its request')
        if rawprov.get('url')!=f"overture:{release}/{ac.get('requestHash')}" or rawprov.get('sha256')!=inp['sha256'] or rawprov.get('bytes')!=inp['bytes'] or rawprov.get('fetched')!=rv.get('completedAt'):fail('parent raw-extraction provenance differs from receipt')
        if not isinstance(parent_meta,dict) or parent_meta.get('requestHash')!=ac.get('requestHash'):fail('parent GeoJSON metadata does not bind the acquisition request hash')
        source_rows=arr(rv.get('sources'),'acquisition source records')
        if len(source_rows)!=len(layers):fail('acquisition source count differs from selected layers')
        validated_sources=[]
        for layer,raw_source in zip(layers,source_rows):
            row=obj(raw_source,'acquisition source')
            if set(row)!={'id','url','release','license','attribution','sha256','bytes'}:fail('acquisition source record fields are not exact')
            expected_url=(f"https://stac.overturemaps.org/{release}/buildings/building/collection.json" if layer=='buildings' else f"https://stac.overturemaps.org/{release}/transportation/segment/collection.json")
            if row.get('id')!=f'overture-{release}-{layer}' or row.get('url')!=expected_url or row.get('release')!=release or row.get('license')!='ODbL-1.0' or not isinstance(row.get('attribution'),str) or 'https://docs.overturemaps.org/attribution/' not in row['attribution'] or not isinstance(row.get('sha256'),str) or not SHA.fullmatch(row['sha256']) or isinstance(row.get('bytes'),bool) or not isinstance(row.get('bytes'),int) or not 1<=row['bytes']<=receipt_request.get('limits',{}).get('outputBytes',0):fail('acquisition source is not a pinned Overture layer')
            validated_sources.append(row)
        expected_source={**source,'id':f"overture-{release}-{'-'.join(layers)}",'url':f'https://stac.overturemaps.org/{release}/catalog.json','release':release,'license':' + '.join(js_sort(list({x['license'] for x in validated_sources}))), 'attribution':'; '.join(js_sort(list({x['attribution'] for x in validated_sources})))}
        if not same(source,expected_source):fail('parent combined source does not match the verified layer sources')
    child_regions=[obj(r,'child region') for r in children]
    byid={r['id']:r for r in child_regions}
    parent_region=obj(parent.get('region'),'parent region')
    if parent_region.get('parentId')!=req.get('inventoryUnitId') or parent_region.get('countryCode') in (None,'NG'):fail('parent extraction region does not bind the declared non-Nigeria country')
    if len(byid)!=len(children) or any(r.get('parentId')!=req.get('inventoryUnitId') or r.get('countryCode')!=parent_region.get('countryCode') or r.get('kind')!='cell' for r in children):fail('child identities/parents/country invalid')
    if set(parent_region)!={'id','parentId','name','kind','countryCode','timezone','bounds'}:fail('parent region fields are not exact')
    parent_bounds=bounds_ok(parent['region']['bounds'],'parent'); parent_frame=region_extent(parent_bounds,0); midpoint=(parent_frame[0]+parent_frame[2])/2
    pwest,psouth,peast,pnorth=parent_frame
    child_frame={}
    for r in children:
        if set(r)!={'id','parentId','name','kind','countryCode','timezone','bounds'}:fail('child region fields are not exact')
        if not isinstance(r.get('name'),str) or not r['name'] or not isinstance(r.get('countryCode'),str) or not re.fullmatch(r'[A-Z]{2}',r['countryCode']) or (r.get('timezone') is not None and not isinstance(r['timezone'],str)):fail('child region metadata is malformed')
        b=bounds_ok(r.get('bounds'),'child'); frame=region_extent(b,midpoint); w,south,e,north=frame
        if w<pwest-1e-9 or e>peast+1e-9 or south<psouth-1e-9 or north>pnorth+1e-9:fail('child outside parent frame')
        child_frame[r['id']]=frame
    for i,aid in enumerate(child_ids):
        aw,asouth,ae,anorth=child_frame[aid]
        for bid in child_ids[i+1:]:
            bw,bsouth,be,bnorth=child_frame[bid]
            if min(ae,be)>max(aw,bw) and min(anorth,bnorth)>max(asouth,bsouth):fail('child regions have overlapping interiors')
    # Rebuild distinct source features, exact canonical identity and source ordinals.
    unique={}; ids={}; coords_total=0; duplicate_rows=0
    for ordinal,fv in enumerate(features):
        live(); f=obj(fv,'feature')
        if f.get('type')!='Feature':fail('source row is not GeoJSON Feature')
        key=feature_key(source['id'],f,ordinal); fb=canonical(f).encode(); fh=digest(fb); kind=classify(f)
        geom=f.get('geometry'); pts=positions(geom)
        coords_total+=len(pts)
        if coords_total>lim['coordinates']:fail('source coordinate cap exceeded')
        if key in unique:
            if unique[key]['hash']!=fh or unique[key]['bytes']!=fb:fail('duplicate feature ID has conflicting source bytes')
            unique[key]['ordinals'].append(ordinal);duplicate_rows+=1;continue
        if f.get('id') in ids and ids[f.get('id')]!=key:fail('source feature ID reused across layers')
        ids[f.get('id')]=key
        if kind!='unsupported' and not pts:fail('supported geometry has no positions')
        owner_point=None; bounds=None; touching=[]; owner=None
        if pts:
            lons=[lon_frame(p[0],midpoint) for p in pts]; bounds=[min(lons),min(p[1] for p in pts),max(lons),max(p[1] for p in pts)]
            if bounds[2]-bounds[0]>180 or (bounds[2]-bounds[0])*(bounds[3]-bounds[1])>25:fail('ambiguous large feature extent')
        if kind!='unsupported':
            if not pts:fail('supported geometry has no positions')
            owner_point=min(([(-180 if p[0]==180 else p[0]),p[1]] for p in pts),key=lambda q:(q[0],q[1]))
            owner=owner_cell(owner_point,children)
        if bounds is not None:
            for cid,cb in child_frame.items():
                if bounds[0]<=cb[2] and bounds[2]>=cb[0] and bounds[1]<=cb[3] and bounds[3]>=cb[1]:touching.append(cid)
        unique[key]={'hash':fh,'bytes':fb,'feature':f,'kind':kind,'ordinals':[ordinal],'pts':pts,'ownerPoint':owner_point,'owner':owner,'bounds':bounds,'touching':sorted(touching),'partIds':part_ids(key,kind,f)}
    if len(unique)>lim['features'] or coords_total>lim['coordinates']:fail('source aggregate cap exceeded')
    # Reconstruct every index feature row and child membership from raw parent input.
    expected_rows=[]; owned_by={cid:[] for cid in byid}; touching_by={cid:[] for cid in byid}
    for key in js_sort(list(unique)):
        d=unique[key]
        status='unsupported' if d['kind']=='unsupported' else ('outside-denominator' if d['owner'] is None else 'owned')
        if status=='owned':owned_by[d['owner']].append(key)
        for cid in d['touching']:touching_by[cid].append(key)
        expected_rows.append({'key':key,'featureId':js_number(d['feature'].get('id')) if isinstance(d['feature'].get('id'),(int,float)) and not isinstance(d['feature'].get('id'),bool) else d['feature'].get('id'),'featureSha256':d['hash'],'sourceOrdinals':d['ordinals'],'kind':d['kind'],'partIds':d['partIds'],'ownerPoint':d['ownerPoint'],'ownerCellId':d['owner'],'status':status,'bounds':([wrapped(d['bounds'][0]),d['bounds'][1],wrapped(d['bounds'][2]),d['bounds'][3]] if d['bounds'] is not None else None),'touchingCellIds':js_sort(d['touching'])})
    if not same(ix.get('features'),expected_rows):fail('feature rows differ from independent source/ownership reconstruction')
    limitations=arr(ix.get('limitations'),'index limitations')
    if not 1<=len(limitations)<=16 or any(not isinstance(x,str) or not x or len(x.encode('utf-8'))>2048 for x in limitations):fail('index limitations are empty, oversized, or malformed')
    output_sum=len(raw_idx)
    cell_rows=arr(ix.get('cells'),'index cells')
    if len(cell_rows)!=len(children):fail('cell count differs from request')
    seen_cells=set()
    for cell_i,cell in enumerate(cell_rows):
        live(); c=obj(cell,'cell'); region=obj(c.get('region'),'cell region'); cid=region.get('id')
        if cid not in byid or cid in seen_cells or cid!=child_ids[cell_i] or not same(region,byid[cid]):fail('index cell region differs from requested child')
        seen_cells.add(cid)
        expected_owned=owned_by[cid]; expected_touch=touching_by[cid]
        if c.get('ownedFeatureKeys')!=expected_owned or c.get('touchingFeatureKeys')!=expected_touch:fail('cell owned/touching memberships differ')
        if c.get('status')!=('owned-features' if expected_owned else 'empty-owned'):fail('cell status differs')
        deps=js_sort(list({unique[k]['owner'] for k in expected_touch if unique[k]['kind']!='unsupported' and unique[k]['owner'] is not None and unique[k]['owner']!=cid}))
        unresolved=js_sort([k for k in expected_touch if unique[k]['owner'] is None or unique[k]['kind']=='unsupported'])
        if c.get('ownerDependencies')!=deps or c.get('unresolvedFeatureKeys')!=unresolved:fail('cell dependency lists differ')
        ref=obj(c.get('input'),'child input ref');sha_pin(ref,'child input')
        if set(ref)!={'path','sha256','bytes'}:fail('child input reference fields are not exact')
        if ref.get('path')!=f"inputs/{ref['sha256']}.geojson":fail('child input is not stored at its exact content-addressed path')
        plan=obj(c.get('plan'),'child plan');pinput=obj(plan.get('input'),'child plan input');psource=obj(plan.get('source'),'child source')
        if set(plan)-{'region','input','source','rawExtraction'} or set(pinput)!={'path','sha256','bytes'} or set(psource)!={'id','url','release','license','attribution','sha256','bytes'}:fail('child plan/source/input fields are not exact')
        if not same(ref,pinput) or psource.get('sha256')!=ref.get('sha256') or psource.get('bytes')!=ref.get('bytes'):fail('child plan/ref source pins differ')
        expected_features=[unique[k]['feature'] for k in expected_owned]
        child_bytes=read(root,ref['path'],MAX_INPUT,output_root)
        if len(child_bytes)!=ref['bytes'] or digest(child_bytes)!=ref['sha256']:fail('child bytes differ from index pin')
        child_geo=parse(child_bytes,'child GeoJSON')
        if child_bytes!=(canonical(child_geo)+'\n').encode():fail('child input is not canonical JSON plus newline')
        expected_collection=dict(parent_geo);expected_collection['features']=expected_features
        raw_meta=parent_geo.get('metadata')
        if raw_meta is not None and not isinstance(raw_meta,dict):fail('parent FeatureCollection metadata is not an object')
        expected_metadata=dict(raw_meta or {});expected_metadata['regionalFanout']={'requestHash':req_hash,'parentInputSha256':inp['sha256'],'logicalCellId':cid,'ownership':'lexicographic-source-vertex-closed-cell-id-tie-v1'};expected_collection['metadata']=expected_metadata
        if not same(child_geo,expected_collection):fail('child does not preserve the parent collection and exact whole owned features')
        plan_region=obj(plan.get('region'),'child plan region')
        if any(plan_region.get(field)!=region.get(field) for field in ('id','parentId','name','kind','countryCode','timezone')):fail('child plan metadata differs from logical cell')
        pb=bounds_ok(plan_region.get('bounds'),'child plan')
        pw,ps,pe,pn=region_extent(pb,midpoint); cw,cs,ce,cn=child_frame[cid]
        owned_boxes=[unique[k]['bounds'] for k in expected_owned if unique[k]['bounds'] is not None]
        needed_w=min([cw]+[b[0] for b in owned_boxes]);needed_s=min([cs]+[b[1] for b in owned_boxes]);needed_e=max([ce]+[b[2] for b in owned_boxes]);needed_n=max([cn]+[b[3] for b in owned_boxes])
        if pw>needed_w+1e-9 or pe<needed_e-1e-9 or ps>needed_s+1e-9 or pn<needed_n-1e-9:fail('child compilation bounds do not contain the whole owned features')
        expected_plan_region=dict(region);expected_plan_region['bounds']=[wrapped(needed_w),needed_s,wrapped(needed_e),needed_n]
        if not same(plan_region,expected_plan_region):fail('child compilation bounds differ from independently expanded whole-feature bounds')
        if not same(plan.get('rawExtraction'),parent.get('rawExtraction')):fail('child rawExtraction differs from parent')
        output_sum+=len(child_bytes)
        if output_sum>lim['outputBytes']:fail('aggregate output bytes exceed request limit')
    if seen_cells!=set(child_ids):fail('index omits a requested child cell')
    emitted_parts=sum(len(d['partIds']) for d in unique.values() if d['kind']!='unsupported' and d['owner'] is not None)
    counts={'sourceRows':len(features),'uniqueFeatures':len(unique),'duplicateRows':duplicate_rows,'owned':sum(map(len,owned_by.values())),'outsideDenominator':sum(1 for d in unique.values() if d['kind']!='unsupported' and d['owner'] is None),'unsupported':sum(1 for d in unique.values() if d['kind']=='unsupported'),'emittedParts':emitted_parts,'coordinates':coords_total}
    if not same(ix.get('counts'),counts):fail('index counts differ from independent reconstruction')
    publication_rel=f'publications/{req_hash}.json';publication_raw=read(root,publication_rel,1_000_000,output_root);publication=parse(publication_raw,'publication receipt')
    expected_publication={'schemaVersion':1,'requestHash':req_hash,'indexHash':expected,'indexPath':f'indices/{expected}.json','logicalBytes':output_sum,'inputs':[cell['input'] for cell in cell_rows]}
    if publication_raw!=(canonical(expected_publication)+'\n').encode() or not same(publication,expected_publication):fail('completion publication receipt does not bind the independently verified index and input refs')
    return {'schemaVersion':1,'indexHash':expected,'requestHash':req_hash,**counts,'cells':len(children),'logicalBytes':output_sum,'publicationBytes':len(publication_raw),'diskBytes':output_sum+len(publication_raw),'networkBytes':0,'scope':'Independent reconstruction from pinned parent input; local fan-out only, conservative bounds are not exact intersections, and no global coverage/playability claim. Canonical number formatting uses shortest-roundtrip digits with ECMAScript thresholds; a cross-runtime tie-case mismatch would fail closed as a hash mismatch.'}

def main()->int:
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--root',required=True);ap.add_argument('--index-path',required=True);ap.add_argument('--index-hash',required=True);a=ap.parse_args()
    try:
        receipt=main_verify(root_path(a.root),a.index_path,a.index_hash);sys.stdout.write(json.dumps(receipt,separators=(',',':'))+'\n');return 0
    except Exception as e:
        sys.stderr.write((str(e) or type(e).__name__)[:2000]+'\n');return 1
if __name__=='__main__':raise SystemExit(main())
