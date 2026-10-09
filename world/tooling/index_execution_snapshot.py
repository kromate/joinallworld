"""Disposable, verified copies of the fixed index execution inputs.

The snapshot narrows accidental mutation during a supervised run. It is not an
OS immutability boundary against another process owned by the same user.
"""
from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
import os
import re
from pathlib import Path
import shutil
import stat
import tempfile

from index_tooling import (FILES, MAX_TOTAL_BYTES, _capture, _identity,
                           _directory as _owned_directory,
                           decode_tooling_manifest, verify_index_tooling)
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


def _copy_snapshot(root, repository, manifest, configuration, source_pin):
    from index_controller_state import EXECUTION, footprint, identity, read_private
    execution = root/EXECUTION
    try: execution.mkdir(mode=0o700)
    except FileExistsError: pass
    footprint(root)
    pins = {**manifest["files"], CONFIGURATION:source_pin}
    for name in (*FILES, CONFIGURATION):
        expected = _capture(repository, name, pins[name])
        file = execution/name; directory = execution
        for segment in name.split("/")[:-1]:
            directory = directory/segment
            try: directory.mkdir(mode=0o700)
            except FileExistsError: pass
            info = directory.lstat()
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
                    or stat.S_IMODE(info.st_mode) != 0o700 or directory.resolve(strict=True) != directory):
                raise ValueError("unsafe persistent snapshot directory")
        try: old = read_private(file, pins[name]["bytes"], (0o400,0o600))
        except FileNotFoundError: old = b""
        if not expected.startswith(old): raise ValueError("contradictory snapshot prefix; preserve state")
        directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        descriptor = None
        try:
            try: descriptor = os.open(file.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,0o600,dir_fd=directory_fd)
            except FileExistsError:
                info = file.lstat()
                if stat.S_IMODE(info.st_mode)==0o400:
                    if old!=expected: raise ValueError("immutable snapshot file is incomplete")
                    continue
                descriptor = os.open(file.name,os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW,dir_fd=directory_fd)
                if identity(os.fstat(descriptor)) != identity(info): raise ValueError("snapshot inode changed")
            view = memoryview(expected)[len(old):]
            while view:
                written=os.write(descriptor,view)
                if written<1: raise OSError("short persistent snapshot write")
                view=view[written:]
            os.fchmod(descriptor,0o400); os.fsync(descriptor); os.fsync(directory_fd)
        finally:
            if descriptor is not None: os.close(descriptor)
            os.close(directory_fd)
    for directory in [execution/"world/tooling",execution/"world",execution,root]:
        descriptor=os.open(directory,os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try: os.fsync(descriptor)
        finally: os.close(descriptor)
    return execution


def _snapshot(root, manifest_bytes, manifest_pin, configuration, source_pin):
    from index_controller_state import EXECUTION
    execution=root/EXECUTION
    verify_index_tooling(execution,manifest_bytes,manifest_pin)
    if _capture(execution,CONFIGURATION,source_pin)!=configuration: raise ValueError("retained snapshot configuration differs")
    charged=_inventory(execution)
    return VerifiedIndexExecution(execution,manifest_bytes,dict(manifest_pin),configuration,dict(source_pin),charged)


def _plan_pipe():
    values = [os.environ.get("WORLD_INDEX_PLAN_" + name) for name in
              ("DESCRIPTOR", "ACK_DESCRIPTOR", "BYTES", "SHA256")]
    read_fd, ack_fd, length, digest = values
    if (any(type(value) is not str for value in values)
            or any(not value.isascii() or not value.isdigit() for value in values[:3])
            or len(read_fd) > 10 or len(ack_fd) > 10 or len(length) > 7
            or not re.fullmatch(r"[a-f0-9]{64}", digest)):
        raise ValueError("plan pipes require exact bounded transport pins")
    pin = {"sha256": digest, "bytes": int(length)}
    if not 1 <= pin["bytes"] <= 2 * 1024 * 1024:
        raise ValueError("plan pipes exceed their fixed byte bound")
    return int(read_fd), int(ack_fd), pin


def _read_plan_transport(namespace_descriptor, expected_pin=None):
    """Consume the fixed bounded plan-pipe frame and return its bytes and pin."""
    from index_registry_worker import read_plan_stream
    read_fd, ack_fd, pin = _plan_pipe()
    if expected_pin is not None and pin != expected_pin:
        raise ValueError("plan pipes differ from the exact durable pin")
    raw, receipt = read_plan_stream(read_fd, ack_fd, namespace_descriptor, pin)
    return raw, pin, receipt


def read_admission_base_input(root, namespace_descriptor, plan_pin):
    """Read an exact plan/base pair for the prepared V3 shard operation."""
    from index_admission_input import (_read_binding_descriptor, binding_pin,
                                       validate_admission_binding)
    from index_controller_record import decode_controller_record, FORMAT_V3
    from index_controller_state import RECORD, read_private
    plan_pin = dict(plan_pin) if type(plan_pin) is dict else plan_pin
    if (type(plan_pin) is not dict or set(plan_pin) != {"sha256", "bytes"}
            or type(plan_pin["sha256"]) is not str
            or not re.fullmatch(r"[a-f0-9]{64}", plan_pin["sha256"])
            or type(plan_pin["bytes"]) is not int
            or not 1 <= plan_pin["bytes"] <= 2 * 1024 * 1024):
        raise ValueError("shard admission requires its exact bounded plan pin")
    base_raw = _read_binding_descriptor(namespace_descriptor)
    base_pin = binding_pin(base_raw)
    record = decode_controller_record(read_private(root / RECORD))
    operation = {"kind": "admit-plan", "plan": plan_pin, "baseBinding": base_pin}
    attempts = record["attempts"]
    if (record["format"] != FORMAT_V3 or record.get("operation") != operation or not attempts
            or attempts[-1]["phase"] != "prepared" or attempts[-1]["operation"] != operation
            or attempts[-1]["snapshotDevice"] is None):
        raise ValueError("shard admission lacks its exact prepared V3 operation")
    snapshot = (root / "controller.execution").lstat()
    attempt = attempts[-1]
    if (not stat.S_ISDIR(snapshot.st_mode) or snapshot.st_uid != os.getuid()
            or stat.S_IMODE(snapshot.st_mode) != 0o700
            or (snapshot.st_dev, snapshot.st_ino) !=
                (attempt["snapshotDevice"], attempt["snapshotInode"])):
        raise ValueError("prepared execution snapshot identity differs from durable state")
    config_path = Path(__file__).resolve().parent.parent.parent / CONFIGURATION
    config = read_private(config_path, 64000, (0o400,))
    source_pin = {"sha256": hashlib.sha256(config).hexdigest(), "bytes": len(config)}
    if source_pin != record["sourceConfiguration"]:
        raise ValueError("source configuration pin differs")
    validate_admission_binding(base_raw, record["toolingManifest"], source_pin, config)
    raw, _, receipt = _read_plan_transport(namespace_descriptor, plan_pin)
    return raw, base_raw, receipt


def _cleanup(root, record, manifest_bytes, manifest_pin, configuration, source_pin):
    from index_controller_state import EXECUTION, RECLAIM, footprint, read_private
    from index_tooling import decode_tooling_manifest
    execution=root/EXECUTION
    reclaim=root/RECLAIM
    try: info=execution.lstat()
    except FileNotFoundError:
        try: info=reclaim.lstat()
        except FileNotFoundError: return
    attempt=record["attempts"][-1]
    if (info.st_dev,info.st_ino)!=(attempt["snapshotDevice"],attempt["snapshotInode"]):
        raise ValueError("retained snapshot inode differs; preserve it")
    if execution.exists():
        if reclaim.exists() or reclaim.is_symlink(): raise ValueError("mixed execution/reclaim slots; preserve both")
        _snapshot(root,manifest_bytes,manifest_pin,configuration,source_pin)
        os.rename(execution,reclaim)
        descriptor=os.open(root,os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try: os.fsync(descriptor)
        finally: os.close(descriptor)
    footprint(root)
    pins={**decode_tooling_manifest(manifest_bytes,manifest_pin)["files"],CONFIGURATION:source_pin}
    for name,expected in pins.items():
        file=reclaim/name
        try: file.lstat()
        except FileNotFoundError: continue
        if stat.S_IMODE(file.lstat().st_mode)!=0o400:
            raise ValueError("reclaim survivor mode differs; preserve it")
        _capture(reclaim,name,expected)
    if (reclaim.lstat().st_dev,reclaim.lstat().st_ino)!=(info.st_dev,info.st_ino):
        raise ValueError("reclaim root changed; preserve it")
    shutil.rmtree(reclaim)
    descriptor=os.open(root,os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)


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
