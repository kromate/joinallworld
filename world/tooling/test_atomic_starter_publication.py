#!/usr/bin/env python3
"""Crash and refusal tests for atomic starter-city publication."""
import hashlib
import json
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from types import ModuleType

SCRIPT = Path(__file__).resolve().parents[1] / "tooling/atomic_starter_publication.py"
PUB = ModuleType("atomic_starter_publication_test")
PUB.__file__ = str(SCRIPT)
exec(compile(SCRIPT.read_bytes(), str(SCRIPT), "exec"), PUB.__dict__)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def fixture(root):
    for relative in ("src/game/cities", "world/playable-africa-rollout/receipts", ".cache/world-build"):
        (root / relative).mkdir(parents=True, exist_ok=True)
    files = {
        "facts.ts": "facts\n",
        "geometry.ts": "geometry bounded\n",
        "index.ts": "index lazy callbacks\n",
        "map.ts": "map\n",
        "content.ts": "content\n",
    }
    receipt = {"countryIso2": "TZ", "cityId": "fixture", "inventorySha256": "1" * 64,
               "sources": {"osm": {"url": "local-fixture", "bytes": 7, "sha256": "2" * 64}},
               "assets": {name: {"bytes": len(value.encode()), "sha256": digest(value.encode())} for name, value in files.items()}}
    receipt_bytes = (json.dumps(receipt, separators=(",", ":")) + "\n").encode()
    identity = {"countryIso2": "TZ", "cityId": "fixture", "generationIdentity": {"cityId": "fixture", "stateId": "tz-starter", "stateName": "Starter zone"}}
    source_identity = {"countryIso2": "TZ", "cityId": "fixture", "generationIdentity": identity["generationIdentity"],
                       "inventorySha256": "1" * 64, "osm": {"url": "local-fixture", "bytes": 7, "sha256": "2" * 64}}
    ledger = root / ".cache/world-build/playable-africa/fixture/requests.json"
    ledger.parent.mkdir(parents=True)
    ledger.write_bytes(b'[{"url":"already reserved","status":"started"}]\n')
    return files, receipt_bytes, identity, source_identity, ledger


def publish(root, fixture_data, *, checkpoint=None, source_identity=None):
    files, receipt, identity, source, _ledger = fixture_data
    return PUB.publish_city(root, "src/game/cities/fixture", "world/playable-africa-rollout/receipts/fixture.json",
                            ".cache/world-build/africa-starter-publication/fixture", files, receipt, identity,
                            source if source_identity is None else source_identity, checkpoint=checkpoint)


def city_bytes(root):
    city = root / "src/game/cities/fixture"
    return {name: (city / name).read_bytes() for name in sorted(PUB.ASSET_NAMES)}


WORKER = r'''import importlib.util, json, sys, time
from pathlib import Path
module_path, root, target = sys.argv[1:]
spec=importlib.util.spec_from_file_location("atomic_starter_publication_worker", module_path)
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
data=json.loads(sys.stdin.buffer.read())
def pause(name):
    if name == target:
        print(name, flush=True)
        while True: time.sleep(1)
module.publish_city(Path(root), data["city"], data["receiptPath"], data["stage"], data["files"],
                    bytes.fromhex(data["receipt"]), data["identity"], data["source"], checkpoint=pause)
'''


class AtomicPublicationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.data = fixture(self.root)

    def tearDown(self):
        self.temporary.cleanup()

    def kill_at(self, checkpoint):
        files, receipt, identity, source, ledger = self.data
        payload = {"city": "src/game/cities/fixture", "receiptPath": "world/playable-africa-rollout/receipts/fixture.json",
                   "stage": ".cache/world-build/africa-starter-publication/fixture", "files": files,
                   "receipt": receipt.hex(), "identity": identity, "source": source}
        process = subprocess.Popen([sys.executable, "-c", WORKER, str(SCRIPT), str(self.root), checkpoint],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=False)
        process.stdin.write(json.dumps(payload).encode())
        process.stdin.close()
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        try:
            events = selector.select(timeout=8)
            if not events:
                self.fail(f"publisher did not reach {checkpoint}; stderr={process.stderr.read().decode()}")
            line = process.stdout.readline().decode().strip()
            self.assertEqual(line, checkpoint)
        finally:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=3)
            process.stdout.close()
            process.stderr.close()
        self.assertEqual(ledger.read_bytes(), b'[{"url":"already reserved","status":"started"}]\n')

    def test_kill_after_intent_city_rename_and_receipt_publication_resumes_exact_bytes(self):
        checkpoints = ("intent-durable", "staged asset-prefix", "assets-staged", "staged receipt-prefix",
                       "receipt-staged", "city-published", "pending receipt-prefix", "receipt-published")
        for index, checkpoint in enumerate(checkpoints):
            with self.subTest(checkpoint=checkpoint):
                if index:
                    self.temporary.cleanup()
                    self.temporary = tempfile.TemporaryDirectory()
                    self.root = Path(self.temporary.name)
                    self.data = fixture(self.root)
                self.kill_at(checkpoint)
                self.assertEqual(publish(self.root, self.data), "published")
                expected_files = {name: value.encode() for name, value in self.data[0].items()}
                self.assertEqual(city_bytes(self.root), expected_files)
                receipt_path = self.root / "world/playable-africa-rollout/receipts/fixture.json"
                self.assertEqual(receipt_path.read_bytes(), self.data[1])
                intent_path = self.root / ".cache/world-build/africa-starter-publication/fixture/intent.json"
                intent = json.loads(intent_path.read_bytes())
                self.assertEqual(intent["identity"], self.data[2])
                self.assertEqual(intent["sourceIdentity"], self.data[3])
                first_files, first_receipt = city_bytes(self.root), receipt_path.read_bytes()
                self.assertEqual(publish(self.root, self.data), "published")
                self.assertEqual(city_bytes(self.root), first_files)
                self.assertEqual(receipt_path.read_bytes(), first_receipt)
                self.assertEqual(self.data[4].read_bytes(), b'[{"url":"already reserved","status":"started"}]\n')

    def test_interruption_before_intent_is_not_adopted(self):
        self.kill_at("stage-created")
        with self.assertRaisesRegex(ValueError, "unowned partial"):
            publish(self.root, self.data)
        self.assertFalse((self.root / "src/game/cities/fixture").exists())

    def test_corrupted_partial_stage_prefix_is_not_repaired(self):
        self.kill_at("staged asset-prefix")
        asset = self.root / ".cache/world-build/africa-starter-publication/fixture/assets/facts.ts"
        prefix = bytearray(asset.read_bytes())
        prefix[0] ^= 1
        asset.write_bytes(prefix)
        with self.assertRaisesRegex(ValueError, "outside the owned expected prefix"):
            publish(self.root, self.data)
        self.assertEqual(asset.read_bytes(), bytes(prefix))

    def test_unowned_empty_city_or_staging_directory_is_refused(self):
        city = self.root / "src/game/cities/fixture"
        city.mkdir()
        with self.assertRaisesRegex(ValueError, "partial city output"):
            publish(self.root, self.data)
        city.rmdir()
        stage = self.root / ".cache/world-build/africa-starter-publication/fixture"
        stage.mkdir(parents=True)
        stage.chmod(0o700)
        with self.assertRaisesRegex(ValueError, "unowned partial"):
            publish(self.root, self.data)

    def test_lease_contention_fails_without_waiting(self):
        with PUB.publication_lease(self.root, ".cache/world-build/africa-starter-publication/fixture"):
            with self.assertRaisesRegex(ValueError, "Another cooperating writer"):
                publish(self.root, self.data)

    def test_lease_rejects_nonprivate_cache_parent(self):
        parent = self.root / ".cache/world-build/africa-starter-publication"
        with PUB.publication_lease(self.root, ".cache/world-build/africa-starter-publication/fixture"):
            pass
        parent.chmod(0o755)
        with self.assertRaisesRegex(ValueError, "owned by this user and private"):
            with PUB.publication_lease(self.root, ".cache/world-build/africa-starter-publication/fixture"):
                pass

    def test_wrong_prior_receipt_asset_or_intent_is_never_overwritten(self):
        publish(self.root, self.data)
        receipt = self.root / "world/playable-africa-rollout/receipts/fixture.json"
        receipt.write_bytes(receipt.read_bytes() + b" ")
        with self.assertRaisesRegex(ValueError, "published receipt differs"):
            publish(self.root, self.data)

    def test_symlink_city_receipt_and_asset_are_refused(self):
        outside = self.root / "outside"
        outside.mkdir()
        city = self.root / "src/game/cities/fixture"
        city.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            publish(self.root, self.data)
        city.unlink()
        receipt = self.root / "world/playable-africa-rollout/receipts/fixture.json"
        receipt.symlink_to(outside / "receipt")
        with self.assertRaises(ValueError):
            publish(self.root, self.data)
        receipt.unlink()
        publish(self.root, self.data)
        asset = city / "facts.ts"
        saved = asset.read_bytes()
        asset.unlink()
        asset.symlink_to(outside / "facts.ts")
        with self.assertRaises(ValueError):
            publish(self.root, self.data)
        asset.unlink()
        asset.write_bytes(saved)

    def test_nonprivate_intent_is_preserved_and_refused(self):
        self.kill_at("intent-durable")
        intent = self.root / ".cache/world-build/africa-starter-publication/fixture/intent.json"
        original = intent.read_bytes()
        intent.chmod(0o644)
        with self.assertRaisesRegex(ValueError, "private regular file"):
            publish(self.root, self.data)
        self.assertEqual(intent.read_bytes(), original)
        self.assertFalse((self.root / "src/game/cities/fixture").exists())

    def test_stale_intent_and_pending_receipt_are_refused(self):
        self.kill_at("city-published")
        changed = dict(self.data[3], inventorySha256="9" * 64)
        with self.assertRaisesRegex(ValueError, "stale or mismatched"):
            publish(self.root, self.data, source_identity=changed)
        pending = self.root / "world/playable-africa-rollout/receipts/fixture.json.starter-pending"
        pending.write_bytes(b"wrong")
        with self.assertRaisesRegex(ValueError, "pending receipt contains bytes outside"):
            publish(self.root, self.data)

    def test_corrupted_published_asset_is_never_repaired_from_intent(self):
        self.kill_at("city-published")
        asset = self.root / "src/game/cities/fixture/geometry.ts"
        asset.write_bytes(b"altered")
        with self.assertRaisesRegex(ValueError, "Published city asset differs"):
            publish(self.root, self.data)
        self.assertEqual(asset.read_bytes(), b"altered")

    def test_different_receipt_appearing_after_pending_write_is_not_replaced(self):
        self.kill_at("receipt-pending-durable")
        receipt = self.root / "world/playable-africa-rollout/receipts/fixture.json"
        receipt.write_bytes(b"external receipt")
        with self.assertRaisesRegex(ValueError, "published receipt differs"):
            publish(self.root, self.data)
        self.assertEqual(receipt.read_bytes(), b"external receipt")

    def test_city_directory_appearing_after_intent_is_not_adopted(self):
        self.kill_at("intent-durable")
        city = self.root / "src/game/cities/fixture"
        city.mkdir()
        with self.assertRaisesRegex(ValueError, "exactly the five expected assets"):
            publish(self.root, self.data)
        self.assertEqual(list(city.iterdir()), [])

    def test_completed_exact_legacy_output_can_be_verified_without_adopting_partial_state(self):
        publish(self.root, self.data)
        shutil.rmtree(self.root / ".cache/world-build/africa-starter-publication/fixture")
        before = city_bytes(self.root)
        receipt = (self.root / "world/playable-africa-rollout/receipts/fixture.json").read_bytes()
        self.assertEqual(publish(self.root, self.data), "verified-existing")
        self.assertEqual(city_bytes(self.root), before)
        self.assertEqual((self.root / "world/playable-africa-rollout/receipts/fixture.json").read_bytes(), receipt)


if __name__ == "__main__":
    unittest.main()
