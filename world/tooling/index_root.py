"""Charge-before-create directory admission, not the complete durable opener.

Caller already owns a supervised private namespace registry and its actual lease.
Source/tool verification and atomic binding/database bootstrap remain separate.
"""
from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
import os
import re
import resource
import stat

from index_binding import decode_index_binding
from index_reservations import IndexReservations, DATABASE_BYTES, REGISTRY_ALLOWANCE, MAX_RESERVATIONS
from index_storage_footprint import KNOWN_FILES, index_storage_footprint
from index_writer_lock import IndexWriterLease, index_writer_lease

REGISTRY_FILES = frozenset({"writer.lock", "reservations.sqlite", "reservations.sqlite-wal",
                            "reservations.sqlite-shm", "reservations.sqlite-journal", "namespace.json"})


@dataclass(frozen=True)
class ChargedIndexRoot:
    lease: IndexWriterLease
    index_hash: str
    binding_bytes: bytes
    reserved_bytes: int
    replayed_reservation: bool
    namespace_lease: IndexWriterLease | None = None


def _names(directory, maximum):
    names = []
    with os.scandir(directory) as entries:
        for entry in entries:
            names.append(entry.name)
            if len(names) > maximum:
                raise ValueError("private index directory exceeds its fixed entry bound")
    return names


def _lease(lease):
    if type(lease) is not IndexWriterLease:
        raise TypeError("directory admission requires its actual namespace lease")
    root = lease.root
    if not root.is_absolute() or root.resolve(strict=True) != root:
        raise ValueError("namespace root must remain canonical")
    info = root.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) != 0o700):
        raise ValueError("namespace root must remain owned and private")
    held = os.fstat(lease.descriptor); named = (root/"writer.lock").lstat()
    if (not stat.S_ISREG(held.st_mode) or held.st_uid != os.getuid() or held.st_nlink != 1
            or held.st_size != 0 or stat.S_IMODE(held.st_mode) != 0o600
            or (held.st_dev, held.st_ino) != (lease.device, lease.inode)
            or (named.st_dev, named.st_ino) != (lease.device, lease.inode)):
        raise ValueError("namespace lease inode changed")
    return root, info


def _namespace(lease, registry):
    root, info = _lease(lease)
    if type(registry) is not IndexReservations or registry.failed or registry.db.in_transaction:
        raise TypeError("directory admission requires its live idle reservation writer")
    soft, _ = resource.getrlimit(resource.RLIMIT_FSIZE)
    if soft == resource.RLIM_INFINITY or soft > DATABASE_BYTES:
        raise RuntimeError("registry writes require an already enforced per-file kernel limit")
    databases = registry.db.execute("PRAGMA database_list").fetchall()
    main = [row for row in databases if row[1] == "main"]
    if (len(main) != 1 or main[0][2] != str(root/"reservations.sqlite")
            or any(row[1] not in {"main", "temp"} for row in databases)
            or registry.db.execute("SELECT count(*) FROM sqlite_temp_schema").fetchone()[0]):
        raise ValueError("reservation connection differs from the private namespace registry")
    if (registry.db.execute("PRAGMA page_size").fetchone()[0] != 4096
            or registry.db.execute("PRAGMA max_page_count").fetchone()[0] != DATABASE_BYTES//4096
            or registry.db.execute("PRAGMA journal_mode").fetchone()[0] != "wal"
            or registry.db.execute("PRAGMA synchronous").fetchone()[0] != 2):
        raise ValueError("namespace registry durability/page limits changed")
    registry.snapshot()
    held = {}
    for key, binding, amount in registry.db.execute("SELECT hash,binding,reserved_bytes FROM reservations"):
        config = decode_index_binding(binding)
        if config["reservedBytes"] != amount:
            raise ValueError("namespace binding differs from its immutable charged allowance")
        held[key] = (binding, config)
    from index_controller_state import CONTROLS, inspect_controller
    overhead = info.st_blocks*512 + inspect_controller(root, registry.aggregate_bytes)
    roots = []
    for name in _names(root, MAX_RESERVATIONS+len(REGISTRY_FILES)+len(CONTROLS)):
        file = root/name; entry = file.lstat()
        if name in CONTROLS:
            continue
        if name in REGISTRY_FILES:
            maximum = 0 if name == "writer.lock" else 4096 if name == "namespace.json" else DATABASE_BYTES
            if (not stat.S_ISREG(entry.st_mode) or entry.st_uid != os.getuid()
                    or entry.st_nlink != 1 or stat.S_IMODE(entry.st_mode) != 0o600
                    or not 0 <= entry.st_size <= maximum):
                raise ValueError("unsafe or oversized namespace registry file is preserved")
            if name == "namespace.json":
                # Lazy import avoids the canonical opener's dependency on this inventory.
                from index_namespace import namespace_binding, _read_owned
                _read_owned(root, name, 4096, exact=namespace_binding(registry.aggregate_bytes))
            overhead += max(entry.st_size, entry.st_blocks*512)
        else:
            if (not re.fullmatch("[a-f0-9]{64}", name) or name not in held
                    or not stat.S_ISDIR(entry.st_mode) or entry.st_uid != os.getuid()
                    or stat.S_IMODE(entry.st_mode) != 0o700):
                raise ValueError("unknown or unreserved namespace entry is preserved")
            roots.append((file, *held[name]))
    if overhead > REGISTRY_ALLOWANCE:
        raise ValueError("actual registry overhead exceeds its declared allowance")
    for child, binding, config in roots:
        _binding(child, binding)
        # Nonblocking: a live inherited writer prevents another allocation.
        with index_writer_lease(child) as child_lease:
            _binding(child, binding)
            index_storage_footprint(child_lease, file_bytes=config["processLimits"]["fileBytes"],
                                    aggregate_bytes=config["reservedBytes"])
    return root, info


def _binding(root, raw):
    names = _names(root, len(KNOWN_FILES))
    if any(name not in KNOWN_FILES for name in names):
        raise ValueError("unknown index state is preserved")
    prefix = "binding.pending" in names
    if prefix:
        if any(name not in {"writer.lock", "binding.pending"} for name in names):
            raise ValueError("staged binding alongside final binding/data is preserved")
        name = "binding.pending"
    elif "binding.json" not in names:
        if any(name != "writer.lock" for name in names):
            raise ValueError("index data without its exact binding is preserved")
        return
    else:
        name = "binding.json"
    descriptor = os.open(root/name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(descriptor)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1
                or stat.S_IMODE(info.st_mode) != 0o600
                or not (0 <= info.st_size <= len(raw) if prefix else info.st_size == len(raw))):
            raise ValueError("existing index binding is unsafe or contradictory")
        stored = bytearray()
        while len(stored) <= len(raw):
            chunk = os.read(descriptor, len(raw)-len(stored)+1)
            if not chunk: break
            stored.extend(chunk)
        after = os.fstat(descriptor); named = (root/name).lstat()
        identity = lambda i: (i.st_dev, i.st_ino, i.st_size, i.st_mtime_ns, i.st_ctime_ns)
        expected = raw[:info.st_size] if prefix else raw
        if bytes(stored) != expected or identity(after) != identity(info) or identity(named) != identity(info):
            raise ValueError("existing index binding bytes/inode changed")
    finally:
        os.close(descriptor)


@contextmanager
def charged_index_root(namespace_lease, registry, binding_bytes):
    """Reserve once, then create/lease only its exact SHA-named private child.

    Registry initialization/supervision is caller-owned. No database, binding,
    bootstrap, output or source file is created here; first roots remain empty
    except their permanent lock. Caller cannot launch before the later bootstrap.
    Any inherited worker must actually be terminal before this context exits;
    a held shared descriptor alone cannot prove a writer gap for inventory.
    """
    config = decode_index_binding(binding_bytes)
    index_hash = hashlib.sha256(binding_bytes).hexdigest()
    namespace, before = _namespace(namespace_lease, registry)
    # Commit + strict checkpoint must finish before any directory allocation.
    reserved = registry.reserve(index_hash, binding_bytes, config["reservedBytes"])
    directory = os.open(namespace, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        opened = os.fstat(directory)
        if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            raise ValueError("namespace directory changed during admission")
        try:
            os.mkdir(index_hash, 0o700, dir_fd=directory)
            os.fsync(directory)
        except FileExistsError:
            pass  # Preserve the existing root; do not reset a held allowance.
        root = namespace/index_hash
        info = root.lstat()
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) != 0o700 or root.resolve(strict=True) != root):
            raise ValueError("reserved index root is unsafe; preserve its charge and state")
        _binding(root, binding_bytes)  # Refuse foreign state before creating its lock.
        with index_writer_lease(root) as lease:
            _binding(root, binding_bytes)
            index_storage_footprint(lease, file_bytes=config["processLimits"]["fileBytes"],
                                    aggregate_bytes=config["reservedBytes"])
            yield ChargedIndexRoot(lease, index_hash, binding_bytes, config["reservedBytes"],
                                   reserved["replayed"], namespace_lease)
            _binding(root, binding_bytes)
            index_storage_footprint(lease, file_bytes=config["processLimits"]["fileBytes"],
                                    aggregate_bytes=config["reservedBytes"])
            _lease(namespace_lease)
    finally:
        os.close(directory)
