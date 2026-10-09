"""Held-lease index admission plus bounded capture-ingest sessions.

Reservation SQL runs only in the fixed worker under persistent namespace
attempt ownership. Session observations pin caller-provided context; they do
not prove campaign membership or completion.
"""
from contextlib import contextmanager
import base64
import hashlib
import json
import os
from pathlib import Path
import select
import signal
import sys

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from index_binding import _pairs, _nonfinite
from index_admission_input import validate_admission_binding
from index_namespace import _root, _aggregate, _preflight, namespace_binding
from index_registry_startup import _runtime, _admission_report
from index_registry_controller import restartable_registry_startup
from index_root import ChargedIndexRoot, _lease, _binding
from index_storage_footprint import index_storage_footprint
from index_writer_lock import index_writer_lease


_SESSION = "feature-index-session-"
_INIT_FIELDS = {"format", "namespaceRoot", "aggregateBytes", "repositoryRoot", "manifestBase64",
                "sourceConfigurationBase64", "bindingBase64", "pythonRuntime", "node"}
_JOB_FIELDS = {"format", "id", "extractPath", "receiptPath", "expected", "observation"}
_SESSION_LINE = 128000
_SESSION_MAX_JOBS = 256
_SESSION_AUDIT_MAX_BYTES = 512_000


from index_resource_limits import IndexSessionInterrupted as _SessionInterrupted, IndexWorkerUnreaped


def _session_readline(pending, maximum):
    """Read one bounded protocol line without a buffered wait that masks signals."""
    import index_resource_limits
    descriptor = sys.stdin.buffer.fileno()
    while True:
        if index_resource_limits.SESSION_INTERRUPTION:
            raise _SessionInterrupted(index_resource_limits.SESSION_INTERRUPTION)
        newline = pending.find(b"\n")
        if newline >= 0:
            if newline + 1 > maximum:
                raise ValueError("invalid session line length/termination")
            raw = bytes(pending[:newline + 1]); del pending[:newline + 1]
            try:
                value = json.loads(raw[:-1].decode("utf-8"), object_pairs_hook=_pairs, parse_constant=_nonfinite)
            except (UnicodeError, ValueError, RecursionError) as error:
                raise ValueError("invalid session JSON") from error
            if type(value) is not dict:
                raise ValueError("session line must be an object")
            return value
        if len(pending) > maximum:
            raise ValueError("invalid session line length/termination")
        readable, _, _ = select.select([descriptor], [], [], 0.05)
        if not readable:
            continue
        chunk = os.read(descriptor, min(4096, maximum + 1 - len(pending)))
        if not chunk:
            if not pending:
                return None
            raise ValueError("session input ended before newline")
        pending.extend(chunk)


def _session_b64(value, maximum):
    if type(value) is not str or not value or len(value) > 4*((maximum+2)//3):
        raise ValueError("invalid base64 bound")
    try:
        raw = base64.b64decode(value.encode("ascii"), validate=True)
    except (UnicodeError, ValueError) as error:
        raise ValueError("invalid base64") from error
    if len(raw) > maximum or base64.b64encode(raw).decode("ascii") != value:
        raise ValueError("noncanonical base64")
    return raw


def _session_emit(value):
    try:
        raw = json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("ascii") + b"\n"
    except (TypeError, ValueError, RecursionError) as error:
        raise ValueError("bad session result") from error
    if len(raw) > _SESSION_LINE:
        raise ValueError("session result exceeds line bound")
    sys.stdout.buffer.write(raw)
    sys.stdout.buffer.flush()


def _session_error(error):
    message = str(error).encode("utf-8", "replace")[:4096].decode("utf-8", "ignore")
    sys.stderr.buffer.write((message or "session failed").encode("utf-8") + b"\n")
    sys.stderr.buffer.flush()


def _session_audit_record(admitted):
    from index_capture_record import settled_capture_observation_pins
    from index_capture_state import RECORD
    from index_controller_state import read_private
    root, _ = _lease(admitted.lease)
    return settled_capture_observation_pins(read_private(root/RECORD, 512_000))


def _session_audit_begin(message, admitted):
    if (set(message) != {"format", "id", "count", "attemptLimit"} or message.get("format") != _SESSION+"audit-begin-v1"
            or type(message.get("id")) is not int or message["id"] != 1
            or type(message.get("count")) is not int or not 1 <= message["count"] <= _SESSION_MAX_JOBS
            or type(message.get("attemptLimit")) is not int or not 1 <= message["attemptLimit"] <= 8):
        raise ValueError("bad audit begin")
    return dict(count=message["count"], attemptLimit=message["attemptLimit"], jobs=_session_audit_record(admitted),
                captures=[], size=0, ordinal=0, error=None, terminal=False)


def _session_audit_step(message, audit, admitted, init, manifest, configuration, index_hash):
    import index_resource_limits
    captures = audit["captures"]
    if audit["terminal"]: raise ValueError("only close or EOF may follow the audit result")
    if audit["ordinal"] < audit["count"]:
        if (set(message) != {"format", "id", "ordinal", "extractPath", "receiptPath", "expected", "requiredObservations"}
                or message.get("format") != _SESSION+"audit-capture-v1"): raise ValueError("bad audit descriptor")
        if (type(message["id"]) is not int or message["id"] != 1 or type(message["ordinal"]) is not int
                or message["ordinal"] != audit["ordinal"] or type(message["extractPath"]) is not str
                or type(message["receiptPath"]) is not str): raise ValueError("bad audit descriptor order/fields")
        from index_ingest import prepare_audit_capture_descriptor
        if audit["error"] is None:
            try:
                capture, size = prepare_audit_capture_descriptor(message, audit["jobs"])
                size += audit["size"] + bool(captures)
                if size + 2 > _SESSION_AUDIT_MAX_BYTES: raise ValueError("audit descriptors exceed 512000 bytes")
                audit["size"] = size; captures.append(capture)
            except Exception as caught:
                audit["error"] = str(caught).encode("utf-8", "replace")[:4096].decode("utf-8", "ignore") or "audit input failed"
                captures.clear()
        audit["ordinal"] += 1
        return False
    if (set(message) != {"format", "id"} or message.get("format") != _SESSION+"audit-run-v1"
            or type(message.get("id")) is not int or message["id"] != 1): raise ValueError("bad audit run order")
    report = None; error = audit["error"]; interrupted = False
    try:
        if error is None:
            from index_audit_controller import audit_capture_index
            report = audit_capture_index(admitted, init["repositoryRoot"], manifest, configuration,
                                         init["node"], captures, attempt_limit=audit["attemptLimit"])
    except IndexWorkerUnreaped: raise
    except _SessionInterrupted as caught: error = str(caught); interrupted = True
    except Exception as caught:
        error = str(caught).encode("utf-8", "replace")[:4096].decode("utf-8", "ignore") or "audit failed"
    if index_resource_limits.SESSION_INTERRUPTION and error is None: error = "audit interrupted"
    _session_emit({"format": _SESSION+"audit-result-v1", "id": 1, "indexHash": index_hash,
                   "report" if error is None else "error": report if error is None else error})
    audit["terminal"] = True
    return interrupted or bool(index_resource_limits.SESSION_INTERRUPTION)


def capture_session():
    """Caller holds paired leases; unconfirmed workers inherit them."""
    import index_resource_limits
    interrupted = False; ready = False; previous = {}
    previous_interruption = index_resource_limits.SESSION_INTERRUPTION
    index_resource_limits.SESSION_INTERRUPTION = None
    def interrupt(signum, _frame):
        if not index_resource_limits.SESSION_INTERRUPTION:
            index_resource_limits.SESSION_INTERRUPTION = signal.Signals(signum).name
    for signum in (signal.SIGTERM, signal.SIGINT): previous[signum] = signal.signal(signum, interrupt)
    pending = bytearray()
    try:
        init = _session_readline(pending, 256000)
        if init is None or set(init) != _INIT_FIELDS or init.get("format") != _SESSION + "init-v1":
            raise ValueError("bad session init")
        manifest = _session_b64(init["manifestBase64"], 64000)
        configuration = _session_b64(init["sourceConfigurationBase64"], 64000)
        binding = _session_b64(init["bindingBase64"], 4096)
        manifest_pin = {"sha256": hashlib.sha256(manifest).hexdigest(), "bytes": len(manifest)}
        source_pin = {"sha256": hashlib.sha256(configuration).hexdigest(), "bytes": len(configuration)}
        if any(type(init[k]) is not str for k in ("namespaceRoot", "repositoryRoot", "node")) or type(init["aggregateBytes"]) is not int:
            raise ValueError("bad session paths/aggregate")
        index_hash = None; processed = 0
        with supervised_charged_index(init["namespaceRoot"], init["aggregateBytes"],
                init["repositoryRoot"], manifest, manifest_pin, configuration, source_pin,
                sys.executable, init["pythonRuntime"], binding) as (admitted, result):
            index_hash = admitted.index_hash
            registry = result.get("registry") if type(result) is dict else None
            admission = registry.get("admission") if type(registry) is dict else None
            if type(admission) is not dict: raise ValueError("verified admission missing")
            _session_emit({"format": _SESSION+"ready-v1", "indexHash": index_hash, "admission": admission})
            ready = True
            from index_capture_controller import ingest_capture_job
            audit = None
            while True:
                message = _session_readline(pending, _SESSION_LINE)
                if message is None or message == {"format": _SESSION+"close-v1"}:
                    if audit is not None and not audit["terminal"]:
                        raise ValueError("audit session closed before the run frame")
                    break
                if audit is None and set(message) == {"format", "id", "count", "attemptLimit"}:
                    audit = _session_audit_begin(message, admitted)
                    continue
                if audit is not None:
                    if _session_audit_step(message, audit, admitted, init, manifest, configuration, index_hash):
                        interrupted = True; break
                    continue
                if (processed == _SESSION_MAX_JOBS or set(message) != _JOB_FIELDS
                        or message.get("format") != _SESSION+"capture-v1"):
                    raise ValueError("bad session job")
                job_id = message["id"]
                if type(job_id) is not int or job_id != processed+1:
                    raise ValueError("bad session job ID")
                report = None; error_text = None
                try:
                    report = ingest_capture_job(admitted, init["repositoryRoot"], manifest,
                        configuration, init["node"], message["extractPath"], message["receiptPath"],
                        message["expected"], observation=message["observation"])
                except IndexWorkerUnreaped: raise
                except _SessionInterrupted as error:
                    error_text = str(error); interrupted = True
                except Exception as error: error_text = str(error).encode("utf-8", "replace")[:4096].decode("utf-8", "ignore") or "capture failed"
                response = {"format": _SESSION+"result-v1", "id": job_id, "indexHash": index_hash,
                            "report" if error_text is None else "error": report if error_text is None else error_text}
                _session_emit(response)
                processed += 1
                if index_resource_limits.SESSION_INTERRUPTION:
                    interrupted = True
                if interrupted: break
        _session_emit({"format": _SESSION+"done-v1", "indexHash": index_hash, "captures": processed})
        return 1 if interrupted else 0
    except _SessionInterrupted as error:
        if ready: _session_emit({"format": _SESSION+"done-v1", "indexHash": index_hash, "captures": processed})
        else: _session_error(error)
        return 1
    except BaseException as error: _session_error(error); return 1
    finally:
        index_resource_limits.SESSION_INTERRUPTION = previous_interruption
        for signum, handler in previous.items(): signal.signal(signum, handler)


@contextmanager
def supervised_charged_index(namespace_root, aggregate_bytes, repository_root, manifest_bytes,
                             manifest_pin, source_configuration, source_pin, python, python_runtime,
                             binding_bytes, *, cpu_seconds=10, wall_seconds=15,
                             rss_limit_bytes=96*1024*1024, attempt_limit=16):
    """Hold the actual namespace lock from supervised charge through caller ingestion.

    A successful return from the controller proves a terminal, verified fixed
    reservation worker. Reacquire the reported child lock without releasing the
    namespace lock; a changed directory, binding or inode refuses the handoff.
    The caller must confirm its ingestion worker terminal before leaving this
    context. Unconfirmed workers retain inherited leases and all database state.
    """
    config = validate_admission_binding(binding_bytes, manifest_pin, source_pin, source_configuration)
    runtime = _runtime(python_runtime); aggregate = _aggregate(aggregate_bytes)
    root, _ = _root(namespace_root)
    expected = namespace_binding(aggregate, sqlite_version=runtime["sqliteVersion"])
    _preflight(root, expected, aggregate, controller_check=False)
    with index_writer_lease(root) as namespace_lease:
        result = restartable_registry_startup(root, aggregate, Path(repository_root), manifest_bytes,
            manifest_pin, source_configuration, source_pin, python, runtime,
            cpu_seconds=cpu_seconds, wall_seconds=wall_seconds, rss_limit_bytes=rss_limit_bytes,
            attempt_limit=attempt_limit, _binding_bytes=binding_bytes, _inherited_lease=namespace_lease)
        _lease(namespace_lease)
        report = result["registry"]; admission = report["admission"]
        _admission_report(admission, root, binding_bytes, report["stats"])
        index_hash = hashlib.sha256(binding_bytes).hexdigest(); child = root/index_hash
        with index_writer_lease(child) as lease:
            _, info = _lease(lease)
            if ((info.st_dev, info.st_ino) != (admission["rootDevice"], admission["rootInode"])
                    or (lease.device, lease.inode) != (admission["lockDevice"], admission["lockInode"])):
                raise ValueError("admitted root/lock changed during supervised lease handoff")
            _binding(child, binding_bytes)
            index_storage_footprint(lease, file_bytes=config["processLimits"]["fileBytes"],
                                    aggregate_bytes=config["reservedBytes"])
            admitted = ChargedIndexRoot(lease, index_hash, binding_bytes, config["reservedBytes"],
                                        admission["replayed"], namespace_lease)
            yield admitted, result
            _lease(lease); _lease(namespace_lease); _binding(child, binding_bytes)
            index_storage_footprint(lease, file_bytes=config["processLimits"]["fileBytes"],
                                    aggregate_bytes=config["reservedBytes"])


if __name__ == "__main__":
    if sys.argv[1:] == ["--capture-session"]:
        raise SystemExit(capture_session())
    _session_error(ValueError("index admission CLI requires --capture-session"))
    raise SystemExit(2)
