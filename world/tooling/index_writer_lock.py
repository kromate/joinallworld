"""Private builder writer lease primitive, not a durable index opener.

Never unlink the lock inode. A supervisor must pass the descriptor to its fixed
worker and close only after that worker is terminal. Advisory, local POSIX only.
"""
from contextlib import contextmanager
from dataclasses import dataclass
import fcntl
import os
from pathlib import Path
import stat


class IndexWriterBusy(RuntimeError):
    pass


@dataclass(frozen=True)
class IndexWriterLease:
    root: Path
    descriptor: int
    device: int
    inode: int


def _private_directory(info):
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise ValueError("index lock root must be an owned private 0700 directory")


def _lock_file(info):
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1:
        raise ValueError("index lock must be an owned regular file with one link")
    if stat.S_IMODE(info.st_mode) != 0o600 or info.st_size != 0:
        raise ValueError("index lock must be a private empty 0600 file")


@contextmanager
def index_writer_lease(root):
    """Nonblocking lease on an existing, canonical private builder directory.

    Does not create directories, remove stale state, mutate databases or reserve
    storage. Close releases only this descriptor reference, preserving references
    inherited by a still-live worker. Do not call LOCK_UN on an inherited lease.
    """
    root = Path(root)
    if not root.is_absolute() or root.resolve(strict=True) != root:
        raise ValueError("index lock root must be an existing canonical absolute path")
    if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_DIRECTORY"):
        raise RuntimeError("index lock requires POSIX no-follow directory support")
    before = root.lstat()
    _private_directory(before)
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    descriptor = None
    try:
        current = os.fstat(directory)
        _private_directory(current)
        if (current.st_dev, current.st_ino) != (before.st_dev, before.st_ino):
            raise ValueError("index lock root changed while opening")
        flags = os.O_RDWR | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0)
        try:
            descriptor = os.open("writer.lock", flags | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=directory)
            os.fsync(descriptor)
            os.fsync(directory)
        except FileExistsError:
            descriptor = os.open("writer.lock", flags, dir_fd=directory)
        info = os.fstat(descriptor)
        _lock_file(info)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise IndexWriterBusy("another index writer holds the kernel lease") from error
        named = os.stat("writer.lock", dir_fd=directory, follow_symlinks=False)
        _lock_file(named)
        if (named.st_dev, named.st_ino) != (info.st_dev, info.st_ino):
            raise ValueError("index lock inode changed during acquisition")
        if root.resolve(strict=True) != root:
            raise ValueError("index lock root became noncanonical")
        after = root.lstat()
        _private_directory(after)
        if (after.st_dev, after.st_ino) != (current.st_dev, current.st_ino):
            raise ValueError("index lock root changed during acquisition")
        yield IndexWriterLease(root, descriptor, info.st_dev, info.st_ino)
    finally:
        # Explicit LOCK_UN would also unlock a reference inherited by a worker.
        # Retain the permanent inode; never unlink/recreate it to reclaim a lease.
        if descriptor is not None:
            os.close(descriptor)
        os.close(directory)
