"""Bounded read-only verification of fixed index tooling inputs.

This list covers the current engine/runtime helpers, not a future ingestion worker.
No source execution, Node probing, SQLite, writes or dependency auto-discovery.
"""
import hashlib
import json
import os
from pathlib import Path
import stat

from index_binding import _pairs, _nonfinite

FORMAT = "feature-index-tooling-inputs-v1"
MAX_MANIFEST_BYTES = 64000
MAX_SOURCE_BYTES = 1024*1024
MAX_TOTAL_BYTES = 16*1024*1024
FILES = tuple(sorted([
    "world/feature-index.ts", "world/feature-identity.ts", "world/capture-binding.ts",
    "world/capture-request.ts", "world/capture-json.ts", "world/acquire.ts",
    "world/acquisition-errors.ts", "world/pack.ts", "world/validate.ts", "world/types.ts",
    "world/production-types.ts", "world/country-grid.ts", "world/country-grid-types.ts",
    "world/tooling/index_resource_limits.py", "world/tooling/index_writer_lock.py",
    "world/tooling/index_storage_footprint.py", "world/tooling/index_reservations.py",
    "world/tooling/index_binding.py", "world/tooling/index_tooling.py",
    "world/tooling/index_root.py",
    "world/tooling/index_binding_publish.py",
    "world/tooling/index_execution_snapshot.py",
    "world/tooling/index_bootstrap.py",
    "world/tooling/index_bootstrap.ts",
    "world/tooling/index_bootstrap_crash.ts",
    "world/tooling/index_lease_witness.ts",
]))


def _pin(value, maximum):
    if type(value) is not dict or set(value) != {"sha256", "bytes"}:
        raise ValueError("tooling pin requires exact fields")
    digest = value["sha256"]
    if type(digest) is not str or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise ValueError("tooling pin requires exact SHA-256")
    if type(value["bytes"]) is not int or not 1 <= value["bytes"] <= maximum:
        raise ValueError("tooling pin exceeds its byte bound")


def _validate(value):
    if (type(value) is not dict or set(value) != {"format", "files"}
            or type(value["format"]) is not str or value["format"] != FORMAT):
        raise ValueError("unsupported tooling manifest fields/format")
    if type(value["files"]) is not dict or set(value["files"]) != set(FILES):
        raise ValueError("tooling manifest requires every fixed input and no other paths")
    total = 0
    for pin in value["files"].values():
        _pin(pin, MAX_SOURCE_BYTES)
        total += pin["bytes"]
    if total > MAX_TOTAL_BYTES:
        raise ValueError("tooling inputs exceed their aggregate read bound")


def encode_tooling_manifest(value):
    _validate(value)
    raw = json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(",", ":"),
                     allow_nan=False).encode("ascii")
    if len(raw) > MAX_MANIFEST_BYTES:
        raise ValueError("tooling manifest exceeds its byte bound")
    return raw


def decode_tooling_manifest(raw, pin):
    _pin(pin, MAX_MANIFEST_BYTES)
    if (type(raw) is not bytes or len(raw) != pin["bytes"]
            or hashlib.sha256(raw).hexdigest() != pin["sha256"]):
        raise ValueError("tooling manifest bytes differ from their retained pin")
    try:
        value = json.loads(raw.decode("ascii"), object_pairs_hook=_pairs, parse_constant=_nonfinite)
    except (UnicodeError, RecursionError) as error:
        raise ValueError("unsupported tooling manifest encoding/depth") from error
    if encode_tooling_manifest(value) != raw:
        raise ValueError("tooling manifest is not canonical")
    return value


def _directory(info):
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) & 0o022):
        raise ValueError("tooling directories must be owned and not group/world writable")


def _identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns,
            info.st_uid, info.st_mode, info.st_nlink)


def _source_pin(root, name, expected):
    # Only FILES entries reach this helper, through the validated manifest.
    descriptors = []
    observed_directories = []
    file = None
    try:
        before = root.lstat(); _directory(before)
        current = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        descriptors.append(current)
        if _identity(os.fstat(current)) != _identity(before):
            raise ValueError("tooling root changed during open")
        segments = name.split("/")
        for segment in segments[:-1]:
            child = os.open(segment, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current)
            descriptors.append(child)
            info = os.fstat(child); _directory(info)
            observed_directories.append((current, segment, child, info))
            current = child
        file = os.open(segments[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=current)
        info = os.fstat(file)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1
                or stat.S_IMODE(info.st_mode) & 0o022 or info.st_size != expected["bytes"]):
            raise ValueError("tooling file is unsafe or differs from its pinned size")
        digest = hashlib.sha256(); total = 0
        while True:
            chunk = os.read(file, min(65536, expected["bytes"]-total+1))
            if not chunk:
                break
            total += len(chunk)
            if total > expected["bytes"]:
                raise ValueError("tooling file grew beyond its pinned byte bound")
            digest.update(chunk)
        if total != expected["bytes"] or digest.hexdigest() != expected["sha256"]:
            raise ValueError("tooling source bytes differ from their retained pin")
        if (_identity(os.fstat(file)) != _identity(info)
                or _identity(os.stat(segments[-1], dir_fd=current, follow_symlinks=False)) != _identity(info)):
            raise ValueError("tooling file changed during verification")
        for parent, segment, child, original in observed_directories:
            if (_identity(os.fstat(child)) != _identity(original)
                    or _identity(os.stat(segment, dir_fd=parent, follow_symlinks=False)) != _identity(original)):
                raise ValueError("tooling directory changed during verification")
        if root.resolve(strict=True) != root or _identity(root.lstat()) != _identity(before):
            raise ValueError("tooling root changed during verification")
    finally:
        if file is not None:
            os.close(file)
        for descriptor in reversed(descriptors):
            os.close(descriptor)


def verify_index_tooling(root, raw, pin):
    """Compare actual bounded source bytes; does not freeze a later execution tree."""
    manifest = decode_tooling_manifest(raw, pin)
    root = Path(root)
    if not root.is_absolute() or root.resolve(strict=True) != root:
        raise ValueError("tooling root requires an existing canonical absolute path")
    for name in FILES:
        _source_pin(root, name, manifest["files"][name])
    return {"format": FORMAT, "manifestSha256": pin["sha256"], "manifestBytes": pin["bytes"],
            "files": len(FILES), "sourceBytes": sum(p["bytes"] for p in manifest["files"].values())}
