#!/usr/bin/env python3
"""Independent read-only audit of one source-query campaign bound to a country grid.

This verifies immutable inputs, campaign/job identity, adaptive query-tree coverage,
captured raw bytes and durable budget records. It does not compile geometry, prove
feature uniqueness across overlapping queries, or imply playable/country-complete data.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import resource
import sqlite3
import stat
import sys
import time
from typing import Any
from urllib.parse import urlparse

SCRIPT = Path(__file__).resolve()
REPO = SCRIPT.parents[2]
sys.path.insert(0, str(SCRIPT.parent))
import verify_country_grid as country_grid_audit  # independent Python geometry verifier

SHA = re.compile(r"^[a-f0-9]{64}$")
SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,79}$")
MAX_PLAN = 16_000_000
MAX_CONFIG = 64_000_000
MAX_EXTRACT = 20_000_000
MAX_RECEIPT = 1_000_000
MAX_USAGE = 8_000_000
MAX_JOBS = 400_000
MAX_READ = 512_000_000
MAX_RSS = 512 * 1024 * 1024
START = time.monotonic()
READ_BYTES = 0
CAPTURE_READ_BYTES = 0


class AuditError(Exception):
    pass


class _Undefined:
    pass


UNDEFINED = _Undefined()


def fail(message: str) -> None:
    raise AuditError(message)


def live() -> None:
    if time.monotonic() - START > 120:
        fail("grid-query audit exceeded 120 seconds")
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if sys.platform == "darwin" else 1024)
    if rss > MAX_RSS:
        fail("grid-query audit exceeded 512 MiB RSS")


def pairs(rows: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in rows:
        if key in value:
            fail(f"duplicate JSON key {key!r}")
        value[key] = item
    return value


def bad_constant(value: str) -> None:
    fail(f"non-finite JSON value {value}")


def canonical(value: Any) -> str:
    if value is UNDEFINED:
        return "undefined"
    if isinstance(value, list):
        return "[" + ",".join(canonical(item) for item in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value, key=lambda item: item.encode("utf-16-be", "surrogatepass"))
        return "{" + ",".join(canonical(key) + ":" + canonical(value[key]) for key in keys) + "}"
    return country_grid_audit.canonical(value)


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def inside(parent: Path, child: Path) -> bool:
    try:
        child.relative_to(parent)
        return child != parent
    except ValueError:
        return False


def reject_links(path: Path) -> None:
    absolute = Path(os.path.abspath(path))
    cursor = Path(absolute.anchor)
    for component in absolute.parts[1:]:
        cursor /= component
        try:
            mode = os.lstat(cursor).st_mode
        except FileNotFoundError:
            fail(f"missing path component: {cursor}")
        if stat.S_ISLNK(mode):
            fail("symlink path refused")


def read_bounded(path: Path, cap: int, label: str, capture: bool = False) -> bytes:
    global READ_BYTES, CAPTURE_READ_BYTES
    reject_links(path)
    before = os.lstat(path)
    if not stat.S_ISREG(before.st_mode) or before.st_size > cap:
        fail(f"{label} is not a bounded regular file")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags)
    try:
        initial = os.fstat(fd)
        if not stat.S_ISREG(initial.st_mode) or initial.st_size > cap:
            fail(f"{label} changed to an unsafe file")
        chunks: list[bytes] = []
        total = 0
        while True:
            live()
            block = os.read(fd, min(65_536, cap + 1 - total))
            if not block:
                break
            total += len(block)
            if total > cap:
                fail(f"{label} exceeds its byte cap")
            chunks.append(block)
        final = os.fstat(fd)
        if total != initial.st_size or final.st_size != initial.st_size or final.st_mtime_ns != initial.st_mtime_ns:
            fail(f"{label} changed while being read")
        READ_BYTES += total
        if READ_BYTES > MAX_READ:
            fail("aggregate grid-query audit reads exceed 512 MB")
        if capture:
            CAPTURE_READ_BYTES += total
            if CAPTURE_READ_BYTES > MAX_READ:
                fail("captured source/receipt reads exceed 512 MB audit cap")
        return b"".join(chunks)
    finally:
        os.close(fd)


def parse(data: bytes, label: str) -> Any:
    live()
    try:
        value = json.loads(data.decode("utf-8", "strict"), object_pairs_hook=pairs, parse_constant=bad_constant)
    except AuditError:
        raise
    except (ValueError, UnicodeError, RecursionError) as error:
        fail(f"{label} is not bounded UTF-8 JSON: {error}")
    stack = [(value, 0)]
    count = 0
    while stack:
        current, depth = stack.pop()
        count += 1
        if count > 2_000_000 or depth > 64:
            fail(f"{label} exceeds bounded JSON structure limits")
        if count % 8192 == 0:
            live()
        if isinstance(current, float) and not math.isfinite(current):
            fail(f"{label} contains a non-finite number")
        if isinstance(current, dict):
            stack.extend((child, depth + 1) for child in current.values())
        elif isinstance(current, list):
            stack.extend((child, depth + 1) for child in current)
    return value


def obj(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(f"{label} must be an object")
    return value


def exact(value: dict[str, Any], keys: set[str], label: str) -> None:
    if set(value) != keys:
        fail(f"{label} has missing or unknown fields")


def integer(value: Any, label: str, low: int = 0, high: int = 9_007_199_254_740_991) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < low or value > high:
        fail(f"{label} is outside its bounded integer range")
    return value


def root_path(raw: str) -> Path:
    root = Path(raw)
    if not root.is_absolute() or str(root) != raw:
        fail("--root must be a canonical absolute world-build path")
    reject_links(root)
    if not stat.S_ISDIR(os.lstat(root).st_mode) or root.resolve(strict=True) != root:
        fail("--root must resolve to its canonical directory")
    return root


def parse_canonical(data: bytes, label: str, newline: bool = False) -> Any:
    value = parse(data, label)
    text = data.decode("utf-8", "strict")
    if text != canonical(value) + ("\n" if newline else ""):
        fail(f"{label} is not canonical JSON")
    return value


def bounds_of(cell: dict[str, Any], path: str) -> list[float | int]:
    bounds = list(cell["bounds"])
    for digit in path:
        west, south, east, north = bounds
        midx, midy = west + (east - west) / 2, south + (north - south) / 2
        bounds = [[west, south, midx, midy], [midx, south, east, midy], [west, midy, midx, north], [midx, midy, east, north]][int(digit)]
    return bounds


def unit_for(address: dict[str, str], templates: dict[str, dict[str, Any]], plan: dict[str, Any], max_depth: int,
             cells_by_id: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    root_id, query_path = address["rootCellId"], address["path"]
    template = templates.get(root_id)
    if template is None or len(query_path) > max_depth or not re.fullmatch(r"[0-3]{0,8}", query_path):
        fail("job query address is foreign or exceeds maxDepth")
    cell = (cells_by_id or {item["id"]: item for item in plan["cells"]}).get(root_id)
    if cell is None:
        fail("query root is absent from the frozen grid plan")
    cell_id = root_id if not query_path else f"{root_id}:q{query_path}"
    request = json.loads(canonical(template["request"]))
    request["id"] = f"grid-query:{cell_id}"
    request["region"]["id"] = cell_id
    request["region"]["name"] = f"{plan['country']['name']} source query cell {cell_id}"
    request["region"]["bounds"] = bounds_of(cell, query_path)
    return {"id": f"grid-query:{cell_id}", "inventoryUnitId": plan["country"]["id"],
            "priority": template["priority"], "kind": "grid-query", "query": address, "request": request}


def expected_request_hash(unit: dict[str, Any], source_config: Any) -> str:
    request = unit["request"]
    selection = {key: value for key, value in request.items() if key != "limits"}
    return digest({"compiler": "world-source-compiler-v2", "selection": selection, "sourceConfig": source_config})


def expected_usage_source_key(inventory_hash: str, unit: dict[str, Any]) -> str:
    request = dict(unit["request"])
    request["limits"] = UNDEFINED  # Mirrors the ledger producer's explicit undefined field.
    return digest({"inventoryHash": inventory_hash, "request": request})


def safe_file_under(root: Path, raw: Any, cap: int, label: str, capture: bool = False) -> tuple[Path, bytes]:
    if not isinstance(raw, str) or not Path(raw).is_absolute() or str(Path(raw)) != raw:
        fail(f"{label} path is not canonical absolute")
    path = Path(raw)
    if not inside(root, path):
        fail(f"{label} path escapes its pinned root")
    return path, read_bounded(path, cap, label, capture)


def source_uri_ok(url: Any, release: str) -> bool:
    if not isinstance(url, str):
        return False
    parsed = urlparse(url)
    return (parsed.scheme == "https" and parsed.hostname in {"stac.overturemaps.org", "overturemaps-us-west-2.s3.us-west-2.amazonaws.com"}
            and not parsed.username and not parsed.password and release in parsed.path and not parsed.query and not parsed.fragment)


def validate_receipt_and_extract(result: dict[str, Any], unit: dict[str, Any], root: Path, source_config: Any) -> dict[str, Any]:
    request = unit["request"]
    exact(result, {"status", "features", "requestHash", "inputSha256", "inputBytes", "receiptSha256", "receiptBytes", "plan", "receiptPath", "metrics", "upstream", "exceptions"}, "captured job result")
    if result["status"] != "query-captured":
        fail("captured job has wrong result status")
    request_hash = expected_request_hash(unit, source_config)
    if result["requestHash"] != request_hash:
        fail("captured query requestHash differs from independently rebuilt source-selection hash")
    plan = obj(result["plan"], "captured acquisition plan")
    if canonical(plan.get("region")) != canonical(unit["request"]["region"]):
        fail("captured plan region differs from query address bounds")
    input_record = obj(plan.get("input"), "captured input pin")
    input_path, input_bytes = safe_file_under(root, input_record.get("path"), MAX_EXTRACT, "query extract", True)
    receipt_path, receipt_bytes = safe_file_under(root, result["receiptPath"], MAX_RECEIPT, "query receipt", True)
    expected_dir = root / "acquisitions" / request_hash
    if input_path != expected_dir / "extract.geojson" or receipt_path != expected_dir / "receipt.json":
        fail("query capture does not use its canonical request-hash cache paths")
    if len(input_bytes) != integer(result["inputBytes"], "captured input bytes", 1, MAX_EXTRACT) or result["inputBytes"] != input_record.get("bytes") or result["inputSha256"] != sha(input_bytes) or result["inputSha256"] != input_record.get("sha256"):
        fail("captured extract bytes/hash differ from result or plan pin")
    if len(input_bytes) > request["limits"]["outputBytes"]:
        fail("captured extract exceeds the query's declared output limit")
    if len(receipt_bytes) != integer(result["receiptBytes"], "receipt bytes", 1, MAX_RECEIPT) or result["receiptSha256"] != sha(receipt_bytes):
        fail("captured receipt bytes/hash differ from result pin")
    receipt = obj(parse(receipt_bytes, "query receipt"), "query receipt")
    exact(receipt, {"schemaVersion", "requestHash", "selection", "request", "completedAt", "inputSha256", "inputBytes", "metrics", "upstream", "sources", "exceptions"}, "query receipt")
    selection = {key: value for key, value in request.items() if key != "limits"}
    receipt_request = obj(receipt["request"], "receipt request")
    exact(receipt_request, {"schemaVersion", "id", "inventoryUnitId", "provider", "release", "layers", "region", "limits"}, "receipt request")
    receipt_limits = obj(receipt_request["limits"], "receipt request limits")
    exact(receipt_limits, {"networkBytes", "outputBytes", "features", "durationMs", "memoryMb", "diskBytes"}, "receipt request limits")
    historical_hard_limits = {"networkBytes": 32_000_000, "outputBytes": 20_000_000, "features": 50_000,
                              "durationMs": 900_000, "memoryMb": 2_048, "diskBytes": 256_000_000}
    for key, value in receipt_limits.items():
        integer(value, f"receipt request limit {key}", 1)
        if value > historical_hard_limits[key]:
            fail("receipt request limit exceeds the acquisition adapter hard cap")
    receipt_selection = {key: value for key, value in receipt_request.items() if key != "limits"}
    if receipt["schemaVersion"] != 1 or receipt["requestHash"] != request_hash or receipt["selection"] != selection or receipt_selection != selection:
        fail("query receipt does not bind its exact request selection")
    if receipt["inputSha256"] != result["inputSha256"] or receipt["inputBytes"] != result["inputBytes"]:
        fail("query receipt input pin differs from captured bytes")
    metrics = obj(receipt["metrics"], "receipt metrics")
    if set(metrics) != {"networkBytes", "outputBytes", "features", "elapsedMs"}:
        fail("receipt metrics fields are invalid")
    for key, value in metrics.items():
        integer(value, f"receipt metric {key}")
    geo = obj(parse(input_bytes, "query extract"), "query extract")
    features = geo.get("features")
    if geo.get("type") != "FeatureCollection" or not isinstance(features, list) or len(features) != result["features"] or len(features) != metrics["features"] or len(features) > request["limits"]["features"] or metrics["outputBytes"] != len(input_bytes):
        fail("captured GeoJSON row count or measured output metrics do not conserve the extract")
    sources = receipt["sources"]
    layers = request["layers"]
    if not isinstance(sources, list) or len(sources) != len(layers):
        fail("query receipt source list does not match requested layers")
    expected_sources: list[dict[str, Any]] = []
    for layer, source in zip(layers, sources):
        row = obj(source, "query source record")
        if set(row) != {"id", "url", "release", "license", "attribution", "sha256", "bytes"}:
            fail("query source record has unexpected fields")
        expected_url = (f"https://stac.overturemaps.org/{request['release']}/buildings/building/collection.json" if layer == "buildings"
                        else f"https://stac.overturemaps.org/{request['release']}/transportation/segment/collection.json")
        if row["id"] != f"overture-{request['release']}-{layer}" or row["url"] != expected_url or row["release"] != request["release"] or row["license"] != "ODbL-1.0" or not isinstance(row["attribution"], str) or "https://docs.overturemaps.org/attribution/" not in row["attribution"] or not isinstance(row["sha256"], str) or not SHA.fullmatch(row["sha256"]):
            fail("query source record differs from the pinned Overture layer identity")
        integer(row["bytes"], "query source bytes", 1, request["limits"]["outputBytes"])
        expected_sources.append(row)
    upstream = receipt["upstream"]
    if not isinstance(upstream, list):
        fail("receipt upstream list is invalid")
    upstream_bytes = 0
    for item in upstream:
        row = obj(item, "receipt upstream transfer")
        if set(row) != {"url", "etag", "bytes"} or not source_uri_ok(row["url"], request["release"]):
            fail("receipt upstream transfer URL or fields are invalid")
        if row["etag"] is not None and not isinstance(row["etag"], str):
            fail("receipt upstream ETag is invalid")
        upstream_bytes += integer(row["bytes"], "upstream bytes")
    if upstream_bytes != metrics["networkBytes"]:
        fail("receipt upstream transfers do not sum to measured network bytes")
    exceptions = receipt["exceptions"]
    if not isinstance(exceptions, list) or len(exceptions) > 1000 or any(not isinstance(x, str) or len(x.encode("utf-8")) > 300 for x in exceptions):
        fail("receipt exceptions are invalid")
    result_metrics = obj(result["metrics"], "ledger capture metrics")
    if set(result_metrics) != {"networkBytes", "outputBytes", "features", "elapsedMs"} or result_metrics.get("outputBytes") != metrics["outputBytes"] or result_metrics.get("features") != metrics["features"] or result["exceptions"] != exceptions:
        fail("ledger capture metrics or exceptions differ from immutable receipt")
    for key, value in result_metrics.items():
        integer(value, f"ledger metric {key}")
    if result_metrics["networkBytes"] == 0:
        if result["upstream"] != []:
            fail("cache-hit query result must report no current upstream transfers")
    elif result_metrics["networkBytes"] != metrics["networkBytes"] or result["upstream"] != upstream:
        fail("live query result upstream metrics differ from immutable receipt")
    source = obj(plan.get("source"), "combined query source")
    if source.get("sha256") != result["inputSha256"] or source.get("bytes") != result["inputBytes"] or source.get("release") != request["release"]:
        fail("captured plan source does not bind the original query extract")
    return {"requestHash": request_hash, "inputSha256": result["inputSha256"], "inputBytes": len(input_bytes),
            "receiptSha256": result["receiptSha256"], "receiptBytes": len(receipt_bytes), "features": len(features),
            "networkBytesOriginal": metrics["networkBytes"], "networkBytesCurrent": result_metrics["networkBytes"],
            "outputBytes": len(input_bytes), "features": len(features), "ledgerMetrics": result_metrics,
            "sources": len(expected_sources)}


def verify_attempt(root: Path, request_hash: str, unit: dict[str, Any], expected_status: str | None, expected_reason: str | None = None) -> dict[str, Any] | None:
    path = root / "acquisition-attempts" / request_hash / "attempts.jsonl"
    try:
        body = read_bounded(path, 1_000_000, "acquisition attempt journal")
    except AuditError as error:
        if str(error).startswith("missing path component:"):
            if expected_status in {"success", "cache-hit", "typed-failure"}:
                fail("completed query is missing its acquisition attempt journal")
            return None
        raise
    if not body.endswith(b"\n"):
        fail("acquisition attempt journal has a partial terminal record")
    records = [obj(parse(line, "acquisition attempt record"), "acquisition attempt record") for line in body.splitlines()]
    if not records or len(records) > 200:
        fail("acquisition attempt journal is empty or exceeds its attempt cap")
    selection = {key: value for key, value in unit["request"].items() if key != "limits"}
    starts: dict[int, dict[str, Any]] = {}
    terminal: list[dict[str, Any]] = []
    finished_attempts: set[int] = set()
    for record in records:
        if record.get("schemaVersion") != 1 or record.get("requestHash") != request_hash or not isinstance(record.get("attempt"), int) or isinstance(record.get("attempt"), bool) or record["attempt"] < 1:
            fail("acquisition attempt journal request identity mismatch")
        attempt = record["attempt"]
        if record.get("selection") != selection:
            fail("acquisition attempt evidence selection does not match query unit")
        caps = obj(record.get("caps"), "attempt caps")
        exact(caps, {"networkBytes", "diskBytes", "durationMs"}, "attempt caps")
        for key, value in caps.items(): integer(value, f"attempt cap {key}", 1)
        if any(caps[key] > unit["request"]["limits"][key] for key in caps):
            fail("acquisition attempt cap exceeds the configured request")
        if record.get("event") == "started":
            exact(record, {"schemaVersion", "requestHash", "attempt", "event", "status", "startedAt", "selection", "caps", "networkBytesMeasured", "networkReservationUpperBoundBytes"}, "started attempt record")
            if record["status"] != "pending" or attempt in starts or attempt != len(starts) + 1 or record["networkBytesMeasured"] is not None or record["networkReservationUpperBoundBytes"] != caps["networkBytes"]:
                fail("acquisition start record has invalid reservation or attempt order")
            starts[attempt] = record
        elif record.get("event") == "finished":
            status = record.get("status")
            typed = status == "failure" and "failureKind" in record
            keys = {"schemaVersion", "requestHash", "attempt", "event", "status", "startedAt", "endedAt", "selection", "caps", "networkBytesMeasured", "networkReservationUpperBoundBytes"}
            keys |= ({"reason", "failureKind"} if typed else {"reason"}) if status == "failure" else {"metrics", "receiptPath"}
            exact(record, keys, "finished attempt record")
            if attempt not in starts or attempt in finished_attempts or (terminal and attempt <= terminal[-1]["attempt"]) or record.get("startedAt") != starts[attempt].get("startedAt"):
                fail("acquisition terminal record lacks its ordered start record")
            measured = record.get("networkBytesMeasured")
            expected_reservation = 0 if status == "cache-hit" else caps["networkBytes"]
            if record["networkReservationUpperBoundBytes"] != expected_reservation:
                fail("acquisition terminal record lost its conservative reservation")
            if typed:
                if record.get("failureKind") not in {"selected-item-count", "feature-row-budget", "geojson-output-bytes"} or not isinstance(measured, int) or isinstance(measured, bool) or measured < 0 or measured > caps["networkBytes"] or not isinstance(record.get("reason"), str):
                    fail("typed acquisition failure record is malformed")
            elif status == "failure":
                if measured is not None or not isinstance(record.get("reason"), str):
                    fail("opaque acquisition failure did not retain its reservation")
            else:
                if status not in {"success", "cache-hit"}:
                    fail("acquisition terminal has an unsupported status")
                metrics = obj(record.get("metrics"), "attempt metrics")
                exact(metrics, {"networkBytes", "outputBytes", "features", "elapsedMs"}, "attempt metrics")
                for key, value in metrics.items(): integer(value, f"attempt metric {key}")
                if status == "cache-hit" and (measured != 0 or metrics["networkBytes"] != 0):
                    fail("cache-hit attempt reports network transfer")
                if status == "success" and (measured != metrics["networkBytes"] or measured > caps["networkBytes"]):
                    fail("successful attempt network measurement differs from metrics")
                if not isinstance(record.get("receiptPath"), str):
                    fail("successful attempt lacks a receipt path")
                expected_receipt = str(root / "acquisitions" / request_hash / "receipt.json")
                if record["receiptPath"] != expected_receipt:
                    fail("successful attempt receipt path differs from its content-addressed request cache")
                if metrics["outputBytes"] > unit["request"]["limits"]["outputBytes"] or metrics["features"] > unit["request"]["limits"]["features"] or metrics["elapsedMs"] > unit["request"]["limits"]["durationMs"]:
                    fail("successful attempt metrics exceed their frozen request limits")
            terminal.append(record)
            finished_attempts.add(attempt)
        else:
            fail("acquisition attempt journal has an unknown event")
    last = terminal[-1] if terminal else None
    if last is None:
        if expected_status is not None:
            fail("completed query lacks terminal acquisition evidence")
        return {"attempts": len(starts), "pendingStarts": len(starts), "status": "unknown", "terminals": []}
    if expected_status is not None and expected_status != "typed-failure" and last.get("status") != expected_status:
        fail("acquisition terminal evidence does not match query result")
    if expected_status == "typed-failure":
        candidates = [row for row in terminal if row.get("status") == "failure" and row.get("failureKind") == expected_reason
                      and isinstance(row.get("networkBytesMeasured"), int) and 0 <= row["networkBytesMeasured"] <= row["caps"]["networkBytes"]]
        if not candidates:
            fail("typed subdivision lacks matching measured acquisition failure evidence")
    return {"attempts": len(starts), "pendingStarts": len(starts) - len(terminal), "lastStatus": last.get("status"), "failureKind": last.get("failureKind"), "networkBytesMeasured": last.get("networkBytesMeasured"), "metrics": last.get("metrics"),
            "terminals": [{"attempt": row["attempt"], "status": row["status"], "metrics": row.get("metrics"), "failureKind": row.get("failureKind"), "networkBytesMeasured": row.get("networkBytesMeasured"), "receiptPath": row.get("receiptPath")} for row in terminal]}


def ensure_campaign_quiescent(campaign_dir: Path, database: Path) -> None:
    lock = campaign_dir / ".campaign-runner.lock"
    try:
        info = os.lstat(lock)
    except FileNotFoundError:
        info = None
    if info is not None:
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_size > 1024:
            fail("campaign runner lock is unsafe")
        raw = read_bounded(lock, 1024, "campaign runner lock").decode("utf-8", "strict").strip()
        try:
            pid = int(raw.split(":", 1)[0])
        except ValueError:
            pid = 0
        alive = False
        if pid > 0:
            try:
                os.kill(pid, 0)
                alive = True
            except PermissionError:
                alive = True
            except ProcessLookupError:
                alive = False
        elif time.time() * 1000 - info.st_mtime_ns / 1_000_000 < 30_000:
            alive = True
        if alive:
            fail("campaign runner is active; refusing an immutable SQLite snapshot")
    for suffix in ("-wal", "-shm"):
        sidecar = Path(str(database) + suffix)
        try:
            sidecar_info = os.lstat(sidecar)
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(sidecar_info.st_mode) or not stat.S_ISREG(sidecar_info.st_mode):
            fail("campaign SQLite sidecar is unsafe")
        if sidecar_info.st_size:
            fail("campaign SQLite has a nonempty WAL/SHM sidecar; preserve it and audit after recovery")

def sqlite_jobs(path: Path) -> list[dict[str, Any]]:
    ensure_campaign_quiescent(path.parent, path)
    reject_links(path)
    info = os.lstat(path)
    if not stat.S_ISREG(info.st_mode) or info.st_size > 128 * 1024 * 1024:
        fail("campaign ledger is not a bounded regular SQLite database")
    # Immutable mode opens read-only without creating WAL/SHM sidecars. The audit
    # is deliberately run only after the campaign writer has stopped.
    uri = f"file:{path.as_posix()}?mode=ro&immutable=1"
    connection: sqlite3.Connection | None = None
    try:
        connection = sqlite3.connect(uri, uri=True, timeout=2)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA query_only=ON")
        connection.execute("BEGIN")
        columns = {row[1] for row in connection.execute("PRAGMA table_info(jobs)")}
        required = {"id", "kind", "input_hash", "payload", "max_attempts", "attempt", "priority", "status", "lease_until", "result", "error"}
        if not required <= columns:
            fail("campaign ledger schema is incomplete")
        rows = connection.execute("SELECT id,kind,input_hash,payload,max_attempts,attempt,priority,status,lease_until,result,error FROM jobs ORDER BY id LIMIT ?", (MAX_JOBS + 1,)).fetchall()
        if len(rows) > MAX_JOBS:
            fail("campaign ledger exceeds 400,000 jobs")
        output: list[dict[str, Any]] = []
        for row in rows:
            live()
            item = dict(row)
            item["payload"] = parse(str(item["payload"]).encode("utf-8"), "ledger payload")
            if canonical(item["payload"]) != row["payload"]:
                fail("ledger payload is not canonical JSON")
            item["result"] = None if row["result"] is None else parse(str(row["result"]).encode("utf-8"), "ledger result")
            if row["result"] is not None and canonical(item["result"]) != row["result"]:
                fail("ledger result is not canonical JSON")
            output.append(item)
        connection.rollback()
    except AuditError:
        raise
    except sqlite3.Error as error:
        fail(f"campaign ledger read failed: {error}")
    finally:
        if connection is not None:
            connection.close()
    ensure_campaign_quiescent(path.parent, path)
    return output


def audit_usage(campaign_dir: Path, campaign: dict[str, Any], expected_sources: dict[str, dict[str, Any]], captures: list[dict[str, Any]], typed: list[dict[str, Any]]) -> tuple[dict[str, int], dict[str, dict[str, Any]]]:
    global READ_BYTES
    path = campaign_dir / "usage.jsonl"
    try:
        body = read_bounded(path, MAX_USAGE, "campaign usage journal")
    except AuditError as error:
        if str(error).startswith("missing path component:"):
            if captures or typed:
                fail("campaign usage journal is missing despite query acquisition results")
            body = b""
        else:
            raise
    if body and not body.endswith(b"\n"):
        fail("campaign usage journal has an incomplete final record")
    latest: dict[str, dict[str, Any]] = {}
    phases: dict[str, str] = {}
    prior_sequence = 0
    for line in body.splitlines():
        row = obj(parse(line, "campaign usage row"), "campaign usage row")
        allowed = {"key", "sequence", "sourceKey", "inputPinKey", "phase", "networkBytes", "inputBytes", "outputBytes", "diskBytes", "requestHash", "receiptPath"}
        if not set(row) <= allowed or not {"key", "sequence", "sourceKey", "phase", "networkBytes", "inputBytes", "outputBytes", "diskBytes"} <= set(row):
            fail("campaign usage record fields are invalid")
        sequence = integer(row["sequence"], "usage sequence", 1)
        if sequence <= prior_sequence:
            fail("campaign usage sequence is not strictly increasing")
        prior_sequence = sequence
        if not isinstance(row["key"], str) or not row["key"].startswith("attempt:") or not isinstance(row["sourceKey"], str) or not SHA.fullmatch(row["sourceKey"]):
            fail("campaign usage identity is invalid")
        if row["phase"] not in {"reserved", "settled"}:
            fail("campaign usage phase is invalid")
        for key in ("networkBytes", "inputBytes", "outputBytes", "diskBytes"):
            integer(row[key], f"usage {key}")
        if row["sourceKey"] not in expected_sources:
            fail("campaign usage source key does not resolve to a frozen query request")
        request = expected_sources[row["sourceKey"]]["request"]
        if row["networkBytes"] > request["limits"]["networkBytes"] or row["outputBytes"] > request["limits"]["outputBytes"] or row["diskBytes"] > request["limits"]["diskBytes"]:
            fail("campaign usage reservation exceeds its per-query request caps")
        if row["phase"] == "reserved" and ("inputPinKey" in row or "requestHash" in row or "receiptPath" in row):
            fail("reserved usage row contains settled-only fields")
        prior_phase = phases.get(row["key"])
        if (prior_phase is None and row["phase"] != "reserved") or (prior_phase == "reserved" and row["phase"] != "settled") or prior_phase == "settled":
            fail("usage attempt phases are not a single reserved-then-settled sequence")
        phases[row["key"]] = row["phase"]
        latest[row["key"]] = row
    network = sum(row["networkBytes"] for row in latest.values())
    output = sum(row["outputBytes"] for row in latest.values())
    disk = sum(row["diskBytes"] for row in latest.values())
    input_pins: dict[str, int] = {}
    for row in latest.values():
        pin = row.get("inputPinKey", f"reservation:{row['sourceKey']}")
        input_pins[pin] = max(input_pins.get(pin, 0), row["inputBytes"])
    input_bytes = sum(input_pins.values())
    limits = campaign["limits"]
    if network > limits["networkBytes"] or output > limits["outputBytes"] or input_bytes > limits["inputBytes"] or disk > limits["diskBytes"]:
        fail("durable campaign usage totals exceed frozen campaign budgets")
    return ({"journalRows": prior_sequence, "attemptReservations": len(latest), "networkBytesCharged": network,
            "inputBytesCharged": input_bytes, "outputBytesCharged": output, "sharedDiskBytesCharged": disk,
            "unknownOrReservedAttempts": sum(row["phase"] == "reserved" for row in latest.values())}, latest)


def audit_campaign(raw_root: str, campaign_id: str) -> dict[str, Any]:
    global START, READ_BYTES, CAPTURE_READ_BYTES
    START = time.monotonic(); READ_BYTES = 0; CAPTURE_READ_BYTES = 0
    root = root_path(raw_root)
    if not SAFE_ID.fullmatch(campaign_id):
        fail("campaign id is invalid")
    campaign_dir = root / "campaigns" / campaign_id
    reject_links(campaign_dir)
    if not stat.S_ISDIR(os.lstat(campaign_dir).st_mode):
        fail("campaign path is not a directory")
    config_bytes = read_bounded(campaign_dir / "campaign.json", MAX_CONFIG, "campaign configuration")
    campaign = obj(parse_canonical(config_bytes, "campaign configuration"), "campaign configuration")
    exact(campaign, {"schemaVersion", "id", "inventoryHash", "inventoryKind", "gridQuery", "units", "limits"}, "grid-query campaign")
    campaign_limits = obj(campaign["limits"], "campaign limits")
    exact(campaign_limits, {"durationMs", "jobDurationMs", "networkBytes", "inputBytes", "outputBytes", "diskBytes", "memoryMb", "maxAttempts"}, "campaign limits")
    for key, value in campaign_limits.items():
        integer(value, f"campaign limit {key}", 1)
    binding = obj(parse_canonical(read_bounded(campaign_dir / "grid-query-binding.json", 16_000, "grid query binding"), "grid query binding"), "grid query binding")
    exact(binding, {"path", "hash", "cacheRoot"}, "grid query binding")
    if campaign["schemaVersion"] != 2 or campaign["id"] != campaign_id or campaign["inventoryKind"] != "country-directory" or not SHA.fullmatch(str(campaign["inventoryHash"])):
        fail("campaign schema or identity is invalid")
    grid_binding = obj(campaign["gridQuery"], "campaign grid binding")
    if set(grid_binding) != {"schemaVersion", "planHash", "maxDepth", "maxJobs"} or grid_binding["schemaVersion"] != 1 or not SHA.fullmatch(str(grid_binding["planHash"])) or binding["hash"] != grid_binding["planHash"]:
        fail("campaign grid binding hash/schema is invalid")
    max_depth = integer(grid_binding["maxDepth"], "maxDepth", 0, 8)
    max_jobs = integer(grid_binding["maxJobs"], "maxJobs", 1, MAX_JOBS)
    if not isinstance(binding["path"], str) or not Path(binding["path"]).is_absolute() or str(Path(binding["path"])) != binding["path"]:
        fail("stored plan path is not canonical absolute")
    plan_path = Path(binding["path"])
    plan_hash = grid_binding["planHash"]
    if not inside(root / "country-grids", plan_path):
        fail("stored plan path escapes the canonical country-grid cache")
    if not SHA.fullmatch(plan_hash):
        fail("campaign plan hash is invalid")
    plan_bytes = read_bounded(plan_path, MAX_PLAN, "country grid plan")
    if sha(plan_bytes) != plan_hash:
        fail("country grid plan hash mismatch")
    plan = obj(parse_canonical(plan_bytes, "country grid plan", newline=True), "country grid plan")
    request = obj(plan.get("request"), "country grid request")
    grid_id = request.get("id")
    expected_plan = root / "country-grids" / str(grid_id) / "plans" / f"{plan_hash}.json"
    if plan_path != expected_plan or request.get("directoryManifestHash") != campaign["inventoryHash"] or binding["cacheRoot"] != str(root):
        fail("campaign plan/cache binding is outside its canonical product identity")
    if not isinstance(campaign["units"], list) or len(campaign["units"]) != len(plan.get("cells", [])) or len(campaign["units"]) > max_jobs:
        fail("campaign root units do not conserve the country grid denominator")
    cells_by_id = {cell["id"]: cell for cell in plan["cells"] if isinstance(cell, dict) and isinstance(cell.get("id"), str)}
    if len(cells_by_id) != len(plan["cells"]):
        fail("country grid plan has duplicate or malformed root cell IDs")
    # Re-run the independent byte/geometry audit for the immutable country plan.
    country_grid_audit.START = time.monotonic(); country_grid_audit.READ_BYTES = 0; country_grid_audit.OPS = 0
    plan_relative = str(plan_path.relative_to(root))
    geometric = country_grid_audit.verify(root, plan_relative, plan_hash)
    source_config_path = REPO / "world" / "acquisition-sources.json"
    source_config = parse(read_bounded(source_config_path, 64_000, "pinned acquisition source configuration"), "pinned acquisition source configuration")
    if campaign["limits"].get("maxAttempts", 0) < 1 or campaign["limits"].get("networkBytes", 0) < 1:
        fail("campaign limits are incomplete")
    templates: dict[str, dict[str, Any]] = {}
    for index, unit_value in enumerate(campaign["units"]):
        unit = obj(unit_value, "query root unit")
        exact(unit, {"id", "inventoryUnitId", "priority", "kind", "query", "request"}, "query root unit")
        query = obj(unit["query"], "query root address")
        exact(query, {"rootCellId", "path"}, "query root address")
        root_id = query.get("rootCellId")
        if query.get("path") != "" or not isinstance(root_id, str) or root_id in templates or unit["kind"] != "grid-query" or unit["inventoryUnitId"] != plan["country"]["id"] or unit["priority"] != index:
            fail("campaign query roots are duplicate, unbound, or misordered")
        expected = unit_for({"rootCellId": root_id, "path": ""}, {root_id: unit}, plan, max_depth, cells_by_id)
        if canonical(expected) != canonical(unit):
            fail("campaign root request does not match its exact frozen cell bounds")
        templates[root_id] = unit
    if set(templates) != {cell["id"] for cell in plan["cells"]}:
        fail("campaign does not include every selected plan root exactly once")
    jobs = sqlite_jobs(campaign_dir / "ledger.sqlite")
    if len(jobs) > max_jobs:
        fail("campaign ledger job count exceeds grid-query maxJobs")
    campaign_hash = digest(campaign)
    job_by_address: dict[tuple[str, str], dict[str, Any]] = {}
    units_by_source: dict[str, dict[str, Any]] = {}
    attempt_results: dict[str, Any] = {}
    capture_results: list[dict[str, Any]] = []
    typed_results: list[dict[str, Any]] = []
    supported_rows = zero_features = captured = subdivided = failed = queued = leased = 0
    for job in jobs:
        if job["kind"] != "campaign-grid-query" or job["status"] not in {"queued", "leased", "completed", "failed"}:
            fail("ledger contains an unexpected campaign job kind/status")
        payload = obj(job["payload"], "query job payload")
        exact(payload, {"campaignId", "campaignHash", "inventoryHash", "unit"}, "query job payload")
        if payload["campaignId"] != campaign_id or payload["campaignHash"] != campaign_hash or payload["inventoryHash"] != campaign["inventoryHash"]:
            fail("ledger job configuration binding mismatch")
        candidate = obj(payload["unit"], "query job unit")
        query = obj(candidate.get("query"), "query job address")
        exact(query, {"rootCellId", "path"}, "query job address")
        root_id, query_path = query.get("rootCellId"), query.get("path")
        if not isinstance(root_id, str) or not isinstance(query_path, str) or root_id not in templates:
            fail("ledger job address has an unknown root")
        expected_unit = unit_for({"rootCellId": root_id, "path": query_path}, templates, plan, max_depth, cells_by_id)
        if canonical(candidate) != canonical(expected_unit) or job["id"] != f"{campaign_id}:{expected_unit['id']}" or job["input_hash"] != digest({"campaignHash": campaign_hash, "inventoryHash": campaign["inventoryHash"], "unit": expected_unit}):
            fail("ledger query unit ID, request bounds, or input hash is inconsistent")
        if integer(job["max_attempts"], "job maximum attempts", 1) != campaign["limits"]["maxAttempts"] or integer(job["attempt"], "job attempt") > job["max_attempts"] or integer(job["priority"], "job priority") != expected_unit["priority"]:
            fail("ledger scheduling metadata differs from the frozen campaign")
        address_key = (root_id, query_path)
        if address_key in job_by_address:
            fail("ledger contains duplicate query job address")
        result = job["result"]
        if job["status"] != "completed" and result is not None:
            fail("non-completed ledger job contains a result")
        if job["status"] == "completed":
            result_obj = obj(result, "completed query result")
            if result_obj.get("status") == "query-captured":
                capture = validate_receipt_and_extract(result_obj, expected_unit, root, source_config)
                attempt_result = verify_attempt(root, capture["requestHash"], expected_unit, None)
                if attempt_result is None:
                    fail("capture is missing successful attempt evidence")
                allowed_terminal = {"success", "cache-hit"} if capture["networkBytesCurrent"] == 0 else {"success"}
                expected_receipt_path = str(root / "acquisitions" / capture["requestHash"] / "receipt.json")
                matching = [row for row in attempt_result["terminals"] if row["status"] in allowed_terminal and row["metrics"] == capture["ledgerMetrics"] and row.get("receiptPath") == expected_receipt_path]
                if not matching:
                    fail("captured ledger metrics do not match a terminal acquisition attempt")
                capture["matchingAttemptStatuses"] = sorted({row["status"] for row in matching})
                capture_results.append({**capture, "address": {"rootCellId": root_id, "path": query_path}, "unit": expected_unit})
                attempt_results[f"{root_id}:{query_path}"] = attempt_result
                supported_rows += capture["features"]
                captured += 1
                zero_features += capture["features"] == 0
            elif result_obj.get("status") == "query-subdivided":
                exact(result_obj, {"status", "reason", "children"}, "subdivision result")
                if result_obj["status"] != "query-subdivided" or result_obj["reason"] not in {"selected-item-count", "feature-row-budget", "geojson-output-bytes"} or not isinstance(result_obj["children"], list) or len(result_obj["children"]) != 4 or len(query_path) >= max_depth:
                    fail("completed subdivision does not satisfy the bounded budget/depth contract")
                reason = result_obj["reason"]
                request_hash = expected_request_hash(expected_unit, source_config)
                evidence = verify_attempt(root, request_hash, expected_unit, None)
                typed_evidence = [row for row in (evidence or {}).get("terminals", []) if row["status"] == "failure" and row.get("failureKind") == reason]
                if evidence is None or not typed_evidence:
                    fail("subdivision lacks typed acquisition attempt evidence")
                typed_results.append({"requestHash": request_hash, "reason": reason, "networkBytesMeasured": None, "typedAttempts": typed_evidence, "address": {"rootCellId": root_id, "path": query_path}, "unit": expected_unit})
                expected_children = [{"rootCellId": root_id, "path": query_path + digit} for digit in "0123"]
                if result_obj["children"] != expected_children:
                    fail("subdivision result child list differs from exact atomic quadrant addresses")
                subdivided += 1
            else:
                fail("completed query job has an unsupported result status")
        elif job["status"] == "failed":
            failed += 1
        elif job["status"] == "queued":
            queued += 1
        else:
            leased += 1
        job_by_address[address_key] = {**job, "unit": expected_unit}
        key = expected_usage_source_key(campaign["inventoryHash"], expected_unit)
        units_by_source[key] = expected_unit
    # Every child has exactly one successfully subdivided parent; each split atomically enqueues four.
    for (root_id, child_path), job in job_by_address.items():
        if not child_path:
            continue
        parent = job_by_address.get((root_id, child_path[:-1]))
        if not parent or parent["status"] != "completed" or not isinstance(parent["result"], dict) or parent["result"].get("status") != "query-subdivided":
            fail("ledger contains an orphan child query job")
    for (root_id, query_path), job in job_by_address.items():
        if job["status"] == "completed" and isinstance(job["result"], dict) and job["result"].get("status") == "query-subdivided":
            expected = {(root_id, query_path + digit) for digit in "0123"}
            if not expected <= set(job_by_address):
                fail("completed parent subdivision is missing one or more atomically enqueued children")
    # Verify attempts for failed or interrupted jobs too; incomplete reservations stay charged.
    for (root_id, query_path), job in job_by_address.items():
        if job["status"] in {"queued", "leased", "failed"}:
            unit = job["unit"]
            request_hash = expected_request_hash(unit, source_config)
            evidence = verify_attempt(root, request_hash, unit, None)
            if evidence:
                attempt_results[f"{root_id}:{query_path}"] = evidence
    root_counts = {"captured": 0, "exception": 0, "pending": 0}
    def visit(root_id: str, path: str) -> str:
        job = job_by_address.get((root_id, path))
        if job is None:
            return "pending"
        if job["status"] == "failed":
            return "exception"
        if job["status"] in {"queued", "leased"}:
            return "pending"
        result = job["result"]
        if result["status"] == "query-captured":
            return "captured"
        states = [visit(root_id, path + digit) for digit in "0123"]
        return "exception" if "exception" in states else "pending" if "pending" in states else "captured"
    for root_id in templates:
        root_counts[visit(root_id, "")] += 1
    usage, latest_rows = audit_usage(campaign_dir, campaign, units_by_source, capture_results, typed_results)
    # Every successful result is backed by the latest settled usage record and original immutable source attempt.
    for capture in capture_results:
        expected_key = expected_usage_source_key(campaign["inventoryHash"], capture["unit"])
        matches = [row for row in latest_rows.values() if row["sourceKey"] == expected_key and row.get("requestHash") == capture["requestHash"] and row.get("receiptPath") == str(root / "acquisitions" / capture["requestHash"] / "receipt.json")]
        if not matches:
            fail("captured query lacks a matching settled input-pin budget record")
        latest = max(matches, key=lambda row: row["sequence"])
        if latest["phase"] != "settled" or latest.get("inputPinKey") != f"{capture['inputSha256']}:{capture['inputBytes']}":
            fail("captured query lacks a matching settled input-pin budget record")
        if latest["networkBytes"] != capture["networkBytesCurrent"] or latest["outputBytes"] not in {0, capture["outputBytes"]}:
            fail("captured query usage settlement differs from its current acquisition metrics")
        if latest["outputBytes"] == 0 and "cache-hit" not in capture["matchingAttemptStatuses"]:
            fail("zero-output capture settlement lacks a cache-hit attempt")
        if latest["outputBytes"] > 0 and "success" not in capture["matchingAttemptStatuses"]:
            fail("charged capture output lacks a successful acquisition attempt")
    for failure in typed_results:
        expected_key = expected_usage_source_key(campaign["inventoryHash"], failure["unit"])
        matches = [row for row in latest_rows.values() if row["sourceKey"] == expected_key and row["phase"] == "settled" and row.get("requestHash") is None]
        if not matches:
            fail("typed budget failure usage settlement differs from measured failure evidence")
        latest = max(matches, key=lambda row: row["sequence"])
        if latest["inputBytes"] != 0 or latest["outputBytes"] != 0:
            fail("typed budget failure usage settlement differs from measured failure evidence")
        measured = latest["networkBytes"]
        if not any(row["networkBytesMeasured"] == measured for row in failure["typedAttempts"]):
            fail("typed budget failure measured usage does not match a durable typed attempt")
        failure["networkBytesMeasured"] = measured
    elapsed = int((time.monotonic() - START) * 1000)
    return {"verified": True, "campaignId": campaign_id, "campaignHash": campaign_hash, "planHash": plan_hash,
            "countryId": plan["country"]["id"], "countryGridIndependentAudit": geometric,
            "coverage": {"roots": {"requested": len(templates), **root_counts}, "jobs": {"total": len(jobs), "subdivided": subdivided, "captured": captured, "zeroFeatureQueries": zero_features, "failed": failed, "queued": queued, "leased": leased}, "supportedFeatureRowsAcrossOverlappingQueries": supported_rows,
                         "kind": "source-query-only", "geometryCoverage": "not-compiled"},
            "typedBudgetFailures": [{key: item[key] for key in ("address", "reason", "networkBytesMeasured", "requestHash")} for item in typed_results],
            "acquisitionAttempts": attempt_results, "budgetCharges": usage, "networkBytes": 0,
            "readBytes": READ_BYTES, "captureReadBytes": CAPTURE_READ_BYTES, "elapsedMs": elapsed,
            "limitations": "Captured feature rows may overlap; this audit does not globally deduplicate/assign owners, compile geometry, or establish physical emptiness/playability."}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, help="canonical absolute .cache/world-build root")
    parser.add_argument("--campaign", required=True, help="safe campaign id")
    args = parser.parse_args()
    try:
        receipt = audit_campaign(args.root, args.campaign)
        print(json.dumps(receipt, sort_keys=True, separators=(",", ":")))
        return 0
    except (AuditError, OSError, ValueError, TypeError, KeyError, IndexError, sqlite3.Error) as error:
        print(json.dumps({"verified": False, "error": str(error)[:2048]}, sort_keys=True, separators=(",", ":")), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
