"""Crash-resumable, single-writer publication for generated starter cities.

The helper owns only its private staging directory and the exact city directory
and receipt paths supplied by the caller. It never acquires source data or
changes source caches/request ledgers.
"""
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
from contextlib import contextmanager

MAX_ASSET_BYTES = 8 * 1024 * 1024
MAX_TOTAL_ASSET_BYTES = 24 * 1024 * 1024
MAX_RECEIPT_BYTES = 256 * 1024
MAX_INTENT_BYTES = 512 * 1024
MAX_DIRECTORY_ENTRIES = 32
ASSET_NAMES = {"facts.ts", "geometry.ts", "index.ts", "map.ts", "content.ts"}
_DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def _relative(value, label):
    text = os.fspath(value)
    path = Path(text)
    if not text or path.is_absolute() or "\\" in text or "\x00" in text:
        raise ValueError(f"Invalid {label} path")
    parts = text.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise ValueError(f"Invalid {label} path")
    return parts


def _open_dir(root_fd, parts, *, create=False, mode=0o700):
    fd = os.dup(root_fd)
    try:
        for part in parts:
            try:
                child = os.open(part, _DIR_FLAGS, dir_fd=fd)
            except FileNotFoundError:
                if not create:
                    raise ValueError(f"Missing publication directory: {part}")
                try:
                    os.mkdir(part, mode=mode, dir_fd=fd)
                    os.fsync(fd)
                except FileExistsError:
                    pass
                child = os.open(part, _DIR_FLAGS, dir_fd=fd)
            except OSError as error:
                if error.errno in (errno.ELOOP, errno.ENOTDIR):
                    raise ValueError(f"Non-directory or symlink in publication path: {part}") from error
                raise
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def _lstat_at(directory_fd, name):
    try:
        return os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
    except FileNotFoundError:
        return None


def _list_names(directory_fd):
    names = []
    with os.scandir(directory_fd) as entries:
        for entry in entries:
            names.append(entry.name)
            if len(names) > MAX_DIRECTORY_ENTRIES:
                raise ValueError("Publication directory exceeds entry-count limit")
    return set(names)


def _read_at(directory_fd, name, limit, label):
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0), dir_fd=directory_fd)
    except OSError as error:
        if error.errno in (errno.ELOOP, errno.ENXIO):
            raise ValueError(f"{label} must be a regular non-symlink file") from error
        raise
    try:
        metadata = os.fstat(fd)
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError(f"{label} must be a regular file")
        if metadata.st_size > limit:
            raise ValueError(f"{label} exceeds {limit}-byte limit")
        chunks, total = [], 0
        while True:
            chunk = os.read(fd, min(65536, limit + 1 - total))
            if not chunk:
                break
            total += len(chunk)
            if total > limit:
                raise ValueError(f"{label} exceeds {limit}-byte limit")
            chunks.append(chunk)
        return b"".join(chunks)
    finally:
        os.close(fd)


def _write_exclusive(directory_fd, name, raw, mode, label):
    try:
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode, dir_fd=directory_fd)
    except FileExistsError as error:
        raise ValueError(f"Refusing pre-existing {label}: {name}") from error
    try:
        view = memoryview(raw)
        while view:
            written = os.write(fd, view)
            view = view[written:]
        os.fsync(fd)
    finally:
        os.close(fd)


def _write_or_resume_prefix(directory_fd, name, expected, limit, mode, label, checkpoint=None):
    if len(expected) > limit:
        raise ValueError(f"{label} exceeds {limit}-byte limit")
    metadata = _lstat_at(directory_fd, name)
    if metadata is None:
        try:
            fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode, dir_fd=directory_fd)
        except FileExistsError:
            raise ValueError(f"Concurrent {label} creation; retry after inspection")
        prefix = b""
    else:
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.geteuid():
            raise ValueError(f"{label} must be a current-user regular file")
        prefix = _read_at(directory_fd, name, limit, label)
        if len(prefix) > len(expected) or not expected.startswith(prefix):
            raise ValueError(f"{label} contains bytes outside the owned expected prefix")
        fd = os.open(name, os.O_WRONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0), dir_fd=directory_fd)
    try:
        current = os.fstat(fd)
        if not stat.S_ISREG(current.st_mode) or current.st_size != len(prefix):
            raise ValueError(f"{label} changed while opening for prefix recovery")
        if metadata is not None and (current.st_dev != metadata.st_dev or current.st_ino != metadata.st_ino):
            raise ValueError(f"{label} inode changed during prefix recovery")
        if prefix == expected:
            os.fsync(fd)
            return
        os.lseek(fd, len(prefix), os.SEEK_SET)
        cursor = len(prefix)
        if checkpoint is not None:
            split = cursor + max(1, (len(expected) - cursor) // 2)
            split = min(split, len(expected))
            while cursor < split:
                written = os.write(fd, expected[cursor:split])
                if written <= 0:
                    raise OSError("Short write while staging publication bytes")
                cursor += written
            os.fsync(fd)
            _checkpoint(checkpoint, label + "-prefix")
        while cursor < len(expected):
            written = os.write(fd, expected[cursor:])
            if written <= 0:
                raise OSError("Short write while staging publication bytes")
            cursor += written
        os.fsync(fd)
    finally:
        os.close(fd)


def _sync_dir(directory_fd):
    os.fsync(directory_fd)


def _checkpoint(callback, name):
    if callback is not None:
        callback(name)


class _Lease:
    def __init__(self, root, stage_relative, root_fd, stage_parent_fd, fd):
        self.root = root
        self.stage_relative = stage_relative
        self.root_fd = root_fd
        self.stage_parent_fd = stage_parent_fd
        self.fd = fd


@contextmanager
def publication_lease(root, stage_relative):
    """Hold a cooperating local writer lease across validation and publication."""
    root = Path(root).resolve(strict=True)
    stage_parts = _relative(stage_relative, "staging")
    root_fd = os.open(root, _DIR_FLAGS)
    stage_parent_fd = lease_fd = None
    try:
        stage_parent_fd = _open_dir(root_fd, stage_parts[:-1], create=True, mode=0o700)
        parent_metadata = os.fstat(stage_parent_fd)
        if parent_metadata.st_uid != os.geteuid() or stat.S_IMODE(parent_metadata.st_mode) & 0o077:
            raise ValueError("Publication cache must be owned by this user and private (0700)")
        lease_name = ".lease-" + stage_parts[-1]
        lease_fd = os.open(lease_name, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=stage_parent_fd)
        lease_metadata = os.fstat(lease_fd)
        if not stat.S_ISREG(lease_metadata.st_mode) or lease_metadata.st_uid != os.geteuid() or stat.S_IMODE(lease_metadata.st_mode) & 0o077:
            raise ValueError("Publication lease must be a regular file")
        try:
            fcntl.flock(lease_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ValueError("Another cooperating writer holds this city's publication lease") from error
        os.fsync(stage_parent_fd)
        yield _Lease(root, "/".join(stage_parts), root_fd, stage_parent_fd, lease_fd)
    finally:
        if lease_fd is not None:
            os.close(lease_fd)
        if stage_parent_fd is not None:
            os.close(stage_parent_fd)
        os.close(root_fd)


def _asset_state(directory_fd, expected, *, missing_ok=False):
    names = _list_names(directory_fd)
    if not names and missing_ok:
        return False
    if names != set(expected):
        raise ValueError("City directory does not contain exactly the five expected assets")
    for name, raw in expected.items():
        actual = _read_at(directory_fd, name, MAX_ASSET_BYTES, f"city asset {name}")
        if actual != raw:
            raise ValueError(f"Published city asset differs from expected bytes: {name}")
    return True


def _expect_file(directory_fd, name, expected, limit, label):
    metadata = _lstat_at(directory_fd, name)
    if metadata is None:
        return False
    if not stat.S_ISREG(metadata.st_mode):
        raise ValueError(f"{label} must be a regular non-symlink file")
    actual = _read_at(directory_fd, name, limit, label)
    if actual != expected:
        raise ValueError(f"{label} differs from the expected publication bytes")
    return True


def _write_intent(stage_fd, intent_raw):
    pending = "intent.json.pending"
    _write_exclusive(stage_fd, pending, intent_raw, 0o600, "intent temporary")
    os.rename(pending, "intent.json", src_dir_fd=stage_fd, dst_dir_fd=stage_fd)
    _sync_dir(stage_fd)


def _ensure_stage_payload(stage_fd, asset_bytes, receipt_bytes, intent_raw, *, create, allow_assets_recovery=True, checkpoint=None):
    names = _list_names(stage_fd)
    if create:
        if names:
            raise ValueError("Refusing nonempty unowned publication staging directory")
        _write_intent(stage_fd, intent_raw)
        _checkpoint(checkpoint, "intent-durable")
    else:
        marker = _read_at(stage_fd, "intent.json", MAX_INTENT_BYTES, "publication intent")
        if marker != intent_raw:
            raise ValueError("Refusing stale or mismatched publication intent")
        names = _list_names(stage_fd)
        if not names.issubset({"intent.json", "receipt.json", "assets"}):
            raise ValueError("Publication staging directory contains unknown files")
    assets_meta = _lstat_at(stage_fd, "assets")
    if assets_meta is None and allow_assets_recovery:
        os.mkdir("assets", mode=0o755, dir_fd=stage_fd)
        _sync_dir(stage_fd)
        assets_meta = _lstat_at(stage_fd, "assets")
    elif assets_meta is not None and not allow_assets_recovery:
        raise ValueError("Refusing staged city assets after the city directory has published")
    if assets_meta is not None and not stat.S_ISDIR(assets_meta.st_mode):
        raise ValueError("Staged assets must be a real directory")
    if assets_meta is not None:
        assets_fd = os.open("assets", _DIR_FLAGS, dir_fd=stage_fd)
        try:
            present = _list_names(assets_fd)
            if not present.issubset(set(asset_bytes)):
                raise ValueError("Staged assets contain unknown files")
            for name, raw in asset_bytes.items():
                _write_or_resume_prefix(assets_fd, name, raw, MAX_ASSET_BYTES, 0o644,
                                        "staged asset", checkpoint)
            _sync_dir(assets_fd)
        finally:
            os.close(assets_fd)
    _checkpoint(checkpoint, "assets-staged")
    _write_or_resume_prefix(stage_fd, "receipt.json", receipt_bytes, MAX_RECEIPT_BYTES, 0o644,
                            "staged receipt", checkpoint)
    _sync_dir(stage_fd)
    _checkpoint(checkpoint, "receipt-staged")


def _publish_receipt(receipt_fd, receipt_name, expected, stage_fd, checkpoint):
    pending = receipt_name + ".starter-pending"
    final_exists = _expect_file(receipt_fd, receipt_name, expected, MAX_RECEIPT_BYTES, "published receipt")
    pending_meta = _lstat_at(receipt_fd, pending)
    pending_exists = pending_meta is not None
    if final_exists:
        if pending_exists:
            _write_or_resume_prefix(receipt_fd, pending, expected, MAX_RECEIPT_BYTES, 0o644, "pending receipt")
        _sync_dir(receipt_fd)
        if pending_exists:
            os.unlink(pending, dir_fd=receipt_fd)
            _sync_dir(receipt_fd)
        return
    if not pending_exists:
        _write_or_resume_prefix(receipt_fd, pending, expected, MAX_RECEIPT_BYTES, 0o644,
                                "pending receipt", checkpoint)
        _sync_dir(receipt_fd)
        _checkpoint(checkpoint, "receipt-pending-durable")
    else:
        _write_or_resume_prefix(receipt_fd, pending, expected, MAX_RECEIPT_BYTES, 0o644,
                                "pending receipt", checkpoint)
    try:
        os.link(pending, receipt_name, src_dir_fd=receipt_fd, dst_dir_fd=receipt_fd, follow_symlinks=False)
    except FileExistsError:
        # A concurrent external writer is not trusted: it must have written the exact receipt.
        _expect_file(receipt_fd, receipt_name, expected, MAX_RECEIPT_BYTES, "published receipt")
    os.fsync(receipt_fd)
    _checkpoint(checkpoint, "receipt-published")
    os.unlink(pending, dir_fd=receipt_fd)
    _sync_dir(receipt_fd)


def publish_city(root, city_relative, receipt_relative, stage_relative, files, receipt_bytes,
                 identity, source_identity, *, checkpoint=None, lease=None):
    """Publish a complete city and receipt, or resume the exact owned intent.

    `checkpoint` is a test seam invoked at durable state transitions. Production
    callers leave it unset. It must not be used to implement production hooks.
    """
    if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_DIRECTORY") or not hasattr(os, "link"):
        raise ValueError("Atomic starter publication requires no-follow and hardlink support")
    root = Path(root).resolve(strict=True)
    stage_relative = os.fspath(stage_relative)
    if lease is None:
        with publication_lease(root, stage_relative) as held_lease:
            return publish_city(root, city_relative, receipt_relative, stage_relative, files, receipt_bytes,
                                identity, source_identity, checkpoint=checkpoint, lease=held_lease)
    if lease.root != root or lease.stage_relative != "/".join(_relative(stage_relative, "staging")):
        raise ValueError("Publication lease does not match this repository and city")
    city_parts = _relative(city_relative, "city")
    receipt_parts = _relative(receipt_relative, "receipt")
    stage_parts = _relative(stage_relative, "staging")
    if len(city_parts) < 2 or len(receipt_parts) < 2 or len(stage_parts) < 2:
        raise ValueError("Publication paths must be beneath repository directories")
    normalized = {}
    if set(files) != ASSET_NAMES:
        raise ValueError("Publication requires exactly the five city assets")
    total = 0
    for name, value in files.items():
        if name not in ASSET_NAMES or "/" in name or "\\" in name:
            raise ValueError(f"Invalid city asset name: {name}")
        raw = value.encode("utf-8") if isinstance(value, str) else bytes(value)
        if len(raw) > MAX_ASSET_BYTES:
            raise ValueError(f"City asset exceeds {MAX_ASSET_BYTES}-byte limit: {name}")
        total += len(raw)
        normalized[name] = raw
    if total > MAX_TOTAL_ASSET_BYTES:
        raise ValueError("City assets exceed total publication size limit")
    receipt_bytes = bytes(receipt_bytes)
    if len(receipt_bytes) > MAX_RECEIPT_BYTES:
        raise ValueError("Receipt exceeds publication size limit")
    marker_obj = {
        "schemaVersion": 1,
        "identity": identity,
        "sourceIdentity": source_identity,
        "assets": {name: {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()} for name, raw in sorted(normalized.items())},
        "receipt": {"bytes": len(receipt_bytes), "sha256": hashlib.sha256(receipt_bytes).hexdigest()},
    }
    intent_raw = (json.dumps(marker_obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()
    if len(intent_raw) > MAX_INTENT_BYTES:
        raise ValueError("Publication intent exceeds size limit")

    root_fd = os.open(root, _DIR_FLAGS)
    fds = []
    try:
        city_parent_fd = _open_dir(root_fd, city_parts[:-1], create=True, mode=0o755)
        fds.append(city_parent_fd)
        receipt_parent_fd = _open_dir(root_fd, receipt_parts[:-1], create=True, mode=0o755)
        fds.append(receipt_parent_fd)
        stage_parent_fd = _open_dir(root_fd, stage_parts[:-1], create=True, mode=0o700)
        fds.append(stage_parent_fd)
        parent_metadata = os.fstat(stage_parent_fd)
        if parent_metadata.st_uid != os.geteuid() or stat.S_IMODE(parent_metadata.st_mode) & 0o077:
            raise ValueError("Publication cache must be owned by this user and private (0700)")
        if os.fstat(city_parent_fd).st_dev != os.fstat(stage_parent_fd).st_dev:
            raise ValueError("Publication staging and city output must share a filesystem for atomic rename")

        city_name = city_parts[-1]
        receipt_name = receipt_parts[-1]
        stage_name = stage_parts[-1]
        if lease.stage_relative != "/".join(stage_parts) or os.fstat(lease.fd).st_ino != os.stat(".lease-" + stage_name, dir_fd=stage_parent_fd, follow_symlinks=False).st_ino:
            raise ValueError("Publication lease inode does not match the city lease")
        _sync_dir(stage_parent_fd)

        stage_stat = _lstat_at(stage_parent_fd, stage_name)
        stage_exists = stage_stat is not None
        created_stage = False
        if stage_exists and not stat.S_ISDIR(stage_stat.st_mode):
            raise ValueError("Publication staging path must be a real directory")
        if not stage_exists:
            city_exists = _lstat_at(city_parent_fd, city_name) is not None
            receipt_exists = _lstat_at(receipt_parent_fd, receipt_name) is not None
            pending_exists = _lstat_at(receipt_parent_fd, receipt_name + ".starter-pending") is not None
            if pending_exists:
                raise ValueError("Refusing unowned pending receipt without an owned intent")
            if city_exists and receipt_exists:
                city_meta = _lstat_at(city_parent_fd, city_name)
                if not stat.S_ISDIR(city_meta.st_mode):
                    raise ValueError("Existing city output must be a real directory")
                city_fd = os.open(city_name, _DIR_FLAGS, dir_fd=city_parent_fd)
                try:
                    _asset_state(city_fd, normalized)
                finally:
                    os.close(city_fd)
                _expect_file(receipt_parent_fd, receipt_name, receipt_bytes, MAX_RECEIPT_BYTES, "published receipt")
                return "verified-existing"
            if city_exists or receipt_exists:
                raise ValueError("Refusing partial city output or receipt without this publisher's owned intent")
            os.mkdir(stage_name, mode=0o700, dir_fd=stage_parent_fd)
            _sync_dir(stage_parent_fd)
            stage_exists = True
            created_stage = True
            _checkpoint(checkpoint, "stage-created")

        stage_fd = os.open(stage_name, _DIR_FLAGS, dir_fd=stage_parent_fd)
        fds.append(stage_fd)
        stage_metadata = os.fstat(stage_fd)
        if stage_metadata.st_uid != os.geteuid() or stat.S_IMODE(stage_metadata.st_mode) != 0o700:
            raise ValueError("Publication staging directory must remain current-user-owned and private (0700)")
        stage_names = _list_names(stage_fd)
        marker_stat = _lstat_at(stage_fd, "intent.json")
        if marker_stat is not None and (not stat.S_ISREG(marker_stat.st_mode)
                or marker_stat.st_uid != os.geteuid() or stat.S_IMODE(marker_stat.st_mode) != 0o600):
            raise ValueError("Publication intent must remain a current-user private regular file (0600)")
        city_before_stage = _lstat_at(city_parent_fd, city_name)
        allow_assets_recovery = city_before_stage is None
        if marker_stat is None:
            if stage_names or not created_stage:
                raise ValueError("Refusing unowned partial publication staging directory")
            _ensure_stage_payload(stage_fd, normalized, receipt_bytes, intent_raw, create=True,
                                  allow_assets_recovery=allow_assets_recovery, checkpoint=checkpoint)
        else:
            _ensure_stage_payload(stage_fd, normalized, receipt_bytes, intent_raw, create=False,
                                  allow_assets_recovery=allow_assets_recovery)

        city_meta = _lstat_at(city_parent_fd, city_name)
        if city_meta is None:
            assets_meta = _lstat_at(stage_fd, "assets")
            if assets_meta is None or not stat.S_ISDIR(assets_meta.st_mode):
                raise ValueError("Owned intent has no staged assets and no published city directory")
            assets_fd = os.open("assets", _DIR_FLAGS, dir_fd=stage_fd)
            try:
                _asset_state(assets_fd, normalized)
            finally:
                os.close(assets_fd)
            os.rename("assets", city_name, src_dir_fd=stage_fd, dst_dir_fd=city_parent_fd)
            _sync_dir(city_parent_fd)
            _sync_dir(stage_fd)
            _checkpoint(checkpoint, "city-published")
        else:
            if not stat.S_ISDIR(city_meta.st_mode):
                raise ValueError("Existing city output must be a real non-symlink directory")
            city_fd = os.open(city_name, _DIR_FLAGS, dir_fd=city_parent_fd)
            try:
                _asset_state(city_fd, normalized)
            finally:
                os.close(city_fd)

        _publish_receipt(receipt_parent_fd, receipt_name, receipt_bytes, stage_fd, checkpoint)
        return "published"
    finally:
        for fd in reversed(fds):
            try:
                os.close(fd)
            except OSError:
                pass
        os.close(root_fd)
