#!/usr/bin/env python3
"""Generate selected, bounded African starter-city source assets serially."""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re
import unicodedata
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "world/playable-africa-rollout"
OUTPUT = ROOT / "src/game/cities"
RECEIPTS = DATA / "receipts"
EARLY = {"NG", "CM", "TG", "GH", "KE", "DZ", "BJ", "CI", "SN", "ZA", "ET"}
_spec = importlib.util.spec_from_file_location("starter_geography", Path(__file__).with_name("build-playable-africa.py"))
if _spec is None or _spec.loader is None:
    raise RuntimeError("The accepted bounded geography converter is missing")
_starter = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_starter)
dump, pinned, clip_ring, acquire, convert = (_starter.dump, _starter.pinned, _starter.clip_ring, _starter.acquire, _starter.convert)
MAX_DOWNLOAD, MAX_BUILDINGS, MAX_ROADS, MAX_POINTS = (_starter.MAX_DOWNLOAD, _starter.MAX_BUILDINGS, _starter.MAX_ROADS, _starter.MAX_POINTS)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def city_id(name):
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii").lower()
    result = re.sub(r"[^a-z0-9]+", "-", ascii_name).strip("-")
    if not result:
        raise ValueError(f"Cannot derive ASCII city id from {name!r}")
    return result


def inventory(verify_cached_sources=True):
    value = json.loads((DATA / "inventory.json").read_text())
    if verify_cached_sources:
        for source in value["sourceFiles"]:
            path_value = source.get("path") or source.get("localCachePath")
            expected = source.get("sha256")
            if path_value and expected:
                path = ROOT / path_value
                if not path.is_file() or sha(path) != expected:
                    raise ValueError(f"Pinned inventory source missing or changed: {path_value}")
    return value


def js_number(value):
    number = float(value)
    return str(int(number)) if number.is_integer() else repr(number)


def catalogue_bytes(identifier, name, country_iso, country_name, centre):
    # Match scripts/city/build-catalogue.ts's exact generated row and loader serialization.
    quote = lambda value: json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    extra = f',{quote(country_iso.lower())},{quote(country_name)}'
    row = f'[{quote(identifier)},{quote(name)},{quote(country_iso.lower()+"-starter")},{quote("Starter zone")},{js_number(centre[0])},{js_number(centre[1])},1{extra}],'
    loader = f'async()=>(await import({quote("./"+identifier+"/index.ts")})).city,'
    return len(row.encode()) + len(loader.encode())


def validate_row(row, verify_cached_sources=True):
    code = row["iso2"]
    if row.get("gaps"):
        raise ValueError(f"{code} has unresolved inventory gaps: {'; '.join(row['gaps'])}")
    if row.get("iso2Eh") != code or row.get("isoIdentityStatus") != "Natural Earth ISO_A2 and ISO_A2_EH agree":
        raise ValueError(f"{code} has no exact ISO identity join")
    place = row.get("chosenCity")
    if not isinstance(place, dict) or not place.get("name") or not isinstance(place.get("coordinatesWgs84"), list) or len(place["coordinatesWgs84"]) != 2:
        raise ValueError(f"{code} has no selected settlement point")
    if not valid_point(place["coordinatesWgs84"]):
        raise ValueError(f"{code} selected settlement has invalid WGS84 coordinates")
    if place.get("iso2") != code:
        raise ValueError(f"{code} selected settlement does not join by exact ISO")
    timezone = row.get("cityTimezone", {}).get("ianaTimezone")
    try:
        ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, TypeError):
        raise ValueError(f"{code} has no usable pinned IANA timezone")
    airport = row.get("airportCandidate")
    if not isinstance(airport, dict) or airport.get("isoCountry") != code or not airport.get("name") or not airport.get("sourceRecordUrl"):
        raise ValueError(f"{code} has no exact-ISO airport dataset point")
    if not valid_point(airport.get("coordinatesWgs84")):
        raise ValueError(f"{code} airport dataset point has invalid WGS84 coordinates")
    point_path = place.get("pointAssetPath")
    point_hash = place.get("pointAssetSha256")
    if not point_path or not point_hash:
        raise ValueError(f"{code} selected settlement point lacks a pinned source asset")
    point = ROOT / point_path
    if verify_cached_sources and (not point.is_file() or sha(point) != point_hash):
        raise ValueError(f"{code} selected settlement source is missing or changed: {point_path}")
    return place, timezone, airport


def valid_point(value):
    return isinstance(value, list) and len(value) == 2 and all(isinstance(n, (int, float)) and not isinstance(n, bool) and math.isfinite(n) for n in value) and -180 <= value[0] <= 180 and -90 <= value[1] <= 90


def verify_assets(receipt, row, place, airport, identifier, inventory_hash):
    if receipt.get("countryIso2") != row["iso2"] or receipt.get("cityId") != identifier:
        raise ValueError(f"Receipt identity mismatch: {identifier}")
    if (receipt.get("inventorySha256") != inventory_hash or receipt.get("selectedPlace") != place
            or receipt.get("airportCandidate") != airport or receipt.get("sources", {}).get("naturalEarth") != row["admin0Geometry"]):
        raise ValueError(f"Receipt source identity changed: {identifier}")
    expected_names = {"facts.ts", "geometry.ts", "index.ts", "content.ts", "map.ts"}
    if set(receipt.get("assets", {})) != expected_names:
        raise ValueError(f"Receipt asset list mismatch: {identifier}")
    for name, expected in receipt["assets"].items():
        path = OUTPUT / identifier / name
        if not path.is_file() or path.stat().st_size != expected["bytes"] or sha(path) != expected["sha256"]:
            raise ValueError(f"Generated asset changed: {identifier}/{name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--country", action="append", required=True, metavar="ISO2", help="Explicit country selection; repeat to select multiple")
    parser.add_argument("--acquire", action="store_true", help="Allow one bounded source request for selected cities with no cached sample")
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--check", action="store_true", help="Offline verify assets and local source caches against receipts")
    modes.add_argument("--check-assets", action="store_true", help="Offline verify tracked assets and receipt identities without local source caches")
    modes.add_argument("--plan", action="store_true", help="Print a read-only generation plan without requests or writes")
    args = parser.parse_args()
    selected = [code.upper() for code in args.country]
    if any(not re.fullmatch(r"[A-Z]{2}", code) for code in selected) or len(set(selected)) != len(selected):
        raise ValueError("Use distinct two-letter ISO codes")
    if args.acquire and (args.check or args.check_assets or args.plan):
        parser.error("--acquire cannot be combined with --check, --check-assets, or --plan")
    data = inventory(verify_cached_sources=not (args.plan or args.check_assets))
    by_iso = {row["iso2"]: row for row in data["countries"]}
    for code in selected:
        if code == "NG":
            raise ValueError("Nigeria is excluded from starter generation")
        if code in EARLY:
            raise ValueError(f"{code} belongs to an existing release wave")
        if code not in by_iso:
            raise ValueError(f"No exact ISO country row for {code}")
    rows = [by_iso[code] for code in selected]
    if args.plan:
        for row in rows:
            try:
                place, timezone, airport = validate_row(row, verify_cached_sources=False)
                identifier = city_id(place["name"])
                size = catalogue_bytes(identifier, place["name"], row["iso2"], row["country"], place["coordinatesWgs84"])
                cache_dir = ROOT / ".cache/world-build/playable-africa" / identifier
                raw_path, source_receipt = cache_dir / "source.osm", cache_dir / "source.json"
                malformed_cache = raw_path.exists() != source_receipt.exists()
                cache = raw_path.is_file() and source_receipt.is_file()
                centre = place["coordinatesWgs84"]
                bounds = [round(centre[0]-.003, 6), round(centre[1]-.003, 6), round(centre[0]+.003, 6), round(centre[1]+.003, 6)]
                url = "https://api.openstreetmap.org/api/0.6/map?bbox=" + ",".join(map(str, bounds))
                ledger_path = cache_dir / "requests.json"
                ledger = json.loads(ledger_path.read_text()) if ledger_path.is_file() else []
                exhausted = any(entry.get("url") == url for entry in ledger) or len(ledger) >= 2
                status = "ready" if size <= 150 else "refused-catalogue-cap"
                if size > 150:
                    status = "refused-catalogue-cap"
                elif malformed_cache:
                    status = "refused-malformed-cache"
                elif not cache and exhausted:
                    status = "refused-request-budget-exhausted"
                print(json.dumps({"country": row["iso2"], "city": identifier, "settlement": place["name"], "settlementRole": place.get("sourceClass"), "timezone": timezone, "airportDatasetName": airport["name"], "airportDatasetPoint": airport["coordinatesWgs84"], "airportEvidence": airport.get("coordinateEvidence"), "catalogueBytes": size, "catalogueLimit": 150, "cachedSample": cache, "wouldRequest": size <= 150 and not cache and not exhausted and not malformed_cache, "status": status}))
            except (KeyError, TypeError, ValueError) as error:
                print(json.dumps({"country": row.get("iso2"), "status": "refused", "reason": str(error)}))
        return
    validated = [validate_row(row, verify_cached_sources=not args.check_assets) for row in rows]
    identifiers = [city_id(item[0]["name"]) for item in validated]
    if len(set(identifiers)) != len(identifiers):
        raise ValueError("Selected city names produce colliding city ids")
    if args.check or args.check_assets:
        inventory_hash = sha(DATA / "inventory.json")
        for row, (place, timezone, airport), identifier in zip(rows, validated, identifiers):
            receipt_path = RECEIPTS / f"{identifier}.json"
            if not receipt_path.is_file():
                raise ValueError(f"Missing starter receipt: {receipt_path}")
            receipt = json.loads(receipt_path.read_text())
            verify_assets(receipt, row, place, airport, identifier, inventory_hash)
            if args.check_assets:
                print(json.dumps({"country": row["iso2"], "city": identifier, "status": "pinned-assets-match"}))
                continue
            osm = receipt["sources"]["osm"]
            cached_osm = ROOT / ".cache/world-build/playable-africa" / identifier / "source.osm"
            if not cached_osm.is_file() or sha(cached_osm) != osm["sha256"]:
                raise ValueError(f"Pinned OSM source missing or changed: {identifier}")
            for part in receipt["sources"]["naturalEarth"]["outlineParts"]:
                pinned(ROOT / part["path"], part["sha256"])
            print(json.dumps({"country": row["iso2"], "city": identifier, "status": "pinned-assets-match"}))
        return

    RECEIPTS.mkdir(parents=True, exist_ok=True)
    inventory_hash = sha(DATA / "inventory.json")
    for row, (place, timezone, airport_source), identifier in zip(rows, validated, identifiers):
        code = row["iso2"]
        if city_id(place["name"]) != identifier:
            raise ValueError(f"Unstable city id for {code}")
        out = OUTPUT / identifier
        receipt_path = RECEIPTS / f"{identifier}.json"
        if out.exists():
            if not receipt_path.is_file():
                raise ValueError(f"Refusing existing city directory without this generator's receipt: {out}")
            old = json.loads(receipt_path.read_text())
            if old.get("countryIso2") != code or old.get("cityId") != identifier:
                raise ValueError(f"Existing receipt belongs to another country: {receipt_path}")
            for filename, expected in old["assets"].items():
                target = out / filename
                if not target.is_file() or target.stat().st_size != expected["bytes"] or sha(target) != expected["sha256"]:
                    raise ValueError(f"Refusing to overwrite modified prior output: {target}")
        if catalogue_bytes(identifier, place["name"], code, row["country"], place["coordinatesWgs84"]) > 150:
            raise ValueError(f"{identifier} exceeds the 150-byte catalogue row plus loader limit")
        centre = place["coordinatesWgs84"]
        alon, alat = airport_source["coordinatesWgs84"]
        bounds = [round(min(centre[0]-.015, alon-.012), 6), round(min(centre[1]-.015, alat-.012), 6), round(max(centre[0]+.015, alon+.012), 6), round(max(centre[1]+.015, alat+.012), 6)]
        land = []
        for part in row["admin0Geometry"]["outlineParts"]:
            geometry = pinned(ROOT / part["path"], part["sha256"])
            for polygon in geometry["coordinates"]:
                outer = clip_ring(polygon[0], bounds)
                if outer:
                    land.append([outer] + [clipped for ring in polygon[1:] if (clipped := clip_ring(ring, bounds))])
        if not land:
            raise ValueError(f"No clipped land polygons for {code}")
        raw_path = ROOT / ".cache/world-build/playable-africa" / identifier / "source.osm"
        if not raw_path.exists() and not args.acquire:
            raise ValueError(f"Missing bounded OSM sample for {identifier}; pass --acquire")
        raw, source = acquire(identifier, centre)
        buildings, roads, counts = convert(raw, centre)
        if not buildings or not roads:
            raise ValueError(f"No usable buildings and roads in bounded source sample for {identifier}")
        facts = {"id": identifier, "name": place["name"], "country": {"idISOlower": code.lower(), "name": row["country"]},
                 "state": {"idunique": code.lower()+"-starter", "name": "Starter zone"}, "timezone": timezone,
                 "centre": {"lon": centre[0], "lat": centre[1]},
                 "airport": {"id": identifier+"-airport", "name": airport_source["name"], "lon": alon, "lat": alat, "sourceUrl": airport_source["sourceRecordUrl"]},
                 "sourceLabel": "Natural Earth, OpenStreetMap contributors and OurAirports dataset",
                 "sourceUrl": source["url"], "licence": "Natural Earth public domain; OpenStreetMap ODbL-1.0; OurAirports public-domain dataset",
                 "bounds": bounds, "coverageNote": "Starter visitor area. Selected settlement and airport dataset points, clipped country land and a bounded central street/building sample. The settlement point is not asserted to be a current capital. OurAirports coordinates are dataset points, not official ARPs or evidence of current operations or schedules. Visitor services and homes are fictional game content; building silhouettes are approximate and missing heights are estimates."}
        out.mkdir(parents=True, exist_ok=True)
        files = {
          "facts.ts": "// Generated by scripts/world/build-africa-starters.py\nimport type { DestinationFacts } from '../africa/types.ts'\nexport const FACTS = "+json.dumps(facts, ensure_ascii=False, indent=2)+" satisfies DestinationFacts\n",
          "geometry.ts": "// Generated bounded geographic data; load only with this city map.\nimport type { DestinationGeometry } from '../africa/map.ts'\nexport const GEOMETRY: DestinationGeometry = "+json.dumps({"land":land,"buildings":buildings,"roads":roads}, ensure_ascii=False, separators=(",",":"))+"\n",
          "index.ts": "import { createDestinationModule } from '../africa/module.ts'\nimport { FACTS } from './facts.ts'\nexport const city = createDestinationModule(FACTS, async () => (await import('#city-map/"+identifier+"')).CITY_MAP, async () => (await import('./content.ts')).CONTENT)\n",
          "content.ts": "import { buildDestinationContent } from '../africa/contentBuilder.ts'\nimport { FACTS } from './facts.ts'\nexport const CONTENT = buildDestinationContent(FACTS)\n",
          "map.ts": "import { createDestinationMap } from '../africa/map.ts'\nimport { FACTS } from './facts.ts'\nimport { GEOMETRY } from './geometry.ts'\nexport const CITY_MAP = createDestinationMap(FACTS, GEOMETRY, async () => (await import('./index.ts')).city)\n",
        }
        for name, text in files.items():
            (out / name).write_text(text)
        receipt = {"countryIso2": code, "cityId": identifier, "inventorySha256": inventory_hash, "selectedPlace": place, "airportCandidate": airport_source,
                   "airportDatasetCaveat": "Dataset point only; no current operating, schedule, or official ARP claim.", "bounds": bounds,
                   "sources": {"osm": source, "naturalEarth": row["admin0Geometry"]},
                   "kept": {"buildings": len(buildings), "roads": len(roads)}, "observed": counts,
                   "limits": {"downloadBytes": MAX_DOWNLOAD, "seconds": 45, "buildings": MAX_BUILDINGS, "roads": MAX_ROADS, "points": MAX_POINTS},
                   "assets": {name: {"sha256": sha(out/name), "bytes": (out/name).stat().st_size} for name in files}}
        dump(receipt_path, receipt)
        print(json.dumps({"country": code, "city": identifier, "status": "generated", "buildings": len(buildings), "roads": len(roads)}), flush=True)


if __name__ == "__main__":
    main()
