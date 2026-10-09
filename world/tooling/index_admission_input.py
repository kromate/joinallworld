"""Bounded readonly binding input for the fixed supervised admission worker."""
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile

from index_binding import decode_index_binding, _pairs, _nonfinite
from index_controller_record import decode_controller_record, FORMAT_V2
from index_controller_state import RECORD, read_private
from index_resource_limits import IndexWorkerUnreaped

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
    raw = bytes(raw); expected = binding_pin(raw)
    record = decode_controller_record(read_private(root/RECORD))
    if (record["format"] != FORMAT_V2 or not record["attempts"]
            or record["attempts"][-1]["phase"] != "prepared"
            or record["attempts"][-1]["snapshotDevice"] is None
            or record["attempts"][-1]["operation"] != {"kind": "admit", "binding": expected}):
        raise ValueError("admission input lacks its exact prepared durable operation")
    configuration = read_private(Path(__file__).resolve().parent.parent/"acquisition-sources.json", 64000, (0o400,))
    source_pin = {"sha256": hashlib.sha256(configuration).hexdigest(), "bytes": len(configuration)}
    if source_pin != record["sourceConfiguration"]:
        raise ValueError("admission execution source differs from its durable record")
    validate_admission_binding(raw, record["toolingManifest"], source_pin, configuration)
    return raw
