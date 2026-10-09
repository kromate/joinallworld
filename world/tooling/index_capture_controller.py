"""Durable per-request ownership for the fixed verified-capture worker.

Use within a held supervised_charged_index session. Campaign Ledger remains the
scheduler; this endpoint does not acquire data or mark a campaign job complete.
Every call, including a previous terminal request, raw-replays the actual index.
"""
import hashlib
import json
from pathlib import Path
import weakref

from index_binding import decode_index_binding
from index_binding_publish import publish_index_binding
from index_bootstrap import _node_pin
from index_capture_record import (FORMAT, FORMAT_V2, MAX_RECORD_BYTES, MAX_ATTEMPTS, MAX_JOBS,
    encode_capture_record, decode_capture_record, begin_capture, capture_snapshot_ready, finish_capture)
from index_capture_state import (RECORD, PENDING, read_record, publish_record,
                                 seal_record, settlement)
from index_capture_snapshot import (CAPTURE_EXECUTION, CAPTURE_RECLAIM,
    copy_capture_snapshot, capture_snapshot, cleanup_capture_snapshot)
from index_controller_state import read_private
from index_execution_snapshot import _capture, CONFIGURATION
from index_ingest import ingest_index, capture_descriptors, _expected, observation_pin
from index_resource_limits import IndexWorkerUnreaped, bounded_integer
from index_root import ChargedIndexRoot, _lease, _binding
from index_storage_footprint import AUDIT_FILES, AUDIT_DIRECTORIES, index_storage_footprint
from index_tooling import verify_index_tooling, decode_tooling_manifest, source_snapshot_allowance

MIB = 1024*1024
_POISONED_LEASES = weakref.WeakValueDictionary()


def _present(path):
    return path.exists() or path.is_symlink()


def _job(record, request_hash):
    return next((job for job in record["jobs"] if job["requestHash"] == request_hash), None)


def _settle(root, record, request_hash):
    record = finish_capture(record, request_hash, settlement(record, request_hash))
    publish_record(root, record)
    return record


def _cleanup_slot(root, record, manifest_bytes, config, source_configuration):
    slots = [root/name for name in (CAPTURE_EXECUTION, CAPTURE_RECLAIM) if _present(root/name)]
    if not slots: return
    if len(slots) != 1: raise ValueError("mixed persistent capture execution slots; preserve them")
    info = slots[0].lstat()
    job = _job(record, record["current"])
    attempt = None if job is None else job["attempts"][-1]
    if (attempt is None or attempt["phase"] != "terminal"
            or (attempt["snapshotDevice"], attempt["snapshotInode"]) != (info.st_dev, info.st_ino)):
        raise ValueError("capture execution has no unique settled owner; preserve it")
    cleanup_capture_snapshot(root, attempt, manifest_bytes, config["toolingManifest"],
                             source_configuration, config["source"]["configuration"])


def ingest_capture_job(admitted, repository_root, manifest_bytes, source_configuration, node,
                       extract_path, receipt_path, expected, *, attempt_limit=8, job_limit=256,
                       observation=None):
    """Charge one request attempt before frozen execution allocation or SQL.

    Both actual leases must be held with no live previous worker. Following an
    unconfirmed exit, this same lease object is poisoned: leave the session and
    recover through newly acquired kernel leases. No remembered PID is signalled.
    Terminal settlement does not prove success; a fresh fixed raw replay does.
    """
    if type(admitted) is not ChargedIndexRoot:
        raise TypeError("capture ownership requires its actual charged root")
    if _POISONED_LEASES.get(id(admitted.lease)) is admitted.lease:
        raise RuntimeError("capture lease has an unconfirmed worker; reacquire actual leases before recovery")
    context_pin = observation_pin(observation)
    # Only string-valued compact contexts are admitted. Retain our own copy
    # across descriptor verification, durable publication and actual worker SQL.
    observation = None if observation is None else dict(observation)
    bounded_integer(attempt_limit, 1, MAX_ATTEMPTS, "capture attempt limit")
    bounded_integer(job_limit, 1, MAX_JOBS, "capture job limit")
    config = decode_index_binding(admitted.binding_bytes)
    root, info = _lease(admitted.lease); namespace, _ = _lease(admitted.namespace_lease)
    if (root.parent != namespace or root.name != admitted.index_hash
            or hashlib.sha256(admitted.binding_bytes).hexdigest() != admitted.index_hash
            or config["reservedBytes"] != admitted.reserved_bytes):
        raise ValueError("capture controller root, binding or paired namespace differs")
    _binding(root, admitted.binding_bytes)
    if any((root/name).exists() or (root/name).is_symlink()
           for name in AUDIT_FILES | AUDIT_DIRECTORIES):
        raise ValueError("index is frozen for audit; further ingestion would change immutable audit input")
    executable, runtime_before = _node_pin(node, config["runtime"])
    repository = Path(repository_root)
    verify_index_tooling(repository, manifest_bytes, config["toolingManifest"])
    manifest = decode_tooling_manifest(manifest_bytes, config["toolingManifest"])
    if _capture(repository, CONFIGURATION, config["source"]["configuration"]) != source_configuration:
        raise ValueError("capture controller source configuration differs")
    _expected(expected)
    expected_bytes = json.dumps(expected, sort_keys=True, ensure_ascii=True, separators=(",", ":"),
                                allow_nan=False).encode("ascii")
    if not 1 <= len(expected_bytes) <= 64000:
        raise ValueError("capture expectation exceeds its durable pin bound")
    capture_input = {"expected": {"sha256": hashlib.sha256(expected_bytes).hexdigest(), "bytes": len(expected_bytes)},
                     "extractPath": str(extract_path), "receiptPath": str(receipt_path)}
    record_format = FORMAT if observation is None else FORMAT_V2
    try:
        previous = decode_capture_record(read_private(root/RECORD, MAX_RECORD_BYTES))
    except FileNotFoundError:
        previous = None
    if previous is not None:
        record_format = previous["format"]
        if record_format == FORMAT and observation is not None:
            raise ValueError("v1 capture quota cannot be migrated to campaign observations; preserve attempts")
    header = {"format": record_format, "index": {"indexHash": admitted.index_hash,
        "rootDevice": info.st_dev, "rootInode": info.st_ino,
        "lockDevice": admitted.lease.device, "lockInode": admitted.lease.inode},
        "limits": {"attempts": attempt_limit, "jobs": job_limit}, "jobs": [], "current": None}
    # Validate lexical fields and actual readonly raw pins before state allocation.
    begin_capture(header, expected["requestHash"], capture_input, context_pin)
    with capture_descriptors(extract_path, receipt_path, expected, observation=observation): pass
    limits = config["processLimits"]
    snapshot_reserve = source_snapshot_allowance(manifest, len(source_configuration))
    if snapshot_reserve > MIB:
        raise ValueError("persistent capture source cannot fit its unchanged 1MiB slot")
    # Fixed record and staged record can coexist; include block padding, the full
    # execution slot, conservative four database ceilings and the existing margin.
    if 4*limits["fileBytes"] + 2*MAX_RECORD_BYTES + 2*MIB + MIB + 65536 > admitted.reserved_bytes:
        raise ValueError("index reservation cannot hold durable capture state and sidecars")
    index_storage_footprint(admitted.lease, file_bytes=limits["fileBytes"], aggregate_bytes=admitted.reserved_bytes)
    record = read_record(root, header)
    if record is None:
        if any(_present(root/name) for name in (CAPTURE_EXECUTION, CAPTURE_RECLAIM)):
            raise ValueError("unbound capture execution slot; preserve it")
        record = begin_capture(header, expected["requestHash"], capture_input, context_pin)
        publish_index_binding(admitted)
        publish_record(root, record)
    else:
        old = _job(record, expected["requestHash"])
        if old is not None and old["input"] != capture_input:
            raise ValueError("capture request owns different immutable input; preserve state")
    seal_record(root, record)
    prepared = next((job for job in record["jobs"] if job["attempts"][-1]["phase"] == "prepared"), None)
    reconciled = 0
    if prepared is not None and prepared["attempts"][-1]["snapshotDevice"] is not None:
        # Newly acquired actual leases (or a known terminal previous invocation)
        # are the writer-gap proof. The durable record supplies no kill target.
        record = _settle(root, record, prepared["requestHash"])
        reconciled = 1; prepared = None
    if prepared is None:
        _cleanup_slot(root, record, manifest_bytes, config, source_configuration)
        record = begin_capture(record, expected["requestHash"], capture_input, context_pin)
        publish_record(root, record)
    elif (prepared["requestHash"] != expected["requestHash"] or prepared["input"] != capture_input
            or prepared["attempts"][-1].get("observation") != context_pin):
        raise ValueError("unlaunched capture attempt owns a different input or observation; preserve it")
    execution_path = copy_capture_snapshot(root, repository, manifest, source_configuration,
                                           config["source"]["configuration"])
    execution = capture_snapshot(root, manifest_bytes, config["toolingManifest"], source_configuration,
                                 config["source"]["configuration"])
    snapshot_info = execution_path.lstat()
    record = capture_snapshot_ready(record, expected["requestHash"], snapshot_info.st_dev, snapshot_info.st_ino)
    publish_record(root, record)
    _, runtime_after = _node_pin(executable, config["runtime"])
    if runtime_before != runtime_after:
        raise RuntimeError("Node runtime changed before durable capture launch; preserve state")
    try:
        result = ingest_index(admitted, repository, manifest_bytes, source_configuration, executable,
                              extract_path, receipt_path, expected, _execution=execution,
                              observation=observation)
    except IndexWorkerUnreaped as error:
        _POISONED_LEASES[id(admitted.lease)] = admitted.lease
        error.retained_snapshot = execution_path
        error.retained_capture_record = root/RECORD
        raise
    except Exception:
        # The fixed guard either never launched or confirmed its worker terminal.
        # Keep the failure charged and preserve committed index/WAL state.
        record = _settle(root, record, expected["requestHash"])
        _cleanup_slot(root, record, manifest_bytes, config, source_configuration)
        raise
    record = _settle(root, record, expected["requestHash"])
    _cleanup_slot(root, record, manifest_bytes, config, source_configuration)
    footprint = index_storage_footprint(admitted.lease, file_bytes=limits["fileBytes"],
                                       aggregate_bytes=admitted.reserved_bytes)
    job = _job(record, expected["requestHash"])
    result["captureController"] = {"attempts": len(job["attempts"]), "attemptLimit": attempt_limit,
        "jobs": len(record["jobs"]), "jobLimit": job_limit,
        "reservedWallSeconds": len(job["attempts"])*limits["wallSeconds"],
        "reconciledInterruptedAttempts": reconciled,
        "recordSha256": hashlib.sha256(encode_capture_record(record)).hexdigest(),
        "scope": ("Pinned capture replay and atomic supplied observation; campaign membership/completion and country coverage require the scheduler."
                  if observation is not None else "Pinned capture replay only; no campaign observation/completion or country coverage.")}
    result["footprint"] = footprint
    return result
