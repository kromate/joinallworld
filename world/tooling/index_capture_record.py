"""Canonical bounded records for per-capture ingestion ownership.

This module validates durable facts only. It performs no filesystem, process,
index, or campaign-ledger operations. A terminal digest settles an attempt; it
does not prove that the capture or its campaign observation exists in the index.
"""
import json
import re

from index_binding import _nonfinite, _pairs

FORMAT = "feature-index-capture-controller-v1"
FORMAT_V2 = "feature-index-capture-controller-v2"
MAX_RECORD_BYTES = 512_000
MAX_JOBS = 256
MAX_ATTEMPTS = 8
MAX_INT = (1 << 63) - 1

_SHA256 = re.compile(r"[a-f0-9]{64}", re.ASCII)
_TOP = {"format", "index", "limits", "current", "jobs"}
_INDEX = {"indexHash", "rootDevice", "rootInode", "lockDevice", "lockInode"}
_LIMITS = {"attempts", "jobs"}
_JOB = {"requestHash", "input", "attempts"}
_INPUT = {"expected", "extractPath", "receiptPath"}
_PIN = {"sha256", "bytes"}
_ATTEMPT = {"number", "phase", "snapshotDevice", "snapshotInode", "resultSha256"}
_ATTEMPT_V2 = _ATTEMPT | {"observation"}


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
    _sha(value["sha256"], f"{label} SHA-256")
    _integer(value["bytes"], 1, 64_000, f"{label} bytes")


def _capture_path(value, label):
    if (type(value) is not str or not value or len(value) > 4096
            or not value.isascii() or "\x00" in value or "\\" in value
            or not value.startswith("/") or value == "/" or value.endswith("/")
            or "//" in value):
        raise ValueError(f"{label} must be a canonical lexical absolute POSIX path")
    if any(part in {"", ".", ".."} for part in value.split("/")[1:]):
        raise ValueError(f"{label} must be a canonical lexical absolute POSIX path")


def _validate_input(value):
    _object(value, _INPUT, "capture input")
    _pin(value["expected"], "capture expectation")
    _capture_path(value["extractPath"], "extract path")
    _capture_path(value["receiptPath"], "receipt path")


def _validate_attempt(attempt, expected_number, *, last, v2):
    _object(attempt, _ATTEMPT_V2 if v2 else _ATTEMPT, "capture attempt")
    if v2:
        observation = attempt["observation"]
        if observation is not None:
            _pin(observation, "capture observation")
            _integer(observation["bytes"], 1, 4096, "capture observation bytes")
    _integer(attempt["number"], 1, MAX_ATTEMPTS, "capture attempt number")
    if attempt["number"] != expected_number:
        raise ValueError("capture attempt numbers must be contiguous and one-based")
    phase = attempt["phase"]
    if type(phase) is not str or phase not in {"prepared", "terminal"}:
        raise ValueError("capture attempt phase is unsupported")
    device, inode = attempt["snapshotDevice"], attempt["snapshotInode"]
    if (device is None) != (inode is None):
        raise ValueError("snapshot device and inode must be recorded together")
    if device is not None:
        _integer(device, 0, MAX_INT, "snapshot device")
        _integer(inode, 1, MAX_INT, "snapshot inode")
    result = attempt["resultSha256"]
    if phase == "prepared":
        if result is not None or not last:
            raise ValueError("only the last capture attempt may be prepared, with no result")
    else:
        if device is None:
            raise ValueError("terminal capture attempt requires a fixed snapshot identity")
        _sha(result, "capture attempt result")


def _validate(value):
    _object(value, _TOP, "capture controller record")
    if type(value["format"]) is not str or value["format"] not in {FORMAT, FORMAT_V2}:
        raise ValueError("unsupported capture controller record format")
    v2 = value["format"] == FORMAT_V2

    index = value["index"]
    _object(index, _INDEX, "capture index identity")
    _sha(index["indexHash"], "index hash")
    for key in ("rootDevice", "lockDevice"):
        _integer(index[key], 0, MAX_INT, key)
    for key in ("rootInode", "lockInode"):
        _integer(index[key], 1, MAX_INT, key)

    limits = value["limits"]
    _object(limits, _LIMITS, "capture controller limits")
    _integer(limits["attempts"], 1, MAX_ATTEMPTS, "capture attempt limit")
    _integer(limits["jobs"], 1, MAX_JOBS, "capture job limit")

    jobs = value["jobs"]
    if type(jobs) is not list or len(jobs) > limits["jobs"]:
        raise ValueError("capture jobs exceed their immutable bound")
    previous_hash = None
    prepared_count = 0
    for job in jobs:
        _object(job, _JOB, "capture job")
        request_hash = job["requestHash"]
        _sha(request_hash, "capture request hash")
        if previous_hash is not None and request_hash <= previous_hash:
            raise ValueError("capture jobs must be unique and lexicographically sorted")
        previous_hash = request_hash
        _validate_input(job["input"])
        attempts = job["attempts"]
        if type(attempts) is not list or not 1 <= len(attempts) <= limits["attempts"]:
            raise ValueError("capture job attempts exceed their immutable bound")
        for number, attempt in enumerate(attempts, 1):
            _validate_attempt(attempt, number, last=number == len(attempts), v2=v2)
            if attempt["phase"] == "prepared":
                prepared_count += 1
                prepared_request = request_hash
    if prepared_count > 1:
        raise ValueError("at most one capture attempt may be prepared")
    current = value["current"]
    if not jobs:
        if current is not None:
            raise ValueError("empty capture record must not name a current job")
    else:
        _sha(current, "current capture request hash")
        if current not in {job["requestHash"] for job in jobs}:
            raise ValueError("current capture request must identify an existing job")
        if prepared_count and current != prepared_request:
            raise ValueError("prepared capture attempt must own the current execution slot")


def encode_capture_record(value):
    """Validate and encode the unique canonical ASCII representation."""
    _validate(value)
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"),
                     ensure_ascii=True, allow_nan=False).encode("ascii") + b"\n"
    if len(raw) > MAX_RECORD_BYTES:
        raise ValueError("capture controller record exceeds its fixed byte bound")
    return raw


def decode_capture_record(raw):
    """Decode only bounded, duplicate-free canonical ASCII JSON with newline."""
    if type(raw) is not bytes or not 1 <= len(raw) <= MAX_RECORD_BYTES:
        raise ValueError("capture controller record requires bounded immutable bytes")
    try:
        value = json.loads(raw.decode("ascii"), object_pairs_hook=_pairs,
                           parse_constant=_nonfinite)
    except (UnicodeError, RecursionError) as error:
        raise ValueError("capture controller record encoding/depth is unsupported") from error
    if encode_capture_record(value) != raw:
        raise ValueError("capture controller record is not canonical")
    return value


def settled_capture_observation_pins(raw):
    """Exact allowable pins from a decoded settled record, never required rows.

    Failed attempts may have pinned an observation absent from SQL. Deriving
    pins here neither opens SQLite nor establishes any campaign membership.
    """
    jobs = {}
    for job in decode_capture_record(raw)["jobs"]:
        attempts = job["attempts"]
        if any(attempt["phase"] != "terminal" for attempt in attempts):
            raise ValueError("unsettled capture attempt")
        pins = sorted({(attempt["observation"]["sha256"], attempt["observation"]["bytes"])
                       for attempt in attempts if attempt.get("observation") is not None})
        jobs[job["requestHash"]] = [{"sha256": digest, "bytes": size} for digest, size in pins]
    return jobs


def _clone(record):
    return decode_capture_record(encode_capture_record(record))


def _job(record, request_hash):
    _sha(request_hash, "capture request hash")
    for job in record["jobs"]:
        if job["requestHash"] == request_hash:
            return job
    raise ValueError("capture request has no durable job")


def _last_attempt(record, request_hash):
    job = _job(record, request_hash)
    return job, job["attempts"][-1]


def begin_capture(record, request_hash, input, observation=None):
    """Prepare one bounded attempt with immutable raw-input ownership pins."""
    result = _clone(record)
    _sha(request_hash, "capture request hash")
    _validate_input(input)
    if result["format"] == FORMAT and observation is not None:
        raise ValueError("v1 capture records do not accept campaign observation pins")
    if observation is not None:
        _pin(observation, "capture observation")
        _integer(observation["bytes"], 1, 4096, "capture observation bytes")
        frozen_observation = {"sha256": observation["sha256"], "bytes": observation["bytes"]}
    else:
        frozen_observation = None
    # Copy through canonical JSON so later caller mutation cannot alter the job.
    frozen_input = json.loads(json.dumps(input, sort_keys=True, separators=(",", ":"),
                                        ensure_ascii=True, allow_nan=False))
    if any(attempt["phase"] == "prepared" for job in result["jobs"] for attempt in job["attempts"]):
        raise ValueError("a capture attempt is already prepared")
    job = next((item for item in result["jobs"] if item["requestHash"] == request_hash), None)
    if job is None:
        if len(result["jobs"]) >= result["limits"]["jobs"]:
            raise ValueError("capture job budget is exhausted")
        job = {"requestHash": request_hash, "input": frozen_input, "attempts": []}
        result["jobs"].append(job)
        result["jobs"].sort(key=lambda item: item["requestHash"])
    elif job["input"] != frozen_input:
        raise ValueError("capture request already owns different immutable input pins")
    if len(job["attempts"]) >= result["limits"]["attempts"]:
        raise ValueError("capture attempt budget is exhausted")
    attempt = {
        "number": len(job["attempts"]) + 1,
        "phase": "prepared",
        "snapshotDevice": None,
        "snapshotInode": None,
        "resultSha256": None,
    }
    if result["format"] == FORMAT_V2:
        attempt["observation"] = frozen_observation
    job["attempts"].append(attempt)
    result["current"] = request_hash
    encode_capture_record(result)
    return result


def capture_snapshot_ready(record, request_hash, device, inode):
    """Fix the current prepared attempt's private execution snapshot identity."""
    result = _clone(record)
    _integer(device, 0, MAX_INT, "snapshot device")
    _integer(inode, 1, MAX_INT, "snapshot inode")
    if result["current"] != request_hash:
        raise ValueError("capture snapshot request does not own the current execution slot")
    _, attempt = _last_attempt(result, request_hash)
    if attempt["phase"] != "prepared":
        raise ValueError("last capture attempt must be prepared")
    if attempt["snapshotDevice"] is not None or attempt["snapshotInode"] is not None:
        raise ValueError("capture snapshot identity is already fixed")
    attempt["snapshotDevice"] = device
    attempt["snapshotInode"] = inode
    encode_capture_record(result)
    return result


def finish_capture(record, request_hash, result_sha256):
    """Settle a prepared attempt; the digest does not attest index success."""
    result = _clone(record)
    _sha(result_sha256, "capture attempt result")
    if result["current"] != request_hash:
        raise ValueError("capture settlement request does not own the current execution slot")
    _, attempt = _last_attempt(result, request_hash)
    if attempt["phase"] != "prepared":
        raise ValueError("terminal capture attempt cannot be reused")
    if attempt["snapshotDevice"] is None or attempt["snapshotInode"] is None:
        raise ValueError("capture snapshot identity is required before settlement")
    attempt["phase"] = "terminal"
    attempt["resultSha256"] = result_sha256
    encode_capture_record(result)
    return result
