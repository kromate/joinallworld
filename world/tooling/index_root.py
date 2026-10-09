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

from index_binding import decode_index_binding, decode_index_shard_binding
from index_reservations import IndexReservations, DATABASE_BYTES, REGISTRY_ALLOWANCE, MAX_RESERVATIONS
from index_storage_footprint import KNOWN_FILES, index_storage_footprint
from index_writer_lock import IndexWriterLease, index_writer_lease

REGISTRY_FILES = frozenset({"writer.lock", "reservations.sqlite", "reservations.sqlite-wal",
                            "reservations.sqlite-shm", "reservations.sqlite-journal", "namespace.json"})
_AUTHORITY_SEAL = object()


@dataclass(frozen=True)
class ChargedIndexRoot:
    lease: IndexWriterLease
    index_hash: str
    binding_bytes: bytes
    reserved_bytes: int
    replayed_reservation: bool
    namespace_lease: IndexWriterLease | None = None


@dataclass(frozen=True)
class IndexShardPlanAuthority:
    """Structural plan authority; not provenance proof."""
    plan_hash: str
    base_binding: bytes
    base_hash: str
    reservations: tuple
    aggregate_bytes: int
    _seal: object


def _authority(value):
    if type(value) is not IndexShardPlanAuthority or value._seal is not _AUTHORITY_SEAL:
        raise TypeError("shard roots require a locally validated plan authority")
    return value


def prepare_index_shard_plan_authority(raw, expected_pin, base_binding_bytes):
    """Validate through the fixed worker and freeze derived entries."""
    if type(raw) is not bytes or type(base_binding_bytes) is not bytes:
        raise TypeError("plan and base binding must be immutable bytes")
    if type(expected_pin) is not dict:
        raise TypeError("plan pin must be an exact mapping")
    pin = dict(expected_pin)
    from index_registry_worker import validate_shard_plan
    validated = validate_shard_plan(raw, pin, bytes(base_binding_bytes))
    entries = []
    for entry in validated["reservations"]:
        if type(entry) is not dict or set(entry) != {"indexHash", "bindingBytes", "reservedBytes"}:
            raise ValueError("validated plan entry has an unexpected shape")
        binding = bytes(entry["bindingBytes"])
        config = decode_index_shard_binding(binding)
        key = hashlib.sha256(binding).hexdigest()
        amount = config["reservedBytes"]
        if (entry["indexHash"] != key or entry["reservedBytes"] != amount
                or type(amount) is not int):
            raise ValueError("validated shard reservation differs from its binding")
        entries.append((key, binding, amount))
    if not entries or len({row[0] for row in entries}) != len(entries):
        raise ValueError("validated shard reservations are not unique")
    base = bytes(base_binding_bytes)
    decode_index_binding(base)
    plan = validated["plan"]
    return IndexShardPlanAuthority(
        pin["sha256"], base, hashlib.sha256(base).hexdigest(), tuple(sorted(entries)),
        plan["policy"]["aggregateBytes"], _AUTHORITY_SEAL)


def planned_index_reservations(authority):
    return _authority(authority).reservations


def decode_planned_index_binding(raw, authority):
    """Decode only the exact frozen V1 base or V2 entry."""
    plan = _authority(authority)
    if type(raw) is not bytes:
        raise TypeError("planned binding must be immutable bytes")
    if raw == plan.base_binding:
        return decode_index_binding(raw)
    for _, binding, _ in plan.reservations:
        if raw == binding:
            return decode_index_shard_binding(raw)
    raise ValueError("binding is not an exact member of the frozen plan")


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


def _namespace(lease, registry, plan_authority=None):
    if plan_authority is not None:
        plan_authority = _authority(plan_authority)
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
        config = (decode_planned_index_binding(binding, plan_authority)
                  if plan_authority is not None else decode_index_binding(binding))
        if config["reservedBytes"] != amount:
            raise ValueError("namespace binding differs from its immutable charged allowance")
        held[key] = (binding, config)
    if plan_authority is not None:
        _verify_plan_reservations(registry, plan_authority)
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
        _binding(child, binding, plan_authority)
        # Nonblocking: a live inherited writer prevents another allocation.
        with index_writer_lease(child) as child_lease:
            _binding(child, binding, plan_authority)
            index_storage_footprint(child_lease, file_bytes=config["processLimits"]["fileBytes"],
                                    aggregate_bytes=config["reservedBytes"])
    return root, info


def _binding(root, raw, plan_authority=None):
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
        if not prefix and plan_authority is not None:
            decode_planned_index_binding(raw, plan_authority)
    finally:
        os.close(descriptor)


def _verify_plan_reservations(registry, authority):
    plan = _authority(authority)
    expected = {key: (binding, amount) for key, binding, amount in plan.reservations}
    base = decode_index_binding(plan.base_binding)
    rows = {key: (binding, amount) for key, binding, amount in
            registry.db.execute("SELECT hash,binding,reserved_bytes FROM reservations")}
    base_row = rows.get(plan.base_hash)
    allowed = dict(expected)
    if base_row is not None:
        if base_row != (plan.base_binding, base["reservedBytes"]):
            raise ValueError("legacy base reservation differs from the frozen plan")
        allowed[plan.base_hash] = (plan.base_binding, base["reservedBytes"])
    if set(rows) != set(allowed):
        raise ValueError("registry does not contain the exact complete planned reservation set")
    for key, (binding, amount) in rows.items():
        if (binding != allowed[key][0] or amount != allowed[key][1]
                or hashlib.sha256(binding).hexdigest() != key):
            raise ValueError("registry reservation differs from the complete frozen plan")
    stats = registry.snapshot()
    expected_charge = REGISTRY_ALLOWANCE + sum(row[1] for row in allowed.values())
    if (stats["reservations"] != len(allowed) or stats["heldBytes"] != sum(row[1] for row in allowed.values())
            or stats["aggregateLimitBytes"] != plan.aggregate_bytes
            or stats["chargedBytes"] != expected_charge
            or stats["chargedBytes"] > plan.aggregate_bytes):
        raise ValueError("registry charge differs from the complete frozen plan")


@contextmanager
def _materialize(namespace_lease, registry, namespace, before, index_hash, binding, config,
                 amount, replayed, authority=None):
    directory = os.open(namespace, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        opened = os.fstat(directory)
        if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            raise ValueError("namespace directory changed during admission")
        try:
            os.mkdir(index_hash, 0o700, dir_fd=directory)
            os.fsync(directory)
        except FileExistsError: pass
        root = namespace/index_hash
        info = root.lstat()
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) != 0o700 or root.resolve(strict=True) != root):
            raise ValueError("reserved index root is unsafe; preserve its charge and state")
        _binding(root, binding, authority)
        with index_writer_lease(root) as lease:
            _binding(root, binding, authority)
            index_storage_footprint(lease, file_bytes=config["processLimits"]["fileBytes"],
                                    aggregate_bytes=amount)
            yield ChargedIndexRoot(lease, index_hash, binding, amount, replayed, namespace_lease)
            _binding(root, binding, authority)
            index_storage_footprint(lease, file_bytes=config["processLimits"]["fileBytes"],
                                    aggregate_bytes=amount)
            _lease(namespace_lease)
            if authority is not None: _verify_plan_reservations(registry, authority)
    finally:
        os.close(directory)


@contextmanager
def charged_index_root(namespace_lease, registry, binding_bytes):
    """Reserve once, then create/lease its exact SHA-named private child."""
    config = decode_index_binding(binding_bytes)
    key = hashlib.sha256(binding_bytes).hexdigest()
    namespace, before = _namespace(namespace_lease, registry)
    reserved = registry.reserve(key, binding_bytes, config["reservedBytes"])
    with _materialize(namespace_lease, registry, namespace, before, key, binding_bytes, config,
                      config["reservedBytes"], reserved["replayed"]) as admitted:
        yield admitted


@contextmanager
def precharged_index_shard_root(namespace_lease, registry, authority, index_hash):
    """Open one child from a complete already charged plan; never reserves here."""
    plan = _authority(authority)
    if type(index_hash) is not str or not re.fullmatch(r"[a-f0-9]{64}", index_hash):
        raise ValueError("shard index hash must be lowercase SHA-256")
    entry = next((row for row in plan.reservations if row[0] == index_hash), None)
    if entry is None:
        raise ValueError("requested child is not in the immutable shard plan")
    _, binding_bytes, amount = entry
    config = decode_planned_index_binding(binding_bytes, plan)
    if config["format"] != "feature-index-binding-v2" or config["reservedBytes"] != amount:
        raise ValueError("planned child binding or amount differs")
    namespace, before = _namespace(namespace_lease, registry, plan)
    with _materialize(namespace_lease, registry, namespace, before, index_hash, binding_bytes, config,
                      amount, True, plan) as admitted:
        yield admitted
