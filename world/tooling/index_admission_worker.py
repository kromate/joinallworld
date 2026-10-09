"""Fixed supervised registry reservation and charge-before-create admission."""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
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
from index_controller_record import decode_controller_record, FORMAT_V3
from index_controller_state import (RECORD, REGISTRY, REGISTRY_PENDING, EXECUTION, RECLAIM,
    read_private, anchor_registry)
from index_registry_worker import (_runtime_environment, _private_database, _private_root,
                                   _read_exact_private, _rss_kib, _EXPECTED_STATS, read_plan_stream, _witness_limits)


def read_admission_base_input(root, namespace_descriptor, plan_pin):
    plan_pin = dict(plan_pin) if type(plan_pin) is dict else plan_pin
    if (type(plan_pin) is not dict or set(plan_pin) != {"sha256", "bytes"}
            or type(plan_pin["sha256"]) is not str or not re.fullmatch(r"[a-f0-9]{64}", plan_pin["sha256"])
            or type(plan_pin["bytes"]) is not int or not 1 <= plan_pin["bytes"] <= 2*1024*1024):
        raise ValueError("shard admission requires its exact bounded plan pin")
    base_raw = _read_binding_descriptor(namespace_descriptor); base_pin = binding_pin(base_raw)
    values = [os.environ.get("WORLD_INDEX_PLAN_"+name) for name in
              ("DESCRIPTOR", "ACK_DESCRIPTOR", "BYTES", "SHA256")]
    plan_fd, ack_fd, length, digest = values
    if (any(type(value) is not str for value in values) or not plan_fd.isdigit()
            or not ack_fd.isdigit() or not length.isdigit() or len(plan_fd)>10 or len(ack_fd)>10
            or len(length)>7 or {"sha256":digest,"bytes":int(length)} != plan_pin):
        raise ValueError("plan pipes differ from the exact durable pin")
    record = decode_controller_record(read_private(root/RECORD))
    operation = {"kind":"admit-plan","plan":plan_pin,"baseBinding":base_pin}
    attempts = record["attempts"]
    if (record["format"] != FORMAT_V3 or record.get("operation") != operation or not attempts
            or attempts[-1]["phase"] != "prepared" or attempts[-1]["operation"] != operation
            or attempts[-1]["snapshotDevice"] is None):
        raise ValueError("shard admission lacks its exact prepared V3 operation")
    snapshot = (root/"controller.execution").lstat(); attempt = attempts[-1]
    if (not stat.S_ISDIR(snapshot.st_mode) or snapshot.st_uid != os.getuid()
            or stat.S_IMODE(snapshot.st_mode) != 0o700
            or (snapshot.st_dev,snapshot.st_ino)!=(attempt["snapshotDevice"],attempt["snapshotInode"])):
        raise ValueError("prepared execution snapshot identity differs from durable state")
    config = read_private(Path(__file__).resolve().parent.parent/"acquisition-sources.json",64000,(0o400,))
    source_pin = {"sha256":hashlib.sha256(config).hexdigest(),"bytes":len(config)}
    if source_pin != record["sourceConfiguration"]: raise ValueError("source configuration pin differs")
    validate_admission_binding(base_raw,record["toolingManifest"],source_pin,config)
    raw, receipt = read_plan_stream(int(plan_fd),int(ack_fd),namespace_descriptor,plan_pin)
    return raw, base_raw, receipt


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


def shard_admission_summary(root, authority):
    entries = planned_index_reservations(authority)
    identities = []
    for key, binding, _ in entries:
        child = root/key
        _binding(child, binding, authority)
        names = {entry.name for entry in os.scandir(child)}
        if "binding.json" not in names or "binding.pending" in names:
            raise ValueError("every charged shard must have its published immutable binding")
        info = child.lstat(); lock = (child/"writer.lock").lstat()
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) != 0o700 or lock.st_uid != os.getuid()
                or not stat.S_ISREG(lock.st_mode) or lock.st_nlink != 1
                or stat.S_IMODE(lock.st_mode) != 0o600 or lock.st_size != 0):
            raise ValueError("published shard root or permanent lock is unsafe")
        identities.append({"indexHash": key, "rootDevice": info.st_dev, "rootInode": info.st_ino,
            "lockDevice": lock.st_dev, "lockInode": lock.st_ino})
    encoded = json.dumps(identities, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")
    return {"planHash": authority.plan_hash, "shards": len(entries),
            "reservedBytes": sum(row[2] for row in entries),
            "rootIdentitySha256": hashlib.sha256(encoded).hexdigest()}


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
    raw_fd = os.environ.get("WORLD_INDEX_PLAN_DESCRIPTOR")
    raw_ack = os.environ.get("WORLD_INDEX_PLAN_ACK_DESCRIPTOR")
    raw_bytes = os.environ.get("WORLD_INDEX_PLAN_BYTES")
    raw_sha = os.environ.get("WORLD_INDEX_PLAN_SHA256")
    if (any(type(value) is not str for value in (raw_fd, raw_ack, raw_bytes, raw_sha))
            or not raw_fd.isdigit() or not raw_ack.isdigit() or not raw_bytes.isdigit()
            or len(raw_fd) > 10 or len(raw_ack) > 10 or len(raw_bytes) > 7
            or len(raw_sha) != 64 or any(char not in "0123456789abcdef" for char in raw_sha)):
        raise ValueError("plan witness requires exact bounded pipe pins")
    _, report = read_plan_stream(int(raw_fd), int(raw_ack), lease.descriptor,
                                 {"sha256": raw_sha, "bytes": int(raw_bytes)})
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
    raw_fd, ack_fd = (os.environ.get("WORLD_INDEX_PLAN_DESCRIPTOR"),
        os.environ.get("WORLD_INDEX_PLAN_ACK_DESCRIPTOR"))
    size, digest = (os.environ.get("WORLD_INDEX_PLAN_BYTES"),
        os.environ.get("WORLD_INDEX_PLAN_SHA256"))
    if (any(type(value) is not str for value in (raw_fd, ack_fd, size, digest))
            or any(not value.isascii() or not value.isdigit() for value in (raw_fd, ack_fd, size))
            or len(raw_fd) > 10 or len(ack_fd) > 10 or len(size) > 7
            or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest)):
        raise ValueError("batch admission requires exact bounded plan transport pins")
    plan_pin = {"sha256": digest, "bytes": int(size)}

    def boundary(name):
        if name == crash_boundary:
            os.kill(os.getpid(), signal.SIGKILL)

    result = run_shard_admission(root, budget, lease, None, plan_pin, boundary)
    print(result, flush=True)
    return 0


def main():
    if sys.argv == [sys.argv[0], "--plan"]:
        return _plan_witness()
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
