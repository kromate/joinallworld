#!/usr/bin/env python3
"""Create bounded, pinned starter-city assets. Network access is explicit and serial."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import time
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "world/playable-africa"
MAX_DOWNLOAD = 8 * 1024 * 1024
MAX_BUILDINGS = 350
MAX_ROADS = 160
MAX_POINTS = 6000
CITIES = {"CM": ("yaounde", "Africa/Douala"), "TG": ("lome", "Africa/Lome"),
          "GH": ("accra", "Africa/Accra"), "KE": ("nairobi", "Africa/Nairobi"),
          "DZ": ("algiers", "Africa/Algiers")}


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")


def pinned(path, digest):
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != digest:
        raise ValueError(f"Source hash mismatch: {path}")
    return json.loads(raw)


def clip_ring(ring, bounds):
    points = ring[:-1] if ring and ring[0] == ring[-1] else ring
    for axis, edge, keep_greater in [(0, bounds[0], True), (0, bounds[2], False),
                                    (1, bounds[1], True), (1, bounds[3], False)]:
        clipped = []
        for index, point in enumerate(points):
            prior = points[index - 1]
            inside = point[axis] >= edge if keep_greater else point[axis] <= edge
            was_inside = prior[axis] >= edge if keep_greater else prior[axis] <= edge
            if inside != was_inside:
                t = (edge - prior[axis]) / (point[axis] - prior[axis])
                crossing = [round(prior[k] + t * (point[k] - prior[k]), 6) for k in range(2)]
                crossing[axis] = edge
                clipped.append(crossing)
            if inside:
                clipped.append(point)
        points = clipped
        if not points:
            break
    return points + [points[0]] if len(points) >= 3 else []


def acquire(city_id, centre):
    # About 660 m across: these are central samples, never whole-city extracts.
    lon, lat = centre
    bounds = [round(lon - .003, 6), round(lat - .003, 6),
              round(lon + .003, 6), round(lat + .003, 6)]
    cache = ROOT / ".cache/world-build/playable-africa" / city_id
    cache.mkdir(parents=True, exist_ok=True)
    path, receipt = cache / "source.osm", cache / "source.json"
    url = "https://api.openstreetmap.org/api/0.6/map?bbox=" + ",".join(map(str, bounds))
    if path.exists() and receipt.exists():
        info = json.loads(receipt.read_text())
        raw = path.read_bytes()
        if info["url"] != url or hashlib.sha256(raw).hexdigest() != info["sha256"]:
            raise ValueError(f"Changed source cache: {city_id}")
        return raw, info
    ledger_path = cache / "requests.json"
    ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else []
    if any(item["url"] == url for item in ledger) or len(ledger) >= 2:
        raise ValueError(f"Request already attempted or city request budget exhausted: {city_id}")
    # Reserve the complete request allowance before opening the network connection.
    ledger.append({"url": url, "reservedBytes": MAX_DOWNLOAD, "status": "started"})
    dump(ledger_path, ledger)
    request = urllib.request.Request(url, headers={"User-Agent": "AllworldStarterMaps/1.0 (bounded geography research)", "Accept": "application/xml"})
    started = time.monotonic()
    with urllib.request.urlopen(request, timeout=30) as response:
        pieces, count = [], 0
        while True:
            piece = response.read(65536)
            if not piece:
                break
            count += len(piece)
            if count > MAX_DOWNLOAD or time.monotonic() - started > 45:
                ledger[-1].update({"status": "budget_exhausted", "receivedBytes": count})
                dump(ledger_path, ledger)
                raise ValueError(f"Source budget exhausted: {city_id}")
            pieces.append(piece)
    raw = b"".join(pieces)
    ET.fromstring(raw)
    info = {"url": url, "bounds": bounds, "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(), "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "attribution": "© OpenStreetMap contributors", "licence": "ODbL-1.0"}
    path.write_bytes(raw)
    dump(receipt, info)
    ledger[-1].update({"status": "complete", "receivedBytes": len(raw), "sha256": info["sha256"]})
    dump(ledger_path, ledger)
    return raw, info


def convert(raw, centre):
    tree = ET.fromstring(raw)
    nodes = {n.attrib["id"]: [float(n.attrib["lon"]), float(n.attrib["lat"])] for n in tree.findall("node")}
    buildings, roads = [], []
    counts = {"buildings": 0, "roads": 0, "unresolvedWays": 0, "relationsOmitted": len(tree.findall("relation"))}
    point_count = 0
    ways = sorted(tree.findall("way"), key=lambda way: int(way.attrib["id"]))
    for way in ways:
        tags = {tag.attrib["k"]: tag.attrib["v"] for tag in way.findall("tag")}
        is_building = "building" in tags and tags["building"] != "no"
        is_road = "highway" in tags and tags["highway"] not in ("proposed", "construction")
        if not is_building and not is_road:
            continue
        points = [nodes.get(nd.attrib["ref"]) for nd in way.findall("nd")]
        if any(p is None for p in points) or len(points) < 2:
            counts["unresolvedWays"] += 1
            continue
        if is_building and len(points) >= 4 and points[0] == points[-1]:
            counts["buildings"] += 1
            if len(buildings) >= MAX_BUILDINGS or len(points) > 80 or point_count + len(points) > MAX_POINTS:
                continue
            # Keep actual rings for later extrusion. Height estimates are explicit.
            height, height_kind = 6, "estimated"
            try:
                if "height" in tags:
                    height, height_kind = float(tags["height"].removesuffix(" m")), "source"
                elif "building:levels" in tags:
                    height = float(tags["building:levels"]) * 3
            except ValueError:
                height, height_kind = 6, "estimated"
            if not math.isfinite(height) or not 1 <= height <= 100:
                height, height_kind = 6, "estimated"
            buildings.append({"id": "osm:way:" + way.attrib["id"], "ring": points, "heightM": height, "heightKind": height_kind})
            point_count += len(points)
        elif is_road:
            counts["roads"] += 1
            if len(roads) >= MAX_ROADS or point_count + len(points) > MAX_POINTS:
                continue
            roads.append({"id": "osm:way:" + way.attrib["id"], "name": tags.get("name", "Street"),
                          "major": tags["highway"] in ("motorway", "trunk", "primary", "secondary"), "points": points})
            point_count += len(points)
    return buildings, roads, counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--acquire", action="store_true", help="Fetch missing source samples once; no retries")
    parser.add_argument("--city", choices=[x[0] for x in CITIES.values()])
    parser.add_argument("--check", action="store_true", help="Check tracked assets against their source receipts without network or writes")
    args = parser.parse_args()
    if args.check:
        for city_id, _ in CITIES.values():
            if args.city and city_id != args.city:
                continue
            receipt = json.loads((DATA / (city_id + "-sources.json")).read_text())
            for name, expected in receipt["assets"].items():
                path = ROOT / "src/game/cities" / city_id / name
                if path.stat().st_size != expected["bytes"] or hashlib.sha256(path.read_bytes()).hexdigest() != expected["sha256"]:
                    raise ValueError(f"Changed starter asset: {city_id}/{name}")
            print(json.dumps({"city": city_id, "status": "pinned-assets-match", "coverage": "starter"}), flush=True)
        return
    inventory = json.loads((DATA / "data-inventory.json").read_text())
    airports = json.loads((DATA / "airports.json").read_text())
    airport_by_iso = {item["countryIso2"]: item for item in airports["airports"]}
    summaries = []
    for country in inventory["countries"]:
        city_id, timezone = CITIES[country["iso2"]]
        if args.city and city_id != args.city:
            continue
        centre = country["capital"]["coordinatesWgs84"]
        airport = airport_by_iso[country["iso2"]]
        alon, alat = airport["wgs84LonLat"]
        bounds = [round(min(centre[0] - .015, alon - .012), 6), round(min(centre[1] - .015, alat - .012), 6),
                  round(max(centre[0] + .015, alon + .012), 6), round(max(centre[1] + .015, alat + .012), 6)]
        land = []
        for part in country["admin0Geometry"]["outlineParts"]:
            geometry = pinned(ROOT / part["path"], part["sha256"])
            for polygon in geometry["coordinates"]:
                outer = clip_ring(polygon[0], bounds)
                if outer:
                    holes = [clipped for ring in polygon[1:] if (clipped := clip_ring(ring, bounds))]
                    land.append([outer] + holes)
        if not land:
            raise ValueError(f"No land for {city_id}")
        raw_path = ROOT / ".cache/world-build/playable-africa" / city_id / "source.osm"
        if not args.acquire and not raw_path.exists():
            raise ValueError(f"Missing source sample for {city_id}; run with --acquire")
        raw, source = acquire(city_id, centre)
        buildings, roads, counts = convert(raw, centre)
        facts = {"id": city_id, "name": country["capital"]["name"],
                 "country": {"idISOlower": country["iso2"].lower(), "name": country["country"]},
                 "state": {"idunique": country["iso2"].lower() + "-starter", "name": "Starter district"},
                 "timezone": timezone, "centre": {"lon": centre[0], "lat": centre[1]},
                 "airport": {"id": city_id + "-airport", "name": airport["officialName"], "lon": alon, "lat": alat, "sourceUrl": airport["coordinateSource"]["sourceUrl"]},
                 "sourceLabel": "Natural Earth, OpenStreetMap contributors and national aeronautical information sources",
                 "sourceUrl": source["url"], "licence": "Natural Earth public domain; OpenStreetMap ODbL-1.0; Airport reference points: national aeronautical information sources",
                 "bounds": bounds,
                 "coverageNote": "Starter visitor area. Real capital and airport points, clipped country land and a bounded central street/building sample. Visitor services and homes are fictional game content. Buildings use approximate box silhouettes; missing heights are estimates. Game prices remain in the shared Allworld economy."}
        output = ROOT / "src/game/cities" / city_id
        output.mkdir(parents=True, exist_ok=True)
        (output / "facts.ts").write_text("// Generated by scripts/world/build-playable-africa.py\nimport type { DestinationFacts } from '../africa/types.ts'\nexport const FACTS = " + json.dumps(facts, ensure_ascii=False, indent=2) + " satisfies DestinationFacts\n")
        (output / "geometry.ts").write_text("// Generated bounded geographic data; load only with this city map.\nimport type { DestinationGeometry } from '../africa/map.ts'\nexport const GEOMETRY = " + json.dumps({"land": land, "buildings": buildings, "roads": roads}, ensure_ascii=False, separators=(",", ":")) + " satisfies DestinationGeometry\n")
        (output / "index.ts").write_text("import { createDestinationModule } from '../africa/module.ts'\nimport { FACTS } from './facts.ts'\nexport const city = createDestinationModule(FACTS, async () => (await import('#city-map/" + city_id + "')).CITY_MAP, async () => (await import('./content.ts')).CONTENT)\n")
        (output / "content.ts").write_text("import { buildDestinationContent } from '../africa/contentBuilder.ts'\nimport { FACTS } from './facts.ts'\nexport const CONTENT = buildDestinationContent(FACTS)\n")
        (output / "map.ts").write_text("import { createDestinationMap } from '../africa/map.ts'\nimport { FACTS } from './facts.ts'\nimport { GEOMETRY } from './geometry.ts'\nexport const CITY_MAP = createDestinationMap(FACTS, GEOMETRY, async () => (await import('./index.ts')).city)\n")
        receipt = {"cityId": city_id, "capital": country["capital"], "airport": airport,
                   "bounds": bounds, "sources": {"osm": source, "naturalEarth": country["admin0Geometry"]},
                   "kept": {"buildings": len(buildings), "roads": len(roads)}, "observed": counts,
                   "limits": {"downloadBytes": MAX_DOWNLOAD, "buildings": MAX_BUILDINGS, "roads": MAX_ROADS, "points": MAX_POINTS},
                   "caveats": facts["coverageNote"],
                   "assets": {name: {"sha256": hashlib.sha256((output / name).read_bytes()).hexdigest(), "bytes": (output / name).stat().st_size} for name in ("facts.ts", "geometry.ts", "index.ts", "map.ts", "content.ts")}}
        dump(DATA / (city_id + "-sources.json"), receipt)
        summaries.append({"city": city_id, "buildings": len(buildings), "roads": len(roads), "sourceBytes": source["bytes"]})
        print(json.dumps(summaries[-1]), flush=True)


if __name__ == "__main__":
    main()
