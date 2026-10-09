"""Pinned fixed-process namespace startup; no live SQL connection in the parent.

Registry CPU/file/core/wall/output limits and sampled RSS are supervised. Persistent
controller records, killed-controller recovery and campaign ingestion remain later
requirements. Python stdlib/native extension bytes are not a hermetic runtime pin.
"""
import hashlib
import json
from pathlib import Path
import re
from contextlib import nullcontext

from index_binding import _pairs, _nonfinite
from index_bootstrap import _node_pin
from index_execution_snapshot import (CONFIGURATION, _capture, _pin, _inventory, VerifiedIndexExecution,
                                      verified_execution_snapshot)
from index_namespace import namespace_binding, _aggregate, _root, _preflight, _read_owned
from index_reservations import DATABASE_BYTES, REGISTRY_ALLOWANCE, MAX_RESERVATIONS
from index_resource_limits import _run_fixed_process, _registry_sizes, bounded_integer
from index_root import _lease
from index_tooling import verify_index_tooling
from index_writer_lock import index_writer_lease
from index_controller_state import CONTROLS, EXECUTION

MIB = 1024 * 1024
RUNTIME_FIELDS = {"pythonVersion", "sqliteVersion", "pythonBytes", "pythonSha256"}
REPORT_FIELDS = {"format", "namespaceBindingSha256", "aggregateBytes", "replayed",
                 "pythonVersion", "sqliteVersion", "stats", "databaseBytes", "maximumRssKiB"}
STAT_FIELDS = {"reservations", "heldBytes", "registryAllowanceBytes", "chargedBytes", "aggregateLimitBytes"}


def _runtime(value):
    if type(value) is not dict or set(value) != RUNTIME_FIELDS:
        raise ValueError("registry runtime pin requires its exact fields")
    value = dict(value)
    for key in ["pythonVersion", "sqliteVersion"]:
        if type(value[key]) is not str or not re.fullmatch(r"[0-9]{1,3}(?:\.[0-9]{1,3}){2}", value[key]):
            raise ValueError("registry runtime version is not an exact bounded version")
    _pin({"bytes": value["pythonBytes"], "sha256": value["pythonSha256"]}, 256*MIB, "Python executable")
    return value


def startup_index_namespace(namespace_root, aggregate_bytes, repository_root, manifest_bytes,
                            manifest_pin, source_configuration, source_pin, python, python_runtime,
                            *, cpu_seconds=10, wall_seconds=15, rss_limit_bytes=96*MIB,
                            _inherited_lease=None, _execution=None):
    """Initialize/reopen only a pinned registry in a private, caller-owned namespace.

    The namespace flock is held before snapshot creation and inherited by the fixed
    worker. The snapshot shares the existing17MiB registry allowance, allowing only
    a conservative remaining margin. Failure never disposes the caller's namespace.
    Unconfirmed reap preserves its snapshot/actual process handle through the shared
    boundary. This returns a terminal report, never an unsupervised SQL writer.
    """
    aggregate = _aggregate(aggregate_bytes)
    bounded_integer(cpu_seconds, 1, 60, "CPU seconds")
    bounded_integer(wall_seconds, 1, 60, "wall seconds")
    bounded_integer(rss_limit_bytes, 64*MIB, 512*MIB, "sampled RSS bytes")
    runtime = _runtime(python_runtime)
    expected = namespace_binding(aggregate, sqlite_version=runtime["sqliteVersion"])
    repository = Path(repository_root)
    tooling = verify_index_tooling(repository, manifest_bytes, manifest_pin)
    _pin(source_pin, 64000, "source configuration")
    if (type(source_configuration) is not bytes or len(source_configuration) != source_pin["bytes"]
            or hashlib.sha256(source_configuration).hexdigest() != source_pin["sha256"]
            or _capture(repository, CONFIGURATION, source_pin) != source_configuration):
        raise ValueError("registry source configuration differs from its retained bytes")
    if tooling["sourceBytes"] + len(source_configuration) + 65536 > REGISTRY_ALLOWANCE - 4*DATABASE_BYTES:
        raise ValueError("registry tooling cannot fit its bounded snapshot allowance")
    executable_pin = {"nodeBytes": runtime["pythonBytes"], "nodeSha256": runtime["pythonSha256"]}
    executable, before_runtime = _node_pin(python, executable_pin, label="Python")
    root, _ = _root(namespace_root)
    managed = _inherited_lease is not None or _execution is not None
    if managed:
        _lease(_inherited_lease)
        if (type(_execution) is not VerifiedIndexExecution or _inherited_lease.root != root
                or _execution.root != root/EXECUTION or _execution.manifest_bytes != manifest_bytes
                or _execution.manifest_pin != manifest_pin or _execution.source_configuration != source_configuration
                or _execution.source_pin != source_pin or _inventory(_execution.root) != _execution.charged_bytes):
            raise ValueError("managed registry startup requires its actual bound snapshot and namespace lease")
        verify_index_tooling(_execution.root, manifest_bytes, manifest_pin)
        if _capture(_execution.root, CONFIGURATION, source_pin) != source_configuration:
            raise ValueError("managed source configuration differs")
    elif any((root/name).exists() or (root/name).is_symlink() for name in CONTROLS):
        raise ValueError("managed namespace requires persistent controller startup; preserve state")
    _preflight(root, expected, aggregate)  # Files/header only; no parent SQLite.
    with (nullcontext(_inherited_lease) if managed else index_writer_lease(root)) as lease:
        _lease(lease); _preflight(root, expected, aggregate)
        with (nullcontext(_execution) if managed else verified_execution_snapshot(
                repository, manifest_bytes, manifest_pin, source_configuration, source_pin)) as execution:
            margin = (2*64000 if managed else 0) + 65536 + root.lstat().st_blocks*512
            if 4*DATABASE_BYTES + execution.charged_bytes + margin > REGISTRY_ALLOWANCE:
                raise ValueError("actual registry snapshot cannot fit the immutable allowance")
            result = _run_fixed_process(executable, "index-registry-startup", root,
                lease_descriptor=lease.descriptor, execution_root=execution.root,
                registry_configuration={"aggregateBytes": aggregate, "pythonVersion": runtime["pythonVersion"],
                                        "sqliteVersion": runtime["sqliteVersion"]},
                file_bytes=DATABASE_BYTES, cpu_seconds=cpu_seconds, wall_seconds=wall_seconds,
                heap_mib=64, rss_limit_bytes=rss_limit_bytes)
            _lease(lease)
            _, after_runtime = _node_pin(executable, executable_pin, label="Python")
            if after_runtime != before_runtime:
                raise RuntimeError("Python runtime changed during startup; preserve namespace state")
            if result["returnCode"] != 0 or result["reason"] != "exit":
                raise RuntimeError(f"fixed registry worker failed ({result['reason']}, {result['returnCode']}): {result['stderr'][:4096]}")
            report = json.loads(result["stdout"], object_pairs_hook=_pairs, parse_constant=_nonfinite)
            if (type(report) is not dict or set(report) != REPORT_FIELDS
                    or report["format"] != "feature-index-registry-startup-v1"
                    or type(report["aggregateBytes"]) is not int or report["aggregateBytes"] != aggregate
                    or type(report["replayed"]) is not bool
                    or report["pythonVersion"] != runtime["pythonVersion"]
                    or report["sqliteVersion"] != runtime["sqliteVersion"]
                    or report["namespaceBindingSha256"] != hashlib.sha256(expected).hexdigest()):
                raise ValueError("registry report differs from its admitted runtime/namespace")
            stats = report["stats"]
            if (type(stats) is not dict or set(stats) != STAT_FIELDS
                    or any(type(v) is not int or not 0 <= v <= aggregate for v in stats.values())
                    or not 0 <= stats["reservations"] <= MAX_RESERVATIONS
                    or stats["registryAllowanceBytes"] != REGISTRY_ALLOWANCE
                    or stats["aggregateLimitBytes"] != aggregate
                    or stats["chargedBytes"] != REGISTRY_ALLOWANCE + stats["heldBytes"]
                    or stats["heldBytes"] < stats["reservations"]*65536
                    or (stats["reservations"] == 0 and stats["heldBytes"] != 0)):
                raise ValueError("registry report charges differ from its immutable allowance")
            _read_owned(root, "namespace.json", 4096, exact=expected)
            sizes = _registry_sizes(root)
            if (type(report["databaseBytes"]) is not int or not 4096 <= report["databaseBytes"] <= DATABASE_BYTES
                    or report["databaseBytes"] % 4096 or report["databaseBytes"] != sizes.get("reservations.sqlite")
                    or type(report["maximumRssKiB"]) is not int or report["maximumRssKiB"] < 1):
                raise ValueError("registry report differs from its actual final database/RSS")
            if report["maximumRssKiB"]*1024 > rss_limit_bytes:
                raise RuntimeError("registry worker reported peak RSS exceeds its admitted ceiling; preserve state")
            if any(name.startswith("reservations.bootstrap.") or name in {
                    "namespace.pending", "reservations.sqlite-wal", "reservations.sqlite-shm", "reservations.sqlite-journal"}
                    for name in sizes):
                raise ValueError("registry startup did not close/publish all of its fixed files")
            overhead = root.lstat().st_blocks*512
            for name in sizes:
                info = (root/name).lstat(); overhead += max(info.st_size, info.st_blocks*512)
            if overhead + execution.charged_bytes > REGISTRY_ALLOWANCE:
                raise ValueError("actual registry and snapshot exceed their immutable physical allowance")
            return {"registry": report, "guard": result,
                    "executionSnapshotChargedBytes": execution.charged_bytes,
                    "toolingManifest": dict(manifest_pin)}
