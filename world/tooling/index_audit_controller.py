"""Bounded raw/index audit through an owned, read-only DB/WAL snapshot.

Caller holds the actual paired namespace and child writer leases throughout.
Unconfirmed workers poison the lease and preserve descriptors, state and slots.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile
import weakref

from index_binding import decode_index_binding, _pairs, _nonfinite
from index_bootstrap import _node_pin
from index_capture_controller import _POISONED_LEASES
from index_capture_record import decode_capture_record
from index_capture_snapshot import (
    CAPTURE_EXECUTION, CAPTURE_RECLAIM, capture_execution_footprint,
    capture_snapshot, cleanup_capture_snapshot, copy_capture_snapshot,
)
from index_capture_state import (
    ANCHOR, ANCHOR_PENDING, PENDING, RECORD, anchor_bytes,
    header as capture_header, read_record as read_capture_record,
)
from index_controller_state import identity, read_private, _publish_bytes
from index_execution_snapshot import CONFIGURATION, _capture, _identity
from index_ingest import _expected, _verify_capture_file, observation_pin
from index_resource_limits import IndexWorkerUnreaped, _run_fixed_process
from index_root import ChargedIndexRoot, _binding, _lease
from index_storage_footprint import index_storage_footprint
from index_tooling import decode_tooling_manifest, verify_index_tooling, source_snapshot_allowance

FORMAT = "feature-index-audit-controller-v1"
AUDIT_EXECUTION = "audit.execution"
AUDIT_RECLAIM = "audit.reclaim"
AUDIT_RECORD = "audit.json"
AUDIT_PENDING = "audit.pending"
AUDIT_ANCHOR = "audit.anchor.json"
AUDIT_ANCHOR_PENDING = "audit.anchor.pending"
AUDIT_RESULT = "audit.result.json"
MAX_RECORD = 64_000
MAX_ENVELOPE = 512_000
MAX_RESULT = 8_192
MIB = 1024 * 1024
_SHA = re.compile(r"[a-f0-9]{64}", re.ASCII)
_POISONED = weakref.WeakValueDictionary()


def _json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
                      allow_nan=False).encode("ascii")


def _result_bytes(index_hash, attempt, envelope_hash, report, guard):
    header = f"feature-index-audit-result-v1\n{index_hash}\n{attempt}\n{envelope_hash}\n".encode("ascii")
    payload = _json({"guard": guard, "report": report})
    raw = header + base64.b64encode(payload) + b"\n"
    if len(raw) > MAX_RESULT:
        raise ValueError("audit report witness exceeds its 8192-byte bound")
    return raw


def _result_prefix(raw, index_hash, attempt, envelope_hash):
    """Recognize only an exact immutable header and a syntactic Base64 prefix."""
    if type(raw) is not bytes or len(raw) > MAX_RESULT:
        return False
    header = f"feature-index-audit-result-v1\n{index_hash}\n{attempt}\n{envelope_hash}\n".encode("ascii")
    if len(raw) <= len(header):
        return header.startswith(raw)
    if not raw.startswith(header):
        return False
    tail = raw[len(header):]
    if tail.endswith(b"\n"):
        try:
            _decode_result(raw, index_hash, attempt, envelope_hash)
            return True
        except (ValueError, TypeError):
            return False
    if any(byte not in b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=" for byte in tail):
        return False
    base = tail.rstrip(b"=")
    padding = len(tail) - len(base)
    if b"=" in base:
        return False
    if padding > 2 or (padding and len(base) % 4 not in (2, 3)):
        return False
    if padding == 2 and len(base) % 4 != 2:
        return False
    return True


def _decode_result(raw, index_hash, attempt, envelope_hash):
    if type(raw) is not bytes or not raw.endswith(b"\n") or not _result_prefix_header(raw, index_hash, attempt, envelope_hash):
        raise ValueError("audit report witness header differs")
    header = f"feature-index-audit-result-v1\n{index_hash}\n{attempt}\n{envelope_hash}\n".encode("ascii")
    encoded = raw[len(header):-1]
    try:
        payload_raw = base64.b64decode(encoded, validate=True)
        payload = json.loads(payload_raw.decode("ascii"), object_pairs_hook=_pairs, parse_constant=_nonfinite)
    except (ValueError, UnicodeError, RecursionError) as error:
        raise ValueError("audit report witness payload is invalid") from error
    if (base64.b64encode(payload_raw) != encoded or _json(payload) != payload_raw
            or type(payload) is not dict or set(payload) != {"guard", "report"}
            or type(payload["report"]) is not dict or type(payload["guard"]) is not dict
            or set(payload["guard"]) != {"returnCode", "reason", "maximumObservedWorkerRssBytes",
                "inheritedLease", "inheritedNamespaceLease"}
            or type(payload["guard"]["returnCode"]) is not int
            or payload["guard"]["returnCode"] != 0 or payload["guard"]["reason"] != "exit"
            or type(payload["guard"]["maximumObservedWorkerRssBytes"]) is not int
            or payload["guard"]["maximumObservedWorkerRssBytes"] < 0
            or payload["guard"]["inheritedLease"] is not True
            or payload["guard"]["inheritedNamespaceLease"] is not True):
        raise ValueError("audit report witness is not exact canonical data")
    return payload


def _result_prefix_header(raw, index_hash, attempt, envelope_hash):
    header = f"feature-index-audit-result-v1\n{index_hash}\n{attempt}\n{envelope_hash}\n".encode("ascii")
    return raw.startswith(header)


def _present(path):
    return path.exists() or path.is_symlink()


def _pin(value, label, maximum, minimum=1):
    if (type(value) is not dict or set(value) != {"sha256", "bytes"}
            or type(value["sha256"]) is not str or not _SHA.fullmatch(value["sha256"])
            or type(value["bytes"]) is not int or not minimum <= value["bytes"] <= maximum):
        raise ValueError(f"{label} requires a bounded exact SHA-256 pin")
    return {"sha256": value["sha256"], "bytes": value["bytes"]}


def _hash_private(path, maximum, modes=(0o400, 0o600)):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid()
                or before.st_nlink != 1 or stat.S_IMODE(before.st_mode) not in modes
                or not 0 <= before.st_size <= maximum):
            raise ValueError("audit file is unsafe or exceeds its byte bound")
        digest = hashlib.sha256()
        total = 0
        while total <= before.st_size:
            chunk = os.read(fd, min(65536, before.st_size-total+1))
            if not chunk:
                break
            total += len(chunk)
            digest.update(chunk)
        after = os.fstat(fd)
        named = path.lstat()
        if (total != before.st_size or identity(after) != identity(before)
                or identity(named) != identity(before) or path.resolve(strict=True) != path):
            raise ValueError("audit file changed while being hashed")
        return {"sha256": digest.hexdigest(), "bytes": total}, before
    finally:
        os.close(fd)


def _copy_file(source, destination, maximum, *, allow_empty=False):
    """Resume a stable source into an exact 0600 destination prefix."""
    source = Path(source)
    destination = Path(destination)
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    out = None
    parent_fd = None
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid()
                or before.st_nlink != 1 or stat.S_IMODE(before.st_mode) != 0o600
                or not (0 if allow_empty else 1) <= before.st_size <= maximum):
            raise ValueError("retained database sidecar is unsafe or too large")
        parent_fd = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            out = os.open(destination.name, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                          0o600, dir_fd=parent_fd)
        except FileExistsError:
            out = os.open(destination.name, os.O_RDWR | os.O_APPEND | os.O_NOFOLLOW, dir_fd=parent_fd)
        old = os.fstat(out)
        if (not stat.S_ISREG(old.st_mode) or old.st_uid != os.getuid() or old.st_nlink != 1
                or stat.S_IMODE(old.st_mode) != 0o600 or not 0 <= old.st_size <= before.st_size
                or identity(os.stat(destination.name, dir_fd=parent_fd, follow_symlinks=False)) != identity(old)):
            raise ValueError("audit DB/WAL destination prefix is unsafe")
        digest = hashlib.sha256()
        total = 0
        while total < old.st_size:
            count = min(65536, old.st_size-total)
            source_prefix = os.pread(fd, count, total)
            target_prefix = os.pread(out, count, total)
            if len(source_prefix) != count or target_prefix != source_prefix:
                raise ValueError("audit DB/WAL snapshot prefix contradicts pinned source")
            total += count
            digest.update(source_prefix)
        os.lseek(fd, old.st_size, os.SEEK_SET)
        while total < before.st_size:
            chunk = os.read(fd, min(65536, before.st_size-total))
            if not chunk:
                break
            total += len(chunk)
            digest.update(chunk)
            view = memoryview(chunk)
            while view:
                n = os.write(out, view)
                if n <= 0:
                    raise OSError("short audit snapshot write")
                view = view[n:]
        if total != before.st_size:
            raise ValueError("retained DB/WAL changed during its snapshot copy")
        os.fchmod(out, 0o600)
        os.fsync(out)
        os.fsync(parent_fd)
        if (identity(os.fstat(fd)) != identity(before) or identity(source.lstat()) != identity(before)
                or os.fstat(out).st_size != before.st_size):
            raise ValueError("retained DB/WAL changed during its snapshot copy")
        return {"sha256": digest.hexdigest(), "bytes": total}, before
    finally:
        if out is not None:
            os.close(out)
        if parent_fd is not None:
            os.close(parent_fd)
        os.close(fd)


def _complete_execution_snapshot(outer, repository, manifest_bytes, manifest_pin,
                                  manifest, configuration, source_pin,
                                  database_pin, wal_pin, file_bytes, aggregate, root,
                                  launch_prepared=False):
    """Resume only byte-identical owned prefixes into one complete fixed slot."""
    source_reclaim = outer/CAPTURE_RECLAIM
    if _present(source_reclaim):
        # Reclaim begins only after a confirmed terminal worker or a fresh paired
        # lease writer gap. Resume that exact nested cleanup rather than rebuilding.
        info = source_reclaim.lstat()
        cleanup_capture_snapshot(outer, {"phase": "terminal", "snapshotDevice": info.st_dev,
            "snapshotInode": info.st_ino}, manifest_bytes, manifest_pin, configuration, source_pin)
        source_root = copy_capture_snapshot(outer, repository, manifest, configuration, source_pin)
    else:
        try:
            capture_snapshot(outer, manifest_bytes, manifest_pin, configuration, source_pin)
            source_root = outer/CAPTURE_EXECUTION
        except (FileNotFoundError, ValueError):
            source_root = copy_capture_snapshot(outer, repository, manifest, configuration, source_pin)
    actual_db, _ = _copy_file(root/"features.sqlite", outer/"features.sqlite",
                              database_pin["bytes"])
    if actual_db != database_pin:
        raise ValueError("audit database snapshot differs from its durable pin")
    source_wal = root/"features.sqlite-wal"
    target_wal = outer/"features.sqlite-wal"
    if wal_pin is None:
        if _present(target_wal):
            if not launch_prepared or _hash_private(target_wal, file_bytes, modes=(0o600,))[0] != {
                    "sha256": hashlib.sha256(b"").hexdigest(), "bytes": 0}:
                raise ValueError("unowned/nonempty audit WAL snapshot is preserved")
    else:
        if not _present(source_wal):
            raise ValueError("original WAL for the durable audit pin disappeared")
        actual_wal, _ = _copy_file(source_wal, target_wal, file_bytes, allow_empty=True)
        if actual_wal != wal_pin:
            raise ValueError("audit WAL snapshot differs from its durable pin")
    if _present(outer/"features.sqlite-journal"):
        raise ValueError("unexpected audit rollback journal is preserved")
    if source_root is not None:
        capture_snapshot(outer, manifest_bytes, manifest_pin, configuration, source_pin)
    _snapshot_footprint(root, file_bytes, aggregate)
    return source_root


def _record_validate(value):
    fields = {"format", "index", "limits", "input", "attempts"}
    if type(value) is not dict or set(value) != fields or value["format"] != FORMAT:
        raise ValueError("audit record has an unsupported exact shape")
    index = value["index"]
    if type(index) is not dict or set(index) != {"indexHash", "rootDevice", "rootInode", "lockDevice", "lockInode"}:
        raise ValueError("audit index identity is malformed")
    if type(index["indexHash"]) is not str or not _SHA.fullmatch(index["indexHash"]):
        raise ValueError("audit index hash is malformed")
    for key in ("rootDevice", "lockDevice", "rootInode", "lockInode"):
        minimum = 1 if key.endswith("Inode") else 0
        if type(index[key]) is not int or index[key] < minimum:
            raise ValueError("audit root/lock identity is malformed")
    if (type(value["limits"]) is not dict or set(value["limits"]) != {"attempts"}
            or type(value["limits"]["attempts"]) is not int or not 1 <= value["limits"]["attempts"] <= 8):
        raise ValueError("audit retry limit is malformed")
    if type(value["input"]) is not dict or set(value["input"]) != {
            "captureRecordSha256", "captureRecordBytes", "captureSetSha256",
            "requiredObservationsSha256", "auditInputSha256", "originalStateSha256"}:
        raise ValueError("audit input identity is malformed")
    for key in ("captureRecordSha256", "captureSetSha256", "requiredObservationsSha256",
                "auditInputSha256", "originalStateSha256"):
        if type(value["input"][key]) is not str or not _SHA.fullmatch(value["input"][key]):
            raise ValueError("audit input digest is malformed")
    if type(value["input"]["captureRecordBytes"]) is not int or not 1 <= value["input"]["captureRecordBytes"] <= 512_000:
        raise ValueError("capture record byte pin is malformed")
    attempts = value["attempts"]
    if type(attempts) is not list or len(attempts) > value["limits"]["attempts"]:
        raise ValueError("audit attempts exceed their fixed bound")
    for number, attempt in enumerate(attempts, 1):
        if type(attempt) is not dict or set(attempt) != {
                "number", "phase", "snapshotDevice", "snapshotInode", "inputSha256",
                "snapshotDatabase", "snapshotWal", "resultSha256", "report", "guard", "launchPrepared"}:
            raise ValueError("audit attempt has an unsupported shape")
        if type(attempt["number"]) is not int or attempt["number"] != number:
            raise ValueError("audit attempts must be contiguous")
        if attempt["phase"] not in {"prepared", "reporting", "terminal"}:
            raise ValueError("audit attempt phase is unsupported")
        if type(attempt["launchPrepared"]) is not bool:
            raise ValueError("audit worker launch-intent witness is malformed")
        if type(attempt["inputSha256"]) is not str or not _SHA.fullmatch(attempt["inputSha256"]):
            raise ValueError("audit attempt input hash is malformed")
        device, inode = attempt["snapshotDevice"], attempt["snapshotInode"]
        if ((device is None) != (inode is None) or
                (device is not None and (type(device) is not int or device < 0
                 or type(inode) is not int or inode < 1))):
            raise ValueError("audit snapshot identity is malformed")
        for pin_name in ("snapshotDatabase", "snapshotWal"):
            if attempt[pin_name] is not None:
                _pin(attempt[pin_name], "audit snapshot " + pin_name, 64*MIB,
                     0 if pin_name == "snapshotWal" else 1)
        if attempt["phase"] in {"prepared", "reporting"}:
            if (attempt["resultSha256"] is not None or attempt["report"] is not None
                    or attempt["guard"] is not None or number != len(attempts)):
                raise ValueError("only the last nonterminal audit attempt may be prepared")
            if attempt["phase"] == "reporting" and not attempt["launchPrepared"]:
                raise ValueError("reporting attempt lacks a durable worker-launch intent")
        else:
            if type(attempt["resultSha256"]) is not str or not _SHA.fullmatch(attempt["resultSha256"]):
                raise ValueError("terminal audit attempt lacks its result identity")
            if attempt["report"] is None:
                if attempt["guard"] is not None:
                    raise ValueError("failed audit attempt cannot retain a success guard")
            elif (type(attempt["report"]) is not dict or type(attempt["guard"]) is not dict
                    or not attempt["launchPrepared"]
                    or set(attempt["guard"]) != {"returnCode", "reason", "maximumObservedWorkerRssBytes",
                        "inheritedLease", "inheritedNamespaceLease"}
                    or hashlib.sha256(_json(attempt["report"])).hexdigest() != attempt["resultSha256"]):
                raise ValueError("successful audit attempt report/guard witness differs")
            else:
                guard = attempt["guard"]
                if (type(guard["returnCode"]) is not int or guard["returnCode"] != 0
                        or guard["reason"] != "exit"
                        or type(guard["maximumObservedWorkerRssBytes"]) is not int
                        or guard["maximumObservedWorkerRssBytes"] < 0
                        or guard["inheritedLease"] is not True
                        or guard["inheritedNamespaceLease"] is not True):
                    raise ValueError("successful audit attempt lacks terminal process evidence")


def _encode_record(value):
    _record_validate(value)
    raw = _json(value) + b"\n"
    if len(raw) > MAX_RECORD:
        raise ValueError("audit record exceeds its 64000-byte bound")
    return raw


def _decode_record(raw):
    if type(raw) is not bytes or not 1 <= len(raw) <= MAX_RECORD:
        raise ValueError("audit record is outside its fixed bound")
    try:
        value = json.loads(raw.decode("ascii"), object_pairs_hook=_pairs, parse_constant=_nonfinite)
    except (UnicodeError, RecursionError) as error:
        raise ValueError("audit record JSON is invalid") from error
    _record_validate(value)
    if _encode_record(value) != raw:
        raise ValueError("audit record is not canonical")
    return value


def _anchor(value):
    identity = {key: value[key] for key in ("index", "limits", "input")}
    return _json({"format": FORMAT + "-anchor", "headerSha256": hashlib.sha256(_json(identity)).hexdigest()}) + b"\n"


def _publish_record(root, value):
    _publish_bytes(root, _encode_record(value), AUDIT_RECORD, AUDIT_PENDING, MAX_RECORD)


def _read_record(root, expected, original_state=None, canonical_captures=None):
    try:
        raw = read_private(root/AUDIT_RECORD, MAX_RECORD)
    except FileNotFoundError:
        raw = None
    try:
        pending = read_private(root/AUDIT_PENDING, MAX_RECORD)
    except FileNotFoundError:
        pending = None
    try:
        staged_anchor = read_private(root/AUDIT_ANCHOR_PENDING, 4096)
    except FileNotFoundError:
        staged_anchor = None
    try:
        anchor = read_private(root/AUDIT_ANCHOR, 4096)
    except FileNotFoundError:
        anchor = None
    if raw is None:
        if anchor is not None or staged_anchor is not None:
            raise ValueError("audit record disappeared after initialization")
        if pending is not None and not _encode_record(expected).startswith(pending):
            raise ValueError("staged audit record differs from expected initialization")
        return None
    value = _decode_record(raw)
    if value != expected:
        # attempts are mutable; compare immutable record identity separately.
        if any(value[key] != expected[key] for key in ("format", "index", "limits", "input")):
            raise ValueError("audit input or attempt limit changed; preserve quota")
        expected.clear()
        expected.update(value)
    expected_anchor = _anchor(value)
    if anchor is not None and anchor != expected_anchor:
        raise ValueError("audit immutable anchor differs")
    if anchor is None and staged_anchor is None and value["attempts"]:
        raise ValueError("initialized audit anchor disappeared after charged attempts")
    if staged_anchor is not None and not expected_anchor.startswith(staged_anchor):
        raise ValueError("staged audit anchor differs")
    if value["attempts"] and value["attempts"][-1]["phase"] == "reporting":
        last = value["attempts"][-1]
        result_path = root/AUDIT_RESULT
        if _present(result_path):
            result_raw = read_private(result_path, MAX_RESULT)
            _decode_result(result_raw, value["index"]["indexHash"], last["number"], last["inputSha256"])
            if pending is not None:
                # The report witness makes a partially published terminal record
                # reconstructible; the caller validates the report before finishing it.
                return value
        elif pending is not None:
            interrupted = json.loads(_encode_record(value).decode("ascii"))
            interrupted_last = interrupted["attempts"][-1]
            interrupted_last["phase"] = "terminal"
            interrupted_last["resultSha256"] = hashlib.sha256(
                b"confirmed-writer-gap-interrupted-audit-v1").hexdigest()
            interrupted_last["report"] = None; interrupted_last["guard"] = None
            if _encode_record(interrupted).startswith(pending):
                _publish_record(root, interrupted)
                return interrupted
            if not _result_prefix(pending, value["index"]["indexHash"], last["number"], last["inputSha256"]):
                raise ValueError("staged reporting bytes match neither its result witness nor a terminal record")
            if pending.endswith(b"\n"):
                directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                try:
                    if _present(result_path):
                        raise ValueError("audit result witness destination already exists")
                    os.rename(AUDIT_PENDING, AUDIT_RESULT, src_dir_fd=directory, dst_dir_fd=directory)
                    os.fsync(directory)
                finally:
                    os.close(directory)
        return value
    if pending is not None:
        # A controller can die after publishing the bounded prepared-attempt
        # prefix. Reconstruct only that one deterministic next transition.
        candidate = json.loads(_encode_record(value).decode("ascii"))
        if (not candidate["attempts"] or candidate["attempts"][-1]["phase"] != "prepared"):
            if len(candidate["attempts"]) >= candidate["limits"]["attempts"]:
                raise ValueError("staged audit update exceeds its immutable retry limit")
            database_pin = None if original_state is None else original_state["features.sqlite"]["pin"]
            wal_pin = (None if original_state is None or original_state["features.sqlite-wal"] is None
                       else original_state["features.sqlite-wal"]["pin"])
            candidate["attempts"].append({"number": len(candidate["attempts"])+1,
                "phase": "prepared", "snapshotDevice": None, "snapshotInode": None,
                "inputSha256": candidate["input"]["auditInputSha256"],
                "snapshotDatabase": database_pin, "snapshotWal": wal_pin, "resultSha256": None,
                "report": None, "guard": None, "launchPrepared": False})
        candidates = [candidate]
        slot = root/AUDIT_EXECUTION
        if candidate["attempts"] and _present(slot):
            info = slot.lstat()
            last = candidate["attempts"][-1]
            if (stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
                    and stat.S_IMODE(info.st_mode) == 0o700 and slot.resolve(strict=True) == slot
                    and last["phase"] == "prepared"
                    and (last["snapshotDevice"] is None or
                         (info.st_dev, info.st_ino) == (last["snapshotDevice"], last["snapshotInode"]))):
                identified = json.loads(_encode_record(candidate).decode("ascii"))
                last_i = identified["attempts"][-1]
                if last_i["snapshotDevice"] is None:
                    last_i["snapshotDevice"], last_i["snapshotInode"] = info.st_dev, info.st_ino
                    candidates.append(identified)
                current = candidates[-1]
                last_i = current["attempts"][-1]
                if last_i["snapshotDatabase"] is not None and canonical_captures is not None:
                    envelope = {"format": "feature-index-audit-input-v1",
                        "indexHash": current["index"]["indexHash"],
                        "captureRecord": {"sha256": current["input"]["captureRecordSha256"],
                                          "bytes": current["input"]["captureRecordBytes"]},
                        "snapshotRoot": {"path": str(slot), "device": info.st_dev, "inode": info.st_ino},
                        "database": last_i["snapshotDatabase"], "wal": last_i["snapshotWal"],
                        "captures": canonical_captures}
                    envelope_hash = hashlib.sha256(_json(envelope)).hexdigest()
                    hashed = json.loads(_encode_record(current).decode("ascii"))
                    hashed["attempts"][-1]["inputSha256"] = envelope_hash
                    if last_i["inputSha256"] != envelope_hash:
                        candidates.append(hashed)
                    launch_ready = json.loads(_encode_record(hashed).decode("ascii"))
                    launch_ready["attempts"][-1]["launchPrepared"] = True
                    candidates.append(launch_ready)
                    reporting = json.loads(_encode_record(launch_ready).decode("ascii"))
                    reporting["attempts"][-1]["phase"] = "reporting"
                    candidates.append(reporting)
        for prepared in tuple(candidates):
            if prepared["attempts"] and prepared["attempts"][-1]["phase"] == "prepared":
                for marker in (b"confirmed-writer-gap-interrupted-audit-v1",
                               b"audit-worker-confirmed-terminal-failure-v1"):
                    terminal = json.loads(_encode_record(prepared).decode("ascii"))
                    last = terminal["attempts"][-1]
                    last["phase"] = "terminal"
                    last["resultSha256"] = hashlib.sha256(marker).hexdigest()
                    last["report"] = None; last["guard"] = None
                    candidates.append(terminal)
        for candidate in candidates:
            if _encode_record(candidate).startswith(pending):
                _publish_record(root, candidate)
                return candidate
        # A fully written terminal record is independently canonical and keeps
        # the immutable tuple. Its digest is only settlement evidence.
        try:
            staged = _decode_record(pending)
        except (ValueError, TypeError):
            staged = None
        if (staged is not None and
                all(staged[key] == value[key] for key in ("format", "index", "limits", "input"))
                and len(staged["attempts"]) == len(value["attempts"])
                and staged["attempts"][:-1] == value["attempts"][:-1]
                and value["attempts"] and value["attempts"][-1]["phase"] == "prepared"
                and staged["attempts"][-1]["phase"] == "terminal"):
            _publish_record(root, staged)
            return staged
        raise ValueError("staged audit state is not a recoverable deterministic prefix")
    return value


def _seal(root, value):
    _publish_bytes(root, _anchor(value), AUDIT_ANCHOR, AUDIT_ANCHOR_PENDING, 4096)


def _unlink_named(root, name):
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.unlink(name, dir_fd=directory)
        os.fsync(directory)
    finally:
        os.close(directory)


def _result_payload(root, attempt, index_hash):
    raw = read_private(root/AUDIT_RESULT, MAX_RESULT)
    return _decode_result(raw, index_hash, attempt["number"], attempt["inputSha256"])


def _remove_result(root, attempt, index_hash):
    try:
        payload = _result_payload(root, attempt, index_hash)
    except FileNotFoundError:
        return
    if (attempt["phase"] != "terminal" or attempt["report"] != payload["report"]
            or attempt["guard"] != payload["guard"]
            or attempt["resultSha256"] != hashlib.sha256(_json(payload["report"])).hexdigest()):
        raise ValueError("audit result witness differs from its durable terminal report")
    _unlink_named(root, AUDIT_RESULT)


def _raw_capture_descriptors(captures):
    observed = []
    for item in captures:
        expected = item["expected"]
        for supplied, pin in ((item["extractPath"], expected["extract"]),
                              (item["receiptPath"], expected["receipt"])):
            path = Path(supplied)
            if not path.is_absolute() or path.resolve(strict=True) != path:
                raise ValueError("raw input path must be canonical and absolute")
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            try:
                info = _verify_capture_file(fd, path, pin)
                observed.append((path, pin, _identity(info)))
            finally:
                os.close(fd)
    return observed


def _verify_raw(opened):
    for path, pin, expected_identity in opened:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            info = _verify_capture_file(fd, path, pin)
            if _identity(info) != expected_identity or _identity(path.lstat()) != expected_identity:
                raise ValueError("raw capture changed during audit")
        finally:
            os.close(fd)


def _capture_set(record, captures):
    if type(captures) is not list or not 1 <= len(captures) <= 256 or len(captures) != len(record["jobs"]):
        raise ValueError("audit requires the complete bounded durable capture set")
    durable = {job["requestHash"]: job for job in record["jobs"]}
    output = []
    last = None
    for item in captures:
        fields = {"extractPath", "receiptPath", "expected", "requiredObservations", "allowedObservationPins"}
        if type(item) is not dict or set(item) != fields:
            raise ValueError("audit capture requires its exact frozen fields")
        expected = item["expected"]
        _expected(expected)
        request_hash = expected["requestHash"]
        if last is not None and request_hash <= last:
            raise ValueError("audit captures must be sorted and unique by request hash")
        last = request_hash
        job = durable.get(request_hash)
        if job is None:
            raise ValueError("audit capture is absent from the durable capture record")
        extract_path, receipt_path = str(item["extractPath"]), str(item["receiptPath"])
        if (extract_path != job["input"]["extractPath"] or receipt_path != job["input"]["receiptPath"]):
            raise ValueError("audit raw paths differ from durable immutable membership")
        expected_raw = _json(expected)
        if {"sha256": hashlib.sha256(expected_raw).hexdigest(), "bytes": len(expected_raw)} != job["input"]["expected"]:
            raise ValueError("audit expectation differs from durable pin")

        historical = set()
        for attempt in job["attempts"]:
            obs = attempt.get("observation")
            if obs is not None:
                historical.add((obs["sha256"], obs["bytes"]))
        allowed = item["allowedObservationPins"]
        if type(allowed) is not list or len(allowed) > 8:
            raise ValueError("allowed historical observations exceed their fixed bound")
        normalized_allowed = [_pin(pin, "allowed observation", 4096) for pin in allowed]
        normalized_allowed.sort(key=lambda pin: (pin["sha256"], pin["bytes"]))
        allowed_pairs = [(pin["sha256"], pin["bytes"]) for pin in normalized_allowed]
        if len(set(allowed_pairs)) != len(allowed_pairs) or set(allowed_pairs) != historical:
            raise ValueError("allowed pins must equal distinct durable attempt pins")

        required = item["requiredObservations"]
        if type(required) is not list or len(required) > 8:
            raise ValueError("required observation contexts exceed their fixed bound")
        contexts = []
        required_pairs = []
        for context in required:
            if type(context) is not dict:
                raise ValueError("required observation context must be an object")
            frozen = dict(context)
            pin = observation_pin(frozen)
            if pin is None or (pin["sha256"], pin["bytes"]) not in historical:
                raise ValueError("required observation context lacks its durable allowable pin")
            contexts.append(frozen)
            required_pairs.append((pin["sha256"], pin["bytes"]))
        if len(set(required_pairs)) != len(required_pairs):
            raise ValueError("required observations must be distinct canonical contexts")
        contexts = [context for _, context in sorted(zip(required_pairs, contexts), key=lambda item: item[0])]
        output.append({"extractPath": extract_path, "receiptPath": receipt_path, "expected": expected,
            "expectedBase64": base64.b64encode(expected_raw).decode("ascii"),
            "requiredObservations": contexts, "allowedObservationPins": normalized_allowed})
    if set(durable) != {item["expected"]["requestHash"] for item in output}:
        raise ValueError("audit capture set is incomplete")
    return output


def _read_capture_record(root, index_hash, child_lease):
    for name in (PENDING, ANCHOR_PENDING):
        if _present(root/name):
            raise ValueError("capture record has staged state; audit refused")
    raw = read_private(root/RECORD, 512_000)
    record = decode_capture_record(raw)
    if _present(root/CAPTURE_EXECUTION) or _present(root/CAPTURE_RECLAIM):
        raise ValueError("capture execution/reclaim remains unsettled")
    if any(attempt["phase"] == "prepared" for job in record["jobs"] for attempt in job["attempts"]):
        raise ValueError("prepared capture attempt remains unsettled")
    info = root.lstat()
    expected = {"indexHash": index_hash, "rootDevice": info.st_dev, "rootInode": info.st_ino,
        "lockDevice": child_lease.device, "lockInode": child_lease.inode}
    if record["index"] != expected:
        raise ValueError("capture record belongs to a different child root or lease")
    if read_capture_record(root, capture_header(record)) != record:
        raise ValueError("capture record anchor/header differs")
    if read_private(root/ANCHOR, 4096) != anchor_bytes(record):
        raise ValueError("capture immutable quota anchor is missing or differs")
    return raw, record


def _verify_capture_record_unchanged(root, raw, file_identity, anchor_raw, admitted):
    if _present(root/PENDING) or _present(root/ANCHOR_PENDING):
        raise ValueError("capture controller acquired staged state during audit")
    if read_private(root/RECORD, 512_000) != raw or _identity((root/RECORD).lstat()) != file_identity:
        raise ValueError("durable capture record changed during audit")
    if read_private(root/ANCHOR, 4096) != anchor_raw:
        raise ValueError("durable capture quota anchor changed during audit")
    _binding(root, admitted.binding_bytes)
    _lease(admitted.lease)
    _lease(admitted.namespace_lease)


def _snapshot_footprint(root, file_bytes, aggregate):
    from index_storage_footprint import audit_execution_footprint
    return audit_execution_footprint(root, file_bytes=file_bytes, aggregate_bytes=aggregate)


def _preserved_inventory(footprint):
    return {name: value for name, value in footprint["files"].items()
            if name not in {AUDIT_RECORD, AUDIT_PENDING, AUDIT_ANCHOR,
                            AUDIT_ANCHOR_PENDING, AUDIT_RESULT, "auditExecution"}}


def _original_pins(root, maximum, database_maximum=None):
    if any(_present(root/name) for name in ("features.sqlite-journal", "bootstrap.sqlite-journal")):
        raise ValueError("retained SQLite rollback journal is present; audit refused")
    result = {}
    for name in ("features.sqlite", "features.sqlite-wal", "features.sqlite-shm",
                 "bootstrap.sqlite", "bootstrap.sqlite-wal", "bootstrap.sqlite-shm",
                 "binding.json", "reservation.json", "bootstrap.json", "writer.lock"):
        path = root/name
        if not _present(path):
            result[name] = None
            continue
        bound = min(maximum, database_maximum) if name == "features.sqlite" and database_maximum is not None else maximum
        pin, info = _hash_private(path, bound, modes=(0o600,))
        result[name] = {"pin": pin, "identity": _identity(info)}
    if result["features.sqlite"] is None:
        raise ValueError("retained index database is missing")
    if result["features.sqlite"]["pin"]["bytes"] == 0:
        raise ValueError("retained index database is empty")
    if result["features.sqlite-wal"] is None and result["features.sqlite-shm"] is not None:
        raise ValueError("orphan retained SQLite SHM is preserved")
    if result["bootstrap.sqlite"] is None and any(result[name] is not None for name in
            ("bootstrap.sqlite-wal", "bootstrap.sqlite-shm")):
        raise ValueError("orphan retained bootstrap sidecar is preserved")
    # Reservations live in the namespace registry, not a per-index JSON file.
    # Preserve optional legacy metadata above; require actual root controls here.
    for name in ("binding.json", "writer.lock"):
        if result[name] is None:
            raise ValueError(f"immutable index state {name} is missing")
    return result


def _verify_original(root, original, maximum):
    if any(_present(root/name) for name in ("features.sqlite-journal", "bootstrap.sqlite-journal")):
        raise ValueError("original SQLite rollback journal appeared during audit")
    for name, expected in original.items():
        path = root/name
        if expected is None:
            if _present(path):
                raise ValueError(f"original {name} appeared during audit")
            continue
        pin, info = _hash_private(path, maximum, modes=(0o600,))
        if pin != expected["pin"] or _identity(info) != expected["identity"]:
            raise ValueError(f"original {name} changed during audit; preserve it")


def _cleanup_slot(root, attempt, manifest_bytes, manifest_pin, source_configuration,
                  source_pin, db_pin, wal_pin, file_bytes, aggregate):
    execution, reclaim = root/AUDIT_EXECUTION, root/AUDIT_RECLAIM
    if _present(execution) and _present(reclaim):
        raise ValueError("mixed audit execution/reclaim slots; preserve both")
    if not _present(execution) and not _present(reclaim):
        return
    if attempt is None or attempt["phase"] != "terminal" or attempt["snapshotDevice"] is None:
        raise ValueError("audit snapshot has no terminal confirmed owner")
    live = execution if _present(execution) else reclaim
    info = live.lstat()
    if (info.st_dev, info.st_ino) != (attempt["snapshotDevice"], attempt["snapshotInode"]):
        raise ValueError("audit snapshot identity differs from its durable attempt")
    _snapshot_footprint(root, file_bytes, aggregate)
    db_pin = db_pin if db_pin is not None else attempt.get("snapshotDatabase")
    wal_pin = wal_pin if wal_pin is not None else attempt.get("snapshotWal")
    for name, pin in (("features.sqlite", db_pin), ("features.sqlite-wal", wal_pin)):
        path = live/name
        if not _present(path):
            if name == "features.sqlite" and live == execution:
                raise ValueError("audit database snapshot disappeared")
            continue
        actual, _ = _hash_private(path, 64*MIB)
        if pin is None:
            if (name != "features.sqlite-wal" or not attempt.get("launchPrepared")
                    or actual != {"sha256": hashlib.sha256(b"").hexdigest(), "bytes": 0}):
                raise ValueError("audit DB/WAL survivor lacks a durable pin")
        elif actual != pin:
            raise ValueError("audit DB/WAL survivor differs from its durable pin")
    if _present(live/"features.sqlite-journal"):
        raise ValueError("unexpected audit rollback journal is preserved")
    shm = live/"features.sqlite-shm"
    if _present(shm):
        if not attempt.get("launchPrepared"):
            raise ValueError("unlaunched audit snapshot contains an unowned SHM")
        _hash_private(shm, 64*MIB)
    nested_exec, nested_reclaim = live/CAPTURE_EXECUTION, live/CAPTURE_RECLAIM
    if _present(nested_exec) or _present(nested_reclaim):
        nested = nested_exec if _present(nested_exec) else nested_reclaim
        nested_info = nested.lstat()
        cleanup_capture_snapshot(live, {"phase": "terminal", "snapshotDevice": nested_info.st_dev,
            "snapshotInode": nested_info.st_ino}, manifest_bytes, manifest_pin, source_configuration, source_pin)
    if live == execution:
        _snapshot_footprint(root, file_bytes, aggregate)
        os.rename(execution, reclaim)
        fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try: os.fsync(fd)
        finally: os.close(fd)
    info = reclaim.lstat()
    if (info.st_dev, info.st_ino) != (attempt["snapshotDevice"], attempt["snapshotInode"]):
        raise ValueError("audit reclaim identity changed")
    _snapshot_footprint(root, file_bytes, aggregate)
    # All remaining files were checked against owned snapshot pins above. A controlled
    # rmtree can resume after interruption without touching originals.
    shutil.rmtree(reclaim)
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)


def _validate_report(report, admitted, runtime, capture_hash, envelope_hash,
                     database_bytes, capture_count, required_count, rss_limit, guard, limits):
    fields = {"format", "indexHash", "inputSha256", "captureRecordSha256", "nodeVersion",
        "sqliteVersion", "result", "databaseBytes", "maximumRssKiB"}
    if type(report) is not dict or set(report) != fields or report["format"] != "feature-index-audit-worker-v1":
        raise ValueError("audit worker report has an unsupported exact shape")
    if (report["indexHash"] != admitted.index_hash or report["inputSha256"] != envelope_hash
            or report["captureRecordSha256"] != capture_hash
            or report["nodeVersion"] != runtime["nodeVersion"] or report["sqliteVersion"] != runtime["sqliteVersion"]):
        raise ValueError("audit worker report hashes or runtime differ from frozen inputs")
    if (type(report["result"]) is not dict or type(report["databaseBytes"]) is not int
            or report["databaseBytes"] != database_bytes or type(report["maximumRssKiB"]) is not int
            or report["maximumRssKiB"] < 1
            or report["maximumRssKiB"] * 1024 > rss_limit
            or type(guard.get("maximumObservedWorkerRssBytes")) is not int
            or guard["maximumObservedWorkerRssBytes"] > rss_limit):
        raise ValueError("audit worker report counts/resources are invalid")
    kernel = report["result"]
    if type(kernel) is not dict or set(kernel) != {
            "format", "scope", "qualifications", "counts", "dispositionsSha256"}:
        raise ValueError("audit kernel report has an unsupported exact shape")
    if (kernel["format"] != "feature-index-raw-audit-v1"
            or kernel["scope"] != "raw-feature-conservation-and-required-observations"
            or type(kernel["qualifications"]) is not dict
            or set(kernel["qualifications"]) != {"rawIndexConservation", "requiredObservations"}
            or kernel["qualifications"] != {
                "rawIndexConservation": "complete", "requiredObservations": "complete"}
            or type(kernel["dispositionsSha256"]) is not str
            or not _SHA.fullmatch(kernel["dispositionsSha256"])):
        raise ValueError("audit kernel qualifications or digest differ")
    counts = kernel["counts"]
    count_fields = {"captures", "rawFeatures", "admitted", "exceptions", "occurrences",
        "versions", "keys", "conflicts", "crossOwnerConflictKeys", "observations", "requiredObservations"}
    if type(counts) is not dict or set(counts) != count_fields:
        raise ValueError("audit kernel counts have an unsupported exact shape")
    bounds = {"captures": min(capture_count, limits["captures"]), "rawFeatures": limits["occurrences"],
        "admitted": limits["occurrences"], "exceptions": limits["occurrences"],
        "occurrences": limits["occurrences"], "versions": limits["versions"], "keys": limits["versions"],
        "conflicts": limits["versions"], "crossOwnerConflictKeys": limits["versions"],
        "observations": limits["observations"], "requiredObservations": required_count}
    for name, maximum in bounds.items():
        if type(counts[name]) is not int or not 0 <= counts[name] <= maximum:
            raise ValueError("audit kernel count exceeds its immutable bound")
    if (counts["captures"] != capture_count
            or counts["admitted"] + counts["exceptions"] != counts["rawFeatures"]
            or counts["occurrences"] != counts["rawFeatures"]
            or counts["versions"] > counts["occurrences"]
            or counts["keys"] > counts["versions"]
            or counts["conflicts"] > counts["keys"]
            or counts["crossOwnerConflictKeys"] > counts["conflicts"]
            or counts["requiredObservations"] != required_count
            or counts["requiredObservations"] > counts["observations"]):
        raise ValueError("audit kernel count relationships are contradictory")


def audit_capture_index(admitted, repository_root, manifest_bytes, source_configuration, node,
                        captures, *, attempt_limit=8):
    """Run one bounded independent audit attempt against a frozen DB/WAL copy.

    Caller must hold both actual kernel leases. A terminal digest does not certify
    worker success, feature conservation or campaign membership. Observation pins
    alone cannot establish complete historical campaign context membership.
    """
    if type(admitted) is not ChargedIndexRoot:
        raise TypeError("audit requires its actual charged index root")
    lease = admitted.lease
    if _POISONED_LEASES.get(id(lease)) is lease or _POISONED.get(id(lease)) is lease:
        raise RuntimeError("unconfirmed index worker requires new actual paired leases")
    if type(attempt_limit) is not int or not 1 <= attempt_limit <= 8:
        raise ValueError("audit attempt limit must be between one and eight")
    config = decode_index_binding(admitted.binding_bytes)
    root, root_info = _lease(lease)
    namespace, _ = _lease(admitted.namespace_lease)
    if (root.parent != namespace or root.name != admitted.index_hash
            or hashlib.sha256(admitted.binding_bytes).hexdigest() != admitted.index_hash
            or config["reservedBytes"] != admitted.reserved_bytes):
        raise ValueError("audit root, binding or paired namespace differs")
    _binding(root, admitted.binding_bytes)
    verify_index_tooling(repository_root, manifest_bytes, config["toolingManifest"])
    manifest = decode_tooling_manifest(manifest_bytes, config["toolingManifest"])
    source_pin = config["source"]["configuration"]
    if _capture(repository_root, CONFIGURATION, source_pin) != source_configuration:
        raise ValueError("audit source configuration differs from retained pin")
    capture_raw, capture_record = _read_capture_record(root, admitted.index_hash, lease)
    capture_file_identity = _identity((root/RECORD).lstat())
    capture_anchor_raw = read_private(root/ANCHOR, 4096)
    captures = _capture_set(capture_record, captures)
    capture_record_pin = {"sha256": hashlib.sha256(capture_raw).hexdigest(), "bytes": len(capture_raw)}
    process = config["processLimits"]
    database_maximum = min(process["fileBytes"], config["engineLimits"]["databaseBytes"])
    original = _original_pins(root, process["fileBytes"], database_maximum)
    original_state = {name: None if value is None else {
        "pin": value["pin"], "identity": list(value["identity"])}
        for name, value in original.items()}
    original_state_hash = hashlib.sha256(_json(original_state)).hexdigest()
    canonical_captures = [{key: item[key] for key in ("extractPath", "receiptPath", "expectedBase64",
        "requiredObservations", "allowedObservationPins")} for item in captures]
    capture_set_hash = hashlib.sha256(_json(canonical_captures)).hexdigest()
    required = [{"requestHash": item["expected"]["requestHash"], "observations": item["requiredObservations"]}
        for item in captures if item["requiredObservations"]]
    required_hash = hashlib.sha256(_json(required)).hexdigest()
    descriptor = {"format": "feature-index-audit-input-v1", "indexHash": admitted.index_hash,
        "captureRecord": capture_record_pin, "captures": canonical_captures}
    base_input = _json(descriptor)
    if len(base_input) > MAX_ENVELOPE:
        raise ValueError("audit input exceeds its fixed 512000-byte bound")
    input_hash = hashlib.sha256(base_input).hexdigest()
    index_identity = {"indexHash": admitted.index_hash, "rootDevice": root_info.st_dev,
        "rootInode": root_info.st_ino, "lockDevice": lease.device, "lockInode": lease.inode}
    frozen_input = {"captureRecordSha256": capture_record_pin["sha256"],
        "captureRecordBytes": capture_record_pin["bytes"], "captureSetSha256": capture_set_hash,
        "requiredObservationsSha256": required_hash, "auditInputSha256": input_hash,
        "originalStateSha256": original_state_hash}
    new_record = {"format": FORMAT, "index": index_identity, "limits": {"attempts": attempt_limit},
        "input": frozen_input, "attempts": []}
    names = (AUDIT_RECORD, AUDIT_PENDING, AUDIT_ANCHOR, AUDIT_ANCHOR_PENDING, AUDIT_EXECUTION, AUDIT_RECLAIM)
    source_allowance = source_snapshot_allowance(manifest, len(source_configuration))
    preservation_baseline = index_storage_footprint(lease, file_bytes=process["fileBytes"],
        aggregate_bytes=admitted.reserved_bytes)
    retained_charge = preservation_baseline["directoryAllocatedBytes"] + sum(
        max(value["logicalBytes"], value["allocatedBytes"])
        for value in _preserved_inventory(preservation_baseline).values())
    copy_bytes = sum(((entry["pin"]["bytes"]+8191)//8192)*8192
                     for name in ("features.sqlite", "features.sqlite-wal")
                     if (entry := original[name]) is not None)
    # Existing owned audit scratch is reconciled before another copy is made;
    # original files, private SHM and external envelope remain jointly charged.
    estimate = (retained_charge + copy_bytes + process["fileBytes"] + MAX_RESULT
                + 2*MIB + 2*MAX_RECORD + 2*MAX_ENVELOPE + source_allowance)
    if source_allowance > MIB or estimate > admitted.reserved_bytes:
        raise ValueError("reservation cannot hold the bounded audit snapshot and controls")
    try: prior_bytes = read_private(root/AUDIT_RECORD, MAX_RECORD)
    except FileNotFoundError: prior_bytes = None
    if prior_bytes is None and any(_present(root/name) for name in (
            AUDIT_ANCHOR, AUDIT_EXECUTION, AUDIT_RECLAIM, AUDIT_RESULT)):
        raise ValueError("audit snapshot or anchor exists without its durable record")
    record = new_record if prior_bytes is None else _decode_record(prior_bytes)
    if any(record[key] != new_record[key] for key in ("format", "index", "limits", "input")):
        raise ValueError("audit input or retry limit changed; preserve quota")
    record = _read_record(root, record, original, canonical_captures) or record
    if prior_bytes is None:
        _publish_record(root, record)
    _seal(root, record)
    if _present(root/AUDIT_RESULT) and not (record["attempts"] and
            (record["attempts"][-1]["phase"] == "reporting"
             or (record["attempts"][-1]["phase"] == "terminal"
                 and record["attempts"][-1]["report"] is not None))):
        raise ValueError("audit result witness has no exact charged attempt owner; preserve it")

    if record["attempts"] and record["attempts"][-1]["phase"] == "reporting":
        prior = record["attempts"][-1]
        if prior["snapshotDevice"] is None or not _present(root/AUDIT_EXECUTION):
            raise ValueError("reporting audit lost its exact execution slot; preserve state")
        _verify_original(root, original, process["fileBytes"])
        raw_evidence = _raw_capture_descriptors(captures)
        try:
            _verify_raw(raw_evidence)
            _verify_capture_record_unchanged(root, capture_raw, capture_file_identity,
                capture_anchor_raw, admitted)
            if _present(root/AUDIT_RESULT):
                payload = _result_payload(root, prior, admitted.index_hash)
                guard_evidence = payload["guard"]
                if (guard_evidence["returnCode"] != 0 or guard_evidence["reason"] != "exit"
                        or type(guard_evidence["maximumObservedWorkerRssBytes"]) is not int
                        or guard_evidence["maximumObservedWorkerRssBytes"] > process["rssBytes"]
                        or guard_evidence["inheritedLease"] is not True
                        or guard_evidence["inheritedNamespaceLease"] is not True):
                    raise ValueError("audit result witness lacks successful guarded process evidence")
                _validate_report(payload["report"], admitted, config["runtime"],
                    capture_record_pin["sha256"], prior["inputSha256"],
                    prior["snapshotDatabase"]["bytes"], len(captures),
                    sum(len(item["requiredObservations"]) for item in captures),
                    process["rssBytes"], guard_evidence, config["engineLimits"])
                prior["phase"] = "terminal"
                prior["report"] = payload["report"]
                prior["guard"] = guard_evidence
                prior["resultSha256"] = hashlib.sha256(_json(payload["report"])).hexdigest()
                _publish_record(root, record)
                _remove_result(root, prior, admitted.index_hash)
            else:
                try:
                    partial = read_private(root/AUDIT_PENDING, MAX_RESULT)
                except FileNotFoundError:
                    partial = None
                if partial is not None:
                    if not _result_prefix(partial, admitted.index_hash, prior["number"], prior["inputSha256"]):
                        raise ValueError("unknown bytes occupy audit reporting pending slot; preserve state")
                    _unlink_named(root, AUDIT_PENDING)
                prior["phase"] = "terminal"
                prior["report"] = None
                prior["guard"] = None
                prior["resultSha256"] = hashlib.sha256(b"confirmed-writer-gap-interrupted-audit-v1").hexdigest()
                _publish_record(root, record)
        finally:
            raw_evidence = None

    if record["attempts"] and record["attempts"][-1]["phase"] == "prepared":
        prior = record["attempts"][-1]
        execution, reclaim = root/AUDIT_EXECUTION, root/AUDIT_RECLAIM
        if _present(execution) or _present(reclaim):
            slot = execution if _present(execution) else reclaim
            info = slot.lstat()
            if prior["snapshotDevice"] is None:
                # The only adoptable mkdir/publication gap is an exact empty
                # private execution directory. Any content without its durable
                # inode witness is unknown and must remain untouched.
                if (slot != execution or not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
                        or stat.S_IMODE(info.st_mode) != 0o700 or slot.resolve(strict=True) != slot):
                    raise ValueError("unbound audit slot identity is unsafe; preserve it")
                with os.scandir(slot) as entries:
                    empty = next(entries, None) is None
                if not empty:
                    raise ValueError("unbound audit slot contains content; preserve it")
                if _identity(slot.lstat()) != _identity(info):
                    raise ValueError("empty audit slot identity changed during adoption")
                prior["snapshotDevice"], prior["snapshotInode"] = info.st_dev, info.st_ino
                _publish_record(root, record)
            if (info.st_dev, info.st_ino) != (prior["snapshotDevice"], prior["snapshotInode"]):
                raise ValueError("prepared audit snapshot lacks exact durable slot ownership")
            # Reacquired real lease pair proves previous controller no longer owns the writer.
            if slot == execution:
                _verify_original(root, original, process["fileBytes"])
                _complete_execution_snapshot(slot, repository_root, manifest_bytes,
                    config["toolingManifest"], manifest, source_configuration, source_pin,
                    prior["snapshotDatabase"], prior["snapshotWal"], process["fileBytes"],
                    admitted.reserved_bytes, root, prior["launchPrepared"])
            prior["phase"] = "terminal"
            prior["resultSha256"] = hashlib.sha256(b"confirmed-writer-gap-interrupted-audit-v1").hexdigest()
            prior["report"] = None; prior["guard"] = None
            _publish_record(root, record)
            _cleanup_slot(root, prior, manifest_bytes, config["toolingManifest"], source_configuration,
                          source_pin, None, None, process["fileBytes"], admitted.reserved_bytes)
        else:
            if prior["snapshotDevice"] is not None:
                raise ValueError("prepared audit snapshot disappeared; preserve quota")
            prior["phase"] = "terminal"
            prior["resultSha256"] = hashlib.sha256(b"preallocation-interruption-v1").hexdigest()
            prior["report"] = None; prior["guard"] = None
            _publish_record(root, record)
    elif record["attempts"] and (_present(root/AUDIT_EXECUTION) or _present(root/AUDIT_RECLAIM)):
        # Terminal means this controller observed normal worker closure, or a
        # newly acquired paired lease proved a writer gap during recovery.
        prior = record["attempts"][-1]
        if _present(root/AUDIT_EXECUTION):
            _verify_original(root, original, process["fileBytes"])
            _complete_execution_snapshot(root/AUDIT_EXECUTION, repository_root,
                manifest_bytes, config["toolingManifest"], manifest, source_configuration,
                source_pin, prior["snapshotDatabase"], prior["snapshotWal"],
                process["fileBytes"], admitted.reserved_bytes, root, prior["launchPrepared"])
        _cleanup_slot(root, prior, manifest_bytes, config["toolingManifest"],
            source_configuration, source_pin, None, None, process["fileBytes"], admitted.reserved_bytes)
    if _present(root/AUDIT_EXECUTION) or _present(root/AUDIT_RECLAIM):
        raise ValueError("audit snapshot cleanup is unresolved")
    if record["attempts"] and record["attempts"][-1]["report"] is not None:
        prior = record["attempts"][-1]
        raw_descriptors = _raw_capture_descriptors(captures)
        try:
            _verify_raw(raw_descriptors)
            _verify_capture_record_unchanged(root, capture_raw, capture_file_identity,
                capture_anchor_raw, admitted)
            _verify_original(root, original, process["fileBytes"])
            cached = prior["report"]
            _validate_report(cached, admitted, config["runtime"], capture_record_pin["sha256"],
                prior["inputSha256"],
                prior["snapshotDatabase"]["bytes"], len(captures),
                sum(len(item["requiredObservations"]) for item in captures),
                process["rssBytes"], {"maximumObservedWorkerRssBytes": prior["guard"]["maximumObservedWorkerRssBytes"]},
                config["engineLimits"])
            _remove_result(root, prior, admitted.index_hash)
        finally:
            raw_descriptors = None
        footprint = index_storage_footprint(lease, file_bytes=process["fileBytes"],
                                            aggregate_bytes=admitted.reserved_bytes)
        if _preserved_inventory(footprint) != _preserved_inventory(preservation_baseline):
            raise ValueError("read-only audit changed retained index storage inventory")
        return {"audit": cached, "guard": None, "guardEvidence": {
                    "format": "feature-index-audit-retained-guard-v1", **prior["guard"]},
            "footprint": footprint, "executionSnapshotChargedBytes": 0,
            "auditSnapshotChargedBytes": 0, "auditEnvelopeChargedBytes": 0,
            "auditController": {"attempts": len(record["attempts"]), "inputSha256": input_hash,
                "recordSha256": hashlib.sha256(_encode_record(record)).hexdigest(), "replayed": True,
                "scope": "raw-feature-conservation-and-required-observations; global campaign membership is not established by pins alone"}}
    if len(record["attempts"]) >= attempt_limit:
        raise ValueError("audit attempt limit is exhausted")

    original = _original_pins(root, process["fileBytes"], database_maximum)
    attempt = {"number": len(record["attempts"])+1, "phase": "prepared", "snapshotDevice": None,
        "snapshotInode": None, "inputSha256": input_hash,
        "snapshotDatabase": original["features.sqlite"]["pin"],
        "snapshotWal": None if original["features.sqlite-wal"] is None else original["features.sqlite-wal"]["pin"],
        "resultSha256": None, "report": None, "guard": None, "launchPrepared": False}
    record["attempts"].append(attempt)
    _publish_record(root, record)
    outer = root/AUDIT_EXECUTION
    descriptors = []
    metadata_fd = None
    writer_fd = None
    envelope_path = None
    db_pin = wal_pin = None
    try:
        descriptors = _raw_capture_descriptors(captures)
        outer.mkdir(mode=0o700)
        outer_info = outer.lstat()
        attempt["snapshotDevice"], attempt["snapshotInode"] = outer_info.st_dev, outer_info.st_ino
        record["attempts"][-1] = attempt
        _publish_record(root, record)
        source_root = _complete_execution_snapshot(outer, repository_root, manifest_bytes,
            config["toolingManifest"], manifest, source_configuration, source_pin,
            attempt["snapshotDatabase"], attempt["snapshotWal"], process["fileBytes"],
            admitted.reserved_bytes, root)
        _verify_raw(descriptors)
        _snapshot_footprint(root, process["fileBytes"], admitted.reserved_bytes)
        db_pin = attempt["snapshotDatabase"]
        wal_pin = attempt["snapshotWal"]
        if _hash_private(outer/"features.sqlite", database_maximum)[0] != db_pin:
            raise ValueError("audit database snapshot changed before worker launch")
        if wal_pin is not None and _hash_private(outer/"features.sqlite-wal", process["fileBytes"])[0] != wal_pin:
            raise ValueError("audit WAL snapshot changed before worker launch")
        _verify_original(root, original, process["fileBytes"])
        source_footprint = capture_execution_footprint(outer)
        index_storage_footprint(lease, file_bytes=process["fileBytes"],
                                aggregate_bytes=admitted.reserved_bytes-MAX_ENVELOPE)
        envelope = {"format": "feature-index-audit-input-v1", "indexHash": admitted.index_hash,
            "captureRecord": capture_record_pin,
            "snapshotRoot": {"path": str(outer), "device": outer_info.st_dev, "inode": outer_info.st_ino},
            "database": db_pin, "wal": wal_pin, "captures": canonical_captures}
        raw_envelope = _json(envelope)
        if len(raw_envelope) > MAX_ENVELOPE:
            raise ValueError("audit envelope exceeds its fixed 512000-byte bound")
        envelope_hash = hashlib.sha256(raw_envelope).hexdigest()
        attempt["inputSha256"] = envelope_hash
        record["attempts"][-1] = attempt
        _publish_record(root, record)
        writer_fd, envelope_path = tempfile.mkstemp(prefix="allworld-index-audit-")
        os.fchmod(writer_fd, 0o600)
        try:
            view = memoryview(raw_envelope)
            while view:
                n = os.write(writer_fd, view)
                if n <= 0: raise OSError("short anonymous audit envelope write")
                view = view[n:]
            os.fsync(writer_fd)
        finally:
            os.close(writer_fd)
            writer_fd = None
        metadata_fd = os.open(envelope_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        os.unlink(envelope_path)
        envelope_path = None
        metadata_info = os.fstat(metadata_fd)
        metadata_charge = max(metadata_info.st_size, metadata_info.st_blocks*512)
        if metadata_charge > MAX_ENVELOPE + 8192:
            raise ValueError("anonymous audit envelope allocation exceeds its reserved margin")
        index_storage_footprint(lease, file_bytes=process["fileBytes"],
                                aggregate_bytes=admitted.reserved_bytes-metadata_charge)
        if (not stat.S_ISREG(metadata_info.st_mode) or metadata_info.st_uid != os.getuid()
                or metadata_info.st_nlink != 0 or stat.S_IMODE(metadata_info.st_mode) != 0o600
                or metadata_info.st_size != len(raw_envelope)
                or os.pread(metadata_fd, MAX_ENVELOPE+1, 0) != raw_envelope):
            raise ValueError("anonymous readonly audit envelope differs from its pinned bytes")
        executable, runtime_before = _node_pin(node, config["runtime"])
        attempt["launchPrepared"] = True
        record["attempts"][-1] = attempt
        _publish_record(root, record)
        guard = _run_fixed_process(executable, "index-capture-audit", root,
            file_bytes=process["fileBytes"], cpu_seconds=process["cpuSeconds"],
            wall_seconds=process["wallSeconds"], heap_mib=process["heapMiB"],
            rss_limit_bytes=process["rssBytes"], lease_descriptor=lease.descriptor,
            namespace_descriptor=admitted.namespace_lease.descriptor, execution_root=source_root,
            audit_configuration={"metadataDescriptor": metadata_fd, "metadataSha256": envelope_hash})
        os.close(metadata_fd); metadata_fd = None
        if _node_pin(executable, config["runtime"])[1] != runtime_before:
            raise ValueError("pinned Node runtime changed during audit")
        _verify_original(root, original, process["fileBytes"])
        _verify_raw(descriptors)
        _verify_capture_record_unchanged(root, capture_raw, capture_file_identity,
                                         capture_anchor_raw, admitted)
        observed_inventory = index_storage_footprint(lease, file_bytes=process["fileBytes"],
            aggregate_bytes=admitted.reserved_bytes)
        if _preserved_inventory(observed_inventory) != _preserved_inventory(preservation_baseline):
            raise ValueError("read-only audit changed retained index storage inventory")
        if guard["returnCode"] != 0 or guard["reason"] != "exit":
            raise RuntimeError("fixed audit worker did not produce a successful terminal report")
        try:
            report = json.loads(guard["stdout"], object_pairs_hook=_pairs, parse_constant=_nonfinite)
        except (ValueError, RecursionError) as error:
            raise ValueError("audit worker report is not strict JSON") from error
        required_count = sum(len(item["requiredObservations"]) for item in captures)
        _validate_report(report, admitted, config["runtime"], capture_record_pin["sha256"],
                         envelope_hash, db_pin["bytes"], len(captures), required_count,
                         process["rssBytes"], guard, config["engineLimits"])
        guard_summary = {key: guard[key] for key in ("returnCode", "reason",
            "maximumObservedWorkerRssBytes", "inheritedLease", "inheritedNamespaceLease")}
        attempt["phase"] = "reporting"
        attempt["report"] = None; attempt["guard"] = None; attempt["resultSha256"] = None
        record["attempts"][-1] = attempt
        _publish_record(root, record)
        if _present(root/AUDIT_RESULT):
            raise ValueError("previous audit result witness remains; preserve state")
        _publish_bytes(root, _result_bytes(admitted.index_hash, attempt["number"],
            envelope_hash, report, guard_summary), AUDIT_RESULT, AUDIT_PENDING, MAX_RESULT)
        attempt["phase"] = "terminal"
        attempt["resultSha256"] = hashlib.sha256(_json(report)).hexdigest()
        attempt["report"] = report
        attempt["guard"] = guard_summary
        record["attempts"][-1] = attempt
        _publish_record(root, record)
        _remove_result(root, attempt, admitted.index_hash)
        slot_footprint = _snapshot_footprint(root, process["fileBytes"], admitted.reserved_bytes)
        _cleanup_slot(root, attempt, manifest_bytes, config["toolingManifest"], source_configuration,
                      source_pin, db_pin, wal_pin, process["fileBytes"], admitted.reserved_bytes)
        _verify_original(root, original, process["fileBytes"])
        _verify_raw(descriptors)
        _verify_capture_record_unchanged(root, capture_raw, capture_file_identity,
                                         capture_anchor_raw, admitted)
        footprint = index_storage_footprint(lease, file_bytes=process["fileBytes"],
                                            aggregate_bytes=admitted.reserved_bytes)
        if _preserved_inventory(footprint) != _preserved_inventory(preservation_baseline):
            raise ValueError("read-only audit changed retained index storage inventory")
        return {"audit": report, "guard": guard, "footprint": footprint,
            "executionSnapshotChargedBytes": source_footprint["chargedBytes"],
            "auditSnapshotChargedBytes": slot_footprint["chargedBytes"],
            "auditEnvelopeChargedBytes": max(len(raw_envelope), metadata_info.st_blocks*512),
            "auditController": {"attempts": len(record["attempts"]), "inputSha256": input_hash,
                "recordSha256": hashlib.sha256(_encode_record(record)).hexdigest(),
                "replayed": False,
                "scope": "raw-feature-conservation-and-required-observations; global campaign membership is not established by pins alone"}}
    except IndexWorkerUnreaped as error:
        _POISONED[id(lease)] = lease
        _POISONED_LEASES[id(lease)] = lease
        error.retained_audit_record = root/AUDIT_RECORD
        error.retained_audit_snapshot = outer
        error.retained_audit_raw_evidence = tuple(descriptors)
        error.retained_audit_metadata_descriptor = metadata_fd
        raise
    except Exception:
        if attempt["phase"] == "prepared" and attempt["snapshotDevice"] is not None:
            attempt["phase"] = "terminal"
            attempt["resultSha256"] = hashlib.sha256(b"audit-worker-confirmed-terminal-failure-v1").hexdigest()
            attempt["report"] = None; attempt["guard"] = None
            record["attempts"][-1] = attempt
            _publish_record(root, record)
        raise
    finally:
        # Never close handles a real unreaped worker inherited.
        if writer_fd is not None:
            os.close(writer_fd)
        if envelope_path is not None:
            try: os.unlink(envelope_path)
            except FileNotFoundError: pass
        if metadata_fd is not None and not (_POISONED.get(id(lease)) is lease):
            os.close(metadata_fd)
        if _POISONED.get(id(lease)) is not lease:
            descriptors = []
