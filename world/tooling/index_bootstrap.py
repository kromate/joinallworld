"""Supervised, pinned atomic engine bootstrap; not an unattended campaign opener.

Receives an already charged root and caller-owned namespace registry/lease.
Registry supervision, measured quotas and fenced capture/ledger completion remain
external. No acquisition, game, quota refund or implicit repair is performed.
"""
import hashlib
import json
import os
from pathlib import Path
import stat

from index_binding import decode_index_binding, _pairs, _nonfinite
from index_binding_publish import publish_index_binding
from index_execution_snapshot import verified_execution_snapshot
from index_resource_limits import _run_fixed_process
from index_root import ChargedIndexRoot, _binding, _lease
from index_storage_footprint import index_storage_footprint

MIB = 1024*1024


def _node_pin(node, expected):
    node = Path(node)
    if not node.is_absolute():
        raise ValueError("bootstrap Node executable must be absolute")
    node = node.resolve(strict=True)
    descriptor = os.open(node, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(descriptor)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid not in {0, os.getuid()}
                or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) & 0o022
                or not os.access(node, os.X_OK) or info.st_size != expected["nodeBytes"]):
            raise ValueError("Node executable is unsafe or differs from its pinned size")
        digest = hashlib.sha256(); total = 0
        while total <= expected["nodeBytes"]:
            chunk = os.read(descriptor, min(65536, expected["nodeBytes"]-total+1))
            if not chunk: break
            total += len(chunk); digest.update(chunk)
        identity = lambda i: (i.st_dev, i.st_ino, i.st_size, i.st_mtime_ns, i.st_ctime_ns,
                               i.st_uid, i.st_mode, i.st_nlink)
        if (total != expected["nodeBytes"] or digest.hexdigest() != expected["nodeSha256"]
                or identity(os.fstat(descriptor)) != identity(info)
                or identity(node.lstat()) != identity(info)):
            raise ValueError("Node executable bytes/inode differ from the retained runtime pin")
        return node, identity(info)
    finally:
        os.close(descriptor)


def bootstrap_index(admitted, repository_root, manifest_bytes, source_configuration, node):
    """Verify actual inputs, run one fixed frozen worker, then inventory terminal state.

    Source snapshots are disposable, private and readonly, not an adversarial OS
    immutability guarantee. They share the declared index allowance while live.
    Failed/abrupt workers preserve all index/WAL state for exact later recovery.
    This endpoint only starts/reopens SQL; it never ingests or completes a job.
    """
    if type(admitted) is not ChargedIndexRoot:
        raise TypeError("engine bootstrap requires its actual charged root")
    config = decode_index_binding(admitted.binding_bytes)
    root, _ = _lease(admitted.lease)
    if (hashlib.sha256(admitted.binding_bytes).hexdigest() != admitted.index_hash
            or root.name != admitted.index_hash or config["reservedBytes"] != admitted.reserved_bytes):
        raise ValueError("engine bootstrap root/hash/allowance differs")
    _binding(root, admitted.binding_bytes)
    executable, runtime_before = _node_pin(node, config["runtime"])
    with verified_execution_snapshot(repository_root, manifest_bytes, config["toolingManifest"],
                                     source_configuration, config["source"]["configuration"]) as execution:
        limits = config["processLimits"]
        # Candidate conservative live-file ceiling, not a measured global quota.
        if 4*limits["fileBytes"] + execution.charged_bytes + 2*MIB > admitted.reserved_bytes:
            raise ValueError("index allowance cannot hold database sidecars and execution snapshot")
        available = admitted.reserved_bytes-execution.charged_bytes
        index_storage_footprint(admitted.lease, file_bytes=limits["fileBytes"], aggregate_bytes=available)
        publish_index_binding(admitted)
        result = _run_fixed_process(executable, "index-engine-bootstrap", root,
            lease_descriptor=admitted.lease.descriptor, execution_root=execution.root,
            file_bytes=limits["fileBytes"], cpu_seconds=limits["cpuSeconds"],
            wall_seconds=limits["wallSeconds"], heap_mib=limits["heapMiB"], rss_limit_bytes=limits["rssBytes"])
        # Guard has reaped its only worker before snapshots may be cleaned up.
        _binding(root, admitted.binding_bytes); _lease(admitted.lease)
        footprint = index_storage_footprint(admitted.lease, file_bytes=limits["fileBytes"], aggregate_bytes=available)
        _, runtime_after = _node_pin(executable, config["runtime"])
        if runtime_after != runtime_before:
            raise RuntimeError("Node runtime changed during execution; preserve index state")
        if result["returnCode"] != 0 or result["reason"] != "exit":
            raise RuntimeError(f"fixed bootstrap worker failed ({result['reason']}, {result['returnCode']}): {result['stderr'][:4096]}")
        report = json.loads(result["stdout"], object_pairs_hook=_pairs, parse_constant=_nonfinite)
        if (type(report) is not dict or set(report) != {"format", "indexHash", "replayed", "nodeVersion",
                "sqliteVersion", "stats", "databaseBytes", "maximumRssKiB"}
                or report["format"] != "feature-index-bootstrap-v1" or report["indexHash"] != admitted.index_hash
                or type(report["replayed"]) is not bool
                or report["nodeVersion"] != config["runtime"]["nodeVersion"]
                or report["sqliteVersion"] != config["runtime"]["sqliteVersion"]):
            raise ValueError("bootstrap report differs from admitted runtime/root contract")
        if (type(report["databaseBytes"]) is not int
                or report["databaseBytes"] != (root/"features.sqlite").stat().st_size
                or type(report["maximumRssKiB"]) is not int or report["maximumRssKiB"] < 1):
            raise ValueError("bootstrap report differs from its actual physical state")
        stats = report["stats"]
        if type(stats) is not dict or set(stats) != {"captures", "occurrences", "versions", "observations", "keys", "conflictedKeys"}:
            raise ValueError("bootstrap stats require every engine counter")
        for key, value in stats.items():
            maximum = config["engineLimits"].get(key, config["engineLimits"]["versions"])
            if type(value) is not int or not 0 <= value <= maximum:
                raise ValueError("bootstrap engine counts exceed admitted bounds")
        return {"bootstrap": report, "guard": result, "footprint": footprint,
                "executionSnapshotChargedBytes": execution.charged_bytes}
