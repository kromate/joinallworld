"""Real SQLite/root tests for structural batch admission; fixtures are synthetic."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import resource
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from index_admission_worker import run_shard_admission, _shard_prefix
from index_binding import decode_index_binding
from index_controller_state import publish, anchor_registry
from index_namespace import open_index_namespace
from index_reservations import DATABASE_BYTES, MIB
from index_root import prepare_index_shard_plan_authority, planned_index_reservations
from index_writer_lock import index_writer_lease
from test_index_registry_worker import planner_fixture


@contextmanager
def namespace_fixture(aggregate):
    old = resource.getrlimit(resource.RLIMIT_FSIZE)
    cap = min([DATABASE_BYTES]+[value for value in old if value != resource.RLIM_INFINITY])
    resource.setrlimit(resource.RLIMIT_FSIZE, (cap, old[1]))
    try:
        with tempfile.TemporaryDirectory(prefix="allworld-shard-admission-") as temporary:
            root = Path(temporary).resolve(strict=True)/"namespace"
            root.mkdir(mode=0o700)
            with index_writer_lease(root) as lease:
                with open_index_namespace(root, aggregate, inherited_lease=lease):
                    pass
                yield root, lease
    finally:
        resource.setrlimit(resource.RLIMIT_FSIZE, old)


def _plan(*, count=2, aggregate=128*MIB, reserved=32*MIB):
    requests = [{"requestHash": f"{number:064x}", "captureInputHash": f"{number+1000:064x}",
        "requiredObservationSetHash": f"{number+2000:064x}", "requiredObservationCount": 1,
        "auditDescriptorBytes": 100} for number in range(1, count+1)]
    return planner_fixture(policy_changes={"aggregateBytes":aggregate, "maxCaptures":1,
        "maxShards":256, "descriptorBytes":1000, "shardReservedBytes":reserved}, requests=requests)


def _prepared_record(root, lease, aggregate, raw, pin, base):
    snapshot = root/"controller.execution"; snapshot.mkdir(mode=0o700)
    directory = root.lstat(); lock = (root/"writer.lock").lstat(); snap = snapshot.lstat()
    source = (Path(__file__).resolve().parent.parent/"acquisition-sources.json").read_bytes()
    base_pin = {"sha256":hashlib.sha256(base).hexdigest(),"bytes":len(base)}
    operation = {"kind":"admit-plan","plan":pin,"baseBinding":base_pin}
    publish(root, {"format":"feature-index-controller-v3",
        "namespace":{"device":directory.st_dev,"inode":directory.st_ino,"lockDevice":lock.st_dev,
            "lockInode":lock.st_ino,"aggregateBytes":aggregate},
        "runtime":{"pythonVersion":"3.12.0","sqliteVersion":"3.50.4","pythonBytes":1,"pythonSha256":"d"*64},
        "toolingManifest":{"sha256":"e"*64,"bytes":1},
        "sourceConfiguration":{"sha256":hashlib.sha256(source).hexdigest(),"bytes":len(source)},
        "limits":{"cpuSeconds":10,"wallSeconds":15,"rssBytes":96*1024*1024,"attempts":8},
        "operation":operation,
        "attempts":[{"number":1,"phase":"prepared","workerPid":None,"snapshotDevice":snap.st_dev,
            "snapshotInode":snap.st_ino,"resultSha256":None,"operation":operation}]})


def _reservation_count(root):
    database = sqlite3.connect(f"file:{root/'reservations.sqlite'}?mode=ro", uri=True)
    try: return database.execute("SELECT count(*) FROM reservations").fetchone()[0]
    finally: database.close()


class IndexShardAdmissionWorkerTests(unittest.TestCase):
    def test_actual_atomic_registry_charge_and_root_publication_replay(self):
        raw, pin, base, plan = _plan()
        authority = prepare_index_shard_plan_authority(raw, pin, base)
        with namespace_fixture(plan["policy"]["aggregateBytes"]) as (root, lease):
            _prepared_record(root, lease, plan["policy"]["aggregateBytes"], raw, pin, base)
            with patch("index_admission_worker.read_admission_base_input",
                       return_value=(raw, base, {"sha256":pin["sha256"], "bytes":pin["bytes"]})):
                boundaries = []
                first = json.loads(run_shard_admission(root, plan["policy"]["aggregateBytes"],
                    lease, raw, pin, boundaries.append))
                second = json.loads(run_shard_admission(root, plan["policy"]["aggregateBytes"],
                    lease, raw, pin))
            self.assertEqual([name for name in boundaries if name in {"before-charge", "charged"}],
                             ["before-charge", "charged"])
            self.assertEqual(boundaries.count("root-published"), len(planned_index_reservations(authority)))
            self.assertEqual(first["format"], "feature-index-registry-admit-plan-v1")
            self.assertEqual(first["shardAdmission"]["shards"], len(plan["shards"]))
            self.assertEqual(second["shardAdmission"], first["shardAdmission"])
            self.assertTrue(second["replayed"])
            self.assertEqual(_reservation_count(root), len(plan["shards"]))

    def test_existing_roots_must_be_a_deterministic_plan_prefix(self):
        raw, pin, base, plan = _plan(count=3)
        authority = prepare_index_shard_plan_authority(raw, pin, base)
        with namespace_fixture(plan["policy"]["aggregateBytes"]) as (root, _):
            ordered = [row[0] for row in planned_index_reservations(authority)]
            (root/ordered[0]).mkdir(mode=0o700)
            (root/ordered[2]).mkdir(mode=0o700)
            with self.assertRaisesRegex(ValueError, "deterministic prefix"):
                _shard_prefix(root, authority)
            self.assertTrue((root/ordered[0]).is_dir())
            self.assertTrue((root/ordered[2]).is_dir())

    def test_optional_legacy_reservation_can_make_whole_batch_exceed_budget(self):
        aggregate = 128*MIB
        raw, pin, base, plan = _plan(count=3, aggregate=aggregate, reserved=32*MIB)
        base_amount = decode_index_binding(base)["reservedBytes"]
        with namespace_fixture(aggregate) as (root, lease):
            _prepared_record(root, lease, aggregate, raw, pin, base)
            with open_index_namespace(root, aggregate, inherited_lease=lease) as opened:
                opened.registry.reserve(hashlib.sha256(base).hexdigest(), base, base_amount)
            anchor_registry(root)
            with patch("index_admission_worker.read_admission_base_input",
                       return_value=(raw, base, {"sha256":pin["sha256"], "bytes":pin["bytes"]})):
                with self.assertRaisesRegex(ValueError, "namespace budget"):
                    run_shard_admission(root, aggregate, lease, raw, pin)
            self.assertEqual(_reservation_count(root), 1)
            self.assertFalse(any((root/key).exists() for key, _, _ in
                                 prepare_index_shard_plan_authority(raw, pin, base).reservations))


if __name__ == "__main__":
    unittest.main()
