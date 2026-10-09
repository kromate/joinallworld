"""Fixed private capture-attempt files, accounted inside the index reservation.

The caller holds both actual permanent leases and has a confirmed writer gap.
No SQL, PID signalling, cache deletion, journal reset or campaign completion.
"""
import hashlib
import json
from index_controller_state import read_private, _publish_bytes
from index_capture_record import encode_capture_record, decode_capture_record, MAX_RECORD_BYTES

RECORD = "capture.json"
PENDING = "capture.pending"
ANCHOR = "capture.anchor.json"
ANCHOR_PENDING = "capture.anchor.pending"
CONTROL_FILES = frozenset({RECORD, PENDING, ANCHOR, ANCHOR_PENDING})


def header(record):
    return {key: value for key, value in record.items() if key not in {"jobs", "current"}}


def anchor_bytes(record):
    raw = json.dumps(header(record), sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")
    return (json.dumps({"format": "feature-index-capture-anchor-v1", "headerSha256": hashlib.sha256(raw).hexdigest()},
                       sort_keys=True, separators=(",", ":")) + "\n").encode("ascii")


def read_record(root, expected_header):
    """Refuse lost initialized quota; partial deterministic writes remain intact."""
    try: record = decode_capture_record(read_private(root/RECORD, MAX_RECORD_BYTES))
    except FileNotFoundError: record = None
    if record is not None and header(record) != header(expected_header):
        raise ValueError("capture root or immutable attempt limits changed; preserve quota")
    expected_anchor = anchor_bytes(expected_header)
    try: anchor = read_private(root/ANCHOR, 4096)
    except FileNotFoundError: anchor = None
    try: staged = read_private(root/ANCHOR_PENDING, 4096)
    except FileNotFoundError: staged = None
    if anchor is not None and anchor != expected_anchor:
        raise ValueError("capture quota anchor differs; preserve state")
    if staged is not None and not expected_anchor.startswith(staged):
        raise ValueError("staged capture quota anchor differs; preserve state")
    if record is None:
        if anchor is not None or staged is not None:
            raise ValueError("initialized capture attempt record disappeared; preserve quota")
        return None
    if anchor is None:
        # The first record is published before its seal. Only this exact
        # unlaunched prefix is eligible to finish initialization.
        if (len(record["jobs"]) != 1 or len(record["jobs"][0]["attempts"]) != 1
                or record["jobs"][0]["attempts"][0]["phase"] != "prepared"
                or record["jobs"][0]["attempts"][0]["snapshotDevice"] is not None):
            raise ValueError("initialized capture quota anchor disappeared; preserve attempts")
    return record


def publish_record(root, record):
    _publish_bytes(root, encode_capture_record(record), RECORD, PENDING, MAX_RECORD_BYTES)


def seal_record(root, record):
    expected = anchor_bytes(record)
    try: existing = read_private(root/ANCHOR, 4096)
    except FileNotFoundError: existing = None
    if existing is not None and existing != expected:
        raise ValueError("capture quota seal changed; preserve state")
    if existing is None or (root/ANCHOR_PENDING).exists() or (root/ANCHOR_PENDING).is_symlink():
        _publish_bytes(root, expected, ANCHOR, ANCHOR_PENDING, 4096)


def settlement(record, request_hash):
    """Deterministic attempt settlement, never an attestation of index contents."""
    job = next(job for job in record["jobs"] if job["requestHash"] == request_hash)
    value = {"header": header(record), "job": job}
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")
    return hashlib.sha256(raw + b"capture-writer-gap-settlement-v1").hexdigest()
