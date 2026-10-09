"""Pure startup-worker checks using only disposable private namespace roots."""
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import resource
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import hashlib

from index_binding import VERSIONS, encode_index_binding, decode_index_shard_binding

import index_registry_worker as worker
from index_reservations import DATABASE_BYTES, REGISTRY_ALLOWANCE
from index_writer_lock import index_writer_lease

MIB = 1024 * 1024
BUDGET = REGISTRY_ALLOWANCE + 2 * MIB


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(",", ":")).encode("ascii")


def base_binding(*, reserved=32*MIB, file_bytes=4*MIB, config_hash="c"*64, tools_hash="d"*64):
    value = {**VERSIONS,
        "source": {"provider": "overture", "release": "2026-01-21.0", "layers": ["buildings"],
                   "configuration": {"sha256": config_hash, "bytes": 100}},
        "toolingManifest": {"sha256": tools_hash, "bytes": 200},
        "runtime": {"nodeVersion": "v22.19.0", "sqliteVersion": "3.50.4", "nodeSha256": "e"*64, "nodeBytes": 1000},
        "engineLimits": {"databaseBytes": 4*MIB, "captures": 8, "occurrences": 4000, "versions": 3000, "observations": 16},
        "processLimits": {"fileBytes": file_bytes, "cpuSeconds": 10, "wallSeconds": 15, "heapMiB": 256, "rssBytes": 96*MIB},
        "reservedBytes": reserved}
    return encode_index_binding(value)


def planner_fixture(base=None, policy_changes=None, requests=None):
    base = base or base_binding()
    from index_binding import decode_index_binding
    base_value = decode_index_binding(base)
    bindings = {"campaignHash": "a"*64, "countryGridPlanHash": "b"*64,
        "sourceConfigurationHash": base_value["source"]["configuration"]["sha256"],
        "toolingManifestHash": base_value["toolingManifest"]["sha256"],
        "baseIndexBindingHash": hashlib.sha256(base).hexdigest()}
    policy = {"aggregateBytes": 64*MIB, "registryControlBytes": MIB, "shardReservedBytes": base_value["reservedBytes"],
        "maxCaptures": 2, "descriptorBytes": 1000, "envelopeOverheadBytes": 100, "maxShards": 16, "maxAttempts": 4}
    policy.update(policy_changes or {})
    requests = requests or [
        {"requestHash": "1"*64, "captureInputHash": "2"*64, "requiredObservationSetHash": "3"*64,
         "requiredObservationCount": 2, "auditDescriptorBytes": 100},
        {"requestHash": "4"*64, "captureInputHash": "5"*64, "requiredObservationSetHash": "6"*64,
         "requiredObservationCount": 1, "auditDescriptorBytes": 200},
    ]
    requests = sorted(requests, key=lambda request: request["requestHash"])
    membership = hashlib.sha256(canonical(requests)).hexdigest()
    groups, group, used = [], [], 0
    for request in requests:
        if group and (len(group) >= policy["maxCaptures"] or used+request["auditDescriptorBytes"] > policy["descriptorBytes"]):
            groups.append(group); group, used = [], 0
        group.append(request); used += request["auditDescriptorBytes"]
    if group: groups.append(group)
    shards=[]
    for ordinal, members in enumerate(groups):
        hashes = [request["requestHash"] for request in members]
        identity = {"format": "feature-index-shard-id-v1", "bindings": bindings,
            "membershipSha256": membership, "ordinal": ordinal, "requestHashes": hashes}
        shard_id = f"shard-{ordinal:03d}-{hashlib.sha256(canonical(identity)).hexdigest()}"
        descriptor = sum(request["auditDescriptorBytes"] for request in members)
        observations = sum(request["requiredObservationCount"] for request in members)
        shards.append({"id": shard_id, "ordinal": ordinal, "requestHashes": hashes, "requestCount": len(members),
            "descriptorBytes": descriptor, "envelopeBytes": descriptor+policy["envelopeOverheadBytes"],
            "requiredObservationCount": observations, "reservedBytes": policy["shardReservedBytes"]})
    descriptor = sum(request["auditDescriptorBytes"] for request in requests)
    plan = {"format": "feature-index-shard-plan-v1", "inputFormat": "feature-index-shard-plan-input-v1",
        "scope": "namespace-batch", "admission": "not-admitted", "geometryCoverage": "not-compiled", "occupancy": "not-checked",
        "fixedRegistryAllowanceBytes": REGISTRY_ALLOWANCE, "bindings": bindings, "policy": policy,
        "requestCount": len(requests), "requiredObservationCount": sum(r["requiredObservationCount"] for r in requests), "descriptorBytes": descriptor,
        "membershipSha256": membership, "requests": requests, "shards": shards,
        "namespaceChargeBytes": REGISTRY_ALLOWANCE+policy["registryControlBytes"]+len(groups)*policy["shardReservedBytes"]}
    raw = canonical(plan)
    return raw, {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}, base, plan


class IndexRegistryWorkerTests(unittest.TestCase):
    def test_shard_plan_recomputation_derives_sorted_v2_reservations(self):
        raw, pin, base, plan = planner_fixture()
        result = worker.validate_shard_plan(raw, pin, base)
        self.assertEqual(result["plan"], plan)
        self.assertEqual(len(result["reservations"]), 1)
        entry = result["reservations"][0]
        decoded = decode_index_shard_binding(entry["bindingBytes"])
        self.assertEqual(entry["indexHash"], hashlib.sha256(entry["bindingBytes"]).hexdigest())
        self.assertEqual(entry["reservedBytes"], plan["policy"]["shardReservedBytes"])
        self.assertEqual(decoded["shard"]["planHash"], pin["sha256"])
        self.assertEqual(decoded["shard"]["baseIndexBindingHash"], plan["bindings"]["baseIndexBindingHash"])
        self.assertEqual(decoded["shard"]["shardId"], hashlib.sha256(plan["shards"][0]["id"].encode("ascii")).hexdigest())
        self.assertEqual(decoded["shard"]["membershipHash"], hashlib.sha256(canonical(plan["shards"][0]["requestHashes"])).hexdigest())

    def test_shard_plan_refuses_altered_pin_totals_ids_fields_duplicates_and_noncanonical_bytes(self):
        raw, pin, base, plan = planner_fixture()
        with self.assertRaisesRegex(ValueError, "plan pin"):
            worker.validate_shard_plan(raw, {"sha256": "f"*64, "bytes": len(raw)}, base)
        with self.assertRaisesRegex(ValueError, "plan pin"):
            worker.validate_shard_plan(raw, {"sha256": pin["sha256"], "bytes": len(raw)+1}, base)
        for field, value in [("requestCount", 9), ("namespaceChargeBytes", 1)]:
            changed = dict(plan); changed[field] = value
            bad = canonical(changed); badpin = {"sha256": hashlib.sha256(bad).hexdigest(), "bytes": len(bad)}
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "recomputation"):
                worker.validate_shard_plan(bad, badpin, base)
        changed = json.loads(raw); changed["shards"][0]["id"] = "shard-000-"+"f"*64
        bad = canonical(changed); badpin = {"sha256": hashlib.sha256(bad).hexdigest(), "bytes": len(bad)}
        with self.assertRaisesRegex(ValueError, "recomputation"):
            worker.validate_shard_plan(bad, badpin, base)
        extra = dict(plan, unknown=True); bad = canonical(extra)
        with self.assertRaisesRegex(ValueError, "fields"):
            worker.validate_shard_plan(bad, {"sha256": hashlib.sha256(bad).hexdigest(), "bytes": len(bad)}, base)
        duplicate = raw.replace(b'"admission":"not-admitted"', b'"admission":"not-admitted","admission":"not-admitted"', 1)
        with self.assertRaises(ValueError):
            worker.validate_shard_plan(duplicate, {"sha256": hashlib.sha256(duplicate).hexdigest(), "bytes": len(duplicate)}, base)
        with self.assertRaisesRegex(ValueError, "canonical"):
            worker.validate_shard_plan(raw+b"\n", {"sha256": hashlib.sha256(raw+b"\n").hexdigest(), "bytes": len(raw)+1}, base)

    def test_shard_plan_binds_base_configuration_tooling_and_reservation_policy(self):
        raw, pin, base, _ = planner_fixture()
        for other in [base_binding(config_hash="f"*64), base_binding(tools_hash="f"*64)]:
            with self.subTest(base=other), self.assertRaisesRegex(ValueError, "base pins"):
                worker.validate_shard_plan(raw, pin, other)
        changed = json.loads(raw); changed["policy"]["shardReservedBytes"] -= 1
        bad = canonical(changed)
        with self.assertRaisesRegex(ValueError, "plan policy"):
            worker.validate_shard_plan(bad, {"sha256": hashlib.sha256(bad).hexdigest(), "bytes": len(bad)}, base)
        small = base_binding(reserved=16*MIB)
        small_raw, small_pin, _, _ = planner_fixture(small)
        with self.assertRaisesRegex(ValueError, "physical reservation"):
            worker.validate_shard_plan(small_raw, small_pin, small)

    def test_shard_plan_aggregate_and_descriptor_boundaries_fail_closed(self):
        base = base_binding()
        raw, pin, _, _ = planner_fixture(base, {"aggregateBytes": 50*MIB-1})
        with self.assertRaisesRegex(ValueError, "aggregate quota"):
            worker.validate_shard_plan(raw, pin, base)
        raw, pin, _, _ = planner_fixture(base, {"maxShards": 1, "maxCaptures": 1})
        with self.assertRaisesRegex(ValueError, "shard count"):
            worker.validate_shard_plan(raw, pin, base)
        # Keep the original partition while forging a smaller descriptor policy.
        # A freshly recomputed two-shard plan would be valid under this policy.
        _, _, _, changed = planner_fixture(base)
        changed["policy"].update({"descriptorBytes": 250, "aggregateBytes": 128*MIB})
        raw = canonical(changed)
        pin = {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}
        with self.assertRaisesRegex(ValueError, "recomputation"):
            worker.validate_shard_plan(raw, pin, base)
        raw, pin, base, plan = planner_fixture()
        empty = dict(plan, requests=[]); empty_raw = canonical(empty)
        with self.assertRaisesRegex(ValueError, "request count"):
            worker.validate_shard_plan(empty_raw, {"sha256": hashlib.sha256(empty_raw).hexdigest(), "bytes": len(empty_raw)}, base)
        too_many = dict(plan, requests=plan["requests"]*2049 + plan["requests"][:1])
        many_raw = canonical(too_many)
        with self.assertRaisesRegex(ValueError, "request count"):
            worker.validate_shard_plan(many_raw, {"sha256": hashlib.sha256(many_raw).hexdigest(), "bytes": len(many_raw)}, base)
        for malformed in [bytearray(b"{}"), b"x"*(2*MIB+1)]:
            with self.assertRaises(ValueError):
                worker.validate_shard_plan(malformed, {"sha256": "a"*64, "bytes": len(malformed)}, base)

    def test_shard_plan_request_and_shard_ceiling_boundaries(self):
        base = base_binding(reserved=24*MIB)
        requests = [{"requestHash": hashlib.sha256(f"request-{i}".encode()).hexdigest(),
            "captureInputHash": hashlib.sha256(f"input-{i}".encode()).hexdigest(),
            "requiredObservationSetHash": hashlib.sha256(f"observations-{i}".encode()).hexdigest(),
            "requiredObservationCount": 1, "auditDescriptorBytes": 1} for i in range(4096)]
        raw, pin, _, plan = planner_fixture(base, {"aggregateBytes": 512*MIB, "shardReservedBytes": 24*MIB,
            "maxCaptures": 256, "descriptorBytes": 511900}, requests)
        result = worker.validate_shard_plan(raw, pin, base)
        self.assertEqual(result["plan"]["requestCount"], 4096)
        self.assertEqual(len(result["reservations"]), 16)
        too_many = requests[:257]
        raw, pin, _, _ = planner_fixture(base, {"aggregateBytes": 512*MIB, "shardReservedBytes": 24*MIB,
            "maxCaptures": 1, "maxShards": 256, "descriptorBytes": 511900}, too_many)
        with self.assertRaisesRegex(ValueError, "shard count"):
            worker.validate_shard_plan(raw, pin, base)

    def test_shard_plan_uses_complete_greedy_groups_for_capture_and_descriptor_caps(self):
        requests = [{"requestHash": f"{i:064x}",
            "captureInputHash": hashlib.sha256(f"input-{i}".encode()).hexdigest(),
            "requiredObservationSetHash": hashlib.sha256(f"obs-{i}".encode()).hexdigest(),
            "requiredObservationCount": i % 8 + 1, "auditDescriptorBytes": size}
            for i, size in enumerate((100, 200, 200, 100), 1)]
        raw, pin, base, plan = planner_fixture(base_binding(), {
            "maxCaptures": 3, "descriptorBytes": 300, "maxShards": 4,
            "aggregateBytes": 128*MIB,
        }, requests)
        result = worker.validate_shard_plan(raw, pin, base)
        self.assertEqual([shard["requestHashes"] for shard in result["plan"]["shards"]],
            [[request["requestHash"] for request in requests[:2]],
             [request["requestHash"] for request in requests[2:]]])
        self.assertEqual([shard["descriptorBytes"] for shard in plan["shards"]], [300, 300])
        self.assertEqual([shard["requiredObservationCount"] for shard in plan["shards"]], [5, 9])
        self.assertEqual(len(result["reservations"]), 2)

    def test_shard_plan_strict_numbers_and_json_complexity(self):
        raw, pin, base, plan = planner_fixture()
        for number in [True, float(plan["policy"]["aggregateBytes"])]:
            changed = json.loads(raw); changed["policy"]["aggregateBytes"] = number
            bad = canonical(changed)
            with self.subTest(number=number), self.assertRaises(ValueError):
                worker.validate_shard_plan(bad, {"sha256": hashlib.sha256(bad).hexdigest(), "bytes": len(bad)}, base)
        for malformed in [b"["*18+b"0"+b"]"*18,
                          b"["+b",".join([b"0"]*150000)+b"]"]:
            with self.assertRaisesRegex(ValueError, "complexity"):
                worker.validate_shard_plan(malformed, {"sha256": hashlib.sha256(malformed).hexdigest(), "bytes": len(malformed)}, base)

    def setUp(self):
        self.saved_fsize = resource.getrlimit(resource.RLIMIT_FSIZE)
        limits = [DATABASE_BYTES] + [limit for limit in self.saved_fsize if limit != resource.RLIM_INFINITY]
        resource.setrlimit(resource.RLIMIT_FSIZE, (min(limits), self.saved_fsize[1]))
        self.temp = tempfile.TemporaryDirectory(prefix="allworld-registry-worker-")
        self.parent = Path(self.temp.name).resolve(strict=True)
        self.root = self.parent / "namespace"
        self.root.mkdir(mode=0o700)
        os.chmod(self.root, 0o700)

    def tearDown(self):
        self.temp.cleanup()
        resource.setrlimit(resource.RLIMIT_FSIZE, self.saved_fsize)

    def environment(self, descriptor, **changes):
        values = {
            "TMPDIR": str(self.root),
            "WORLD_INDEX_NAMESPACE_BUDGET": str(BUDGET),
            "WORLD_INDEX_PYTHON_VERSION": __import__("sys").version.split()[0],
            "WORLD_INDEX_PYTHON_SQLITE_VERSION": sqlite3.sqlite_version,
            "WORLD_INDEX_NAMESPACE_DESCRIPTOR": str(descriptor),
        }
        values.update(changes)
        return values

    def test_budget_parser_accepts_only_bounded_ascii_decimal(self):
        self.assertEqual(worker._budget(str(BUDGET)), BUDGET)
        self.assertEqual(worker._budget("0" + str(BUDGET)), BUDGET)
        for invalid in ["", "+123", "-1", " 123", "123 ", "1e6", "True", "１２３", "12345678901"]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                worker._budget(invalid)
        for out_of_range in ["1", str(worker.MAX_AGGREGATE_BYTES + 1)]:
            with self.subTest(out_of_range=out_of_range), self.assertRaises(ValueError):
                worker._budget(out_of_range)

    def test_runtime_pin_mismatch_and_missing_values_fail_before_namespace_lock(self):
        with self.assertRaisesRegex(RuntimeError, "Python runtime"):
            worker._runtime_environment(self.environment("3", WORLD_INDEX_PYTHON_VERSION="0.0"))
        with self.assertRaisesRegex(RuntimeError, "SQLite runtime"):
            worker._runtime_environment(self.environment("3", WORLD_INDEX_PYTHON_SQLITE_VERSION="0.0"))
        with self.assertRaisesRegex(ValueError, "ASCII decimal"):
            worker._runtime_environment(self.environment("3", WORLD_INDEX_NAMESPACE_BUDGET=" "))
        with index_writer_lease(self.root) as lease:
            environment = self.environment(str(lease.descriptor))
            environment.pop("WORLD_INDEX_NAMESPACE_DESCRIPTOR")
            with self.assertRaisesRegex(ValueError, "incomplete"):
                worker._runtime_environment(environment)
            for invalid in ["2", "invalid", "9999999999"]:
                environment = self.environment(invalid)
                with self.subTest(descriptor=invalid), self.assertRaises(ValueError):
                    worker._runtime_environment(environment)
        self.assertFalse((self.root / "reservations.sqlite").exists())

    def test_unrelated_namespace_descriptor_is_refused(self):
        other = self.parent / "other"
        other.mkdir(mode=0o700)
        os.chmod(other, 0o700)
        with index_writer_lease(self.root), index_writer_lease(other) as unrelated:
            with self.assertRaisesRegex(ValueError, "differs"):
                worker._runtime_environment(self.environment(str(unrelated.descriptor)))
        self.assertFalse((self.root / "reservations.sqlite").exists())

    def test_fixed_worker_initializes_then_reopens_without_changing_registry_inode(self):
        with index_writer_lease(self.root) as lease:
            first = json.loads(worker._run(self.root, BUDGET, lease))
        database = self.root / "reservations.sqlite"
        inode = database.stat().st_ino
        self.assertEqual(set(first), {
            "format", "namespaceBindingSha256", "aggregateBytes", "replayed", "pythonVersion",
            "sqliteVersion", "stats", "databaseBytes", "maximumRssKiB",
        })
        self.assertEqual(first["format"], "feature-index-registry-startup-v1")
        self.assertFalse(first["replayed"])
        self.assertEqual(first["aggregateBytes"], BUDGET)
        self.assertEqual(first["stats"]["reservations"], 0)
        self.assertEqual(first["stats"]["heldBytes"], 0)
        self.assertEqual(first["stats"]["aggregateLimitBytes"], BUDGET)
        self.assertEqual(first["databaseBytes"], database.stat().st_size)
        self.assertGreater(first["maximumRssKiB"], 0)
        with index_writer_lease(self.root) as lease:
            second = json.loads(worker._run(self.root, BUDGET, lease))
            self.assertTrue(second["replayed"])
            self.assertEqual(second["stats"], first["stats"])
        self.assertEqual(database.stat().st_ino, inode)

    def test_main_prints_one_canonical_report_after_namespace_close(self):
        output = io.StringIO()
        with index_writer_lease(self.root) as lease:
            env = self.environment(str(lease.descriptor))
            with patch.dict(os.environ, env, clear=True), patch.object(worker.sys, "argv", ["index_registry_worker.py"]), redirect_stdout(output):
                self.assertEqual(worker.main(), 0)
        raw = output.getvalue()
        self.assertTrue(raw.endswith("\n"))
        report = json.loads(raw)
        self.assertEqual(raw, json.dumps(report, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n")
        self.assertTrue((self.root / "reservations.sqlite").is_file())

    def test_main_rejects_cli_arguments_without_opening_the_namespace(self):
        output = io.StringIO()
        with patch.dict(os.environ, {}, clear=True), patch.object(worker.sys, "argv", ["index_registry_worker.py", "extra"]), redirect_stdout(output):
            with self.assertRaisesRegex(ValueError, "no arguments"):
                worker.main()
        self.assertEqual(output.getvalue(), "")
        self.assertFalse((self.root / "writer.lock").exists())


if __name__ == "__main__":
    unittest.main()
