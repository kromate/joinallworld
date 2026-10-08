#!/usr/bin/env python3
"""One-tile, bounded Copernicus GLO-90 Accra fetch and native-window sidecar."""
from __future__ import annotations

import errno
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import stat
import sys
import time
import urllib.error
import urllib.request

TILE_ID = "Copernicus_DSM_COG_30_N05_00_W001_00_DEM"
URL = ("https://copernicus-dem-90m.s3.amazonaws.com/" + TILE_ID + "/" + TILE_ID + ".tif")
EXPECTED_BYTES = 3_511_272
MAX_NETWORK_BYTES = 5_000_000
MAX_SOURCE_BYTES = 5_000_000
MAX_METADATA_BYTES = 1_000_000
MAX_ATTEMPTS = 2
MAX_RUN_SECONDS = 60
MAX_DISK_BYTES = 30_000_000
MIN_FREE_DISK_BYTES = 100_000_000
MAX_RSS_BYTES = 384 * 1024 * 1024
REQUEST_BOUNDS = [-0.207, 5.552, -0.203, 5.556]
REQUEST_HASH = hashlib.sha256(json.dumps(
    {"schemaVersion": 1, "tileId": TILE_ID, "url": URL, "bounds": REQUEST_BOUNDS,
     "product": "Copernicus DEM GLO-90", "sampling": "native-PixelIsPoint"},
    sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
ATTRIBUTION = ("Produced using Copernicus WorldDEM-90 © DLR e.V. 2010-2014 and "
               "© Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS "
               "by the European Union and ESA; all rights reserved.")


class TerrainError(RuntimeError):
    pass


class ByteLimitError(TerrainError):
    pass


def canonical(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sync_dir(directory: Path) -> None:
    try:
        fd = os.open(directory, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError as error:
        if error.errno not in (errno.EINVAL, errno.ENOTSUP, errno.EBADF):
            raise


def durable_create(path: Path, data: bytes, cap: int = MAX_METADATA_BYTES) -> None:
    if len(data) > cap:
        raise ByteLimitError("terrain metadata exceeds 1 MB cap")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        with os.fdopen(fd, "wb", closefd=False) as stream:
            stream.write(data)
            stream.flush()
            os.fsync(fd)
    finally:
        os.close(fd)


def checked_root(value: str) -> Path:
    root = Path(value)
    if not root.is_absolute() or "\x00" in value:
        raise TerrainError("build root must be absolute")
    root = Path(os.path.normpath(root))
    cur = Path(root.anchor)
    for component in root.parts[1:]:
        cur = cur / component
        try:
            info = cur.lstat()
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
                raise TerrainError("build root has non-directory or symlink ancestor")
        except FileNotFoundError:
            cur.mkdir()
    if root.resolve(strict=True) != root:
        raise TerrainError("build root is not canonical")
    return root


def ensure_dir(root: Path, directory: Path) -> None:
    try:
        relative = directory.relative_to(root)
    except ValueError as error:
        raise TerrainError("terrain path escapes build root") from error
    current = root
    for component in relative.parts:
        current = current / component
        try:
            info = current.lstat()
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
                raise TerrainError("terrain path contains symlink or non-directory")
        except FileNotFoundError:
            current.mkdir()
            sync_dir(current.parent)


def disk_usage(root: Path) -> int:
    if not root.exists():
        return 0
    total = 0
    for parent, dirs, files in os.walk(root, followlinks=False):
        p = Path(parent)
        dirs[:] = sorted(dirs)
        for name in dirs + files:
            item = p / name
            info = item.lstat()
            if stat.S_ISLNK(info.st_mode):
                raise TerrainError("terrain cache contains symlink")
            if stat.S_ISREG(info.st_mode):
                total += info.st_size
            if total > MAX_DISK_BYTES:
                raise ByteLimitError("terrain pilot disk use exceeds 30 MB cap")
    return total


def append_record(path: Path, record: dict[str, object]) -> None:
    raw = canonical(record) + b"\n"
    if len(raw) > 16_000:
        raise ByteLimitError("terrain attempt record exceeds 16 KB")
    flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags, 0o600)
    try:
        if os.fstat(fd).st_size + len(raw) > MAX_METADATA_BYTES:
            raise ByteLimitError("terrain attempt audit exceeds 1 MB cap")
        view = memoryview(raw)
        written = 0
        while written < len(view):
            count = os.write(fd, view[written:])
            if count <= 0:
                raise OSError("attempt log append made no progress")
            written += count
        os.fsync(fd)
    finally:
        os.close(fd)
    sync_dir(path.parent)


def append_partial(path: Path, data: bytes) -> None:
    if not data:
        return
    flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size + len(data) > MAX_SOURCE_BYTES:
            raise ByteLimitError("terrain partial audit exceeds 5 MB cap")
        view = memoryview(data)
        written = 0
        while written < len(view):
            count = os.write(fd, view[written:])
            if count <= 0:
                raise OSError("terrain partial write made no progress")
            written += count
        os.fsync(fd)
    finally:
        os.close(fd)
    sync_dir(path.parent)


def read_index(index_path: Path) -> dict[str, object] | None:
    try:
        info = index_path.lstat()
    except FileNotFoundError:
        return None
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_size > 16_000:
        raise TerrainError("terrain current index is unsafe or oversized")
    try:
        data = json.loads(index_path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise TerrainError("terrain current index is corrupt; preserving it for audit") from error
    if not isinstance(data, dict) or not isinstance(data.get("sourceSha256"), str):
        raise TerrainError("terrain current index is invalid; preserving it for audit")
    return data


def recorded_network_reservation(audit_path: Path, request_hash: str) -> int:
    """Return measured successful bodies plus unresolved/failed reservations."""
    if not audit_path.exists():
        return 0
    info = audit_path.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_size > MAX_METADATA_BYTES:
        raise TerrainError("terrain attempt audit is unsafe or oversized")
    latest: dict[str, dict[str, object]] = {}
    for line in audit_path.read_bytes().splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError as error:
            raise TerrainError("terrain attempt audit has an invalid record; refusing new network work") from error
        if not isinstance(row, dict) or row.get("requestHash") != request_hash:
            continue
        attempt_id = row.get("attemptId")
        if not isinstance(attempt_id, str):
            continue
        if row.get("status") in {"started", "started-cache-check", "success", "success-cache-hit", "failed", "not-admitted"}:
            latest[attempt_id] = row
    total = 0
    for row in latest.values():
        status = row.get("status")
        if status == "success":
            amount = row.get("networkBytesMeasured")
        elif status == "success-cache-hit" or status == "not-admitted" or status == "started-cache-check":
            amount = 0
        else:  # failed or an interrupted started attempt: retain its full reservation
            amount = row.get("reservedUpperBoundBytes", MAX_NETWORK_BYTES)
        if not isinstance(amount, int) or amount < 0 or amount > MAX_NETWORK_BYTES:
            raise TerrainError("terrain attempt audit has invalid network accounting")
        total += amount
    if total > MAX_NETWORK_BYTES:
        raise TerrainError("terrain attempt audit exceeds the 5 MB cumulative pilot network cap")
    return total


def new_attempt_record(attempt_id: str, status: str, reservation: int = 0) -> dict[str, object]:
    return {"attemptId": attempt_id, "requestHash": REQUEST_HASH, "tileId": TILE_ID,
            "selection": REQUEST_BOUNDS, "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "status": status, "requestedNetworkByteCap": MAX_NETWORK_BYTES,
            "reservedUpperBoundBytes": reservation, "requestedDiskByteCap": MAX_DISK_BYTES,
            "requestedTimeCapMs": MAX_RUN_SECONDS * 1000, "requestedRssCapBytes": MAX_RSS_BYTES}


def atomic_immutable(path: Path, data: bytes, cap: int) -> None:
    if len(data) > cap:
        raise ByteLimitError("terrain output exceeds metadata/source cap")
    if path.exists() or path.is_symlink():
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_size != len(data):
            raise TerrainError("immutable terrain destination conflicts with existing entry")
        if sha(path.read_bytes()) != sha(data):
            raise TerrainError("immutable terrain destination has different content")
        return
    temp = path.with_name(f".{path.name}.{os.getpid()}.{time.time_ns()}.part")
    durable_create(temp, data, cap)
    try:
        os.link(temp, path, follow_symlinks=False)
    except FileExistsError:
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_size != len(data) or sha(path.read_bytes()) != sha(data):
            temp.unlink(missing_ok=True)
            raise TerrainError("immutable terrain destination conflicts with concurrently published content")
    finally:
        temp.unlink(missing_ok=True)
    sync_dir(path.parent)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch_source(run_dir: Path, started: float, network: dict[str, int]) -> tuple[bytes, dict[str, object], Path]:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    headers: dict[str, object] = {}
    last_error: Exception | None = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        if time.monotonic() - started > MAX_RUN_SECONDS:
            raise TerrainError("terrain acquisition exceeded 60 second wall cap")
        attempt_id = f"{time.time_ns()}-{attempt}"
        partial = run_dir / f"{attempt_id}.partial"
        attempt_started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        req = urllib.request.Request(URL, headers={"Accept": "image/tiff", "User-Agent": "joinallworld-terrain/1"})
        payload = bytearray()

        def consume(response) -> None:
            while True:
                if time.monotonic() - started > MAX_RUN_SECONDS:
                    raise TerrainError("terrain acquisition exceeded 60 second wall cap")
                chunk = response.read(min(64 * 1024, MAX_NETWORK_BYTES - network["bytes"] + 1))
                if not chunk:
                    return
                network["bytes"] += len(chunk)
                remaining_payload = max(0, MAX_SOURCE_BYTES - len(payload))
                persisted = chunk[:remaining_payload]
                append_partial(partial, persisted)
                payload.extend(persisted)
                if network["bytes"] > MAX_NETWORK_BYTES:
                    raise ByteLimitError("terrain network response bytes exceed 5 MB aggregate cap")
                if len(payload) > MAX_SOURCE_BYTES:
                    raise ByteLimitError("terrain source exceeds 5 MB cap")
                if disk_usage(run_dir.parents[1]) > MAX_DISK_BYTES:
                    raise ByteLimitError("terrain pilot disk use exceeds 30 MB cap")

        def failed(error: Exception) -> None:
            if not payload and partial.exists():
                partial.unlink()
                sync_dir(run_dir)
            append_record(run_dir / "attempts.jsonl", {
                "attempt": attempt, "startedAt": attempt_started,
                "endedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "status": "network-failure", "reason": str(error)[:1000],
                "networkBytesMeasured": None, "measuredNetworkBytesBeforeFailure": network["bytes"],
                "partialPath": str(partial) if payload else None,
                "requestedNetworkByteCap": MAX_NETWORK_BYTES, "reservedUpperBoundBytes": MAX_NETWORK_BYTES,
                "requestedDiskByteCap": MAX_DISK_BYTES, "requestedTimeCapMs": MAX_RUN_SECONDS * 1000,
            })

        try:
            with opener.open(req, timeout=min(20, MAX_RUN_SECONDS)) as response:
                if response.geturl() != URL:
                    raise TerrainError("terrain source changed URL")
                if response.status != 200:
                    consume(response)
                    raise TerrainError(f"terrain source returned HTTP {response.status}")
                declared = response.headers.get("Content-Length")
                if declared is None or not declared.isdigit() or int(declared) != EXPECTED_BYTES:
                    raise TerrainError("terrain source length does not match pinned metadata probe")
                if response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "image/tiff":
                    consume(response)
                    raise TerrainError("terrain source content type is not image/tiff")
                headers = {"etag": response.headers.get("ETag"), "lastModified": response.headers.get("Last-Modified"),
                           "contentType": response.headers.get("Content-Type"), "contentLength": int(declared)}
                consume(response)
            if len(payload) != EXPECTED_BYTES:
                raise TerrainError("terrain source ended before pinned Content-Length")
            data = bytes(payload)
            return data, headers, partial
        except urllib.error.HTTPError as error:
            # urllib raises HTTPError for error statuses instead of returning a
            # response; its body is still charged and preserved as partial evidence.
            try:
                consume(error)
                failure: Exception = TerrainError(f"terrain source returned HTTP {error.code}")
            except Exception as body_error:
                failure = body_error
            finally:
                error.close()
            last_error = failure
            failed(failure)
            if attempt == MAX_ATTEMPTS or isinstance(failure, (ByteLimitError, TerrainError)):
                raise failure from error
        except Exception as error:  # each failed body's bytes remain counted and auditable
            last_error = error
            failed(error)
            if attempt == MAX_ATTEMPTS or isinstance(error, (ByteLimitError, TerrainError)):
                raise
    assert last_error is not None
    raise last_error


def build_sidecar(data: bytes, source_hash: str, headers: dict[str, object], run_dir: Path) -> tuple[dict[str, object], dict[str, object]]:
    import numpy as np
    import rasterio

    staged = run_dir / "source.tif"
    durable_create(staged, data, MAX_SOURCE_BYTES)
    with rasterio.open(staged) as ds:
        if ds.driver != "GTiff" or ds.width != 1200 or ds.height != 1200 or ds.count != 1 or ds.dtypes != ("float32",):
            raise TerrainError("terrain raster dimensions or band type differ from pinned Accra COG metadata")
        if ds.crs is None or ds.crs.to_epsg() != 4326:
            raise TerrainError("terrain raster is not EPSG:4326")
        tags = ds.tags()
        if tags.get("AREA_OR_POINT") != "Point":
            raise TerrainError("terrain raster is not PixelIsPoint")
        if ds.block_shapes != [(2048, 2048)] or ds.compression is None or ds.compression.name.lower() != "deflate":
            raise TerrainError("terrain raster block layout/compression differs from pinned GLO-90 COG metadata")
        transform = ds.transform
        expected_step = 1 / 1200
        if abs(transform.a - expected_step) > 1e-10 or abs(transform.e + expected_step) > 1e-10 or abs(transform.b) > 1e-12 or abs(transform.d) > 1e-12:
            raise TerrainError("terrain raster grid scale/rotation differs from the expected Accra grid")
        # RFC33 maps the PixelIsPoint GeoTIFF tiepoint to the center of the
        # first pixel; GDAL exposes the affine as an area/corner transform.
        # Confirm the half-pixel distinction rather than using the corner as
        # the first sample coordinate.
        x0, y0 = ds.xy(0, 0, offset="center")
        corner_x, corner_y = transform * (0, 0)
        if abs(corner_x - (x0 - expected_step / 2)) > 1e-8 or abs(corner_y - (y0 + expected_step / 2)) > 1e-8:
            raise TerrainError("terrain affine corner transform does not honor PixelIsPoint half-pixel offset")
        if abs(x0 - (-1)) > 1e-8 or abs(y0 - 6) > 1e-8:
            raise TerrainError("terrain PixelIsPoint origin sample does not match the Accra geocell tiepoint")
        west, south, east, north = REQUEST_BOUNDS
        col_min = max(0, math.ceil((west - x0) / transform.a - 1e-10))
        col_max = min(ds.width - 1, math.floor((east - x0) / transform.a + 1e-10))
        row_min = max(0, math.ceil((north - y0) / transform.e - 1e-10))
        row_max = min(ds.height - 1, math.floor((south - y0) / transform.e + 1e-10))
        window = rasterio.windows.Window(col_min, row_min, col_max - col_min + 1, row_max - row_min + 1)
        if window.width < 2 or window.height < 2 or window.width * window.height > 256:
            raise TerrainError("Accra request did not map to a bounded sample window of at least 2x2")
        raw = ds.read(1, window=window, masked=False)
        mask = ds.read_masks(1, window=window)
        no_data = ds.nodata
        points = []
        valid_values = []
        for row in range(raw.shape[0]):
            for col in range(raw.shape[1]):
                value = float(raw[row, col])
                valid = int(mask[row, col]) != 0 and np.isfinite(value)
                if no_data is not None and value == no_data:
                    valid = False
                x, y = ds.xy(int(window.row_off + row), int(window.col_off + col), offset="center")
                points.append({"longitude": x, "latitude": y, "valueMeters": value if valid else None,
                               "state": "data" if valid else "no_data"})
                if valid:
                    valid_values.append(value)
        if len(valid_values) < 4:
            raise TerrainError("Accra sample window contains fewer than four usable elevation values")
        metadata = {
            "driver": ds.driver, "width": ds.width, "height": ds.height, "bands": ds.count,
            "dtype": ds.dtypes[0], "nodata": no_data, "maskFlags": [flag.name for flag in ds.mask_flag_enums[0]],
            "areaOrPointTag": tags.get("AREA_OR_POINT"), "transform": list(transform),
            "bounds": list(ds.bounds), "crs": ds.crs.to_string(), "sampleWindow": {
                "columnOffset": int(window.col_off), "rowOffset": int(window.row_off),
                "width": int(window.width), "height": int(window.height),
                "pixelCoordinateSemantics": "PixelIsPoint: GDAL affine is area/corner transform with RFC33 half-pixel shift; ds.xy(center) returns sample coordinate",
            },
        }
        source = {"provider": "Copernicus", "product": "Copernicus DEM GLO-90", "tileId": TILE_ID,
                  "url": URL, "bytes": len(data), "sha256": source_hash, "etag": headers.get("etag"),
                  "lastModified": headers.get("lastModified")}
        sidecar = {
            "schemaVersion": 1, "id": "copernicus-glo90-accra-v1", "source": source,
            "surfaceModel": "DSM", "horizontalReference": {"crs": "WGS84-G1150", "epsg": 4326},
            "verticalReference": {"status": "source-stated-cog-vertical-key-absent", "datum": "EGM2008",
                                  "epsg": 3855, "unit": "m",
                                  "evidence": "Copernicus GLO-90 handbook specifies EGM2008; this COG exposes no vertical GeoKey."},
            "grid": {"width": ds.width, "height": ds.height, "longitudeStepArcSeconds": abs(transform.a) * 3600,
                     "latitudeStepArcSeconds": abs(transform.e) * 3600, "sampling": "nearest-source-pixel",
                     "rasterType": "PixelIsPoint", "nativeRasterMetadata": metadata},
            "values": {"unit": "m", "noDataEncoding": "Rasterio mask + dataset nodata metadata; no sentinel guessed",
                       "maskValidCount": len(valid_values), "maskInvalidCount": len(points) - len(valid_values),
                       "validMin": min(valid_values), "validMax": max(valid_values),
                       "samples": points, "sampleBounds": REQUEST_BOUNDS,
                       "ellipsoidConversion": "not-applied"},
            "derivation": {"algorithmVersion": "copernicus-glo90-native-window-v1", "sourceSha256": source_hash},
            "exceptions": ["DSM includes surface objects; not bare earth.",
                           "Only Accra request-window pixels and their GDAL mask were inspected; no global no-data inference.",
                           "Vertical datum is product-handbook-stated; COG has no vertical GeoKey; no ellipsoid conversion."],
            "attribution": ATTRIBUTION,
        }
    raw_sidecar = canonical(sidecar)
    if len(raw_sidecar) > MAX_METADATA_BYTES:
        raise ByteLimitError("terrain sidecar exceeds 1 MB cap")
    return sidecar, metadata


def run(root_value: str) -> dict[str, object]:
    root = checked_root(root_value)
    terrain_root = root / "terrain"
    attempts_dir = terrain_root / "attempts"
    sources_dir = terrain_root / "sources"
    sidecars_dir = terrain_root / "sidecars"
    for directory in (terrain_root, attempts_dir, sources_dir, sidecars_dir):
        ensure_dir(root, directory)
    audit = attempts_dir / "attempts.jsonl"
    started = time.monotonic()
    attempt_id = f"{time.time_ns()}"
    run_dir = attempts_dir / attempt_id
    ensure_dir(root, run_dir)
    network = {"bytes": 0}
    start_record = new_attempt_record(attempt_id, "started-cache-check")
    append_record(audit, start_record)
    network_reserved = False
    terminal_written = False
    try:
        disk_usage(terrain_root)
        index_path = terrain_root / "current.json"
        cached = read_index(index_path)
        if cached:
            if cached.get("requestHash") != REQUEST_HASH or cached.get("tileId") != TILE_ID:
                raise TerrainError("terrain cache index request/tile pin mismatch; preserving cache")
            checksum = cached.get("sourceSha256")
            if not isinstance(checksum, str) or len(checksum) != 64 or any(c not in "0123456789abcdef" for c in checksum):
                raise TerrainError("terrain cache index has invalid source hash; preserving it")
            source_path = sources_dir / f"{checksum}.tif"
            sidecar_hash = cached.get("sidecarSha256")
            if not isinstance(sidecar_hash, str) or len(sidecar_hash) != 64 or any(c not in "0123456789abcdef" for c in sidecar_hash):
                raise TerrainError("terrain cache index has invalid sidecar hash; preserving it")
            sidecar_path = sidecars_dir / f"{sidecar_hash}.json"
            for p in (source_path, sidecar_path):
                info = p.lstat()
                if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_size > (MAX_SOURCE_BYTES if p.suffix == ".tif" else MAX_METADATA_BYTES):
                    raise TerrainError("terrain cache entry is unsafe or oversized")
            raw = source_path.read_bytes()
            sidecar_raw = sidecar_path.read_bytes()
            if sha(raw) != checksum or len(raw) != EXPECTED_BYTES or len(raw) != cached.get("sourceBytes"):
                raise TerrainError("terrain source cache checksum/length mismatch; preserving cache")
            if sha(sidecar_raw) != sidecar_hash or len(sidecar_raw) != cached.get("sidecarBytes"):
                raise TerrainError("terrain sidecar cache checksum/length mismatch; preserving cache")
            try:
                cached_sidecar = json.loads(sidecar_raw)
            except (OSError, json.JSONDecodeError) as error:
                raise TerrainError("terrain sidecar cache is corrupt; preserving cache") from error
            if not isinstance(cached_sidecar, dict) or not isinstance(cached_sidecar.get("source"), dict) or cached_sidecar["source"].get("sha256") != checksum:
                raise TerrainError("terrain sidecar cache hash does not match source; preserving cache")
            if cached.get("sourcePath") != source_path.name or cached.get("sidecarPath") != sidecar_path.name:
                raise TerrainError("terrain cache index paths do not match immutable hash names")
            if cached.get("derivation") != cached_sidecar.get("derivation"):
                raise TerrainError("terrain cache index derivation pin mismatch")
            headers = cached.get("headers")
            if (not isinstance(headers, dict) or set(headers) != {"etag", "lastModified", "contentType", "contentLength"}
                    or not isinstance(headers.get("contentType"), str)
                    or headers.get("contentType", "").split(";", 1)[0].strip().lower() != "image/tiff"
                    or headers.get("contentLength") != EXPECTED_BYTES
                    or (headers.get("etag") is not None and not isinstance(headers.get("etag"), str))
                    or (headers.get("lastModified") is not None and not isinstance(headers.get("lastModified"), str))):
                raise TerrainError("terrain cache index source response metadata pin is invalid")
            reconstructed, _ = build_sidecar(raw, checksum, headers, run_dir)
            reconstructed_bytes = canonical(reconstructed)
            (run_dir / "source.tif").unlink(missing_ok=True)
            sync_dir(run_dir)
            if reconstructed_bytes != sidecar_raw:
                raise TerrainError("terrain sidecar content does not reproduce from cached COG; preserving cache")
            result = {"sourcePath": str(source_path), "sidecarPath": str(sidecar_path), "sha256": checksum,
                      "bytes": len(raw), "cacheHit": True, "networkBytes": 0}
            append_record(audit, {**start_record, "endedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                  "status": "success-cache-hit", "networkBytesMeasured": 0,
                                  "sourceSha256": checksum, "sidecarPath": str(sidecar_path)})
            terminal_written = True
            return result

        used = recorded_network_reservation(audit, REQUEST_HASH)
        if used + MAX_NETWORK_BYTES > MAX_NETWORK_BYTES:
            append_record(audit, {**start_record, "endedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                  "status": "not-admitted", "networkBytesMeasured": 0,
                                  "reason": "cumulative pilot network cap is already reserved or measured"})
            terminal_written = True
            raise TerrainError("cumulative pilot network cap prevents another fresh acquisition")

        start_record = new_attempt_record(attempt_id, "started", MAX_NETWORK_BYTES)
        append_record(audit, start_record)
        network_reserved = True

        if shutil.disk_usage(root).free < MIN_FREE_DISK_BYTES:
            raise ByteLimitError("terrain fetch requires at least 100 MB free disk reserve")
        data, headers, partial_path = fetch_source(run_dir, started, network)
        source_hash = sha(data)
        sidecar, raster_metadata = build_sidecar(data, source_hash, headers, run_dir)
        source_path = sources_dir / f"{source_hash}.tif"
        sidecar_bytes = canonical(sidecar)
        sidecar_hash = sha(sidecar_bytes)
        sidecar_path = sidecars_dir / f"{sidecar_hash}.json"
        # Account for existing files plus staged source, cache source, sidecar and index temp.
        if disk_usage(terrain_root) + len(data) * 2 + len(sidecar_bytes) + 16_000 > MAX_DISK_BYTES:
            raise ByteLimitError("terrain pilot disk use would exceed 30 MB cap")
        atomic_immutable(source_path, data, MAX_SOURCE_BYTES)
        atomic_immutable(sidecar_path, sidecar_bytes, MAX_METADATA_BYTES)
        index = canonical({"requestHash": REQUEST_HASH, "tileId": TILE_ID, "sourceSha256": source_hash, "sourceBytes": len(data),
                           "sidecarSha256": sidecar_hash, "sidecarBytes": len(sidecar_bytes),
                           "sourcePath": source_path.name, "sidecarPath": sidecar_path.name,
                           "headers": headers, "derivation": sidecar["derivation"]})
        index_path = terrain_root / "current.json"
        temp_index = terrain_root / f".current.{attempt_id}.tmp"
        durable_create(temp_index, index, 16_000)
        try:
            os.link(temp_index, index_path, follow_symlinks=False)
        except FileExistsError:
            if index_path.is_symlink() or index_path.stat().st_size != len(index) or sha(index_path.read_bytes()) != sha(index):
                raise TerrainError("terrain current index already contains different immutable content")
        finally:
            temp_index.unlink(missing_ok=True)
        sync_dir(terrain_root)
        try:
            (run_dir / "source.tif").unlink()
            partial_path.unlink(missing_ok=True)
            sync_dir(run_dir)
        except FileNotFoundError:
            pass
        append_record(audit, {**start_record, "endedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                              "status": "success", "networkBytesMeasured": network["bytes"],
                              "sourceSha256": source_hash, "sourceBytes": len(data),
                              "sidecarPath": str(sidecar_path), "raster": raster_metadata,
                              "limits": {"networkBytes": MAX_NETWORK_BYTES, "diskBytes": MAX_DISK_BYTES,
                                         "durationMs": MAX_RUN_SECONDS * 1000, "rssBytes": MAX_RSS_BYTES}})
        terminal_written = True
        return {"sourcePath": str(source_path), "sidecarPath": str(sidecar_path), "sha256": source_hash,
                "bytes": len(data), "cacheHit": False, "networkBytes": network["bytes"],
                "raster": raster_metadata}
    except Exception as error:
        if not terminal_written:
            append_record(audit, {**start_record, "endedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                              "status": "failed", "reason": str(error)[:1000],
                              "networkBytesMeasured": None, "reservedUpperBoundBytes": MAX_NETWORK_BYTES if network_reserved else 0,
                              "measuredNetworkBytesBeforeFailure": network["bytes"],
                              "evidencePath": str(audit)})
        raise


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] != "--root":
        print("Usage: terrain.py --root /absolute/build-root", file=sys.stderr)
        return 2
    try:
        result = run(sys.argv[2])
        print(json.dumps(result, separators=(",", ":")))
        return 0
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
