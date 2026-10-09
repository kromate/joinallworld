"""Bounded readonly inputs for fixed workers."""
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
from types import SimpleNamespace

from index_binding import decode_index_binding, _pairs, _nonfinite
from index_controller_record import decode_controller_record, FORMAT_V2
from index_controller_state import RECORD, read_private
from index_resource_limits import IndexWorkerUnreaped
from index_tooling import _private_plan_pipe

MAX_BYTES = 4096


def binding_pin(raw):
    decode_index_binding(raw)
    return {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}


def validate_admission_binding(raw, manifest_pin, source_pin, source_configuration):
    config = decode_index_binding(raw)
    if config["toolingManifest"] != manifest_pin or config["source"]["configuration"] != source_pin:
        raise ValueError("admission binding differs from its complete tooling/source pins")
    source = json.loads(source_configuration, object_pairs_hook=_pairs, parse_constant=_nonfinite)
    if (config["source"]["provider"] != source["provider"] or config["source"]["release"] != source["release"]
            or any(layer not in source["stac"]["collections"] for layer in config["source"]["layers"])):
        raise ValueError("admission binding differs from its configured source release/layers")
    return config


@contextmanager
def binding_descriptor(raw):
    expected = binding_pin(raw)
    write_fd, name = tempfile.mkstemp(prefix="allworld-index-admission-")
    path = Path(name); descriptor = None; preserve = False
    try:
        try:
            os.fchmod(write_fd, 0o600)
            view = memoryview(raw)
            while view:
                written = os.write(write_fd, view)
                if written < 1: raise OSError("short admission input write")
                view = view[written:]
            os.fsync(write_fd)
        finally: os.close(write_fd)
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        os.unlink(path); path = None
        info = os.fstat(descriptor)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 0
                or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size != len(raw)
                or os.pread(descriptor, MAX_BYTES+1, 0) != raw):
            raise ValueError("readonly admission input differs from its exact binding")
        yield descriptor, expected, max(info.st_size, info.st_blocks*512)
    except IndexWorkerUnreaped as error:
        preserve = True
        error.retained_binding_descriptor = descriptor
        raise
    finally:
        if path is not None: os.unlink(path)
        if descriptor is not None and not preserve: os.close(descriptor)


def read_admission_input(root, namespace_descriptor):
    raw = _read_binding_descriptor(namespace_descriptor); pin = binding_pin(raw)
    record = decode_controller_record(read_private(root/RECORD))
    operation = {"kind": "admit", "binding": pin}
    attempt = record["attempts"][-1] if record["attempts"] else {}
    if (record["format"] != FORMAT_V2 or not record["attempts"]
            or attempt.get("phase") != "prepared" or attempt.get("snapshotDevice") is None
            or attempt.get("operation") != operation):
        raise ValueError("admission input lacks its exact prepared durable operation")
    configuration = read_private(Path(__file__).resolve().parent.parent/"acquisition-sources.json", 64000, (0o400,))
    source_pin = {"sha256": hashlib.sha256(configuration).hexdigest(), "bytes": len(configuration)}
    if source_pin != record["sourceConfiguration"]: raise ValueError("admission execution source differs from its durable record")
    validate_admission_binding(raw, record["toolingManifest"], source_pin, configuration)
    return raw


def _read_binding_descriptor(namespace_descriptor):
    raw_fd = os.environ.get("WORLD_INDEX_BINDING_DESCRIPTOR")
    raw_sha = os.environ.get("WORLD_INDEX_BINDING_SHA256")
    if (type(raw_fd) is not str or not re.fullmatch(r"[0-9]{1,10}", raw_fd)
            or type(raw_sha) is not str or not re.fullmatch(r"[a-f0-9]{64}", raw_sha)):
        raise ValueError("fixed admission input requires its exact descriptor/hash")
    descriptor = int(raw_fd)
    if not 2 < descriptor <= 2147483647 or descriptor == namespace_descriptor:
        raise ValueError("admission binding requires a distinct dedicated descriptor")
    before = os.fstat(descriptor)
    if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid() or before.st_nlink != 0
            or stat.S_IMODE(before.st_mode) != 0o600 or not 1 <= before.st_size <= MAX_BYTES
            or fcntl.fcntl(descriptor, fcntl.F_GETFL) & os.O_ACCMODE != os.O_RDONLY):
        raise ValueError("admission binding must be an anonymous private bounded regular file")
    raw = bytearray()
    while len(raw) <= before.st_size:
        chunk = os.pread(descriptor, before.st_size+1-len(raw), len(raw))
        if not chunk: break
        raw.extend(chunk)
    identity = lambda info: (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
                            info.st_ctime_ns, info.st_uid, info.st_mode, info.st_nlink)
    if (len(raw) != before.st_size or hashlib.sha256(raw).hexdigest() != raw_sha
            or identity(os.fstat(descriptor)) != identity(before)):
        raise ValueError("admission binding changed or differs from its retained pin")
    return bytes(raw)


def create_plan_pipe(namespace_descriptor):
    """Allocate and validate private pipes."""
    if type(namespace_descriptor) is not int or not 2 < namespace_descriptor <= 2147483647:
        raise ValueError("invalid namespace descriptor")
    owned = []
    try:
        read_child, write_parent = os.pipe(); owned.extend((read_child, write_parent))
        read_parent, write_child = os.pipe(); owned.extend((read_parent, write_child))
        pairs = ((read_child, os.O_RDONLY), (write_parent, os.O_WRONLY),
                 (read_parent, os.O_RDONLY), (write_child, os.O_WRONLY))
        if (min(read_child, write_parent, read_parent, write_child) <= 2
                or max(read_child, write_parent, read_parent, write_child) > 2147483647
                or len({read_child, write_parent, read_parent, write_child, namespace_descriptor}) != 5):
            raise ValueError("pipe aliases namespace lease")
        identities = []
        for descriptor, access in pairs:
            os.set_blocking(descriptor, False)
            info = os.fstat(descriptor); flags = fcntl.fcntl(descriptor, fcntl.F_GETFL)
            if (not _private_plan_pipe(info) or flags & os.O_ACCMODE != access
                    or not flags & os.O_NONBLOCK):
                raise ValueError("invalid plan pipe endpoint")
            identities.append((info.st_dev, info.st_ino, info.st_uid, info.st_mode, info.st_nlink, flags))
        return SimpleNamespace(readChild=read_child, writeParent=write_parent, readParent=read_parent,
            writeChild=write_child, bytesWritten=0, acksReceived=0, ackBuffer=bytearray(),
            awaitingAck=False, ackEOF=False, identities=identities)
    except BaseException:
        for descriptor in owned:
            try: os.close(descriptor)
            except OSError: pass
        raise


def verify_plan_parent_pipes(state):
    """Check surviving pipe identities."""
    for position, descriptor in ((1, state.writeParent), (2, state.readParent)):
        if descriptor is None: continue
        info = os.fstat(descriptor); flags = fcntl.fcntl(descriptor, fcntl.F_GETFL)
        identity = (info.st_dev, info.st_ino, info.st_uid, info.st_mode, info.st_nlink, flags)
        if identity != state.identities[position]:
            raise ValueError(f"plan parent pipe changed: {state.identities[position]} -> {identity}")



def plan_stream_complete(state, size):
    complete = (state.writeParent is None and state.ackEOF
                and state.acksReceived == (size+32767)//32768 and not state.ackBuffer)
    if complete: verify_plan_parent_pipes(state)
    return complete
