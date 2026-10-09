"""Fixed namespace initialize/reopen worker for the pinned Python supervisor.

The supervisor must enforce CPU, wall, RSS and retained-process handling. This
worker performs no acquisition, campaign, game, reservation or deletion work.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import sqlite3
import stat
import sys

HERE = Path(__file__).resolve(strict=True).parent
sys.path.insert(0, str(HERE))  # Root tooling snapshot verification pins this exact worker tree.

from index_namespace import open_index_namespace, namespace_binding
from index_reservations import DATABASE_BYTES, REGISTRY_ALLOWANCE
from index_writer_lock import IndexWriterLease

MIN_AGGREGATE_BYTES = REGISTRY_ALLOWANCE + 65536
MAX_AGGREGATE_BYTES = 512 * 1024 * 1024
_EXPECTED_STATS = frozenset({
    "reservations", "heldBytes", "registryAllowanceBytes", "chargedBytes", "aggregateLimitBytes",
})
_FORMAT = "feature-index-registry-startup-v1"


def _budget(raw):
    if type(raw) is not str or not re.fullmatch(r"[0-9]{1,10}", raw):
        raise ValueError("namespace budget must be at most ten ASCII decimal digits")
    value = int(raw, 10)
    if not MIN_AGGREGATE_BYTES <= value <= MAX_AGGREGATE_BYTES:
        raise ValueError("namespace budget exceeds its fixed allowance bound")
    return value


def _runtime_environment(environment=None):
    environment = os.environ if environment is None else environment
    root_raw = environment.get("TMPDIR")
    budget_raw = environment.get("WORLD_INDEX_NAMESPACE_BUDGET")
    python_expected = environment.get("WORLD_INDEX_PYTHON_VERSION")
    sqlite_expected = environment.get("WORLD_INDEX_PYTHON_SQLITE_VERSION")
    descriptor_raw = environment.get("WORLD_INDEX_NAMESPACE_DESCRIPTOR")
    if any(type(value) is not str or not value for value in
           (root_raw, budget_raw, python_expected, sqlite_expected, descriptor_raw)):
        raise ValueError("supervisor namespace/runtime environment is incomplete")
    if sys.version.split()[0] != python_expected:
        raise RuntimeError("Python runtime differs from the retained supervisor pin")
    if sqlite3.sqlite_version != sqlite_expected:
        raise RuntimeError("Python SQLite runtime differs from the retained supervisor pin")
    root = Path(root_raw)
    if not root.is_absolute() or root.resolve(strict=True) != root:
        raise ValueError("namespace root must be an existing canonical absolute path")
    budget = _budget(budget_raw)
    if not re.fullmatch(r"[0-9]{1,10}", descriptor_raw):
        raise ValueError("namespace lease descriptor must be a bounded decimal integer")
    descriptor = int(descriptor_raw, 10)
    if not 2 < descriptor <= 2147483647:
        raise ValueError("namespace lease descriptor must be dedicated above standard streams")
    try:
        held = os.fstat(descriptor)
    except OSError as error:
        raise ValueError("inherited namespace descriptor is not open") from error
    try:
        named = (root / "writer.lock").lstat()
    except FileNotFoundError as error:
        raise ValueError("namespace root has no permanent writer lock for the inherited descriptor") from error
    if (not stat.S_ISREG(held.st_mode) or held.st_uid != os.getuid()
            or stat.S_IMODE(held.st_mode) != 0o600 or held.st_nlink != 1 or held.st_size != 0
            or (held.st_dev, held.st_ino) != (named.st_dev, named.st_ino)):
        raise ValueError("inherited namespace descriptor differs from its permanent lock inode")
    lease = IndexWriterLease(root, descriptor, held.st_dev, held.st_ino)
    return root, budget, lease


def _identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
            info.st_ctime_ns, info.st_uid, info.st_mode, info.st_nlink)


def _read_exact_private(path, expected):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0))
    try:
        before = os.fstat(descriptor)
        named = path.lstat()
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid()
                or before.st_nlink != 1 or stat.S_IMODE(before.st_mode) != 0o600
                or before.st_size != len(expected) or _identity(before) != _identity(named)):
            raise ValueError("namespace metadata must remain a private single-link file")
        content = bytearray()
        while len(content) <= len(expected):
            part = os.read(descriptor, len(expected) + 1 - len(content))
            if not part:
                break
            content.extend(part)
        after = os.fstat(descriptor)
        named_after = path.lstat()
        if (bytes(content) != expected or _identity(after) != _identity(before)
                or _identity(named_after) != _identity(before)):
            raise ValueError("namespace metadata changed before report publication")
        return before
    finally:
        os.close(descriptor)


def _private_root(root):
    if root.resolve(strict=True) != root:
        raise ValueError("namespace root is no longer canonical")
    info = root.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) != 0o700):
        raise ValueError("namespace root must remain an owned private 0700 directory")
    return info


def _private_database(path):
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1
            or stat.S_IMODE(info.st_mode) != 0o600 or not 0 <= info.st_size <= DATABASE_BYTES):
        raise ValueError("final namespace database must remain an owned private bounded file")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0))
    try:
        opened = os.fstat(descriptor)
        named = path.lstat()
        if _identity(opened) != _identity(info) or _identity(named) != _identity(info):
            raise ValueError("final namespace database inode changed")
        header = os.read(descriptor, 100)
        if (len(header) != 100 or header[:16] != b"SQLite format 3\0"
                or int.from_bytes(header[16:18], "big") != 4096
                or int.from_bytes(header[68:72], "big") != 0x57495231
                or int.from_bytes(header[60:64], "big") != 1):
            raise ValueError("final namespace database header differs from the initialized registry")
        if _identity(os.fstat(descriptor)) != _identity(info) or _identity(path.lstat()) != _identity(info):
            raise ValueError("final namespace database changed during verification")
    finally:
        os.close(descriptor)
    return info


def _rss_kib():
    raw = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if type(raw) is not int or raw < 1:
        raise RuntimeError("maximum resident set measurement is unavailable")
    # macOS reports bytes; Linux and the other supported POSIX targets report KiB.
    return (raw + 1023) // 1024 if sys.platform == "darwin" else raw


def _run(root, budget, namespace_lease):
    binding_bytes = namespace_binding(budget)
    with open_index_namespace(root, budget, inherited_lease=namespace_lease) as opened:
        if opened.binding_bytes != binding_bytes:
            raise ValueError("namespace opener returned a different canonical binding")
        stats = opened.registry.snapshot()
        if type(stats) is not dict or set(stats) != _EXPECTED_STATS:
            raise ValueError("namespace registry snapshot has an unexpected field set")
        if any(type(value) is not int or value < 0 for value in stats.values()):
            raise ValueError("namespace registry snapshot contains invalid counters")
        if (stats["registryAllowanceBytes"] != REGISTRY_ALLOWANCE
                or stats["aggregateLimitBytes"] != budget
                or stats["chargedBytes"] != REGISTRY_ALLOWANCE + stats["heldBytes"]):
            raise ValueError("namespace registry snapshot differs from its immutable budget")
        replayed = opened.replayed
        if type(replayed) is not bool:
            raise ValueError("namespace opener returned an invalid replay marker")
    # SQLite is closed; the inherited descriptor stays held through report/exit.
    root_info = _private_root(root)
    binding_path = root / "namespace.json"
    _read_exact_private(binding_path, binding_bytes)
    database = root / "reservations.sqlite"
    database_info = _private_database(database)
    if _identity(root_info) != _identity(root.lstat()):
        raise ValueError("namespace root changed before report publication")
    if _identity(database_info) != _identity(database.lstat()):
        raise ValueError("namespace database inode changed before report publication")
    report = {
        "format": _FORMAT,
        "namespaceBindingSha256": hashlib.sha256(binding_bytes).hexdigest(),
        "aggregateBytes": budget,
        "replayed": replayed,
        "pythonVersion": sys.version.split()[0],
        "sqliteVersion": sqlite3.sqlite_version,
        "stats": stats,
        "databaseBytes": database_info.st_size,
        "maximumRssKiB": _rss_kib(),
    }
    raw = json.dumps(report, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    if len(raw.encode("ascii")) > 4096:
        raise ValueError("namespace startup report exceeds its fixed output bound")
    return raw


def main():
    if len(sys.argv) != 1:
        raise ValueError("namespace registry worker accepts no arguments")
    root, budget, namespace_lease = _runtime_environment()
    report = _run(root, budget, namespace_lease)
    print(report, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
