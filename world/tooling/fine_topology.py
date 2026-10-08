#!/usr/bin/env python3
"""Bounded OGC planar topology checks for a pinned geoBoundaries ADM1 source."""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path
from typing import Any

MAX_REQUEST_BYTES = 64 * 1024
MAX_SOURCE_BYTES = 8 * 1024 * 1024
MAX_FEATURES = 32
MAX_POSITIONS = 150_000
MAX_FEATURE_POSITIONS = 40_000
MAX_REPORT_BYTES = 64 * 1024
DUCKDB_VERSION = "1.5.6"
SPATIAL_VERSION = "04270fe"
SPATIAL_SHA256 = "e326286e0ff4651680bfa2918fb22990fed50cb7d27d79dd21143ac7e74b0da9"
EXTENSION_RELATIVE = Path("tooling/extensions/v1.5.6/osx_arm64")
EXTENSION_NAME = "spatial.duckdb_extension"
SOURCE_RELATIVE = Path("fine-source-cache")
HEX64 = re.compile(r"^[a-f0-9]{64}$")
CRS84 = "urn:ogc:def:crs:OGC:1.3:CRS84"


class InputError(Exception):
    pass


class UnsupportedGeometry(Exception):
    pass


def _pairs_no_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise InputError(f"duplicate JSON object key: {key[:80]}")
        result[key] = value
    return result


def _json_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=True, allow_nan=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _text(value: Any, label: str, max_len: int = 256) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > max_len or any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise InputError(f"{label} must be bounded non-empty text")
    return value


def _safe_components(path: Path) -> None:
    if not path.is_absolute():
        raise InputError("source and extension paths must be absolute")
    if ".." in path.parts:
        raise InputError("parent-directory path components are refused")
    cursor = Path(path.anchor)
    parts = path.parts[1:]
    for index, part in enumerate(parts):
        cursor = cursor / part
        try:
            info = cursor.lstat()
        except FileNotFoundError as error:
            raise InputError(f"required path component does not exist: {cursor}") from error
        if stat.S_ISLNK(info.st_mode):
            raise InputError(f"symlink path component is refused: {cursor}")
        if index < len(parts) - 1 and not stat.S_ISDIR(info.st_mode):
            raise InputError(f"non-directory path ancestor: {cursor}")


def _read_source(path: Path, expected_hash: str, expected_bytes: int) -> bytes:
    if not HEX64.fullmatch(expected_hash):
        raise InputError("sourceSha256 must be lowercase SHA-256")
    if not isinstance(expected_bytes, int) or isinstance(expected_bytes, bool) or not 1 <= expected_bytes <= MAX_SOURCE_BYTES:
        raise InputError("sourceBytes must be between 1 and 8 MiB")
    _safe_components(path)
    if path.resolve(strict=True) != path:
        raise InputError("source path is not canonical")
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size != expected_bytes:
        raise InputError("source file is not regular or its byte length differs from the pin")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size != expected_bytes:
            raise InputError("source changed before bounded read")
        chunks: list[bytes] = []
        remaining = expected_bytes + 1
        while remaining:
            part = os.read(fd, min(64 * 1024, remaining))
            if not part:
                break
            chunks.append(part)
            remaining -= len(part)
        raw = b"".join(chunks)
        after = os.fstat(fd)
        current = path.lstat()
        if (current.st_dev, current.st_ino) != (before.st_dev, before.st_ino) or path.resolve(strict=True) != path:
            raise InputError("source path changed during bounded read")
        if len(raw) != expected_bytes or after.st_size != before.st_size or after.st_mtime_ns != before.st_mtime_ns or after.st_ctime_ns != before.st_ctime_ns:
            raise InputError("source changed or grew during bounded read")
    finally:
        os.close(fd)
    if hashlib.sha256(raw).hexdigest() != expected_hash:
        raise InputError("source bytes do not match sourceSha256")
    return raw


def _parse_source(raw: bytes, expected_units: Any) -> tuple[list[tuple[str, dict[str, Any], bool]], str]:
    if not isinstance(expected_units, int) or isinstance(expected_units, bool) or not 1 <= expected_units <= MAX_FEATURES:
        raise InputError("expectedUnits must be between 1 and 32")
    try:
        document = json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs_no_duplicates,
                              parse_constant=lambda token: (_ for _ in ()).throw(InputError(f"non-finite JSON number: {token}")))
    except InputError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as error:
        raise InputError(f"source is not bounded valid UTF-8 GeoJSON: {error}") from error
    if not isinstance(document, dict) or document.get("type") != "FeatureCollection":
        raise InputError("source must be a GeoJSON FeatureCollection")
    if "crs" in document and document["crs"] != {"type": "name", "properties": {"name": CRS84}}:
        raise InputError("source CRS must be absent or the exact CRS84 declaration")
    rows = document.get("features")
    if not isinstance(rows, list) or len(rows) != expected_units or not 1 <= len(rows) <= MAX_FEATURES:
        raise InputError("feature count differs from expectedUnits or exceeds 32")
    keys: set[str] = set()
    country_iso3: str | None = None
    features: list[tuple[str, dict[str, Any], bool]] = []
    total_positions = 0
    for index, feature in enumerate(rows):
        if not isinstance(feature, dict) or feature.get("type") != "Feature":
            raise InputError(f"feature {index} is not a GeoJSON Feature")
        properties = feature.get("properties")
        if not isinstance(properties, dict):
            raise InputError(f"feature {index} properties must be an object")
        key = _text(properties.get("shapeID"), f"feature {index} shapeID")
        _text(properties.get("shapeName"), f"feature {index} shapeName")
        group = _text(properties.get("shapeGroup"), f"feature {index} shapeGroup", 3)
        if not re.fullmatch(r"[A-Z]{3}", group):
            raise InputError(f"feature {index} shapeGroup must be an uppercase ISO3")
        if group == "NGA":
            raise InputError("Nigeria/legacy-ng is protected from fine topology validation")
        if country_iso3 is None:
            country_iso3 = group
        if group != country_iso3:
            raise InputError("source features do not share one shapeGroup ISO3")
        if properties.get("shapeType") != "ADM1":
            raise InputError(f"feature {key} shapeType must be ADM1")
        if key in keys:
            raise InputError(f"duplicate source feature key: {key}")
        keys.add(key)
        geometry, count, unsupported = _normalize_geometry(feature.get("geometry"), key)
        total_positions += count
        if total_positions > MAX_POSITIONS:
            raise InputError("source exceeds 150,000 coordinate positions")
        features.append((key, geometry, unsupported))
    features.sort(key=lambda row: row[0])
    assert country_iso3 is not None
    return features, country_iso3


def _position(value: Any, label: str) -> tuple[list[float], bool]:
    if not isinstance(value, list) or not 2 <= len(value) <= 4:
        raise InputError(f"{label} must contain 2 to 4 numeric ordinates")
    if any(not isinstance(item, (int, float)) or isinstance(item, bool) or not (-float("inf") < float(item) < float("inf")) for item in value):
        raise InputError(f"{label} contains a non-finite ordinate")
    lon, lat = float(value[0]), float(value[1])
    if not -180 <= lon <= 180 or not -90 <= lat <= 90:
        raise InputError(f"{label} lies outside WGS84 longitude/latitude bounds")
    return [lon, lat], abs(lat) >= 90


def _ring(raw_ring: Any, label: str) -> tuple[list[list[float]], int, bool]:
    if not isinstance(raw_ring, list) or len(raw_ring) < 4:
        raise InputError(f"{label} must contain at least four coordinates")
    positions: list[list[float]] = []
    pole = False
    for index, value in enumerate(raw_ring):
        xy, at_pole = _position(value, f"{label}[{index}]")
        positions.append(xy)
        pole = pole or at_pole
    if raw_ring[0] != raw_ring[-1]:
        raise InputError(f"{label} is not closed")
    if len({(point[0], point[1]) for point in positions[:-1]}) < 3:
        raise InputError(f"{label} has fewer than three distinct positions")
    unwrapped = [positions[0][:]]
    previous = positions[0][0]
    ambiguous = pole
    for lon, lat in positions[1:]:
        delta = lon - previous
        if abs(abs(delta) - 180) < 1e-10:
            ambiguous = True
        while lon - previous > 180:
            lon -= 360
        while lon - previous < -180:
            lon += 360
        unwrapped.append([lon, lat])
        previous = lon
    if max(point[0] for point in unwrapped) - min(point[0] for point in unwrapped) > 180 + 1e-10:
        ambiguous = True
    return unwrapped, len(positions), ambiguous


def _center(ring: list[list[float]]) -> float:
    return sum(point[0] for point in ring[:-1]) / (len(ring) - 1)


def _align(ring: list[list[float]], target_center: float) -> list[list[float]]:
    center = _center(ring)
    delta = target_center - center
    turns = round(delta / 360)
    if abs(abs(delta - turns * 360) - 180) < 1e-9:
        raise UnsupportedGeometry("longitude image is ambiguous by 180 degrees")
    shift = turns * 360
    return [[lon + shift, lat] for lon, lat in ring]


def _normalize_polygon(raw_polygon: Any, label: str, global_center: float | None) -> tuple[list[list[list[float]]], int, bool, float]:
    if not isinstance(raw_polygon, list) or not raw_polygon:
        raise InputError(f"{label} must have an exterior ring")
    rings: list[list[list[float]]] = []
    count, unsupported = 0, False
    exterior, ring_count, ambiguous = _ring(raw_polygon[0], f"{label} exterior")
    count += ring_count
    unsupported = unsupported or ambiguous
    if global_center is not None:
        try:
            exterior = _align(exterior, global_center)
        except UnsupportedGeometry:
            unsupported = True
    exterior_center = _center(exterior)
    rings.append(exterior)
    for index, raw_hole in enumerate(raw_polygon[1:], 1):
        hole, ring_count, ambiguous = _ring(raw_hole, f"{label} hole {index}")
        count += ring_count
        unsupported = unsupported or ambiguous
        try:
            hole = _align(hole, exterior_center)
        except UnsupportedGeometry:
            unsupported = True
        rings.append(hole)
    all_lons = [position[0] for ring in rings for position in ring]
    if max(all_lons) - min(all_lons) > 180 + 1e-10:
        unsupported = True
    return rings, count, unsupported, exterior_center


def _normalize_geometry(value: Any, key: str) -> tuple[dict[str, Any], int, bool]:
    if not isinstance(value, dict):
        raise InputError(f"feature {key} geometry must be an object")
    geometry_type = value.get("type")
    coordinates = value.get("coordinates")
    if geometry_type == "Polygon":
        polygons = [coordinates]
        is_multi = False
    elif geometry_type == "MultiPolygon":
        if not isinstance(coordinates, list) or not coordinates:
            raise InputError(f"feature {key} MultiPolygon is empty")
        polygons = coordinates
        is_multi = True
    else:
        raise InputError(f"feature {key} geometry must be Polygon or MultiPolygon")
    normalized: list[list[list[list[float]]]] = []
    total, unsupported = 0, False
    common_center: float | None = None
    for index, polygon in enumerate(polygons):
        rings, count, uncertain, center = _normalize_polygon(polygon, f"feature {key} polygon {index}", common_center)
        if common_center is None:
            common_center = center
        total += count
        if total > MAX_FEATURE_POSITIONS:
            raise InputError(f"feature {key} exceeds 40,000 coordinate positions")
        unsupported = unsupported or uncertain
        normalized.append(rings)
    all_longitudes = [position[0] for polygon in normalized for ring in polygon for position in ring]
    if max(all_longitudes) - min(all_longitudes) > 180 + 1e-10:
        unsupported = True
    if total < 1:
        raise InputError(f"feature {key} has no coordinates")
    if unsupported:
        # Still return normalized coordinates so every input feature has an explicit row;
        # unsupported images are never submitted to planar predicates.
        pass
    out_type = "MultiPolygon" if is_multi else "Polygon"
    out_coords: Any = normalized if is_multi else normalized[0]
    return {"type": out_type, "coordinates": out_coords}, total, unsupported


def _validate_runtime(extension_root: Path) -> tuple[Any, str, Path]:
    if sys.version_info[:2] != (3, 12):
        raise InputError("fine topology requires the pinned private Python 3.12 runtime")
    if not extension_root.is_absolute():
        raise InputError("extensionRoot must be absolute")
    expected_root = extension_root
    if expected_root.name != "osx_arm64" or expected_root.parent.name != "v1.5.6" or expected_root.parent.parent.name != "extensions" or expected_root.parent.parent.parent.name != "tooling":
        raise InputError("extensionRoot must be the pinned v1.5.6/osx_arm64 cache directory")
    build_root = expected_root.parent.parent.parent.parent
    if build_root.name != "world-build" or build_root.parent.name != ".cache":
        raise InputError("extensionRoot must be under the canonical .cache/world-build")
    _safe_components(build_root)
    _safe_components(extension_root)
    extension_path = extension_root / EXTENSION_NAME
    _safe_components(extension_path)
    info = extension_path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > 128 * 1024 * 1024:
        raise InputError("pinned Spatial extension is not a bounded regular file")
    if extension_path.resolve(strict=True) != extension_path:
        raise InputError("cached Spatial extension path is not canonical")
    fd = os.open(extension_path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        before = os.fstat(fd)
        hasher = hashlib.sha256()
        bytes_read = 0
        while True:
            chunk = os.read(fd, 1024 * 1024)
            if not chunk:
                break
            bytes_read += len(chunk)
            if bytes_read > 128 * 1024 * 1024:
                raise InputError("pinned Spatial extension grew beyond its 128 MiB read cap")
            hasher.update(chunk)
        after = os.fstat(fd)
        current = extension_path.lstat()
        if (current.st_dev, current.st_ino) != (before.st_dev, before.st_ino) or after.st_size != before.st_size or after.st_mtime_ns != before.st_mtime_ns or extension_path.resolve(strict=True) != extension_path:
            raise InputError("cached Spatial extension changed during hash verification")
    finally:
        os.close(fd)
    digest = hasher.hexdigest()
    if digest != SPATIAL_SHA256:
        raise InputError("cached Spatial extension hash does not match the reviewed pin")
    try:
        import duckdb
    except Exception as error:  # pragma: no cover - depends on runtime setup
        raise InputError(f"DuckDB is unavailable in the configured runtime: {error}") from error
    if duckdb.__version__ != DUCKDB_VERSION:
        raise InputError(f"DuckDB version must be {DUCKDB_VERSION}")
    connection = duckdb.connect(database=":memory:", config={
        "autoload_known_extensions": "false",
        "autoinstall_known_extensions": "false",
        "extension_directory": str(extension_root.parent.parent),
        "memory_limit": "128MB",
        "threads": "1",
        "max_temp_directory_size": "0B",
    })
    escaped = str(extension_path).replace("'", "''")
    try:
        connection.execute(f"LOAD '{escaped}'")
        connection.execute("LOAD json")
        runtime = connection.execute("SELECT version()").fetchone()
        extension = connection.execute("SELECT extension_version FROM duckdb_extensions() WHERE extension_name='spatial'").fetchone()
        if not runtime or runtime[0] != f"v{DUCKDB_VERSION}" or not extension or extension[0] != SPATIAL_VERSION:
            raise InputError("loaded DuckDB/Spatial runtime does not match the reviewed version pins")
        connection.execute("SET enable_external_access=false")
        return connection, str(extension[0]), build_root
    except Exception:
        connection.close()
        raise


def validate_request(request: Any) -> dict[str, Any]:
    if not isinstance(request, dict) or set(request) != {"schemaVersion", "input", "sourceSha256", "sourceBytes", "expectedUnits", "extensionRoot"}:
        raise InputError("request must contain exactly the versioned source and extension pins")
    if not isinstance(request["schemaVersion"], int) or isinstance(request["schemaVersion"], bool) or request["schemaVersion"] != 1:
        raise InputError("unsupported topology request schema")
    source_hash = request["sourceSha256"]
    if not isinstance(source_hash, str) or not HEX64.fullmatch(source_hash):
        raise InputError("sourceSha256 must be lowercase SHA-256")
    if (not isinstance(request["input"], str) or not Path(request["input"]).is_absolute()
            or str(Path(request["input"])) != request["input"] or ".." in Path(request["input"]).parts):
        raise InputError("input must be an absolute cache file path")
    if not isinstance(request["sourceBytes"], int) or isinstance(request["sourceBytes"], bool) or not 1 <= request["sourceBytes"] <= MAX_SOURCE_BYTES:
        raise InputError("sourceBytes must be between 1 and 8 MiB")
    if not isinstance(request["expectedUnits"], int) or isinstance(request["expectedUnits"], bool) or not 1 <= request["expectedUnits"] <= MAX_FEATURES:
        raise InputError("expectedUnits must be between 1 and 32")
    if not isinstance(request["extensionRoot"], str):
        raise InputError("extensionRoot must be a canonical absolute path string")
    extension_root = Path(request["extensionRoot"])
    if not extension_root.is_absolute():
        raise InputError("extensionRoot must be absolute")
    if str(extension_root) != request["extensionRoot"] or ".." in extension_root.parts:
        raise InputError("extensionRoot must be a canonical absolute path")
    connection, spatial_version, build_root = _validate_runtime(extension_root)
    source_path = Path(request["input"])
    expected_source = build_root / SOURCE_RELATIVE / f"{source_hash}.geojson"
    if source_path != expected_source:
        connection.close()
        raise InputError("input must be the exact source-hash path in fine-source-cache")
    return {"connection": connection, "spatialVersion": spatial_version, "buildRoot": build_root, "sourcePath": source_path}


def make_report(request: dict[str, Any], validated: dict[str, Any]) -> dict[str, Any]:
    source_hash = request["sourceSha256"]
    source_bytes = request["sourceBytes"]
    raw = _read_source(validated["sourcePath"], source_hash, source_bytes)
    features, _country_iso3 = _parse_source(raw, request["expectedUnits"])
    connection = validated["connection"]
    rows: list[dict[str, Any]] = []
    for key, geometry, unsupported in features:
        if unsupported:
            rows.append({"featureKey": key, "status": "unsupported", "valid": None, "empty": None,
                         "reason": "polar/global or ambiguous longitude image is outside this planar validator's supported domain"})
            continue
        try:
            geometry_json = _json_bytes(geometry).decode("utf-8")
            valid, empty = connection.execute(
                "SELECT ST_IsValid(ST_GeomFromGeoJSON(?)), ST_IsEmpty(ST_GeomFromGeoJSON(?))",
                [geometry_json, geometry_json],
            ).fetchone()
            if not isinstance(valid, bool) or not isinstance(empty, bool):
                raise InputError("DuckDB Spatial returned non-boolean topology predicates")
            status = "valid" if valid and not empty else "invalid"
            reason = None if status == "valid" else ("geometry is empty" if empty else "OGC planar geometry is invalid")
            rows.append({"featureKey": key, "status": status, "valid": valid, "empty": empty, "reason": reason})
        except InputError:
            raise
        except Exception as error:
            rows.append({"featureKey": key, "status": "invalid", "valid": False, "empty": None,
                         "reason": f"DuckDB Spatial could not evaluate geometry: {str(error)[:256]}"})
    valid_count = sum(row["status"] == "valid" for row in rows)
    invalid_count = sum(row["status"] == "invalid" for row in rows)
    unsupported_count = sum(row["status"] == "unsupported" for row in rows)
    exceptions = ["OGC validity uses only 2D longitude/latitude in a plane; higher ordinates are ignored and this does not establish spherical validity on the ellipsoid."]
    if unsupported_count:
        exceptions.append("Polar, global-span, or ambiguous longitude geometries are reported unsupported, not valid.")
    report = {
        "schemaVersion": 1,
        "validator": "duckdb-spatial-ogc-planar-v1",
        "sourceSha256": source_hash,
        "sourceBytes": source_bytes,
        "expectedUnits": request["expectedUnits"],
        "checkedUnits": valid_count + invalid_count,
        "validUnits": valid_count,
        "invalidUnits": invalid_count,
        "unsupportedUnits": unsupported_count,
        "tooling": {"duckdbVersion": DUCKDB_VERSION, "spatialVersion": validated["spatialVersion"], "spatialSha256": SPATIAL_SHA256},
        "rows": rows,
        "exceptions": exceptions,
    }
    if len(rows) != report["expectedUnits"] or valid_count + invalid_count + unsupported_count != len(rows):
        raise InputError("topology report feature conservation failed")
    if len(_json_bytes(report)) > MAX_REPORT_BYTES:
        raise InputError("topology report exceeds 64 KiB")
    return report


def main() -> int:
    connection = None
    try:
        raw_request = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
        if len(raw_request) > MAX_REQUEST_BYTES:
            raise InputError("request JSON exceeds 64 KiB")
        try:
            request = json.loads(raw_request.decode("utf-8"), object_pairs_hook=_pairs_no_duplicates,
                                 parse_constant=lambda token: (_ for _ in ()).throw(InputError(f"non-finite request number: {token}")))
        except InputError:
            raise
        except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as error:
            raise InputError(f"request is not valid bounded JSON: {error}") from error
        validated = validate_request(request)
        connection = validated["connection"]
        report = make_report(request, validated)
        sys.stdout.buffer.write(_json_bytes(report) + b"\n")
        sys.stdout.buffer.flush()
        return 0 if report["invalidUnits"] == 0 and report["unsupportedUnits"] == 0 else 2
    except Exception as error:
        message = str(error) or error.__class__.__name__
        sys.stderr.write((message[:2000] + "\n"))
        return 1
    finally:
        if connection is not None:
            connection.close()


if __name__ == "__main__":
    raise SystemExit(main())
