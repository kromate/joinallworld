import json
import hashlib
import sqlite3
import sys
import tempfile
import os
import unittest
from pathlib import Path

import verify_grid_query_campaign as audit
import test_verify_country_grid as grid_fixture


def build_capture_fixture(parent: Path, campaign_id: str = "synthetic-capture", network_bytes: int = 10) -> tuple[Path, str]:
    root = (parent / "world-build").resolve()
    root.mkdir(parents=True)
    rel, plan_hash, plan = grid_fixture.build_fixture(root)
    campaign_dir = root / "campaigns" / campaign_id
    campaign_dir.mkdir(parents=True)
    cell = plan["cells"][0]
    root_id = cell["id"]
    country = plan["country"]
    release = "2026-09-23.1"
    request = {"schemaVersion": 1, "id": f"grid-query:{root_id}", "inventoryUnitId": country["id"],
               "provider": "overture", "release": release, "layers": ["buildings"],
               "region": {"id": root_id, "name": f"{country['name']} source query cell {root_id}", "bounds": cell["bounds"]},
               "limits": {"networkBytes": 1000, "outputBytes": 1000, "features": 20, "durationMs": 10000, "memoryMb": 256, "diskBytes": 100000}}
    unit = {"id": f"grid-query:{root_id}", "inventoryUnitId": country["id"], "priority": 0, "kind": "grid-query",
            "query": {"rootCellId": root_id, "path": ""}, "request": request}
    campaign = {"schemaVersion": 2, "id": campaign_id, "inventoryHash": plan["request"]["directoryManifestHash"],
                "inventoryKind": "country-directory", "gridQuery": {"schemaVersion": 1, "planHash": plan_hash, "maxDepth": 2, "maxJobs": 5},
                "units": [unit], "limits": {"durationMs": 20000, "jobDurationMs": 10000, "networkBytes": 5000,
                "inputBytes": 100000, "outputBytes": 100000, "diskBytes": 1000000, "memoryMb": 256, "maxAttempts": 1}}
    config_text = audit.canonical(campaign)
    (campaign_dir / "campaign.json").write_text(config_text)
    binding = {"path": str(root / rel), "hash": plan_hash, "cacheRoot": str(root)}
    (campaign_dir / "grid-query-binding.json").write_text(audit.canonical(binding))
    campaign_hash = audit.digest(campaign)
    job_id = f"{campaign_id}:{unit['id']}"
    payload = {"campaignId": campaign_id, "campaignHash": campaign_hash, "inventoryHash": campaign["inventoryHash"], "unit": unit}
    input_hash = audit.digest({"campaignHash": campaign_hash, "inventoryHash": campaign["inventoryHash"], "unit": unit})
    ledger = sqlite3.connect(campaign_dir / "ledger.sqlite")
    ledger.execute("CREATE TABLE jobs (id TEXT PRIMARY KEY,kind TEXT,input_hash TEXT,payload TEXT,max_attempts INTEGER,attempt INTEGER,priority INTEGER,status TEXT,lease_until REAL,result TEXT,error TEXT)")
    source_config = audit.parse(audit.read_bounded(audit.REPO / "world" / "acquisition-sources.json", 64000, "source config"), "source config")
    request_hash = audit.expected_request_hash(unit, source_config)
    selection = {key: value for key, value in request.items() if key != "limits"}
    geo_bytes = b'{"features":[],"type":"FeatureCollection"}\n'
    input_sha = audit.sha(geo_bytes)
    cache_dir = root / "acquisitions" / request_hash
    cache_dir.mkdir(parents=True)
    input_path = cache_dir / "extract.geojson"
    input_path.write_bytes(geo_bytes)
    source = {"id": f"overture-{release}-buildings", "url": source_config["stac"]["collections"]["buildings"]["url"],
              "release": release, "license": source_config["licenses"]["buildings"], "attribution": source_config["attribution"]["buildings"],
              "sha256": "a" * 64, "bytes": 1}
    receipt_metrics = {"networkBytes": network_bytes, "outputBytes": len(geo_bytes), "features": 0, "elapsedMs": 12}
    upstream = ([{"url": f"https://stac.overturemaps.org/{release}/buildings/building/collection.json", "etag": None, "bytes": network_bytes}] if network_bytes else [])
    receipt = {"schemaVersion": 1, "requestHash": request_hash, "selection": selection, "request": request,
               "completedAt": "2026-10-08T00:00:00.000Z", "inputSha256": input_sha, "inputBytes": len(geo_bytes),
               "metrics": receipt_metrics, "upstream": upstream, "sources": [source], "exceptions": []}
    receipt_bytes = (audit.canonical(receipt) + "\n").encode()
    receipt_path = cache_dir / "receipt.json"
    receipt_path.write_bytes(receipt_bytes)
    plan_result = {"region": request["region"], "source": {"sha256": input_sha, "bytes": len(geo_bytes), "release": release},
                   "input": {"path": str(input_path), "sha256": input_sha, "bytes": len(geo_bytes)}}
    result = {"status": "query-captured", "features": 0, "requestHash": request_hash, "inputSha256": input_sha,
              "inputBytes": len(geo_bytes), "receiptSha256": audit.sha(receipt_bytes), "receiptBytes": len(receipt_bytes),
              "plan": plan_result, "receiptPath": str(receipt_path), "metrics": receipt_metrics, "upstream": upstream, "exceptions": []}
    ledger.execute("INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?,?)", (job_id, "campaign-grid-query", input_hash, audit.canonical(payload), 1, 1, 0, "completed", None, audit.canonical(result), None))
    ledger.commit(); ledger.close()
    key = audit.expected_usage_source_key(campaign["inventoryHash"], unit)
    rows = [{"key": "attempt:synthetic", "sequence": 1, "sourceKey": key, "phase": "reserved", "networkBytes": 1000, "inputBytes": 100000, "outputBytes": 1000, "diskBytes": 100000},
            {"key": "attempt:synthetic", "sequence": 2, "sourceKey": key, "inputPinKey": f"{input_sha}:{len(geo_bytes)}", "phase": "settled", "networkBytes": network_bytes,
             "inputBytes": len(geo_bytes), "outputBytes": len(geo_bytes), "diskBytes": 1, "requestHash": request_hash, "receiptPath": str(receipt_path)}]
    (campaign_dir / "usage.jsonl").write_text("".join(audit.canonical(row) + "\n" for row in rows))
    attempt_dir = root / "acquisition-attempts" / request_hash
    attempt_dir.mkdir(parents=True)
    caps = {"networkBytes": 1000, "diskBytes": 100000, "durationMs": 10000}
    start = {"schemaVersion": 1, "requestHash": request_hash, "attempt": 1, "event": "started", "status": "pending",
             "startedAt": "2026-10-08T00:00:00.000Z", "selection": selection, "caps": caps, "networkBytesMeasured": None,
             "networkReservationUpperBoundBytes": 1000}
    finish = {"schemaVersion": 1, "requestHash": request_hash, "attempt": 1, "event": "finished", "status": "success",
              "startedAt": start["startedAt"], "endedAt": "2026-10-08T00:00:01.000Z", "selection": selection,
              "caps": caps, "networkBytesMeasured": network_bytes, "networkReservationUpperBoundBytes": 1000,
              "metrics": receipt_metrics, "receiptPath": str(receipt_path)}
    (attempt_dir / "attempts.jsonl").write_text(audit.canonical(start) + "\n" + audit.canonical(finish) + "\n")
    return root, campaign_id


def turn_capture_into_split(root: Path, campaign_id: str) -> str:
    campaign_dir = root / "campaigns" / campaign_id
    campaign = audit.parse_canonical((campaign_dir / "campaign.json").read_bytes(), "campaign")
    unit = campaign["units"][0]
    plan = audit.parse_canonical(Path((campaign_dir / "grid-query-binding.json").read_text().split('"path":"', 1)[1].split('"', 1)[0]).read_bytes(), "plan", newline=True)
    root_id = unit["query"]["rootCellId"]
    campaign_hash = audit.digest(campaign)
    children = [{"rootCellId": root_id, "path": digit} for digit in "0123"]
    parent_id = f"{campaign_id}:{unit['id']}"
    db = sqlite3.connect(campaign_dir / "ledger.sqlite")
    db.execute("UPDATE jobs SET result=? WHERE id=?", (audit.canonical({"status": "query-subdivided", "reason": "feature-row-budget", "children": children}), parent_id))
    templates = {root_id: unit}
    cells_by_id = {cell["id"]: cell for cell in plan["cells"]}
    for address in children:
        child = audit.unit_for(address, templates, plan, campaign["gridQuery"]["maxDepth"], cells_by_id)
        child_id = f"{campaign_id}:{child['id']}"
        payload = {"campaignId": campaign_id, "campaignHash": campaign_hash, "inventoryHash": campaign["inventoryHash"], "unit": child}
        input_hash = audit.digest({"campaignHash": campaign_hash, "inventoryHash": campaign["inventoryHash"], "unit": child})
        db.execute("INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?,?)", (child_id, "campaign-grid-query", input_hash, audit.canonical(payload), 1, 0, 0, "queued", None, None, None))
    db.commit(); db.close()
    selection = {key: value for key, value in unit["request"].items() if key != "limits"}
    request_hash = audit.expected_request_hash(unit, audit.parse(audit.read_bounded(audit.REPO / "world" / "acquisition-sources.json", 64000, "source config"), "source config"))
    caps = {"networkBytes": 1000, "diskBytes": 100000, "durationMs": 10000}
    start = {"schemaVersion": 1, "requestHash": request_hash, "attempt": 1, "event": "started", "status": "pending",
             "startedAt": "2026-10-08T00:00:00.000Z", "selection": selection, "caps": caps, "networkBytesMeasured": None, "networkReservationUpperBoundBytes": 1000}
    finish = {"schemaVersion": 1, "requestHash": request_hash, "attempt": 1, "event": "finished", "status": "failure",
              "startedAt": start["startedAt"], "endedAt": "2026-10-08T00:00:01.000Z", "selection": selection, "caps": caps,
              "networkBytesMeasured": 17, "networkReservationUpperBoundBytes": 1000, "reason": "Synthetic feature row cap", "failureKind": "feature-row-budget"}
    attempt_path = root / "acquisition-attempts" / request_hash / "attempts.jsonl"
    attempt_path.write_text(audit.canonical(start) + "\n" + audit.canonical(finish) + "\n")
    usage_key = audit.expected_usage_source_key(campaign["inventoryHash"], unit)
    usage = [{"key": "attempt:synthetic", "sequence": 1, "sourceKey": usage_key, "phase": "reserved", "networkBytes": 1000, "inputBytes": 100000, "outputBytes": 1000, "diskBytes": 100000},
             {"key": "attempt:synthetic", "sequence": 2, "sourceKey": usage_key, "phase": "settled", "networkBytes": 17, "inputBytes": 0, "outputBytes": 0, "diskBytes": 1}]
    (campaign_dir / "usage.jsonl").write_text("".join(audit.canonical(row) + "\n" for row in usage))
    import shutil
    shutil.rmtree(root / "acquisitions" / request_hash)
    return root_id


class GridQueryAuditTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=os.path.realpath(tempfile.gettempdir()))
        self.root = Path(self.tmp.name)
        self.request = {
            "id": "grid-query:cell-a", "provider": "overture", "release": "2026-09-23.1",
            "layers": ["buildings"], "region": {"id": "cell-a", "name": "Example source query cell cell-a", "bounds": [-1, -1, 0, 0]},
            "limits": {"networkBytes": 1000, "outputBytes": 1000, "features": 20, "durationMs": 1000, "diskBytes": 1000},
        }
        self.unit = {"request": self.request}
        self.request_hash = "a" * 64
        self.selection = {key: value for key, value in self.request.items() if key != "limits"}
        self.caps = {"networkBytes": 1000, "diskBytes": 1000, "durationMs": 1000}

    def tearDown(self):
        self.tmp.cleanup()

    def journal(self, records):
        folder = self.root / "acquisition-attempts" / self.request_hash
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "attempts.jsonl").write_text("".join(json.dumps(row, separators=(",", ":")) + "\n" for row in records))

    def base_attempt(self, event, status, **more):
        return {"schemaVersion": 1, "requestHash": self.request_hash, "attempt": 1, "event": event,
                "status": status, "startedAt": "2026-10-08T00:00:00.000Z", "selection": self.selection,
                "caps": self.caps, **more}

    def test_full_synthetic_capture_audit_and_rehashed_bounds_tamper(self):
        root, campaign_id = build_capture_fixture(self.root)
        receipt = audit.audit_campaign(str(root), campaign_id)
        self.assertTrue(receipt["verified"])
        self.assertEqual(receipt["coverage"]["roots"], {"requested": 1, "captured": 1, "exception": 0, "pending": 0})
        self.assertEqual(receipt["coverage"]["jobs"]["zeroFeatureQueries"], 1)
        campaign_dir = root / "campaigns" / campaign_id
        db = sqlite3.connect(campaign_dir / "ledger.sqlite")
        row = db.execute("SELECT result FROM jobs").fetchone()
        result = json.loads(row[0]); result["plan"]["region"]["bounds"][0] -= 1
        db.execute("UPDATE jobs SET result=?", (audit.canonical(result),)); db.commit(); db.close()
        with self.assertRaises(audit.AuditError):
            audit.audit_campaign(str(root), campaign_id)

    def test_full_split_graph_requires_all_four_children_and_reports_root_pending(self):
        root, campaign_id = build_capture_fixture(self.root, "synthetic-split")
        turn_capture_into_split(root, campaign_id)
        campaign_dir = root / "campaigns" / campaign_id
        campaign = audit.parse_canonical((campaign_dir / "campaign.json").read_bytes(), "campaign")
        unit = campaign["units"][0]
        request_hash = audit.expected_request_hash(unit, audit.parse(audit.read_bounded(audit.REPO / "world" / "acquisition-sources.json", 64000, "source config"), "source config"))
        attempt_path = root / "acquisition-attempts" / request_hash / "attempts.jsonl"
        records = [json.loads(line) for line in attempt_path.read_text().splitlines()]
        selection = {key: value for key, value in unit["request"].items() if key != "limits"}
        caps = {"networkBytes": 1000, "diskBytes": 100000, "durationMs": 10000}
        second_start = {"schemaVersion": 1, "requestHash": request_hash, "attempt": 2, "event": "started", "status": "pending", "startedAt": "2026-10-08T00:00:02.000Z", "selection": selection, "caps": caps, "networkBytesMeasured": None, "networkReservationUpperBoundBytes": 1000}
        second_finish = {"schemaVersion": 1, "requestHash": request_hash, "attempt": 2, "event": "finished", "status": "cache-hit", "startedAt": second_start["startedAt"], "endedAt": "2026-10-08T00:00:03.000Z", "selection": selection, "caps": caps, "networkBytesMeasured": 0, "networkReservationUpperBoundBytes": 0, "metrics": {"networkBytes": 0, "outputBytes": 40, "features": 1, "elapsedMs": 2}, "receiptPath": str(root / "acquisitions" / request_hash / "receipt.json")}
        attempt_path.write_text("".join(audit.canonical(row) + "\n" for row in [*records, second_start, second_finish]))
        cache_dir = root / "acquisitions" / request_hash
        cache_dir.mkdir(parents=True, exist_ok=True)
        (cache_dir / "extract.geojson").write_text("later shared cache publication")
        (cache_dir / "receipt.json").write_text("later shared cache publication")
        report = audit.audit_campaign(str(root), campaign_id)
        self.assertEqual(report["coverage"]["jobs"]["subdivided"], 1)
        self.assertEqual(report["coverage"]["roots"]["pending"], 1)
        self.assertEqual(report["coverage"]["jobs"]["queued"], 4)
        ledger = sqlite3.connect(root / "campaigns" / campaign_id / "ledger.sqlite")
        ledger.execute("DELETE FROM jobs WHERE id LIKE ?", (f"{campaign_id}:grid-query:%q3",))
        ledger.commit(); ledger.close()
        with self.assertRaisesRegex(audit.AuditError, "missing one or more.*children"):
            audit.audit_campaign(str(root), campaign_id)

    def test_capture_fails_if_receipt_is_corrupted_after_its_hash_is_recorded(self):
        root, campaign_id = build_capture_fixture(self.root, "corrupt-receipt")
        campaign_dir = root / "campaigns" / campaign_id
        db = sqlite3.connect(campaign_dir / "ledger.sqlite")
        result = json.loads(db.execute("SELECT result FROM jobs").fetchone()[0])
        db.close()
        Path(result["receiptPath"]).write_bytes(b"{}\n")
        with self.assertRaisesRegex(audit.AuditError, "receipt bytes/hash"):
            audit.audit_campaign(str(root), campaign_id)

    def test_typed_budget_failure_must_have_matching_measured_terminal_and_keeps_reservation(self):
        started = self.base_attempt("started", "pending", networkBytesMeasured=None, networkReservationUpperBoundBytes=1000)
        finished = self.base_attempt("finished", "failure", endedAt="2026-10-08T00:00:01.000Z", networkBytesMeasured=17,
                                     networkReservationUpperBoundBytes=1000, reason="too many rows", failureKind="feature-row-budget")
        self.journal([started, finished])
        result = audit.verify_attempt(self.root, self.request_hash, self.unit, "typed-failure", "feature-row-budget")
        self.assertEqual(result["networkBytesMeasured"], 17)
        with self.assertRaises(audit.AuditError):
            audit.verify_attempt(self.root, self.request_hash, self.unit, "typed-failure", "geojson-output-bytes")

    def test_typed_failure_without_start_or_with_underreserved_start_is_rejected(self):
        finished = self.base_attempt("finished", "failure", endedAt="2026-10-08T00:00:01.000Z", networkBytesMeasured=17,
                                     networkReservationUpperBoundBytes=1000, reason="too many rows", failureKind="feature-row-budget")
        self.journal([finished])
        with self.assertRaises(audit.AuditError):
            audit.verify_attempt(self.root, self.request_hash, self.unit, "typed-failure", "feature-row-budget")
        started = self.base_attempt("started", "pending", networkBytesMeasured=None, networkReservationUpperBoundBytes=999)
        self.journal([started, finished])
        with self.assertRaises(audit.AuditError):
            audit.verify_attempt(self.root, self.request_hash, self.unit, "typed-failure", "feature-row-budget")

    def test_interrupted_historical_start_is_retained_and_later_attempt_can_complete(self):
        first = self.base_attempt("started", "pending", networkBytesMeasured=None, networkReservationUpperBoundBytes=1000)
        second = {**first, "attempt": 2, "startedAt": "2026-10-08T00:00:02.000Z"}
        finish = self.base_attempt("finished", "failure", attempt=2, endedAt="2026-10-08T00:00:03.000Z",
                                   startedAt=second["startedAt"], networkBytesMeasured=17, networkReservationUpperBoundBytes=1000,
                                   reason="budget", failureKind="feature-row-budget")
        self.journal([first, second, finish])
        record = audit.verify_attempt(self.root, self.request_hash, self.unit, None)
        self.assertEqual(record["attempts"], 2)
        self.assertEqual(record["pendingStarts"], 1)
        self.assertEqual(record["lastStatus"], "failure")

    def test_zero_network_success_is_not_misclassified_as_cache_hit(self):
        root, campaign_id = build_capture_fixture(self.root, "zero-network-success", network_bytes=0)
        report = audit.audit_campaign(str(root), campaign_id)
        self.assertTrue(report["verified"])
        self.assertEqual(report["budgetCharges"]["networkBytesCharged"], 0)
        self.assertEqual(report["budgetCharges"]["outputBytesCharged"], len(b'{"features":[],"type":"FeatureCollection"}\n'))

    def test_cache_hit_terminal_requires_zero_new_network_and_exact_record_envelope(self):
        started = self.base_attempt("started", "pending", networkBytesMeasured=None, networkReservationUpperBoundBytes=1000)
        metrics = {"networkBytes": 0, "outputBytes": 14, "features": 0, "elapsedMs": 1}
        finished = self.base_attempt("finished", "cache-hit", endedAt="2026-10-08T00:00:01.000Z", networkBytesMeasured=0,
                                     networkReservationUpperBoundBytes=0, metrics=metrics, receiptPath=str(self.root / "acquisitions" / self.request_hash / "receipt.json"))
        self.journal([started, finished])
        self.assertEqual(audit.verify_attempt(self.root, self.request_hash, self.unit, "cache-hit")["lastStatus"], "cache-hit")
        finished["metrics"]["networkBytes"] = 5
        self.journal([started, finished])
        with self.assertRaises(audit.AuditError):
            audit.verify_attempt(self.root, self.request_hash, self.unit, "cache-hit")

    def test_usage_attempt_requires_reserved_then_single_settled_record(self):
        source_key = "b" * 64
        unit = {"request": self.request}
        directory = self.root / "campaigns" / "test"
        directory.mkdir(parents=True)
        campaign = {"limits": {"networkBytes": 1000, "inputBytes": 1000, "outputBytes": 1000, "diskBytes": 1000}}
        sources = {source_key: unit}
        rows = [
            {"key": "attempt:1", "sequence": 1, "sourceKey": source_key, "phase": "reserved", "networkBytes": 1000, "inputBytes": 0, "outputBytes": 0, "diskBytes": 0},
            {"key": "attempt:1", "sequence": 2, "sourceKey": source_key, "phase": "settled", "networkBytes": 17, "inputBytes": 0, "outputBytes": 0, "diskBytes": 10},
        ]
        (directory / "usage.jsonl").write_text("".join(json.dumps(row, separators=(",", ":")) + "\n" for row in rows))
        totals, latest = audit.audit_usage(directory, campaign, sources, [], [])
        self.assertEqual(totals["networkBytesCharged"], 17)
        self.assertEqual(latest["attempt:1"]["phase"], "settled")
        rows.append({**rows[-1], "sequence": 3})
        (directory / "usage.jsonl").write_text("".join(json.dumps(row, separators=(",", ":")) + "\n" for row in rows))
        with self.assertRaises(audit.AuditError):
            audit.audit_usage(directory, campaign, sources, [], [])

    def test_quadrant_requests_derive_exact_child_bounds_without_mutating_frozen_root(self):
        root_cell = {"id": "root-a", "bounds": [-4.0, -2.0, 4.0, 2.0]}
        plan = {"cells": [root_cell], "country": {"id": "country:synthetic:1", "name": "Synthetic"}}
        template = {"priority": 7, "request": self.request}
        templates = {"root-a": template}
        before = json.dumps(plan, sort_keys=True), json.dumps(template, sort_keys=True)
        expected = {"0": [-4.0, -2.0, 0.0, 0.0], "1": [0.0, -2.0, 4.0, 0.0],
                    "2": [-4.0, 0.0, 0.0, 2.0], "3": [0.0, 0.0, 4.0, 2.0]}
        for digit, bounds in expected.items():
            unit = audit.unit_for({"rootCellId": "root-a", "path": digit}, templates, plan, 4, {"root-a": root_cell})
            self.assertEqual(unit["request"]["region"]["bounds"], bounds)
            self.assertEqual(unit["id"], f"grid-query:root-a:q{digit}")
        self.assertEqual((json.dumps(plan, sort_keys=True), json.dumps(template, sort_keys=True)), before)

    def test_canonical_source_key_matches_ecmascript_order_and_undefined_field(self):
        value = {"z": 1, "limits": audit.UNDEFINED, "a": {"x": True}}
        self.assertEqual(audit.canonical(value), '{"a":{"x":true},"limits":undefined,"z":1}')
        self.assertEqual(len(audit.expected_usage_source_key("c" * 64, self.unit)), 64)

    def test_attempt_journal_rejects_unpaired_attempts(self):
        first = self.base_attempt("started", "pending", networkBytesMeasured=None, networkReservationUpperBoundBytes=1000)
        second = {**first, "attempt": 2}
        self.journal([first, second])
        result = audit.verify_attempt(self.root, self.request_hash, self.unit, None)
        self.assertEqual(result["pendingStarts"], 2)

    def test_immutable_sqlite_audit_refuses_nonempty_wal_and_live_runner_lock(self):
        campaign_dir = self.root / "campaigns" / "live-test"
        campaign_dir.mkdir(parents=True)
        db = campaign_dir / "ledger.sqlite"
        sqlite3.connect(db).close()
        (campaign_dir / ".campaign-runner.lock").write_text(f"{os.getpid()}:held\n")
        with self.assertRaisesRegex(audit.AuditError, "runner is active"):
            audit.sqlite_jobs(db)
        (campaign_dir / ".campaign-runner.lock").unlink()
        Path(str(db) + "-wal").write_bytes(b"uncheckpointed")
        with self.assertRaisesRegex(audit.AuditError, "nonempty WAL"):
            audit.sqlite_jobs(db)

    def test_usage_does_not_accept_settlement_without_reservation(self):
        source_key = "b" * 64
        directory = self.root / "campaigns" / "test"
        directory.mkdir(parents=True)
        campaign = {"limits": {"networkBytes": 1000, "inputBytes": 1000, "outputBytes": 1000, "diskBytes": 1000}}
        row = {"key": "attempt:1", "sequence": 1, "sourceKey": source_key, "phase": "settled", "networkBytes": 17, "inputBytes": 0, "outputBytes": 0, "diskBytes": 0}
        (directory / "usage.jsonl").write_text(json.dumps(row) + "\n")
        with self.assertRaises(audit.AuditError):
            audit.audit_usage(directory, campaign, {source_key: {"request": self.request}}, [], [])


if __name__ == "__main__":
    unittest.main()
