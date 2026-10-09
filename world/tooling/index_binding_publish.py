"""Binding publication under an actual charged root's exclusive writer gap.

Fixed private names only. No source admission, SQLite, worker or ledger completion.
Atomic rename assumes cooperating writers respect the held private directory lease.
"""
import hashlib
import os
import stat

from index_binding import decode_index_binding
from index_root import ChargedIndexRoot, _binding, _lease


def _opened_binding(file, directory, name):
    """Tie the descriptor being flushed/written to the admitted named inode."""
    actual = os.fstat(file)
    named = os.stat(name, dir_fd=directory, follow_symlinks=False)
    identity = lambda info: (info.st_dev, info.st_ino, info.st_size,
                             info.st_mtime_ns, info.st_ctime_ns)
    if (not stat.S_ISREG(actual.st_mode) or actual.st_uid != os.getuid()
            or actual.st_nlink != 1 or stat.S_IMODE(actual.st_mode) != 0o600
            or identity(actual) != identity(named)):
        raise ValueError("opened binding inode differs from its admitted name")
    return actual


def publish_index_binding(admitted):
    if type(admitted) is not ChargedIndexRoot:
        raise TypeError("binding publication requires its actual charged root")
    raw = admitted.binding_bytes
    config = decode_index_binding(raw)
    key = hashlib.sha256(raw).hexdigest()
    root, before = _lease(admitted.lease)
    if key != admitted.index_hash or root.name != key or config["reservedBytes"] != admitted.reserved_bytes:
        raise ValueError("charged root/binding/allowance differs")
    _binding(root, raw)
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    file = None
    try:
        opened = os.fstat(directory)
        if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            raise ValueError("binding directory changed during open")
        try:
            file = os.open("binding.json", os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        except FileNotFoundError:
            pass
        else:
            _binding(root, raw)
            _opened_binding(file, directory, "binding.json")
            os.fsync(file); os.fsync(directory)
            _opened_binding(file, directory, "binding.json")
            _lease(admitted.lease)
            return {"indexHash": key, "bytes": len(raw), "replayed": True,
                    "resumedPending": False, "resumedBytes": 0}

        resumed = False
        flags = os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK
        try:
            file = os.open("binding.pending", flags | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=directory)
        except FileExistsError:
            resumed = True
            file = os.open("binding.pending", flags, dir_fd=directory)
        _binding(root, raw)  # Prefix, ownership and absence of database/final data.
        info = _opened_binding(file, directory, "binding.pending")
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1
                or stat.S_IMODE(info.st_mode) != 0o600 or not 0 <= info.st_size <= len(raw)):
            raise ValueError("staged binding is unsafe")
        starting = info.st_size
        os.lseek(file, starting, os.SEEK_SET)
        written = starting
        while written < len(raw):
            count = os.write(file, raw[written:])
            if count <= 0: raise OSError("binding write made no progress")
            written += count
        os.fsync(file)
        _binding(root, raw)
        named = os.stat("binding.pending", dir_fd=directory, follow_symlinks=False)
        actual = os.fstat(file)
        if (named.st_dev, named.st_ino) != (actual.st_dev, actual.st_ino) or actual.st_size != len(raw):
            raise ValueError("staged binding inode changed before publication")
        try:
            os.stat("binding.json", dir_fd=directory, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise ValueError("final binding appeared during publication; preserve both files")
        # No cooperating writer can create a target while this lease is held.
        os.rename("binding.pending", "binding.json", src_dir_fd=directory, dst_dir_fd=directory)
        os.fsync(directory)
        _binding(root, raw)
        _lease(admitted.lease)
        return {"indexHash": key, "bytes": len(raw), "replayed": False,
                "resumedPending": resumed, "resumedBytes": starting}
    finally:
        if file is not None: os.close(file)
        os.close(directory)
