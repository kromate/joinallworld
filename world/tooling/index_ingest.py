"""One bounded verified-capture ingestion into an externally charged index root.

No acquisition, observation, campaign completion or quota refund. Caller still
owns namespace admission and durable job/attempt fencing. Raw cache files are
readonly inputs, not copied into the index allowance. This is not a sandbox.
"""
from contextlib import contextmanager, nullcontext
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile

from index_binding import decode_index_binding, _pairs, _nonfinite
from index_binding_publish import publish_index_binding
from index_bootstrap import _node_pin
from index_execution_snapshot import verified_execution_snapshot, VerifiedIndexExecution, _identity, _pin, _capture, _inventory, CONFIGURATION
from index_tooling import verify_index_tooling
from index_resource_limits import _run_fixed_process, IndexWorkerUnreaped
from index_root import ChargedIndexRoot, _binding, _lease
from index_storage_footprint import index_storage_footprint

MIB = 1024*1024
EXTRACT_BYTES = 20_000_000
RECEIPT_BYTES = 1_000_000
ENVELOPE_BYTES = 64000


def _expected(value):
    if type(value) is not dict or set(value) != {"requestHash", "request", "extract", "receipt"}:
        raise ValueError("capture expectation requires exact fields")
    if type(value["requestHash"]) is not str or not re.fullmatch(r"[a-f0-9]{64}", value["requestHash"]):
        raise ValueError("capture request requires an exact SHA-256")
    if type(value["request"]) is not dict:
        raise ValueError("capture request must be an object")
    _pin(value["extract"], EXTRACT_BYTES, "extract")
    _pin(value["receipt"], RECEIPT_BYTES, "receipt")


def _verify_capture_file(descriptor, path, pin):
    info = os.fstat(descriptor)
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1
            or stat.S_IMODE(info.st_mode) & 0o022 or info.st_size != pin["bytes"]):
        raise ValueError("capture file is unsafe or differs from its pinned size")
    total = 0; digest = hashlib.sha256()
    while total <= pin["bytes"]:
        chunk = os.pread(descriptor, min(65536, pin["bytes"]-total+1), total)
        if not chunk: break
        total += len(chunk); digest.update(chunk)
    if (total != pin["bytes"] or digest.hexdigest() != pin["sha256"]
            or _identity(os.fstat(descriptor)) != _identity(info)
            or _identity(path.lstat()) != _identity(info) or path.resolve(strict=True) != path):
        raise ValueError("capture bytes/inode differ from their retained pin")
    return info


@contextmanager
def capture_descriptors(extract_path, receipt_path, expected):
    """Own three readonly descriptors; retain handles on unconfirmed worker exit.

    The tiny metadata file is unlinked after opening. Its actual allocated bytes
    are charged while live. A retained raw descriptor never authorizes deleting
    its cache path. The worker rereads and verifies hashes before SQL.
    """
    _expected(expected)
    descriptors = []; observed = []; metadata_path = None; preserve = False
    try:
        for supplied, pin in [(extract_path, expected["extract"]), (receipt_path, expected["receipt"])]:
            path = Path(supplied)
            if not path.is_absolute() or path.resolve(strict=True) != path:
                raise ValueError("capture path must be an existing canonical absolute path")
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            descriptors.append(descriptor)
            observed.append((descriptor, path, _verify_capture_file(descriptor, path, pin)))
        envelope = {"format": "feature-index-ingest-input-v1", "expected": expected,
                    "extractDescriptor": descriptors[0], "receiptDescriptor": descriptors[1]}
        try:
            raw = json.dumps(envelope, sort_keys=True, ensure_ascii=True, separators=(",", ":"),
                             allow_nan=False).encode("ascii")
        except (TypeError, RecursionError) as error:
            raise ValueError("capture envelope is not bounded JSON") from error
        if not 1 <= len(raw) <= ENVELOPE_BYTES:
            raise ValueError("capture envelope exceeds its byte bound")
        write_descriptor, name = tempfile.mkstemp(prefix="allworld-index-capture-")
        metadata_path = Path(name)
        try:
            os.fchmod(write_descriptor, 0o600)
            view = memoryview(raw)
            while view:
                written = os.write(write_descriptor, view)
                if written <= 0: raise OSError("short capture envelope write")
                view = view[written:]
            os.fsync(write_descriptor)
        finally:
            os.close(write_descriptor)
        descriptor = os.open(metadata_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        descriptors.append(descriptor)
        os.unlink(metadata_path); metadata_path = None
        info = os.fstat(descriptor)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 0
                or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size != len(raw)
                or os.pread(descriptor, ENVELOPE_BYTES+1, 0) != raw):
            raise ValueError("anonymous capture envelope differs from its verified bytes")
        configuration = {"metadataDescriptor": descriptor, "metadataSha256": hashlib.sha256(raw).hexdigest(),
                         "extractDescriptor": descriptors[0], "receiptDescriptor": descriptors[1]}
        charged = max(info.st_size, info.st_blocks*512)
        yield configuration, charged
        for descriptor, path, original in observed:
            if (_identity(os.fstat(descriptor)) != _identity(original)
                    or _identity(path.lstat()) != _identity(original) or path.resolve(strict=True) != path):
                raise ValueError("capture input changed during ingestion; preserve index state")
    except IndexWorkerUnreaped as error:
        preserve = True
        error.retained_capture_descriptors = tuple(descriptors)
        raise
    finally:
        if metadata_path is not None: os.unlink(metadata_path)
        if not preserve:
            for descriptor in reversed(descriptors): os.close(descriptor)


def ingest_index(admitted, repository_root, manifest_bytes, source_configuration, node,
                 extract_path, receipt_path, expected, *, _execution=None):
    """Ingest one pinned capture; successful return proves neither campaign coverage nor playability."""
    if type(admitted) is not ChargedIndexRoot:
        raise TypeError("capture ingestion requires its actual charged root")
    config = decode_index_binding(admitted.binding_bytes)
    root, _ = _lease(admitted.lease); namespace, _ = _lease(admitted.namespace_lease)
    if (root.parent != namespace or root.name != admitted.index_hash
            or hashlib.sha256(admitted.binding_bytes).hexdigest() != admitted.index_hash
            or config["reservedBytes"] != admitted.reserved_bytes):
        raise ValueError("capture ingestion root, paired namespace or allowance differs")
    _binding(root, admitted.binding_bytes)
    executable, runtime_before = _node_pin(node, config["runtime"])
    if _execution is not None:
        if (type(_execution) is not VerifiedIndexExecution or _execution.root != root/"capture.execution"
                or _execution.manifest_bytes != manifest_bytes or _execution.manifest_pin != config["toolingManifest"]
                or _execution.source_configuration != source_configuration
                or _execution.source_pin != config["source"]["configuration"]):
            raise ValueError("persistent capture execution differs from its fixed admitted slot/pins")
        verify_index_tooling(_execution.root, manifest_bytes, config["toolingManifest"])
        if (_capture(_execution.root, CONFIGURATION, config["source"]["configuration"]) != source_configuration
                or _inventory(_execution.root) != _execution.charged_bytes):
            raise ValueError("persistent capture execution bytes or charge changed")
    with capture_descriptors(extract_path, receipt_path, expected) as (capture, metadata_charged):
        with (nullcontext(_execution) if _execution is not None else verified_execution_snapshot(
                repository_root, manifest_bytes, config["toolingManifest"], source_configuration,
                config["source"]["configuration"])) as execution:
            limits = config["processLimits"]
            live_inputs = execution.charged_bytes+metadata_charged
            if 4*limits["fileBytes"]+live_inputs+2*MIB > admitted.reserved_bytes:
                raise ValueError("index allowance cannot hold sidecars, execution and capture envelope")
            # A persistent slot is already inventoried beneath this index root.
            # Only the anonymous envelope is external; do not double charge it.
            available = admitted.reserved_bytes-(metadata_charged if _execution is not None else live_inputs)
            index_storage_footprint(admitted.lease, file_bytes=limits["fileBytes"], aggregate_bytes=available)
            publish_index_binding(admitted)
            result = _run_fixed_process(executable, "index-capture-ingest", root,
                lease_descriptor=admitted.lease.descriptor, namespace_descriptor=admitted.namespace_lease.descriptor,
                execution_root=execution.root, capture_configuration=capture,
                file_bytes=limits["fileBytes"], cpu_seconds=limits["cpuSeconds"], wall_seconds=limits["wallSeconds"],
                heap_mib=limits["heapMiB"], rss_limit_bytes=limits["rssBytes"])
            _binding(root, admitted.binding_bytes); _lease(admitted.lease); _lease(admitted.namespace_lease)
            footprint = index_storage_footprint(admitted.lease, file_bytes=limits["fileBytes"], aggregate_bytes=available)
            _, runtime_after = _node_pin(executable, config["runtime"])
            if runtime_before != runtime_after:
                raise RuntimeError("Node runtime changed during ingestion; preserve state")
            if result["returnCode"] != 0 or result["reason"] != "exit":
                raise RuntimeError(f"fixed ingestion worker failed ({result['reason']}, {result['returnCode']}): {result['stderr'][:4096]}")
            report = json.loads(result["stdout"], object_pairs_hook=_pairs, parse_constant=_nonfinite)
            _report(report, admitted, config, capture["metadataSha256"], expected["requestHash"])
            return {"ingest": report, "guard": result, "footprint": footprint,
                    "executionSnapshotChargedBytes": execution.charged_bytes, "captureEnvelopeChargedBytes": metadata_charged}


def _report(report, admitted, config, input_hash, request_hash):
    if (type(report) is not dict or set(report) != {"format", "indexHash", "inputSha256", "nodeVersion", "sqliteVersion",
            "result", "stats", "databaseBytes", "maximumRssKiB"}
            or report["format"] != "feature-index-ingest-v1" or report["indexHash"] != admitted.index_hash
            or report["inputSha256"] != input_hash or report["nodeVersion"] != config["runtime"]["nodeVersion"]
            or report["sqliteVersion"] != config["runtime"]["sqliteVersion"]):
        raise ValueError("ingestion report differs from its exact admitted input/runtime/root")
    if (type(report["databaseBytes"]) is not int
            or report["databaseBytes"] != (admitted.lease.root/"features.sqlite").stat().st_size
            or type(report["maximumRssKiB"]) is not int
            or not 1 <= report["maximumRssKiB"]*1024 <= config["processLimits"]["rssBytes"]):
        raise ValueError("ingestion report differs from its physical state or peak RSS allowance")
    stats = report["stats"]
    if type(stats) is not dict or set(stats) != {"captures", "occurrences", "versions", "observations", "keys", "conflictedKeys"}:
        raise ValueError("ingestion stats require every engine counter")
    for key, value in stats.items():
        maximum = config["engineLimits"].get(key, config["engineLimits"]["versions"])
        if type(value) is not int or not 0 <= value <= maximum:
            raise ValueError("ingestion engine counter exceeds admitted bounds")
    outcome = report["result"]
    if (type(outcome) is not dict or set(outcome) != {"indexVersion", "requestHash", "captureHash", "features", "admitted",
            "exceptions", "dispositionsHash", "replayed", "insertedVersions", "observationHash"}
            or outcome["indexVersion"] != config["engineVersion"] or type(outcome["replayed"]) is not bool
            or outcome["observationHash"] is not None or outcome["requestHash"] != request_hash):
        raise ValueError("ingestion outcome requires exact capture fields and no campaign observation")
    for key in ["requestHash", "captureHash", "dispositionsHash"]:
        if type(outcome[key]) is not str or not re.fullmatch(r"[a-f0-9]{64}", outcome[key]):
            raise ValueError("ingestion outcome requires exact hashes")
    for key in ["features", "admitted", "insertedVersions"]:
        if type(outcome[key]) is not int or not 0 <= outcome[key] <= config["engineLimits"]["occurrences"]:
            raise ValueError("ingestion outcome count exceeds admitted bounds")
    exceptions = outcome["exceptions"]
    if (type(exceptions) is not dict or len(exceptions) > 32
            or any(type(key) is not str or not 1 <= len(key) <= 128 or type(value) is not int or value < 1
                   for key, value in exceptions.items())
            or outcome["admitted"]+sum(exceptions.values()) != outcome["features"]
            or outcome["insertedVersions"] > outcome["admitted"]
            or outcome["insertedVersions"] > config["engineLimits"]["versions"]
            or (outcome["replayed"] and outcome["insertedVersions"] != 0)):
        raise ValueError("ingestion outcome does not conserve its original ordinals")
