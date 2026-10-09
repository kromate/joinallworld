"""Disposable, verified copies of the fixed index execution inputs.

The snapshot narrows accidental mutation during a supervised run. It is not an
OS immutability boundary against another process owned by the same user.
"""
from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import shutil
import stat
import tempfile

from index_tooling import (FILES, MAX_TOTAL_BYTES, decode_tooling_manifest,
                           verify_index_tooling)
from index_resource_limits import IndexWorkerUnreaped

CONFIGURATION = "world/acquisition-sources.json"
_CONFIG_MAX_BYTES = 64000
_INVENTORY_ALLOWANCE = 1024 * 1024


@dataclass(frozen=True)
class VerifiedIndexExecution:
    root: Path
    manifest_bytes: bytes
    manifest_pin: dict
    source_configuration: bytes
    source_pin: dict
    charged_bytes: int


def _pin(value, maximum, label):
    if type(value) is not dict or set(value) != {"sha256", "bytes"}:
        raise ValueError(f"{label} pin requires exact fields")
    digest = value["sha256"]
    amount = value["bytes"]
    if (type(digest) is not str or len(digest) != 64
            or any(char not in "0123456789abcdef" for char in digest)
            or type(amount) is not int or not 1 <= amount <= maximum):
        raise ValueError(f"{label} pin is invalid or exceeds its byte bound")


def _identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
            info.st_ctime_ns, info.st_uid, info.st_mode, info.st_nlink)


def _owned_directory(info):
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) & 0o022):
        raise ValueError("snapshot source directories must be owned and not group/world writable")


def _capture(root, name, expected):
    """Read one fixed input through no-follow descriptors and return its bytes."""
    descriptors = []
    observed_directories = []
    file_descriptor = None
    try:
        before = root.lstat()
        _owned_directory(before)
        current = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        descriptors.append(current)
        if _identity(os.fstat(current)) != _identity(before):
            raise ValueError("source root changed during open")
        segments = name.split("/")
        for segment in segments[:-1]:
            child = os.open(segment, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                            dir_fd=current)
            descriptors.append(child)
            info = os.fstat(child)
            _owned_directory(info)
            observed_directories.append((current, segment, child, info))
            current = child
        file_descriptor = os.open(segments[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                                  dir_fd=current)
        info = os.fstat(file_descriptor)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) & 0o022
                or info.st_size != expected["bytes"]):
            raise ValueError("source file is unsafe or differs from its pinned size")
        content = bytearray()
        digest = hashlib.sha256()
        while len(content) <= expected["bytes"]:
            chunk = os.read(file_descriptor, min(65536, expected["bytes"] - len(content) + 1))
            if not chunk:
                break
            content.extend(chunk)
            digest.update(chunk)
        if len(content) != expected["bytes"] or digest.hexdigest() != expected["sha256"]:
            raise ValueError("source bytes differ from their retained pin")
        if (_identity(os.fstat(file_descriptor)) != _identity(info)
                or _identity(os.stat(segments[-1], dir_fd=current,
                                    follow_symlinks=False)) != _identity(info)):
            raise ValueError("source file changed during capture")
        for parent, segment, child, original in observed_directories:
            if (_identity(os.fstat(child)) != _identity(original)
                    or _identity(os.stat(segment, dir_fd=parent,
                                         follow_symlinks=False)) != _identity(original)):
                raise ValueError("source directory changed during capture")
        if root.resolve(strict=True) != root or _identity(root.lstat()) != _identity(before):
            raise ValueError("source root changed during capture")
        return bytes(content)
    finally:
        if file_descriptor is not None:
            os.close(file_descriptor)
        for descriptor in reversed(descriptors):
            os.close(descriptor)


def _write_snapshot_file(root, name, content):
    parts = name.split("/")
    directory = root
    for segment in parts[:-1]:
        directory = directory / segment
        try:
            directory.mkdir(mode=0o700)
        except FileExistsError:
            info = directory.lstat()
            if not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700:
                raise ValueError("snapshot directory is not private")
    parent_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    descriptor = None
    try:
        descriptor = os.open(parts[-1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600, dir_fd=parent_fd)
        view = memoryview(content)
        while view:
            written = os.write(descriptor, view)
            if written <= 0:
                raise OSError("short write while creating snapshot input")
            view = view[written:]
        os.fchmod(descriptor, 0o400)
    finally:
        if descriptor is not None:
            os.close(descriptor)
        os.close(parent_fd)


def _inventory(root):
    expected_files = set(FILES) | {CONFIGURATION}
    expected_directories = {"world", "world/tooling"}
    seen_files = set()
    seen_directories = set()
    charged = 0
    count = 0

    def inspect(directory, prefix=""):
        nonlocal charged, count
        with os.scandir(directory) as entries:
            for entry in entries:
                count += 1
                if count > len(expected_files) + len(expected_directories):
                    raise ValueError("snapshot contains too many entries")
                relative = f"{prefix}/{entry.name}" if prefix else entry.name
                info = entry.stat(follow_symlinks=False)
                if relative in expected_directories:
                    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
                            or stat.S_IMODE(info.st_mode) != 0o700):
                        raise ValueError("snapshot directory is unsafe")
                    seen_directories.add(relative)
                    charged += info.st_blocks * 512
                    inspect(Path(entry.path), relative)
                elif relative in expected_files:
                    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                            or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o400):
                        raise ValueError("snapshot file is unsafe")
                    seen_files.add(relative)
                    charged += max(info.st_size, info.st_blocks * 512)
                else:
                    raise ValueError("snapshot contains an unapproved path")

    root_info = root.lstat()
    if (not stat.S_ISDIR(root_info.st_mode) or root_info.st_uid != os.getuid()
            or stat.S_IMODE(root_info.st_mode) != 0o700):
        raise ValueError("snapshot root is not private")
    charged += root_info.st_blocks * 512
    inspect(root)
    if seen_files != expected_files or seen_directories != expected_directories:
        raise ValueError("snapshot is missing a fixed input")
    if charged > MAX_TOTAL_BYTES + _INVENTORY_ALLOWANCE:
        raise ValueError("snapshot exceeds its bounded storage allowance")
    return charged


@contextmanager
def verified_execution_snapshot(repository_root, raw_manifest, manifest_pin,
                                source_configuration, source_pin):
    """Yield a private disposable copy of exactly the pinned runtime inputs.

    Callers must wait for every supervised terminal worker before leaving this
    context. Normal/confirmed-terminal failure cleanup removes the temporary tree;
    IndexWorkerUnreaped preserves it and exposes retained_snapshot for supervision.
    """
    repository_root = Path(repository_root)
    verify_index_tooling(repository_root, raw_manifest, manifest_pin)
    manifest = decode_tooling_manifest(raw_manifest, manifest_pin)
    if type(source_configuration) is not bytes or not 1 <= len(source_configuration) <= _CONFIG_MAX_BYTES:
        raise ValueError("source configuration requires exact bounded bytes")
    _pin(source_pin, _CONFIG_MAX_BYTES, "source configuration")
    if (len(source_configuration) != source_pin["bytes"]
            or hashlib.sha256(source_configuration).hexdigest() != source_pin["sha256"]):
        raise ValueError("source configuration differs from its retained pin")
    config_bytes_pin = {"bytes": len(source_configuration),
                        "sha256": hashlib.sha256(source_configuration).hexdigest()}
    names = (*FILES, CONFIGURATION)
    pins = {**manifest["files"], CONFIGURATION: config_bytes_pin}
    captured = {name: _capture(repository_root, name, pins[name]) for name in names}
    if captured[CONFIGURATION] != source_configuration:
        raise ValueError("repository source configuration differs from the supplied bytes")

    repository_root = repository_root.resolve(strict=True)
    snapshot = Path(tempfile.mkdtemp(prefix="allworld-index-execution-")).resolve(strict=True)
    preserve = False
    try:
        if os.path.commonpath((str(repository_root), str(snapshot.resolve(strict=True)))) == str(repository_root):
            raise ValueError("disposable execution snapshot must be outside the repository")
        os.chmod(snapshot, 0o700)
        for name in names:
            _write_snapshot_file(snapshot, name, captured[name])
        snapshot_world = snapshot / "world"
        # The system temporary root is created privately; retain exact private modes.
        os.chmod(snapshot_world / "tooling", 0o700)
        verify_index_tooling(snapshot, raw_manifest, manifest_pin)
        charged = _inventory(snapshot)
        yield VerifiedIndexExecution(snapshot, raw_manifest, dict(manifest_pin),
                                     source_configuration, dict(source_pin), charged)
    except IndexWorkerUnreaped as error:
        preserve = True
        error.retained_snapshot = snapshot
        raise
    finally:
        if not preserve:
            shutil.rmtree(snapshot)
