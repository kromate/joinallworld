"""Private builder POSIX lease, not a durable opener. Never unlink its lock; supervisors close only after the fixed worker is terminal."""
from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
import fcntl
import json
import os
from pathlib import Path
import resource
import stat
import sys


def verify_index_lease_report(child, value):
    """Check reported root/lock identity after the owned worker has been reaped.

    This validates named private inodes; it does not acquire or prove a flock.
    The caller must separately validate the report's exact fields and integers.
    """
    info = child.lstat(); lock = (child/"writer.lock").lstat()
    if (child.resolve(strict=True) != child or not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) != 0o700
            or (info.st_dev, info.st_ino) != (value["rootDevice"], value["rootInode"])
            or not stat.S_ISREG(lock.st_mode) or lock.st_uid != os.getuid() or lock.st_nlink != 1
            or stat.S_IMODE(lock.st_mode) != 0o600 or lock.st_size != 0
            or (lock.st_dev, lock.st_ino) != (value["lockDevice"], value["lockInode"])):
        raise ValueError("actual admitted root/lease differs from its report")


class IndexWriterBusy(RuntimeError):
    pass


@dataclass(frozen=True)
class IndexWriterLease:
    root: Path
    descriptor: int
    device: int
    inode: int


_SHARD_HANDOFF_SEAL = object()


@dataclass(frozen=True, eq=False)
class IndexShardHandoff:
    """Local lease handoff receipt; it proves no source coverage or ingestion."""
    root: Path
    identity: tuple
    namespace_lease: IndexWriterLease
    authority: object
    summary: bytes
    record_sha256: str
    anchor_sha256: str
    _seal: object


def _verify_shard_handoff(handoff, lease, authority):
    from index_controller_state import verify_shard_handoff
    return verify_shard_handoff(handoff, lease, authority)


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


def _campaign_inherited_lease(argv):
    if len(argv) != 7 or argv[1] != "--campaign-inherited-lease":
        raise ValueError("invalid helper arguments")
    root = Path(argv[2]); values = argv[3:]
    if not root.is_absolute() or root.resolve(strict=True) != root or any(
            len(v) > 20 or not v.isascii() or not v.isdecimal() or str(int(v)) != v for v in values):
        raise ValueError("invalid root/IDs")
    expected = tuple(int(v) for v in values)
    if any(v > 2**63-1 for v in expected): raise ValueError("identity too large")
    before = root.lstat(); _private_directory(before)
    if (before.st_dev, before.st_ino) != expected[:2]: raise ValueError("root changed")
    lock = root/"writer.lock"; named = lock.lstat(); _lock_file(named); held = os.fstat(6); _lock_file(held)
    flags = fcntl.fcntl(6, fcntl.F_GETFL)
    if ((flags & os.O_ACCMODE) != os.O_RDWR or not flags & os.O_NONBLOCK
            or (held.st_dev, held.st_ino) != expected[2:]
            or (named.st_dev, named.st_ino) != expected[2:]):
        raise ValueError("campaign fd mismatch")
    digest = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    for kind, cap in ((resource.RLIMIT_CPU, 1), (resource.RLIMIT_FSIZE, 65536)):
        soft, hard = resource.getrlimit(kind)
        value = cap
        for limit in (soft, hard):
            if limit != resource.RLIM_INFINITY: value = min(value, limit)
        resource.setrlimit(kind, (value, value))
    try: fcntl.flock(6, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as error: raise IndexWriterBusy("campaign lease busy") from error
    after = root.lstat(); current = lock.lstat(); held = os.fstat(6)
    _private_directory(after); _lock_file(current); _lock_file(held)
    flags = fcntl.fcntl(6, fcntl.F_GETFL)
    if (root.resolve(strict=True) != root or (after.st_dev, after.st_ino) != expected[:2]
            or (current.st_dev, current.st_ino) != expected[2:] or (held.st_dev, held.st_ino) != expected[2:]
            or (flags & os.O_ACCMODE) != os.O_RDWR or not flags & os.O_NONBLOCK):
        raise ValueError("lock changed after flock")
    report = {"format":"world-campaign-lease-ready-v1", "rootDevice":expected[0], "rootInode":expected[1],
        "lockDevice":expected[2], "lockInode":expected[3], "helperSha256":digest}
    return (json.dumps(report, sort_keys=True, separators=(",", ":"))+"\n").encode("ascii")


def main(argv=None):
    try:
        report = _campaign_inherited_lease(sys.argv if argv is None else argv)
        view = memoryview(report)
        while view:
            count = os.write(1, view)
            if count < 1: raise OSError("ready report write made no progress")
            view = view[count:]
        return 0
    except Exception as error:
        os.write(2, ((str(error) or type(error).__name__)[:1024]+"\n").encode("utf-8", "replace"))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
