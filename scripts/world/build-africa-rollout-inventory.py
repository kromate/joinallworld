#!/usr/bin/env python3
"""Rebuild a source-only inventory of remaining Natural Earth African capitals.

Reads only pinned Natural Earth caches, existing outline-index outputs, a local
zone.tab, and one pinned OurAirports CSV supplied by the caller. It never gets
map samples, claims playability, or downloads sources. Airport points are
OurAirports coordinates, not official AIPs/ARPs.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import sys
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ROOT = Path(__file__).resolve().parents[2]
PLACES = ROOT / ".cache/world-build/settlement-source-cache/42132340ed32bed7cf7be4b52f15d451eb81f235ceea042871e3b10f0117fc99.geojson"
COUNTRIES = ROOT / ".cache/world-build/country-source-cache/e51c4d047ed2867b34faea4e17c102ead4f3fee558a84a942619ee2cb1abdceb.geojson"
OUTLINES = ROOT / ".cache/world-build/output/country-inventory/outline-index"
OUTLINE_PARTS = ROOT / ".cache/world-build/output/country-inventory"
POINTS = ROOT / ".cache/world-build/output/selected-places/points"
OUTPUT = ROOT / "world/playable-africa-rollout/inventory.json"
EXPECTED = {
    PLACES: (19359003, "9b8e3de09048ef00dfc70357dbb9fa324493f214b5e0ae4daf1aa79a8d10116b"),
    COUNTRIES: (13287234, "239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255"),
}
RELEASE = "ca96624a56bd078437bca8184e78163e5039ad19"
NEIGHBORHOOD_EXCLUDED_ISO2 = {
    "NG",  # Nigeria requested separately
    "CM", "TG", "GH", "KE", "DZ",  # frozen first wave
    "BJ", "CI", "SN", "ZA", "ET",  # frozen second wave
}
AIRPORT_COMMIT = "56abe495bb3afcf8b5d8f01feec0f46ba4fd753f"
AIRPORT_URL = f"https://raw.githubusercontent.com/davidmegginson/ourairports-data/{AIRPORT_COMMIT}/airports.csv"
AIRPORT_BYTES = 12743186
AIRPORT_SHA256 = "0673f846680d703dd4ff81b6c1f557ddf09eb73df164c3ea98623fdd72545333"
AIRPORT_BLOB_SHA1 = "6bcd9664541c67c40477750a9617940865c506a0"
UN_M49_URL = "https://unstats.un.org/unsd/methodology/m49/overview/"
UN_M49_AFRICA_OVERRIDES = {
    "MU": {"countryOrArea": "Mauritius", "m49Code": "480", "subregion": "Eastern Africa", "subregionCode": "014"},
    "SC": {"countryOrArea": "Seychelles", "m49Code": "690", "subregion": "Eastern Africa", "subregionCode": "014"},
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def check_pinned(path: Path) -> dict:
    expected_size, expected_hash = EXPECTED[path]
    actual_size = path.stat().st_size
    actual_hash = sha256(path)
    if actual_size != expected_size or actual_hash != expected_hash:
        raise ValueError(f"pinned source mismatch: {path}")
    return {"path": str(path.relative_to(ROOT)), "bytes": actual_size, "sha256": actual_hash}


def parse_geometry_bounds(geometry: dict) -> list[float]:
    xs: list[float] = []
    ys: list[float] = []
    def visit(value):
        if not isinstance(value, list):
            return
        if len(value) >= 2 and isinstance(value[0], (int, float)) and isinstance(value[1], (int, float)):
            xs.append(float(value[0])); ys.append(float(value[1]))
        else:
            for child in value:
                visit(child)
    visit(geometry.get("coordinates", []))
    if not xs:
        return []
    return [min(xs), min(ys), max(xs), max(ys)]


def read_places_for_capitals(path: Path, target_countries: list[dict]) -> dict[str, dict]:
    # Parse one bounded source dataset at a time. Only retain one capital per ISO.
    data = json.loads(path.read_text(encoding="utf-8"))
    wanted = {c.get("iso2"): c for c in target_countries}
    found: dict[str, dict] = {}
    for feature in data.get("features", []):
        p = feature.get("properties", {})
        iso = p.get("ISO_A2")
        country = wanted.get(iso)
        if not country or not (p.get("ADM0CAP") == 1 or p.get("FEATURECLA") == "Admin-0 capital"):
            continue
        # ISO_A2 is the requested country identity for capital selection.
        # A Natural Earth ADM0_A3 disagreement remains visible as a review gap.
        place = {
            "name": p.get("NAME"),
            "naturalEarthPlaceId": f"place:natural-earth:NE_ID%3A{p.get('NE_ID')}",
            "coordinatesWgs84": feature.get("geometry", {}).get("coordinates"),
            "sourceClass": p.get("FEATURECLA"),
            "scaleRank": p.get("SCALERANK"),
            "iso2": iso,
            "admin0A3": p.get("ADM0_A3"),
            "admin0A3MatchesAdmin0Country": p.get("ADM0_A3") == country.get("admin0A3"),
            "admin0NameFromPlaceRecord": p.get("ADM0NAME"),
            "timezoneFromPlaceRecord": p.get("TIMEZONE"),
            "capitalClassificationMayBeStale": True,
        }
        current = found.get(iso)
        place_rank = place["scaleRank"] if place["scaleRank"] is not None else 99
        current_rank = current["scaleRank"] if current and current["scaleRank"] is not None else 99
        if current is None or place_rank < current_rank:
            found[iso] = place
    del data
    return found


def find_asset_with_row(directory: Path, row_id: str) -> tuple[Path, dict] | tuple[None, None]:
    if not directory.exists():
        return None, None
    for path in sorted(directory.glob("*.json")):
        try:
            obj = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(obj, dict) and any(r.get("id") == row_id for r in obj.get("rows", []) if isinstance(r, dict)):
            return path, obj
    return None, None


def zone_tab_entries(path: Path) -> dict[str, list[tuple[float, float, str]]]:
    entries: dict[str, list[tuple[float, float, str]]] = {}
    coord_re = re.compile(r"^([+-])(\d{2})(\d{2})(\d{2})?([+-])(\d{3})(\d{2})(\d{2})?$")
    def dms(sign, degree, minute, second):
        val = int(degree) + int(minute) / 60 + int(second or 0) / 3600
        return val if sign == "+" else -val
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        m = coord_re.match(parts[1])
        if not m:
            continue
        lat = dms(m.group(1), m.group(2), m.group(3), m.group(4))
        lon = dms(m.group(5), m.group(6), m.group(7), m.group(8))
        for iso in parts[0].split(","):
            entries.setdefault(iso, []).append((lat, lon, parts[2]))
    return entries


def nearest_timezone(city: dict | None, iso: str, entries: dict) -> dict:
    candidates = entries.get(iso, [])
    if city is None or not city.get("coordinatesWgs84") or not candidates:
        return {"ianaTimezone": None, "status": "gap", "source": "system zone.tab"}
    lon, lat = city["coordinatesWgs84"][:2]
    def dist(row):
        lat2, lon2, _ = row
        a1, a2 = math.radians(lat), math.radians(lat2)
        dlat, dlon = math.radians(lat2 - lat), math.radians(lon2 - lon)
        q = math.sin(dlat / 2) ** 2 + math.cos(a1) * math.cos(a2) * math.sin(dlon / 2) ** 2
        return 6371.0088 * 2 * math.asin(min(1, math.sqrt(q)))
    chosen = min(candidates, key=dist)
    try:
        ZoneInfo(chosen[2])
    except ZoneInfoNotFoundError:
        return {"ianaTimezone": None, "status": "gap_invalid_zoneinfo", "source": "system zone.tab"}
    return {"ianaTimezone": chosen[2], "status": "nearest zone.tab coordinate in matching ISO country", "nearestZoneTabPointDistanceKm": round(dist(chosen), 1), "source": "system zone.tab"}


def read_airports(path: Path) -> dict[str, list[dict]]:
    expected_size = AIRPORT_BYTES
    actual_size = path.stat().st_size
    actual_hash = sha256(path)
    if actual_size != expected_size or actual_hash != AIRPORT_SHA256:
        raise ValueError(f"airport CSV does not match pinned snapshot: bytes={actual_size}, sha256={actual_hash}")
    by_iso: dict[str, list[dict]] = {}
    with path.open("r", encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            if row.get("type") not in ("medium_airport", "large_airport") or row.get("scheduled_service", "").strip().lower() not in ("yes", "true", "1"):
                continue
            iso = row.get("iso_country", "").strip().upper()
            try:
                lon, lat = float(row["longitude_deg"]), float(row["latitude_deg"])
            except (KeyError, ValueError, TypeError):
                continue
            if len(iso) != 2 or not math.isfinite(lon) or not math.isfinite(lat) or not (-180 <= lon <= 180 and -90 <= lat <= 90):
                continue
            by_iso.setdefault(iso, []).append({
                "id": row.get("id"), "name": row.get("name"),
                "type": row.get("type"), "scheduledService": True,
                "isoCountry": iso, "isoRegion": row.get("iso_region"),
                "iata": row.get("iata_code") or None, "icao": row.get("gps_code") or row.get("ident") or None,
                "coordinatesWgs84": [lon, lat],
                "sourceRecordUrl": f"https://ourairports.com/airports/{row.get('ident')}/" if row.get("ident") else None,
            })
    return by_iso


def haversine_km(a: list[float], b: list[float]) -> float:
    lon1, lat1 = a[:2]; lon2, lat2 = b[:2]
    lat1, lat2 = math.radians(lat1), math.radians(lat2)
    dlat, dlon = lat2 - lat1, math.radians(lon2 - lon1)
    v = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371.0088 * 2 * math.asin(min(1, math.sqrt(v)))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--airport-csv", type=Path, default=ROOT / ".cache/world-build/airport-source-cache/0673f846680d703dd4ff81b6c1f557ddf09eb73df164c3ea98623fdd72545333.csv", help="already-fetched pinned CSV; this script never downloads")
    parser.add_argument("--zone-tab", type=Path, default=ROOT / ".cache/world-build/timezone-source-cache/4d8e389e5f4b0ec0466d5b14f42e5dfb0308c4376165fcf478339afd9ddcb00c.tab")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()

    for path in EXPECTED:
        if not path.is_file():
            raise SystemExit(f"required pinned cache missing: {path}")
    source_checks = [check_pinned(p) for p in EXPECTED]

    country_data = json.loads(COUNTRIES.read_text(encoding="utf-8"))
    admin0 = [
        f for f in country_data.get("features", [])
        if f.get("properties", {}).get("CONTINENT") == "Africa"
        or f.get("properties", {}).get("ISO_A2") in UN_M49_AFRICA_OVERRIDES
    ]
    all_sov = [f for f in admin0 if f.get("properties", {}).get("TYPE") == "Sovereign country" and re.fullmatch(r"[A-Z]{2}", str(f.get("properties", {}).get("ISO_A2", "")))]
    excluded = {f.get("properties", {}).get("ISO_A2") for f in all_sov} & NEIGHBORHOOD_EXCLUDED_ISO2
    candidates = [f for f in all_sov if f.get("properties", {}).get("ISO_A2") not in NEIGHBORHOOD_EXCLUDED_ISO2]
    unresolved = [f for f in admin0 if f.get("properties", {}).get("TYPE") == "Indeterminate" or not re.fullmatch(r"[A-Z]{2}", str(f.get("properties", {}).get("ISO_A2", "")))]
    territory_records = [f for f in admin0 if f.get("properties", {}).get("TYPE") != "Sovereign country" and f not in unresolved]
    # Retain only small country metadata, then release the large admin0 source.
    admin_rows = []
    for feature in candidates:
        p = feature.get("properties", {})
        iso = p.get("ISO_A2")
        un_override = UN_M49_AFRICA_OVERRIDES.get(iso)
        region_membership = ({
            "region": "Africa",
            "classification": "UN M49 region override",
            "subregion": un_override["subregion"],
            "subregionCode": un_override["subregionCode"],
            "m49Code": un_override["m49Code"],
            "sourceUrl": UN_M49_URL,
            "evidence": f"UNSD M49 overview lists {un_override['countryOrArea']} ({iso}) under Africa / Eastern Africa; Natural Earth CONTINENT is preserved separately and not rewritten.",
            "overridesNaturalEarthContinentForRolloutScopeOnly": True,
        } if un_override else {
            "region": "Africa",
            "classification": "Natural Earth admin0 CONTINENT",
            "sourceRelease": RELEASE,
            "sourceValue": p.get("CONTINENT"),
            "overridesNaturalEarthContinentForRolloutScopeOnly": False,
        })
        admin_rows.append({"iso2": iso, "admin0A3": p.get("ADM0_A3"), "name": p.get("ADMIN"), "sovereignName": p.get("SOVEREIGNT"), "type": p.get("TYPE"), "iso2Eh": p.get("ISO_A2_EH"), "naturalEarthContinentOriginal": p.get("CONTINENT"), "regionMembership": region_membership, "neId": p.get("NE_ID"), "bounds": parse_geometry_bounds(feature.get("geometry", {})), "geometryType": feature.get("geometry", {}).get("type")})
    unresolved_records = [{"name": f.get("properties", {}).get("ADMIN"), "iso2": f.get("properties", {}).get("ISO_A2"), "iso2Eh": f.get("properties", {}).get("ISO_A2_EH"), "type": f.get("properties", {}).get("TYPE"), "sovereignName": f.get("properties", {}).get("SOVEREIGNT"), "gap": "Natural Earth indeterminate or no usable ISO_A2; not aliased to another country"} for f in unresolved]
    territory_records = [{"name": f.get("properties", {}).get("ADMIN"), "iso2": f.get("properties", {}).get("ISO_A2"), "type": f.get("properties", {}).get("TYPE"), "sovereignName": f.get("properties", {}).get("SOVEREIGNT"), "gap": "non-sovereign African Admin-0 feature excluded from sovereign-country candidate list"} for f in territory_records]
    del country_data, admin0, all_sov, candidates

    place_by_iso = read_places_for_capitals(PLACES, admin_rows)
    zones_path = args.zone_tab
    zones = zone_tab_entries(zones_path) if zones_path.is_file() else {}
    zones_meta = {"path": str(zones_path.relative_to(ROOT)) if zones_path.is_relative_to(ROOT) else str(zones_path), "sha256": sha256(zones_path), "bytes": zones_path.stat().st_size} if zones_path.is_file() else {"path": str(zones_path), "available": False}
    airports = read_airports(args.airport_csv)

    result_rows = []
    iso_by_a3 = {row["admin0A3"]: row["iso2"] for row in admin_rows}
    outline_indices = {}
    for path in sorted(OUTLINES.glob("*.json")) if OUTLINES.exists() else []:
        d = json.loads(path.read_text(encoding="utf-8"))
        outline_indices[d.get("countryId")] = (path, d)
    for country in admin_rows:
        iso = country["iso2"]
        city = place_by_iso.get(iso)
        cid = f"country:natural-earth:NE_ID%3A{country['neId']}"
        city = dict(city) if city else None
        if city:
            point_path, point_obj = find_asset_with_row(POINTS, city["naturalEarthPlaceId"])
            if point_path:
                city.update({"pointAssetPath": str(point_path.relative_to(ROOT)), "pointAssetSha256": sha256(point_path), "countryEmittedPlaceCount": point_obj.get("emittedUnits")})
            else:
                city["pointAssetPath"] = None
                city["pointAssetStatus"] = "not found in existing selected-place output; coordinates retained from pinned source only"
        tz = nearest_timezone(city, iso, zones)
        city_timezone = tz["ianaTimezone"]
        airport_options = airports.get(iso, [])
        airport = None
        if city and city.get("coordinatesWgs84") and airport_options:
            airport = min(airport_options, key=lambda item: haversine_km(city["coordinatesWgs84"], item["coordinatesWgs84"]))
            airport = dict(airport)
            airport["distanceFromChosenCityKm"] = round(haversine_km(city["coordinatesWgs84"], airport["coordinatesWgs84"]), 1)
            airport["selection"] = "nearest same-ISO airport where OurAirports type is medium_airport or large_airport and scheduled_service=yes"
            airport["coordinateEvidence"] = "OurAirports published airport point, not an aviation-authority ARP; not independently verified as runway/terminal/official reference point"
        outline = outline_indices.get(cid)
        outline_data = None
        if outline:
            path, obj = outline
            parts = []
            for part in obj.get("parts", []):
                part_path = OUTLINE_PARTS / part["path"]
                parts.append({"path": str(part_path.relative_to(ROOT)), "sha256": sha256(part_path), "bytes": part_path.stat().st_size, "polygonCount": part.get("polygonCount"), "coordinatePositions": part.get("coordinatePositions")})
            outline_data = {"source": f"Natural Earth admin0 10m, public domain, release {RELEASE}", "sourceFeatureRef": f"natural-earth-admin0-10m-{RELEASE}:NE_ID:{country['neId']}", "outlineIndexPath": str(path.relative_to(ROOT)), "outlineIndexSha256": sha256(path), "geometryType": obj.get("geometryType"), "polygonCount": obj.get("polygonCount"), "coordinatePositions": obj.get("coordinatePositions"), "outlineParts": parts}
        mismatch = country["iso2Eh"] not in (None, "", country["iso2"])
        place_admin_mismatch = bool(city and not city.get("admin0A3MatchesAdmin0Country"))
        result_rows.append({
            "country": country["name"], "iso2": iso, "admin0A3": country["admin0A3"], "countryId": cid,
            "naturalEarthContinentOriginal": country["naturalEarthContinentOriginal"], "regionMembership": country["regionMembership"],
            "naturalEarthType": country["type"], "iso2Eh": country["iso2Eh"], "isoIdentityStatus": "mismatch_requires_review" if mismatch else "Natural Earth ISO_A2 and ISO_A2_EH agree",
            "countryBoundsWgs84": country["bounds"], "admin0Geometry": outline_data,
            "chosenCity": city, "cityTimezone": tz,
            "staleSourceCaveat": "Natural Earth place/capital class and city coordinates reflect pinned release ca96624a; source classification is not current official designation and must be verified before a city contract.",
            "airportCandidate": airport,
            "gaps": (["no Natural Earth admin-0 capital place joined by ISO_A2"] if city is None else (["no selected-place output asset for this city point"] if not city.get("pointAssetPath") else [])) + (["no exact-ISO OurAirports medium/large airport row with scheduled_service=yes"] if airport is None else []) + (["Natural Earth ISO_A2 differs from ISO_A2_EH"] if mismatch else []) + (["chosen place ADM0_A3 differs from country ADM0_A3 despite exact ISO_A2 match; verify join before contract"] if place_admin_mismatch else []) + (["country outline output metadata unavailable in local cache"] if outline_data is None else []) + (["IANA zone.tab lookup unavailable or no matching country row"] if city_timezone is None else []),
        })

    # Explicitly expose ISO mismatches between Natural Earth sovereign units and
    # airport data: never broaden or replace country identifiers.
    airport_iso = set(airports)
    for row in result_rows:
        row["airportCountryIsoMatched"] = row["iso2"] in airport_iso

    source_files = [
        {"label": "Natural Earth 10m populated places", "sourceId": f"natural-earth-places-10m-{RELEASE}", "path": str(PLACES.relative_to(ROOT)), "url": f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{RELEASE}/geojson/ne_10m_populated_places.geojson", "release": RELEASE, "license": "Public-domain", **source_checks[0]},
        {"label": "Natural Earth 10m admin0 countries", "sourceId": f"natural-earth-admin0-10m-{RELEASE}", "path": str(COUNTRIES.relative_to(ROOT)), "url": f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{RELEASE}/geojson/ne_10m_admin_0_countries.geojson", "release": RELEASE, "license": "Public-domain", **source_checks[1]},
        {"label": "OurAirports airports.csv", "sourceId": f"ourairports-airports-{AIRPORT_COMMIT}", "sourceUrl": AIRPORT_URL, "repository": "https://github.com/davidmegginson/ourairports-data", "pinnedCommit": AIRPORT_COMMIT, "filePath": "airports.csv", "bytes": AIRPORT_BYTES, "sha256": AIRPORT_SHA256, "gitBlobSha1": AIRPORT_BLOB_SHA1, "license": "Public domain (OurAirports data terms); repository license is Unlicense", "licenseUrl": "https://ourairports.com/data/", "localCachePath": str(args.airport_csv.relative_to(ROOT)) if args.airport_csv.is_relative_to(ROOT) else str(args.airport_csv)},
        {"label": "IANA tz database zone.tab from local host", **zones_meta},
        {"label": "UNSD Standard Country or Area Codes for Statistical Use (M49) overview", "sourceUrl": UN_M49_URL, "primaryPublisher": "United Nations Statistics Division", "usedFor": "African regional-membership overrides only for Mauritius (MU, M49 480) and Seychelles (SC, M49 690)", "sourceHash": None, "sourceHashStatus": "not captured; source consulted as a live primary HTML page"},
    ]
    excluded_records = [{"iso2": iso, "reason": "explicitly excluded from this remaining-Africa batch (Nigeria or frozen wave one/two)"} for iso in sorted(NEIGHBORHOOD_EXCLUDED_ISO2)]
    result = {
        "schemaVersion": 1,
        "purpose": "Source-only candidate inventory for remaining African sovereign countries; candidates for future city-specific data contracts, not playability or live-state claims.",
        "generatedBy": "scripts/world/build-africa-rollout-inventory.py",
        "airportSelectionPolicy": "For each candidate Natural Earth Admin-0 capital, choose the nearest great-circle OurAirports point whose exact iso_country matches the country and whose type is medium_airport or large_airport and scheduled_service=yes. This is a dataset candidate only; it does not assert current operations, airline routes, official ARP, or airport playable geometry.",
        "timezoneSelectionPolicy": "Use local IANA tz database zone.tab; among entries tagged with exact country ISO, choose the nearest listed coordinate to the chosen Natural Earth city. If no valid entry exists, retain null and explicit gap.",
        "scopeExclusions": excluded_records,
        "candidateCountryCount": len(result_rows),
        "isoMismatchCandidateCount": sum(r["isoIdentityStatus"] == "mismatch_requires_review" for r in result_rows),
        "missingCityCount": sum(r["chosenCity"] is None for r in result_rows),
        "missingAirportCandidateCount": sum(r["airportCandidate"] is None for r in result_rows),
        "sourceFiles": source_files,
        "countries": result_rows,
        "unresolvedOrNoIsoAdmin0Records": unresolved_records,
        "nonSovereignAfricanAdmin0RecordsExcluded": territory_records,
        "notes": [
            "Mauritius (MU) and Seychelles (SC) are included using UN M49 membership under Africa / Eastern Africa (M49 country codes 480 and 690). Their original Natural Earth CONTINENT value, Seven seas (open ocean), remains visible on each row; this is a rollout-scope override only, not a geography rewrite.",
            "Natural Earth TYPE=Sovereign country and its own ISO_A2 define candidate country rows. Features with no usable ISO and other African territory/dependency rows are listed separately; no territory is silently merged into a neighboring state.",
            "Natural Earth capital labels may be stale or incomplete (for example countries with multiple capital functions); verify each city’s current role before authoring a city contract.",
            "A matching OurAirports airport row only means the pinned dataset labels a same-country medium/large airport as scheduled-service. It does not prove actual current routes, operations, status, or that the point is an official airport reference point.",
            "No country is marked green, live, citywide complete, or playable by this inventory. It contains no newly acquired map data or map coverage samples."
        ]
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {args.output}: {len(result_rows)} sovereign-country candidates; {result['missingCityCount']} missing cities; {result['missingAirportCandidateCount']} missing airport candidates; {len(unresolved_records)} indeterminate/no-ISO admin0 gaps; {len(territory_records)} non-sovereign African admin0 records excluded")
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1)
