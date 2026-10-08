#!/usr/bin/env python3
"""Read-only, standard-library verification for a published fine ADM1 pilot."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import stat
from pathlib import Path, PurePosixPath
from typing import Any

SHA = re.compile(r"^[a-f0-9]{64}$")
HEX40 = re.compile(r"^[a-f0-9]{40}$")
MAX_SOURCE = 8 * 1024 * 1024
MAX_MANIFEST = 128 * 1024
MAX_INDEX = 128 * 1024
MAX_REGISTRY = 128 * 1024
MAX_COVERAGE = 128 * 1024
MAX_TOPOLOGY = 64 * 1024
MAX_POSITION_COUNT = 150_000
MAX_FEATURE_POSITIONS = 40_000
MAX_UNITS = 32
MAX_ASSET_BYTES = 16 * 1024 * 1024
MAX_ASSETS = 128
MAX_PARENT_BYTES = 16 * 1024 * 1024
MAX_PARENT_ENTRIES = 4096
PLANAR_EXCEPTION = (
    "OGC validity uses only 2D longitude/latitude in a plane; higher ordinates are ignored "
    "and this does not establish spherical validity on the ellipsoid."
)
VALIDATOR = "duckdb-spatial-ogc-planar-v1"
SPATIAL_SHA = "e326286e0ff4651680bfa2918fb22990fed50cb7d27d79dd21143ac7e74b0da9"


class VerificationError(Exception):
    """An exact, user-facing verification failure."""


def fail(message: str) -> None:
    raise VerificationError(message)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def no_constant(value: str) -> None:
    fail(f"JSON contains non-finite numeric constant {value}")


def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            fail(f"JSON repeats object key {key!r}")
        result[key] = value
    return result


def parse_json(data: bytes, label: str) -> Any:
    try:
        text = data.decode("utf-8", errors="strict")
        return json.loads(text, parse_constant=no_constant, object_pairs_hook=unique_object)
    except VerificationError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as exc:
        fail(f"{label} is not bounded valid UTF-8 JSON: {exc}")


def object_value(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(f"{label} must be a JSON object")
    return value


def exact_keys(row: dict[str, Any], keys: set[str], label: str) -> None:
    if row.keys() != keys:
        missing = sorted(keys - row.keys())
        extra = sorted(row.keys() - keys)
        fail(f"{label} fields differ (missing={missing}, unknown={extra})")


def bounded_int(value: Any, label: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        fail(f"{label} is outside {low}..{high}")
    return value


def text(value: Any, label: str, maximum: int = 2048) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum or any(ord(char) < 32 or ord(char) == 127 for char in value):
        fail(f"{label} is invalid bounded text")
    return value


def repository_root(value: str) -> Path:
    supplied = Path(value)
    if not supplied.is_absolute() or str(supplied) != value:
        fail("repository root must be canonical absolute path text")
    try:
        real = supplied.resolve(strict=True)
        info = os.lstat(supplied)
    except OSError as exc:
        fail(f"repository root cannot be inspected: {exc}")
    if str(real) != value or not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
        fail("repository root must be a real directory without symlink aliases")
    _reject_symlink_ancestors(supplied)
    return supplied


def _reject_symlink_ancestors(target: Path) -> None:
    absolute = Path(os.path.abspath(target))
    parts = absolute.parts
    cursor = Path(parts[0])
    for part in parts[1:]:
        cursor = cursor / part
        try:
            info = os.lstat(cursor)
        except FileNotFoundError:
            fail(f"path ancestor is missing: {cursor}")
        if stat.S_ISLNK(info.st_mode):
            fail(f"path contains symlink ancestor: {cursor}")


def safe_read(root: Path, relative: str, limit: int, label: str) -> bytes:
    if not isinstance(relative, str) or not relative or "\\" in relative or "\x00" in relative:
        fail(f"{label} path is invalid")
    rel = PurePosixPath(relative)
    if rel.is_absolute() or any(part in ("", ".", "..") for part in rel.parts):
        fail(f"{label} path escapes its private root")
    target = root.joinpath(*rel.parts)
    try:
        _reject_symlink_ancestors(target)
        info = os.lstat(target)
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
            fail(f"{label} is not a regular non-symlink file")
        if info.st_size > limit:
            fail(f"{label} exceeds {limit} byte cap")
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(target, flags)
        try:
            opened = os.fstat(fd)
            if not stat.S_ISREG(opened.st_mode) or opened.st_size > limit:
                fail(f"{label} changed to an unsafe or oversized file")
            chunks: list[bytes] = []
            total = 0
            while True:
                block = os.read(fd, min(64 * 1024, limit + 1 - total))
                if not block:
                    break
                chunks.append(block)
                total += len(block)
                if total > limit:
                    fail(f"{label} exceeds {limit} byte cap")
            after = os.fstat(fd)
            if total != opened.st_size or after.st_size != opened.st_size or after.st_mtime_ns != opened.st_mtime_ns:
                fail(f"{label} changed during bounded read")
            return b"".join(chunks)
        finally:
            os.close(fd)
    except VerificationError:
        raise
    except OSError as exc:
        fail(f"cannot safely read {label}: {exc}")


def hash_asset(root: Path, relative: Any, folder: str, limit: int, label: str) -> tuple[Any, bytes]:
    if not isinstance(relative, str) or not re.fullmatch(re.escape(folder) + r"/[a-f0-9]{64}\.json", relative):
        fail(f"{label} path is not a hash-addressed {folder} asset")
    body = safe_read(root, relative, limit, label)
    expected = PurePosixPath(relative).stem
    if digest(body) != expected:
        fail(f"{label} content hash differs from its filename")
    return parse_json(body, label), body


def finite_number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        fail(f"{label} must be finite numeric data")
    return float(value)


def geometry_positions(value: Any, label: str) -> tuple[str, Any, int, list[float]]:
    geometry = object_value(value, label)
    exact_keys(geometry, {"type", "coordinates"}, label)
    kind = geometry["type"]
    coordinates = geometry["coordinates"]
    if kind not in ("Polygon", "MultiPolygon") or not isinstance(coordinates, list):
        fail(f"{label} must be a Polygon or MultiPolygon")
    polygons = [coordinates] if kind == "Polygon" else coordinates
    if not polygons:
        fail(f"{label} has no polygons")
    count = 0
    longitudes: list[float] = []
    latitudes: list[float] = []

    def position(row: Any) -> bool:
        return isinstance(row, list) and len(row) >= 2 and all(not isinstance(x, (list, dict)) for x in row)

    for polygon_index, polygon in enumerate(polygons):
        if not isinstance(polygon, list) or not polygon:
            fail(f"{label} polygon {polygon_index} has no exterior ring")
        for ring_index, ring in enumerate(polygon):
            if not isinstance(ring, list) or len(ring) < 4:
                fail(f"{label} ring {ring_index} has fewer than four positions")
            distinct: set[tuple[float, float]] = set()
            ring_points: list[tuple[float, float]] = []
            for point_index, point in enumerate(ring):
                if not position(point) or len(point) > 4:
                    fail(f"{label} position must contain 2..4 numeric ordinates")
                values = [finite_number(item, f"{label} coordinate") for item in point]
                lon, lat = values[0], values[1]
                if not -180 <= lon <= 180 or not -90 <= lat <= 90:
                    fail(f"{label} coordinate lies outside WGS84 bounds")
                count += 1
                if count > MAX_FEATURE_POSITIONS:
                    fail(f"{label} exceeds {MAX_FEATURE_POSITIONS} positions per feature")
                longitudes.append(lon)
                latitudes.append(lat)
                distinct.add((lon, lat))
                ring_points.append((lon, lat))
            if len(distinct) < 3:
                fail(f"{label} ring has fewer than three distinct positions")
            if ring[0] != ring[-1]:
                fail(f"{label} ring is not closed")
            unwrapped = [ring_points[0]]
            prior_lon = ring_points[0][0]
            for longitude, latitude in ring_points[1:]:
                while longitude - prior_lon > 180:
                    longitude -= 360
                while longitude - prior_lon < -180:
                    longitude += 360
                unwrapped.append((longitude, latitude))
                prior_lon = longitude
            area = sum(unwrapped[i][0] * unwrapped[i + 1][1] - unwrapped[i + 1][0] * unwrapped[i][1] for i in range(len(unwrapped) - 1))
            if abs(area) < 1e-12:
                fail(f"{label} ring has zero area")
    if count == 0:
        fail(f"{label} has no coordinate positions")
    return kind, coordinates, count, [min(longitudes), min(latitudes), max(longitudes), max(latitudes)]


def expected_bounds(geometry: Any) -> list[float]:
    _, coordinates, _, _ = geometry_positions(geometry, "source geometry")
    longitudes: list[float] = []
    latitudes: list[float] = []

    def visit(value: Any) -> None:
        if isinstance(value, list) and len(value) >= 2 and not isinstance(value[0], (list, dict)):
            longitudes.append(float(value[0]))
            latitudes.append(float(value[1]))
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(coordinates)
    south, north = min(latitudes), max(latitudes)
    if south <= -89.999999 or north >= 89.999999:
        return [-180, south, 180, north]
    unique = sorted(set(longitudes))
    largest_gap = -1.0
    after_gap = 0
    for index, longitude in enumerate(unique):
        next_longitude = unique[0] + 360 if index == len(unique) - 1 else unique[index + 1]
        gap = next_longitude - longitude
        if gap > largest_gap:
            largest_gap, after_gap = gap, (index + 1) % len(unique)
    west = unique[after_gap]
    east = unique[(after_gap + len(unique) - 1) % len(unique)]
    return [west, south, east, north]


def verify_parent_directory(root: Path, coarse_hash: str, country_id: str, country_code: str) -> dict[str, Any]:
    base = root / ".cache/world-build/output/country-inventory"
    manifest_rel = f"manifests/{coarse_hash}.json"
    manifest_bytes = safe_read(base, manifest_rel, 1_000_000, "parent country-directory manifest")
    if digest(manifest_bytes) != coarse_hash:
        fail("parent country-directory manifest hash does not match coarseInventoryHash")
    manifest = object_value(parse_json(manifest_bytes, "parent country-directory manifest"), "parent country-directory manifest")
    if manifest.get("schemaVersion") != 1 or manifest.get("compiler") != "country-directory-compiler-v1":
        fail("parent country-directory manifest schema/compiler is unsupported")
    expected_nodes = bounded_int(manifest.get("nodeCount"), "parent nodeCount", 1, MAX_PARENT_ENTRIES)
    expected_units = bounded_int(manifest.get("sourceUnitCount"), "parent sourceUnitCount", 1, MAX_PARENT_ENTRIES)
    source = object_value(manifest.get("source"), "parent source record")
    source_id = text(source.get("id"), "parent source ID", 256)
    identity_rel = manifest.get("identityPath")
    if not isinstance(identity_rel, str) or not re.fullmatch(r"identity/[a-f0-9]{64}\.json", identity_rel):
        fail("parent identity sidecar path is invalid")
    identity_bytes = safe_read(base, identity_rel, 256_000, "parent identity sidecar")
    if digest(identity_bytes) != PurePosixPath(identity_rel).stem:
        fail("parent identity sidecar hash differs from filename")
    identity = object_value(parse_json(identity_bytes, "parent identity sidecar"), "parent identity sidecar")
    if identity.get("schemaVersion") != 1 or identity.get("candidateUnits") != expected_units or identity.get("missing") != []:
        fail("parent identity sidecar does not conserve source units")
    added_rows, retained_rows = identity.get("added"), identity.get("retained")
    if not isinstance(added_rows, list) or not isinstance(retained_rows, list):
        fail("parent identity sidecar row arrays are invalid")
    identity_rows = added_rows + retained_rows
    if len(identity_rows) != expected_units:
        fail("parent identity sidecar row count differs from source units")
    identity_by_key: dict[str, tuple[str, str]] = {}
    for row_value in identity_rows:
        row = object_value(row_value, "parent identity row")
        key = text(row.get("featureKey"), "parent feature key", 2048)
        node_id = text(row.get("countryId"), "parent country ID", 512)
        name = text(row.get("candidateName", row.get("name")), "parent candidate country name", 2048)
        if key in identity_by_key:
            fail("parent identity sidecar repeats a feature key")
        identity_by_key[key] = (node_id, name)

    root_path = manifest.get("rootNodePath")
    if not isinstance(root_path, str) or not re.fullmatch(r"nodes/[a-f0-9]{64}\.json", root_path):
        fail("parent root node path is invalid")
    pending: list[tuple[str, str | None, str | None, str | None]] = [(root_path, None, None, None)]
    node_ids: set[str] = set()
    node_paths: set[str] = set()
    country_refs: set[str] = set()
    countries: dict[str, dict[str, Any]] = {}
    total_bytes = len(manifest_bytes) + len(identity_bytes)
    read_count = 2
    while pending:
        relative, parent_id, parent_kind, expected_id = pending.pop()
        if relative in node_paths:
            fail("parent hierarchy repeats a node path")
        node_paths.add(relative)
        if len(node_paths) > MAX_PARENT_ENTRIES:
            fail("parent hierarchy exceeds 4096-node cap")
        index_value, node_bytes = hash_asset(base, relative, "nodes", 128_000, "parent node index")
        total_bytes += len(node_bytes)
        read_count += 1
        if total_bytes > MAX_PARENT_BYTES or read_count > MAX_PARENT_ENTRIES:
            fail("parent hierarchy exceeds bounded asset count or byte cap")
        index = object_value(index_value, "parent node index")
        if index.get("schemaVersion") != 1 or set(index) != {"schemaVersion", "node", "outlineIndexPath", "children"}:
            fail("parent node index schema is invalid")
        node = object_value(index.get("node"), "parent hierarchy node")
        node_id = text(node.get("id"), "parent node ID", 512)
        kind = node.get("kind")
        if node_id in node_ids or (expected_id is not None and node_id != expected_id):
            fail("parent hierarchy repeats or misbinds a node ID")
        if node.get("parentId") != parent_id or kind not in ("world", "continent", "country"):
            fail("parent hierarchy node has invalid parent/kind")
        if parent_kind is None and (kind != "world" or node_id != "world:earth"):
            fail("parent hierarchy root is invalid")
        if parent_kind == "world" and kind != "continent" or parent_kind == "continent" and kind != "country" or parent_kind == "country":
            fail("parent hierarchy child kind is invalid")
        node_ids.add(node_id)
        children = index.get("children")
        if not isinstance(children, list) or len(children) > MAX_PARENT_ENTRIES:
            fail("parent node children list is invalid")
        child_ids: set[str] = set()
        for child_value in children:
            child = object_value(child_value, "parent child reference")
            if set(child) != {"id", "name", "path"}:
                fail("parent child reference fields are invalid")
            child_id = text(child.get("id"), "parent child ID", 512)
            child_name = text(child.get("name"), "parent child name", 2048)
            child_path = child.get("path")
            if child_id in child_ids or not isinstance(child_path, str) or not re.fullmatch(r"nodes/[a-f0-9]{64}\.json", child_path):
                fail("parent child reference is duplicated or unsafe")
            child_ids.add(child_id)
            if len(pending) + len(node_ids) >= MAX_PARENT_ENTRIES:
                fail("parent hierarchy exceeds 4096 pending-node cap")
            pending.append((child_path, node_id, kind, child_id))
        if kind == "country":
            if children:
                fail("parent country node unexpectedly has children")
            refs = node.get("sourceFeatureIds")
            if not isinstance(refs, list) or len(refs) != 1:
                fail("parent country must bind exactly one coarse source feature")
            ref = text(refs[0], "parent country source reference", 4096)
            prefix = source_id + ":"
            if not ref.startswith(prefix) or ref in country_refs:
                fail("parent country source reference is duplicated or unresolved")
            country_refs.add(ref)
            key = ref[len(prefix):]
            identity_row = identity_by_key.get(key)
            if not identity_row or identity_row != (node_id, node.get("name")):
                fail("parent identity sidecar does not match country nodes")
            if node_id in countries:
                fail("parent directory repeats a country ID")
            countries[node_id] = node
        elif node.get("sourceFeatureIds"):
            fail("parent grouping node has source feature references")
    if len(node_ids) != expected_nodes or len(country_refs) != expected_units or len(identity_by_key) != expected_units:
        fail("parent node hierarchy or source-unit denominator does not match manifest")
    legacy = [node for node in countries.values() if node.get("countryCode") == "NG"]
    if len(legacy) != 1 or legacy[0].get("id") != "legacy-ng" or legacy[0].get("provider") != "legacy-ng":
        fail("parent directory does not preserve exactly one protected Nigeria country")
    selected = countries.get(country_id)
    if selected is None or selected.get("countryCode") != country_code or selected.get("provider") != "world":
        fail("fine country ID does not resolve to exactly one non-Nigeria world country")
    return {"manifestHash": coarse_hash, "countryId": country_id, "verifiedCountryNodes": len(countries), "hierarchyNodes": len(node_ids)}


def verify(root: Path, manifest_relative: str, pin_relative: str) -> dict[str, Any]:
    repo = repository_root(str(root))
    if not re.fullmatch(r"world/[A-Za-z0-9_.-]{1,96}\.json", pin_relative):
        fail("pin path must be a repository-relative world/<named>.json file")
    pin_bytes = safe_read(repo, pin_relative, 64 * 1024, "fine source pin")
    pin = object_value(parse_json(pin_bytes, "fine source pin"), "fine source pin")
    pin_keys = {"schemaVersion", "provider", "source", "input", "countryCode", "countryIso3", "adminLevel", "layerId", "canonicalType", "representedYear", "buildDate", "expectedUnits", "originalLicense", "licenseEvidence", "metadataSha256", "metadataBytes", "boundaryPolicy"}
    exact_keys(pin, pin_keys, "fine source pin")
    source_pin = object_value(pin.get("source"), "fine source record")
    exact_keys(source_pin, {"id", "url", "release", "license", "attribution", "sha256", "bytes"}, "fine source record")
    if pin.get("schemaVersion") != 1 or pin.get("provider") != "geoBoundaries" or pin.get("adminLevel") != "ADM1":
        fail("fine source pin schema/provider/level is unsupported")
    country_code = text(pin.get("countryCode"), "pin countryCode", 2)
    iso3 = text(pin.get("countryIso3"), "pin countryIso3", 3)
    if not re.fullmatch(r"[A-Z]{2}", country_code) or not re.fullmatch(r"[A-Z]{3}", iso3) or country_code == "NG" or iso3 == "NGA":
        fail("fine source pin country codes are invalid or protected Nigeria")
    release = text(source_pin.get("release"), "source release", 40)
    if not HEX40.fullmatch(release):
        fail("source release must be a full immutable commit SHA")
    expected_url = f"{release}/releaseData/gbOpen/{iso3}/ADM1/geoBoundaries-{iso3}-ADM1.geojson"
    if source_pin.get("url") not in (f"https://raw.githubusercontent.com/wmgeolab/geoBoundaries/{expected_url}", f"https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/{expected_url}"):
        fail("source URL does not match the full commit-pinned gbOpen country path")
    source_hash = source_pin.get("sha256")
    if not isinstance(source_hash, str) or not SHA.fullmatch(source_hash):
        fail("source SHA-256 is invalid")
    source_bytes_expected = bounded_int(source_pin.get("bytes"), "source byte pin", 1, MAX_SOURCE)
    input_path = pin.get("input")
    if input_path != f".cache/world-build/fine-source-cache/{source_hash}.geojson":
        fail("fine source input is not the exact private content-addressed cache path")
    for field in ("id", "license", "attribution"):
        text(source_pin.get(field), f"source {field}")
    for field in ("layerId", "canonicalType", "representedYear", "buildDate", "originalLicense", "boundaryPolicy"):
        text(pin.get(field), f"pin {field}")
    if not pin["layerId"].startswith(iso3 + "-ADM1-"):
        fail("pin layerId does not match country/admin level")
    if not re.fullmatch(r"\d{4}", str(pin.get("representedYear"))):
        fail("representedYear is invalid")
    units_expected = bounded_int(pin.get("expectedUnits"), "expectedUnits", 1, MAX_UNITS)
    metadata_hash = pin.get("metadataSha256")
    if not isinstance(metadata_hash, str) or not SHA.fullmatch(metadata_hash):
        fail("metadata SHA-256 is invalid")
    bounded_int(pin.get("metadataBytes"), "metadataBytes", 1, 64 * 1024)
    if not isinstance(pin.get("licenseEvidence"), list) or not 1 <= len(pin["licenseEvidence"]) <= 16:
        fail("licenseEvidence must contain 1..16 entries")
    if any(not isinstance(url, str) or not url.startswith("https://") or len(url) > 2048 for url in pin["licenseEvidence"]):
        fail("licenseEvidence entries must be bounded HTTPS URLs")

    code_root = repo / ".cache/world-build/output/fine" / country_code.lower() / "adm1"
    if not re.fullmatch(r"\.cache/world-build/output/fine/[a-z]{2}/adm1/manifests/[a-f0-9]{64}\.json", manifest_relative):
        fail("manifest must be the exact private fine output manifests/<hash>.json path")
    expected_prefix = f".cache/world-build/output/fine/{country_code.lower()}/adm1/manifests/"
    if not manifest_relative.startswith(expected_prefix):
        fail("manifest path country namespace does not match pin")
    manifest_rel = manifest_relative[len(expected_prefix):]
    manifest_match = re.fullmatch(r"([a-f0-9]{64})\.json", manifest_rel)
    assert manifest_match is not None
    manifest_hash = manifest_match.group(1)
    manifest_bytes = safe_read(code_root, f"manifests/{manifest_hash}.json", MAX_MANIFEST, "fine manifest")
    if digest(manifest_bytes) != manifest_hash:
        fail("fine manifest bytes do not match requested immutable hash")
    manifest = object_value(parse_json(manifest_bytes, "fine manifest"), "fine manifest")
    exact_keys(manifest, {"schemaVersion", "compiler", "coarseInventoryHash", "countryId", "source", "sourceUnitCount", "nodeIndexPath", "registryPath", "coveragePath", "topologyPath", "exceptions"}, "fine manifest")
    if manifest.get("schemaVersion") != 2 or manifest.get("compiler") != "fine-inventory-compiler-v2":
        fail("fine manifest schema/compiler is unsupported")
    coarse_hash = manifest.get("coarseInventoryHash")
    country_id = text(manifest.get("countryId"), "fine countryId", 512)
    if not isinstance(coarse_hash, str) or not SHA.fullmatch(coarse_hash):
        fail("coarseInventoryHash is invalid")
    if manifest.get("source") != pin:
        fail("manifest source pin differs from the complete reviewed pin file")
    source_units = bounded_int(manifest.get("sourceUnitCount"), "manifest sourceUnitCount", 1, MAX_UNITS)
    if source_units != units_expected:
        fail("manifest sourceUnitCount differs from complete pin")
    parent = verify_parent_directory(repo, coarse_hash, country_id, country_code)

    visited_assets: dict[str, bytes] = {f"manifests/{manifest_hash}.json": manifest_bytes}
    total_logical_bytes = len(manifest_bytes)

    def read_fine_asset(path_value: Any, folder: str, limit: int, label: str) -> Any:
        nonlocal total_logical_bytes
        if path_value in visited_assets:
            body = visited_assets[path_value]
            return parse_json(body, label)
        if len(visited_assets) >= MAX_ASSETS:
            fail("fine output exceeds 128 referenced artifact cap")
        value, body = hash_asset(code_root, path_value, folder, limit, label)
        total_logical_bytes += len(body)
        if total_logical_bytes > MAX_ASSET_BYTES:
            fail("fine logical published bytes exceed 16 MiB")
        visited_assets[path_value] = body
        return value

    index = object_value(read_fine_asset(manifest.get("nodeIndexPath"), "node-index", MAX_INDEX, "fine node index"), "fine node index")
    exact_keys(index, {"schemaVersion", "countryId", "nodes"}, "fine node index")
    if index.get("schemaVersion") != 1 or index.get("countryId") != country_id or not isinstance(index.get("nodes"), list) or len(index["nodes"]) != units_expected:
        fail("fine node index schema or source count differs from manifest")
    node_by_key: dict[str, dict[str, Any]] = {}
    node_by_id: dict[str, dict[str, Any]] = {}
    outline_path_by_id: dict[str, str] = {}
    total_positions = 0
    for index_number, entry_value in enumerate(index["nodes"]):
        entry = object_value(entry_value, f"fine node index entry {index_number}")
        exact_keys(entry, {"node", "outlinePath"}, f"fine node index entry {index_number}")
        node = object_value(entry.get("node"), f"fine admin node {index_number}")
        exact_keys(node, {"id", "parentId", "countryCode", "name", "kind", "adminLevel", "adminType", "bounds", "aliases", "sourceRef", "coverage", "exceptions"}, f"fine admin node {index_number}")
        node_id = text(node.get("id"), "fine admin node ID", 128)
        key = text(object_value(node.get("sourceRef"), "fine node sourceRef").get("featureKey"), "fine feature key", 256)
        if key in node_by_key or node_id in node_by_id:
            fail("fine node index repeats a source key or identity")
        if node.get("parentId") != country_id or node.get("countryCode") != country_code or node.get("kind") != "admin" or node.get("adminLevel") != "ADM1" or node.get("adminType") != pin.get("canonicalType") or node.get("coverage") != "geographic-outline":
            fail(f"fine admin node {node_id} is not bound to pin/country")
        ref = object_value(node.get("sourceRef"), "fine node sourceRef")
        if ref != {"sourceId": source_pin["id"], "release": release, "layerId": pin["layerId"], "featureKey": key}:
            fail(f"fine admin node {node_id} source reference differs from pin")
        if not re.fullmatch(r"admin:geoBoundaries:[a-f0-9]{64}", node_id):
            fail(f"fine admin node {node_id} has invalid stable ID")
        aliases, exceptions = node.get("aliases"), node.get("exceptions")
        if not isinstance(aliases, list) or len(aliases) > 256 or any(not isinstance(item, str) or not item.strip() or len(item) > 256 for item in aliases) or len(set(aliases)) != len(aliases):
            fail(f"fine admin node {node_id} aliases are invalid")
        if not isinstance(exceptions, list) or not 1 <= len(exceptions) <= 32 or any(not isinstance(item, str) or not item.strip() or len(item) > 2048 for item in exceptions) or len(set(exceptions)) != len(exceptions):
            fail(f"fine admin node {node_id} exceptions are invalid")
        expected_id = "admin:geoBoundaries:" + hashlib.sha256(f"{country_id}\0ADM1\0geoBoundaries\0{key}".encode("utf-8")).hexdigest()
        if node_id != expected_id:
            fail(f"fine admin node {node_id} requires an identity migration; verifier supports only direct source-key IDs")
        outline_path = entry.get("outlinePath")
        if not isinstance(outline_path, str) or not re.fullmatch(r"outlines/[a-f0-9]{64}\.json", outline_path):
            fail(f"fine outline path for {node_id} is unsafe")
        node_by_key[key] = node
        node_by_id[node_id] = node
        outline_path_by_id[node_id] = outline_path

    if len(node_by_key) != units_expected:
        fail("fine node count does not match expected source units")

    registry = object_value(read_fine_asset(manifest.get("registryPath"), "registries", MAX_REGISTRY, "fine identity registry"), "fine identity registry")
    exact_keys(registry, {"schemaVersion", "provider", "countryId", "adminLevel", "entries"}, "fine identity registry")
    if registry.get("schemaVersion") != 1 or registry.get("provider") != "geoBoundaries" or registry.get("countryId") != country_id or registry.get("adminLevel") != "ADM1" or not isinstance(registry.get("entries"), list) or len(registry["entries"]) != units_expected:
        fail("fine identity registry schema or count is invalid")
    registry_by_id: dict[str, dict[str, Any]] = {}
    for entry_value in registry["entries"]:
        entry = object_value(entry_value, "fine identity registry entry")
        exact_keys(entry, {"id", "sourceFeatureKeys", "names", "status", "replacedBy"}, "fine identity registry entry")
        entry_id = text(entry.get("id"), "registry entry ID", 128)
        if entry_id in registry_by_id or entry.get("status") != "active" or entry.get("replacedBy") != []:
            fail("identity registry contains duplicate or migrated/retired entries; unsupported migration")
        if not isinstance(entry.get("sourceFeatureKeys"), list) or len(entry["sourceFeatureKeys"]) != 1 or not isinstance(entry.get("names"), list) or len(entry["names"]) != 1:
            fail("identity registry must bind exactly one current key and name per active identity")
        registry_by_id[entry_id] = entry
    if set(registry_by_id) != set(node_by_id):
        fail("identity registry active IDs do not match fine nodes")

    coverage = object_value(read_fine_asset(manifest.get("coveragePath"), "coverage", MAX_COVERAGE, "fine coverage"), "fine coverage")
    exact_keys(coverage, {"expectedUnits", "sourceUnits", "acceptedUnits", "rejectedUnits", "coordinatePositions", "exceptions"}, "fine coverage")

    topology_value = read_fine_asset(manifest.get("topologyPath"), "topology", MAX_TOPOLOGY, "fine topology")
    topology = object_value(topology_value, "fine topology")
    exact_keys(topology, {"schemaVersion", "validator", "sourceSha256", "sourceBytes", "expectedUnits", "checkedUnits", "validUnits", "invalidUnits", "unsupportedUnits", "tooling", "rows", "exceptions"}, "fine topology")
    if topology.get("schemaVersion") != 1 or topology.get("validator") != VALIDATOR or topology.get("sourceSha256") != source_hash or topology.get("sourceBytes") != source_bytes_expected or topology.get("expectedUnits") != units_expected:
        fail("fine topology report does not bind exact source pin")
    tooling = object_value(topology.get("tooling"), "fine topology tooling")
    exact_keys(tooling, {"duckdbVersion", "spatialVersion", "spatialSha256"}, "fine topology tooling")
    if tooling != {"duckdbVersion": "1.5.6", "spatialVersion": "04270fe", "spatialSha256": SPATIAL_SHA}:
        fail("fine topology tooling identity is unsupported")
    topology_counts = {field: bounded_int(topology.get(field), f"topology {field}", 0, units_expected) for field in ("checkedUnits", "validUnits", "invalidUnits", "unsupportedUnits")}
    if topology_counts != {"checkedUnits": units_expected, "validUnits": units_expected, "invalidUnits": 0, "unsupportedUnits": 0}:
        fail("fine topology is not all-valid for every expected source unit")
    topology_rows = topology.get("rows")
    if not isinstance(topology_rows, list) or len(topology_rows) != units_expected:
        fail("fine topology rows do not conserve expected source units")
    sorted_keys = sorted(node_by_key, key=lambda item: tuple(ord(ch) for ch in item))
    for idx, row_value in enumerate(topology_rows):
        row = object_value(row_value, f"topology row {idx}")
        exact_keys(row, {"featureKey", "status", "valid", "empty", "reason"}, f"topology row {idx}")
        if row != {"featureKey": sorted_keys[idx], "status": "valid", "valid": True, "empty": False, "reason": None}:
            fail("fine topology feature keys/status are not exact all-valid source rows")
    if topology.get("exceptions") != [PLANAR_EXCEPTION] or manifest.get("exceptions") != [PLANAR_EXCEPTION]:
        fail("fine topology/manifest planar limitation text is missing or unsupported")

    source_relative = input_path
    source_raw = safe_read(repo, source_relative, MAX_SOURCE, "pinned fine source GeoJSON")
    if len(source_raw) != source_bytes_expected or digest(source_raw) != source_hash:
        fail("pinned fine source GeoJSON length/SHA-256 mismatch")
    feature_collection = object_value(parse_json(source_raw, "pinned fine source GeoJSON"), "pinned fine source GeoJSON")
    if feature_collection.get("type") != "FeatureCollection" or not isinstance(feature_collection.get("features"), list) or len(feature_collection["features"]) != units_expected or len(feature_collection["features"]) > MAX_UNITS:
        fail("pinned fine source GeoJSON feature count differs from pin")
    crs = feature_collection.get("crs")
    if crs is not None and crs != {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}}:
        fail("pinned fine source CRS is not the accepted WGS84 CRS84 contract")
    source_keys: dict[str, tuple[str, Any, int, list[float]]] = {}
    for feature_index, feature_value in enumerate(feature_collection["features"]):
        feature = object_value(feature_value, f"source feature {feature_index}")
        props = object_value(feature.get("properties"), f"source feature {feature_index} properties")
        if feature.get("type") != "Feature" or props.get("shapeGroup") != iso3 or props.get("shapeType") != "ADM1":
            fail(f"source feature {feature_index} does not match pinned country/admin level")
        key = text(props.get("shapeID"), f"source feature {feature_index} shapeID", 256)
        name = text(props.get("shapeName"), f"source feature {feature_index} shapeName", 256)
        if key in source_keys:
            fail("pinned source contains duplicate feature keys")
        geometry = object_value(feature.get("geometry"), f"source feature {feature_index} geometry")
        kind, coordinates, positions, _ = geometry_positions(geometry, f"source feature {feature_index} geometry")
        total_positions += positions
        if total_positions > MAX_POSITION_COUNT:
            fail("pinned source exceeds aggregate 150,000 position cap")
        source_keys[key] = (name, {"type": kind, "coordinates": coordinates}, positions, expected_bounds(geometry))

    if set(source_keys) != set(node_by_key):
        fail("fine nodes do not conserve exact pinned source feature keys")
    for key, (name, geometry, _, bounds) in source_keys.items():
        node = node_by_key[key]
        node_id = node["id"]
        if node.get("name") != name or node.get("bounds") != bounds:
            fail(f"fine node name/bounds differ from pinned source feature {key}")
        registry_entry = registry_by_id[node_id]
        if registry_entry.get("sourceFeatureKeys") != [key] or registry_entry.get("names") != [name]:
            fail(f"identity registry does not exactly bind pinned source feature {key}")
        outline_value = read_fine_asset(outline_path_by_id[node_id], "outlines", 2 * 1024 * 1024, f"fine outline {key}")
        if outline_value != geometry:
            fail(f"published outline geometry differs from pinned source feature {key} (including rings/holes)")

    if bounded_int(coverage.get("expectedUnits"), "coverage expectedUnits", 0, MAX_UNITS) != units_expected or bounded_int(coverage.get("sourceUnits"), "coverage sourceUnits", 0, MAX_UNITS) != units_expected or bounded_int(coverage.get("acceptedUnits"), "coverage acceptedUnits", 0, MAX_UNITS) != units_expected or bounded_int(coverage.get("rejectedUnits"), "coverage rejectedUnits", 0, MAX_UNITS) != 0:
        fail("fine coverage unit conservation does not match pin/source/node count")
    if bounded_int(coverage.get("coordinatePositions"), "coverage coordinatePositions", 1, MAX_POSITION_COUNT) != total_positions:
        fail("fine coverage coordinate position count differs from pinned source geometry")
    if coverage.get("exceptions") != [PLANAR_EXCEPTION]:
        fail("fine coverage does not retain the planar topology limitation")

    return {
        "status": "verified",
        "manifestHash": manifest_hash,
        "countryId": country_id,
        "countryCode": country_code,
        "sourceSha256": source_hash,
        "units": units_expected,
        "coordinatePositions": total_positions,
        "referencedArtifactCount": len(visited_assets),
        "publishedLogicalBytes": total_logical_bytes,
        "parent": parent,
        "networkBytes": 0,
        "limitations": [
            "Planar 2D OGC validity is recorded; spherical/ellipsoidal validity is not established.",
            "This verifies source fidelity and geographic outlines, not legal boundary correctness or political status.",
            "A geographic outline is not a playable destination or evidence of gameplay integration.",
            "Parent country identity is verified through its hash-bound hierarchy and identity sidecar; parent outline geometry is outside this verifier's scope.",
        ],
    }


def main(argv: list[str] | None = None) -> int:
    class JsonArgumentParser(argparse.ArgumentParser):
        def error(self, message: str) -> None:
            raise VerificationError(f"invalid command line: {message}")

    parser = JsonArgumentParser(description=__doc__)
    parser.add_argument("--repository-root", required=True, help="canonical absolute repository root")
    parser.add_argument("--manifest", required=True, help="private repository-relative fine manifest hash path")
    parser.add_argument("--pin", required=True, help="repository-relative world/<named>.json complete source pin")
    try:
        args = parser.parse_args(argv)
        result = verify(Path(args.repository_root), args.manifest, args.pin)
        print(json.dumps(result, sort_keys=True, separators=(",", ":")))
        return 0
    except (VerificationError, OSError, ValueError) as exc:
        print(json.dumps({"status": "rejected", "error": str(exc)}, sort_keys=True, separators=(",", ":")))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
