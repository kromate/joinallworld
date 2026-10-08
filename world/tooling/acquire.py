#!/usr/bin/env python3
"""Bounded regional Overture GeoParquet adapter. The JSON input is data, never SQL."""
from __future__ import annotations

import hashlib
import errno
import http.client
import json
import math
from contextlib import nullcontext
from decimal import Decimal
import os
from pathlib import Path
import re
import resource
import socket
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urljoin, urlsplit
import urllib.request

import importlib.util

_RANGE_CACHE_SPEC = importlib.util.spec_from_file_location("world_range_cache", Path(__file__).resolve().with_name("range_cache.py"))
if _RANGE_CACHE_SPEC is None or _RANGE_CACHE_SPEC.loader is None:
    raise RuntimeError("fixed range-cache helper is unavailable")
_RANGE_CACHE_MODULE = importlib.util.module_from_spec(_RANGE_CACHE_SPEC)
_RANGE_CACHE_SPEC.loader.exec_module(_RANGE_CACHE_MODULE)
ExactRangeCache = _RANGE_CACHE_MODULE.ExactRangeCache
RangeCacheError = _RANGE_CACHE_MODULE.RangeCacheError

MAX_ITEM_LINKS = 640
MAX_CATALOG_BYTES = 2_000_000
MAX_INDEX_BYTES = 10_000_000
IDENT = re.compile(r"^[A-Za-z0-9._:/-]{1,256}$")
COMPILER_ID = "world-source-compiler-v2"
HARD_LIMITS = {"networkBytes": 32_000_000, "outputBytes": 20_000_000, "features": 50_000,
               "durationMs": 900_000, "memoryMb": 2_048, "diskBytes": 256_000_000}


class BudgetExceeded(RuntimeError):
    pass


class FeatureRowLimitExceeded(BudgetExceeded):
    pass


class AdapterBudgetFailure(BudgetExceeded):
    REASONS = {"selected-item-count", "feature-row-budget", "geojson-output-bytes"}

    def __init__(self, reason: str, network_bytes_measured: int):
        if reason not in self.REASONS or isinstance(network_bytes_measured, bool) or not isinstance(network_bytes_measured, int) or network_bytes_measured < 0:
            raise ValueError("invalid typed acquisition budget failure")
        super().__init__(reason)
        self.reason = reason
        self.network_bytes_measured = network_bytes_measured


def typed_budget_failure(reason: str, budget: "NetworkBudget", proxy_error: dict[str, object] | None = None) -> AdapterBudgetFailure:
    if proxy_error is not None:
        raise BudgetExceeded(f"{reason} exceeded with an upstream proxy failure")
    if not budget.settled:
        raise BudgetExceeded(f"{reason} exceeded with unobserved network activity")
    return AdapterBudgetFailure(reason, budget.total)


def write_durable(path: Path, data: bytes) -> None:
    with path.open("xb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def sync_directory(path: Path) -> None:
    try:
        descriptor = os.open(path, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    except OSError as error:
        if error.errno not in (errno.EINVAL, errno.ENOTSUP, errno.EBADF):
            raise


class IndexDiskBudget:
    def __init__(self, root: Path, maximum: int):
        self.root = root
        self.maximum = maximum
        self.lock = threading.Lock()
        self.used = self._size(root)
        self.reserved = 0
        self.initial = self.used

    def _size(self, directory: Path) -> int:
        if not directory.exists():
            return 0
        total = 0
        for path in directory.rglob("*"):
            if path.is_symlink():
                raise ValueError("STAC source index cache contains a symlink")
            if path.is_file():
                total += path.stat().st_size
        return total

    def reserve(self, count: int) -> None:
        with self.lock:
            if count < 0 or self.used + self.reserved + count > self.maximum:
                raise BudgetExceeded("STAC release item index exceeds disk byte budget")
            self.reserved += count

    def commit(self, count: int) -> None:
        with self.lock:
            self.reserved -= count
            self.used += count

    def release(self, count: int) -> None:
        with self.lock:
            self.reserved -= count

    @property
    def written(self) -> int:
        with self.lock:
            return self.used - self.initial


class NetworkBudget:
    def __init__(self, maximum: int):
        self.maximum = maximum
        self.total = 0
        self.lock = threading.Lock()
        self.entries: dict[str, dict[str, object]] = {}
        self.reservations: dict[int, int] = {}
        self.next_reservation = 0

    @property
    def remaining(self) -> int:
        with self.lock:
            return self.maximum - self.total - sum(self.reservations.values())

    @property
    def settled(self) -> bool:
        with self.lock:
            return not self.reservations

    def add(self, url: str, count: int, etag: str | None = None) -> None:
        with self.lock:
            if self.total + sum(self.reservations.values()) + count > self.maximum:
                raise BudgetExceeded("network response byte budget exceeded")
            self._record(url, count, etag)

    def reserve(self, capacity: int) -> int:
        with self.lock:
            if capacity < 0 or self.total + sum(self.reservations.values()) + capacity > self.maximum:
                raise BudgetExceeded("network budget cannot reserve the requested upstream Range response")
            self.next_reservation += 1
            self.reservations[self.next_reservation] = capacity
            return self.next_reservation

    def consume(self, reservation: int, url: str, count: int, etag: str | None = None) -> None:
        with self.lock:
            capacity = self.reservations.get(reservation, 0)
            if count < 0 or count > capacity:
                raise BudgetExceeded("upstream Range response exceeded its byte reservation")
            self.reservations[reservation] = capacity - count
            self._record(url, count, etag)

    def release(self, reservation: int) -> None:
        with self.lock:
            self.reservations.pop(reservation, None)

    def token_remaining(self, reservation: int) -> int:
        with self.lock:
            return self.reservations.get(reservation, 0)

    def _record(self, url: str, count: int, etag: str | None) -> None:
        self.total += count
        entry = self.entries.setdefault(url, {"url": url, "etag": None, "bytes": 0})
        entry["bytes"] = int(entry["bytes"]) + count
        if etag:
            entry["etag"] = etag

    def rows(self) -> list[dict[str, object]]:
        return [dict(value) for _, value in sorted(self.entries.items())]


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def require_obj(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise TypeError(f"{label} must be an object")
    return value


def safe_url(url: str, host: str, release: str) -> str:
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or parsed.hostname != host or parsed.username or parsed.password
            or parsed.query or parsed.fragment or release not in parsed.path):
        raise ValueError("STAC/data URL is outside the pinned HTTPS allowlist")
    return url


def request_json(url: str, budget: NetworkBudget, host: str, release: str) -> tuple[dict[str, object], str | None, int]:
    safe_url(url, host, release)
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "joinallworld-acquirer/1"})
    # Redirects are rejected: a pinned STAC URL cannot silently change its host.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            raise ValueError("STAC redirect refused")
    opener = urllib.request.build_opener(NoRedirect)
    header_reservation = budget.reserve(8_192)
    body_reservation: int | None = None
    try:
        with opener.open(req, timeout=20) as response:
            if response.status != 200:
                raise RuntimeError(f"STAC returned HTTP {response.status}")
            declared = response.headers.get("Content-Length")
            if declared is None:
                raise BudgetExceeded("STAC response has no Content-Length for bounded transfer")
            body_bytes = int(declared)
            version = "1.0" if response.version == 10 else "1.1"
            header_bytes = len(f"HTTP/{version} {response.status} {response.reason}\r\n") + sum(len(k) + len(v) + 4 for k, v in response.headers.items()) + 2
            budget.consume(header_reservation, url, header_bytes, response.headers.get("ETag"))
            if body_bytes > MAX_CATALOG_BYTES:
                raise BudgetExceeded("STAC response exceeds per-document byte cap")
            budget.release(header_reservation)
            header_reservation = 0
            body_reservation = budget.reserve(body_bytes)
            chunks: list[bytes] = []
            length = 0
            while length < body_bytes:
                part = response.read(min(64 * 1024, body_bytes - length))
                if not part:
                    raise RuntimeError("STAC response ended before Content-Length")
                length += len(part)
                budget.consume(body_reservation, url, len(part), response.headers.get("ETag"))
                chunks.append(part)
            raw = b"".join(chunks)
            try:
                result = require_obj(json.loads(raw), "STAC JSON")
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                raise ValueError("STAC response is not valid JSON") from error
            return result, response.headers.get("ETag"), len(raw)
    finally:
        if header_reservation:
            budget.release(header_reservation)
        if body_reservation:
            budget.release(body_reservation)


def check_cache_path(root: Path, target: Path) -> None:
    relative = target.relative_to(root)
    current = root
    for part in relative.parts:
        current = current / part
        if current.exists() and current.is_symlink():
            raise ValueError("STAC cache path contains a symlink")


def cached_json(url: str, budget: NetworkBudget, host: str, release: str, cache_dir: Path, root: Path, disk_budget: IndexDiskBudget) -> dict[str, object]:
    safe_url(url, host, release)
    key = sha(url.encode("utf-8"))
    data_path = cache_dir / f"{key}.json"
    receipt_path = cache_dir / f"{key}.receipt.json"
    check_cache_path(root, data_path)
    check_cache_path(root, receipt_path)
    if data_path.is_file() and receipt_path.is_file():
        if data_path.stat().st_size <= MAX_CATALOG_BYTES and receipt_path.stat().st_size <= 16_000:
            try:
                raw = data_path.read_bytes()
                receipt = require_obj(json.loads(receipt_path.read_bytes()), "cached STAC document receipt")
                if receipt.get("url") == url and receipt.get("sha256") == sha(raw) and receipt.get("bytes") == len(raw):
                    return require_obj(json.loads(raw), "cached STAC document")
            except (OSError, ValueError, json.JSONDecodeError):
                pass
    cache_dir.mkdir(parents=True, exist_ok=True)
    check_cache_path(root, cache_dir)
    document, etag, _ = request_json(url, budget, host, release)
    raw = canonical(document)
    if len(raw) > MAX_CATALOG_BYTES:
        raise BudgetExceeded("STAC document exceeds its persistent cache cap")
    temp_data = cache_dir / f".{key}.{os.getpid()}.{time.time_ns()}.tmp"
    temp_receipt = cache_dir / f".{key}.{os.getpid()}.{time.time_ns()}.receipt.tmp"
    receipt_bytes = canonical({"url": url, "sha256": sha(raw), "bytes": len(raw), "etag": etag})
    reserved = len(raw) + len(receipt_bytes)
    disk_budget.reserve(reserved)
    try:
        write_durable(temp_data, raw)
        write_durable(temp_receipt, receipt_bytes)
        os.replace(temp_data, data_path)
        os.replace(temp_receipt, receipt_path)
        sync_directory(cache_dir)
        disk_budget.commit(reserved)
    except Exception:
        temp_data.unlink(missing_ok=True)
        temp_receipt.unlink(missing_ok=True)
        disk_budget.release(reserved)
        raise
    return document


def intersects(a: list[float], b: list[float]) -> bool:
    return a[0] <= b[2] and a[2] >= b[0] and a[1] <= b[3] and a[3] >= b[1]


def split_bounds(bounds: list[float]) -> list[list[float]]:
    west, south, east, north = bounds
    return [[west, south, 180.0, north], [-180.0, south, east, north]] if west > east else [bounds]


def select_item_index(request: dict[str, object], config: dict[str, object], index_dir: Path, budget: NetworkBudget, allowed_root: Path, disk_budget: IndexDiskBudget) -> tuple[dict[str, list[dict[str, object]]], list[dict[str, object]], dict[str, object]]:
    stac = require_obj(config.get("stac"), "sourceConfig.stac")
    host = str(stac.get("allowedAssetHost"))
    collections = require_obj(stac.get("collections"), "sourceConfig.stac.collections")
    release = str(request["release"])
    cfg_hash = sha(canonical({"release": release, "collections": collections}))
    release_cache = index_dir / release
    index_file = release_cache / "item-index.json"
    receipt_file = release_cache / "item-index.receipt.json"
    index: dict[str, object] | None = None
    if (index_file.is_file() and receipt_file.is_file() and not index_file.is_symlink() and not receipt_file.is_symlink()
            and index_file.stat().st_size <= MAX_INDEX_BYTES and receipt_file.stat().st_size <= 16_000):
        try:
            raw = index_file.read_bytes()
            meta = require_obj(json.loads(receipt_file.read_bytes()), "cached index receipt")
            if meta.get("configHash") == cfg_hash and meta.get("sha256") == sha(raw) and meta.get("bytes") == len(raw):
                index = require_obj(json.loads(raw), "cached STAC index")
        except (OSError, ValueError, json.JSONDecodeError):
            index = None
    if index is None:
        index_dir.mkdir(parents=True, exist_ok=True)
        release_cache.mkdir(parents=True, exist_ok=True)
        check_cache_path(allowed_root, release_cache)
        built: dict[str, object] = {}
        all_entries: list[dict[str, object]] = []
        total_docs = 0
        # The collection documents are small, static release indexes. Their item links
        # are fetched exactly once and cached; regions then select by each item's bbox.
        for layer in ("buildings", "roads"):
            collection = require_obj(collections.get(layer), f"collection {layer}")
            url = str(collection.get("url"))
            doc = cached_json(url, budget, "stac.overturemaps.org", release, release_cache / "collections", allowed_root, disk_budget)
            expected = int(collection.get("itemCount", 0))
            links = doc.get("links")
            if not isinstance(links, list):
                raise ValueError(f"{layer} STAC collection has no links array")
            item_hrefs: list[str] = []
            for link_value in links:
                link = require_obj(link_value, "STAC link")
                if link.get("rel") != "item":
                    continue
                href = link.get("href")
                if not isinstance(href, str):
                    raise ValueError("STAC item link href is invalid")
                item_hrefs.append(urljoin(url, href))
            if len(item_hrefs) != expected or len(item_hrefs) > MAX_ITEM_LINKS:
                raise ValueError(f"{layer} STAC item count differs from verified pin")
            if len(set(item_hrefs)) != len(item_hrefs):
                raise ValueError(f"{layer} STAC collection repeats an item URL")
            entries: list[dict[str, object]] = []
            def fetch_item(item_url: str) -> tuple[str, dict[str, object]]:
                item_url = safe_url(item_url, "stac.overturemaps.org", release)
                item = cached_json(item_url, budget, "stac.overturemaps.org", release, release_cache / "items" / layer, allowed_root, disk_budget)
                bbox = item.get("bbox")
                if not isinstance(bbox, list) or len(bbox) not in (4, 6) or any(not isinstance(x, (int, float)) for x in bbox):
                    raise ValueError("STAC item is missing a 2D bbox")
                bbox2d = [float(x) for x in bbox[:4]]
                if any(not math.isfinite(x) for x in bbox2d) or bbox2d[0] < -180 or bbox2d[2] > 180 or bbox2d[1] < -90 or bbox2d[3] > 90 or bbox2d[1] > bbox2d[3]:
                    raise ValueError("STAC item bbox is outside WGS84")
                assets = require_obj(item.get("assets"), "STAC item assets")
                aws = require_obj(assets.get("aws"), "STAC aws asset")
                href = aws.get("href")
                if not isinstance(href, str):
                    raise ValueError("STAC item has no aws GeoParquet asset")
                href = safe_url(href, host, release)
                file_size = aws.get("file:size")
                if isinstance(file_size, bool) or not isinstance(file_size, int) or file_size < 1 or file_size > 2_000_000_000:
                    raise ValueError("STAC asset file:size is invalid")
                item_id = item.get("id")
                if not isinstance(item_id, str) or not item_id or len(item_id) > 256:
                    raise ValueError("STAC item ID is invalid")
                return item_url, {"id": item_id, "bbox": bbox2d, "url": href, "fileBytes": file_size, "collectionUrl": url, "layer": layer}
            with ThreadPoolExecutor(max_workers=2, thread_name_prefix="stac-index") as pool:
                futures = [pool.submit(fetch_item, item_url) for item_url in item_hrefs]
                for future in futures:
                    _, entry = future.result()
                    entries.append(entry)
            if len({entry["url"] for entry in entries}) != len(entries):
                raise ValueError(f"{layer} STAC collection repeats a data asset URL")
            entries.sort(key=lambda item: str(item["url"]))
            built[layer] = entries
            total_docs += len(entries)
        if total_docs > MAX_ITEM_LINKS:
            raise BudgetExceeded("STAC item index exceeds item cap")
        index_bytes = canonical({"schemaVersion": 1, "release": release, "configHash": cfg_hash, "layers": built})
        receipt = {"configHash": cfg_hash, "sha256": sha(index_bytes), "bytes": len(index_bytes), "items": total_docs}
        receipt_bytes = canonical(receipt)
        reserved = len(index_bytes) + len(receipt_bytes)
        disk_budget.reserve(reserved)
        temporary = release_cache / f".item-index.{os.getpid()}.{time.time_ns()}.tmp"
        temporary_receipt = release_cache / f".item-index.{os.getpid()}.{time.time_ns()}.receipt.tmp"
        try:
            write_durable(temporary, index_bytes)
            write_durable(temporary_receipt, receipt_bytes)
            os.replace(temporary, index_file)
            os.replace(temporary_receipt, receipt_file)
            sync_directory(release_cache)
            disk_budget.commit(reserved)
        except Exception:
            temporary.unlink(missing_ok=True)
            temporary_receipt.unlink(missing_ok=True)
            disk_budget.release(reserved)
            raise
        index = json.loads(index_bytes)
    if index.get("schemaVersion") != 1 or index.get("release") != release or index.get("configHash") != cfg_hash:
        raise ValueError("cached STAC item index identity does not match the pinned release")
    layer_index = require_obj(index.get("layers"), "cached STAC layer index")
    if set(layer_index) != {"buildings", "roads"}:
        raise ValueError("cached STAC index has unknown themes")
    for layer in ("buildings", "roads"):
        expected_count = int(require_obj(collections.get(layer), f"collection {layer}").get("itemCount", 0))
        entries = layer_index.get(layer)
        if not isinstance(entries, list) or len(entries) != expected_count:
            raise ValueError(f"cached {layer} index item count differs from pinned collection")
        item_ids: set[str] = set()
        asset_urls: set[str] = set()
        for raw_entry in entries:
            entry = require_obj(raw_entry, "cached STAC item")
            if set(entry) != {"id", "bbox", "url", "fileBytes", "collectionUrl", "layer"} or entry.get("layer") != layer:
                raise ValueError("cached STAC item entry has an unsupported shape")
            if not isinstance(entry.get("id"), str) or not entry["id"] or entry["id"] in item_ids:
                raise ValueError("cached STAC item ID is empty or duplicated")
            item_ids.add(str(entry["id"]))
            bbox = entry.get("bbox")
            if not isinstance(bbox, list) or len(bbox) != 4 or any(not isinstance(x, (int, float)) or not math.isfinite(x) for x in bbox):
                raise ValueError("cached STAC bbox is invalid")
            safe_url(str(entry.get("url")), host, release)
            if isinstance(entry.get("fileBytes"), bool) or not isinstance(entry.get("fileBytes"), int) or not 1 <= entry["fileBytes"] <= 2_000_000_000:
                raise ValueError("cached STAC file size is invalid")
            if entry["url"] in asset_urls:
                raise ValueError("cached STAC asset URL is duplicated")
            asset_urls.add(str(entry["url"]))
    selected: dict[str, list[dict[str, object]]] = {}
    bounds = [float(x) for x in request["region"]["bounds"]]  # type: ignore[index]
    bboxes = split_bounds(bounds)
    requested_layers = request["layers"]
    for layer in requested_layers:
        entries = layer_index.get(layer)
        if not isinstance(entries, list):
            raise ValueError(f"pinned STAC index lacks requested layer: {layer}")
        selected[layer] = [require_obj(item, "indexed STAC item") for item in entries
                           if any(intersects([float(x) for x in item["bbox"]], box) for box in bboxes)]
    index_receipt = {"sha256": sha(canonical(index)), "itemCount": sum(len(x) for x in layer_index.values() if isinstance(x, list)), "selectedCount": sum(len(x) for x in selected.values())}
    return selected, budget.rows(), index_receipt


def wkt_for_bounds(bounds: list[float]) -> str:
    parts = split_bounds(bounds)
    polygons = []
    for west, south, east, north in parts:
        polygons.append(f"(({west:.15g} {south:.15g},{east:.15g} {south:.15g},{east:.15g} {north:.15g},{west:.15g} {north:.15g},{west:.15g} {south:.15g}))")
    return "MULTIPOLYGON(" + ",".join(polygons) + ")"


def quote_sql_text(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


class RangeProxy:
    def __init__(self, assets: list[dict[str, object]], budget: NetworkBudget, host: str, release: str, concurrency: int = 2,
                 *, range_cache: ExactRangeCache | None = None):
        self.assets = assets
        self.budget = budget
        self.host = host
        self.release = release
        self.range_cache = range_cache
        self.etags: dict[str, str] = {}
        self.etag_lock = threading.Lock()
        self.head_info: dict[str, dict[str, object]] = {}
        self.head_locks: dict[str, threading.Lock] = {}
        self.head_lock_guard = threading.Lock()
        self.errors: list[dict[str, object]] = []
        self.error_lock = threading.Lock()
        self.audit_rows: list[dict[str, object]] = []
        self.audit_counters: dict[str, int] = {"rangeRequests": 0, "cacheHits": 0, "cacheMisses": 0,
                                               "cacheWriteSkips": 0, "savedBodyBytes": 0,
                                               "headRequests": 0, "headResponseBytes": 0,
                                               "rangeGetResponseBytes": 0, "measuredUpstreamBytes": 0}
        self.audit_truncated = False
        self.audit_lock = threading.Lock()
        self.slots = threading.BoundedSemaphore(concurrency)
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self.httpd.daemon_threads = True

    def _handler(self):
        proxy = self
        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            def log_message(self, fmt, *args):
                return
            def do_HEAD(self):
                self._serve(False)
            def do_GET(self):
                self._serve(True)
            def _serve(self, body: bool):
                match = re.fullmatch(r"/asset/(\d+)", urlsplit(self.path).path)
                if not match or urlsplit(self.path).query:
                    self.send_error(404); return
                idx = int(match.group(1))
                if idx < 0 or idx >= len(proxy.assets):
                    self.send_error(404); return
                asset = proxy.assets[idx]
                upstream = str(asset["url"])
                try:
                    with proxy.slots:
                        proxy._upstream(self, upstream, body, int(asset["fileBytes"]), asset)
                except BudgetExceeded:
                    if not getattr(self, "_world_proxy_response_started", False):
                        proxy._send_failure(self, 429, "network-budget-exceeded")
                    else:
                        self.close_connection = True
                except Exception:
                    if not getattr(self, "_world_proxy_response_started", False):
                        proxy._send_failure(self, 502, "upstream-range-failure")
                    else:
                        self.close_connection = True
        return Handler

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.httpd.server_port}"

    def start(self) -> threading.Thread:
        thread = threading.Thread(target=self.httpd.serve_forever, name="overture-range-proxy", daemon=True)
        thread.start()
        return thread

    def close(self) -> None:
        self.httpd.shutdown(); self.httpd.server_close()

    def first_error(self) -> dict[str, object] | None:
        with self.error_lock:
            return dict(self.errors[0]) if self.errors else None

    def _audit(self, row: dict[str, object] | None = None, **counts: int) -> None:
        with self.audit_lock:
            for key, value in counts.items():
                self.audit_counters[key] = self.audit_counters.get(key, 0) + max(0, int(value))
            if row is not None:
                if len(self.audit_rows) < 64:
                    self.audit_rows.append(row)
                else:
                    self.audit_truncated = True

    def range_audit(self) -> dict[str, object]:
        with self.audit_lock:
            rows = list(self.audit_rows)
            truncated = self.audit_truncated
            value: dict[str, object] = {"schemaVersion": 1, "counters": dict(self.audit_counters), "ranges": rows, "truncated": truncated}
            while len(canonical(value)) > 63_999 and rows:
                rows.pop()
                truncated = True
                value = {"schemaVersion": 1, "counters": dict(self.audit_counters), "ranges": rows, "truncated": truncated}
            return value

    def _head_lock(self, url: str) -> threading.Lock:
        with self.head_lock_guard:
            lock = self.head_locks.get(url)
            if lock is None:
                if len(self.head_locks) >= 1_300:
                    raise BudgetExceeded("range proxy exceeded bounded source HEAD identities")
                lock = threading.Lock()
                self.head_locks[url] = lock
            return lock

    def _observe_etag(self, url: str, etag: str | None) -> None:
        if not etag:
            return
        with self.etag_lock:
            previous = self.etags.setdefault(url, etag)
            if previous != etag:
                raise RuntimeError("upstream ETag changed between range requests")

    @staticmethod
    def _header_bytes(response: http.client.HTTPResponse) -> int:
        version = "1.0" if response.version == 10 else "1.1"
        return (len(f"HTTP/{version} {response.status} {response.reason}\r\n")
                + sum(len(key) + len(value) + 4 for key, value in response.getheaders()) + 2)

    @staticmethod
    def _strong_etag(etag: object) -> bool:
        return isinstance(etag, str) and len(etag) <= 512 and re.fullmatch(r'"[\x21\x23-\x7e\x80-\xff]*"', etag) is not None

    def _origin_head(self, url: str, file_bytes: int, asset: dict[str, object], *, record_errors: bool = True) -> dict[str, object]:
        safe_url(url, self.host, self.release)
        parsed = urlsplit(url)
        reservation = self.budget.reserve(8_192)
        conn: http.client.HTTPSConnection | None = None
        observed = 0
        try:
            conn = http.client.HTTPSConnection(parsed.hostname, parsed.port or 443, timeout=30)
            headers = {"Accept-Encoding": "identity", "User-Agent": "joinallworld-acquirer/1"}
            with self.etag_lock:
                prior_etag = self.etags.get(url)
            if self._strong_etag(prior_etag):
                headers["If-Match"] = prior_etag
            conn.request("HEAD", parsed.path, headers=headers)
            response = conn.getresponse()
            observed = self._header_bytes(response)
            etag = response.getheader("ETag")
            self.budget.consume(reservation, url, observed, etag)
            if etag and (self._strong_etag(etag) or url in self.etags):
                self._observe_etag(url, etag)
            headers = {name: response.getheader(name) for name in ("Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified", "Content-Type", "Content-Encoding")}
            content_length = headers.get("Content-Length")
            cacheable = (response.status == 200 and (headers.get("Content-Encoding") or "identity").lower() in ("", "identity")
                         and content_length is not None and content_length.isdigit() and int(content_length) == file_bytes
                         and self._strong_etag(etag))
            return {"status": response.status, "reason": response.reason, "headers": headers,
                    "etag": etag, "cacheable": cacheable, "headerBytes": observed}
        except Exception as error:
            try:
                setattr(error, "range_head_bytes_observed", observed)
            except Exception:
                pass
            if record_errors:
                self._record_error(asset, url, "HEAD", None, "upstream_head", error, None, observed)
            raise
        finally:
            try:
                if conn is not None:
                    conn.close()
            finally:
                self._audit(headRequests=1, headResponseBytes=observed, measuredUpstreamBytes=observed)
                if reservation:
                    self.budget.release(reservation)

    def _ensure_head(self, url: str, file_bytes: int, asset: dict[str, object], *, record_errors: bool = False) -> tuple[dict[str, object], int]:
        lock = self._head_lock(url)
        with lock:
            cached = self.head_info.get(url)
            if cached is not None and cached.get("cacheable") is True and cached.get("fileBytes") == file_bytes:
                return cached, 0
            current = self._origin_head(url, file_bytes, asset, record_errors=record_errors)
            if current.get("cacheable") is True:
                current["fileBytes"] = file_bytes
                self.head_info[url] = current
            return current, int(current.get("headerBytes", 0))

    @staticmethod
    def _range_bounds(range_header: str, file_bytes: int) -> tuple[int, int] | None:
        match = re.fullmatch(r"bytes=(\d+)-(\d*)", range_header)
        if not match:
            return None
        first = int(match.group(1))
        last = int(match.group(2)) if match.group(2) else file_bytes - 1
        if first >= file_bytes or last < first:
            return None
        return first, min(last, file_bytes - 1)

    @staticmethod
    def _send_cached_range(client: BaseHTTPRequestHandler, payload: bytes, file_bytes: int, first: int, last: int, etag: str) -> None:
        client.send_response(206, "Partial Content")
        client.send_header("Content-Length", str(len(payload)))
        client.send_header("Content-Range", f"bytes {first}-{last}/{file_bytes}")
        client.send_header("Accept-Ranges", "bytes")
        client.send_header("ETag", etag)
        client.send_header("Connection", "close")
        client.end_headers()
        client._world_proxy_response_started = True  # type: ignore[attr-defined]
        client.wfile.write(payload)
        client.close_connection = True

    def _send_head(self, client: BaseHTTPRequestHandler, info: dict[str, object]) -> None:
        client.send_response(int(info["status"]), str(info["reason"]))
        headers = info.get("headers")
        if isinstance(headers, dict):
            for name in ("Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified", "Content-Type", "Content-Encoding"):
                value = headers.get(name)
                if isinstance(value, str):
                    client.send_header(name, value)
        client.send_header("Connection", "close")
        client.end_headers()
        client._world_proxy_response_started = True  # type: ignore[attr-defined]
        client.close_connection = True

    def _record_error(self, asset: dict[str, object], url: str, method: str, range_header: str | None,
                      phase: str, error: Exception, status: int | None, observed_bytes: int) -> None:
        parsed = urlsplit(url)
        def clean(value: object, maximum: int) -> str:
            return "".join(ch if ch >= " " and ch != "\x7f" else " " for ch in str(value))[:maximum]
        record = {
            "phase": phase[:40],
            "errorType": type(error).__name__[:80],
            "message": clean(error, 240),
            "assetId": clean(asset.get("id", "unknown"), 160),
            "layer": clean(asset.get("layer", "unknown"), 24),
            "asset": clean(f"{parsed.hostname or ''}{parsed.path}", 240),
            "method": method,
            "range": clean(range_header or "", 128),
            "upstreamStatus": status,
            "networkBytesObserved": max(0, observed_bytes),
        }
        with self.error_lock:
            if len(self.errors) < 8:
                self.errors.append(record)

    @staticmethod
    def _send_failure(client: BaseHTTPRequestHandler, status: int, code: str) -> None:
        body = canonical({"error": code})
        try:
            client.send_response(status)
            client.send_header("Content-Type", "application/json")
            client.send_header("Content-Length", str(len(body)))
            client.send_header("X-Joinallworld-Proxy-Error", code)
            client.send_header("Connection", "close")
            client.end_headers()
            client.wfile.write(body)
        except Exception:
            pass
        finally:
            client.close_connection = True

    def _audit_range(self, url: str, etag: str | None, file_bytes: int, first: int, last: int,
                     result: str, body_sha256: str | None, saved: int, upstream: int, reason: str | None = None) -> None:
        self._audit(rangeRequests=1,
                    cacheHits=1 if result == "hit" else 0,
                    cacheMisses=1 if result in ("miss", "write-skip", "uncacheable", "error") else 0,
                    cacheWriteSkips=1 if result == "write-skip" else 0,
                    savedBodyBytes=saved)
        row: dict[str, object] = {"url": url, "etag": etag,
            "fileBytes": file_bytes, "first": first, "last": last, "result": result,
            "bodySha256": body_sha256, "savedBodyBytes": saved, "measuredUpstreamBytes": upstream}
        if reason:
            row["reason"] = reason[:80]
        self._audit(row)

    def _upstream(self, client: BaseHTTPRequestHandler, url: str, body: bool, file_bytes: int,
                  asset: dict[str, object]) -> None:
        range_header = client.headers.get("Range")
        if self.range_cache is None:
            return self._upstream_network(client, url, body, file_bytes, asset)
        if not body and not range_header:
            info, _ = self._ensure_head(url, file_bytes, asset, record_errors=True)
            if int(info.get("status", 0)) not in (200, 206, 416):
                error = RuntimeError("upstream refused bounded HEAD request")
                self._record_error(asset, url, "HEAD", None, "validate_upstream_response", error,
                                   int(info.get("status", 0)), int(info.get("headerBytes", 0)))
                raise error
            return self._send_head(client, info)
        if not body or not range_header:
            return self._upstream_network(client, url, body, file_bytes, asset)
        bounds = self._range_bounds(range_header, file_bytes)
        if bounds is None:
            return self._upstream_network(client, url, body, file_bytes, asset)
        first, last = bounds
        if last - first + 1 > self.range_cache.max_entry_bytes:
            return self._upstream_network(client, url, body, file_bytes, asset,
                cache_info={"cacheable": False, "etag": None, "first": first, "last": last,
                            "reason": "span-exceeds-entry-cap"})
        try:
            with self.range_cache.flight(url, file_bytes, first, last):
                head_info, head_bytes = self._ensure_head(url, file_bytes, asset, record_errors=True)
                cacheable = (head_info.get("cacheable") is True and isinstance(head_info.get("etag"), str))
                if cacheable:
                    etag = str(head_info["etag"])
                    payload = self.range_cache.get(url, file_bytes, etag, first, last)
                    if payload is not None:
                        self._audit_range(url, etag, file_bytes, first, last, "hit", hashlib.sha256(payload).hexdigest(),
                                          len(payload), head_bytes)
                        self._send_cached_range(client, payload, file_bytes, first, last, etag)
                        return
                else:
                    etag = None
                cache_info = {"cacheable": bool(cacheable), "etag": etag, "first": first, "last": last,
                              "reason": None if cacheable else "head-validator-unavailable"}
                self._upstream_network(client, url, body, file_bytes, asset, cache_info=cache_info, head_bytes=head_bytes)
        except Exception as error:
            if self.first_error() is None:
                self._record_error(asset, url, "GET", range_header, "range_cache", error, None, 0)
            raise

    def _upstream_network(self, client: BaseHTTPRequestHandler, url: str, body: bool, file_bytes: int,
                          asset: dict[str, object], *, cache_info: dict[str, object] | None = None,
                          head_bytes: int = 0) -> None:
        method = "GET" if body else "HEAD"
        range_header = client.headers.get("Range")
        phase = "validate_request"
        status: int | None = None
        observed_bytes = 0
        reservation: int | None = None
        conn: http.client.HTTPSConnection | None = None
        audit_settled = False
        audit_recorded = False

        def settle_upstream() -> None:
            nonlocal conn, reservation, audit_settled
            current = conn
            conn = None
            try:
                if current is not None:
                    current.close()
            finally:
                if not audit_settled:
                    if method == "HEAD":
                        self._audit(headRequests=1, headResponseBytes=observed_bytes,
                                    measuredUpstreamBytes=observed_bytes)
                    else:
                        self._audit(rangeGetResponseBytes=observed_bytes if range_header else 0,
                                    measuredUpstreamBytes=observed_bytes)
                    audit_settled = True
                if reservation is not None:
                    self.budget.release(reservation)
                    reservation = None
        try:
            safe_url(url, self.host, self.release)
            parsed = urlsplit(url)
            expected_body = file_bytes if body else 0
            if range_header:
                match = re.fullmatch(r"bytes=(\d+)-(\d*)", range_header)
                if not match:
                    raise ValueError("invalid byte range requested through proxy")
                first = int(match.group(1))
                last = int(match.group(2)) if match.group(2) else file_bytes - 1
                if first >= file_bytes or last < first:
                    raise ValueError("requested byte range is outside the pinned asset")
                expected_body = min(last, file_bytes - 1) - first + 1 if body else 0
            # Reserve requested data and conservative headers before contacting upstream.
            phase = "reserve_network_budget"
            reservation = self.budget.reserve(expected_body + 8_192)
            headers = {"Accept-Encoding": "identity", "User-Agent": "joinallworld-acquirer/1"}
            with self.etag_lock:
                known_etag = self.etags.get(url)
            if known_etag and (self.range_cache is None or self._strong_etag(known_etag)):
                headers["If-Match"] = known_etag
            if range_header:
                headers["Range"] = range_header
            phase = "upstream_request"
            conn = http.client.HTTPSConnection(parsed.hostname, parsed.port or 443, timeout=30)
            conn.request(method, parsed.path, headers=headers)
            phase = "upstream_headers"
            response = conn.getresponse()
            status = response.status
            etag = response.getheader("ETag")
            version = "1.0" if response.version == 10 else "1.1"
            header_bytes = len(f"HTTP/{version} {response.status} {response.reason}\r\n")
            header_bytes += sum(len(k) + len(v) + 4 for k, v in response.getheaders()) + 2
            observed_bytes += header_bytes
            self.budget.consume(reservation, url, header_bytes, etag)
            if etag:
                with self.etag_lock:
                    previous = self.etags.setdefault(url, etag)
                    if previous != etag:
                        raise RuntimeError("upstream ETag changed between range requests")
            phase = "validate_upstream_response"
            if response.status not in (200, 206, 416) or response.getheader("Content-Encoding", "identity").lower() not in ("", "identity"):
                raise ValueError("upstream refused bounded identity Range response")
            declared = response.getheader("Content-Length")
            payload = b""
            if body and response.status != 416:
                if declared is None or not declared.isdigit() or int(declared) != expected_body:
                    raise ValueError("upstream Content-Length does not match the requested byte span")
                if int(declared) > self.budget.token_remaining(reservation):
                    raise BudgetExceeded("upstream Range response exceeds its reserved byte span")
                content_range = response.getheader("Content-Range")
                if range_header and response.status == 206:
                    match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+|\*)", content_range or "")
                    requested = re.fullmatch(r"bytes=(\d+)-(\d*)", range_header)
                    expected_last = min(int(requested.group(2) or file_bytes - 1), file_bytes - 1) if requested else -1
                    if (not match or not requested or int(match.group(1)) != int(requested.group(1))
                            or int(match.group(2)) != expected_last or int(match.group(2)) - int(match.group(1)) + 1 != int(declared)
                            or (match.group(3) != "*" and int(match.group(3)) != file_bytes)):
                        raise ValueError("upstream Content-Range does not match the request")
                elif not range_header and int(declared) != file_bytes:
                    raise ValueError("upstream full response size differs from the pinned STAC asset size")
                # Buffer only the already-reserved bounded range so a read failure can
                # return an explicit 502 before any success headers reach DuckDB.
                phase = "read_upstream_body"
                chunks: list[bytes] = []
                received = 0
                while received < int(declared):
                    chunk = response.read(min(64 * 1024, int(declared) - received))
                    if not chunk:
                        raise RuntimeError("upstream Range body ended before Content-Length")
                    observed_bytes += len(chunk)
                    self.budget.consume(reservation, url, len(chunk), etag)
                    chunks.append(chunk)
                    received += len(chunk)
                payload = b"".join(chunks)
            if cache_info is not None:
                etag_for_cache = cache_info.get("etag")
                saved = 0
                result = "uncacheable"
                reason_value = cache_info.get("reason")
                if (cache_info.get("cacheable") is True and response.status == 206
                        and isinstance(etag_for_cache, str) and etag == etag_for_cache and range_header):
                    content_range = response.getheader("Content-Range")
                    match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", content_range or "")
                    if match and (int(match.group(1)), int(match.group(2)), int(match.group(3))) == (int(cache_info["first"]), int(cache_info["last"]), file_bytes):
                        if self.range_cache is None:
                            raise RuntimeError("range cache was disabled during a validated response")
                        stored = self.range_cache.put(url, file_bytes, etag_for_cache, int(cache_info["first"]), int(cache_info["last"]), payload)
                        saved = 0
                        result = "miss" if stored else "write-skip"
                        reason_value = None if stored else "cache-capacity"
                    else:
                        result = "uncacheable"
                        reason_value = "content-range-mismatch"
                digest = hashlib.sha256(payload).hexdigest() if payload else None
                self._audit_range(url, etag if 'etag' in locals() else None, file_bytes,
                                  int(cache_info["first"]), int(cache_info["last"]), result,
                                  digest, saved, observed_bytes + head_bytes,
                                  str(reason_value) if reason_value is not None else None)
                audit_recorded = True
            # A successful local response must never race ahead of network
            # accounting or leave its conservative reservation outstanding.
            settle_upstream()
            phase = "send_proxy_response"
            client.send_response(response.status, response.reason)
            if response.status != 416:
                for name in ("Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified", "Content-Type"):
                    value = response.getheader(name)
                    if value is not None:
                        client.send_header(name, value)
            else:
                client.send_header("Content-Length", "0")
            client.send_header("Connection", "close")
            client.end_headers()
            client._world_proxy_response_started = True  # type: ignore[attr-defined]
            if payload:
                client.wfile.write(payload)
            client.close_connection = True
        except Exception as error:
            self._record_error(asset, url, method, range_header, phase, error, status, observed_bytes)
            if cache_info is not None and not audit_recorded:
                self._audit_range(url, cache_info.get("etag") if isinstance(cache_info.get("etag"), str) else None,
                                  file_bytes, int(cache_info["first"]), int(cache_info["last"]), "error",
                                  None, 0, observed_bytes + head_bytes, type(error).__name__)
            raise
        finally:
            settle_upstream()


def normalize_sources(raw: object) -> list[str]:
    result: set[str] = set()
    if isinstance(raw, list):
        for entry in raw:
            if isinstance(entry, dict):
                dataset = entry.get("dataset")
                if isinstance(dataset, str) and 0 < len(dataset) <= 100 and not any(ord(c) < 32 for c in dataset):
                    result.add(dataset)
            elif isinstance(entry, str) and 0 < len(entry) <= 100 and not any(ord(c) < 32 for c in entry):
                result.add(entry)
    return sorted(result)


def geom_family(geometry: object, layer: str) -> bool:
    if not isinstance(geometry, dict):
        return False
    kind = geometry.get("type")
    return kind in (("Polygon", "MultiPolygon") if layer == "buildings" else ("LineString", "MultiLineString"))


def source_number(value: object, maximum: float) -> float | None:
    if value is None or isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        return None
    result = float(value)
    return result if math.isfinite(result) and 0 < result <= maximum else None


def read_layer(con, layer: str, items: list[dict[str, object]], proxy: RangeProxy, request: dict[str, object], exceptions: list[str], row_limit: int) -> list[dict[str, object]]:
    if not items:
        return []
    start = len(proxy.assets)
    proxy.assets.extend(items)
    paths = [f"{proxy.base_url}/asset/{start+i}" for i in range(len(items))]
    sql_paths = "[" + ",".join(quote_sql_text(p) for p in paths) + "]"
    region = request["region"]
    wkt = wkt_for_bounds([float(x) for x in region["bounds"]])  # type: ignore[index]
    geom = "geometry"
    # Overture GeoParquet has bbox as a row-group friendly struct. Keep explicit
    # column predicates here so DuckDB can prune row groups before decoding geometry.
    bbox_terms = []
    for west, south, east, north in split_bounds([float(x) for x in region["bounds"]]):  # type: ignore[index]
        bbox_terms.append(f"(bbox.xmin <= {east:.15g} AND bbox.xmax >= {west:.15g} AND bbox.ymin <= {north:.15g} AND bbox.ymax >= {south:.15g})")
    bbox_overlap = "(" + " OR ".join(bbox_terms) + ")"
    if layer == "buildings":
        selected_columns = "id, ST_AsGeoJSON(" + geom + ") AS geojson, height, num_floors, NULL::INTEGER AS level, NULL::VARCHAR AS subtype, NULL::VARCHAR AS class, sources, NULL::VARCHAR AS level_rules"
    else:
        selected_columns = "id, ST_AsGeoJSON(" + geom + ") AS geojson, NULL::DOUBLE AS height, NULL::DOUBLE AS num_floors, NULL::INTEGER AS level, subtype, class, sources, level_rules"
    subtype_filter = " AND subtype = 'road'" if layer == "roads" else ""
    sql = ("SELECT " + selected_columns + " FROM read_parquet(" + sql_paths + ", union_by_name=true) WHERE "
           + bbox_overlap + " AND "
           "ST_Intersects(" + geom + ", ST_GeomFromText(" + quote_sql_text(wkt) + "))" + subtype_filter + " LIMIT " + str(row_limit + 1))
    rows = con.execute(sql).fetchall()
    if len(rows) > row_limit:
        raise FeatureRowLimitExceeded("feature row budget exceeded")
    output: list[dict[str, object]] = []
    for row in rows:
        (feature_id, geojson, height, floors, level, subtype, road_class, sources, level_rules) = row
        if not isinstance(feature_id, str) or not feature_id or len(feature_id) > 256:
            exceptions.append("feature with missing/invalid Overture stable ID was omitted")
            continue
        try:
            geometry = json.loads(geojson) if isinstance(geojson, str) else None
        except json.JSONDecodeError:
            geometry = None
        if not geom_family(geometry, layer):
            exceptions.append(f"unsupported {layer} geometry omitted: {feature_id}")
            continue
        props: dict[str, object] = {"sourceLayer": "buildings" if layer == "buildings" else "transportation", "sources": normalize_sources(sources)}
        if layer == "buildings":
            props["building"] = True
            height_value = source_number(height, 1000)
            floors_value = source_number(floors, 200)
            if height_value is not None:
                props["height"] = height_value
            elif floors_value is not None:
                props["building:levels"] = floors_value
        else:
            classification = road_class if isinstance(road_class, str) and road_class else subtype
            if not isinstance(classification, str) or not classification:
                exceptions.append(f"transportation feature without class was omitted: {feature_id}")
                continue
            props["highway"] = classification[:100]
            # The source carries level_rules, not a scalar render level. Preserve a
            # neutral level and report when vertical-routing metadata cannot map to v1.
            props["layer"] = int(level) if isinstance(level, int) and -20 <= level <= 20 else 0
            if level_rules:
                exceptions.append(f"transportation level_rules retained only as source exception: {feature_id}")
        output.append({"type": "Feature", "id": feature_id, "properties": props, "geometry": geometry})
    return output


def validate_input(value: object) -> tuple[dict[str, object], dict[str, object]]:
    root = require_obj(value, "input")
    if set(root) != {"request", "sourceConfig", "cacheDir", "allowedRoot", "sourceIndexDir"}:
        raise TypeError("adapter input has unknown or missing fields")
    request = require_obj(root.get("request"), "request")
    config = require_obj(root.get("sourceConfig"), "sourceConfig")
    if set(request) != {"schemaVersion", "id", "inventoryUnitId", "region", "provider", "release", "layers", "limits"}:
        raise TypeError("request has unknown or missing fields")
    if request.get("schemaVersion") != 1 or request.get("release") != "2026-09-23.1" or request.get("provider") != "overture":
        raise ValueError("adapter accepts only pinned Overture 2026-09-23.1")
    for key in ("id", "inventoryUnitId"):
        if not isinstance(request[key], str) or not request[key].strip() or len(request[key]) > 160 or any(ord(ch) < 32 for ch in request[key]):
            raise TypeError(f"request.{key} is invalid")
    layers = request.get("layers")
    if not isinstance(layers, list) or not 1 <= len(layers) <= 2 or len(set(layers)) != len(layers) or any(x not in ("buildings", "roads") for x in layers):
        raise TypeError("request.layers must contain unique supported layers")
    region = require_obj(request.get("region"), "request.region")
    region_keys = {"id", "parentId", "name", "kind", "countryCode", "timezone", "bounds"}
    if set(region) != region_keys or region.get("countryCode") == "NG":
        raise TypeError("request region fields are invalid or Nigeria is protected")
    code = region.get("countryCode")
    if code is not None and (not isinstance(code, str) or not re.fullmatch(r"[A-Z]{2}", code)):
        raise TypeError("request region countryCode must be ISO alpha-2 or null")
    for key in ("id", "name"):
        if not isinstance(region.get(key), str) or not region[key].strip() or len(region[key]) > 160 or any(ord(ch) < 32 for ch in region[key]):
            raise TypeError(f"request region {key} is invalid")
    if region.get("parentId") is not None and not isinstance(region.get("parentId"), str):
        raise TypeError("request region parentId must be string or null")
    if region.get("timezone") is not None and not isinstance(region.get("timezone"), str):
        raise TypeError("request region timezone must be string or null")
    if region.get("kind") not in ("continent", "country", "admin", "city", "cell"):
        raise TypeError("request region kind is unsupported")
    bounds = region.get("bounds")
    if not isinstance(bounds, list) or len(bounds) != 4 or any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in bounds):
        raise TypeError("request region bounds must be four finite WGS84 values")
    west, south, east, north = (float(x) for x in bounds)
    if west < -180 or west > 180 or east < -180 or east > 180 or south < -90 or north > 90 or south >= north or west == east:
        raise ValueError("request region bounds are empty or outside WGS84")
    limits = require_obj(request.get("limits"), "request.limits")
    if set(limits) != set(HARD_LIMITS):
        raise TypeError("request limits have unknown or missing fields")
    for key, maximum in HARD_LIMITS.items():
        number = limits[key]
        if isinstance(number, bool) or not isinstance(number, int) or not 1 <= number <= maximum:
            raise ValueError(f"request limit {key} is outside hard cap")
    if set(config) != {"schemaVersion", "provider", "release", "releaseStatus", "stac", "licenses", "attributionUrl", "attribution"}:
        raise TypeError("source configuration has unknown or missing fields")
    if config.get("schemaVersion") != 1 or config.get("provider") != "overture" or config.get("release") != request["release"] or config.get("releaseStatus") != "official-static-stac-items-verified":
        raise ValueError("source configuration does not pin the verified release")
    stac = require_obj(config.get("stac"), "sourceConfig.stac")
    if set(stac) != {"catalogUrl", "collections", "allowedAssetHost"} or stac.get("allowedAssetHost") != "overturemaps-us-west-2.s3.us-west-2.amazonaws.com":
        raise ValueError("source configuration contains an unsupported STAC or asset endpoint")
    expected = {
        "buildings": {"id": "building", "url": "https://stac.overturemaps.org/2026-09-23.1/buildings/building/collection.json", "itemCount": 512, "dataType": "building"},
        "roads": {"id": "segment", "url": "https://stac.overturemaps.org/2026-09-23.1/transportation/segment/collection.json", "itemCount": 128, "dataType": "segment"},
    }
    if stac.get("catalogUrl") != "https://stac.overturemaps.org/2026-09-23.1/catalog.json" or stac.get("collections") != expected:
        raise ValueError("pinned STAC collection URLs or item counts changed")
    if config.get("licenses") != {"buildings": "ODbL-1.0", "roads": "ODbL-1.0"} or config.get("attributionUrl") != "https://docs.overturemaps.org/attribution/":
        raise ValueError("source license or attribution configuration changed")
    attribution = require_obj(config.get("attribution"), "sourceConfig.attribution")
    if set(attribution) != {"buildings", "roads"} or any(not isinstance(x, str) or not x.startswith("© Overture Maps Foundation.") for x in attribution.values()):
        raise ValueError("source attribution does not preserve required Overture notice")
    return request, config


def apply_limits(request: dict[str, object]) -> None:
    limits = require_obj(request.get("limits"), "limits")
    memory = int(limits["memoryMb"])
    disk = int(limits["diskBytes"])
    duration = int(limits["durationMs"])
    # macOS can reject RLIMIT_AS whenever its inherited virtual-memory usage
    # already exceeds the requested cap. The Node parent samples RSS and kills
    # this worker at the same limit; DuckDB also receives its own memory cap.
    try:
        resource.setrlimit(resource.RLIMIT_AS, (memory * 1024 * 1024, memory * 1024 * 1024))
    except (ValueError, OSError):
        pass
    resource.setrlimit(resource.RLIMIT_FSIZE, (disk, disk))
    cpu = max(1, (duration + 999) // 1000)
    resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu + 1))


def run(value: object) -> dict[str, object]:
    request, config = validate_input(value)
    limits = require_obj(request.get("limits"), "limits")
    root = Path(str(require_obj(value, "input").get("allowedRoot"))).resolve(strict=True)
    staging = Path(str(require_obj(value, "input").get("cacheDir"))).resolve()
    index_dir = Path(str(require_obj(value, "input").get("sourceIndexDir"))).resolve()
    for directory in (staging, index_dir):
        if not directory.is_relative_to(root) or directory == root:
            raise ValueError("adapter cache path escapes the configured build root")
    if index_dir != root / "acquisition-index":
        raise ValueError("source index path is not the canonical build-root acquisition index")
    check_cache_path(root, index_dir / str(request["release"]))
    apply_limits(request)
    start = time.monotonic()
    budget = NetworkBudget(int(limits["networkBytes"]))
    stac = require_obj(config.get("stac"), "sourceConfig.stac")
    host = str(stac.get("allowedAssetHost"))
    disk_budget = IndexDiskBudget(index_dir / str(request["release"]), int(limits["diskBytes"]))
    selected, _, index_receipt = select_item_index(request, config, index_dir, budget, root, disk_budget)
    selected_count = sum(len(selected[layer]) for layer in request["layers"])
    if selected_count > MAX_ITEM_LINKS:
        raise typed_budget_failure("selected-item-count", budget)
    import duckdb
    range_cache: ExactRangeCache | None = None
    range_allowance = 0
    range_disk_budget = 0
    range_growth_cap = min(8_000_000, int(limits["diskBytes"]) // 8,
                           max(0, disk_budget.maximum - disk_budget.used - disk_budget.reserved))
    if range_growth_cap > 0:
        range_allowance = range_growth_cap
        try:
            disk_budget.reserve(range_allowance)
            range_disk_budget = range_allowance
            range_cache = ExactRangeCache(root, root, str(request["release"]),
                max_growth_bytes=range_allowance, minimum_free_bytes=32_000_000)
        except Exception:
            if range_disk_budget:
                disk_budget.release(range_disk_budget)
                range_disk_budget = 0
            raise
    try:
        proxy = RangeProxy([], budget, host, str(request["release"]), range_cache=range_cache)
        thread = proxy.start()
    except Exception:
        if range_disk_budget:
            disk_budget.release(range_disk_budget)
        raise
    con = None
    exceptions: list[str] = []
    if "roads" in request["layers"]:
        exceptions.append("road selection filters transportation subtype=road; regional rail/water omitted counts are unknown")
    features: list[dict[str, object]] = []
    feature_row_failure: FeatureRowLimitExceeded | None = None
    try:
        con = duckdb.connect(database=":memory:")
        extension_dir = Path(__file__).resolve().parents[2] / ".cache" / "world-build" / "tooling" / "extensions"
        con.execute("SET extension_directory=" + quote_sql_text(str(extension_dir)))
        con.execute("LOAD httpfs")
        con.execute("LOAD spatial")
        con.execute("SET threads=2")
        con.execute(f"SET memory_limit='{int(limits['memoryMb'])}MB'")
        output_reserve = int(limits["outputBytes"]) * 2 + 1_000_000
        temp_limit = int(limits["diskBytes"]) - output_reserve - disk_budget.used - disk_budget.reserved
        if temp_limit < 1:
            raise BudgetExceeded("disk byte budget cannot cover output, index and temporary space")
        con.execute(f"SET max_temp_directory_size='{temp_limit}B'")
        con.execute(f"SET temp_directory={quote_sql_text(str(staging / 'duckdb-tmp'))}")
        for layer in request["layers"]:
            remaining_features = int(limits["features"]) - len(features)
            features.extend(read_layer(con, layer, selected[layer], proxy, request, exceptions, remaining_features))
            if len(features) > int(limits["features"]):
                raise FeatureRowLimitExceeded("combined feature row budget exceeded")
    except FeatureRowLimitExceeded as error:
        diagnostic = proxy.first_error()
        if diagnostic is not None:
            encoded = json.dumps(diagnostic, ensure_ascii=True, separators=(",", ":"))[:1_800]
            raise RuntimeError(f"{error}; first range proxy failure: {encoded}") from error
        feature_row_failure = error
    except Exception as error:
        diagnostic = proxy.first_error()
        if diagnostic is not None:
            encoded = json.dumps(diagnostic, ensure_ascii=True, separators=(",", ":"))[:1_800]
            raise RuntimeError(f"{error}; first range proxy failure: {encoded}") from error
        raise
    finally:
        try:
            if con is not None:
                con.close()
        finally:
            try:
                proxy.close()
            finally:
                try:
                    thread.join(timeout=2)
                finally:
                    if range_disk_budget:
                        actual_growth = range_cache.written if range_cache is not None else 0
                        reserved_growth = range_disk_budget
                        disk_budget.commit(min(actual_growth, reserved_growth))
                        disk_budget.release(max(0, reserved_growth - actual_growth))
                        range_disk_budget = 0
                        if actual_growth > range_allowance:
                            raise BudgetExceeded("range cache exceeded its reserved index growth")
    # Proxy handlers may finish or report a late transport failure while the
    # database and server are shutting down. Recheck only after cleanup so a
    # typed measurement cannot hide an asynchronous upstream diagnostic.
    late_diagnostic = proxy.first_error()
    if late_diagnostic is not None:
        encoded = json.dumps(late_diagnostic, ensure_ascii=True, separators=(",", ":"))[:1_800]
        raise RuntimeError(f"late range proxy failure after adapter cleanup: {encoded}")
    if feature_row_failure is not None:
        if thread.is_alive() or not budget.settled:
            raise BudgetExceeded("feature row limit exceeded with unresolved upstream network activity") from feature_row_failure
        raise typed_budget_failure("feature-row-budget", budget, proxy.first_error()) from feature_row_failure
    if (time.monotonic() - start) * 1000 > int(limits["durationMs"]):
        raise BudgetExceeded("acquisition duration budget exceeded")
    features.sort(key=lambda item: (str(item["properties"]["sourceLayer"]), str(item["id"])))
    selection = {key: request[key] for key in ("schemaVersion", "id", "inventoryUnitId", "region", "provider", "release", "layers")}
    request_hash = sha(canonical({"compiler": COMPILER_ID, "selection": selection, "sourceConfig": config}))
    exceptions = sorted(set(exceptions))[:1000]
    output = {"type": "FeatureCollection", "metadata": {"provider": "overture", "release": request["release"],
              "requestHash": request_hash, "stacIndex": index_receipt, "exceptions": exceptions}, "features": features}
    raw = canonical(output) + b"\n"
    if len(raw) > int(limits["outputBytes"]):
        if thread.is_alive() or not budget.settled:
            raise BudgetExceeded("GeoJSON output byte limit exceeded with unresolved upstream activity")
        if proxy.first_error() is not None:
            encoded = json.dumps(proxy.first_error(), ensure_ascii=True, separators=(",", ":"))[:1_800]
            raise RuntimeError(f"late range proxy failure after adapter cleanup: {encoded}")
        raise typed_budget_failure("geojson-output-bytes", budget, proxy.first_error())
    staging.mkdir(parents=True, exist_ok=True)
    output_path = staging / "adapter-output.geojson"
    receipt_path = staging / "adapter-receipt.json"
    write_durable(output_path, raw)
    layer_sources = []
    for layer in request["layers"]:
        layer_features = [feature for feature in features if feature["properties"]["sourceLayer"] == ("buildings" if layer == "buildings" else "transportation")]
        layer_bytes = canonical(layer_features)
        collection = require_obj(stac["collections"][layer], f"collection {layer}")
        layer_sources.append({"id": f"overture-{request['release']}-{layer}", "url": collection["url"], "release": request["release"],
                              "license": config["licenses"][layer], "attribution": config["attribution"][layer], "sha256": sha(layer_bytes), "bytes": max(1, len(layer_bytes))})
    elapsed = max(1, int((time.monotonic() - start) * 1000))
    receipt = {"schemaVersion": 1, "inputSha256": sha(raw), "inputBytes": len(raw), "index": index_receipt}
    write_durable(receipt_path, canonical(receipt))
    if range_cache is not None:
        range_audit = canonical(proxy.range_audit()) + b"\n"
        if len(range_audit) > 64_000:
            raise BudgetExceeded("range audit exceeded its output reserve")
        write_durable(staging / "range-audit.json", range_audit)
    sync_directory(staging)
    # Records only requests made during this job. STAC item-index bytes are present
    # on its first build; cached index reuse contributes zero upstream response bytes.
    upstream = budget.rows()
    network = budget.total
    if network > int(limits["networkBytes"]):
        raise BudgetExceeded("network response byte budget exceeded")
    return {"path": str(output_path), "receiptPath": str(receipt_path), "upstream": upstream,
            "metrics": {"networkBytes": network, "outputBytes": len(raw), "features": len(features), "elapsedMs": elapsed},
            "exceptions": sorted(set(exceptions))[:1000], "sources": layer_sources}


def main() -> None:
    raw = sys.stdin.buffer.read(1_000_000)
    if len(raw) >= 1_000_000:
        raise ValueError("adapter input exceeded 1 MB")
    value = json.loads(raw)
    print(json.dumps(run(value), ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except AdapterBudgetFailure as error:
        print(json.dumps({"schemaVersion": 1, "kind": "budget-exceeded", "reason": error.reason,
                          "networkBytesMeasured": error.network_bytes_measured}, separators=(",", ":")))
        sys.exit(3)
    except Exception as error:
        print(f"acquisition adapter: {error}", file=sys.stderr)
        sys.exit(1)
