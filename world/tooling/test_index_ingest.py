"""Real retained Dakar data into disposable charged indexes; no actual cache/ledger writes."""
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from index_ingest import ingest_index, capture_descriptors
from index_binding import decode_index_binding, encode_index_binding
from index_resource_limits import _run_fixed_process, IndexWorkerUnreaped
from index_root import charged_index_root
from test_index_root import fixture
import test_index_bootstrap as bootstrap_fixture

source_fixture = bootstrap_fixture.source_fixture
pin = bootstrap_fixture.pin

ROOT = Path(__file__).resolve().parent.parent.parent


def inputs():
    products = json.loads((ROOT/"world/regional-fanout.json").read_bytes())["products"][:2]
    result = []
    for product in products:
        extract = product["parentInput"]; receipt = product["parentReceipt"]
        ep = ROOT/extract["path"]; rp = ROOT/receipt["path"]
        receipt_raw = rp.read_bytes()
        if pin(receipt_raw) != {key: receipt[key] for key in ["sha256", "bytes"]}:
            raise ValueError("retained receipt does not match product pin")
        expected = {"requestHash": ep.parent.name, "request": json.loads(receipt_raw)["request"],
                    "extract": {key: extract[key] for key in ["sha256", "bytes"]},
                    "receipt": {key: receipt[key] for key in ["sha256", "bytes"]}}
        result.append((ep, rp, expected))
    return result


class IndexIngestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        bootstrap_fixture.IndexBootstrapTests.setUpClass.__func__(cls)

    bound = bootstrap_fixture.IndexBootstrapTests.bound

    def test_actual_two_capture_overlap_and_fresh_worker_replay(self):
        retained = inputs()
        before = {path: pin(path.read_bytes()) for pair in retained for path in pair[:2]}
        with source_fixture() as (source, manifest, config), fixture() as (_, namespace, registry):
            raw = self.bound(manifest, config)
            with charged_index_root(namespace, registry, raw) as admitted:
                reports = [ingest_index(admitted, source, manifest, config, self.node, *item) for item in retained]
                final = admitted.lease.root/"features.sqlite"; inode = final.stat().st_ino
                self.assertEqual([r["ingest"]["result"]["features"] for r in reports], [473, 1810])
                self.assertEqual([r["ingest"]["result"]["insertedVersions"] for r in reports], [473, 1337])
                self.assertEqual(reports[-1]["ingest"]["stats"], {
                    "captures": 2, "occurrences": 2283, "versions": 1810,
                    "observations": 0, "keys": 1810, "conflictedKeys": 0})
            # Reacquire the same index; both workers are new processes and all raw
            # ordinals are recomputed, rather than accepting a cached report.
            with charged_index_root(namespace, registry, raw) as admitted:
                for original, item in zip(reports, retained):
                    replay = ingest_index(admitted, source, manifest, config, self.node, *item)
                    self.assertTrue(replay["ingest"]["result"]["replayed"])
                    self.assertEqual(replay["ingest"]["result"]["insertedVersions"], 0)
                    self.assertEqual(replay["ingest"]["result"]["dispositionsHash"], original["ingest"]["result"]["dispositionsHash"])
                    self.assertEqual(replay["ingest"]["stats"], reports[-1]["ingest"]["stats"])
                    self.assertTrue(replay["guard"]["inheritedLease"] and replay["guard"]["inheritedNamespaceLease"])
                    self.assertGreater(replay["captureEnvelopeChargedBytes"], 0)
                    self.assertEqual(final.stat().st_ino, inode)
                self.assertFalse((final.parent/"features.sqlite-wal").exists())
            self.assertEqual(registry.snapshot()["reservations"], 1)
        self.assertEqual({path: pin(path.read_bytes()) for path in before}, before)

    def test_actual_sigkill_boundaries_preserve_committed_wal_and_exact_replay(self):
        for boundary in ["before-transaction", "after-commit", "after-checkpoint"]:
            with self.subTest(boundary=boundary), source_fixture() as (source, manifest, config), fixture() as (_, namespace, registry):
                with charged_index_root(namespace, registry, self.bound(manifest, config)) as admitted:
                    observed = []
                    def crash(node, worker, root, **kwargs):
                        result = _run_fixed_process(node, "index-ingest-crash", root, case=boundary, **kwargs)
                        observed.append(result); return result
                    with patch("index_ingest._run_fixed_process", side_effect=crash):
                        with self.assertRaisesRegex(RuntimeError, "fixed ingestion worker failed"):
                            ingest_index(admitted, source, manifest, config, self.node, *inputs()[0])
                    self.assertEqual(observed[0]["terminationSignal"], "SIGKILL")
                    self.assertEqual(observed[0]["stdout"], "")
                    if boundary == "after-commit":
                        self.assertGreater(observed[0]["scratchFilesBeforeRecovery"]["features.sqlite-wal"], 0)
                    final = admitted.lease.root/"features.sqlite"; inode = final.stat().st_ino
                    recovered = ingest_index(admitted, source, manifest, config, self.node, *inputs()[0])
                    self.assertEqual(recovered["ingest"]["result"]["replayed"], boundary != "before-transaction")
                    self.assertEqual(recovered["ingest"]["stats"]["captures"], 1)
                    self.assertEqual(recovered["ingest"]["stats"]["occurrences"], 473)
                    self.assertEqual(final.stat().st_ino, inode)
                    self.assertFalse((final.parent/"features.sqlite-wal").exists())
                self.assertEqual(registry.snapshot()["reservations"], 1)

    def test_bad_pin_refuses_before_binding_or_worker(self):
        with source_fixture() as (source, manifest, config), fixture() as (_, namespace, registry):
            ep, rp, expected = inputs()[0]; expected["extract"]["sha256"] = "0"*64
            with charged_index_root(namespace, registry, self.bound(manifest, config)) as admitted:
                with patch("index_ingest._run_fixed_process") as launch:
                    with self.assertRaisesRegex(ValueError, "retained pin"):
                        ingest_index(admitted, source, manifest, config, self.node, ep, rp, expected)
                    launch.assert_not_called()
                self.assertEqual([p.name for p in admitted.lease.root.iterdir()], ["writer.lock"])

    def test_source_request_mismatch_refuses_before_any_sql(self):
        with source_fixture() as (source, manifest, config), fixture() as (_, namespace, registry):
            ep, rp, expected = inputs()[0]; expected["requestHash"] = "0"*64
            with charged_index_root(namespace, registry, self.bound(manifest, config)) as admitted:
                with self.assertRaisesRegex(RuntimeError, "fixed ingestion worker failed"):
                    ingest_index(admitted, source, manifest, config, self.node, ep, rp, expected)
                self.assertFalse((admitted.lease.root/"features.sqlite").exists())
                self.assertFalse((admitted.lease.root/"bootstrap.sqlite").exists())

    def test_capture_layers_outside_admitted_index_refuse_before_sql(self):
        with source_fixture() as (source, manifest, config), fixture() as (_, namespace, registry):
            value = decode_index_binding(self.bound(manifest, config)); value["source"]["layers"] = ["buildings"]
            with charged_index_root(namespace, registry, encode_index_binding(value)) as admitted:
                with self.assertRaisesRegex(RuntimeError, "fixed ingestion worker failed"):
                    ingest_index(admitted, source, manifest, config, self.node, *inputs()[0])
                self.assertFalse((admitted.lease.root/"features.sqlite").exists())

    def test_quota_failure_preserves_previous_capture_and_reopens_for_exact_replay(self):
        with source_fixture() as (source, manifest, config), fixture() as (_, namespace, registry):
            value = decode_index_binding(self.bound(manifest, config)); value["engineLimits"]["occurrences"] = 1000
            with charged_index_root(namespace, registry, encode_index_binding(value)) as admitted:
                first = ingest_index(admitted, source, manifest, config, self.node, *inputs()[0])
                with self.assertRaisesRegex(RuntimeError, "fixed ingestion worker failed"):
                    ingest_index(admitted, source, manifest, config, self.node, *inputs()[1])
                replay = ingest_index(admitted, source, manifest, config, self.node, *inputs()[0])
                self.assertTrue(replay["ingest"]["result"]["replayed"])
                self.assertEqual(replay["ingest"]["stats"], first["ingest"]["stats"])
                self.assertEqual(replay["ingest"]["stats"]["captures"], 1)

    def test_reported_peak_above_cap_is_rejected_after_terminal_worker(self):
        with source_fixture() as (source, manifest, config), fixture() as (_, namespace, registry):
            with charged_index_root(namespace, registry, self.bound(manifest, config)) as admitted:
                def alter_report(*args, **kwargs):
                    result = _run_fixed_process(*args, **kwargs); report = json.loads(result["stdout"])
                    report["maximumRssKiB"] = kwargs["rss_limit_bytes"]//1024+1
                    result["stdout"] = json.dumps(report); return result
                with patch("index_ingest._run_fixed_process", side_effect=alter_report):
                    with self.assertRaisesRegex(ValueError, "peak RSS allowance"):
                        ingest_index(admitted, source, manifest, config, self.node, *inputs()[0])
                self.assertTrue((admitted.lease.root/"features.sqlite").exists())
                replay = ingest_index(admitted, source, manifest, config, self.node, *inputs()[0])
                self.assertTrue(replay["ingest"]["result"]["replayed"])

    def test_parent_verification_is_not_substituted_for_worker_rehash(self):
        with source_fixture() as (source, manifest, config), fixture() as (parent, namespace, registry):
            ep, rp, expected = inputs()[0]
            own_extract = parent/"fixture.geojson"; own_extract.write_bytes(ep.read_bytes()); own_extract.chmod(0o600)
            def change_then_run(*args, **kwargs):
                raw = own_extract.read_bytes(); own_extract.write_bytes(b"!"+raw[1:])
                return _run_fixed_process(*args, **kwargs)
            with charged_index_root(namespace, registry, self.bound(manifest, config)) as admitted:
                with patch("index_ingest._run_fixed_process", side_effect=change_then_run):
                    with self.assertRaisesRegex(RuntimeError, "fixed ingestion worker failed"):
                        ingest_index(admitted, source, manifest, config, self.node, own_extract, rp, expected)
                self.assertFalse((admitted.lease.root/"features.sqlite").exists())

    def test_duplicate_receipt_keys_are_rejected_before_sql(self):
        with source_fixture() as (source, manifest, config), fixture() as (parent, namespace, registry):
            ep, rp, expected = inputs()[0]
            receipt = parent/"receipt.json"; receipt.write_bytes(b'{"schemaVersion":1,'+rp.read_bytes()[1:]); receipt.chmod(0o600)
            expected["receipt"] = pin(receipt.read_bytes())
            with charged_index_root(namespace, registry, self.bound(manifest, config)) as admitted:
                with self.assertRaisesRegex(RuntimeError, "fixed ingestion worker failed"):
                    ingest_index(admitted, source, manifest, config, self.node, ep, receipt, expected)
                self.assertFalse((admitted.lease.root/"features.sqlite").exists())

    def test_inherited_descriptors_are_distinct_readonly_and_worker_scoped(self):
        with source_fixture() as (source, manifest, config), fixture() as (_, namespace, registry):
            with charged_index_root(namespace, registry, self.bound(manifest, config)) as admitted:
                with capture_descriptors(*inputs()[0]) as (capture, charged):
                    self.assertEqual(os.fstat(capture["metadataDescriptor"]).st_nlink, 0)
                    for role in ["metadataDescriptor", "extractDescriptor", "receiptDescriptor"]:
                        with self.assertRaises(OSError): os.write(capture[role], b"x")
                    for worker, bad in [("index-engine-bootstrap", capture), ("index-capture-ingest", {**capture,
                            "receiptDescriptor": capture["extractDescriptor"]})]:
                        with patch("index_resource_limits.subprocess.Popen") as launch:
                            with self.assertRaises(ValueError):
                                _run_fixed_process(self.node, worker, admitted.lease.root, execution_root=source,
                                    lease_descriptor=admitted.lease.descriptor,
                                    namespace_descriptor=admitted.namespace_lease.descriptor, capture_configuration=bad)
                            launch.assert_not_called()

    def test_unconfirmed_exit_retains_only_owned_execution_and_actual_input_handles(self):
        with source_fixture() as (source, manifest, config), fixture() as (_, namespace, registry):
            with charged_index_root(namespace, registry, self.bound(manifest, config)) as admitted:
                def unconfirmed(node, worker, root, **kwargs):
                    raise IndexWorkerUnreaped(type("OwnedHandle", (), {"pid": 999})(), root, kwargs["execution_root"], "fixture-unconfirmed")
                with patch("index_ingest._run_fixed_process", side_effect=unconfirmed):
                    with self.assertRaises(IndexWorkerUnreaped) as raised:
                        ingest_index(admitted, source, manifest, config, self.node, *inputs()[0])
                error = raised.exception
                try:
                    self.assertTrue(error.retained_snapshot.exists())
                    self.assertEqual(len(error.retained_capture_descriptors), 3)
                    for descriptor in error.retained_capture_descriptors: os.fstat(descriptor)
                finally:
                    # No worker was launched by this explicit lifecycle fixture.
                    for descriptor in error.retained_capture_descriptors: os.close(descriptor)
                    shutil.rmtree(error.retained_snapshot)


if __name__ == "__main__": unittest.main()
