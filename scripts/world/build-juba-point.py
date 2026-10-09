#!/usr/bin/env python3
"""Build a separately versioned, source-only Juba point packet.

This tool reads the pinned rollout inventory and two pinned Natural Earth
sources sequentially. It emits one GeoJSON point feature plus selection
evidence. It does not modify the inventory, source caches, or runtime files.
"""
from __future__ import annotations

import argparse
import errno
import hashlib
import json
import math
import os
import stat
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
INVENTORY_PATH = ROOT / "world/playable-africa-rollout/inventory.json"
OUTPUT_DIR = ROOT / "world/playable-africa-rollout/south-sudan"
POINT_PATH = OUTPUT_DIR / "point.geojson"
SELECTION_PATH = OUTPUT_DIR / "selection.json"
INVENTORY_BYTES = 173999
INVENTORY_SHA256 = "90c931e87b4758544e8de321ecb0bf3b41420cbbf9aeb504b66b93c6938c2e0b"
MAX_SOURCE_BYTES = 32 * 1024 * 1024
MAX_OUTPUT_BYTES = 1024 * 1024
MAX_COUNTRY_POSITIONS = 2000
RELEASE = "ca96624a56bd078437bca8184e78163e5039ad19"
COUNTRY_SOURCE = {
    "sourceId": f"natural-earth-admin0-10m-{RELEASE}",
    "path": ".cache/world-build/country-source-cache/e51c4d047ed2867b34faea4e17c102ead4f3fee558a84a942619ee2cb1abdceb.geojson",
    "bytes": 13287234,
    "sha256": "239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255",
    "url": f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{RELEASE}/geojson/ne_10m_admin_0_countries.geojson",
    "license": "Public-domain",
}
PLACE_SOURCE = {
    "sourceId": f"natural-earth-places-10m-{RELEASE}",
    "path": ".cache/world-build/settlement-source-cache/42132340ed32bed7cf7be4b52f15d451eb81f235ceea042871e3b10f0117fc99.geojson",
    "bytes": 19359003,
    "sha256": "9b8e3de09048ef00dfc70357dbb9fa324493f214b5e0ae4daf1aa79a8d10116b",
    "url": f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{RELEASE}/geojson/ne_10m_populated_places.geojson",
    "license": "Public-domain",
}
COUNTRY_ID = "country:natural-earth:NE_ID%3A1159321235"
PLACE_ID = "place:natural-earth:NE_ID%3A1159149449"
COUNTRY_NE_ID = 1159321235
PLACE_NE_ID = 1159149449
SOURCE_ORDINAL = 6317
EXPECTED_COORDINATES = [31.580026, 4.829975]


class PacketError(ValueError):
    """Raised when source evidence or an output fails the packet contract."""


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_feature_hash(feature: dict[str, Any]) -> str:
    canonical = json.dumps(feature, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return sha256_bytes(canonical)


def read_regular_file_bounded(path: Path, max_bytes: int, label: str = "file") -> bytes:
    """Read one regular file through a no-follow descriptor with a hard byte cap."""
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        if error.errno in (errno.ELOOP, errno.ENXIO):
            raise PacketError(f"{label} must be a regular non-symlink file: {path}") from error
        raise PacketError(f"cannot open {label} {path}: {error}") from error
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise PacketError(f"{label} must be a regular file: {path}")
        if metadata.st_size > max_bytes:
            raise PacketError(f"{label} exceeds {max_bytes}-byte intake bound: {path}")
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = os.read(descriptor, min(1024 * 1024, max_bytes + 1 - total))
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise PacketError(f"{label} exceeds {max_bytes}-byte intake bound: {path}")
            chunks.append(chunk)
        return b"".join(chunks)
    except OSError as error:
        raise PacketError(f"cannot read {label} {path}: {error}") from error
    finally:
        os.close(descriptor)


def read_pinned_source(path: Path, expected_bytes: int, expected_hash: str, max_bytes: int = MAX_SOURCE_BYTES) -> tuple[bytes, dict[str, Any]]:
    data = read_regular_file_bounded(path, max_bytes, "source")
    size = len(data)
    if size != expected_bytes:
        raise PacketError(f"source size mismatch for {path}: expected {expected_bytes}, got {size}")
    digest = sha256_bytes(data)
    if digest != expected_hash:
        raise PacketError(f"source SHA256 mismatch for {path}: expected {expected_hash}, got {digest}")
    try:
        display_path = str(path.relative_to(ROOT))
    except ValueError:
        display_path = str(path)
    return data, {"path": display_path, "bytes": size, "sha256": digest}


def load_unique_feature(data: bytes, source_label: str, selector) -> dict[str, Any]:
    """Parse pinned bytes, copy out one feature, then release the document."""
    try:
        document = json.loads(data)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PacketError(f"cannot parse source GeoJSON {source_label}: {error}") from error
    hits = [feature for feature in document.get("features", []) if selector(feature.get("properties", {}))]
    if len(hits) != 1:
        raise PacketError(f"expected one matching source feature in {source_label}; found {len(hits)}")
    selected = json.loads(json.dumps(hits[0]))
    del hits, document
    return selected


def finite_wgs84_point(coordinates: Any) -> tuple[float, float]:
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        raise PacketError("source point must have longitude and latitude")
    lon, lat = coordinates[:2]
    if isinstance(lon, bool) or isinstance(lat, bool) or not isinstance(lon, (int, float)) or not isinstance(lat, (int, float)):
        raise PacketError("source point coordinates must be numeric")
    lon, lat = float(lon), float(lat)
    if not math.isfinite(lon) or not math.isfinite(lat):
        raise PacketError("source point coordinates must be finite")
    if not -180 <= lon <= 180 or not -90 <= lat <= 90:
        raise PacketError("source point is outside WGS84 longitude/latitude bounds")
    return lon, lat


def _coord(point: Any) -> tuple[float, float]:
    if not isinstance(point, list) or len(point) < 2:
        raise PacketError("polygon coordinate must contain longitude and latitude")
    lon, lat = point[:2]
    if isinstance(lon, bool) or isinstance(lat, bool) or not isinstance(lon, (int, float)) or not isinstance(lat, (int, float)):
        raise PacketError("polygon coordinates must be numeric")
    lon, lat = float(lon), float(lat)
    if not math.isfinite(lon) or not math.isfinite(lat) or not -180 <= lon <= 180 or not -90 <= lat <= 90:
        raise PacketError("polygon contains a non-finite or out-of-range WGS84 coordinate")
    return lon, lat


def _on_segment(p: tuple[float, float], a: tuple[float, float], b: tuple[float, float], eps: float = 1e-12) -> bool:
    cross = (p[1] - a[1]) * (b[0] - a[0]) - (p[0] - a[0]) * (b[1] - a[1])
    scale = max(1.0, abs(b[0] - a[0]), abs(b[1] - a[1]))
    if abs(cross) > eps * scale:
        return False
    return min(a[0], b[0]) - eps <= p[0] <= max(a[0], b[0]) + eps and min(a[1], b[1]) - eps <= p[1] <= max(a[1], b[1]) + eps


def classify_ring_point(point: tuple[float, float], coordinates: list[Any]) -> str:
    ring = [_coord(c) for c in coordinates]
    if len(ring) < 4 or ring[0] != ring[-1]:
        raise PacketError("linear ring must have at least four positions and be closed")
    inside = False
    x, y = point
    for i in range(len(ring) - 1):
        a, b = ring[i], ring[i + 1]
        if _on_segment(point, a, b):
            return "boundary"
        if (a[1] > y) != (b[1] > y):
            cross_x = a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
            if x < cross_x:
                inside = not inside
    return "inside" if inside else "outside"


def _orientation(a: tuple[float, float], b: tuple[float, float], c: tuple[float, float]) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _segments_intersect(a: tuple[float, float], b: tuple[float, float], c: tuple[float, float], d: tuple[float, float]) -> bool:
    eps = 1e-12
    o1, o2 = _orientation(a, b, c), _orientation(a, b, d)
    o3, o4 = _orientation(c, d, a), _orientation(c, d, b)
    if ((o1 > eps and o2 < -eps) or (o1 < -eps and o2 > eps)) and ((o3 > eps and o4 < -eps) or (o3 < -eps and o4 > eps)):
        return True
    return any((abs(o) <= eps and _on_segment(p, s, t)) for o, p, s, t in ((o1, c, a, b), (o2, d, a, b), (o3, a, c, d), (o4, b, c, d)))


def validate_ring(coordinates: Any) -> list[tuple[float, float]]:
    if not isinstance(coordinates, list):
        raise PacketError("linear ring must be an array")
    ring = [_coord(c) for c in coordinates]
    if len(ring) < 4 or ring[0] != ring[-1]:
        raise PacketError("linear ring must have at least four positions and be closed")
    if len(set(ring[:-1])) < 3:
        raise PacketError("linear ring must have at least three distinct vertices")
    edges = list(zip(ring[:-1], ring[1:]))
    if any(a == b for a, b in edges):
        raise PacketError("linear ring contains a zero-length edge")
    for i, (a, b) in enumerate(edges):
        for j in range(i + 1, len(edges)):
            if j == i + 1 or (i == 0 and j == len(edges) - 1):
                continue
            c, d = edges[j]
            if _segments_intersect(a, b, c, d):
                raise PacketError("linear ring self-intersects or self-touches")
    return ring


def validate_polygon(coordinates: Any) -> tuple[int, int]:
    if not isinstance(coordinates, list) or not coordinates:
        raise PacketError("polygon must contain an exterior ring")
    if any(not isinstance(ring, list) for ring in coordinates):
        raise PacketError("linear ring must be an array")
    if sum(len(ring) for ring in coordinates) > MAX_COUNTRY_POSITIONS:
        raise PacketError(f"country polygon exceeds {MAX_COUNTRY_POSITIONS}-position topology limit")
    rings = [validate_ring(ring) for ring in coordinates]
    outer = coordinates[0]
    for hole in coordinates[1:]:
        if classify_ring_point(_coord(hole[0]), outer) != "inside":
            raise PacketError("polygon hole is not strictly inside exterior ring")
    for i, ring_a in enumerate(rings):
        edges_a = list(zip(ring_a[:-1], ring_a[1:]))
        for ring_b in rings[i + 1:]:
            edges_b = list(zip(ring_b[:-1], ring_b[1:]))
            if any(_segments_intersect(a, b, c, d) for a, b in edges_a for c, d in edges_b):
                raise PacketError("polygon rings intersect or touch")
    for i, hole_a in enumerate(coordinates[1:]):
        for hole_b in coordinates[i + 2:]:
            if classify_ring_point(_coord(hole_a[0]), hole_b) != "outside" or classify_ring_point(_coord(hole_b[0]), hole_a) != "outside":
                raise PacketError("polygon holes overlap or contain one another")
    position_count = sum(len(ring) for ring in rings)
    return len(rings), position_count


def validate_country_geometry(geometry: dict[str, Any]) -> dict[str, Any]:
    kind = geometry.get("type")
    coordinates = geometry.get("coordinates")
    polygons = [coordinates] if kind == "Polygon" else coordinates if kind == "MultiPolygon" else None
    if not isinstance(polygons, list) or not polygons:
        raise PacketError("country geometry must be a non-empty Polygon or MultiPolygon")
    position_total = 0
    for polygon in polygons:
        if not isinstance(polygon, list) or any(not isinstance(ring, list) for ring in polygon):
            raise PacketError("country geometry contains an invalid polygon or ring")
        position_total += sum(len(ring) for ring in polygon)
        if position_total > MAX_COUNTRY_POSITIONS:
            raise PacketError(f"country geometry exceeds {MAX_COUNTRY_POSITIONS}-position topology limit")
    ring_count = position_count = 0
    for polygon in polygons:
        rings, positions = validate_polygon(polygon)
        ring_count += rings
        position_count += positions
    return {"geometryType": kind, "polygonCount": len(polygons), "ringCount": ring_count, "coordinatePositions": position_count, "topologyValid": True}


def point_in_polygon(point: tuple[float, float], coordinates: Any) -> tuple[bool, str]:
    outer_relation = classify_ring_point(point, coordinates[0])
    if outer_relation == "boundary":
        return False, "point_on_outer_boundary"
    if outer_relation == "outside":
        return False, "outside_outer_ring"
    for hole in coordinates[1:]:
        relation = classify_ring_point(point, hole)
        if relation == "inside":
            return False, "inside_hole"
        if relation == "boundary":
            return False, "on_hole_boundary"
    return True, "inside_outer_outside_holes"


def point_in_country(point: tuple[float, float], geometry: dict[str, Any]) -> tuple[bool, dict[str, Any]]:
    validation = validate_country_geometry(geometry)
    polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    relations = []
    for index, polygon in enumerate(polygons):
        accepted, reason = point_in_polygon(point, polygon)
        relations.append({"polygonIndex": index, "accepted": accepted, "relation": reason})
        if accepted:
            return True, {**validation, "accepted": True, "method": "strict interior of an exterior ring and exterior to every hole", "matchingPolygonIndex": index, "relations": relations}
    return False, {**validation, "accepted": False, "method": "strict interior of an exterior ring and exterior to every hole", "relations": relations}


def validate_inventory(inventory_path: Path) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    inventory_bytes, source_pin = read_pinned_source(inventory_path, INVENTORY_BYTES, INVENTORY_SHA256)
    try:
        inventory = json.loads(inventory_bytes)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PacketError(f"rollout inventory is not valid JSON: {error}") from error
    rows = [row for row in inventory.get("countries", []) if row.get("iso2") == "SS"]
    if len(rows) != 1:
        raise PacketError(f"expected one SS rollout inventory row, found {len(rows)}")
    row = rows[0]
    city = row.get("chosenCity") or {}
    if row.get("countryId") != COUNTRY_ID or city.get("naturalEarthPlaceId") != PLACE_ID:
        raise PacketError("SS inventory row country/place identity changed")
    if city.get("iso2") != "SS" or city.get("coordinatesWgs84") != EXPECTED_COORDINATES:
        raise PacketError("SS inventory row city ISO/coordinates changed")
    if row.get("cityTimezone", {}).get("ianaTimezone") != "Africa/Juba":
        raise PacketError("SS inventory row timezone changed")
    zones_file = next((item for item in inventory.get("sourceFiles", []) if item.get("label") == "IANA tz database zone.tab from local host"), {})
    del rows, inventory_bytes, inventory
    return row, source_pin, zones_file


def validate_feature_identity(country: dict[str, Any], place: dict[str, Any], inventory_row: dict[str, Any]) -> dict[str, Any]:
    cp, pp = country.get("properties", {}), place.get("properties", {})
    if cp.get("NE_ID") != COUNTRY_NE_ID or pp.get("NE_ID") != PLACE_NE_ID:
        raise PacketError("pinned Natural Earth feature identity changed")
    if inventory_row.get("countryId") != COUNTRY_ID or inventory_row.get("chosenCity", {}).get("naturalEarthPlaceId") != PLACE_ID:
        raise PacketError("inventory country/place identity does not match pinned feature ids")
    if cp.get("ADMIN") != "South Sudan" or cp.get("TYPE") != "Sovereign country":
        raise PacketError("country source feature does not identify the expected sovereign-country record")
    if cp.get("ISO_A2") != "SS" or cp.get("ISO_A2_EH") != "SS":
        raise PacketError("country ISO_A2 and ISO_A2_EH must both be SS")
    if pp.get("NAME") != "Juba" or pp.get("ISO_A2") != "SS":
        raise PacketError("place source feature must identify Juba with exact ISO_A2 SS")
    if pp.get("FEATURECLA") != "Admin-0 capital" or pp.get("ADM0CAP") != 0:
        raise PacketError("pinned Juba capital classification evidence changed")
    if cp.get("ISO_A3") != "SSD" or cp.get("ADM0_ISO") != "SSD":
        raise PacketError("country ISO3 crosswalk evidence changed")
    # Do not alias or rewrite either three-letter code; preserve the disagreement.
    return {
        "countryId": COUNTRY_ID,
        "placeId": PLACE_ID,
        "countryIso2": cp["ISO_A2"],
        "countryIso2Eh": cp["ISO_A2_EH"],
        "placeIso2": pp["ISO_A2"],
        "countryAdm0A3": cp.get("ADM0_A3"),
        "countrySovA3": cp.get("SOV_A3"),
        "countryIsoA3": cp.get("ISO_A3"),
        "countryAdm0Iso": cp.get("ADM0_ISO"),
        "placeAdm0A3": pp.get("ADM0_A3"),
        "placeSovA3": pp.get("SOV_A3"),
        "iso2JoinAccepted": True,
        "threeLetterCodeDiscrepancyRetained": cp.get("ADM0_A3") != pp.get("ADM0_A3") or cp.get("SOV_A3") != pp.get("SOV_A3"),
        "noThreeLetterAliasApplied": True,
    }


def json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8")


def expected_outputs(outputs: dict[Path, bytes], check_only: bool = False) -> None:
    """Check exact output bytes; normal mode creates only absent files."""
    missing: list[Path] = []
    for path, expected in outputs.items():
        if len(expected) > MAX_OUTPUT_BYTES:
            raise PacketError(f"output exceeds {MAX_OUTPUT_BYTES}-byte bound: {path}")
        try:
            metadata = path.lstat()
        except FileNotFoundError:
            missing.append(path)
            continue
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
            raise PacketError(f"refusing non-regular or symbolic-link output: {path}")
        existing = read_regular_file_bounded(path, MAX_OUTPUT_BYTES, "output")
        if existing != expected:
            raise PacketError(f"refusing to overwrite divergent versioned output(s): {path}")
    if check_only and missing:
        raise PacketError("--check found missing output(s): " + ", ".join(str(p) for p in missing))
    if not check_only:
        for path in missing:
            path.parent.mkdir(parents=True, exist_ok=True)
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
            try:
                descriptor = os.open(path, flags, 0o644)
            except FileExistsError as error:
                raise PacketError(f"output appeared during creation; refusing to overwrite: {path}") from error
            try:
                if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                    raise PacketError(f"created output is not a regular file: {path}")
                payload = outputs[path]
                offset = 0
                while offset < len(payload):
                    offset += os.write(descriptor, payload[offset:])
                os.fsync(descriptor)
            finally:
                os.close(descriptor)


def build_packet() -> dict[Path, bytes]:
    inventory_row, inventory_pin, zones_file = validate_inventory(INVENTORY_PATH)
    country_path = ROOT / COUNTRY_SOURCE["path"]
    place_path = ROOT / PLACE_SOURCE["path"]

    country_bytes, country_pin = read_pinned_source(country_path, COUNTRY_SOURCE["bytes"], COUNTRY_SOURCE["sha256"])
    country_feature = load_unique_feature(country_bytes, country_path, lambda p: p.get("NE_ID") == COUNTRY_NE_ID)
    del country_bytes
    if country_feature.get("geometry", {}).get("type") != "Polygon":
        raise PacketError("pinned South Sudan country geometry must be Polygon")

    # The country document is no longer resident when the place document is parsed.
    place_bytes, place_pin = read_pinned_source(place_path, PLACE_SOURCE["bytes"], PLACE_SOURCE["sha256"])
    place_feature = load_unique_feature(place_bytes, place_path, lambda p: p.get("NE_ID") == PLACE_NE_ID)
    del place_bytes
    identity = validate_feature_identity(country_feature, place_feature, inventory_row)
    if place_feature.get("geometry", {}).get("type") != "Point":
        raise PacketError("pinned Juba source geometry must be Point")
    point = finite_wgs84_point(place_feature.get("geometry", {}).get("coordinates"))
    if list(point) != EXPECTED_COORDINATES:
        raise PacketError("pinned Juba coordinates differ from the SS inventory row")
    accepted, topology = point_in_country(point, country_feature["geometry"])
    if not accepted:
        raise PacketError(f"Juba point is not strictly inside the South Sudan polygon: {topology}")

    country_props = country_feature["properties"]
    place_props = place_feature["properties"]
    city_timezone = inventory_row["cityTimezone"]
    point_feature = {
        "type": "Feature",
        "id": PLACE_ID,
        "geometry": {"type": "Point", "coordinates": [point[0], point[1]]},
        "properties": {
            "name": "Juba",
            "naturalEarthPlaceId": PLACE_ID,
            "countryId": COUNTRY_ID,
            "countryIso2": "SS",
            "coordinatesSource": "pinned Natural Earth 10m populated places point",
            "sourceClass": place_props.get("FEATURECLA"),
            "scaleRank": place_props.get("SCALERANK"),
            "capitalFlagAdm0cap": place_props.get("ADM0CAP"),
            "sourceTimezone": place_props.get("TIMEZONE"),
            "selectedIanaTimezone": city_timezone["ianaTimezone"],
            "sourceKey": f"NE_ID:{PLACE_NE_ID}",
            "sourceOrdinal": SOURCE_ORDINAL,
            "sourceFeatureCanonicalSha256": canonical_feature_hash(place_feature),
            "sourceId": PLACE_SOURCE["sourceId"],
            "sourceRelease": RELEASE,
            "sourceSha256": PLACE_SOURCE["sha256"],
            "sourceUrl": PLACE_SOURCE["url"],
            "license": PLACE_SOURCE["license"],
            "attribution": "Natural Earth; public-domain map data.",
            "capitalDesignationClaimed": False,
            "countryAdm0A3": country_props.get("ADM0_A3"),
            "placeAdm0A3": place_props.get("ADM0_A3"),
            "countryIsoA3": country_props.get("ISO_A3"),
            "countryAdm0Iso": country_props.get("ADM0_ISO"),
        },
    }
    point_doc = {"type": "FeatureCollection", "features": [point_feature]}
    point_data = json_bytes(point_doc)

    outline_ref = next((item for item in inventory_row.get("admin0Geometry", {}).get("outlineParts", []) if item.get("path")), None)
    selection = {
        "schemaVersion": 1,
        "packetKind": "versioned-natural-earth-city-point-source-packet",
        "scope": "Source point and selection evidence only; no runtime admission, city geometry acquisition, or city-completeness assertion.",
        "output": {"path": str(POINT_PATH.relative_to(ROOT)), "bytes": len(point_data), "sha256": sha256_bytes(point_data), "featureCount": 1, "geometryType": "Point"},
        "inventory": {"path": str(INVENTORY_PATH.relative_to(ROOT)), **inventory_pin, "countryIso2": "SS", "countryId": COUNTRY_ID, "placeId": PLACE_ID},
        "sources": [
            {**COUNTRY_SOURCE, **country_pin, "featureRef": f"natural-earth-admin0-10m-{RELEASE}:NE_ID:{COUNTRY_NE_ID}", "featureCanonicalSha256": canonical_feature_hash(country_feature)},
            {**PLACE_SOURCE, **place_pin, "featureRef": f"natural-earth-places-10m-{RELEASE}:NE_ID:{PLACE_NE_ID}", "featureCanonicalSha256": canonical_feature_hash(place_feature)},
        ],
        "identityEvidence": identity,
        "geometryEvidence": {
            "countryFeatureRef": f"natural-earth-admin0-10m-{RELEASE}:NE_ID:{COUNTRY_NE_ID}",
            "countryId": COUNTRY_ID,
            "sourceGeometryType": topology["geometryType"],
            "polygonCount": topology["polygonCount"],
            "ringCount": topology["ringCount"],
            "coordinatePositions": topology["coordinatePositions"],
            "topologyValid": topology["topologyValid"],
            "containmentAccepted": topology["accepted"],
            "containmentMethod": topology["method"],
            "matchingPolygonIndex": topology["matchingPolygonIndex"],
            "pointRelation": topology["relations"],
            "outlineOutputReference": outline_ref,
            "countryPolygonIsValidationInputOnly": True,
        },
        "citySelection": {
            "name": "Juba",
            "naturalEarthPlaceId": PLACE_ID,
            "countryId": COUNTRY_ID,
            "coordinatesWgs84": list(point),
            "iso2JoinAccepted": True,
            "admin0A3MismatchPreserved": {"country": country_props.get("ADM0_A3"), "place": place_props.get("ADM0_A3")},
            "countrySovA3": country_props.get("SOV_A3"),
            "placeSovA3": place_props.get("SOV_A3"),
            "countryIsoA3": country_props.get("ISO_A3"),
            "countryAdm0Iso": country_props.get("ADM0_ISO"),
            "noThreeLetterCodeAlias": True,
            "selectedIanaTimezone": city_timezone["ianaTimezone"],
            "timezoneSelectionEvidence": {"source": city_timezone["source"], "status": city_timezone["status"], "nearestZoneTabPointDistanceKm": city_timezone.get("nearestZoneTabPointDistanceKm"), "zoneTabPath": zones_file.get("path"), "zoneTabSha256": zones_file.get("sha256")},
        },
        "caveats": [
            "The Natural Earth place class is Admin-0 capital while ADM0CAP is 0; the packet does not assert a current official capital designation.",
            "Natural Earth country ADM0_A3/SOV_A3 are SDS while place ADM0_A3/SOV_A3 and country ISO_A3/ADM0_ISO are SSD; exact ISO_A2 SS plus strict geometric containment is the selection basis, and no three-letter alias is applied.",
            "Natural Earth place TIMEZONE is Africa/Khartoum; the selected Africa/Juba value is the IANA zone.tab result already recorded in the pinned rollout inventory.",
            "The emitted GeoJSON contains only the city point. The country polygon was read to validate topology and containment and is not emitted as acquired city geometry.",
        ],
    }
    return {POINT_PATH: point_data, SELECTION_PATH: json_bytes(selection)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify existing deterministic outputs without rewriting")
    args = parser.parse_args()
    outputs = build_packet()
    expected_outputs(outputs, check_only=args.check)
    action = "verified" if args.check else "written/idempotently verified"
    print(f"{action}: {POINT_PATH.relative_to(ROOT)} and {SELECTION_PATH.relative_to(ROOT)}")
    for path, data in outputs.items():
        print(f"{path.relative_to(ROOT)} bytes={len(data)} sha256={sha256_bytes(data)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, PacketError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1)
