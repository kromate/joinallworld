#!/usr/bin/env python3
"""Read-only standard-library verifier for one published climate attachment."""

from __future__ import annotations

import argparse
import calendar
import hashlib
import json
import math
import os
import re
import stat
import sys
import time
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlencode

PRODUCT = "city-associated-monthly-climate-v1"
COMPILER = "climate-attachment-compiler-v1"
POLICY = "explicit-pinned-city-association-v1"
PIN_REL = "world/climate-attachment-pins.json"
OUTPUT_REL = ".cache/world-build/output/climate-packs"
NO_CLIMATE = "climate unavailable: no monthly regional climate source was provided"
PROVENANCE_PREFIX = "Climate attachment provenance sha256:"
CLIMATE_PREFIXES = ("Climate association:", "Climate sample:", "Climate baseline:")
SHA = re.compile(r"^[a-f0-9]{64}$")
MAX_PINS = 64 * 1024
MAX_BASE = 128 * 1024
MAX_ENV = 16 * 1024
MAX_RAW = 1_000_000
MAX_TILE = 1_048_576
MAX_MANIFEST = 128 * 1024
MAX_PROVENANCE = 64 * 1024
MAX_TILES = 64
MAX_LOGICAL = 8 * 1024 * 1024
MAX_TREE_BYTES = 24 * 1024 * 1024
MAX_TREE_ENTRIES = 1024
MAX_TREE_DEPTH = 4
MONTHLY_KEYS = tuple(f"{year}{month:02d}" for year in range(1991, 2021) for month in range(1, 13))
ANNUAL_KEYS = tuple(f"{year}13" for year in range(1991, 2021))
PARAMETERS = ("T2M", "RH2M", "PRECTOTCORR", "WS10M")
UNITS = {"T2M": "C", "RH2M": "%", "PRECTOTCORR": "mm/day", "WS10M": "m/s"}
LONGNAMES = {"T2M": "Temperature at 2 Meters", "RH2M": "Relative Humidity at 2 Meters", "PRECTOTCORR": "Precipitation Corrected", "WS10M": "Wind Speed at 10 Meters"}
SUMMARIES = {
    "temperature": "Arithmetic mean of the 30 provider monthly mean temperatures for the same calendar month, degrees Celsius.",
    "humidity": "Arithmetic mean of the 30 direct provider RH2M monthly mean relative-humidity values; no derivation from temperature/dewpoint.",
    "precipitation": "For each year and month, PRECTOTCORR monthly mean rate (mm/day) multiplied by the actual calendar days in that month; then arithmetic mean of the 30 resulting monthly totals (mm).",
    "wind": "Arithmetic mean of the provider scalar WS10M monthly mean wind speeds at 10 m; not a vector-component-derived speed.",
}


class VerificationError(Exception):
    pass


def fail(message: str) -> None:
    raise VerificationError(message)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _reject_constant(value: str) -> None:
    fail(f"JSON contains non-finite constant {value}")


def _unique_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            fail(f"JSON repeats object key {key!r}")
        result[key] = value
    return result


def parse_json(data: bytes, label: str) -> Any:
    try:
        value = json.loads(data.decode("utf-8", "strict"), object_pairs_hook=_unique_pairs, parse_constant=_reject_constant)
    except VerificationError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as exc:
        fail(f"{label} is not bounded UTF-8 JSON: {exc}")
    stack = [(value, 0)]
    while stack:
        current, depth = stack.pop()
        if depth > 64:
            fail(f"{label} exceeds JSON nesting limit")
        if isinstance(current, float) and not math.isfinite(current):
            fail(f"{label} contains non-finite number")
        if isinstance(current, dict):
            stack.extend((item, depth + 1) for item in current.values())
        elif isinstance(current, list):
            stack.extend((item, depth + 1) for item in current)
    return value


def canonical_root(text: str) -> Path:
    root = Path(text)
    if not root.is_absolute() or str(root) != text:
        fail("repository root must be canonical absolute path text")
    _reject_ancestors(root)
    try:
        info = os.lstat(root)
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode) or root.resolve(strict=True) != root:
            fail("repository root must be a canonical real directory")
    except OSError as exc:
        fail(f"cannot inspect repository root: {exc}")
    return root


def _reject_ancestors(target: Path) -> None:
    absolute = Path(os.path.abspath(target))
    cursor = Path(absolute.anchor)
    for part in absolute.parts[1:]:
        cursor /= part
        try:
            info = os.lstat(cursor)
        except FileNotFoundError:
            fail(f"path ancestor is missing: {cursor}")
        if stat.S_ISLNK(info.st_mode):
            fail(f"path contains symlink ancestor: {cursor}")


def _safe_relative(relative: str) -> PurePosixPath:
    if not isinstance(relative, str) or not relative or "\\" in relative or "\x00" in relative:
        fail("path is empty or invalid")
    if any(part in ("", ".", "..") for part in relative.split("/")):
        fail("path is not canonical or escapes its repository root")
    rel = PurePosixPath(relative)
    if rel.is_absolute():
        fail("path escapes its repository root")
    return rel


def safe_read(root: Path, relative: str, cap: int, label: str) -> bytes:
    rel = _safe_relative(relative)
    path = root.joinpath(*rel.parts)
    try:
        _reject_ancestors(path)
        before = os.lstat(path)
        if not stat.S_ISREG(before.st_mode) or stat.S_ISLNK(before.st_mode) or before.st_size > cap:
            fail(f"{label} is oversized, nonregular, or a symlink")
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        try:
            opened = os.fstat(fd)
            if not stat.S_ISREG(opened.st_mode) or opened.st_size > cap:
                fail(f"{label} changed to an unsafe or oversized file")
            chunks: list[bytes] = []
            total = 0
            while True:
                block = os.read(fd, min(64 * 1024, cap + 1 - total))
                if not block:
                    break
                chunks.append(block)
                total += len(block)
                if total > cap:
                    fail(f"{label} exceeds {cap} byte cap")
            after = os.fstat(fd)
            if total != opened.st_size or after.st_size != opened.st_size or after.st_mtime_ns != opened.st_mtime_ns:
                fail(f"{label} changed during read")
            return b"".join(chunks)
        finally:
            os.close(fd)
    except VerificationError:
        raise
    except OSError as exc:
        fail(f"cannot safely read {label}: {exc}")


def file_pin(root: Path, pin: Any, cap: int, prefix: str, label: str) -> tuple[bytes, str]:
    if not isinstance(pin, dict) or set(pin) != {"sha256", "bytes", "path"}:
        fail(f"{label} pin has unexpected fields")
    sha = pin["sha256"]
    length = pin["bytes"]
    path = pin["path"]
    if not isinstance(sha, str) or not SHA.fullmatch(sha) or isinstance(length, bool) or not isinstance(length, int) or not 1 <= length <= cap:
        fail(f"{label} pin hash or size is invalid")
    _safe_relative(path)
    if path != f"{prefix}{sha}.json":
        fail(f"{label} pin path is not the exact hash-addressed file")
    data = safe_read(root, path, cap, label)
    if len(data) != length or digest(data) != sha:
        fail(f"{label} bytes do not match their pin")
    return data, path


def exact(row: Any, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(row, dict) or row.keys() != keys:
        fail(f"{label} fields are malformed")
    return row


def finite(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        fail(f"{label} must be finite numeric data")
    return float(value)


def equal_number(a: Any, b: Any, label: str, tolerance: float = 1e-10) -> None:
    if abs(finite(a, label) - finite(b, label)) > tolerance:
        fail(f"{label} differs from independent raw-source reconstruction")


def safe_sha(value: Any, label: str) -> str:
    if not isinstance(value, str) or not SHA.fullmatch(value):
        fail(f"{label} is not lowercase SHA-256")
    return value


def source_record(value: Any, label: str) -> dict[str, Any]:
    row = exact(value, {"id", "url", "release", "license", "attribution", "sha256", "bytes"}, label)
    for field in ("id", "url", "release", "license", "attribution"):
        if not isinstance(row[field], str) or not row[field] or len(row[field]) > 4096:
            fail(f"{label}.{field} is invalid")
    safe_sha(row["sha256"], f"{label}.sha256")
    if isinstance(row["bytes"], bool) or not isinstance(row["bytes"], int) or row["bytes"] < 1:
        fail(f"{label}.bytes is invalid")
    return row


def checked_tree(root: Path) -> tuple[int, int]:
    if not root.exists():
        fail("published climate output directory does not exist")
    _reject_ancestors(root)
    try:
        info = os.lstat(root)
    except OSError as exc:
        fail(f"cannot inspect climate output tree: {exc}")
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        fail("climate output root is not a real directory")
    pending: list[tuple[Path, int]] = [(root, 0)]
    entries = total = 0
    while pending:
        directory, depth = pending.pop()
        if depth > MAX_TREE_DEPTH:
            fail("climate output tree exceeds depth cap")
        try:
            with os.scandir(directory) as scan:
                for entry in scan:
                    entries += 1
                    if entries > MAX_TREE_ENTRIES:
                        fail("climate output tree exceeds entry cap")
                    item = Path(entry.path)
                    st = os.lstat(item)
                    if stat.S_ISLNK(st.st_mode):
                        fail("climate output tree contains a symlink")
                    if stat.S_ISDIR(st.st_mode):
                        pending.append((item, depth + 1))
                    elif stat.S_ISREG(st.st_mode):
                        total += st.st_size
                        if total > MAX_TREE_BYTES:
                            fail("climate output tree exceeds byte cap")
                    else:
                        fail("climate output tree contains a special file")
        except OSError as exc:
            fail(f"cannot scan climate output tree: {exc}")
    return total, entries


def _inside(lon: float, lat: float, bounds: list[Any]) -> bool:
    if not isinstance(bounds, list) or len(bounds) != 4:
        fail("pack region bounds are invalid")
    west, south, east, north = (finite(item, "region bound") for item in bounds)
    lon_inside = west <= lon <= east if west <= east else lon >= west or lon <= east
    return lon_inside and south <= lat <= north


def _round3(value: float) -> float:
    return float(f"{value:.3f}")


def _js_num(value: Any) -> str:
    number = finite(value, "disclosure number")
    if number == 0:
        return "0"
    if number.is_integer():
        return str(int(number))
    return str(number)


def _expected_power_url(request: dict[str, Any]) -> str:
    query = urlencode({
        "parameters": ",".join(PARAMETERS), "community": "SB",
        "longitude": str(request["longitude"]), "latitude": str(request["latitude"]),
        "start": "1991", "end": "2020", "format": "JSON",
    })
    return f"https://power.larc.nasa.gov/api/temporal/monthly/point?{query}"


def _mean(values: list[float]) -> float:
    return sum(values) / len(values)


def reconstruct_profile(raw: Any, binding: dict[str, Any], raw_sha: str, raw_bytes: int) -> tuple[dict[str, Any], dict[str, Any]]:
    root = exact(raw, {"type", "geometry", "properties", "header", "messages", "parameters", "times"}, "raw POWER response")
    if root["type"] != "Feature" or not isinstance(root["messages"], list) or not isinstance(root["times"], dict):
        fail("raw POWER response envelope is invalid")
    header = exact(root["header"], {"title", "api", "sources", "fill_value", "time_standard", "start", "end"}, "POWER header")
    api = header["api"]
    if not isinstance(api, dict) or set(api) != {"version", "name"} or not isinstance(api.get("version"), str) or not api["version"] or api.get("name") != "POWER Monthly and Annual API" or "Monthly and Annual" not in str(header["title"]):
        fail("POWER API metadata is not monthly")
    if header["sources"] != ["MERRA2", "POWER"] or header["time_standard"] != "LST" or header["start"] != "19910101" or header["end"] != "20201231":
        fail("POWER source, LST period, or requested dates differ from the admitted baseline")
    fill = finite(header["fill_value"], "POWER fill value")
    if fill != -999:
        fail("POWER fill value differs from the pinned contract")
    properties = exact(root["properties"], {"parameter"}, "POWER properties")
    parameters = properties["parameter"]
    metadata = root["parameters"]
    if not isinstance(parameters, dict) or parameters.keys() != set(PARAMETERS) or not isinstance(metadata, dict) or metadata.keys() != set(PARAMETERS):
        fail("POWER response parameter set differs")
    geometry = exact(root["geometry"], {"type", "coordinates"}, "POWER geometry")
    coords = geometry["coordinates"]
    if geometry["type"] != "Point" or not isinstance(coords, list) or len(coords) < 2:
        fail("POWER response must preserve its point geometry")
    returned = [finite(coords[0], "returned longitude"), finite(coords[1], "returned latitude")]
    request = exact(binding["environmentRequest"], {"schemaVersion", "id", "regionId", "name", "longitude", "latitude", "baseline"}, "environment request")
    requested = [finite(request["longitude"], "requested longitude"), finite(request["latitude"], "requested latitude")]
    if returned != [_round3(requested[0]), _round3(requested[1])]:
        fail("POWER response coordinates do not match rounded requested coordinates")
    sample = exact(binding["expectedSample"], {"longitude", "latitude"}, "expected sample")
    if returned != [finite(sample["longitude"], "pinned sample longitude"), finite(sample["latitude"], "pinned sample latitude")]:
        fail("POWER response coordinates differ from the pinned returned sample")

    expected_keys = set(MONTHLY_KEYS + ANNUAL_KEYS)
    values: dict[str, dict[str, float]] = {}
    for name in PARAMETERS:
        parameter = parameters[name]
        if not isinstance(parameter, dict) or set(parameter) != expected_keys:
            fail(f"POWER {name} key set or record count differs")
        metadata_row = metadata[name]
        if not isinstance(metadata_row, dict) or set(metadata_row) != {"units", "longname"} or metadata_row["units"] != UNITS[name] or metadata_row["longname"] != LONGNAMES[name]:
            fail(f"POWER {name} metadata or units differ")
        series = {key: finite(parameter[key], f"POWER {name} {key}") for key in MONTHLY_KEYS + ANNUAL_KEYS}
        if any(value == fill for value in series.values()):
            fail(f"POWER {name} contains fill value")
        values[name] = series

    months = []
    for month in range(1, 13):
        observations: dict[str, list[float]] = {name: [] for name in PARAMETERS}
        for year in range(1991, 2021):
            key = f"{year}{month:02d}"
            days = calendar.monthrange(year, month)[1]
            for name in PARAMETERS:
                value = values[name][key]
                observations[name].append(value * days if name == "PRECTOTCORR" else value)
        months.append({
            "temperatureC": _mean(observations["T2M"]),
            "relativeHumidityPct": _mean(observations["RH2M"]),
            "precipitationMm": _mean(observations["PRECTOTCORR"]),
            "windMps": _mean(observations["WS10M"]),
        })
    source = {
        "id": f"nasa-power-merra2-{raw_sha[:16]}",
        "url": binding["rawSource"]["url"],
        "release": f"POWER {api['version']} · MERRA-2 · 1991–2020",
        "license": "NASA Earthdata data-use policy; API response supplies no separate product license",
        "attribution": "NASA Langley Research Center POWER; meteorology from NASA GMAO MERRA-2",
        "sha256": raw_sha, "bytes": raw_bytes,
        "provider": "NASA POWER", "apiVersion": api["version"], "product": "monthly point",
        "sourceDatasets": header["sources"], "timeStandard": "LST", "fillValue": fill,
        "units": UNITS, "spatialResolution": {"latitudeDegrees": 0.5, "longitudeDegrees": 0.625},
        "requestedParameters": list(PARAMETERS), "monthlyRecordCount": 360, "annualRecordCount": 30,
    }
    environment = {
        "schemaVersion": 1,
        "id": f"environment:{request['regionId']}:{raw_sha[:16]}",
        "region": {"id": request["regionId"], "name": request["name"]},
        "point": {"longitude": returned[0], "latitude": returned[1], "requestedLongitude": requested[0], "requestedLatitude": requested[1], "semantics": "representative-point-selected-on-native-source-grid"},
        "baseline": {"startYear": 1991, "endYear": 2020, "years": 30},
        "profile": {"sourceId": source["id"], "period": "1991–2020 monthly normals", "months": months},
        "source": source,
        "derivation": {"algorithmVersion": "power-monthly-normal-v1", **SUMMARIES},
        "exceptions": ["The requested coordinate is rounded to three decimal places by the NASA POWER service. The returned point is one native-grid sample, not a region-wide spatial average."],
    }
    return environment["profile"], environment


def _compare_environment(actual: Any, expected: dict[str, Any]) -> None:
    if not isinstance(actual, dict) or set(actual) != set(expected):
        fail("environment sidecar fields differ from independent reconstruction")
    for key, value in expected.items():
        if key != "profile":
            if actual[key] != value:
                fail(f"environment sidecar {key} differs from independent reconstruction")
            continue
        got = actual[key]
        if not isinstance(got, dict) or set(got) != set(value):
            fail("environment climate profile fields differ")
        if got["sourceId"] != value["sourceId"] or got["period"] != value["period"] or not isinstance(got["months"], list) or len(got["months"]) != 12:
            fail("environment climate profile identity or month count differs")
        for month_index, (actual_month, expected_month) in enumerate(zip(got["months"], value["months"])):
            if not isinstance(actual_month, dict) or actual_month.keys() != expected_month.keys():
                fail(f"environment climate month {month_index + 1} fields differ")
            for key, expected_value in expected_month.items():
                equal_number(actual_month[key], expected_value, f"environment month {month_index + 1} {key}")


def _source_simple(environment_source: dict[str, Any]) -> dict[str, Any]:
    keys = ("id", "url", "release", "license", "attribution", "sha256", "bytes")
    return {key: environment_source[key] for key in keys}


def _validate_binding(binding: Any, binding_id: str) -> dict[str, Any]:
    expected = {"schemaVersion", "id", "campaignId", "baseManifest", "expectedRegion", "environmentManifest", "environmentRequest", "rawSource", "expectedSample", "association"}
    row = exact(binding, expected, "climate binding")
    if row["schemaVersion"] != 1 or row["id"] != binding_id or not isinstance(row["campaignId"], str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", row["campaignId"]):
        fail("selected climate binding identity is invalid")
    base = row["baseManifest"]
    env = row["environmentManifest"]
    raw = row["rawSource"]
    for pin, cap, prefix, label in (
        (base, MAX_BASE, f".cache/world-build/campaigns/{row['campaignId']}/output/manifests/", "base manifest"),
        (env, MAX_ENV, ".cache/world-build/output/environment/manifests/", "environment manifest"),
    ):
        if not isinstance(pin, dict) or set(pin) != {"sha256", "bytes", "path"}:
            fail(f"{label} pin fields are invalid")
        if not isinstance(pin["sha256"], str) or not SHA.fullmatch(pin["sha256"]):
            fail(f"{label} SHA-256 is invalid")
        if isinstance(pin["bytes"], bool) or not isinstance(pin["bytes"], int) or not 1 <= pin["bytes"] <= cap:
            fail(f"{label} byte length is outside its limit")
        _safe_relative(pin["path"])
        if pin["path"] != f"{prefix}{pin['sha256']}.json":
            fail(f"{label} path is not canonical and content-addressed")
    if not isinstance(raw, dict) or set(raw) != {"sha256", "bytes", "path", "url"}:
        fail("raw source pin fields are invalid")
    if not isinstance(raw["sha256"], str) or not SHA.fullmatch(raw["sha256"]) or isinstance(raw["bytes"], bool) or not isinstance(raw["bytes"], int) or not 1 <= raw["bytes"] <= MAX_RAW:
        fail("raw source pin hash or byte length is invalid")
    _safe_relative(raw["path"])
    if not raw["path"].startswith(".cache/world-build/environment-source-cache/") or not re.fullmatch(r"\.cache/world-build/environment-source-cache/[A-Za-z0-9._-]+\.json", raw["path"]):
        fail("raw source path is not canonical within the pinned source cache")
    request = exact(row["environmentRequest"], {"schemaVersion", "id", "regionId", "name", "longitude", "latitude", "baseline"}, "environment request")
    if request["schemaVersion"] != 1 or request["id"] != binding_id or request["regionId"] != f"pilot:{binding_id}" or not isinstance(request["name"], str) or not request["name"]:
        fail("environment request identity is invalid")
    if exact(request["baseline"], {"startYear", "endYear"}, "environment request baseline") != {"startYear": 1991, "endYear": 2020}:
        fail("environment request period differs from the pinned baseline")
    req_lon = finite(request["longitude"], "requested longitude")
    req_lat = finite(request["latitude"], "requested latitude")
    if not -180 <= req_lon <= 180 or not -90 <= req_lat <= 90 or raw["url"] != _expected_power_url(request):
        fail("requested coordinate or exact NASA POWER URL differs")
    region = row["expectedRegion"]
    if not isinstance(region, dict) or set(region) != {"id", "parentId", "name", "kind", "countryCode", "timezone", "bounds"} or region["countryCode"] == "NG" or region["parentId"] == "legacy-ng":
        fail("expected region is invalid or Nigeria-protected")
    if not isinstance(region["bounds"], list) or len(region["bounds"]) != 4:
        fail("expected region bounds are invalid")
    bounds = [finite(item, "expected region bound") for item in region["bounds"]]
    if not (-180 <= bounds[0] <= 180 and -180 <= bounds[2] <= 180 and -90 <= bounds[1] <= bounds[3] <= 90):
        fail("expected region bounds are outside WGS84")
    if region["kind"] not in ("city", "cell") or not isinstance(region["countryCode"], str) or not re.fullmatch(r"[A-Z]{2}", region["countryCode"]):
        fail("expected region must be a city/cell in a known ISO alpha-2 country")
    for field in ("id", "parentId", "name", "timezone"):
        if not isinstance(region[field], str) or not region[field].strip():
            fail(f"expected region {field} must be a nonempty string")
    if region["id"] == "legacy-ng" or region["parentId"] == "legacy-ng":
        fail("Nigeria climate association is protected")
    sample = exact(row["expectedSample"], {"longitude", "latitude"}, "expected sample")
    sample_lon, sample_lat = finite(sample["longitude"], "sample longitude"), finite(sample["latitude"], "sample latitude")
    association = exact(row["association"], {"mode", "sampleInsidePackBounds", "centreOffsetDegrees", "maximumAbsoluteCentreOffsetDegrees", "disclosure"}, "association")
    if association["mode"] != "explicit-city-associated-native-grid-point" or association["maximumAbsoluteCentreOffsetDegrees"] != 0.01 or not isinstance(association["disclosure"], str) or not association["disclosure"].strip():
        fail("explicit association policy is invalid")
    offsets = exact(association["centreOffsetDegrees"], {"longitude", "latitude"}, "centre offsets")
    west, south, east, north = bounds
    center_lon = (west + (east + 360 if west > east else east)) / 2
    if center_lon > 180:
        center_lon -= 360
    expected_offset = (sample_lon - center_lon, sample_lat - (south + north) / 2)
    got_offset = (finite(offsets["longitude"], "longitude centre offset"), finite(offsets["latitude"], "latitude centre offset"))
    if max(abs(x) for x in expected_offset) >= 0.01 or any(abs(a - b) > 1e-12 for a, b in zip(got_offset, expected_offset)):
        fail("sample centre offset exceeds or differs from the reviewed association guard")
    if association["sampleInsidePackBounds"] is not _inside(sample_lon, sample_lat, bounds):
        fail("pinned containment disclosure does not match sample and bounds")
    return row


def _validate_profile(actual: Any, expected: dict[str, Any]) -> None:
    if not isinstance(actual, dict) or set(actual) != {"sourceId", "period", "months"} or actual["sourceId"] != expected["sourceId"] or actual["period"] != expected["period"] or not isinstance(actual["months"], list) or len(actual["months"]) != 12:
        fail("derived manifest climate profile identity or month count differs from raw reconstruction")
    for month_index, (got, want) in enumerate(zip(actual["months"], expected["months"])):
        if not isinstance(got, dict) or got.keys() != want.keys():
            fail(f"derived climate month {month_index + 1} field set differs")
        for key, expected_value in want.items():
            equal_number(got[key], expected_value, f"derived climate month {month_index + 1} {key}")


def _verify_output(root: Path, binding: dict[str, Any], manifest_hash: str) -> dict[str, Any]:
    output = root / OUTPUT_REL
    relative_manifest = f"{OUTPUT_REL}/manifests/{manifest_hash}.json"
    manifest_bytes = safe_read(root, relative_manifest, MAX_MANIFEST, "derived manifest")
    if digest(manifest_bytes) != manifest_hash:
        fail("derived manifest hash differs from requested content address")
    manifest = exact(parse_json(manifest_bytes, "derived manifest"), {"schemaVersion", "compilerVersion", "region", "frame", "verticalDatum", "coverage", "exceptions", "sources", "tiles", "climate"}, "derived manifest")
    if manifest["schemaVersion"] != 1 or not isinstance(manifest["compilerVersion"], str) or manifest["frame"] != "wgs84-enu-m-v1" or manifest["verticalDatum"] != "WGS84-ellipsoid" or manifest["coverage"] not in ("foundation", "explorable"):
        fail("derived manifest schema or coordinate frame is unsupported")

    base_pin = binding["baseManifest"]
    base_bytes, _ = file_pin(root, base_pin, MAX_BASE, f".cache/world-build/campaigns/{binding['campaignId']}/output/manifests/", "base manifest")
    base = parse_json(base_bytes, "base manifest")
    exact(base, {"schemaVersion", "compilerVersion", "region", "frame", "verticalDatum", "coverage", "exceptions", "sources", "tiles", "climate"}, "base manifest")
    if base["climate"] is not None or base["region"] != binding["expectedRegion"]:
        fail("base manifest already has climate or region differs from pinned association")
    if not isinstance(base["exceptions"], list) or base["exceptions"].count(NO_CLIMATE) != 1:
        fail("base manifest does not carry exactly one climate-unavailable exception")
    if manifest["schemaVersion"] != base["schemaVersion"] or manifest["compilerVersion"] != base["compilerVersion"] or manifest["region"] != base["region"] or manifest["frame"] != base["frame"] or manifest["verticalDatum"] != base["verticalDatum"] or manifest["coverage"] != base["coverage"]:
        fail("derived manifest changed non-climate base fields")

    env_pin = binding["environmentManifest"]
    env_bytes, _ = file_pin(root, env_pin, MAX_ENV, ".cache/world-build/output/environment/manifests/", "environment manifest")
    raw_pin = binding["rawSource"]
    raw_bytes = safe_read(root, raw_pin["path"], MAX_RAW, "raw POWER source")
    raw_hash = safe_sha(raw_pin["sha256"], "raw POWER source pin")
    if len(raw_bytes) != raw_pin["bytes"] or digest(raw_bytes) != raw_hash:
        fail("raw POWER source does not match immutable pin")
    profile, expected_env = reconstruct_profile(parse_json(raw_bytes, "raw POWER source"), binding, raw_hash, len(raw_bytes))
    environment = parse_json(env_bytes, "environment manifest")
    _compare_environment(environment, expected_env)
    source = source_record(manifest["sources"][-1] if isinstance(manifest["sources"], list) and manifest["sources"] else None, "derived climate source")
    if source != _source_simple(expected_env["source"]):
        fail("derived source record differs from independently reconstructed NASA metadata")
    if not isinstance(base["sources"], list) or manifest["sources"] != [*base["sources"], source]:
        fail("derived manifest did not preserve base sources and append exactly the pinned climate source")
    base_source_ids: set[str] = set()
    for source_index, base_source in enumerate(base["sources"]):
        checked_source = source_record(base_source, f"base source {source_index}")
        if checked_source["id"] in base_source_ids:
            fail("base manifest repeats a source identity")
        base_source_ids.add(checked_source["id"])
    if any(isinstance(row, dict) and row.get("id") == source["id"] for row in base["sources"]):
        fail("base manifest already contains the climate source identity")
    if manifest["climate"] is None:
        fail("derived manifest has no climate profile")
    _validate_profile(manifest["climate"], profile)

    sample = binding["expectedSample"]
    returned_lon, returned_lat = sample["longitude"], sample["latitude"]
    request = binding["environmentRequest"]
    region = binding["expectedRegion"]
    association = binding["association"]
    prefix_rows = [item for item in manifest["exceptions"] if isinstance(item, str) and item.startswith(CLIMATE_PREFIXES + (PROVENANCE_PREFIX,))]
    markers = [item for item in prefix_rows if item.startswith(PROVENANCE_PREFIX)]
    if len(markers) != 1 or not re.fullmatch(re.escape(PROVENANCE_PREFIX) + r"[a-f0-9]{64}", markers[0]):
        fail("derived manifest must reference exactly one hash-addressed climate provenance asset")
    climate_notes = [item for item in prefix_rows if item.startswith(CLIMATE_PREFIXES)]
    if len(climate_notes) != 3 or [item.split(":", 1)[0] + ":" for item in climate_notes] != list(CLIMATE_PREFIXES):
        fail("derived manifest is missing or reorders mandatory climate disclosure prefixes")
    expected_notes = [
        f"Climate association: explicit {request['name']} ({binding['id']}) native-grid point association; this is not a measurement or spatial average of the pack cell.",
        f"Climate sample: requested ({_js_num(request['longitude'])}, {_js_num(request['latitude'])}); returned ({_js_num(returned_lon)}, {_js_num(returned_lat)}); sampleInsidePackBounds={'true' if association['sampleInsidePackBounds'] else 'false'}; centreOffsetDegrees=({_js_num(association['centreOffsetDegrees']['longitude'])}, {_js_num(association['centreOffsetDegrees']['latitude'])}); native spacing 0.5° latitude × 0.625° longitude.",
        "Climate baseline: 1991–2020 monthly normal, LST, not live weather; precipitation is monthly accumulation in millimetres derived from monthly mean mm/day rates, not rain intensity.",
    ]
    if climate_notes != expected_notes:
        fail("climate disclosure does not exactly match the pinned association and reconstructed coordinates")
    expected_exceptions = [item for item in base["exceptions"] if item != NO_CLIMATE] + climate_notes + markers
    if manifest["exceptions"] != expected_exceptions:
        fail("derived manifest omitted, changed, or added a non-climate exception")

    provenance_hash = markers[0][len(PROVENANCE_PREFIX):]
    provenance_rel = f"{OUTPUT_REL}/provenance/{provenance_hash}.json"
    provenance_bytes = safe_read(root, provenance_rel, MAX_PROVENANCE, "climate attachment provenance")
    if digest(provenance_bytes) != provenance_hash:
        fail("climate provenance bytes differ from their content address")
    provenance = exact(parse_json(provenance_bytes, "climate provenance"), {"schemaVersion", "product", "compiler", "policy", "binding", "environment", "originalTiles", "limitations"}, "climate provenance")
    if provenance["schemaVersion"] != 1 or provenance["product"] != PRODUCT or provenance["compiler"] != COMPILER or provenance["policy"] != POLICY or provenance["binding"] != binding or provenance["environment"] != environment or provenance["originalTiles"] != base["tiles"]:
        fail("climate provenance identity, sidecar, or original tile binding differs")
    if not isinstance(provenance["limitations"], list) or len(provenance["limitations"]) != 4 or any(not isinstance(item, str) for item in provenance["limitations"]):
        fail("climate provenance limitation set is malformed")
    required_limitations = [
        "The climate profile is a 1991–2020 monthly normal from a single native MERRA-2 grid sample, not current weather or a spatial average of the pack region.",
        "Precipitation is a monthly accumulation derived from the NASA POWER PRECTOTCORR monthly mean rate; it is not rain intensity.",
        "NASA POWER metadata does not provide a separate API product license; source attribution and the provider data-use notice are preserved.",
    ]
    if any(item not in provenance["limitations"] for item in required_limitations):
        fail("climate provenance omits mandatory climate limitations")
    first_limitation = provenance["limitations"][0]
    sample_inside = "inside" if association["sampleInsidePackBounds"] else "outside"
    expected_first_limitation = (
        f"{association['disclosure']} The returned point ({_js_num(returned_lon)}, {_js_num(returned_lat)}) is {sample_inside} the pack bounds; "
        f"the requested point was ({_js_num(request['longitude'])}, {_js_num(request['latitude'])})."
    )
    if first_limitation != expected_first_limitation:
        fail("climate provenance omits the exact pinned association disclosure")

    refs = base["tiles"]
    if not isinstance(refs, list) or len(refs) > MAX_TILES or manifest["tiles"] != refs:
        fail("derived manifest changed tiles or exceeds tile-count cap")
    base_root = str(PurePosixPath(base_pin["path"]).parent.parent)
    tile_bytes = 0
    seen_paths: set[str] = set()
    for index, ref in enumerate(refs):
        if not isinstance(ref, dict) or not isinstance(ref.get("path"), str) or not isinstance(ref.get("sha256"), str):
            fail(f"original tile reference {index} is malformed")
        tile_hash = safe_sha(ref["sha256"], f"tile {index} hash")
        expected_path = f"tiles/{tile_hash}.json"
        if ref["path"] != expected_path or ref["path"] in seen_paths or isinstance(ref.get("bytes"), bool) or not isinstance(ref.get("bytes"), int) or not 1 <= ref["bytes"] <= MAX_TILE:
            fail(f"original tile reference {index} is unsafe or outside its cap")
        seen_paths.add(ref["path"])
        original = safe_read(root, f"{base_root}/{ref['path']}", MAX_TILE, f"base tile {index}")
        copied = safe_read(root, f"{OUTPUT_REL}/{ref['path']}", MAX_TILE, f"copied tile {index}")
        if len(original) != ref["bytes"] or digest(original) != tile_hash or copied != original:
            fail(f"copied tile {index} is not byte-identical to its pinned base tile")
        tile = parse_json(original, f"base tile {index}")
        if not isinstance(tile, dict) or set(tile) != {"schemaVersion", "id", "regionId", "bounds", "anchor", "buildings", "roads"} or tile["schemaVersion"] != 1 or tile["id"] != ref.get("id") or tile["regionId"] != base["region"]["id"] or tile["bounds"] != ref.get("bounds"):
            fail(f"base tile {index} body identity differs from its reference")
        for collection in ("buildings", "roads"):
            features = tile[collection]
            if not isinstance(features, list):
                fail(f"base tile {index} {collection} is not a list")
            for feature_index, feature in enumerate(features):
                if not isinstance(feature, dict) or not isinstance(feature.get("sourceId"), str) or feature["sourceId"] not in base_source_ids:
                    fail(f"base tile {index} {collection} feature {feature_index} references an unknown source")
        tile_bytes += len(original)
    logical_bytes = len(manifest_bytes) + len(provenance_bytes) + tile_bytes
    if logical_bytes > MAX_LOGICAL:
        fail("climate attachment logical output exceeds 8 MiB")
    tree_bytes, tree_entries = checked_tree(output)
    return {"id": binding["id"], "manifestHash": manifest_hash, "provenanceHash": provenance_hash,
        "tiles": len(refs), "tileBytes": tile_bytes, "logicalBytes": logical_bytes,
        "outputTreeBytes": tree_bytes, "outputTreeEntries": tree_entries, "months": 12,
        "monthlyToleranceAbsolute": 1e-10, "networkBytes": 0,
        "sourceUrl": binding["rawSource"]["url"], "sourceSha256": raw_hash,
        "limitations": ["Monthly values were independently reconstructed from the pinned provider response with absolute numeric tolerance 1e-10; this does not establish climate accuracy or spatial representativeness.",
                        "The verifier checks hash-addressed bytes and parsed semantic reconstruction; it does not independently prove ECMAScript canonical JSON number serialization equivalence.",
                        "Any third raw coordinate ordinate is ignored; it is not interpreted as terrain or elevation."]}


def verify(repository: Path, binding_id: str, manifest_hash: str) -> dict[str, Any]:
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", binding_id):
        fail("binding ID must be a lowercase slug")
    if not SHA.fullmatch(manifest_hash):
        fail("manifest must be a lowercase SHA-256")
    pins_bytes = safe_read(repository, PIN_REL, MAX_PINS, "climate attachment pins")
    pins = exact(parse_json(pins_bytes, "climate attachment pins"), {"schemaVersion", "policy", "bindings"}, "climate pins")
    if pins["schemaVersion"] != 1 or pins["policy"] != POLICY or not isinstance(pins["bindings"], list) or len(pins["bindings"]) > 3:
        fail("climate attachment pin document schema or count is invalid")
    ids = [row.get("id") for row in pins["bindings"] if isinstance(row, dict)]
    if len(ids) != len(pins["bindings"]) or len(set(ids)) != len(ids):
        fail("climate attachment pin IDs are duplicated or malformed")
    matches = [row for row in pins["bindings"] if row["id"] == binding_id]
    if len(matches) != 1:
        fail("requested binding is absent from reviewed climate pins")
    binding = _validate_binding(matches[0], binding_id)
    result = _verify_output(repository, binding, manifest_hash)
    return {"status": "verified", **result}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository-root", required=True)
    parser.add_argument("--id", required=True)
    parser.add_argument("--manifest", required=True)
    args = parser.parse_args(argv)
    started = time.monotonic()
    try:
        root = canonical_root(args.repository_root)
        result = verify(root, args.id, args.manifest)
        result["elapsedMs"] = round((time.monotonic() - started) * 1000, 3)
        print(json.dumps(result, sort_keys=True, separators=(",", ":"), allow_nan=False))
        return 0
    except VerificationError as exc:
        print(json.dumps({"status": "rejected", "error": str(exc)[:1000]}, sort_keys=True, separators=(",", ":")), file=sys.stderr)
        return 1
    except Exception as exc:  # Fail closed while keeping command output small.
        print(json.dumps({"status": "rejected", "error": f"verification failed: {type(exc).__name__}: {str(exc)[:900]}"}, sort_keys=True, separators=(",", ":")), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
