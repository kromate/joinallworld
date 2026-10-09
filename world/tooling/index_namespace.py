"""Resumable registry filesystem opener under one cooperative POSIX namespace lease.

Requires an existing private root and inherited kernel per-file limit. CPU/wall/RSS
supervision and persistent controller/worker recovery remain external prerequisites;
this context manager alone is not an unattended campaign or process supervisor.
"""
from contextlib import contextmanager
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import resource
import sqlite3
import stat
from urllib.parse import quote

from index_reservations import (
    IndexReservations, DATABASE_BYTES, REGISTRY_ALLOWANCE, FORMAT,
    APPLICATION_ID, SCHEMA_HASH, MAX_RESERVATIONS,
)
from index_writer_lock import IndexWriterLease, index_writer_lease
import index_root
from index_binding import decode_index_binding
from index_storage_footprint import index_storage_footprint

PAGE_BYTES = 4096
MIN_AGGREGATE_BYTES = REGISTRY_ALLOWANCE + 65536
MAX_AGGREGATE_BYTES = 512 * 1024 * 1024
META_BYTES = 4096
FIXED_FILES = frozenset({
    "writer.lock", "namespace.pending", "namespace.json",
    "reservations.bootstrap.sqlite", "reservations.bootstrap.sqlite-wal",
    "reservations.bootstrap.sqlite-shm", "reservations.bootstrap.sqlite-journal",
    "reservations.sqlite", "reservations.sqlite-wal", "reservations.sqlite-shm",
    "reservations.sqlite-journal",
})
_DB_FILES = {
    "bootstrap": ("reservations.bootstrap.sqlite", "reservations.bootstrap.sqlite-wal",
                  "reservations.bootstrap.sqlite-shm", "reservations.bootstrap.sqlite-journal"),
    "final": ("reservations.sqlite", "reservations.sqlite-wal", "reservations.sqlite-shm",
              "reservations.sqlite-journal"),
}


def _aggregate(value):
    if type(value) is not int or not MIN_AGGREGATE_BYTES <= value <= MAX_AGGREGATE_BYTES:
        raise ValueError("namespace budget exceeds its fixed allowance bound")
    return value


def namespace_binding(aggregate_bytes):
    """Return the one canonical durable binding for this registry format/runtime."""
    aggregate = _aggregate(aggregate_bytes)
    data = {
        "format": "feature-index-namespace-v1",
        "reservationFormat": FORMAT,
        "schemaSha256": SCHEMA_HASH,
        "aggregateBytes": aggregate,
        "applicationId": APPLICATION_ID,
        "pageBytes": PAGE_BYTES,
        "sqliteVersion": sqlite3.sqlite_version,
    }
    return (json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n").encode("ascii")


@dataclass(frozen=True)
class OpenIndexNamespace:
    lease: IndexWriterLease
    registry: IndexReservations
    binding_bytes: bytes
    replayed: bool


def _identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _root(root):
    root = Path(root)
    if not root.is_absolute() or root.resolve(strict=True) != root:
        raise ValueError("namespace root must be an existing canonical absolute path")
    info = root.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) != 0o700):
        raise ValueError("namespace root must be an owned private 0700 directory")
    return root, info


def _read_owned(root, name, maximum, exact=None, prefix=None):
    flags = os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0)
    descriptor = os.open(root / name, flags)
    try:
        before = os.fstat(descriptor)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid()
                or before.st_nlink != 1 or stat.S_IMODE(before.st_mode) != 0o600
                or not 0 <= before.st_size <= maximum):
            raise ValueError(f"unsafe private namespace file {name}; preserve it")
        content = bytearray()
        while len(content) <= maximum:
            part = os.read(descriptor, min(65536, maximum + 1 - len(content)))
            if not part:
                break
            content.extend(part)
        after = os.fstat(descriptor)
        named = (root / name).lstat()
        if _identity(before) != _identity(after) or _identity(before) != _identity(named):
            raise ValueError(f"namespace file {name} changed during inspection")
        raw = bytes(content)
        if len(raw) != before.st_size or len(raw) > maximum:
            raise ValueError(f"namespace file {name} exceeds its inspected bound")
        if exact is not None and raw != exact:
            raise ValueError(f"namespace metadata {name} differs; preserve it")
        if prefix is not None and (len(raw) > len(prefix) or prefix[:len(raw)] != raw):
            raise ValueError(f"namespace metadata {name} is contradictory; preserve it")
        return raw
    finally:
        os.close(descriptor)


def _db_file(root, name):
    path = root / name
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1
            or stat.S_IMODE(info.st_mode) != 0o600 or not 0 <= info.st_size <= DATABASE_BYTES):
        raise ValueError(f"unsafe or oversized namespace database {name}; preserve it")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0))
    try:
        opened = os.fstat(descriptor)
        named = path.lstat()
        if _identity(opened) != _identity(info) or _identity(named) != _identity(info):
            raise ValueError(f"namespace database {name} changed during inspection")
        header = os.read(descriptor, 100)
        if _identity(os.fstat(descriptor)) != _identity(info) or _identity(path.lstat()) != _identity(info):
            raise ValueError(f"namespace database {name} changed while reading its header")
        if name in {"reservations.sqlite", "reservations.bootstrap.sqlite"}:
            empty_stage = name == "reservations.bootstrap.sqlite" and info.st_size == 0
            if not empty_stage:
                if (len(header) != 100 or header[:16] != b"SQLite format 3\0"
                        or int.from_bytes(header[16:18], "big") != PAGE_BYTES):
                    raise ValueError("namespace database header is foreign; preserve it")
                app = int.from_bytes(header[68:72], "big")
                version = int.from_bytes(header[60:64], "big")
                if ((app, version) != (APPLICATION_ID, 1)
                        and not (name == "reservations.bootstrap.sqlite" and (app, version) == (0, 0))):
                    raise ValueError("namespace database application/version is foreign; preserve it")
    finally:
        os.close(descriptor)


def _readonly_registry(path, aggregate, *, final):
    """Inspect bounded schema/charge stamps under the actual namespace lease.

    mode=ro can update SQLite's shared-memory sidecar; never call before leasing.
    Reuse only the reservation engine's read-only verification methods, not its
    constructor (which configures WAL/checkpoints and may initialize a schema).
    """
    uri = "file:" + quote(str(path), safe="/") + "?mode=ro"
    db = sqlite3.connect(uri, uri=True, isolation_level=None, timeout=0.25)
    try:
        if (db.execute("PRAGMA page_size").fetchone()[0] != PAGE_BYTES
                or db.execute("PRAGMA page_count").fetchone()[0] > DATABASE_BYTES // PAGE_BYTES):
            raise ValueError("namespace registry exceeds its page bound; preserve it")
        app = db.execute("PRAGMA application_id").fetchone()[0]
        version = db.execute("PRAGMA user_version").fetchone()[0]
        objects = db.execute("SELECT count(*) FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'").fetchone()[0]
        if not final and not objects and (app, version) == (0, 0):
            if db.execute("PRAGMA integrity_check").fetchmany(2) != [("ok",)]:
                raise ValueError("empty namespace SQLite integrity check failed; preserve it")
            if db.execute("PRAGMA foreign_key_check").fetchone() is not None:
                raise ValueError("empty namespace SQLite foreign-key check failed; preserve it")
            return {}
        inspector = object.__new__(IndexReservations)
        inspector.db = db
        inspector._aggregate_bytes = aggregate
        inspector.failed = False
        inspector._verify_schema()  # Fixed schema2/meta6 and bounded fields before retrieval.
        state = inspector._verify_rows()  # <=256, exact amounts/stamps/totals/digest; no writes.
        if not final and state["reservations"]:
            raise ValueError("bootstrap namespace registry must remain empty")
        if db.execute("PRAGMA integrity_check").fetchmany(2) != [("ok",)]:
            raise ValueError("namespace SQLite integrity check failed; preserve it")
        if db.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise ValueError("namespace SQLite foreign-key check failed; preserve it")
        held = {}
        for key, binding, amount in db.execute("SELECT hash,binding,reserved_bytes FROM reservations"):
            config = decode_index_binding(binding)
            if config["reservedBytes"] != amount:
                raise ValueError("namespace binding differs from its immutable charged allowance")
            held[key] = (binding, config)
        return held
    finally:
        db.close()


def _preflight(root, expected, aggregate, *, leased=False):
    """Classify bounded entries before index_writer_lease can create writer.lock."""
    names = index_root._names(root, MAX_RESERVATIONS + len(FIXED_FILES))
    name_set = set(names)
    if (name_set.intersection(_DB_FILES["bootstrap"]) and name_set.intersection(_DB_FILES["final"])):
        raise ValueError("mixed bootstrap and final registries are preserved")
    unknown = name_set - FIXED_FILES
    dirs = []
    overhead = root.lstat().st_blocks * 512
    for name in names:
        path = root / name
        info = path.lstat()
        if name in FIXED_FILES:
            overhead += max(info.st_size, info.st_blocks * 512)
            if name == "writer.lock":
                if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1
                        or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size != 0):
                    raise ValueError("namespace writer lock is unsafe; preserve it")
            elif name in {"namespace.pending", "namespace.json"}:
                _read_owned(root, name, META_BYTES,
                            exact=expected if name == "namespace.json" else None,
                            prefix=expected if name == "namespace.pending" else None)
            else:
                _db_file(root, name)
        else:
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
                    or stat.S_IMODE(info.st_mode) != 0o700):
                raise ValueError("unknown or unsafe namespace entry is preserved")
            dirs.append(name)
    if overhead > REGISTRY_ALLOWANCE:
        raise ValueError("actual namespace registry overhead exceeds its declared allowance")
    if unknown:
        # Directories are potential charged children, but only after a complete final registry.
        if unknown != set(dirs):
            raise ValueError("unknown namespace entry is preserved")
    pending = "namespace.pending" in name_set
    metadata = "namespace.json" in name_set
    bootstrap = any(n in name_set for n in _DB_FILES["bootstrap"])
    final = any(n in name_set for n in _DB_FILES["final"])
    if pending and (metadata or bootstrap or final or dirs or "writer.lock" not in name_set):
        raise ValueError("staged namespace metadata alongside registry/data is preserved")
    if bootstrap and final:
        raise ValueError("mixed bootstrap and final registries are preserved")
    if (bootstrap or final or dirs) and not metadata:
        raise ValueError("unbound namespace data is preserved")
    if dirs and (not final or bootstrap or pending):
        raise ValueError("charged child directories require the final registry and metadata")
    for kind in ("bootstrap", "final"):
        main, *sidecars = _DB_FILES[kind]
        if main not in name_set and any(side in name_set for side in sidecars):
            raise ValueError("orphan namespace database sidecar is preserved")
        if main in name_set and (root/main).lstat().st_size == 0 and any(side in name_set for side in sidecars):
            raise ValueError("empty namespace database with sidecars is preserved")
    if ("reservations.bootstrap.sqlite" in name_set and "reservations.sqlite" in name_set):
        raise ValueError("mixed bootstrap and final registries are preserved")
    if any(not re.fullmatch(r"[a-f0-9]{64}", name) for name in dirs):
        raise ValueError("unknown namespace child directory is preserved")
    if not leased:
        return name_set  # Files/header only: no SQLite connection or child-lock mutation.
    held = {}
    if final:
        if "reservations.sqlite" not in name_set:
            raise ValueError("final namespace sidecars lack their database")
        held = _readonly_registry(root / "reservations.sqlite", aggregate, final=True)
    if bootstrap:
        if "reservations.bootstrap.sqlite" not in name_set:
            raise ValueError("bootstrap namespace sidecars lack their database")
        _readonly_registry(root / "reservations.bootstrap.sqlite", aggregate, final=False)
    if any(not re.fullmatch(r"[a-f0-9]{64}", name) or name not in held for name in dirs):
        raise ValueError("unknown or uncharged namespace child directory is preserved")
    for name in dirs:
        binding, config = held[name]
        child = root / name
        index_root._binding(child, binding)
        with index_writer_lease(child) as lease:
            index_root._binding(child, binding)
            index_storage_footprint(lease, file_bytes=config["processLimits"]["fileBytes"],
                                    aggregate_bytes=config["reservedBytes"])
    return name_set


def _publish_metadata(root, expected):
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    descriptor = None
    try:
        initial = os.fstat(directory)
        pending = root / "namespace.pending"
        final = root / "namespace.json"
        try:
            descriptor = os.open("namespace.json", os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0),
                                 dir_fd=directory)
        except FileNotFoundError:
            descriptor = None
        else:
            final_info = os.fstat(descriptor)
            named = os.stat("namespace.json", dir_fd=directory, follow_symlinks=False)
            if (not stat.S_ISREG(final_info.st_mode) or final_info.st_uid != os.getuid()
                    or final_info.st_nlink != 1 or stat.S_IMODE(final_info.st_mode) != 0o600
                    or final_info.st_size != len(expected) or _identity(final_info) != _identity(named)):
                raise ValueError("unsafe final namespace metadata; preserve it")
            stored = bytearray()
            while len(stored) <= len(expected):
                part = os.read(descriptor, len(expected) + 1 - len(stored))
                if not part:
                    break
                stored.extend(part)
            after = os.fstat(descriptor)
            named = os.stat("namespace.json", dir_fd=directory, follow_symlinks=False)
            if bytes(stored) != expected or _identity(after) != _identity(final_info) or _identity(named) != _identity(final_info):
                raise ValueError("final namespace metadata differs; preserve it")
            os.fsync(descriptor)
            os.fsync(directory)
            os.close(descriptor)
            descriptor = None
            return True
        flags = os.O_RDWR | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0)
        try:
            descriptor = os.open("namespace.pending", flags | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=directory)
            os.fsync(directory)
            replayed = False
        except FileExistsError:
            descriptor = os.open("namespace.pending", flags, dir_fd=directory)
            replayed = True
        before = os.fstat(descriptor)
        named = os.stat("namespace.pending", dir_fd=directory, follow_symlinks=False)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid() or before.st_nlink != 1
                or stat.S_IMODE(before.st_mode) != 0o600 or _identity(before) != _identity(named)
                or before.st_size > len(expected)):
            raise ValueError("unsafe staged namespace metadata; preserve it")
        start = before.st_size
        os.lseek(descriptor, 0, os.SEEK_SET)
        prefix = bytearray()
        while len(prefix) < start:
            part = os.read(descriptor, start - len(prefix))
            if not part:
                break
            prefix.extend(part)
        after_prefix = os.fstat(descriptor)
        named_after_prefix = os.stat("namespace.pending", dir_fd=directory, follow_symlinks=False)
        if (bytes(prefix) != expected[:start] or _identity(after_prefix) != _identity(before)
                or _identity(named_after_prefix) != _identity(before)):
            raise ValueError("staged namespace metadata prefix differs; preserve it")
        os.lseek(descriptor, start, os.SEEK_SET)
        while start < len(expected):
            count = os.write(descriptor, expected[start:])
            if count <= 0:
                raise OSError("namespace metadata write made no progress")
            start += count
        os.fsync(descriptor)
        _read_owned(root, "namespace.pending", META_BYTES, exact=expected)
        written = os.fstat(descriptor)
        if _identity(written) != _identity(os.stat("namespace.pending", dir_fd=directory, follow_symlinks=False)):
            raise ValueError("opened staged namespace metadata inode changed; preserve it")
        if (os.fstat(directory).st_dev, os.fstat(directory).st_ino) != (initial.st_dev, initial.st_ino):
            raise ValueError("namespace directory changed during metadata publication")
        try:
            os.stat("namespace.json", dir_fd=directory, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise ValueError("final namespace metadata appeared during publication")
        os.rename("namespace.pending", "namespace.json", src_dir_fd=directory, dst_dir_fd=directory)
        os.fsync(directory)
        _read_owned(root, "namespace.json", META_BYTES, exact=expected)
        if _identity(os.fstat(descriptor)) != _identity(os.stat("namespace.json", dir_fd=directory, follow_symlinks=False)):
            raise ValueError("published namespace metadata inode differs; preserve it")
        return replayed
    finally:
        if descriptor is not None:
            os.close(descriptor)
        os.close(directory)


def _open_connection(root, name):
    _db_file(root, name)
    uri = "file:" + quote(str(root / name), safe="/") + "?mode=rw"
    db = sqlite3.connect(uri, uri=True, isolation_level=None, timeout=0.25)
    return db


def _strict_registry(db):
    if db.execute("PRAGMA integrity_check").fetchmany(2) != [("ok",)]:
        raise ValueError("namespace registry integrity check failed; preserve it")
    if db.execute("PRAGMA foreign_key_check").fetchone() is not None:
        raise ValueError("namespace registry foreign-key check failed; preserve it")
    if db.execute("PRAGMA page_size").fetchone()[0] != PAGE_BYTES:
        raise ValueError("namespace registry page size differs")
    if db.execute("PRAGMA application_id").fetchone()[0] != APPLICATION_ID or db.execute("PRAGMA user_version").fetchone()[0] != 1:
        raise ValueError("namespace registry application/version differs")


def _create_or_resume_bootstrap(root, aggregate):
    path = root / "reservations.bootstrap.sqlite"
    descriptor = None
    try:
        try:
            descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        except FileExistsError:
            pass
        else:
            os.fsync(descriptor)
            os.close(descriptor)
            descriptor = None
            directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        if descriptor is not None:
            os.close(descriptor)
    db = _open_connection(root, path.name)
    registry = None
    try:
        registry = IndexReservations(db, aggregate)
        snap = registry.snapshot()
        if snap["reservations"] != 0:
            raise ValueError("bootstrap registry must remain empty before final publication")
        _strict_registry(db)
        registry._checkpoint()
        db.close()
        db = None
        # SQLite owns its sidecars. They should disappear after its clean close/checkpoint.
        names = set(index_root._names(root, MAX_RESERVATIONS + len(FIXED_FILES)))
        if any(name in names for name in _DB_FILES["bootstrap"][1:]):
            raise RuntimeError("bootstrap SQLite sidecars remain after checkpoint/close; preserve them")
        _db_file(root, path.name)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0))
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        final = root / "reservations.sqlite"
        try:
            final.lstat()
        except FileNotFoundError:
            pass
        else:
            raise ValueError("final registry appeared during bootstrap; preserve both")
        os.rename(path, final)
        directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        return final
    finally:
        if db is not None:
            db.close()


@contextmanager
def open_index_namespace(root, aggregate_bytes):
    """Open the exact durable registry, preserving contradictory or foreign state."""
    aggregate = _aggregate(aggregate_bytes)
    raw = namespace_binding(aggregate)
    root, before = _root(root)
    soft, _ = resource.getrlimit(resource.RLIMIT_FSIZE)
    if soft == resource.RLIM_INFINITY or soft > DATABASE_BYTES:
        raise RuntimeError("namespace registry writes require an already enforced per-file kernel limit")
    _preflight(root, raw, aggregate)  # Must happen before writer.lock can be created.
    with index_writer_lease(root) as lease:
        lease_root, leased_info = index_root._lease(lease)
        if (lease_root != root or (leased_info.st_dev, leased_info.st_ino) != (before.st_dev, before.st_ino)):
            raise ValueError("namespace root changed during lease acquisition")
        _preflight(root, raw, aggregate, leased=True)
        replayed_metadata = _publish_metadata(root, raw)
        names = set(index_root._names(root, MAX_RESERVATIONS + len(FIXED_FILES)))
        bootstrap = "reservations.bootstrap.sqlite" in names
        final = "reservations.sqlite" in names
        if bootstrap and final:
            raise ValueError("mixed bootstrap and final registries are preserved")
        if bootstrap:
            _create_or_resume_bootstrap(root, aggregate)
            replayed_registry = False
            _preflight(root, raw, aggregate, leased=True)
        elif not final:
            _create_or_resume_bootstrap(root, aggregate)
            replayed_registry = False
            _preflight(root, raw, aggregate, leased=True)
        else:
            replayed_registry = True
            _preflight(root, raw, aggregate, leased=True)
        db = _open_connection(root, "reservations.sqlite")
        registry = None
        try:
            registry = IndexReservations(db, aggregate)
            _strict_registry(db)
            state = registry.snapshot()
            if not replayed_registry and state["reservations"] != 0:
                raise ValueError("newly bootstrapped registry unexpectedly contains reservations")
            result = OpenIndexNamespace(lease, registry, raw, replayed_metadata or replayed_registry)
            yield result
            if db.in_transaction or registry.failed:
                raise RuntimeError("namespace registry is not an idle healthy writer")
            _strict_registry(db)
            registry.snapshot()
            # Refuse surviving legacy child writers before the next checkpoint mutation.
            index_root._namespace(lease, registry)
            registry._checkpoint()
        finally:
            db.close()
