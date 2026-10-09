"""Canonical bounded state machine for supervised registry startup attempts.

This module validates durable controller facts only. It performs no filesystem,
process, namespace, reservation or source-tooling operations.
"""
import json
import re

from index_binding import _nonfinite, _pairs

FORMAT = "feature-index-controller-v1"
FORMAT_V2 = "feature-index-controller-v2"
MAX_RECORD_BYTES = 64000
MAX_ATTEMPTS = 16
MIB = 1024 * 1024
MIN_AGGREGATE_BYTES = 17 * MIB + 65536
MAX_AGGREGATE_BYTES = 512 * MIB
MAX_INT = (1 << 63) - 1
MAX_WORKER_PID = 2147483647

_TOP = {"format", "namespace", "runtime", "toolingManifest",
        "sourceConfiguration", "limits", "attempts"}
_NAMESPACE = {"device", "inode", "lockDevice", "lockInode", "aggregateBytes"}
_RUNTIME = {"pythonVersion", "sqliteVersion", "pythonBytes", "pythonSha256"}
_PIN = {"bytes", "sha256"}
_LIMITS = {"cpuSeconds", "wallSeconds", "rssBytes", "attempts"}
_ATTEMPT = {"number", "phase", "workerPid", "snapshotDevice", "snapshotInode",
            "resultSha256"}
_ATTEMPT_V2 = _ATTEMPT | {"operation"}
_VERSION = re.compile(r"[0-9]{1,3}(?:\.[0-9]{1,3}){2}", re.ASCII)
_SHA256 = re.compile(r"[a-f0-9]{64}", re.ASCII)


def _object(value, fields, label):
    if type(value) is not dict or set(value) != fields:
        raise ValueError(f"{label} requires its exact fields")


def _integer(value, minimum, maximum, label):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f"{label} is outside its strict integer bound")


def _sha(value, label):
    if type(value) is not str or not _SHA256.fullmatch(value):
        raise ValueError(f"{label} requires a lowercase SHA-256")


def _pin(value, label):
    _object(value, _PIN, label)
    _integer(value["bytes"], 1, MAX_RECORD_BYTES, f"{label} bytes")
    _sha(value["sha256"], label)


def _operation(value):
    _object(value, {"kind", "binding"}, "controller operation")
    if type(value["kind"]) is not str:
        raise ValueError("controller operation kind must be a string")
    if value["kind"] == "startup":
        if value["binding"] is not None:
            raise ValueError("startup operation binding must be null")
        return {"kind": "startup", "binding": None}
    if value["kind"] == "admit":
        binding = value["binding"]
        _object(binding, _PIN, "admission binding")
        _integer(binding["bytes"], 1, 4096, "admission binding bytes")
        _sha(binding["sha256"], "admission binding")
        return {"kind": "admit", "binding": {"sha256": binding["sha256"], "bytes": binding["bytes"]}}
    raise ValueError("unsupported controller operation kind")


def _validate_attempt(attempt, expected_number, *, v2):
    _object(attempt, _ATTEMPT_V2 if v2 else _ATTEMPT, "controller attempt")
    if v2:
        _operation(attempt["operation"])
    _integer(attempt["number"], 1, MAX_ATTEMPTS, "attempt number")
    if attempt["number"] != expected_number:
        raise ValueError("controller attempt numbers must be contiguous and one-based")
    phase = attempt["phase"]
    if type(phase) is not str or phase not in {"prepared", "running", "terminal"}:
        raise ValueError("controller attempt phase is unsupported")
    pid = attempt["workerPid"]
    if pid is not None:
        _integer(pid, 3, MAX_WORKER_PID, "worker PID")
    device, inode = attempt["snapshotDevice"], attempt["snapshotInode"]
    if (device is None) != (inode is None):
        raise ValueError("snapshot device and inode must be recorded together")
    if device is not None:
        _integer(device, 0, MAX_INT, "snapshot device")
        _integer(inode, 1, MAX_INT, "snapshot inode")
    result = attempt["resultSha256"]
    if result is not None:
        _sha(result, "attempt result")
    if phase == "prepared":
        if pid is not None or result is not None:
            raise ValueError("prepared attempt cannot record a worker or result")
    elif phase == "running":
        if pid is None or device is None or result is not None:
            raise ValueError("running attempt requires worker and snapshot identity only")
    elif device is None or result is None:
        raise ValueError("terminal attempt requires snapshot identity and result digest")


def _validate(value):
    _object(value, _TOP, "controller record")
    if type(value["format"]) is not str or value["format"] not in {FORMAT, FORMAT_V2}:
        raise ValueError("unsupported controller record format")
    v2 = value["format"] == FORMAT_V2

    namespace = value["namespace"]
    _object(namespace, _NAMESPACE, "controller namespace")
    for key in ("device", "lockDevice"):
        _integer(namespace[key], 0, MAX_INT, f"namespace {key}")
    for key in ("inode", "lockInode"):
        _integer(namespace[key], 1, MAX_INT, f"namespace {key}")
    _integer(namespace["aggregateBytes"], MIN_AGGREGATE_BYTES,
             MAX_AGGREGATE_BYTES, "namespace aggregate bytes")

    runtime = value["runtime"]
    _object(runtime, _RUNTIME, "controller runtime")
    for key in ("pythonVersion", "sqliteVersion"):
        if type(runtime[key]) is not str or not _VERSION.fullmatch(runtime[key]):
            raise ValueError(f"runtime {key} must be a bounded dotted version")
    _integer(runtime["pythonBytes"], 1, 256 * MIB, "Python executable bytes")
    _sha(runtime["pythonSha256"], "Python executable")
    _pin(value["toolingManifest"], "tooling manifest")
    _pin(value["sourceConfiguration"], "source configuration")

    limits = value["limits"]
    _object(limits, _LIMITS, "controller limits")
    _integer(limits["cpuSeconds"], 1, 60, "CPU seconds")
    _integer(limits["wallSeconds"], 1, 60, "wall seconds")
    _integer(limits["rssBytes"], 64 * MIB, 512 * MIB, "RSS bytes")
    _integer(limits["attempts"], 1, MAX_ATTEMPTS, "attempt limit")

    attempts = value["attempts"]
    if type(attempts) is not list or len(attempts) > limits["attempts"]:
        raise ValueError("controller attempts exceed their immutable bound")
    for number, attempt in enumerate(attempts, 1):
        _validate_attempt(attempt, number, v2=v2)
        if number < len(attempts) and attempt["phase"] != "terminal":
            raise ValueError("every nonlast controller attempt must be terminal")


def encode_controller_record(value):
    """Validate and encode the unique canonical ASCII representation."""
    _validate(value)
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"),
                     ensure_ascii=True, allow_nan=False).encode("ascii") + b"\n"
    if len(raw) > MAX_RECORD_BYTES:
        raise ValueError("controller record exceeds its fixed byte bound")
    return raw


def decode_controller_record(raw):
    """Decode only bounded, duplicate-free canonical ASCII JSON with newline."""
    if type(raw) is not bytes or not 1 <= len(raw) <= MAX_RECORD_BYTES:
        raise ValueError("controller record requires bounded immutable bytes")
    try:
        value = json.loads(raw.decode("ascii"), object_pairs_hook=_pairs,
                           parse_constant=_nonfinite)
    except (UnicodeError, RecursionError) as error:
        raise ValueError("controller record encoding/depth is unsupported") from error
    if encode_controller_record(value) != raw:
        raise ValueError("controller record is not canonical")
    return value


def _clone(record):
    return decode_controller_record(encode_controller_record(record))


def start_attempt(record, operation=None):
    """Return a defensive copy with the next immutable-budget attempt prepared.

    V1 remains byte-compatible and has no operation field. V2 defaults to a
    startup operation; admission must be explicitly named and pinned.
    """
    result = _clone(record)
    attempts = result["attempts"]
    if attempts and attempts[-1]["phase"] != "terminal":
        raise ValueError("the last controller attempt is not terminal")
    if len(attempts) >= result["limits"]["attempts"]:
        raise ValueError("controller attempt budget is exhausted")
    attempt = {
        "number": len(attempts) + 1,
        "phase": "prepared",
        "workerPid": None,
        "snapshotDevice": None,
        "snapshotInode": None,
        "resultSha256": None,
    }
    if result["format"] == FORMAT:
        if operation is not None:
            raise ValueError("v1 controller records do not accept operation fields")
    else:
        selected = {"kind": "startup", "binding": None} if operation is None else _operation(operation)
        attempt["operation"] = selected
    attempts.append(attempt)
    return result


def snapshot_ready(record, device, inode):
    """Record the private snapshot identity for the current prepared attempt."""
    result = _clone(record)
    attempt = _last_attempt(result, "prepared")
    if attempt["snapshotDevice"] is not None or attempt["snapshotInode"] is not None:
        raise ValueError("snapshot identity is already fixed for this attempt")
    _integer(device, 0, MAX_INT, "snapshot device")
    _integer(inode, 1, MAX_INT, "snapshot inode")
    attempt["snapshotDevice"] = device
    attempt["snapshotInode"] = inode
    return result


def worker_started(record, pid):
    """Record the owned worker PID after its snapshot identity is durable."""
    result = _clone(record)
    attempt = _last_attempt(result, "prepared")
    if attempt["snapshotDevice"] is None or attempt["snapshotInode"] is None:
        raise ValueError("snapshot identity must be fixed before worker launch")
    if attempt["workerPid"] is not None:
        raise ValueError("worker PID is already fixed for this attempt")
    _integer(pid, 3, MAX_WORKER_PID, "worker PID")
    attempt["phase"] = "running"
    attempt["workerPid"] = pid
    return result


def finish_attempt(record, result_sha256):
    """Mark a prepared or running attempt terminal with its fixed result digest."""
    result = _clone(record)
    if not result["attempts"]:
        raise ValueError("there is no controller attempt to finish")
    attempt = result["attempts"][-1]
    if attempt["phase"] not in {"prepared", "running"}:
        raise ValueError("terminal controller attempt cannot be reused")
    if attempt["snapshotDevice"] is None or attempt["snapshotInode"] is None:
        raise ValueError("snapshot identity is required before terminal publication")
    _sha(result_sha256, "attempt result")
    attempt["phase"] = "terminal"
    attempt["resultSha256"] = result_sha256
    return result


def _last_attempt(record, required_phase):
    if not record["attempts"]:
        raise ValueError("there is no controller attempt")
    attempt = record["attempts"][-1]
    if attempt["phase"] != required_phase:
        raise ValueError(f"last controller attempt must be {required_phase}")
    return attempt
