#!/usr/bin/env python3
"""Build the checked-in, privacy-minimized UNILAG OSM source and metre map."""
from __future__ import annotations

import argparse, hashlib, json, math
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs/unilag-data/unilag-osm-source.json"
OUTPUT = ROOT / "src/campus/unilag/map.generated.ts"
BOUNDARY_ID = 539288366
GATE_LINK_WAYS = {693550308, 693550309}
ORIGIN = (6.5176963, 3.3851659)
KEEP_TAGS = {"name", "alt_name", "amenity", "building", "building:levels", "height", "highway", "lanes", "width", "surface", "entrance", "barrier", "natural", "water", "waterway", "landuse", "leisure", "sport"}

def inside(lon: float, lat: float, ring: list[tuple[float,float]]) -> bool:
    hit = False
    for i, (x1,y1) in enumerate(ring):
        x2,y2 = ring[i-1]
        if (y1 > lat) != (y2 > lat) and lon < (x2-x1)*(lat-y1)/(y2-y1)+x1: hit = not hit
    return hit

def parse_xml(paths: list[Path]) -> tuple[dict[int,dict],dict[int,dict]]:
    nodes: dict[int,dict] = {}; ways: dict[int,dict] = {}
    for path in paths:
        for event, elem in ET.iterparse(path, events=("end",)):
            if elem.tag == "node":
                ident=int(elem.attrib["id"]); tags={t.attrib["k"]:t.attrib["v"] for t in elem.findall("tag")}
                nodes[ident]={"id":ident,"lat":float(elem.attrib["lat"]),"lon":float(elem.attrib["lon"]),"version":int(elem.attrib.get("version","0")),"timestamp":elem.attrib.get("timestamp",""),"tags":{k:v for k,v in tags.items() if k in KEEP_TAGS}}
            elif elem.tag == "way":
                ident=int(elem.attrib["id"]); tags={t.attrib["k"]:t.attrib["v"] for t in elem.findall("tag")}
                ways[ident]={"id":ident,"nodes":[int(n.attrib["ref"]) for n in elem.findall("nd")],"version":int(elem.attrib.get("version","0")),"timestamp":elem.attrib.get("timestamp",""),"tags":{k:v for k,v in tags.items() if k in KEEP_TAGS}}
            if elem.tag in {"node", "way"}: elem.clear()
    return nodes, ways

def extract(paths: list[Path]) -> dict:
    nodes, ways = parse_xml(paths)
    boundary=ways[BOUNDARY_ID]; ring=[(nodes[n]["lon"],nodes[n]["lat"]) for n in boundary["nodes"]]
    selected=[]; needed=set(boundary["nodes"])
    for way in ways.values():
        coords=[(nodes[n]["lon"],nodes[n]["lat"]) for n in way["nodes"] if n in nodes]
        if len(coords)<2: continue
        tags=way["tags"]; cx=sum(p[0] for p in coords)/len(coords); cy=sum(p[1] for p in coords)/len(coords)
        mapped_surface = tags.get("natural") in {"water", "wetland"} or tags.get("landuse") in {"reservoir", "basin", "recreation_ground"} or tags.get("waterway") == "riverbank" or tags.get("leisure") in {"swimming_pool", "pitch", "sports_centre", "stadium"}
        relevant=("building" in tags or "highway" in tags or mapped_surface or bool(tags.get("name"))) and (inside(cx,cy,ring) or any(inside(x,y,ring) for x,y in coords))
        if way["id"]==BOUNDARY_ID or way["id"] in GATE_LINK_WAYS or relevant:
            selected.append(way); needed.update(way["nodes"])
    poi_nodes=[n for n in nodes.values() if n["tags"].get("name") and inside(n["lon"],n["lat"],ring)]
    needed.update(n["id"] for n in poi_nodes)
    return {"schemaVersion":1,"attribution":"© OpenStreetMap contributors","license":"ODbL 1.0","boundaryWay":BOUNDARY_ID,"nodes":[nodes[n] for n in sorted(needed)],"ways":sorted(selected,key=lambda w:w["id"]),"poiNodes":sorted((n["id"] for n in poi_nodes))}

def project(lat: float, lon: float) -> list[float]:
    # WGS84 ECEF -> local east/north tangent plane; z increases south.
    a=6378137.0; e2=6.69437999014e-3
    def ecef(phi_deg, lam_deg):
        phi=math.radians(phi_deg); lam=math.radians(lam_deg); n=a/math.sqrt(1-e2*math.sin(phi)**2)
        return ((n)*math.cos(phi)*math.cos(lam),n*math.cos(phi)*math.sin(lam),n*(1-e2)*math.sin(phi))
    p=ecef(lat,lon); o=ecef(*ORIGIN); phi=math.radians(ORIGIN[0]); lam=math.radians(ORIGIN[1]); d=[p[i]-o[i] for i in range(3)]
    east=-math.sin(lam)*d[0]+math.cos(lam)*d[1]
    north=-math.sin(phi)*math.cos(lam)*d[0]-math.sin(phi)*math.sin(lam)*d[1]+math.cos(phi)*d[2]
    return [round(east,2),round(-north,2)]

def number(raw: str|None) -> float|None:
    if not raw: return None
    try: return float(raw.lower().replace("m","").strip())
    except ValueError: return None

def generate(data: dict) -> str:
    nodes={n["id"]:n for n in data["nodes"]}; ways={w["id"]:w for w in data["ways"]}; boundary=ways[BOUNDARY_ID]
    ref=lambda kind,v:{"type":kind,"id":v["id"],"version":v["version"],"timestamp":v["timestamp"]}
    points=lambda w:[project(nodes[n]["lat"],nodes[n]["lon"]) for n in w["nodes"]]
    buildings=[]; roads=[]; surfaces=[]
    defaults={"motorway":14,"trunk":12,"primary":10,"secondary":8,"tertiary":7,"residential":6,"service":4,"footway":2,"path":1.5}
    for w in ways.values():
        t=w["tags"]
        if "building" in t and len(w["nodes"])>=4 and w["nodes"][0]==w["nodes"][-1]:
            h=number(t.get("height")); source="height"
            if h is None: h=number(t.get("building:levels")); h=(h*3.2 if h else 8); source="levels" if t.get("building:levels") else "estimated"
            buildings.append({"id":f"osm-way-{w['id']}","osm":ref("way",w),**({"name":t["name"]} if t.get("name") else {}),"ring":points(w),"height":round(h,2),"heightSource":source})
        if "highway" in t:
            width=number(t.get("width")); source="width"
            if width is None and number(t.get("lanes")): width=number(t["lanes"])*3.1; source="lanes"
            if width is None: width=defaults.get(t["highway"],3); source="estimated"
            roads.append({"id":f"osm-way-{w['id']}","osm":ref("way",w),**({"name":t["name"]} if t.get("name") else {}),"highway":t["highway"],"points":points(w),"width":round(width,2),"widthSource":source})
        surface_kind="water" if t.get("natural")=="water" or t.get("landuse") in {"reservoir","basin"} or t.get("waterway")=="riverbank" else "wetland" if t.get("natural")=="wetland" else "pool" if t.get("leisure")=="swimming_pool" else "pitch" if t.get("leisure")=="pitch" else "sports" if t.get("leisure") in {"sports_centre","stadium"} or t.get("landuse")=="recreation_ground" else None
        if surface_kind and len(w["nodes"])>=4 and w["nodes"][0]==w["nodes"][-1]:
            surfaces.append({"id":f"osm-way-{w['id']}","osm":ref("way",w),"kind":surface_kind,**({"name":t["name"]} if t.get("name") else {}),**({"sport":t["sport"]} if t.get("sport") else {}),"ring":points(w)})
    pois=[]
    for ident in data["poiNodes"]:
        n=nodes[ident]; tags=n["tags"]
        pois.append({"id":f"osm-node-{ident}","osm":ref("node",n),"name":tags["name"],"point":project(n["lat"],n["lon"]),"tags":tags})
    for w in ways.values():
        if not w["tags"].get("name"): continue
        projected=points(w); x=sum(p[0] for p in projected)/len(projected); z=sum(p[1] for p in projected)/len(projected)
        pois.append({"id":f"osm-way-{w['id']}","osm":ref("way",w),"name":w["tags"]["name"],"point":[round(x,2),round(z,2)],"tags":w["tags"]})
    ring=points(boundary); xs=[p[0] for p in ring]; zs=[p[1] for p in ring]
    snapshot=max((x["timestamp"] for x in [*data["nodes"],*data["ways"]] if x["timestamp"]),default="")
    out={"schemaVersion":1,"source":{"attribution":data["attribution"],"license":data["license"],"snapshot":snapshot,"boundary":ref("way",boundary)},"origin":{"latitude":ORIGIN[0],"longitude":ORIGIN[1],"label":"UNILAG main entrance, OSM node 9889685634","source":"OSM node 9889685634; entrance=main; boundary vertex and University Road links"},"bounds":[min(xs),min(zs),max(xs),max(zs)],"boundary":ring,"buildings":buildings,"roads":roads,"surfaces":surfaces,"pois":pois}
    payload=json.dumps(out,ensure_ascii=False,separators=(",",":"),sort_keys=False)
    source_hash=hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    return f"/** Generated by scripts/geo/build-unilag-map.py; source sha256 {source_hash}. */\nimport type {{ CampusMapData }} from './geo.ts';\n\nexport const CAMPUS_MAP: CampusMapData = {payload};\n"

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--extract",nargs="+",type=Path); ap.add_argument("--check",action="store_true"); args=ap.parse_args()
    if args.extract:
        data=extract(args.extract); SOURCE.parent.mkdir(parents=True,exist_ok=True)
        SOURCE.write_text(json.dumps(data,ensure_ascii=False,separators=(",",":"),sort_keys=False)+"\n",encoding="utf-8")
    text=generate(json.loads(SOURCE.read_text(encoding="utf-8")))
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8")!=text: raise SystemExit("map.generated.ts is stale")
    else: OUTPUT.write_text(text,encoding="utf-8")

if __name__ == "__main__": main()
