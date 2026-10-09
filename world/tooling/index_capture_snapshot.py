"""Persistent, bounded input snapshots for supervised capture attempts.

The caller must hold the real namespace and child-index leases before using
these APIs. Cleanup is allowed only after the worker is confirmed terminal, or
after reacquiring both leases proves a previous controller is gone. A terminal
record by itself is not worker-liveness evidence.
"""
import hashlib
import os
from pathlib import Path
import shutil
import stat

from index_controller_state import identity, read_private
from index_execution_snapshot import CONFIGURATION, _capture, _inventory, VerifiedIndexExecution
from index_tooling import (FILES, decode_tooling_manifest, encode_tooling_manifest,
                           verify_index_tooling)

CAPTURE_EXECUTION = "capture.execution"
CAPTURE_RECLAIM = "capture.reclaim"
_MAX_CONTROL_BYTES = 1024 * 1024


def _present(path):
    try:
        path.lstat()
    except FileNotFoundError:
        return False
    return True


def _slot_inventory(root):
    """Inspect both fixed slots without following links; tolerate copy prefixes."""
    root = Path(root)
    slots = (root / CAPTURE_EXECUTION, root / CAPTURE_RECLAIM)
    allowed_files = set(FILES) | {CONFIGURATION}
    allowed_directories = {"world", "world/tooling"}
    charged = 0
    logical = 0
    file_count = 0

    def walk(directory, prefix=""):
        nonlocal charged, logical, file_count
        info = directory.lstat()
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) != 0o700
                or directory.resolve(strict=True) != directory):
            raise ValueError("unsafe capture snapshot directory; preserve it")
        charged += info.st_blocks * 512
        if charged > _MAX_CONTROL_BYTES:
            raise ValueError("capture snapshot exceeds its physical allowance")
        with os.scandir(directory) as entries:
            for entry in entries:
                relative = f"{prefix}/{entry.name}" if prefix else entry.name
                info = entry.stat(follow_symlinks=False)
                if relative in allowed_directories:
                    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
                            or stat.S_IMODE(info.st_mode) != 0o700):
                        raise ValueError("unsafe capture snapshot directory; preserve it")
                    walk(Path(entry.path), relative)
                elif relative in allowed_files:
                    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                            or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) not in (0o400, 0o600)
                            or info.st_size < 0):
                        raise ValueError("unsafe capture snapshot file; preserve it")
                    file_count += 1
                    # The fixed path inventory below bounds directory entries;
                    # this explicit count caps file survivors across both slots.
                    if file_count > 2 * (len(FILES) + 2):
                        raise ValueError("capture snapshot entry limit exceeded")
                    logical += info.st_size
                    charged += max(info.st_size, info.st_blocks * 512)
                else:
                    raise ValueError("capture snapshot contains an unapproved path; preserve it")
                if charged > _MAX_CONTROL_BYTES:
                    raise ValueError("capture snapshot exceeds its physical allowance")

    for slot in slots:
        try:
            slot.lstat()
        except FileNotFoundError:
            continue
        walk(slot)
    return {"logicalBytes": logical, "chargedBytes": charged}


def capture_execution_footprint(root):
    """Return logical and charged usage for both slots, allowing copy prefixes.

    The inventory is intentionally limited to the two named slots, their fixed
    ``world`` directories, and the pinned tooling/configuration files. During
    deterministic prefix creation, regular files may be mode 0600 or 0400.
    """
    return _slot_inventory(root)


def _validate_single_slot(root, selected):
    execution = Path(root) / CAPTURE_EXECUTION
    reclaim = Path(root) / CAPTURE_RECLAIM
    if _present(execution) and _present(reclaim):
        raise ValueError("mixed capture execution/reclaim slots; preserve both")
    if selected == CAPTURE_EXECUTION and _present(reclaim):
        raise ValueError("capture reclaim slot must be reconciled first")
    if selected == CAPTURE_RECLAIM and _present(execution):
        raise ValueError("mixed capture execution/reclaim slots; preserve both")


def _validate_configuration(configuration, source_pin):
    if (type(configuration) is not bytes or type(source_pin) is not dict
            or set(source_pin) != {"sha256", "bytes"}
            or type(source_pin.get("bytes")) is not int
            or type(source_pin.get("sha256")) is not str
            or not 1 <= source_pin["bytes"] <= 64000
            or len(source_pin["sha256"]) != 64
            or any(char not in "0123456789abcdef" for char in source_pin["sha256"])
            or len(configuration) != source_pin["bytes"]
            or hashlib.sha256(configuration).hexdigest() != source_pin["sha256"]):
        raise ValueError("source configuration differs from its retained pin")


def copy_capture_snapshot(root, repository, manifest, configuration, source_pin):
    """Resume deterministic prefix writes into the sole private execution slot."""
    root = Path(root)
    repository = Path(repository)
    execution = root / CAPTURE_EXECUTION
    if type(manifest) is not dict or set(manifest) != {"format", "files"}:
        raise ValueError("capture snapshot requires a decoded fixed tooling manifest")
    if type(manifest["files"]) is not dict or set(manifest["files"]) != set(FILES):
        raise ValueError("capture snapshot manifest differs from fixed tooling inputs")
    raw_manifest = encode_tooling_manifest(manifest)
    manifest_pin = {"bytes": len(raw_manifest), "sha256": hashlib.sha256(raw_manifest).hexdigest()}
    _validate_configuration(configuration, source_pin)
    if _capture(repository, CONFIGURATION, source_pin) != configuration:
        raise ValueError("repository source configuration differs from its supplied bytes")
    _validate_single_slot(root, CAPTURE_EXECUTION)
    try:
        execution.mkdir(mode=0o700)
    except FileExistsError:
        pass
    _slot_inventory(root)

    pins = {**manifest["files"], CONFIGURATION: source_pin}
    for name in (*FILES, CONFIGURATION):
        expected = _capture(repository, name, pins[name])
        directory = execution
        for segment in name.split("/")[:-1]:
            directory = directory / segment
            try:
                directory.mkdir(mode=0o700)
            except FileExistsError:
                pass
            info = directory.lstat()
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
                    or stat.S_IMODE(info.st_mode) != 0o700
                    or directory.resolve(strict=True) != directory):
                raise ValueError("unsafe persistent capture snapshot directory")

        file = directory / name.rsplit("/", 1)[-1]
        try:
            old = read_private(file, pins[name]["bytes"], (0o400, 0o600))
        except FileNotFoundError:
            old = b""
        if not expected.startswith(old):
            raise ValueError("contradictory capture snapshot prefix; preserve state")
        try:
            old_info = file.lstat()
        except FileNotFoundError:
            old_info = None
        if old_info is not None and stat.S_IMODE(old_info.st_mode) == 0o400:
            if old != expected:
                raise ValueError("immutable capture snapshot file is incomplete")
            continue

        directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        descriptor = None
        try:
            try:
                descriptor = os.open(file.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                     0o600, dir_fd=directory_fd)
            except FileExistsError:
                descriptor = os.open(file.name, os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW,
                                     dir_fd=directory_fd)
                if (old_info is None or identity(os.fstat(descriptor)) != identity(old_info)
                        or os.fstat(descriptor).st_size != len(old)):
                    raise ValueError("capture snapshot inode changed")
            view = memoryview(expected)[len(old):]
            while view:
                written = os.write(descriptor, view)
                if written < 1:
                    raise OSError("short persistent capture snapshot write")
                view = view[written:]
            os.fchmod(descriptor, 0o400)
            os.fsync(descriptor)
            os.fsync(directory_fd)
        finally:
            if descriptor is not None:
                os.close(descriptor)
            os.close(directory_fd)

    for directory in (execution / "world/tooling", execution / "world", execution, root):
        descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    _slot_inventory(root)
    _inventory(execution)
    verify_index_tooling(execution, raw_manifest, manifest_pin)
    return execution


def capture_snapshot(root, manifest_bytes, manifest_pin, configuration, source_pin):
    """Verify and describe the complete immutable retained capture snapshot."""
    root = Path(root)
    _validate_configuration(configuration, source_pin)
    _slot_inventory(root)
    _validate_single_slot(root, CAPTURE_EXECUTION)
    execution = root / CAPTURE_EXECUTION
    verify_index_tooling(execution, manifest_bytes, manifest_pin)
    if _capture(execution, CONFIGURATION, source_pin) != configuration:
        raise ValueError("retained capture snapshot configuration differs")
    charged = _inventory(execution)
    return VerifiedIndexExecution(execution, manifest_bytes, dict(manifest_pin),
                                  configuration, dict(source_pin), charged)


def cleanup_capture_snapshot(root, attempt, manifest_bytes, manifest_pin,
                             configuration, source_pin):
    """Reclaim one terminal snapshot after both real leases prove safe cleanup.

    ``attempt`` must be a terminal attempt whose worker is confirmed gone. The
    caller holds both the namespace and child-index leases; after controller
    loss, those newly acquired leases prove the prior owner is gone. A terminal
    phase alone never proves worker liveness. Unknown or unconfirmed workers
    must be preserved rather than signalled, timed out, or scavenged.
    """
    root = Path(root)
    execution = root / CAPTURE_EXECUTION
    reclaim = root / CAPTURE_RECLAIM
    execution_present = _present(execution)
    reclaim_present = _present(reclaim)
    if execution_present and reclaim_present:
        raise ValueError("mixed capture execution/reclaim slots; preserve both")
    if not execution_present and not reclaim_present:
        return
    if (type(attempt) is not dict or attempt.get("phase") != "terminal"
            or type(attempt.get("snapshotDevice")) is not int
            or type(attempt.get("snapshotInode")) is not int
            or attempt["snapshotDevice"] < 0 or attempt["snapshotInode"] < 0):
        raise ValueError("capture snapshot lacks a terminal confirmed attempt; preserve it")
    _validate_configuration(configuration, source_pin)

    attempt_identity = (attempt["snapshotDevice"], attempt["snapshotInode"])
    live = execution if execution_present else reclaim
    info = live.lstat()
    if (info.st_dev, info.st_ino) != attempt_identity:
        raise ValueError("retained capture snapshot inode differs; preserve it")

    if execution_present:
        # Verify every byte and the complete fixed inventory before changing its
        # name. This proves the rename target is exactly the attempt snapshot.
        capture_snapshot(root, manifest_bytes, manifest_pin, configuration, source_pin)
        os.rename(execution, reclaim)
        descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        info = reclaim.lstat()
        if (info.st_dev, info.st_ino) != attempt_identity:
            raise ValueError("capture reclaim inode changed after rename; preserve it")

    _slot_inventory(root)
    manifest = decode_tooling_manifest(manifest_bytes, manifest_pin)
    pins = {**manifest["files"], CONFIGURATION: source_pin}
    # An interrupted rmtree leaves a subset of the original exact tree. Verify
    # every survivor before allowing rmtree to remove the controlled remainder.
    for name, pin in pins.items():
        file = reclaim / name
        try:
            info = file.lstat()
        except FileNotFoundError:
            continue
        if stat.S_IMODE(info.st_mode) != 0o400:
            raise ValueError("capture reclaim survivor mode differs; preserve it")
        _capture(reclaim, name, pin)

    info = reclaim.lstat()
    if (info.st_dev, info.st_ino) != attempt_identity:
        raise ValueError("capture reclaim root changed; preserve it")
    shutil.rmtree(reclaim)
    descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
