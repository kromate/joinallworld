"""Bounded private-index file inventory; not a namespace reservation or opener.

Call only with the actual writer lease and no live worker/reader write activity.
Does not open SQLite, interpret a binding, reserve storage, unlink or repair files.
"""
import os
import stat
from pathlib import Path

from index_writer_lock import IndexWriterLease

MIB = 1024 * 1024
DATABASE_FILES = frozenset({"features.sqlite", "features.sqlite-wal", "features.sqlite-shm",
                            "bootstrap.sqlite", "bootstrap.sqlite-wal", "bootstrap.sqlite-shm"})
METADATA_FILES = frozenset({"binding.json", "binding.pending", "reservation.json", "bootstrap.json"})
KNOWN_FILES = DATABASE_FILES | METADATA_FILES | {"writer.lock", "audit.json"}


def _bound(value, minimum, maximum, label):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f"{label} exceeds its explicit inventory bound")
    return value


def index_storage_footprint(lease, *, file_bytes, aggregate_bytes):
    """Inventory logical and allocated bytes without treating missing WAL as damage.

    Namespace reservations and raw captures are external. This check is a terminal
    inventory, not an in-transaction hard aggregate ceiling. Inode/ctime checks
    detect observed changes; callers still need a real exclusive writer gap.
    """
    if type(lease) is not IndexWriterLease:
        raise TypeError("private index inventory requires its actual writer lease")
    _bound(file_bytes, 65536, 64*MIB, "file bytes")
    _bound(aggregate_bytes, 65536, 512*MIB, "aggregate bytes")
    root = Path(lease.root)
    if not root.is_absolute() or root.resolve(strict=True) != root:
        raise ValueError("index inventory root must remain canonical")
    directory_info = root.lstat()
    if (not stat.S_ISDIR(directory_info.st_mode) or directory_info.st_uid != os.getuid()
            or stat.S_IMODE(directory_info.st_mode) != 0o700):
        raise ValueError("index inventory requires its owned private directory")
    descriptor_info = os.fstat(lease.descriptor)
    named_lock = (root / "writer.lock").lstat()
    if (not stat.S_ISREG(descriptor_info.st_mode) or descriptor_info.st_uid != os.getuid()
            or descriptor_info.st_size != 0 or descriptor_info.st_nlink != 1
            or stat.S_IMODE(descriptor_info.st_mode) != 0o600
            or (descriptor_info.st_dev, descriptor_info.st_ino) != (lease.device, lease.inode)
            or (named_lock.st_dev, named_lock.st_ino) != (lease.device, lease.inode)):
        raise ValueError("index inventory lease inode changed")
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    files = {}
    logical = 0
    charged = directory_info.st_blocks * 512
    try:
        opened = os.fstat(directory)
        if (opened.st_dev, opened.st_ino) != (directory_info.st_dev, directory_info.st_ino):
            raise ValueError("index inventory directory changed")
        names = os.listdir(directory)
        if len(names) > len(KNOWN_FILES) or any(name not in KNOWN_FILES for name in names):
            raise ValueError("unknown index state is preserved; explicit recovery is required")
        for database in ["features.sqlite", "bootstrap.sqlite"]:
            if database not in names and any(database + ending in names for ending in ["-wal", "-shm"]):
                raise ValueError("orphan index sidecar is preserved; explicit recovery is required")
        for name in sorted(names):
            descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
            try:
                info = os.fstat(descriptor)
                if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1
                        or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size < 0 or info.st_blocks < 0):
                    raise ValueError("index inventory refuses symlink/nonregular/nonprivate/linked files")
                maximum = 0 if name == "writer.lock" else 4096 if name in METADATA_FILES else MIB if name == "audit.json" else file_bytes
                if info.st_size > maximum:
                    raise ValueError("index file exceeds its explicit byte bound")
                named = os.stat(name, dir_fd=directory, follow_symlinks=False)
                if (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns) != (
                        named.st_dev, named.st_ino, named.st_size, named.st_mtime_ns, named.st_ctime_ns):
                    raise ValueError("index file changed during inventory")
                allocated = info.st_blocks * 512
                files[name] = {"logicalBytes": info.st_size, "allocatedBytes": allocated}
                logical += info.st_size
                charged += max(info.st_size, allocated)
                if charged > aggregate_bytes:
                    raise ValueError("index files exceed their terminal aggregate bound; preserve all files")
            finally:
                os.close(descriptor)
        after = root.lstat()
        if (root.resolve(strict=True) != root or (after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns) != (
                directory_info.st_dev, directory_info.st_ino, directory_info.st_mtime_ns, directory_info.st_ctime_ns)):
            raise ValueError("index directory changed during inventory")
    finally:
        os.close(directory)
    return {"scope": "private index terminal footprint, not a namespace reservation",
            "files": files, "logicalBytes": logical, "chargedBytes": charged,
            "directoryAllocatedBytes": directory_info.st_blocks * 512,
            "aggregateLimitBytes": aggregate_bytes}
