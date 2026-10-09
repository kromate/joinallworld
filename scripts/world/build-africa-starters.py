#!/usr/bin/env python3
"""Generate selected, bounded African starter-city source assets serially."""
import argparse
import copy
import errno
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import stat
import unicodedata
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "world/playable-africa-rollout"
OUTPUT = ROOT / "src/game/cities"
RECEIPTS = DATA / "receipts"
EARLY = {"NG", "CM", "TG", "GH", "KE", "DZ", "BJ", "CI", "SN", "ZA", "ET"}
COMPACT_IDENTITIES = {
    "TZ": ("dar", "tz-zone", "Starter"), "CG": ("brazz", "cg-zone", "Starter"), "CD": ("kin", "cd-zone", "Starter"),
    "CF": (None, "cf-zone", "Starter"), "BF": (None, "bf-zone", "Starter"),
    "MG": (None, "mg-zone", "Starter"), "ST": (None, "st-zone", "Starter"),
}
_spec = importlib.util.spec_from_file_location("starter_geography", Path(__file__).with_name("build-playable-africa.py"))
if _spec is None or _spec.loader is None:
    raise RuntimeError("The accepted bounded geography converter is missing")
_starter = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_starter)
dump, pinned, clip_ring, acquire, convert = (_starter.dump, _starter.pinned, _starter.clip_ring, _starter.acquire, _starter.convert)
MAX_DOWNLOAD, MAX_BUILDINGS, MAX_ROADS, MAX_POINTS = (_starter.MAX_DOWNLOAD, _starter.MAX_BUILDINGS, _starter.MAX_ROADS, _starter.MAX_POINTS)
MAX_SELECTION_BYTES = 256 * 1024
MAX_POINT_BYTES = 16 * 1024
MAX_LEDGER_BYTES = 64 * 1024
SELECTION_GAP_ASSET = "no selected-place output asset for this city point"
SELECTION_GAP_A3 = "chosen place ADM0_A3 differs from country ADM0_A3 despite exact ISO_A2 match; verify join before contract"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_regular_bounded(path, limit, label):
    if not hasattr(os, "O_NOFOLLOW"):
        raise ValueError("Selection inputs require no-follow file support")
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0))
    except OSError as error:
        if error.errno in (errno.ELOOP, errno.ENXIO):
            raise ValueError(f"{label} must be a regular non-symlink file: {path}") from error
        raise ValueError(f"Cannot safely open {label}: {path}: {error}") from error
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError(f"{label} must be a regular file: {path}")
        if metadata.st_size > limit:
            raise ValueError(f"{label} exceeds {limit}-byte limit: {path}")
        chunks = []
        total = 0
        while True:
            chunk = os.read(descriptor, min(65536, limit + 1 - total))
            if not chunk:
                break
            total += len(chunk)
            if total > limit:
                raise ValueError(f"{label} exceeds {limit}-byte limit: {path}")
            chunks.append(chunk)
        return b"".join(chunks)
    finally:
        os.close(descriptor)


def read_beneath(root, relative, limit, label):
    if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_DIRECTORY"):
        raise ValueError("Selection inputs require no-follow directory support")
    parts = Path(relative).parts
    if not parts or Path(relative).is_absolute() or any(part in ("", ".", "..") for part in parts):
        raise ValueError(f"Invalid repository-relative {label} path")
    try:
        directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError as error:
        raise ValueError(f"Cannot safely open {label} root: {error}") from error
    try:
        for part in parts[:-1]:
            try:
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            except OSError as error:
                raise ValueError(f"Cannot safely open {label} directory: {error}") from error
            os.close(directory)
            directory = child
        try:
            descriptor = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0), dir_fd=directory)
        except OSError as error:
            raise ValueError(f"Cannot safely open {label}: {error}") from error
        try:
            metadata = os.fstat(descriptor)
            if not stat.S_ISREG(metadata.st_mode):
                raise ValueError(f"{label} must be a regular file")
            if metadata.st_size > limit:
                raise ValueError(f"{label} exceeds {limit}-byte limit")
            chunks, total = [], 0
            while True:
                chunk = os.read(descriptor, min(65536, limit + 1 - total))
                if not chunk:
                    break
                total += len(chunk)
                if total > limit:
                    raise ValueError(f"{label} exceeds {limit}-byte limit")
                chunks.append(chunk)
            return b"".join(chunks)
        finally:
            os.close(descriptor)
    finally:
        os.close(directory)


def resolve_juba_selection(row, packet_path, expected_hash, *, root=ROOT, inventory_raw=None):
    if row.get("iso2") != "SS":
        raise ValueError("Juba selection packets are accepted only for SS")
    if not isinstance(expected_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_hash):
        raise ValueError("--juba-selection-sha256 must be 64 lowercase hexadecimal characters")
    root = Path(root).absolute()
    packet_file = Path(packet_path)
    packet_file = packet_file if packet_file.is_absolute() else root / packet_file
    packet_file = Path(os.path.abspath(packet_file))
    try:
        packet_relative = packet_file.relative_to(root).as_posix()
    except ValueError as error:
        raise ValueError("Juba selection packet must be inside the repository root") from error
    packet_raw = read_beneath(root, packet_relative, MAX_SELECTION_BYTES, "Juba selection packet")
    packet_hash = hashlib.sha256(packet_raw).hexdigest()
    if packet_hash != expected_hash:
        raise ValueError("Juba selection packet SHA256 mismatch")
    try:
        packet = json.loads(packet_raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("Juba selection packet is not valid JSON") from error
    if not isinstance(packet, dict) or packet.get("schemaVersion") != 1 or packet.get("packetKind") != "versioned-natural-earth-city-point-source-packet":
        raise ValueError("Unsupported Juba selection packet schema or kind")
    if packet.get("scope") != "Source point and selection evidence only; no runtime admission, city geometry acquisition, or city-completeness assertion.":
        raise ValueError("Juba selection packet scope mismatch")
    if inventory_raw is None:
        inventory_raw = read_beneath(root, "world/playable-africa-rollout/inventory.json", MAX_SELECTION_BYTES, "rollout inventory")
    inventory_hash = hashlib.sha256(inventory_raw).hexdigest()
    try:
        inventory_doc = json.loads(inventory_raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("Pinned rollout inventory is not valid JSON") from error
    if not isinstance(inventory_doc, dict):
        raise ValueError("Pinned rollout inventory must be an object")
    inventory_rows = inventory_doc.get("countries")
    inventory_row = next((item for item in inventory_rows if isinstance(item, dict) and item.get("iso2") == "SS"), None) if isinstance(inventory_rows, list) else None
    if inventory_row != row:
        raise ValueError("Juba selection row is not the exact row in the pinned inventory")
    inventory_pin = packet.get("inventory")
    if not isinstance(inventory_pin, dict) or inventory_pin.get("path") != "world/playable-africa-rollout/inventory.json" or inventory_pin.get("sha256") != inventory_hash or inventory_pin.get("bytes") != len(inventory_raw):
        raise ValueError("Juba packet does not bind the current rollout inventory")
    if inventory_pin.get("countryIso2") != "SS" or inventory_pin.get("countryId") != row.get("countryId"):
        raise ValueError("Juba packet inventory country identity mismatch")
    selection = packet.get("citySelection")
    identity = packet.get("identityEvidence")
    geometry = packet.get("geometryEvidence")
    output = packet.get("output")
    caveats = packet.get("caveats")
    if not all(isinstance(item, dict) for item in (selection, identity, geometry, output)) or not isinstance(caveats, list) or not caveats or not all(isinstance(item, str) and item.strip() for item in caveats):
        raise ValueError("Juba selection packet is missing identity, geometry, output or caveat evidence")
    if (selection.get("name") != "Juba" or selection.get("naturalEarthPlaceId") != row.get("chosenCity", {}).get("naturalEarthPlaceId")
            or selection.get("coordinatesWgs84") != row.get("chosenCity", {}).get("coordinatesWgs84") or selection.get("iso2JoinAccepted") is not True):
        raise ValueError("Juba selected place does not match the pinned inventory row")
    if (selection.get("countryId") != row.get("countryId") or selection.get("countryIsoA3") != "SSD"
            or selection.get("countryAdm0Iso") != "SSD" or selection.get("countrySovA3") != "SDS"
            or selection.get("placeSovA3") != "SSD" or selection.get("noThreeLetterCodeAlias") is not True):
        raise ValueError("Juba selection does not preserve the SSD/SDS identity discrepancy")
    if selection.get("admin0A3MismatchPreserved") != {"country": "SDS", "place": "SSD"}:
        raise ValueError("Juba selection packet omits the explicit SDS/SSD mismatch")
    if (identity.get("countryIso2") != "SS" or identity.get("countryIso2Eh") != "SS"
            or identity.get("countryId") != row.get("countryId") or identity.get("placeId") != selection.get("naturalEarthPlaceId")
            or identity.get("countryAdm0A3") != "SDS" or identity.get("placeAdm0A3") != "SSD"
            or identity.get("countrySovA3") != "SDS" or identity.get("placeSovA3") != "SSD"
            or identity.get("countryIsoA3") != "SSD" or identity.get("countryAdm0Iso") != "SSD"
            or identity.get("iso2JoinAccepted") is not True or identity.get("noThreeLetterAliasApplied") is not True
            or identity.get("threeLetterCodeDiscrepancyRetained") is not True):
        raise ValueError("Juba identity evidence is incomplete or applies an A3 alias")
    timezone = selection.get("selectedIanaTimezone")
    timezone_evidence = selection.get("timezoneSelectionEvidence")
    timezone_pin = next((source for source in inventory_doc.get("sourceFiles", []) if isinstance(source, dict) and source.get("label", "").startswith("IANA tz database zone.tab")), None)
    if (timezone != "Africa/Juba" or timezone != row.get("cityTimezone", {}).get("ianaTimezone")
            or not isinstance(timezone_evidence, dict) or timezone_evidence.get("source") != "system zone.tab"
            or timezone_evidence.get("status") != "nearest zone.tab coordinate in matching ISO country"
            or not isinstance(timezone_pin, dict) or timezone_evidence.get("zoneTabPath") != timezone_pin.get("path")
            or timezone_evidence.get("zoneTabSha256") != timezone_pin.get("sha256")):
        raise ValueError("Juba timezone evidence does not preserve the pinned zone.tab selection")
    if (len(caveats) != 4 or not any("adm0cap is 0" in item.lower() and "official capital" in item.lower() for item in caveats)
            or not any("SDS" in item and "SSD" in item for item in caveats)
            or not any("Africa/Khartoum" in item and "Africa/Juba" in item and "zone.tab" in item for item in caveats)
            or not any("only the city point" in item.lower() and "not emitted" in item.lower() for item in caveats)):
        raise ValueError("Juba packet must preserve all four source caveats")
    if (geometry.get("countryId") != row.get("countryId") or geometry.get("topologyValid") is not True
            or geometry.get("containmentAccepted") is not True or geometry.get("countryPolygonIsValidationInputOnly") is not True
            or geometry.get("sourceGeometryType") != row.get("admin0Geometry", {}).get("geometryType")
            or geometry.get("countryFeatureRef") != row.get("admin0Geometry", {}).get("sourceFeatureRef")
            or geometry.get("outlineOutputReference") not in row.get("admin0Geometry", {}).get("outlineParts", [])):
        raise ValueError("Juba source geometry evidence is invalid")
    if output.get("path") != "world/playable-africa-rollout/south-sudan/point.geojson" or output.get("geometryType") != "Point" or output.get("featureCount") != 1:
        raise ValueError("Juba point output reference is invalid")
    point_rel = output["path"]
    point_raw = read_beneath(root, point_rel, MAX_POINT_BYTES, "Juba point GeoJSON")
    point_hash = hashlib.sha256(point_raw).hexdigest()
    if len(point_raw) != output.get("bytes") or point_hash != output.get("sha256"):
        raise ValueError("Juba point GeoJSON pin mismatch")
    try:
        point_doc = json.loads(point_raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("Juba point GeoJSON is not valid JSON") from error
    features = point_doc.get("features") if isinstance(point_doc, dict) else None
    if not isinstance(point_doc, dict) or point_doc.get("type") != "FeatureCollection" or not isinstance(features, list) or len(features) != 1:
        raise ValueError("Juba point GeoJSON must contain exactly one feature")
    feature = features[0]
    props = feature.get("properties", {}) if isinstance(feature, dict) else {}
    feature_geometry = feature.get("geometry") if isinstance(feature, dict) else None
    if (not isinstance(feature, dict) or not isinstance(feature_geometry, dict) or not isinstance(props, dict)
            or feature.get("type") != "Feature" or feature.get("id") != selection.get("naturalEarthPlaceId")
            or feature_geometry.get("type") != "Point"
            or feature_geometry.get("coordinates") != selection.get("coordinatesWgs84")
            or props.get("name") != selection.get("name") or props.get("countryIso2") != "SS"
            or props.get("countryId") != row.get("countryId") or props.get("selectedIanaTimezone") != "Africa/Juba"
            or props.get("countryAdm0A3") != "SDS" or props.get("placeAdm0A3") != "SSD"
            or props.get("capitalDesignationClaimed") is not False
            or props.get("sourceClass") != row.get("chosenCity", {}).get("sourceClass")
            or props.get("sourceTimezone") != row.get("chosenCity", {}).get("timezoneFromPlaceRecord")):
        raise ValueError("Juba point GeoJSON feature does not match the accepted selection evidence")
    remaining = list(row.get("gaps", []))
    if SELECTION_GAP_ASSET not in remaining or SELECTION_GAP_A3 not in remaining:
        raise ValueError("Juba inventory does not contain the two expected source gaps")
    remaining.remove(SELECTION_GAP_ASSET)
    remaining.remove(SELECTION_GAP_A3)
    resolved = copy.deepcopy(row)
    resolved["chosenCity"]["pointAssetPath"] = output["path"]
    resolved["chosenCity"]["pointAssetSha256"] = point_hash
    resolved["chosenCity"]["pointAssetStatus"] = "pinned point accepted through explicit selection packet"
    resolved["gaps"] = remaining
    binding = {"packetPath": packet_relative, "packetSha256": packet_hash, "pointPath": output["path"],
               "pointSha256": point_hash, "caveats": caveats, "identityEvidence": identity,
               "geometryEvidence": geometry}
    return resolved, binding


def apply_optional_juba_selection(rows, packet_path=None, expected_hash=None, *, root=ROOT, inventory_raw=None):
    if (packet_path is None) != (expected_hash is None):
        raise ValueError("--juba-selection and --juba-selection-sha256 must be supplied together")
    if packet_path is None:
        return rows, {}
    if not any(row.get("iso2") == "SS" for row in rows):
        raise ValueError("Juba selection packet requires explicit --country SS")
    result, bindings = [], {}
    for row in rows:
        if row.get("iso2") == "SS":
            resolved, binding = resolve_juba_selection(row, packet_path, expected_hash, root=root, inventory_raw=inventory_raw)
            result.append(resolved)
            bindings["SS"] = binding
        else:
            result.append(row)
    return result, bindings


def source_request_state(cache_dir, centre):
    cache_dir = Path(cache_dir)
    raw_path, source_receipt = cache_dir / "source.osm", cache_dir / "source.json"
    malformed = raw_path.exists() != source_receipt.exists()
    cached = raw_path.is_file() and source_receipt.is_file()
    bounds = [round(centre[0]-.003, 6), round(centre[1]-.003, 6), round(centre[0]+.003, 6), round(centre[1]+.003, 6)]
    url = "https://api.openstreetmap.org/api/0.6/map?bbox=" + ",".join(map(str, bounds))
    ledger_path = cache_dir / "requests.json"
    ledger = json.loads(read_regular_bounded(ledger_path, MAX_LEDGER_BYTES, "request ledger")) if os.path.lexists(ledger_path) else []
    if not isinstance(ledger, list):
        raise ValueError("Request ledger must be a list")
    exhausted = any(isinstance(entry, dict) and entry.get("url") == url for entry in ledger) or len(ledger) >= 2
    return cached, malformed, exhausted


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


def generation_identity(row):
    code = row["iso2"]
    compact = COMPACT_IDENTITIES.get(code)
    identifier = (compact[0] or city_id(row["chosenCity"]["name"])) if compact else city_id(row["chosenCity"]["name"])
    return {"cityId": identifier, "stateId": compact[1] if compact else code.lower()+"-starter",
            "stateName": compact[2] if compact else "Starter zone"}


def catalogue_bytes(identifier, name, country_iso, country_name, centre, state_id, state_name):
    # Match scripts/city/build-catalogue.ts's exact generated row and loader serialization.
    quote = lambda value: json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    extra = f',{quote(country_iso.lower())},{quote(country_name)}'
    row = f'[{quote(identifier)},{quote(name)},{quote(state_id)},{quote(state_name)},{js_number(centre[0])},{js_number(centre[1])},1{extra}],'
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


def verify_assets(receipt, row, place, airport, identity, inventory_hash, output_root=OUTPUT):
    identifier = identity["cityId"]
    if receipt.get("countryIso2") != row["iso2"] or receipt.get("cityId") != identifier:
        raise ValueError(f"Receipt identity mismatch: {identifier}")
    if (receipt.get("inventorySha256") != inventory_hash or receipt.get("selectedPlace") != place
            or receipt.get("airportCandidate") != airport or receipt.get("sources", {}).get("naturalEarth") != row["admin0Geometry"]):
        raise ValueError(f"Receipt source identity changed: {identifier}")
    expected_selection = row.get("jubaSelectionBinding")
    if receipt.get("jubaSelection") != expected_selection:
        raise ValueError(f"Receipt Juba selection identity changed: {identifier}")
    recorded_identity = receipt.get("generationIdentity")
    if (row["iso2"] in COMPACT_IDENTITIES and recorded_identity != identity) or (recorded_identity is not None and recorded_identity != identity):
        raise ValueError(f"Receipt generation identity changed: {identifier}")
    expected_names = {"facts.ts", "geometry.ts", "index.ts", "content.ts", "map.ts"}
    if set(receipt.get("assets", {})) != expected_names:
        raise ValueError(f"Receipt asset list mismatch: {identifier}")
    for name, expected in receipt["assets"].items():
        path = output_root / identifier / name
        if not path.is_file() or path.stat().st_size != expected["bytes"] or sha(path) != expected["sha256"]:
            raise ValueError(f"Generated asset changed: {identifier}/{name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--country", action="append", required=True, metavar="ISO2", help="Explicit country selection; repeat to select multiple")
    parser.add_argument("--acquire", action="store_true", help="Allow one bounded source request for selected cities with no cached sample")
    parser.add_argument("--juba-selection", help="Opt into the pinned South Sudan point selection packet")
    parser.add_argument("--juba-selection-sha256", help="Expected SHA256 of the Juba selection packet")
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
    selection_inventory = read_beneath(ROOT, "world/playable-africa-rollout/inventory.json", MAX_SELECTION_BYTES, "rollout inventory") if args.juba_selection else None
    rows, selection_bindings = apply_optional_juba_selection(rows, args.juba_selection, args.juba_selection_sha256, inventory_raw=selection_inventory)
    rows = [dict(row, jubaSelectionBinding=selection_bindings["SS"]) if row.get("iso2") == "SS" and "SS" in selection_bindings else row for row in rows]
    if args.plan:
        for row in rows:
            try:
                place, timezone, airport = validate_row(row, verify_cached_sources=False)
                identity = generation_identity(row)
                identifier = identity["cityId"]
                size = catalogue_bytes(identifier, place["name"], row["iso2"], row["country"], place["coordinatesWgs84"], identity["stateId"], identity["stateName"])
                cache_dir = ROOT / ".cache/world-build/playable-africa" / identifier
                cache, malformed_cache, exhausted = source_request_state(cache_dir, place["coordinatesWgs84"])
                status = "ready" if size <= 150 else "refused-catalogue-cap"
                if size > 150:
                    status = "refused-catalogue-cap"
                elif malformed_cache:
                    status = "refused-malformed-cache"
                elif not cache and exhausted:
                    status = "refused-request-budget-exhausted"
                plan = {"country": row["iso2"], "city": identifier, "settlement": place["name"], "settlementRole": place.get("sourceClass"), "timezone": timezone, "stateId": identity["stateId"], "stateName": identity["stateName"], "airportDatasetName": airport["name"], "airportDatasetPoint": airport["coordinatesWgs84"], "airportEvidence": airport.get("coordinateEvidence"), "catalogueBytes": size, "catalogueLimit": 150, "cachedSample": cache, "wouldRequest": size <= 150 and not cache and not exhausted and not malformed_cache, "status": status}
                if row["iso2"] in selection_bindings:
                    plan["selectionEvidence"] = selection_bindings[row["iso2"]]
                print(json.dumps(plan))
            except (KeyError, TypeError, ValueError) as error:
                print(json.dumps({"country": row.get("iso2"), "status": "refused", "reason": str(error)}))
        return
    validated = [validate_row(row, verify_cached_sources=not args.check_assets and not (row.get("iso2") == "SS" and "jubaSelectionBinding" in row)) for row in rows]
    identities = [generation_identity(row) for row in rows]
    identifiers = [identity["cityId"] for identity in identities]
    if len(set(identifiers)) != len(identifiers):
        raise ValueError("Selected city names produce colliding city ids")
    if args.check or args.check_assets:
        inventory_hash = sha(DATA / "inventory.json")
        for row, (place, timezone, airport), identity, identifier in zip(rows, validated, identities, identifiers):
            receipt_path = RECEIPTS / f"{identifier}.json"
            if not receipt_path.is_file():
                raise ValueError(f"Missing starter receipt: {receipt_path}")
            receipt = json.loads(receipt_path.read_text())
            verify_assets(receipt, row, place, airport, identity, inventory_hash)
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
    for row, (place, timezone, airport_source), identity, identifier in zip(rows, validated, identities, identifiers):
        code = row["iso2"]
        out = OUTPUT / identifier
        receipt_path = RECEIPTS / f"{identifier}.json"
        if out.exists():
            if not receipt_path.is_file():
                raise ValueError(f"Refusing existing city directory without this generator's receipt: {out}")
            old = json.loads(receipt_path.read_text())
            if old.get("countryIso2") != code or old.get("cityId") != identifier:
                raise ValueError(f"Existing receipt belongs to another country: {receipt_path}")
            if (old.get("inventorySha256") != inventory_hash or old.get("selectedPlace") != place
                    or old.get("airportCandidate") != airport_source or old.get("sources", {}).get("naturalEarth") != row["admin0Geometry"]
                    or old.get("jubaSelection") != selection_bindings.get(code)):
                raise ValueError(f"Refusing to overwrite output with changed source identity: {receipt_path}")
            if code in COMPACT_IDENTITIES and old.get("generationIdentity") != identity:
                raise ValueError(f"Refusing legacy or mismatched compact identity receipt: {receipt_path}")
            for filename, expected in old["assets"].items():
                target = out / filename
                if not target.is_file() or target.stat().st_size != expected["bytes"] or sha(target) != expected["sha256"]:
                    raise ValueError(f"Refusing to overwrite modified prior output: {target}")
        if catalogue_bytes(identifier, place["name"], code, row["country"], place["coordinatesWgs84"], identity["stateId"], identity["stateName"]) > 150:
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
                 "state": {"idunique": identity["stateId"], "name": identity["stateName"]}, "timezone": timezone,
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
        receipt = {"countryIso2": code, "cityId": identifier, "generationIdentity": identity, "inventorySha256": inventory_hash, "selectedPlace": place, "airportCandidate": airport_source,
                   "airportDatasetCaveat": "Dataset point only; no current operating, schedule, or official ARP claim.", "bounds": bounds,
                   "sources": {"osm": source, "naturalEarth": row["admin0Geometry"]},
                   "kept": {"buildings": len(buildings), "roads": len(roads)}, "observed": counts,
                   "limits": {"downloadBytes": MAX_DOWNLOAD, "seconds": 45, "buildings": MAX_BUILDINGS, "roads": MAX_ROADS, "points": MAX_POINTS},
                   "assets": {name: {"sha256": sha(out/name), "bytes": (out/name).stat().st_size} for name in files}}
        if code in selection_bindings:
            receipt["jubaSelection"] = selection_bindings[code]
        dump(receipt_path, receipt)
        print(json.dumps({"country": code, "city": identifier, "status": "generated", "buildings": len(buildings), "roads": len(roads)}), flush=True)


if __name__ == "__main__":
    main()
