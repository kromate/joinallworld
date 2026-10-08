#!/usr/bin/env python3
"""Independent, bounded audit of one immutable country-grid denominator.

This verifier is intentionally separate from the TypeScript compiler and publisher.
It hashes and parses the pinned directory assets, then reconstructs polygon/cell
contact using exact rational predicates. A pass means only that this source-bound
geographic denominator is internally consistent; it does not certify official
boundaries, spherical topology, geometry acquisition, or playable coverage.
"""
from __future__ import annotations

import argparse
from bisect import bisect_left, bisect_right
import hashlib
import json
import math
import os
import re
import resource
import stat
import sys
import time
from urllib.parse import quote
from fractions import Fraction
from pathlib import Path
from typing import Any

SHA = re.compile(r"^[a-f0-9]{64}$")
MAX_PLAN = 16_000_000
MAX_DIRECTORY = 16_000_000
MAX_SOURCE = 2_097_152
MAX_POSITIONS = 100_000
MAX_CELLS = 100_000
MAX_BBOX = 300_000
MAX_OPS = 100_000_000
MAX_SEGMENT_REFS = 2_000_000
MAX_READ = 40_000_000
MAX_JSON_NODES = 2_000_000
MAX_JSON_DEPTH = 64
MAX_ENTRIES = 4096
MAX_HIERARCHY_NODES = 10_100
MAX_RSS = 512 * 1024 * 1024
START = time.monotonic()
READ_BYTES = 0
OPS = 0


class VerifyError(Exception):
    pass


def fail(message: str) -> None:
    raise VerifyError(message)


def live() -> None:
    if time.monotonic() - START > 120:
        fail("verification exceeded 120 seconds")
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if sys.platform == "darwin" else 1024)
    if rss > MAX_RSS:
        fail("verification exceeded 512 MiB RSS")


def digest(data: bytes | str) -> str:
    return hashlib.sha256(data.encode("utf-8") if isinstance(data, str) else data).hexdigest()


def pairs(rows: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in rows:
        if key in result:
            fail(f"duplicate JSON key {key!r}")
        result[key] = value
    return result


def no_constant(value: str) -> None:
    fail(f"non-finite JSON constant {value}")


def parse(data: bytes, label: str) -> Any:
    live()
    try:
        value = json.loads(data.decode("utf-8", "strict"), object_pairs_hook=pairs, parse_constant=no_constant)
    except VerifyError:
        raise
    except (ValueError, UnicodeError, RecursionError) as error:
        fail(f"{label} is not bounded UTF-8 JSON: {error}")
    stack = [(value, 0)]
    count = 0
    while stack:
        current, depth = stack.pop()
        count += 1
        if count > MAX_JSON_NODES or depth > MAX_JSON_DEPTH:
            fail(f"{label} exceeds JSON structure limits")
        if count % 2048 == 0:
            live()
        if isinstance(current, float) and not math.isfinite(current):
            fail(f"{label} contains a non-finite number")
        if isinstance(current, dict):
            stack.extend((item, depth + 1) for item in current.values())
        elif isinstance(current, list):
            stack.extend((item, depth + 1) for item in current)
    return value


def _reject_links(path: Path) -> None:
    cursor = Path(path.anchor)
    for part in path.parts[1:]:
        cursor /= part
        try:
            mode = os.lstat(cursor).st_mode
        except FileNotFoundError:
            fail(f"missing path component: {cursor}")
        if stat.S_ISLNK(mode):
            fail("symlink path refused")


def canonical_root(raw: str) -> Path:
    root = Path(raw)
    if not root.is_absolute() or str(root) != raw:
        fail("root must be a canonical absolute path")
    _reject_links(root)
    if not stat.S_ISDIR(os.lstat(root).st_mode) or root.resolve(strict=True) != root:
        fail("root must resolve to its canonical directory")
    return root


def relative(raw: Any) -> str:
    if (not isinstance(raw, str) or not raw or raw.startswith("/") or "\\" in raw or "\x00" in raw
            or any(piece in ("", ".", "..") for piece in raw.split("/"))):
        fail("unsafe relative asset path")
    return raw


def read_file(path: Path, cap: int, label: str) -> bytes:
    global READ_BYTES
    _reject_links(path)
    before = os.lstat(path)
    if not stat.S_ISREG(before.st_mode) or before.st_size > cap:
        fail(f"{label} is not a bounded regular file")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        initial = os.fstat(fd)
        if not stat.S_ISREG(initial.st_mode) or initial.st_size > cap:
            fail(f"{label} changed to an unsafe file")
        pieces: list[bytes] = []
        total = 0
        while True:
            live()
            block = os.read(fd, min(65536, cap + 1 - total))
            if not block:
                break
            pieces.append(block)
            total += len(block)
            if total > cap:
                fail(f"{label} exceeds its byte cap")
        final = os.fstat(fd)
        if total != initial.st_size or final.st_size != initial.st_size or final.st_mtime_ns != initial.st_mtime_ns:
            fail(f"{label} changed while being read")
        READ_BYTES += total
        if READ_BYTES > MAX_READ:
            fail("aggregate file reads exceed 40 MB")
        return b"".join(pieces)
    finally:
        os.close(fd)


def obj(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(f"{label} must be an object")
    return value


def arr(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list):
        fail(f"{label} must be an array")
    return value


def sha256_field(value: Any, label: str) -> str:
    if not isinstance(value, str) or not SHA.fullmatch(value):
        fail(f"{label} is not a SHA-256")
    return value


def canonical(value: Any, depth: int = 0) -> str:
    """ECMAScript-compatible canonical JSON for bounded plan values.

    Plan coordinates and lattice bounds are IEEE-754 values. The formatter is
    intentionally fail-closed for non-finite numbers and documents the residual
    shortest-decimal parity limitation in the CLI receipt.
    """
    if depth > MAX_JSON_DEPTH:
        fail("canonical JSON nesting exceeds limit")
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        if abs(value) > 9_007_199_254_740_991:
            return canonical(float(value), depth)
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            fail("non-finite canonical number")
        if value == 0:
            return "0"
        negative = value < 0
        spelling = repr(abs(value)).lower()
        if "e" in spelling:
            mantissa, exponent = spelling.split("e")
            exp = int(exponent)
        else:
            mantissa, exp = spelling, 0
        if "." in mantissa:
            whole, fraction = mantissa.split(".")
            digits = whole + fraction
            point = len(whole) + exp
        else:
            digits = mantissa
            point = len(mantissa) + exp
        leading = len(digits) - len(digits.lstrip("0"))
        digits = digits.lstrip("0") or "0"
        point -= leading
        digits = digits.rstrip("0") or "0"
        if -6 < point <= 21:
            if point <= 0:
                output = "0." + "0" * (-point) + digits
            elif point >= len(digits):
                output = digits + "0" * (point - len(digits))
            else:
                output = digits[:point] + "." + digits[point:]
        else:
            output = digits[0] + ("." + digits[1:] if len(digits) > 1 else "") + "e" + ("+" if point - 1 >= 0 else "") + str(point - 1)
        return ("-" if negative else "") + output
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, list):
        return "[" + ",".join(canonical(item, depth + 1) for item in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value, key=lambda item: item.encode("utf-16-be", "surrogatepass"))
        return "{" + ",".join(canonical(key) + ":" + canonical(value[key], depth + 1) for key in keys) + "}"
    fail("non-JSON value")


def same(left: Any, right: Any) -> bool:
    return canonical(left) == canonical(right)


def exact_keys(value: dict[str, Any], keys: set[str], label: str) -> None:
    if set(value) != keys:
        fail(f"{label} has missing or unknown fields")


def safe_int(value: Any, label: str, low: int = 0, high: int = 9_007_199_254_740_991) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < low or value > high:
        fail(f"{label} is not a bounded safe integer")
    return value


def pin_read(directory_root: Path, pin: Any, category: str, cap: int) -> tuple[bytes, Any]:
    row = obj(pin, f"{category} pin")
    exact_keys(row, {"path", "sha256", "bytes"}, f"{category} pin")
    path = relative(row["path"])
    sha = sha256_field(row["sha256"], f"{category} SHA")
    size = row["bytes"]
    if not isinstance(size, int) or isinstance(size, bool) or size < 1 or size > cap:
        fail(f"{category} byte count is outside limit")
    expected_prefix = f"{category}/"
    if not path.startswith(expected_prefix) or path != f"{category}/{sha}.json":
        fail(f"{category} pin path is not content-addressed")
    data = read_file(directory_root.joinpath(*path.split("/")), cap, category)
    if len(data) != size or digest(data) != sha:
        fail(f"{category} pin bytes or hash mismatch")
    parsed = parse(data, category)
    if data != canonical(parsed).encode("utf-8"):
        fail(f"{category} JSON is not canonical source-asset JSON")
    return data, parsed


def exact_fraction(value: Any, label: str) -> Fraction:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        fail(f"{label} is not finite numeric")
    return Fraction.from_float(float(value))


def bump(amount: int = 1) -> None:
    global OPS
    OPS += amount
    if OPS > MAX_OPS:
        fail("geometry operation cap exceeded")
    if OPS % 8192 == 0:
        live()


def cross(a: tuple[Fraction, Fraction], b: tuple[Fraction, Fraction], c: tuple[Fraction, Fraction]) -> Fraction:
    bump()
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def on_segment(a: tuple[Fraction, Fraction], b: tuple[Fraction, Fraction], p: tuple[Fraction, Fraction]) -> bool:
    return cross(a, b, p) == 0 and min(a[0], b[0]) <= p[0] <= max(a[0], b[0]) and min(a[1], b[1]) <= p[1] <= max(a[1], b[1])


def segments_intersect(a: tuple[Fraction, Fraction], b: tuple[Fraction, Fraction], c: tuple[Fraction, Fraction], d: tuple[Fraction, Fraction]) -> bool:
    o1, o2, o3, o4 = cross(a, b, c), cross(a, b, d), cross(c, d, a), cross(c, d, b)
    if (o1 > 0 > o2 or o2 > 0 > o1) and (o3 > 0 > o4 or o4 > 0 > o3):
        return True
    return (o1 == 0 and on_segment(a, b, c)) or (o2 == 0 and on_segment(a, b, d)) or (o3 == 0 and on_segment(c, d, a)) or (o4 == 0 and on_segment(c, d, b))


def point_ring(point: tuple[Fraction, Fraction], ring: list[tuple[Fraction, Fraction]], strict: bool = False) -> bool:
    inside = False
    for a, b in zip(ring, ring[1:]):
        bump()
        if on_segment(a, b, point):
            return not strict
        if (a[1] > point[1]) != (b[1] > point[1]):
            hit_x = a[0] + (point[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
            if point[0] < hit_x:
                inside = not inside
    return inside


def point_polygon(point: tuple[Fraction, Fraction], polygon: list[list[tuple[Fraction, Fraction]]]) -> bool:
    if not point_ring(point, polygon[0]):
        return False
    for hole in polygon[1:]:
        if point_ring(point, hole):  # hole boundary is part of contact; strict interior is excluded
            return False
    return True


def ring_hits_rect(ring: list[tuple[Fraction, Fraction]], rect: tuple[Fraction, Fraction, Fraction, Fraction]) -> bool:
    west, south, east, north = rect
    corners = ((west, south), (east, south), (east, north), (west, north))
    for point in ring:
        bump()
        if west <= point[0] <= east and south <= point[1] <= north:
            return True
    for a, b in zip(ring, ring[1:]):
        for c, d in zip(corners, corners[1:] + corners[:1]):
            if segments_intersect(a, b, c, d):
                return True
    return False


def polygon_hits_rect(polygon: list[list[tuple[Fraction, Fraction]]], rect: tuple[Fraction, Fraction, Fraction, Fraction]) -> bool:
    if any(ring_hits_rect(ring, rect) for ring in polygon):
        return True
    west, south, east, north = rect
    for corner in ((west, south), (east, south), (east, north), (west, north)):
        if point_ring(corner, polygon[0]) and not any(point_ring(corner, hole, strict=True) for hole in polygon[1:]):
            return True
    return False


def row_range(min_lat: Fraction, max_lat: Fraction, scale: int) -> tuple[int, int]:
    low = (min_lat + 90) * scale
    high = (max_lat + 90) * scale
    first = floor_fraction(low) - (1 if low.denominator == 1 else 0)
    last = floor_fraction(high)
    return max(0, min(180 * scale - 1, first)), max(0, min(180 * scale - 1, last))


def axis_range(minimum: Fraction, maximum: Fraction, origin: int, scale: int, count: int) -> tuple[int, int]:
    low = (minimum + origin) * scale
    high = (maximum + origin) * scale
    first = floor_fraction(low) - (1 if low.denominator == 1 else 0)
    last = floor_fraction(high)
    return max(0, min(count - 1, first)), max(0, min(count - 1, last))


def build_row_segments(polygon: list[list[tuple[Fraction, Fraction]]], candidate_cells: set[tuple[int, int]], scale: int) -> tuple[list[tuple[int, tuple[Fraction, Fraction], tuple[Fraction, Fraction]]], dict[int, list[int]], dict[tuple[int, int], list[int]]]:
    """Index source segments into only candidate rows and candidate cells they can touch."""
    rows = sorted({row for _, row in candidate_cells})
    cols_by_row: dict[int, list[int]] = {row: [] for row in rows}
    for column, row in candidate_cells:
        cols_by_row[row].append(column)
    for columns in cols_by_row.values():
        columns.sort()
    row_buckets: dict[int, list[int]] = {row: [] for row in rows}
    cell_buckets: dict[tuple[int, int], list[int]] = {}
    segments: list[tuple[int, tuple[Fraction, Fraction], tuple[Fraction, Fraction]]] = []
    references = 0
    for ring_index, ring in enumerate(polygon):
        for segment_index, (start, end) in enumerate(zip(ring, ring[1:])):
            bump()
            first, last = row_range(min(start[1], end[1]), max(start[1], end[1]), scale)
            segment_ref = len(segments)
            segments.append((ring_index, start, end))
            left, right = bisect_left(rows, first), bisect_right(rows, last)
            col_first, col_last = axis_range(min(start[0], end[0]), max(start[0], end[0]), 180, scale, 360 * scale)
            for row in rows[left:right]:
                references += 1
                bump()
                row_buckets[row].append(segment_ref)
                columns = cols_by_row[row]
                first_column = bisect_left(columns, col_first)
                last_column = bisect_right(columns, col_last)
                for column in columns[first_column:last_column]:
                    references += 1
                    bump()
                    if references > MAX_SEGMENT_REFS:
                        fail("row/cell segment index exceeds 2,000,000 references")
                    cell_buckets.setdefault((column, row), []).append(segment_ref)
                if references > MAX_SEGMENT_REFS:
                    fail("row/cell segment index exceeds 2,000,000 references")
    return segments, row_buckets, cell_buckets


def indexed_point_ring(point: tuple[Fraction, Fraction], segment_refs: list[int], segments: list[tuple[int, tuple[Fraction, Fraction], tuple[Fraction, Fraction]]], ring_index: int, strict: bool = False) -> bool:
    inside = False
    for segment_ref in segment_refs:
        ref_ring, a, b = segments[segment_ref]
        if ref_ring != ring_index:
            continue
        bump()
        if on_segment(a, b, point):
            return not strict
        if (a[1] > point[1]) != (b[1] > point[1]):
            hit_x = a[0] + (point[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
            if point[0] < hit_x:
                inside = not inside
    return inside


def row_crossings(segments: list[tuple[int, tuple[Fraction, Fraction], tuple[Fraction, Fraction]]], row_segments: list[int], y: Fraction, ring_count: int) -> dict[int, list[Fraction]]:
    hits: dict[int, list[Fraction]] = {}
    for segment_ref in row_segments:
        ring_index, start, end = segments[segment_ref]
        bump()
        if (start[1] > y) != (end[1] > y):
            x = start[0] + (y - start[1]) * (end[0] - start[0]) / (end[1] - start[1])
            hits.setdefault(ring_index, []).append(x)
    for ring in hits.values():
        ring.sort()
    return hits


def indexed_polygon_hits_rect(segments: list[tuple[int, tuple[Fraction, Fraction], tuple[Fraction, Fraction]]], cell_segments: list[int], south_crossings: dict[int, list[Fraction]], north_crossings: dict[int, list[Fraction]], rect: tuple[Fraction, Fraction, Fraction, Fraction], ring_count: int) -> bool:
    west, south, east, north = rect
    corners = ((west, south), (east, south), (east, north), (west, north))
    for segment_ref in cell_segments:
        _, start, end = segments[segment_ref]
        bump()
        if (west <= start[0] <= east and south <= start[1] <= north) or (west <= end[0] <= east and south <= end[1] <= north):
            return True
        if max(start[0], end[0]) < west or min(start[0], end[0]) > east or max(start[1], end[1]) < south or min(start[1], end[1]) > north:
            continue
        for first, second in zip(corners, corners[1:] + corners[:1]):
            if segments_intersect(start, end, first, second):
                return True
    for corner_x, corner_y in corners:
        crossing_rows = south_crossings if corner_y == south else north_crossings
        inside = lambda ring: ((len(crossing_rows.get(ring, [])) - bisect_right(crossing_rows.get(ring, []), corner_x)) & 1) == 1
        if inside(0) and not any(inside(ring) for ring in range(1, ring_count)):
            return True
    return False


def geometry_polygons(geometry: Any) -> tuple[str, list[list[list[tuple[Fraction, Fraction]]]], int]:
    geom = obj(geometry, "pinned source geometry")
    if set(geom) != {"type", "coordinates"} or geom["type"] not in ("Polygon", "MultiPolygon"):
        fail("source outline geometry schema is invalid")
    raw_polygons = [geom["coordinates"]] if geom["type"] == "Polygon" else arr(geom["coordinates"], "multipolygon coordinates")
    if not raw_polygons or len(raw_polygons) > MAX_POSITIONS:
        fail("source polygon count is outside limits")
    polygons: list[list[list[tuple[Fraction, Fraction]]]] = []
    positions = 0
    for pi, raw_polygon in enumerate(raw_polygons):
        rings: list[list[tuple[Fraction, Fraction]]] = []
        for ri, raw_ring in enumerate(arr(raw_polygon, f"polygon {pi} rings")):
            points: list[tuple[Fraction, Fraction]] = []
            for qi, raw_point in enumerate(arr(raw_ring, f"ring {pi}/{ri}")):
                point = arr(raw_point, f"position {pi}/{ri}/{qi}")
                if len(point) != 2:
                    fail("source outline position is not 2D")
                x = exact_fraction(point[0], "longitude")
                y = exact_fraction(point[1], "latitude")
                if not Fraction(-180) <= x <= Fraction(180) or not Fraction(-90) <= y <= Fraction(90):
                    fail("source outline coordinate is out of range")
                points.append((x, y)); positions += 1
                if positions > MAX_POSITIONS:
                    fail("source outline exceeds position cap")
                if positions % 2048 == 0:
                    live()
            if len(points) < 4 or points[0] != points[-1] or len(set(points[:-1])) < 3:
                fail("source ring is invalid or unclosed")
            for first, second in zip(points, points[1:]):
                if abs(first[0] - second[0]) > 180 and first[1] not in (Fraction(90), Fraction(-90)) and second[1] not in (Fraction(90), Fraction(-90)):
                    fail("unsupported arbitrary longitude seam crossing")
            rings.append(points)
        if not rings:
            fail("source polygon has no rings")
        polygons.append(rings)
    return geom["type"], polygons, positions


def floor_fraction(value: Fraction) -> int:
    return value.numerator // value.denominator


def candidate_ids(polygon: list[list[tuple[Fraction, Fraction]]], level: int) -> list[tuple[int, int]]:
    step = Fraction(1, 1 << level)
    scale = 1 << level
    # Candidate ranges intentionally use the exterior ring only, matching the
    # frozen bbox definition; holes can remove contacts but cannot enlarge it.
    exterior = polygon[0]
    min_x = min(point[0] for point in exterior)
    max_x = max(point[0] for point in exterior)
    min_y = min(point[1] for point in exterior)
    max_y = max(point[1] for point in exterior)
    max_col = 360 * scale - 1
    min_col_q = (min_x + 180) / step
    min_col = max(0, min(max_col, floor_fraction(min_col_q) - (1 if min_col_q.denominator == 1 else 0)))
    end_col = max(0, min(max_col, floor_fraction((max_x + 180) / step)))
    min_row_q = (min_y + 90) / step
    min_row = max(0, min(180 * scale - 1, floor_fraction(min_row_q) - (1 if min_row_q.denominator == 1 else 0)))
    end_row = max(0, min(180 * scale - 1, floor_fraction((max_y + 90) / step)))
    count = (end_col - min_col + 1) * (end_row - min_row + 1)
    if count < 1 or count > MAX_BBOX:
        fail("polygon bbox candidate extent exceeds cap")
    bump(count)
    result: list[tuple[int, int]] = []
    for column in range(min_col, end_col + 1):
        for row in range(min_row, end_row + 1):
            if len(result) % 8192 == 0:
                live()
            result.append((column, row))
    return result


def cell_rect(column: int, row: int, scale: int) -> tuple[Fraction, Fraction, Fraction, Fraction]:
    step = Fraction(1, scale)
    return (Fraction(-180) + column * step, Fraction(-90) + row * step,
            Fraction(-180) + (column + 1) * step, Fraction(-90) + (row + 1) * step)


def derive(polygons: list[list[list[tuple[Fraction, Fraction]]]], level: int, cell_cap: int = MAX_CELLS) -> tuple[list[dict[str, Any]], int, int]:
    global OPS
    OPS = 0
    scale = 1 << level
    candidate_map: dict[tuple[int, int], set[int]] = {}
    seam_selected: dict[tuple[int, int], set[int]] = {}
    polygon_candidate_cells: list[set[tuple[int, int]]] = [set() for _ in polygons]
    # Reconstruct the closed bbox candidate union independently.
    for polygon_index, polygon in enumerate(polygons):
        live()
        own = candidate_ids(polygon, level)
        for key in own:
            polygon_candidate_cells[polygon_index].add(key)
            candidate_map.setdefault(key, set()).add(polygon_index)
        if len(candidate_map) > MAX_BBOX:
            fail("unique bbox candidate count exceeds cap")
        exterior = polygon[0]
        min_y, max_y = min(point[1] for point in exterior), max(point[1] for point in exterior)
        row0, row1 = row_range(min_y, max_y, scale)
        touches_west = any(point[0] == -180 for ring in polygon for point in ring)
        touches_east = any(point[0] == 180 for ring in polygon for point in ring)
        seam_edges = ([(360 * scale - 1, Fraction(-180))] if touches_west else []) + ([(0, Fraction(180))] if touches_east else [])
        for seam_col, source_lon in seam_edges:
            for row in range(row0, row1 + 1):
                key = (seam_col, row)
                polygon_candidate_cells[polygon_index].add(key)
                candidate_map.setdefault(key, set()).add(polygon_index)
                if len(candidate_map) > MAX_BBOX:
                    fail("unique bbox candidate count exceeds cap")
        # Mirror only source-seam boundary contact. Slanted segments contribute
        # the seam endpoint row; a segment along the seam contributes all rows
        # touched by its closed latitude interval.
        for ring in polygon:
            for a, b in zip(ring, ring[1:]):
                bump()
                for source_lon, seam_col in ((Fraction(-180), 360 * scale - 1), (Fraction(180), 0)):
                    if a[0] != source_lon and b[0] != source_lon:
                        continue
                    if a[0] == source_lon and b[0] == source_lon:
                        first, last = row_range(min(a[1], b[1]), max(a[1], b[1]), scale)
                    else:
                        endpoint = a if a[0] == source_lon else b
                        first, last = row_range(endpoint[1], endpoint[1], scale)
                    for row in range(first, last + 1):
                        seam_selected.setdefault((seam_col, row), set()).add(polygon_index)

    # Build a separate exact-rational latitude index of original segments. Only
    # rows that contain candidates for this polygon are materialized.
    row_indexes = [build_row_segments(poly, polygon_candidate_cells[index], scale) for index, poly in enumerate(polygons)]
    contributions: dict[tuple[int, int], set[int]] = {}
    crossing_cache: dict[int, tuple[dict[int, list[Fraction]], dict[int, list[Fraction]]]] = {}
    current_row: int | None = None
    for (column, row), polygon_indices in sorted(candidate_map.items(), key=lambda item: (item[0][1], item[0][0])):
        if row != current_row:
            crossing_cache.clear()
            current_row = row
        rect = cell_rect(column, row, scale)
        for polygon_index in polygon_indices:
            segments, row_buckets, cell_buckets = row_indexes[polygon_index]
            crossing_rows = crossing_cache.get(polygon_index)
            if crossing_rows is None:
                row_segments = row_buckets.get(row, [])
                crossing_rows = (row_crossings(segments, row_segments, rect[1], len(polygons[polygon_index])),
                                 row_crossings(segments, row_segments, rect[3], len(polygons[polygon_index])))
                crossing_cache[polygon_index] = crossing_rows
            if indexed_polygon_hits_rect(segments, cell_buckets.get((column, row), []), crossing_rows[0], crossing_rows[1], rect, len(polygons[polygon_index])):
                contributions.setdefault((column, row), set()).add(polygon_index)
                if len(contributions) > cell_cap:
                    fail("selected country-grid cells exceed request cap")
    for key, indices in seam_selected.items():
        if key in candidate_map:
            contributions.setdefault(key, set()).update(indices)
            if len(contributions) > cell_cap:
                fail("selected country-grid cells exceed request cap")
    cells: list[dict[str, Any]] = []
    for (column, row), indices in sorted(contributions.items()):
        west, south, east, north = cell_rect(column, row, scale)
        cell_id = f"geo-grid-v1:l{level}:x{column}:y{row}"
        cells.append({"id": cell_id, "level": level, "column": column, "row": row,
                      "bounds": [float(west), float(south), float(east), float(north)],
                      "polygonIndices": sorted(indices), "state": "not-started"})
    return cells, len(candidate_map), OPS


def verify(root: Path, plan_path: str, expected_hash: str) -> dict[str, Any]:
    global OPS
    rel = relative(plan_path)
    if not SHA.fullmatch(expected_hash):
        fail("plan hash must be lowercase SHA-256")
    if not re.fullmatch(r"country-grids/[a-z0-9][a-z0-9._-]{0,47}/plans/[a-f0-9]{64}\.json", rel):
        fail("plan path does not match the immutable country-grid layout")
    plan_data = read_file(root.joinpath(*rel.split("/")), MAX_PLAN, "country-grid plan")
    if digest(plan_data) != expected_hash or Path(rel).stem != expected_hash:
        fail("plan filename or content hash mismatch")
    plan = parse(plan_data, "country-grid plan")
    if plan_data != (canonical(plan) + "\n").encode("utf-8"):
        fail("plan is not canonical newline-terminated JSON")
    plan = obj(plan, "country-grid plan")
    required = {"schemaVersion", "compilerVersion", "requestHash", "request", "country", "source", "boundaryPins",
                "geographicCoverage", "geometryCoverage", "selection", "ownership", "grid", "cells", "counts", "limitations"}
    exact_keys(plan, required, "country-grid plan")
    if safe_int(plan["schemaVersion"], "plan schema", 1, 1) != 1 or plan["compilerVersion"] != "country-source-cut-grid-v1":
        fail("unsupported country-grid plan schema/compiler")
    request = obj(plan["request"], "country-grid request")
    exact_keys(request, {"schemaVersion", "id", "directoryManifestHash", "countryId", "level", "limits"}, "country-grid request")
    if safe_int(request["schemaVersion"], "request schema", 1, 1) != 1 or not isinstance(request["id"], str) or not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,47}", request["id"]):
        fail("country-grid request identity is invalid")
    if request["id"] != Path(rel).parts[1]:
        fail("country-grid request path or protected Nigeria binding is invalid")
    if (not isinstance(request["countryId"], str) or not request["countryId"] or len(request["countryId"]) > 256
            or not SHA.fullmatch(str(request["directoryManifestHash"])) or not isinstance(request["level"], int)
            or isinstance(request["level"], bool) or not 0 <= request["level"] <= 16):
        fail("country-grid request source or level is invalid")
    limits = obj(request["limits"], "request limits")
    exact_keys(limits, {"positions", "bboxCells", "cells", "operations", "outputBytes"}, "request limits")
    caps = {"positions": MAX_POSITIONS, "bboxCells": MAX_BBOX, "cells": MAX_CELLS, "operations": MAX_OPS, "outputBytes": MAX_PLAN}
    for key, maximum in caps.items():
        value = limits[key]
        if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= maximum:
            fail(f"request {key} limit is invalid")
    if len(plan_data) > limits["outputBytes"]:
        fail("plan exceeds the request output-byte limit")
    if digest(canonical(request)) != plan["requestHash"]:
        fail("request hash does not bind the canonical request")
    if plan["geographicCoverage"] != "source-bound-grid-denominator" or plan["geometryCoverage"] != "not-acquired" or plan["selection"] != "inclusive-planar-source-cut-polygon-cell-contact" or plan["ownership"] != "global-half-open-grid-seam-pole-v1":
        fail("country-grid coverage semantics are unsupported")
    if not isinstance(plan["limitations"], list) or len(plan["limitations"]) > 64 or any(not isinstance(x, str) or not x or len(x.encode()) > 2048 for x in plan["limitations"]):
        fail("plan limitations are malformed")

    directory_root = root / "output" / "country-inventory"
    pins = obj(plan["boundaryPins"], "boundary pins")
    exact_keys(pins, {"manifest", "node", "outlineIndex", "parts"}, "boundary pins")
    manifest_data, manifest = pin_read(directory_root, pins["manifest"], "manifests", 1_000_000)
    pin_bytes = len(manifest_data)
    directory_hash = pins["manifest"]["sha256"]
    if directory_hash != request["directoryManifestHash"]:
        fail("country-grid directory manifest binding is invalid")
    if safe_int(manifest.get("schemaVersion"), "directory manifest schema", 1, 1) != 1 or manifest.get("compiler") != "country-directory-compiler-v1" or manifest.get("representation") != "whole-polygon-groups":
        fail("pinned country-directory manifest is unsupported")
    source_units = safe_int(manifest.get("sourceUnitCount"), "directory source unit count", 1, 10_000)
    node_count = safe_int(manifest.get("nodeCount"), "directory node count", 1, 10_100)
    safe_int(manifest.get("outlineCount"), "directory outline count", 0, 10_000)
    safe_int(manifest.get("partCount"), "directory part count", 0, 100_000)
    source = obj(manifest.get("source"), "directory source")
    exact_keys(source, {"id", "url", "release", "license", "attribution", "sha256", "bytes"}, "directory source")
    if not same(source, plan["source"]):
        fail("plan source differs from pinned directory source")
    if (not isinstance(source.get("id"), str) or not source["id"] or not SHA.fullmatch(str(source.get("sha256")))
            or not isinstance(source.get("bytes"), int) or isinstance(source.get("bytes"), bool) or source["bytes"] < 1
            or any(not isinstance(source.get(key), str) or not source[key] for key in ("url", "release", "license", "attribution"))):
        fail("directory source metadata pin is malformed")
    if not re.fullmatch(r"nodes/[a-f0-9]{64}\.json", str(manifest.get("rootNodePath"))) or not re.fullmatch(r"identity/[a-f0-9]{64}\.json", str(manifest.get("identityPath"))):
        fail("directory root or identity path is not content-addressed")

    # Re-walk the manifest-linked hierarchy rather than trusting a detached node
    # pin supplied only by the grid plan. Reads are bounded and hash-verified.
    hierarchy_bytes = len(manifest_data)
    pending: list[tuple[str, str | None, str | None]] = [(manifest["rootNodePath"], None, None)]
    seen_paths: set[str] = set()
    seen_ids: set[str] = set()
    hierarchy_nodes: list[dict[str, Any]] = []
    country_index_paths: list[tuple[dict[str, Any], str]] = []
    selected_node_path: str | None = None
    linked_sources: set[str] = set()
    protected_nigeria_count = 0
    for offset, (relative_path, parent_id, parent_kind) in enumerate(pending):
        live()
        if offset >= MAX_HIERARCHY_NODES or relative_path in seen_paths:
            fail("country directory hierarchy repeats or exceeds entry cap")
        if not re.fullmatch(r"nodes/[a-f0-9]{64}\.json", relative_path):
            fail("country directory child path is not hash-addressed")
        seen_paths.add(relative_path)
        digest_name = relative_path.split("/")[1][:-5]
        node_body = read_file(directory_root / relative_path, 128_000, "country directory node")
        hierarchy_bytes += len(node_body)
        if hierarchy_bytes > MAX_DIRECTORY or digest(node_body) != digest_name:
            fail("country directory hierarchy exceeds byte cap or has a hash mismatch")
        node_index = obj(parse(node_body, "country directory node"), "country directory node")
        if node_body != canonical(node_index).encode("utf-8"):
            fail("country directory node is not canonical JSON")
        exact_keys(node_index, {"schemaVersion", "node", "outlineIndexPath", "children"}, "country directory node")
        if safe_int(node_index["schemaVersion"], "directory node schema", 1, 1) != 1:
            fail("country directory node schema is unsupported")
        linked_node = obj(node_index["node"], "directory node payload")
        exact_keys(linked_node, {"id", "parentId", "name", "kind", "countryCode", "bounds", "sourceFeatureIds", "provider", "outline", "exceptions"}, "directory node payload")
        identity = linked_node.get("id")
        kind = linked_node.get("kind")
        if not isinstance(identity, str) or not identity or identity in seen_ids or linked_node.get("parentId") != parent_id:
            fail("country directory node ID or parent is invalid")
        if kind not in ("world", "continent", "country") or (parent_kind is None and (identity != "world:earth" or kind != "world")):
            fail("country directory hierarchy kind is invalid")
        if parent_kind == "world" and kind != "continent" or parent_kind == "continent" and kind != "country" or parent_kind == "country":
            fail("country directory parent/child kinds are inconsistent")
        seen_ids.add(identity)
        hierarchy_nodes.append(linked_node)
        refs = linked_node.get("sourceFeatureIds")
        if not isinstance(refs, list) or (kind == "country" and len(refs) != 1) or (kind != "country" and refs):
            fail("country directory source references do not match node kind")
        if kind == "country":
            ref = refs[0]
            if not isinstance(ref, str) or not ref.startswith(source["id"] + ":NE_ID:") or ref in linked_sources:
                fail("country directory source reference is unbound or duplicated")
            feature_key = ref[len(source["id"]) + 1:]
            match = re.fullmatch(r"NE_ID:(0|-?[1-9][0-9]*)", feature_key)
            if not match or not str(int(match.group(1))) == match.group(1) or abs(int(match.group(1))) > 9_007_199_254_740_991:
                fail("country directory source reference is not a canonical Natural Earth key")
            linked_sources.add(ref)
            code = linked_node.get("countryCode")
            if code == "NG":
                if identity != "legacy-ng" or linked_node.get("provider") != "legacy-ng" or linked_node.get("outline") != "missing" or node_index.get("outlineIndexPath") is not None:
                    fail("protected Nigeria directory node has an outline")
                protected_nigeria_count += 1
            elif linked_node.get("provider") != "world":
                fail("non-Nigeria directory country has an unsupported provider")
            code = linked_node.get("countryCode")
            outline_path = node_index.get("outlineIndexPath")
            if code is not None and (not isinstance(code, str) or not re.fullmatch(r"[A-Z]{2}", code)):
                fail("country directory country code is malformed")
            if (outline_path is None) != (linked_node.get("outline") == "missing"):
                fail("country directory outline state/reference mismatch")
            if outline_path is not None:
                if not isinstance(outline_path, str) or not re.fullmatch(r"outline-index/[a-f0-9]{64}\.json", outline_path):
                    fail("country directory outline index path is unsafe")
                country_index_paths.append((linked_node, outline_path))
            if identity == request["countryId"]:
                selected_node_path = relative_path
        children = node_index.get("children")
        if not isinstance(children, list) or len(children) > MAX_HIERARCHY_NODES or len(pending) + len(children) > MAX_HIERARCHY_NODES:
            fail("country directory child list exceeds hierarchy cap")
        child_ids: set[str] = set()
        for child in children:
            child = obj(child, "country directory child")
            exact_keys(child, {"id", "name", "path"}, "country directory child")
            if not isinstance(child.get("id"), str) or child["id"] in child_ids:
                fail("country directory child IDs are invalid or duplicated")
            child_ids.add(child["id"])
            pending.append((relative(child.get("path")), identity, kind))
    if len(hierarchy_nodes) != node_count or len(linked_sources) != source_units or protected_nigeria_count != 1:
        fail("country directory hierarchy does not match manifest node/source counts")
    if selected_node_path is None or selected_node_path != pins["node"].get("path"):
        fail("pinned country node is not linked from the verified directory root")
    identity_body = read_file(directory_root / manifest["identityPath"], 256_000, "country directory identity")
    hierarchy_bytes += len(identity_body)
    if hierarchy_bytes > MAX_DIRECTORY or digest(identity_body) != manifest["identityPath"].split("/")[1][:-5]:
        fail("country directory hierarchy/identity exceeds cap or has hash mismatch")
    identity_file = obj(parse(identity_body, "country directory identity"), "country directory identity")
    if identity_body != canonical(identity_file).encode("utf-8"):
        fail("country directory identity is not canonical JSON")
    if (safe_int(identity_file.get("schemaVersion"), "identity schema", 1, 1) != 1
            or identity_file.get("candidateSourceId") != source.get("id")
            or safe_int(identity_file.get("candidateUnits"), "identity candidate units", 0, 10_000) != source_units
            or identity_file.get("protectedCountryId") != "legacy-ng" or identity_file.get("missing") != []):
        fail("country directory identity sidecar does not bind source and denominator")
    identity_rows = identity_file.get("retained")
    added_rows = identity_file.get("added")
    if not isinstance(identity_rows, list) or not isinstance(added_rows, list) or len(identity_rows) + len(added_rows) != source_units:
        fail("country directory identity rows do not conserve source units")
    candidate_map: dict[str, tuple[str, str]] = {}
    identity_ids: set[str] = set()
    identity_protected = 0
    for row in identity_rows + added_rows:
        row = obj(row, "country identity row")
        feature_key = row.get("featureKey")
        country_identity = row.get("countryId")
        candidate_name = row.get("candidateName") if "candidateName" in row else row.get("name")
        if not isinstance(feature_key, str) or not isinstance(country_identity, str) or not isinstance(candidate_name, str) or feature_key in candidate_map:
            fail("country identity rows contain invalid or duplicate keys")
        match = re.fullmatch(r"NE_ID:(0|-?[1-9][0-9]*)", feature_key)
        if not match or abs(int(match.group(1))) > 9_007_199_254_740_991:
            fail("country identity feature key is not a canonical Natural Earth ID")
        encoded_key = quote(feature_key, safe="-_.!~*'()")
        expected_id = "legacy-ng" if country_identity == "legacy-ng" else f"country:natural-earth:{encoded_key}"
        if country_identity != expected_id or country_identity in identity_ids:
            fail("country identity row has an invalid or duplicate stable ID")
        if country_identity == "legacy-ng":
            identity_protected += 1
        identity_ids.add(country_identity)
        candidate_map[feature_key] = (country_identity, candidate_name)
    if identity_protected != 1:
        fail("identity sidecar does not contain exactly one protected Nigeria row")
    selected_node = next((row for row in hierarchy_nodes if row.get("id") == request["countryId"]), None)
    selected_ref = selected_node.get("sourceFeatureIds", [None])[0] if selected_node else None
    selected_key = selected_ref[len(source["id"]) + 1:] if isinstance(selected_ref, str) and selected_ref.startswith(source["id"] + ":") else None
    if selected_key not in candidate_map or candidate_map[selected_key] != (selected_node.get("id"), selected_node.get("name")):
        fail("selected directory node differs from the candidate identity sidecar")
    for directory_node in hierarchy_nodes:
        if directory_node.get("kind") != "country":
            continue
        source_ref = directory_node["sourceFeatureIds"][0]
        feature_key = source_ref[len(source["id"]) + 1:]
        if candidate_map.get(feature_key) != (directory_node.get("id"), directory_node.get("name")):
            fail("directory country node does not match its candidate identity row")
    if len(country_index_paths) != manifest.get("outlineCount"):
        fail("directory outline count differs from linked country nodes")
    indexed_parts = 0
    selected_outline_path = None
    for directory_node, outline_path in country_index_paths:
        outline_hash = outline_path.split("/")[1][:-5]
        outline_bytes = read_file(directory_root / outline_path, 128_000, "directory outline index")
        hierarchy_bytes += len(outline_bytes)
        if hierarchy_bytes > MAX_DIRECTORY or digest(outline_bytes) != outline_hash:
            fail("directory outline index exceeds hierarchy cap or hash mismatch")
        outline_value = obj(parse(outline_bytes, "directory outline index"), "directory outline index")
        if outline_bytes != canonical(outline_value).encode("utf-8"):
            fail("directory outline index is not canonical JSON")
        exact_keys(outline_value, {"schemaVersion", "countryId", "sourceRef", "geometryType", "polygonCount", "coordinatePositions", "totalPartBytes", "parts"}, "directory outline index")
        if (safe_int(outline_value.get("schemaVersion"), "outline schema", 1, 1) != 1 or outline_value.get("countryId") != directory_node.get("id")
                or outline_value.get("sourceRef") != directory_node["sourceFeatureIds"][0]
                or outline_value.get("geometryType") not in ("Polygon", "MultiPolygon")):
            fail("directory outline index is not bound to its country node")
        outline_parts = outline_value.get("parts")
        if not isinstance(outline_parts, list) or not outline_parts:
            fail("directory outline index has no parts")
        part_count = 0
        part_bytes = 0
        part_positions = 0
        next_offset = 0
        for part in outline_parts:
            part = obj(part, "directory outline part ref")
            part_path = part.get("path")
            if not isinstance(part_path, str) or not re.fullmatch(r"outlines/[a-f0-9]{64}\.json", part_path):
                fail("directory outline part path is unsafe")
            if part.get("polygonOffset") != next_offset:
                fail("directory outline part offsets are not contiguous")
            count = part.get("polygonCount")
            size = part.get("bytes")
            points = part.get("coordinatePositions")
            count = safe_int(count, "outline part polygon count", 1, MAX_POSITIONS)
            size = safe_int(size, "outline part bytes", 1, 512_000)
            points = safe_int(points, "outline part positions", 1, MAX_POSITIONS)
            if size > 512_000:
                fail("directory outline part counts or byte size are invalid")
            next_offset += count; part_count += 1; part_bytes += size; part_positions += points
        if (part_count < 1 or part_count > 1024 or next_offset != outline_value.get("polygonCount")
                or part_positions != outline_value.get("coordinatePositions") or part_bytes != outline_value.get("totalPartBytes")
                or part_bytes + len(outline_bytes) > 2_097_152
                or (outline_value["geometryType"] == "Polygon" and next_offset != 1)):
            fail("directory outline part totals do not conserve index")
        indexed_parts += part_count
        if directory_node.get("id") == request["countryId"]:
            selected_outline_path = outline_path
    if indexed_parts != manifest.get("partCount"):
        fail("directory part count differs from linked outline indexes")
    if selected_outline_path != pins["outlineIndex"].get("path"):
        fail("selected outline index pin differs from directory hierarchy")

    node_data, node_index = pin_read(directory_root, pins["node"], "nodes", 128_000)
    pin_bytes += len(node_data)
    node = obj(node_index.get("node"), "pinned country node")
    if node.get("id") != request["countryId"] or node.get("kind") != "country" or node.get("provider") != "world" or node.get("countryCode") == "NG" or node.get("id") == "legacy-ng" or node.get("outline") != "available":
        fail("country node is protected, unavailable, or mismatched")
    if not isinstance(node.get("sourceFeatureIds"), list) or len(node["sourceFeatureIds"]) != 1:
        fail("country node source feature binding is invalid")
    source_ref = node["sourceFeatureIds"][0]
    if not isinstance(source_ref, str) or not source_ref.startswith(source.get("id", "") + ":"):
        fail("country node source ref is not bound to pinned source")
    if node_index.get("outlineIndexPath") != pins["outlineIndex"].get("path"):
        fail("node outline index path differs from boundary pin")
    outline_data, outline = pin_read(directory_root, pins["outlineIndex"], "outline-index", 128_000)
    pin_bytes += len(outline_data)
    if outline.get("countryId") != node.get("id") or outline.get("sourceRef") != source_ref or outline.get("geometryType") not in ("Polygon", "MultiPolygon"):
        fail("outline index is not bound to selected country source")
    part_pins = arr(pins["parts"], "part pins")
    part_refs = arr(outline.get("parts"), "outline parts")
    if len(part_pins) != len(part_refs) or not part_pins:
        fail("pinned outline part list differs from indexed parts")
    polygons_raw: list[Any] = []
    position_total = 0
    next_polygon_offset = 0
    selected_part_bytes = 0
    for idx, (part_pin, part_ref) in enumerate(zip(part_pins, part_refs)):
        part_data, part = pin_read(directory_root, part_pin, "outlines", 512_000)
        pin_bytes += len(part_data)
        ref = obj(part_ref, f"outline part ref {idx}")
        if (part_pin.get("path") != ref.get("path") or len(part_data) != safe_int(ref.get("bytes"), "outline part bytes", 1, 512_000)
                or safe_int(ref.get("polygonOffset"), "outline polygon offset", 0, MAX_POSITIONS) != next_polygon_offset
                or part.get("type") != "MultiPolygon"):
            fail("outline part payload differs from indexed source part")
        expected_count = ref.get("polygonCount")
        coords = arr(part.get("coordinates"), "outline part coordinates")
        expected_count = safe_int(expected_count, "outline part polygon count", 1, MAX_POSITIONS)
        if len(coords) != expected_count:
            fail("outline part polygon count mismatch")
        next_polygon_offset += expected_count
        selected_part_bytes += len(part_data)
        polygons_raw.extend(coords)
        part_positions = ref.get("coordinatePositions")
        if not isinstance(part_positions, int) or isinstance(part_positions, bool) or part_positions < 1 or part_positions > MAX_POSITIONS:
            fail("outline part position declaration is invalid")
        position_total += part_positions
        if len(polygons_raw) > MAX_POSITIONS or position_total > MAX_POSITIONS:
            fail("outline geometry exceeds bounded polygon/position cap")
    if (len(polygons_raw) != safe_int(outline.get("polygonCount"), "outline polygon count", 1, MAX_POSITIONS)
            or next_polygon_offset != len(polygons_raw)
            or position_total != safe_int(outline.get("coordinatePositions"), "outline position count", 1, MAX_POSITIONS)
            or selected_part_bytes != safe_int(outline.get("totalPartBytes"), "outline total part bytes", 1, MAX_SOURCE)
            or selected_part_bytes + len(outline_data) > 2_097_152):
        fail("outline parts do not conserve indexed geometry")
    if pin_bytes > MAX_SOURCE:
        fail("pinned country boundary assets exceed the 2 MiB cap")
    geometry = {"type": outline["geometryType"], "coordinates": polygons_raw[0] if outline["geometryType"] == "Polygon" else polygons_raw}
    if not same(plan["source"], manifest["source"]) or not same(plan["country"], node):
        fail("plan country or source does not equal verified directory bindings")

    grid = obj(plan["grid"], "grid declaration")
    level = request["level"]
    scale = 1 << level
    expected_grid = {"level": level, "stepDegrees": 1 / scale, "columns": 360 * scale, "rows": 180 * scale}
    if not same(grid, expected_grid):
        fail("grid lattice declaration differs from exact level")
    geom_type, polygons, position_count = geometry_polygons(geometry)
    if geom_type != outline["geometryType"] or position_count != position_total:
        fail("verified outline geometry does not conserve source positions")
    cells, bbox_count, operation_count = derive(polygons, level, min(limits["cells"], MAX_CELLS))
    if len(cells) > min(limits["cells"], MAX_CELLS) or bbox_count > min(limits["bboxCells"], MAX_BBOX) or position_count > min(limits["positions"], MAX_POSITIONS):
        fail("derived country grid exceeds request limits")
    counts = obj(plan["counts"], "plan counts")
    exact_keys(counts, {"polygons", "positions", "bboxCandidates", "selectedCells", "operations"}, "plan counts")
    actual = {"polygons": len(polygons), "positions": position_count, "bboxCandidates": bbox_count, "selectedCells": len(cells)}
    for key, value in actual.items():
        if safe_int(counts.get(key), f"plan {key} count", 0, max(MAX_POSITIONS, MAX_BBOX, MAX_CELLS)) != value:
            fail(f"plan {key} count differs from independently derived source")
    if safe_int(counts.get("operations"), "reported operation count", 0, min(limits["operations"], MAX_OPS)) > min(limits["operations"], MAX_OPS):
        fail("reported operation count is outside frozen cap")
    if not same(arr(plan["cells"], "plan cells"), cells):
        fail("plan cells, bounds, polygon indices, order, or state differ from independent derivation")
    completion_path = root / "country-grids" / request["id"] / "completions" / f"{plan['requestHash']}.json"
    completion_bytes = read_file(completion_path, 128_000, "completion receipt")
    completion = obj(parse(completion_bytes, "completion receipt"), "completion receipt")
    if completion_bytes != (canonical(completion) + "\n").encode("utf-8"):
        fail("completion receipt is not canonical JSON")
    exact_keys(completion, {"schemaVersion", "requestHash", "planHash", "planPath", "bytes"}, "completion receipt")
    if completion != {"schemaVersion": 1, "requestHash": plan["requestHash"], "planHash": expected_hash, "planPath": f"plans/{expected_hash}.json", "bytes": len(plan_data)} or safe_int(completion.get("schemaVersion"), "completion schema", 1, 1) != 1:
        fail("completion receipt does not bind exact plan bytes")
    live()
    return {"verified": True, "requestHash": plan["requestHash"], "planHash": expected_hash,
            "countryId": node["id"], "countryCode": node["countryCode"], "polygons": len(polygons),
            "positions": position_count, "bboxCandidates": bbox_count, "selectedCells": len(cells),
            "reportedOperationsWithinCap": counts["operations"], "bytesRead": READ_BYTES, "networkBytes": 0,
            "canonicalNumberParity": "Verified using Python shortest-roundtrip normalization; a rare Python/ECMAScript shortest-digit tie difference fails closed.",
            "scope": "source-bound geographic denominator only; no spherical topology, official-boundary, geometry-acquisition, or playability claim"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, help="canonical absolute world-build root")
    parser.add_argument("--plan-path", required=True, help="root-relative immutable plan path")
    parser.add_argument("--plan-hash", required=True, help="expected plan SHA-256")
    args = parser.parse_args()
    try:
        root = canonical_root(args.root)
        receipt = verify(root, args.plan_path, args.plan_hash)
        print(json.dumps(receipt, sort_keys=True, separators=(",", ":")))
        return 0
    except (VerifyError, OSError, ValueError, TypeError, KeyError, IndexError, ZeroDivisionError) as error:
        print(json.dumps({"verified": False, "error": str(error)}, sort_keys=True, separators=(",", ":")), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
