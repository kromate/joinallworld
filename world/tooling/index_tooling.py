"""Bounded read-only verification of fixed index tooling inputs.

This list covers the fixed engine/runtime helpers and verified-capture worker.
No source execution, Node probing, SQLite, writes or dependency auto-discovery.
"""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

from index_binding import _pairs, _nonfinite

FORMAT = "feature-index-tooling-inputs-v1"
MAX_MANIFEST_BYTES = 64000
MAX_SOURCE_BYTES = 1024*1024
MAX_TOTAL_BYTES = 16*1024*1024
HERE = Path(__file__).resolve().parent
WORKERS = {
    "capacity": HERE / "profile_feature_identity.ts",
    "witness": HERE / "index_resource_witness.mjs",
    "identity-stress": HERE / "index_identity_stress.ts",
    # Direct node:test module entry (no --test subprocess): sampled RSS covers the writer.
    "index-engine-tests": HERE.parent / "feature-index.test.ts",
    "index-engine-capacity": HERE / "profile_feature_index.ts",
    "lease-witness": HERE / "index_lease_witness.ts",
    "index-engine-bootstrap": HERE / "index_bootstrap.ts",
    "index-bootstrap-crash": HERE / "index_bootstrap_crash.ts",
    "index-capture-ingest": HERE / "index_ingest.ts",
    "index-capture-audit": HERE / "index_audit.ts",
    "index-ingest-crash": HERE / "index_ingest_crash.ts",
    "index-registry-startup": HERE / "index_registry_worker.py",
    "index-registry-admit": HERE / "index_admission_worker.py",
    "index-registry-admit-crash": HERE / "index_admission_worker.py",
    "index-registry-admit-plan": HERE / "index_admission_worker.py",
    "index-registry-admit-plan-crash": HERE / "index_admission_worker.py",
    "index-registry-verify-plan": HERE / "index_admission_worker.py",
    "index-registry-lease-witness": HERE / "index_registry_worker.py",
    "index-registry-plan-witness": HERE / "index_admission_worker.py",
}
CASES = {"commit", "file-limit", "heap-capability", "page-limit", "crash", "wall-limit", "cpu-limit", "rss-limit", "output-limit"}
BOOTSTRAP_CASES = {"empty-file", "schema-checkpointed", "before-rename", "after-rename"}
INGEST_CASES = {"before-transaction", "after-commit", "after-checkpoint"}
ADMISSION_CASES = {"reserved", "binding-published"}
PLAN_ADMISSION_CASES = {"before-charge", "charged", "root-published"}
FILES = tuple(sorted([
    "world/feature-index.ts", "world/feature-index-audit.ts", "world/feature-identity.ts", "world/capture-binding.ts",
    "world/capture-request.ts", "world/capture-json.ts", "world/acquire.ts",
    "world/acquisition-errors.ts", "world/pack.ts", "world/validate.ts", "world/types.ts",
    "world/production-types.ts", "world/country-grid.ts", "world/country-grid-types.ts",
    "world/tooling/index_resource_limits.py", "world/tooling/index_writer_lock.py",
    "world/tooling/index_storage_footprint.py", "world/tooling/index_reservations.py",
    "world/tooling/index_binding.py", "world/tooling/index_tooling.py",
    "world/tooling/index_root.py",
    "world/tooling/index_namespace.py",
    "world/tooling/index_registry_worker.py",
    "world/tooling/index_registry_startup.py",
    "world/tooling/index_controller_record.py",
    "world/tooling/index_controller_state.py",
    "world/tooling/index_registry_controller.py",
    "world/tooling/index_binding_publish.py",
    "world/tooling/index_execution_snapshot.py",
    "world/tooling/index_bootstrap.py",
    "world/tooling/index_bootstrap.ts",
    "world/tooling/index_bootstrap_crash.ts",
    "world/tooling/index_audit.ts", "world/tooling/index_audit_controller.py",
    "world/tooling/index_ingest.py",
    "world/tooling/index_ingest.ts",
    "world/tooling/index_ingest_crash.ts",
    "world/tooling/index_capture_record.py",
    "world/tooling/index_capture_state.py",
    "world/tooling/index_capture_snapshot.py",
    "world/tooling/index_capture_controller.py",
    "world/tooling/index_admission_input.py",
    "world/tooling/index_admission_worker.py",
    "world/tooling/index_admission.py",
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


def source_snapshot_allowance(manifest, configuration_bytes):
    """8KiB file rounding plus fixed directory/metadata margin, before copying.

    Snapshot inventories independently enforce actual allocation and their1MiB
    cap; a filesystem allocating more than this estimate is refused before use.
    """
    _validate(manifest)
    if type(configuration_bytes) is not int or not 1 <= configuration_bytes <= 64000:
        raise ValueError("source configuration bytes exceed their fixed bound")
    sizes = [pin["bytes"] for pin in manifest["files"].values()] + [configuration_bytes]
    return sum((size+8191)//8192*8192 for size in sizes) + 4*8192 + 65536


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


def _capture(root, name, expected):
    """Read one bounded pinned source via no-follow descriptors and return bytes."""
    descriptors = []
    observed_directories = []
    file = None
    try:
        before = root.lstat()
        _directory(before)
        current = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        descriptors.append(current)
        if _identity(os.fstat(current)) != _identity(before):
            raise ValueError("source root changed during open")
        segments = name.split("/")
        for segment in segments[:-1]:
            child = os.open(segment, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current)
            descriptors.append(child)
            info = os.fstat(child)
            _directory(info)
            observed_directories.append((current, segment, child, info))
            current = child
        file = os.open(segments[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=current)
        info = os.fstat(file)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1
                or stat.S_IMODE(info.st_mode) & 0o022 or info.st_size != expected["bytes"]):
            raise ValueError("source file is unsafe or differs from its pinned size")
        content = bytearray()
        digest = hashlib.sha256()
        while len(content) <= expected["bytes"]:
            chunk = os.read(file, min(65536, expected["bytes"] - len(content) + 1))
            if not chunk:
                break
            content.extend(chunk)
            digest.update(chunk)
        if len(content) != expected["bytes"] or digest.hexdigest() != expected["sha256"]:
            raise ValueError("source bytes differ from their retained pin")
        if (_identity(os.fstat(file)) != _identity(info)
                or _identity(os.stat(segments[-1], dir_fd=current, follow_symlinks=False)) != _identity(info)):
            raise ValueError("source file changed during capture")
        for parent, segment, child, original in observed_directories:
            if (_identity(os.fstat(child)) != _identity(original)
                    or _identity(os.stat(segment, dir_fd=parent, follow_symlinks=False)) != _identity(original)):
                raise ValueError("source directory changed during capture")
        if root.resolve(strict=True) != root or _identity(root.lstat()) != _identity(before):
            raise ValueError("source root changed during capture")
        return bytes(content)
    finally:
        if file is not None:
            os.close(file)
        for descriptor in reversed(descriptors):
            os.close(descriptor)



def _plan_pipe_flags(flags):
    """Darwin F_GETFL exposes kernel FWASWRITTEN history after pipe writes."""
    return flags & ~0x10000 if sys.platform == "darwin" else flags


def _private_plan_pipe(info):
    """Recognize exact platform anonymous-pipe metadata; flags are checked by caller."""
    if not stat.S_ISFIFO(info.st_mode) or info.st_uid != os.getuid(): return False
    if sys.platform == "darwin":
        return stat.S_IMODE(info.st_mode)==0o660 and info.st_dev==0 and info.st_nlink==0
    return stat.S_IMODE(info.st_mode)==0o600 and info.st_nlink in {0,1}


def _source_pin(root, name, expected):
    # Only FILES entries reach this helper, through the validated manifest.
    try: _capture(root, name, expected)
    except ValueError as error: raise ValueError(f"tooling verification failed: {error}") from error


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
