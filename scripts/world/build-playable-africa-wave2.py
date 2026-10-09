#!/usr/bin/env python3
"""Generate the second starter wave using the accepted serial bounded source converter."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "world/playable-africa-wave2"
CITIES = {"BJ": "cotonou", "CI": "abidjan", "SN": "dakar", "ZA": "cape-town", "ET": "addis-ababa"}
_spec = importlib.util.spec_from_file_location("starter_geography", Path(__file__).with_name("build-playable-africa.py"))
if _spec is None or _spec.loader is None:
    raise RuntimeError("The accepted starter source converter is missing")
_starter = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_starter)
pinned, clip_ring, acquire, convert, dump = (_starter.pinned, _starter.clip_ring, _starter.acquire, _starter.convert, _starter.dump)
MAX_DOWNLOAD, MAX_BUILDINGS, MAX_ROADS, MAX_POINTS = (_starter.MAX_DOWNLOAD, _starter.MAX_BUILDINGS, _starter.MAX_ROADS, _starter.MAX_POINTS)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--acquire", action="store_true", help="Permit a missing city request, sequentially, within original limits")
    parser.add_argument("--city", choices=list(CITIES.values()))
    parser.add_argument("--check", action="store_true", help="Verify tracked generated asset pins offline")
    args = parser.parse_args()
    if args.check:
        for city_id in CITIES.values():
            if args.city and city_id != args.city:
                continue
            receipt = json.loads((DATA / (city_id + "-sources.json")).read_text())
            for name, expected in receipt["assets"].items():
                path = ROOT / "src/game/cities" / city_id / name
                if path.stat().st_size != expected["bytes"] or hashlib.sha256(path.read_bytes()).hexdigest() != expected["sha256"]:
                    raise ValueError(f"Changed starter asset: {city_id}/{name}")
            print(json.dumps({"city": city_id, "status": "pinned-assets-match", "coverage": "starter"}), flush=True)
        return
    inventory = json.loads((DATA / "inventory.json").read_text())
    airports = json.loads((DATA / "airports.json").read_text())
    airport_by_iso = {item["countryIso2"]: item for item in airports["airports"]}
    summaries = []
    for country in inventory["countries"]:
        city_id = CITIES[country["iso2"]]
        timezone = country["selectedPlace"]["ianaTimezone"]
        if args.city and city_id != args.city:
            continue
        centre = country["selectedPlace"]["coordinatesWgs84"]
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
        if not buildings or not roads:
            raise ValueError(f"Missing usable central buildings or streets for {city_id}")
        facts = {"id": city_id, "name": country["selectedPlace"]["name"],
                 "country": {"idISOlower": country["iso2"].lower(), "name": country["country"]},
                 "state": {"idunique": country["iso2"].lower() + "-starter", "name": "Starter zone"},
                 "timezone": timezone, "centre": {"lon": centre[0], "lat": centre[1]},
                 "airport": {"id": city_id + "-airport", "name": airport["officialName"], "lon": alon, "lat": alat, "sourceUrl": airport["coordinateSource"]["sourceUrl"]},
                 "sourceLabel": "Natural Earth, OpenStreetMap contributors and cited aeronautical information sources",
                 "sourceUrl": source["url"], "licence": "Natural Earth public domain; OpenStreetMap ODbL-1.0; Airport reference points: cited aeronautical information sources",
                 "bounds": bounds,
                 "coverageNote": country["selectedPlace"]["placeRole"] + ". Starter visitor area. Real city and airport points, clipped country land and a bounded central street/building sample. Visitor services and homes are fictional game content. Buildings use approximate box silhouettes; missing heights are estimates. Game prices remain in the shared Allworld economy."}
        output = ROOT / "src/game/cities" / city_id
        output.mkdir(parents=True, exist_ok=True)
        (output / "facts.ts").write_text("// Generated by scripts/world/build-playable-africa.py\nimport type { DestinationFacts } from '../africa/types.ts'\nexport const FACTS = " + json.dumps(facts, ensure_ascii=False, indent=2) + " satisfies DestinationFacts\n")
        (output / "geometry.ts").write_text("// Generated bounded geographic data; load only with this city map.\nimport type { DestinationGeometry } from '../africa/map.ts'\nexport const GEOMETRY: DestinationGeometry = " + json.dumps({"land": land, "buildings": buildings, "roads": roads}, ensure_ascii=False, separators=(",", ":")) + "\n")
        (output / "index.ts").write_text("import { createDestinationModule } from '../africa/module.ts'\nimport { FACTS } from './facts.ts'\nexport const city = createDestinationModule(FACTS, async () => (await import('#city-map/" + city_id + "')).CITY_MAP, async () => (await import('./content.ts')).CONTENT)\n")
        (output / "content.ts").write_text("import { buildDestinationContent } from '../africa/contentBuilder.ts'\nimport { FACTS } from './facts.ts'\nexport const CONTENT = buildDestinationContent(FACTS)\n")
        (output / "map.ts").write_text("import { createDestinationMap } from '../africa/map.ts'\nimport { FACTS } from './facts.ts'\nimport { GEOMETRY } from './geometry.ts'\nexport const CITY_MAP = createDestinationMap(FACTS, GEOMETRY, async () => (await import('./index.ts')).city)\n")
        receipt = {"cityId": city_id, "selectedPlace": country["selectedPlace"], "airport": airport,
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
