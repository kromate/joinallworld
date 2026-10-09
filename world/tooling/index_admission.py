"""Held-lease supervised admission, yielding an index without parent SQL.

Reservation SQL executes only in the fixed worker under persistent namespace
attempt ownership. No implicit v1 controller migration, capture attempt ledger,
campaign observation/completion, data download or quota refund is performed.
"""
from contextlib import contextmanager
import hashlib
from pathlib import Path

from index_admission_input import validate_admission_binding
from index_namespace import _root, _aggregate, _preflight, namespace_binding
from index_registry_startup import _runtime, _admission_report
from index_registry_controller import restartable_registry_startup
from index_root import ChargedIndexRoot, _lease, _binding
from index_storage_footprint import index_storage_footprint
from index_writer_lock import index_writer_lease


@contextmanager
def supervised_charged_index(namespace_root, aggregate_bytes, repository_root, manifest_bytes,
                             manifest_pin, source_configuration, source_pin, python, python_runtime,
                             binding_bytes, *, cpu_seconds=10, wall_seconds=15,
                             rss_limit_bytes=96*1024*1024, attempt_limit=16):
    """Hold the actual namespace lock from supervised charge through caller ingestion.

    A successful return from the controller proves a terminal, verified fixed
    reservation worker. Reacquire the reported child lock without releasing the
    namespace lock; a changed directory, binding or inode refuses the handoff.
    The caller must confirm its ingestion worker terminal before leaving this
    context. Unconfirmed workers retain inherited leases and all database state.
    """
    config = validate_admission_binding(binding_bytes, manifest_pin, source_pin, source_configuration)
    runtime = _runtime(python_runtime); aggregate = _aggregate(aggregate_bytes)
    root, _ = _root(namespace_root)
    expected = namespace_binding(aggregate, sqlite_version=runtime["sqliteVersion"])
    _preflight(root, expected, aggregate, controller_check=False)
    with index_writer_lease(root) as namespace_lease:
        result = restartable_registry_startup(root, aggregate, Path(repository_root), manifest_bytes,
            manifest_pin, source_configuration, source_pin, python, runtime,
            cpu_seconds=cpu_seconds, wall_seconds=wall_seconds, rss_limit_bytes=rss_limit_bytes,
            attempt_limit=attempt_limit, _binding_bytes=binding_bytes, _inherited_lease=namespace_lease)
        _lease(namespace_lease)
        report = result["registry"]; admission = report["admission"]
        _admission_report(admission, root, binding_bytes, report["stats"])
        index_hash = hashlib.sha256(binding_bytes).hexdigest(); child = root/index_hash
        with index_writer_lease(child) as lease:
            _, info = _lease(lease)
            if ((info.st_dev, info.st_ino) != (admission["rootDevice"], admission["rootInode"])
                    or (lease.device, lease.inode) != (admission["lockDevice"], admission["lockInode"])):
                raise ValueError("admitted root/lock changed during supervised lease handoff")
            _binding(child, binding_bytes)
            index_storage_footprint(lease, file_bytes=config["processLimits"]["fileBytes"],
                                    aggregate_bytes=config["reservedBytes"])
            admitted = ChargedIndexRoot(lease, index_hash, binding_bytes, config["reservedBytes"],
                                        admission["replayed"], namespace_lease)
            yield admitted, result
            _lease(lease); _lease(namespace_lease); _binding(child, binding_bytes)
            index_storage_footprint(lease, file_bytes=config["processLimits"]["fileBytes"],
                                    aggregate_bytes=config["reservedBytes"])
