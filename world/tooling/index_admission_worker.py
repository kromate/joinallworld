"""Fixed supervised registry reservation and charge-before-create admission."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

HERE = Path(__file__).resolve(strict=True).parent
sys.path.insert(0, str(HERE))

from index_admission_input import read_admission_input
from index_binding import decode_index_binding
from index_binding_publish import publish_index_binding
from index_namespace import open_index_namespace, namespace_binding
from index_root import charged_index_root, _binding, _lease
from index_registry_worker import (_runtime_environment, _private_database, _private_root,
                                   _read_exact_private, _rss_kib, _EXPECTED_STATS)


def run_admission(root, budget, namespace_lease, on_boundary=lambda name: None):
    # Fully verify the durable operation and source/binding before SQL.
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


def main():
    if len(sys.argv) != 1: raise ValueError("admission worker accepts no arguments")
    root, budget, lease = _runtime_environment()
    print(run_admission(root, budget, lease), flush=True)
    return 0


if __name__ == "__main__": raise SystemExit(main())
