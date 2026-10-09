"""Fixed worker; parent owns leases, limits, and SQL supervision; no acquisition or geometry."""
import hashlib
import fcntl
import json
import os
from pathlib import Path
import re
import resource
import sqlite3
import stat
import select
import time
import sys

HERE = Path(__file__).resolve(strict=True).parent
sys.path.insert(0, str(HERE))

from index_namespace import open_index_namespace, namespace_binding
from index_binding import _nonfinite, _pairs, decode_index_binding, encode_index_shard_binding
from index_reservations import DATABASE_BYTES, REGISTRY_ALLOWANCE, MIB
from index_writer_lock import IndexWriterLease

MIN_AGGREGATE_BYTES = REGISTRY_ALLOWANCE + 65536
MAX_AGGREGATE_BYTES = 512 * MIB
_EXPECTED_STATS = frozenset({"reservations", "heldBytes", "registryAllowanceBytes", "chargedBytes", "aggregateLimitBytes"})
_FORMAT = "feature-index-registry-startup-v1"
_PLAN_FORMAT = "feature-index-shard-plan-v1"
_INPUT_FORMAT = "feature-index-shard-plan-input-v1"
_SHARD_ID_FORMAT = "feature-index-shard-id-v1"
_PLAN_MAX, _PLAN_NODES, _PLAN_DEPTH = 2*MIB, 150000, 16
_SHA = re.compile(r"[a-f0-9]{64}", re.ASCII)


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("ascii")


def _exact(value, keys):
    if type(value) is not dict or set(value) != keys:
        raise ValueError("exact fields differ")
    return value


def _integer(value, low, high):
    if type(value) is not int or not low <= value <= high:
        raise ValueError("integer outside fixed bounds")
    return value


def _hash(value):
    if type(value) is not str or not _SHA.fullmatch(value):
        raise ValueError("expected lowercase SHA-256")


def _bounded_json(raw):
    """Parse bounded canonical plan JSON."""
    if type(raw) is not bytes or not 1 <= len(raw) <= _PLAN_MAX:
        raise ValueError("plan bytes exceed limit")
    try:
        value = json.loads(raw.decode("ascii"), object_pairs_hook=_pairs,
                           parse_constant=_nonfinite)
    except (UnicodeError, RecursionError) as error:
        raise ValueError("invalid ASCII plan JSON") from error
    stack, count = [(value, 0)], 0
    while stack:
        item, depth = stack.pop()
        count += 1
        if count > _PLAN_NODES or depth > _PLAN_DEPTH:
            raise ValueError("plan complexity limit")
        if type(item) is dict:
            stack.extend((child, depth + 1) for child in item.values())
        elif type(item) is list:
            stack.extend((child, depth + 1) for child in item)
    if _canonical(value) != raw:
        raise ValueError("plan is noncanonical")
    return value


def validate_shard_plan(raw, expected_pin, base_binding_bytes):
    """Recompute a pinned plan and derive child bindings; no admission."""
    _exact(expected_pin, {"sha256", "bytes"})
    _hash(expected_pin["sha256"])
    _integer(expected_pin["bytes"], 1, _PLAN_MAX)
    if (type(raw) is not bytes or len(raw) != expected_pin["bytes"]
            or hashlib.sha256(raw).hexdigest() != expected_pin["sha256"]):
        raise ValueError("plan pin mismatch")
    if type(base_binding_bytes) is not bytes or not 1 <= len(base_binding_bytes) <= 4096:
        raise ValueError("base binding bytes exceed limit")
    base = decode_index_binding(base_binding_bytes)
    base_hash = hashlib.sha256(base_binding_bytes).hexdigest()
    plan_value = _bounded_json(raw)
    fields = {"format", "inputFormat", "scope", "admission", "geometryCoverage", "occupancy",
              "fixedRegistryAllowanceBytes", "bindings", "policy", "requestCount", "requiredObservationCount",
              "descriptorBytes", "membershipSha256", "requests", "shards", "namespaceChargeBytes"}
    _exact(plan_value, fields)

    status = (
        plan_value["format"], plan_value["inputFormat"], plan_value["scope"],
        plan_value["admission"], plan_value["geometryCoverage"], plan_value["occupancy"],
    )
    if status != (_PLAN_FORMAT, _INPUT_FORMAT, "namespace-batch", "not-admitted", "not-compiled", "not-checked"):
        raise ValueError("plan status or scope invalid")

    bindings = _exact(plan_value["bindings"], {"campaignHash", "countryGridPlanHash",
        "sourceConfigurationHash", "toolingManifestHash", "baseIndexBindingHash"})
    for pin in bindings.values():
        _hash(pin)
    if (bindings["baseIndexBindingHash"] != base_hash
            or bindings["sourceConfigurationHash"] != base["source"]["configuration"]["sha256"]
            or bindings["toolingManifestHash"] != base["toolingManifest"]["sha256"]):
        raise ValueError("base pins mismatch")

    policy = _exact(plan_value["policy"], {
        "aggregateBytes", "registryControlBytes", "shardReservedBytes", "maxCaptures",
        "descriptorBytes", "envelopeOverheadBytes", "maxShards", "maxAttempts",
    })
    policy_bounds = (
        ("aggregateBytes", 1, 512 * MIB),
        ("registryControlBytes", 1, MIB),
        ("shardReservedBytes", 65536, 512 * MIB),
        ("maxCaptures", 1, 256),
        ("descriptorBytes", 1, 512000),
        ("envelopeOverheadBytes", 1, 512000),
        ("maxShards", 1, 256),
        ("maxAttempts", 1, 8),
    )
    for key, lower, upper in policy_bounds:
        _integer(policy[key], lower, upper)
    if (policy["descriptorBytes"] + policy["envelopeOverheadBytes"] > 512000
            or policy["registryControlBytes"] > policy["aggregateBytes"]
            or policy["shardReservedBytes"] != base["reservedBytes"]):
        raise ValueError("plan policy or base reservation mismatch")

    # Physical file allowance is independent of the planner's logical namespace charge.
    physical_bytes = (4 * base["processLimits"]["fileBytes"] + 2 * 512000
                      + 3 * MIB + 65536)
    if physical_bytes > base["reservedBytes"]:
        raise ValueError("physical reservation too small")

    requests = plan_value["requests"]
    if type(requests) is not list or not 1 <= len(requests) <= 4096:
        raise ValueError("request count outside 1..4096")
    request_fields = {"requestHash", "captureInputHash", "requiredObservationSetHash",
                      "requiredObservationCount", "auditDescriptorBytes"}
    previous_hash = ""
    descriptor_total = observation_total = 0
    for request in requests:
        _exact(request, request_fields)
        for key in ("requestHash", "captureInputHash", "requiredObservationSetHash"):
            _hash(request[key])
        if request["requestHash"] <= previous_hash:
            raise ValueError("request hashes not strictly ordered")
        previous_hash = request["requestHash"]
        observation_total += _integer(request["requiredObservationCount"], 1, 8)
        descriptor_total += _integer(request["auditDescriptorBytes"], 1, policy["descriptorBytes"])

    membership_hash = hashlib.sha256(_canonical(requests)).hexdigest()
    groups, current_group, used_descriptor_bytes = [], [], 0
    for r in requests:
        exceeds_capture_limit = len(current_group) >= policy["maxCaptures"]
        exceeds_descriptor_limit = (used_descriptor_bytes + r["auditDescriptorBytes"]
                                    > policy["descriptorBytes"])
        if current_group and (exceeds_capture_limit or exceeds_descriptor_limit):
            groups.append(current_group)
            current_group, used_descriptor_bytes = [], 0
        current_group.append(r)
        used_descriptor_bytes += r["auditDescriptorBytes"]
    if current_group:
        groups.append(current_group)
    if len(groups) > policy["maxShards"]:
        raise ValueError("shard count limit exceeded")

    namespace_charge = (REGISTRY_ALLOWANCE + policy["registryControlBytes"]
                        + len(groups) * policy["shardReservedBytes"])
    if namespace_charge > policy["aggregateBytes"]:
        raise ValueError("aggregate quota exceeded")

    shards, entries = [], []
    for ordinal, members in enumerate(groups):
        request_hashes = [request["requestHash"] for request in members]
        shard_descriptor_bytes = sum(request["auditDescriptorBytes"] for request in members)
        shard_observation_count = sum(request["requiredObservationCount"] for request in members)
        shard_identity = {
            "format": _SHARD_ID_FORMAT,
            "bindings": bindings,
            "membershipSha256": membership_hash,
            "ordinal": ordinal,
            "requestHashes": request_hashes,
        }
        shard_id = f"shard-{ordinal:03d}-{hashlib.sha256(_canonical(shard_identity)).hexdigest()}"
        shards.append({
            "id": shard_id,
            "ordinal": ordinal,
            "requestHashes": request_hashes,
            "requestCount": len(members),
            "descriptorBytes": shard_descriptor_bytes,
            "envelopeBytes": shard_descriptor_bytes + policy["envelopeOverheadBytes"],
            "requiredObservationCount": shard_observation_count,
            "reservedBytes": policy["shardReservedBytes"],
        })
        shard_pins = {
            "planHash": expected_pin["sha256"],
            "shardId": hashlib.sha256(shard_id.encode("ascii")).hexdigest(),
            "membershipHash": hashlib.sha256(_canonical(request_hashes)).hexdigest(),
            "baseIndexBindingHash": base_hash,
        }
        binding_bytes = encode_index_shard_binding(base_binding_bytes, shard_pins)
        entries.append({
            "indexHash": hashlib.sha256(binding_bytes).hexdigest(),
            "bindingBytes": binding_bytes,
            "reservedBytes": base["reservedBytes"],
        })

    recomputed_plan = dict(plan_value)
    recomputed_plan.update({
        "fixedRegistryAllowanceBytes": REGISTRY_ALLOWANCE,
        "requestCount": len(requests),
        "requiredObservationCount": observation_total,
        "descriptorBytes": descriptor_total,
        "membershipSha256": membership_hash,
        "shards": shards,
        "namespaceChargeBytes": namespace_charge,
    })
    if _canonical(recomputed_plan) != raw:
        raise ValueError("plan recomputation mismatch")
    entries.sort(key=lambda row: row["indexHash"])
    return {"plan": recomputed_plan, "reservations": entries}



def read_plan_stream(read_fd, ack_fd, namespace_descriptor, expected_pin):
    """Read the pinned plan and ACK each complete bounded chunk."""
    if type(expected_pin) is not dict: raise ValueError("bad plan pin")
    pin = dict(expected_pin)
    if (set(pin) != {"sha256", "bytes"} or type(pin["sha256"]) is not str
            or not re.fullmatch(r"[a-f0-9]{64}", pin["sha256"])
            or type(pin["bytes"]) is not int or not 1 <= pin["bytes"] <= 2097152):
        raise ValueError("bad plan pin")
    fds = (read_fd, ack_fd, namespace_descriptor)
    if any(type(fd) is not int or not 2 < fd <= 2147483647 for fd in fds) or len(set(fds)) != 3:
        raise ValueError("bad plan FDs")
    def identity(fd):
        info = os.fstat(fd); flags = fcntl.fcntl(fd, fcntl.F_GETFL)
        return info, flags, (info.st_dev, info.st_ino, info.st_uid, info.st_mode, info.st_nlink, flags)
    endpoints = []
    for fd, access in ((read_fd, os.O_RDONLY), (ack_fd, os.O_WRONLY)):
        info, flags, stamp = identity(fd)
        if (not stat.S_ISFIFO(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600
                or info.st_nlink not in {0, 1} or flags & os.O_ACCMODE != access or not flags & os.O_NONBLOCK):
            raise ValueError("invalid plan pipe")
        endpoints.append(stamp)
    def lease_identity():
        info = os.fstat(namespace_descriptor); flags = fcntl.fcntl(namespace_descriptor, fcntl.F_GETFL)
        named = (Path(os.environ["TMPDIR"])/"writer.lock").lstat()
        identity = (info.st_dev, info.st_ino, info.st_uid, info.st_mode, info.st_nlink, info.st_size)
        if identity != (named.st_dev, named.st_ino, named.st_uid, named.st_mode, named.st_nlink, named.st_size):
            raise ValueError("namespace lock path changed")
        return info, flags, (*identity, flags)
    lease, lease_flags, lease_stamp = lease_identity()
    if (not stat.S_ISREG(lease.st_mode) or lease.st_uid != os.getuid() or stat.S_IMODE(lease.st_mode) != 0o600
            or lease.st_nlink != 1 or lease.st_size or lease_flags & os.O_ACCMODE != os.O_RDWR
            or not lease_flags & os.O_NONBLOCK):
        raise ValueError("invalid namespace lease")
    digest = hashlib.sha256(); raw = bytearray(); chunks = 0; remaining = pin["bytes"]
    def ready(reading, fd):
        while True:
            try: r, w, _ = select.select([fd] if reading else [], [] if reading else [fd], [], 1)
            except InterruptedError: continue
            if (r if reading else w): return
    def write_ack(view):
        while view:
            ready(False, ack_fd)
            try: count = os.write(ack_fd, view)
            except (BlockingIOError, InterruptedError): continue
            if count < 1: raise ValueError("ACK closed")
            view = view[count:]
    while remaining:
        size = min(32768, remaining); data = bytearray()
        while len(data) < size:
            ready(True, read_fd)
            try: part = os.read(read_fd, size-len(data))
            except (BlockingIOError, InterruptedError): continue
            if not part: raise ValueError("short plan")
            data.extend(part)
        digest.update(data); raw.extend(data); remaining -= size; chunks += 1
        write_ack(memoryview(chunks.to_bytes(4, "big")+size.to_bytes(4, "big")))
    ready(True, read_fd)
    while True:
        try: extra = os.read(read_fd, 1); break
        except (BlockingIOError, InterruptedError): ready(True, read_fd)
    if extra or digest.hexdigest() != pin["sha256"]: raise ValueError("plan length/hash mismatch")
    if [identity(fd)[2] for fd in (read_fd, ack_fd)] != endpoints or lease_identity()[2] != lease_stamp:
        raise ValueError("plan input or namespace lease changed")
    return bytes(raw), {"bytes": len(raw), "sha256": digest.hexdigest(), "chunks": chunks}


def _witness_limits():
    file_limit = resource.getrlimit(resource.RLIMIT_FSIZE)[0]
    cpu_limit = resource.getrlimit(resource.RLIMIT_CPU)[0]
    if (file_limit == resource.RLIM_INFINITY or not 0 < file_limit <= DATABASE_BYTES
            or cpu_limit == resource.RLIM_INFINITY or not 0 < cpu_limit <= 60
            or resource.getrlimit(resource.RLIMIT_CORE) != (0, 0)):
        raise RuntimeError("fixed witness did not inherit kernel limits")
    return file_limit, cpu_limit


def _lease_witness():
    root, _, lease = _runtime_environment()
    file_limit, cpu_limit = _witness_limits()
    execution = HERE.parent.parent
    print(json.dumps({"pid": os.getpid(), "namespace": str(root), "device": lease.device,
                      "inode": lease.inode, "executionRoot": str(execution),
                      "fileLimit": file_limit, "cpuLimit": cpu_limit, "coreLimit": 0}), flush=True)
    deadline = time.monotonic() + 10
    release = execution/"lease.release"
    while time.monotonic() < deadline:
        try: descriptor = os.open(release, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError:
            time.sleep(0.02); continue
        try:
            info = os.fstat(descriptor); named = release.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1
                    or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size != 1
                    or (info.st_dev, info.st_ino) != (named.st_dev, named.st_ino)
                    or os.read(descriptor, 2) != b"X"):
                raise ValueError("fixed private acknowledgement differs")
            return 0
        finally: os.close(descriptor)
    raise RuntimeError("fixed witness exceeded its bounded acknowledgement wait")


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
    if sys.argv == [sys.argv[0], "--lease-witness"]:
        return _lease_witness()
    if len(sys.argv) != 1:
        raise ValueError("namespace registry worker accepts no arguments")
    root, budget, namespace_lease = _runtime_environment()
    report = _run(root, budget, namespace_lease)
    print(report, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
