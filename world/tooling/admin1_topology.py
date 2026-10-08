#!/usr/bin/env python3
"""Bounded planar-topology evidence for the pinned Natural Earth Admin 1 source."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import os
import re
import stat
import sys
from pathlib import Path
from typing import Any

MAX_REQUEST_BYTES = 64 * 1024
MAX_SOURCE_BYTES = 64 * 1024 * 1024
MAX_UNITS = 10_000
MAX_FEATURE_POSITIONS = 100_000
MAX_TOTAL_POSITIONS = 3_000_000
MAX_REPORT_BYTES = 2 * 1024 * 1024
DUCKDB_VERSION = "1.5.6"
SPATIAL_VERSION = "04270fe"
SPATIAL_SHA256 = "e326286e0ff4651680bfa2918fb22990fed50cb7d27d79dd21143ac7e74b0da9"
VALIDATOR = "natural-earth-admin1-ogc-planar-v1"
HEX64 = re.compile(r"^[a-f0-9]{64}$")
DECIMAL_ID = re.compile(r"^[1-9][0-9]*$")
CRS84 = "urn:ogc:def:crs:OGC:1.3:CRS84"


class InputError(Exception):
    """The request/source violates an integrity, schema, or resource bound."""


class UnsupportedGeometry(Exception):
    """Source geometry is structurally present but outside supported input shape."""


def _duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            raise InputError(f"duplicate JSON object key: {key[:80]}")
        out[key] = value
    return out


def _finite_float(value: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed):
        raise InputError("source JSON contains a non-finite number")
    return parsed


def _canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=True, allow_nan=False, sort_keys=True,
                      separators=(",", ":")).encode("utf-8")


def _helper():
    helper_path = Path(__file__).with_name("fine_topology.py").resolve(strict=True)
    spec = importlib.util.spec_from_file_location("_pinned_fine_topology_helpers", helper_path)
    if spec is None or spec.loader is None:
        raise InputError("pinned geometry helper cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _safe_path(path: Path) -> None:
    if not path.is_absolute() or ".." in path.parts:
        raise InputError("cache path must be absolute and contain no parent traversal")
    current = Path(path.anchor)
    for offset, part in enumerate(path.parts[1:]):
        current /= part
        try:
            info = current.lstat()
        except FileNotFoundError as error:
            raise InputError(f"required path does not exist: {current}") from error
        if stat.S_ISLNK(info.st_mode):
            raise InputError(f"symlink path component is refused: {current}")
        if offset < len(path.parts[1:]) - 1 and not stat.S_ISDIR(info.st_mode):
            raise InputError(f"non-directory path ancestor: {current}")


def _read_source(path: Path, digest: str, expected_bytes: int) -> bytes:
    if not HEX64.fullmatch(digest):
        raise InputError("sourceSha256 must be lowercase SHA-256")
    if isinstance(expected_bytes, bool) or not isinstance(expected_bytes, int) or not 1 <= expected_bytes <= MAX_SOURCE_BYTES:
        raise InputError("sourceBytes must be between 1 byte and 64 MiB")
    _safe_path(path)
    if path.resolve(strict=True) != path:
        raise InputError("source cache path is not canonical")
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size != expected_bytes:
        raise InputError("source cache file is not regular or its size differs from the pin")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        before = os.fstat(fd)
        remaining = expected_bytes + 1
        chunks: list[bytes] = []
        while remaining:
            chunk = os.read(fd, min(1024 * 1024, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
        after = os.fstat(fd)
        current = path.lstat()
        if ((current.st_dev, current.st_ino) != (before.st_dev, before.st_ino)
                or after.st_size != before.st_size or after.st_mtime_ns != before.st_mtime_ns
                or after.st_ctime_ns != before.st_ctime_ns or path.resolve(strict=True) != path):
            raise InputError("source cache file changed during bounded read")
    finally:
        os.close(fd)
    if len(raw) != expected_bytes or hashlib.sha256(raw).hexdigest() != digest:
        raise InputError("source cache bytes or SHA-256 differ from the request pin")
    return raw


def _count_positions(value: Any, feature_key: str) -> int:
    """Count coordinate leaves iteratively, enforcing caps before geometry work."""
    stack: list[tuple[Any, int]] = [(iter((value,)), 0)]
    count = 0
    while stack:
        iterator, depth = stack[-1]
        try:
            item = next(iterator)
        except StopIteration:
            stack.pop()
            continue
        if not isinstance(item, list):
            continue
        if item and all(not isinstance(child, (list, dict)) for child in item):
            count += 1
            if count > MAX_FEATURE_POSITIONS:
                raise InputError(f"feature {feature_key} exceeds 100,000 coordinate positions")
            continue
        if depth >= 8:
            raise InputError(f"feature {feature_key} exceeds the bounded geometry traversal depth")
        stack.append((iter(item), depth + 1))
    return count


def _unsupported(message: str) -> dict[str, Any]:
    reason = message
    while len(reason.encode("utf-8")) > 256:
        reason = reason[:-1]
    return {"status": "unsupported", "valid": None, "empty": None, "reason": reason or "unsupported geometry"}


def _normalise_geometry(helper: Any, geometry: Any, feature_key: str, source_positions: int) -> tuple[dict[str, Any] | None, str | None]:
    try:
        if not isinstance(geometry, dict):
            raise helper.InputError("geometry must be an object")
        geometry_type, coordinates = geometry.get("type"), geometry.get("coordinates")
        if geometry_type == "Polygon":
            polygons, is_multi = [coordinates], False
        elif geometry_type == "MultiPolygon":
            if not isinstance(coordinates, list) or not coordinates:
                raise helper.InputError("MultiPolygon must contain polygons")
            polygons, is_multi = coordinates, True
        else:
            raise helper.InputError("geometry type must be Polygon or MultiPolygon")
        normalized: list[list[list[list[float]]]] = []
        common_center: float | None = None
        used = 0
        unsupported = False
        for number, polygon in enumerate(polygons):
            rings, count, ambiguous, center = helper._normalize_polygon(polygon, f"feature {feature_key} polygon {number}", common_center)
            used += count
            if used > MAX_FEATURE_POSITIONS:
                raise InputError(f"feature {feature_key} exceeds 100,000 normalized positions")
            if common_center is None:
                common_center = center
            unsupported |= ambiguous
            normalized.append(rings)
        if used != source_positions:
            raise helper.InputError("coordinate structure contains malformed position values")
        all_longitudes = [point[0] for polygon in normalized for ring in polygon for point in ring]
        if not all_longitudes or max(all_longitudes) - min(all_longitudes) > 180 + 1e-10:
            unsupported = True
        if unsupported:
            return None, "polar, global-span, or ambiguous longitude image is outside this planar validator's supported domain"
        return {"type": "MultiPolygon" if is_multi else "Polygon", "coordinates": normalized if is_multi else normalized[0]}, None
    except (helper.InputError, UnsupportedGeometry, OverflowError) as error:
        return None, str(error)


def _parse_request(raw: bytes) -> dict[str, Any]:
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_duplicates,
                           parse_constant=lambda token: (_ for _ in ()).throw(InputError(f"non-finite JSON token: {token}")),
                           parse_float=_finite_float)
    except InputError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError, ValueError) as error:
        raise InputError(f"request is not valid bounded UTF-8 JSON: {error}") from error
    fields = {"schemaVersion", "input", "sourceSha256", "sourceBytes", "expectedUnits", "extensionRoot"}
    if not isinstance(value, dict) or set(value) != fields or type(value.get("schemaVersion")) is not int or value["schemaVersion"] != 1:
        raise InputError("request must contain exactly the versioned Admin 1 source and extension pins")
    if type(value["expectedUnits"]) is not int or not 1 <= value["expectedUnits"] <= MAX_UNITS:
        raise InputError("expectedUnits must be between 1 and 10,000")
    if type(value["sourceBytes"]) is not int or not 1 <= value["sourceBytes"] <= MAX_SOURCE_BYTES:
        raise InputError("sourceBytes must be between 1 byte and 64 MiB")
    if not isinstance(value["sourceSha256"], str) or not HEX64.fullmatch(value["sourceSha256"]):
        raise InputError("sourceSha256 must be lowercase SHA-256")
    if not isinstance(value["input"], str) or not isinstance(value["extensionRoot"], str):
        raise InputError("input and extensionRoot must be absolute cache path strings")
    input_path, extension_root = Path(value["input"]), Path(value["extensionRoot"])
    if not input_path.is_absolute() or str(input_path) != value["input"] or ".." in input_path.parts:
        raise InputError("input must be an exact absolute cache path")
    if not extension_root.is_absolute() or str(extension_root) != value["extensionRoot"] or ".." in extension_root.parts:
        raise InputError("extensionRoot must be a canonical absolute path")
    if not re.fullmatch(r"[a-f0-9]{64}\.geojson", input_path.name):
        raise InputError("input filename must be the immutable capture request hash")
    return value


def _read_feature_collection(raw: bytes, expected_units: int) -> list[dict[str, Any]]:
    try:
        document = json.loads(raw.decode("utf-8"), object_pairs_hook=_duplicates,
                              parse_constant=lambda token: (_ for _ in ()).throw(InputError(f"non-finite JSON token: {token}")),
                              parse_float=_finite_float)
    except InputError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError, ValueError) as error:
        raise InputError(f"source is not valid bounded UTF-8 GeoJSON: {error}") from error
    if not isinstance(document, dict) or document.get("type") != "FeatureCollection":
        raise InputError("source must be a GeoJSON FeatureCollection")
    if "crs" in document and document["crs"] != {"type": "name", "properties": {"name": CRS84}}:
        raise InputError("source CRS must be absent or the exact CRS84 declaration")
    features = document.get("features")
    if not isinstance(features, list) or len(features) != expected_units:
        raise InputError("feature count differs from expectedUnits")
    return features


def _evaluate(features: list[dict[str, Any]], raw_bytes: bytes, request: dict[str, Any], connection: Any,
              helper: Any) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    total_positions = 0
    for ordinal, feature in enumerate(features):
        if not isinstance(feature, dict) or feature.get("type") != "Feature":
            raise InputError(f"feature {ordinal} is not a GeoJSON Feature")
        properties = feature.get("properties")
        if not isinstance(properties, dict):
            raise InputError(f"feature {ordinal} properties must be an object")
        raw_id = properties.get("ne_id")
        if isinstance(raw_id, bool) or not isinstance(raw_id, (int, float, str)):
            raise InputError(f"feature {ordinal} lowercase ne_id must be a numeric safe integer or canonical decimal string")
        if isinstance(raw_id, float):
            if not math.isfinite(raw_id) or not raw_id.is_integer() or not 1 <= raw_id <= 9_007_199_254_740_991:
                raise InputError(f"feature {ordinal} lowercase ne_id is not a canonical positive safe integer")
            key_value = str(int(raw_id))
        else:
            key_value = str(raw_id)
        if not DECIMAL_ID.fullmatch(key_value) or len(key_value) > 16 or not 1 <= int(key_value) <= 9_007_199_254_740_991:
            raise InputError(f"feature {ordinal} lowercase ne_id is not a canonical positive safe integer")
        if isinstance(raw_id, int) and raw_id != int(key_value) or isinstance(raw_id, str) and raw_id != key_value or isinstance(raw_id, float) and raw_id != int(key_value):
            raise InputError(f"feature {ordinal} lowercase ne_id is not canonical")
        source_key = f"NE_ID:{key_value}"
        if source_key in seen:
            raise InputError(f"duplicate Admin 1 source key: {source_key}")
        seen.add(source_key)
        geometry = feature.get("geometry")
        coordinates = geometry.get("coordinates") if isinstance(geometry, dict) else None
        try:
            position_count = _count_positions(coordinates, source_key)
        except UnsupportedGeometry as error:
            position_count = 0
            position_issue = str(error)
        else:
            position_issue = None
        total_positions += position_count
        if total_positions > MAX_TOTAL_POSITIONS:
            raise InputError("source exceeds 3,000,000 coordinate positions")
        if position_count > MAX_FEATURE_POSITIONS:
            raise InputError(f"feature {source_key} exceeds 100,000 coordinate positions")
        if properties.get("adm0_a3") == "NGA":
            rows.append({"sourceOrdinal": ordinal, "sourceKey": source_key, "status": "protected", "valid": None, "empty": None,
                         "reason": "protected-nigeria-no-topology"})
            continue
        if position_issue is not None:
            rows.append({"sourceOrdinal": ordinal, "sourceKey": source_key, **_unsupported(position_issue)})
            continue
        normalized, issue = _normalise_geometry(helper, geometry, source_key, position_count)
        if issue is not None or normalized is None:
            rows.append({"sourceOrdinal": ordinal, "sourceKey": source_key, **_unsupported(issue or "geometry is unsupported")})
            continue
        geometry_bytes = _canonical_json(normalized).decode("utf-8")
        try:
            valid, empty = connection.execute(
                "SELECT ST_IsValid(ST_GeomFromGeoJSON(?)), ST_IsEmpty(ST_GeomFromGeoJSON(?))",
                [geometry_bytes, geometry_bytes],
            ).fetchone()
        except Exception as error:
            raise InputError(f"DuckDB Spatial predicate evaluation failed for {source_key}: {str(error)[:512]}") from error
        if not isinstance(valid, bool) or not isinstance(empty, bool):
            raise InputError("DuckDB Spatial returned non-boolean topology predicates")
        status = "valid" if valid and not empty else "invalid"
        reason = None if status == "valid" else ("geometry is empty" if empty else "OGC planar geometry is invalid")
        rows.append({"sourceOrdinal": ordinal, "sourceKey": source_key, "status": status, "valid": valid, "empty": empty, "reason": reason})
    rows.sort(key=lambda row: row["sourceKey"])
    report = {"schemaVersion": 1, "validator": VALIDATOR, "sourceSha256": request["sourceSha256"],
              "sourceBytes": len(raw_bytes), "expectedUnits": request["expectedUnits"],
              "tooling": {"duckdbVersion": DUCKDB_VERSION, "spatialVersion": SPATIAL_VERSION, "spatialSha256": SPATIAL_SHA256},
              "rows": rows}
    output = _canonical_json(report) + b"\n"
    if len(output) > MAX_REPORT_BYTES:
        raise InputError("Admin 1 topology report exceeds 2 MiB")
    return report


def execute(request: dict[str, Any]) -> dict[str, Any]:
    helper = _helper()
    extension_root = Path(request["extensionRoot"])
    extension_path = extension_root / helper.EXTENSION_NAME
    # The pinned helper validates its fixed runtime and loads only the local pinned extension.
    connection, spatial_version, build_root = helper._validate_runtime(extension_root)
    try:
        expected_parent = build_root / "admin1-source-cache"
        source_path = Path(request["input"])
        if source_path.parent != expected_parent or not source_path.name.endswith(".geojson"):
            raise InputError("input must be the exact cached Admin 1 capture-request path")
        raw = _read_source(source_path, request["sourceSha256"], request["sourceBytes"])
        features = _read_feature_collection(raw, request["expectedUnits"])
        if spatial_version != SPATIAL_VERSION:
            raise InputError("loaded Spatial version differs from the pinned version")
        return _evaluate(features, raw, request, connection, helper)
    finally:
        connection.close()


def main() -> int:
    try:
        raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
        if len(raw) > MAX_REQUEST_BYTES:
            raise InputError("request JSON exceeds the 64 KiB limit")
        request = _parse_request(raw)
        report = execute(request)
        output = _canonical_json(report) + b"\n"
        if len(output) > MAX_REPORT_BYTES:
            raise InputError("Admin 1 topology report exceeds 2 MiB")
        sys.stdout.buffer.write(output)
        sys.stdout.buffer.flush()
        substantive = [row for row in report["rows"] if row["status"] != "protected"]
        return 2 if any(row["status"] in ("invalid", "unsupported") for row in substantive) else 0
    except Exception as error:
        message = (str(error) or error.__class__.__name__)[:2000]
        sys.stderr.write(message + "\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
