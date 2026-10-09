"""Fixed supervised registry reservation and charge-before-create admission."""
import hashlib
import json
import os
from pathlib import Path
import signal
import sqlite3
import stat
import sys

HERE = Path(__file__).resolve(strict=True).parent
sys.path.insert(0, str(HERE))

from index_admission_input import (read_admission_input,
    _read_binding_descriptor, binding_pin, validate_admission_binding)
from index_binding import decode_index_binding
from index_binding_publish import publish_index_binding, publish_index_shard_binding
from index_namespace import open_index_namespace, open_index_shard_namespace, namespace_binding
from index_root import (charged_index_root, precharged_index_shard_root, _binding, _lease,
    prepare_index_shard_plan_authority, planned_index_reservations, _verify_plan_reservations)
from index_reservations import MAX_RESERVATIONS
from index_controller_record import verify_terminal_plan_record
from index_controller_state import (RECORD, REGISTRY, REGISTRY_PENDING, EXECUTION, RECLAIM,
    read_private, anchor_registry, shard_admission_summary)
from index_registry_worker import (_runtime_environment, _private_database, _private_root,
                                   _read_exact_private, _rss_kib, _EXPECTED_STATS, read_plan_stream, _witness_limits)
from index_execution_snapshot import (CONFIGURATION, _plan_pipe, _read_plan_transport,
    read_admission_base_input)
from index_storage_footprint import verify_terminal_registry


def _shard_prefix(root, authority):
    entries = planned_index_reservations(authority)
    expected = [row[0] for row in entries]
    base_hash = hashlib.sha256(authority.base_binding).hexdigest()
    names = []
    with os.scandir(root) as children:
        for child in children:
            if child.name in {EXECUTION, RECLAIM}: continue
            if child.name == base_hash: continue
            if not child.is_dir(follow_symlinks=False): continue
            names.append(child.name)
    names.sort()
    if names != expected[:len(names)]:
        raise ValueError("existing planned shard roots are not an exact deterministic prefix")
    for position, key in enumerate(names):
        child = root/key
        binding = entries[position][1]
        _binding(child, binding, authority)
        contents = {entry.name for entry in os.scandir(child)}
        if position < len(names)-1 and "binding.json" not in contents:
            raise ValueError("only the last planned prefix root may have a staged binding")
    return len(names)


def run_shard_admission(root, budget, namespace_lease, plan_raw, plan_pin,
                        on_boundary=lambda name: None):
    plan_pin = dict(plan_pin)
    raw, base_raw, _ = read_admission_base_input(root, namespace_lease.descriptor, plan_pin)
    if plan_raw is not None and raw != plan_raw:
        raise ValueError("streamed plan differs from the exact supervisor pin")
    authority = prepare_index_shard_plan_authority(raw, plan_pin, base_raw)
    if authority.aggregate_bytes != budget:
        raise ValueError("plan aggregate differs from the held namespace budget")
    entries = planned_index_reservations(authority)
    base_hash = hashlib.sha256(base_raw).hexdigest()
    metadata = namespace_binding(budget)
    with open_index_shard_namespace(root, authority, inherited_lease=namespace_lease) as opened:
        if opened.binding_bytes != metadata:
            raise ValueError("shard namespace binding differs from its immutable aggregate")
        rows = {row[0] for row in opened.registry.db.execute("SELECT hash,binding,reserved_bytes FROM reservations")}
        base_present = base_hash in rows
        if len(entries) + int(base_present) > MAX_RESERVATIONS:
            raise ValueError("complete plan plus optional legacy base exceeds the fixed 256-row cap")
        if rows and not (root/REGISTRY).exists() and not (root/REGISTRY_PENDING).exists():
            raise ValueError("charged registry has no original-inode witness; preserve it")
        anchor_registry(root)
        _shard_prefix(root, authority)
        on_boundary("before-charge")
        receipts = opened.registry.reserve_many([{"indexHash": key, "bindingBytes": binding,
            "reservedBytes": amount} for key, binding, amount in entries])
        if len(receipts) != len(entries): raise ValueError("atomic batch charge returned an incomplete receipt")
        _verify_plan_reservations(opened.registry, authority)
        on_boundary("charged")
        for key, _, _ in entries:
            with precharged_index_shard_root(namespace_lease, opened.registry, authority, key) as admitted:
                publish_index_shard_binding(admitted, authority)
            on_boundary("root-published")
        stats = opened.registry.snapshot()
        _verify_plan_reservations(opened.registry, authority)
        replayed = opened.replayed
    _lease(namespace_lease); _private_root(root); _private_database(root/"reservations.sqlite")
    _read_exact_private(root/"namespace.json", metadata)
    summary = shard_admission_summary(root, authority)
    base_amount = decode_index_binding(base_raw)["reservedBytes"] if base_present else 0
    if (set(stats) != _EXPECTED_STATS or stats["reservations"] != len(entries)+int(base_present)
            or stats["heldBytes"] != summary["reservedBytes"]+base_amount):
        raise ValueError("final complete shard charge differs from exact planned rows")
    report = {"format": "feature-index-registry-admit-plan-v1",
        "namespaceBindingSha256": hashlib.sha256(metadata).hexdigest(), "aggregateBytes": budget,
        "replayed": replayed, "pythonVersion": sys.version.split()[0],
        "sqliteVersion": __import__("sqlite3").sqlite_version, "stats": stats,
        "databaseBytes": (root/"reservations.sqlite").stat().st_size,
        "maximumRssKiB": _rss_kib(), "shardAdmission": summary}
    encoded = json.dumps(report, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    if len(encoded.encode("ascii")) > 8192: raise ValueError("batch admission report exceeds its fixed byte bound")
    return encoded


def verify_shard_registry(root, budget, namespace_lease, plan_raw, plan_pin, base_raw):
    """Read-only proof of an already terminal complete batch; no SQL writer APIs."""
    from index_controller_state import verify_registry_anchor
    from index_execution_snapshot import CONFIGURATION
    from index_namespace import namespace_binding
    authority = prepare_index_shard_plan_authority(plan_raw, plan_pin, base_raw)
    if authority.aggregate_bytes != budget:
        raise ValueError("plan aggregate differs from the held namespace budget")
    pin = dict(plan_pin); base_pin = binding_pin(base_raw)
    operation = {"kind":"admit-plan","plan":pin,"baseBinding":base_pin}
    record_raw = read_private(root/RECORD)
    source_path = Path(__file__).resolve().parent.parent.parent/CONFIGURATION
    source = read_private(source_path,64000,(0o400,))
    source_pin = {"sha256":hashlib.sha256(source).hexdigest(),"bytes":len(source)}
    root_info = _private_root(root); lock_info = os.fstat(namespace_lease.descriptor)
    namespace = {"device":root_info.st_dev,"inode":root_info.st_ino,
        "lockDevice":lock_info.st_dev,"lockInode":lock_info.st_ino,"aggregateBytes":budget}
    record = verify_terminal_plan_record(record_raw,operation,source_pin,namespace,
        sys.version.split()[0],sqlite3.sqlite_version)
    manifest_pin = record.get("toolingManifest")
    validate_admission_binding(base_raw,manifest_pin,source_pin,source)
    report=verify_terminal_registry(root,budget,namespace_lease,record_raw,authority,base_raw)
    encoded=json.dumps(report,sort_keys=True,separators=(",",":"),ensure_ascii=True)
    if len(encoded.encode("ascii"))>4096: raise ValueError("verification report exceeds its fixed byte bound")
    return encoded


def run_admission(root, budget, namespace_lease, on_boundary=lambda name: None):
    # Verify the durable operation and binding before SQL.
    raw = read_admission_input(root, namespace_lease.descriptor)
    config = decode_index_binding(raw); index_hash = hashlib.sha256(raw).hexdigest()
    metadata = namespace_binding(budget)
    with open_index_namespace(root, budget, inherited_lease=namespace_lease) as opened:
        if opened.binding_bytes != metadata: raise ValueError("admission namespace binding differs")
        original_reserve = opened.registry.reserve
        def reserve(*args, **kwargs):
            result = original_reserve(*args, **kwargs)
            on_boundary("reserved")  # Actual durable charge/checkpoint, before mkdir.
            return result
        opened.registry.reserve = reserve
        with charged_index_root(namespace_lease, opened.registry, raw) as admitted:
            publish_index_binding(admitted)
            on_boundary("binding-published")
            child, child_info = _lease(admitted.lease)
            admission = {"indexHash": index_hash, "reservedBytes": admitted.reserved_bytes,
                         "replayed": admitted.replayed_reservation,
                         "rootDevice": child_info.st_dev, "rootInode": child_info.st_ino,
                         "lockDevice": admitted.lease.device, "lockInode": admitted.lease.inode}
            stats = opened.registry.snapshot()
        replayed = opened.replayed
    # SQL has closed before output; inherited namespace lease remains held.
    _lease(namespace_lease); _private_root(root); _private_database(root/"reservations.sqlite")
    _read_exact_private(root/"namespace.json", metadata)
    _binding(child, raw)
    child_after = child.lstat(); lock = (child/"writer.lock").lstat()
    if ((child_after.st_dev, child_after.st_ino) != (admission["rootDevice"], admission["rootInode"])
            or not stat.S_ISDIR(child_after.st_mode) or child_after.st_uid != os.getuid()
            or stat.S_IMODE(child_after.st_mode) != 0o700
            or (lock.st_dev, lock.st_ino) != (admission["lockDevice"], admission["lockInode"])):
        raise ValueError("admitted root/lock changed before report")
    if (set(stats) != _EXPECTED_STATS or stats["heldBytes"] < config["reservedBytes"]
            or stats["reservations"] < 1):
        raise ValueError("admission charge is missing from the registry")
    report = {"format": "feature-index-registry-admit-v1",
              "namespaceBindingSha256": hashlib.sha256(metadata).hexdigest(), "aggregateBytes": budget,
              "replayed": replayed, "pythonVersion": sys.version.split()[0],
              "sqliteVersion": __import__("sqlite3").sqlite_version, "stats": stats,
              "databaseBytes": (root/"reservations.sqlite").stat().st_size,
              "maximumRssKiB": _rss_kib(), "admission": admission}
    result = json.dumps(report, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    if len(result.encode("ascii")) > 4096: raise ValueError("admission report exceeds fixed bound")
    return result


def _plan_witness():
    """Fixed bounded transport witness; never opens SQL or allocates children."""
    root, _, lease = _runtime_environment()
    _witness_limits()
    _, _, report = _read_plan_transport(lease.descriptor)
    print(json.dumps({"format": "index-registry-plan-witness-v1", **report}, sort_keys=True), flush=True)
    return 0


def _crash_witness(boundary_name):
    """SIGKILL only at one exact durable admission boundary."""
    root, budget, lease = _runtime_environment()

    def boundary(name):
        if name == boundary_name:
            os.kill(os.getpid(), signal.SIGKILL)

    run_admission(root, budget, lease, boundary)
    raise RuntimeError("admission witness did not reach its fixed boundary")


def _shards(crash_boundary=None):
    root, budget, lease = _runtime_environment()
    _witness_limits()
    _, _, plan_pin = _plan_pipe()

    def boundary(name):
        if name == crash_boundary:
            os.kill(os.getpid(), signal.SIGKILL)

    result = run_shard_admission(root, budget, lease, None, plan_pin, boundary)
    print(result, flush=True)
    return 0


def _verify_plan():
    root, budget, lease = _runtime_environment()
    _witness_limits()
    raw, pin, _ = _read_plan_transport(lease.descriptor)
    base=_read_binding_descriptor(lease.descriptor)
    descriptor=int(os.environ["WORLD_INDEX_BINDING_DESCRIPTOR"])
    if descriptor in {int(os.environ["WORLD_INDEX_PLAN_DESCRIPTOR"]),
                      int(os.environ["WORLD_INDEX_PLAN_ACK_DESCRIPTOR"]),lease.descriptor}:
        raise ValueError("plan, base binding and namespace descriptors must be distinct")
    print(verify_shard_registry(root,budget,lease,raw,pin,base),flush=True)
    return 0


def main():
    if sys.argv == [sys.argv[0], "--plan"]:
        return _plan_witness()
    if sys.argv == [sys.argv[0], "--verify-plan"]:
        return _verify_plan()
    if sys.argv == [sys.argv[0], "--shards"]:
        return _shards()
    if sys.argv[1:2] == ["--shards-crash"]:
        if len(sys.argv) != 3 or sys.argv[2] not in {"before-charge", "charged", "root-published"}:
            raise ValueError("batch admission requires one fixed charge/publication boundary")
        return _shards(sys.argv[2])
    if sys.argv[1:2] == ["--crash"]:
        if len(sys.argv) != 3 or sys.argv[2] not in {"reserved", "binding-published"}:
            raise ValueError("admission witness requires one fixed boundary")
        return _crash_witness(sys.argv[2])
    if len(sys.argv) != 1: raise ValueError("admission worker accepts no arguments")
    root, budget, lease = _runtime_environment()
    print(run_admission(root, budget, lease), flush=True)
    return 0


if __name__ == "__main__": raise SystemExit(main())
