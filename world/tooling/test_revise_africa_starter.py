"""Isolated recovery tests for explicit offline Africa starter revisions."""
import importlib.util
import os
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from contextlib import nullcontext, redirect_stdout
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/world/revise-africa-starter.py"
SPEC = importlib.util.spec_from_file_location("revision_fixture", SCRIPT)
REV = importlib.util.module_from_spec(SPEC)
exec(compile(SCRIPT.read_bytes(), str(SCRIPT), "exec"), REV.__dict__)


class RevisionPublicationTests(unittest.TestCase):
    def test_transitive_compiler_sources_are_pinned_and_changes_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            geography = root / "scripts/build-playable-africa.py"
            publication = root / "world/atomic_starter_publication.py"
            geography.parent.mkdir(parents=True)
            publication.parent.mkdir(parents=True)
            geography_bytes, publication_bytes = b"geography", b"publication"
            geography.write_bytes(geography_bytes)
            publication.write_bytes(publication_bytes)
            overrides = {
                "ROOT": root,
                "GEOGRAPHY_COMPILER": geography,
                "PUBLICATION_HELPER": publication,
                "GEOGRAPHY_COMPILER_SOURCE_SHA256": hashlib.sha256(geography_bytes).hexdigest(),
                "PUBLICATION_HELPER_SOURCE_SHA256": hashlib.sha256(publication_bytes).hexdigest(),
            }
            with patch.multiple(REV, **overrides):
                self.assertEqual(REV.verify_loaded_compiler_sources(), {
                    "geographyCompilerSha256": hashlib.sha256(geography_bytes).hexdigest(),
                    "publicationHelperSha256": hashlib.sha256(publication_bytes).hexdigest(),
                })
                geography.write_bytes(b"changed geography")
                with self.assertRaisesRegex(ValueError, "geographyCompilerSha256 changed"):
                    REV.verify_loaded_compiler_sources()

    def test_transitive_pins_change_revision_identity_and_reject_legacy_identity(self):
        files = {name: name.encode() for name in REV.ASSET_NAMES}
        after = {"files": {name: ("new-" + name).encode() for name in REV.ASSET_NAMES},
                 "receipt": b"new receipt"}
        pins = {"inventorySha256": "a" * 64}
        legacy_id, _ = REV.revision_identity("TZ", "dar", files, b"old receipt", after, pins)
        current_id, current_intent = REV.revision_identity("TZ", "dar", files, b"old receipt", after,
                                                            {**pins, "geographyCompilerSha256": "b" * 64,
                                                             "publicationHelperSha256": "c" * 64})
        changed_id, _ = REV.revision_identity("TZ", "dar", files, b"old receipt", after,
                                               {**pins, "geographyCompilerSha256": "d" * 64,
                                                "publicationHelperSha256": "c" * 64})
        self.assertEqual(current_intent["sourcePinVersion"], REV.REVISION_SOURCE_PIN_VERSION)
        self.assertNotEqual(legacy_id, current_id)
        self.assertNotEqual(current_id, changed_id)

    def test_legacy_archive_without_transitive_pins_cannot_resume(self):
        self.make_do_country_fixture()
        revision = "a" * 64
        stage = REV.REVISION_ROOT / "dar" / revision
        REV.check_path_chain(stage, private=True, create=True)
        (stage / "intent.json").write_text(json.dumps({"schemaVersion": 1, "revisionId": revision}))
        with self.assertRaisesRegex(ValueError, "Legacy revision archive lacks transitive compiler pins"):
            REV.do_country("TZ", "resume", revision)

    def fixture(self):
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name).resolve()
        REV.ROOT = root
        geography_source = root / "scripts/world/build-playable-africa.py"
        publication_source = root / "world/tooling/atomic_starter_publication.py"
        geography_source.parent.mkdir(parents=True)
        publication_source.parent.mkdir(parents=True)
        geography_bytes, publication_bytes = b"geography fixture", b"publication fixture"
        geography_source.write_bytes(geography_bytes)
        publication_source.write_bytes(publication_bytes)
        compiler_paths = {"GEOGRAPHY_COMPILER": geography_source,
                          "PUBLICATION_HELPER": publication_source,
                          "GEOGRAPHY_COMPILER_SOURCE_SHA256": hashlib.sha256(geography_bytes).hexdigest(),
                          "PUBLICATION_HELPER_SOURCE_SHA256": hashlib.sha256(publication_bytes).hexdigest()}
        for name, value in compiler_paths.items():
            setter = patch.object(REV, name, value)
            setter.start()
            self.addCleanup(setter.stop)
        city = root / "src/game/cities/dar"
        receipt = root / "world/playable-africa-rollout/receipts/dar.json"
        city.parent.mkdir(parents=True)
        receipt.parent.mkdir(parents=True)
        before = {name: ("before-" + name).encode() for name in REV.ASSET_NAMES}
        after = {name: ("after-" + name).encode() for name in REV.ASSET_NAMES}
        old_receipt, new_receipt = b"old receipt\n", b"new receipt\n"
        for name, raw in before.items():
            (city / name).parent.mkdir(parents=True, exist_ok=True)
            (city / name).write_bytes(raw)
        receipt.write_bytes(old_receipt)
        stage = root / ".cache/world-build/africa-starter-revisions/dar" / ("a" * 64)
        return temporary, root, city, receipt, stage, before, old_receipt, after, new_receipt

    def test_recovers_after_city_archive_rename(self):
        fixture = self.fixture()
        temporary, root, city, receipt, stage, before, old_receipt, after, new_receipt = fixture
        self.addCleanup(temporary.cleanup)
        revision, intent = REV.revision_identity("TZ", "dar", before, old_receipt, {"files": after, "receipt": new_receipt}, {"inventorySha256": "a" * 64})
        stage = stage.with_name(revision)
        REV.stage_revision(stage, intent, before, old_receipt, after, new_receipt)
        rename = os.rename
        calls = 0
        def interrupted(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise RuntimeError("simulated process interruption")
            return rename(*args, **kwargs)
        with patch.object(REV.os, "rename", side_effect=interrupted):
            with self.assertRaises(RuntimeError):
                REV.publish_revision(stage, city, receipt, before, old_receipt, after, new_receipt)
        REV.publish_revision(stage, city, receipt, before, old_receipt, after, new_receipt)
        self.assertEqual({name: (city / name).read_bytes() for name in REV.ASSET_NAMES}, after)
        self.assertEqual(receipt.read_bytes(), new_receipt)
        self.assertEqual({name: (stage / "before-city" / name).read_bytes() for name in REV.ASSET_NAMES}, before)

    def test_refuses_unknown_partial_live_city(self):
        fixture = self.fixture()
        temporary, root, city, receipt, stage, before, old_receipt, after, new_receipt = fixture
        self.addCleanup(temporary.cleanup)
        (city / "geometry.ts").write_bytes(b"unowned change")
        revision, intent = REV.revision_identity("TZ", "dar", before, old_receipt, {"files": after, "receipt": new_receipt}, {})
        stage = stage.with_name(revision)
        REV.stage_revision(stage, intent, before, old_receipt, after, new_receipt)
        with self.assertRaisesRegex(ValueError, "neither the pinned prior nor exact revised payload"):
            REV.publish_revision(stage, city, receipt, before, old_receipt, after, new_receipt)

    def test_prefix_recovery_accepts_only_expected_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            REV.ROOT = root
            target = root / "payload"
            target.write_bytes(b"expected")
            REV.write_prefix(target, b"expected", 32)
            target.write_bytes(b"unrelated")
            with self.assertRaisesRegex(ValueError, "outside the expected owned prefix"):
                REV.write_prefix(target, b"expected", 32)

    def test_cache_reader_requires_exact_source_and_original_request_intent(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            REV.ROOT = root
            city = "dar"
            centre = [39.266396, -6.798067]
            bounds = [round(centre[0] - .003, 6), round(centre[1] - .003, 6),
                      round(centre[0] + .003, 6), round(centre[1] + .003, 6)]
            url = "https://api.openstreetmap.org/api/0.6/map?bbox=" + ",".join(map(str, bounds))
            raw = b"retained source bytes"
            digest = hashlib.sha256(raw).hexdigest()
            source = {"url": url, "bounds": bounds, "bytes": len(raw), "sha256": digest,
                      "fetchedAt": "2026-10-09T19:26:01Z", "attribution": "© OpenStreetMap contributors", "licence": "ODbL-1.0"}
            ledger = [{"url": url, "reservedBytes": REV.MAX_OSM_BYTES, "status": "complete",
                       "receivedBytes": len(raw), "sha256": digest}]
            cache = root / ".cache/world-build/playable-africa" / city
            cache.mkdir(parents=True)
            (cache / "source.osm").write_bytes(raw)
            (cache / "source.json").write_text(json.dumps(source))
            (cache / "requests.json").write_text(json.dumps(ledger))
            self.assertEqual(REV.request_inputs(city, centre, {"sources": {"osm": source}})[0], raw)
            ledger[0]["reservedBytes"] = REV.MAX_OSM_BYTES + 1
            (cache / "requests.json").write_text(json.dumps(ledger))
            with self.assertRaisesRegex(ValueError, "ledger and cached source disagree"):
                REV.request_inputs(city, centre, {"sources": {"osm": source}})

    def make_do_country_fixture(self):
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name).resolve()
        REV.ROOT = root
        REV.REVISION_ROOT = root / ".cache/world-build/africa-starter-revisions"
        geography_path = root / "scripts/world/build-playable-africa.py"
        publication_path = root / "world/tooling/atomic_starter_publication.py"
        geography_path.parent.mkdir(parents=True)
        publication_path.parent.mkdir(parents=True)
        geography_bytes, publication_bytes = b"fixture geography compiler", b"fixture publication helper"
        geography_path.write_bytes(geography_bytes)
        publication_path.write_bytes(publication_bytes)
        geography_hash = REV.sha(geography_bytes)
        publication_hash = REV.sha(publication_bytes)
        city = root / "src/game/cities/dar"
        receipt_path = root / "world/playable-africa-rollout/receipts/dar.json"
        city.mkdir(parents=True)
        receipt_path.parent.mkdir(parents=True)
        before = {name: ("old/" + name).encode() for name in REV.ASSET_NAMES}
        after = {name: ("new/" + name).encode() for name in REV.ASSET_NAMES}
        for name, data in before.items():
            (city / name).write_bytes(data)
        place = {"name": "Dar es Salaam", "coordinatesWgs84": [39.266396, -6.798067]}
        airport = {"name": "Dataset point", "coordinatesWgs84": [39.2, -6.8]}
        geometry = {"outlineParts": [{"path": "country.geojson", "sha256": "b" * 64}]}
        identity = {"cityId": "dar", "stateId": "tz-zone", "stateName": "Starter"}
        osm = {"url": "https://api.openstreetmap.org/api/0.6/map?bbox=39.263396,-6.801067,39.269396,-6.795067",
               "bounds": [39.263396, -6.801067, 39.269396, -6.795067], "bytes": 21, "sha256": "c" * 64,
               "fetchedAt": "2026-10-09T19:26:01Z", "attribution": "© OpenStreetMap contributors", "licence": "ODbL-1.0"}
        data_dir = root / "world/playable-africa-rollout"
        data_dir.mkdir(parents=True, exist_ok=True)
        inventory = b"{}\n"
        (data_dir / "inventory.json").write_bytes(inventory)
        original_data = REV.GEN.DATA
        REV.GEN.DATA = data_dir
        self.addCleanup(setattr, REV.GEN, "DATA", original_data)
        inventory_hash = REV.sha(inventory)
        old_receipt = {"countryIso2": "TZ", "cityId": "dar", "generationIdentity": identity,
                       "inventorySha256": inventory_hash, "selectedPlace": place, "airportCandidate": airport,
                       "sources": {"osm": osm, "naturalEarth": geometry}, "assets": REV.pin_map(before)}
        old_receipt_raw = (json.dumps(old_receipt, separators=(",", ":")) + "\n").encode()
        receipt_path.write_bytes(old_receipt_raw)
        new_receipt = {**old_receipt, "assets": REV.pin_map(after), "bounds": [1, 2, 3, 4]}
        new_receipt_raw = (json.dumps(new_receipt, separators=(",", ":")) + "\n").encode()
        source_pins = {"inventorySha256": inventory_hash, "osm": {"sourceOsm": "d" * 64,
                       "sourceReceipt": "e" * 64, "requestLedger": "f" * 64},
                       "geographyCompilerSha256": geography_hash,
                       "publicationHelperSha256": publication_hash}
        row = {"iso2": "TZ", "country": "Tanzania", "admin0Geometry": geometry}
        source_info = osm
        def fake_verify(_country, _old_receipt):
            return row, place, "Africa/Dar_es_Salaam", airport, identity, b"retained source bytes", source_info, source_pins
        compiled = {"files": after, "receipt": new_receipt_raw,
                    "identity": {"countryIso2": "TZ", "cityId": "dar", "generationIdentity": identity},
                    "sourceIdentity": {"countryIso2": "TZ", "cityId": "dar", "generationIdentity": identity,
                                       "inventorySha256": inventory_hash, "selectedPlace": place,
                                       "airportCandidate": airport, "naturalEarth": geometry,
                                       "osm": {"url": osm["url"], "bytes": osm["bytes"], "sha256": osm["sha256"]},
                                       "jubaSelection": None}}
        patches = [patch.object(REV, "GEOGRAPHY_COMPILER", geography_path),
                   patch.object(REV, "PUBLICATION_HELPER", publication_path),
                   patch.object(REV, "GEOGRAPHY_COMPILER_SOURCE_SHA256", geography_hash),
                   patch.object(REV, "PUBLICATION_HELPER_SOURCE_SHA256", publication_hash),
                   patch.object(REV, "verify_source_inputs", side_effect=fake_verify),
                   patch.object(REV, "capture_compile", return_value=compiled),
                   patch.object(REV.GEN, "verify_assets", return_value=None),
                   patch.object(REV.PUB, "publication_lease", side_effect=lambda *_a, **_kw: nullcontext())]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)
        self.addCleanup(temporary.cleanup)
        return city, receipt_path, old_receipt_raw, new_receipt_raw, before, after, patches

    def test_do_country_resumes_each_live_publication_boundary(self):
        for boundary in ("after-old-city-rename", "before-receipt-move", "after-prior-receipt-move", "after-new-receipt-link"):
            with self.subTest(boundary=boundary):
                city, receipt, old_receipt, new_receipt, before, after, fixture_patches = self.make_do_country_fixture()
                plan = REV.do_country("TZ", "plan")
                revision = plan["revisionId"]
                base_rename, base_link = os.rename, os.link
                renames = 0
                def interrupt_rename(*args, **kwargs):
                    nonlocal renames
                    renames += 1
                    if ((boundary == "after-old-city-rename" and renames == 2)
                            or (boundary == "before-receipt-move" and renames == 3)):
                        raise RuntimeError("simulated interruption")
                    return base_rename(*args, **kwargs)
                def interrupt_link(*args, **kwargs):
                    if boundary == "after-prior-receipt-move":
                        raise RuntimeError("simulated interruption after prior receipt move")
                    result = base_link(*args, **kwargs)
                    if boundary == "after-new-receipt-link":
                        raise RuntimeError("simulated interruption after receipt link")
                    return result
                with patch.object(REV.os, "rename", side_effect=interrupt_rename), patch.object(REV.os, "link", side_effect=interrupt_link):
                    with self.assertRaises(RuntimeError):
                        REV.do_country("TZ", "apply", revision)
                try:
                    stage_next = REV.REVISION_ROOT / "dar" / revision / "next"
                    next_was_consumed = not stage_next.exists()
                    result = REV.do_country("TZ", "resume", revision)
                    self.assertEqual(result["status"], "complete")
                    self.assertEqual({name: (city / name).read_bytes() for name in REV.ASSET_NAMES}, after)
                    self.assertEqual(receipt.read_bytes(), new_receipt)
                    if next_was_consumed:
                        self.assertFalse(stage_next.exists(), "resume must not recreate an already-published next directory")
                finally:
                    for item in reversed(fixture_patches): item.stop()

    def test_cli_plan_uses_read_only_revision_path(self):
        _city, _receipt, _old, _new, _before, _after, fixture_patches = self.make_do_country_fixture()
        output = io.StringIO()
        try:
            with redirect_stdout(output):
                REV.main(["--country", "TZ", "--plan"])
            self.assertEqual(json.loads(output.getvalue())["status"], "planned")
        finally:
            for item in reversed(fixture_patches): item.stop()

    def test_changed_receipt_after_plan_refuses_before_city_rename(self):
        city, receipt, _old_receipt, _new_receipt, before, _after, _fixture_patches = self.make_do_country_fixture()
        revision = REV.do_country("TZ", "plan")["revisionId"]
        changed = receipt.read_bytes().replace(b"}\n", b',"newer":true}\n')
        receipt.write_bytes(changed)
        with self.assertRaisesRegex(ValueError, "differs from the recomputed pinned payload"):
            REV.do_country("TZ", "apply", revision)
        self.assertEqual({name: (city / name).read_bytes() for name in REV.ASSET_NAMES}, before)
        self.assertEqual(receipt.read_bytes(), changed)

    def test_newer_receipt_appearing_after_stage_refuses_before_city_rename(self):
        city, receipt, _old_receipt, _new_receipt, before, _after, _fixture_patches = self.make_do_country_fixture()
        original_publish = REV.publish_revision
        def mutate_receipt_then_publish(*args, **kwargs):
            receipt.write_bytes(b"newer external receipt")
            return original_publish(*args, **kwargs)
        with patch.object(REV, "publish_revision", side_effect=mutate_receipt_then_publish):
            with self.assertRaisesRegex(ValueError, "Current receipt is neither"):
                REV.do_country("TZ", "apply", REV.do_country("TZ", "plan")["revisionId"])
        self.assertEqual({name: (city / name).read_bytes() for name in REV.ASSET_NAMES}, before)
        self.assertEqual(receipt.read_bytes(), b"newer external receipt")

    def test_source_race_and_offline_acquire_boundary(self):
        city, receipt, _old_receipt, _new_receipt, before, _after, _fixture_patches = self.make_do_country_fixture()
        original_verify = REV.verify_source_inputs
        calls = 0
        def changed_pin(*args):
            nonlocal calls
            calls += 1
            result = list(original_verify(*args))
            if calls == 2:
                result[-1] = {**result[-1], "osm": {"sourceOsm": "changed"}}
            return tuple(result)
        with patch.object(REV, "verify_source_inputs", side_effect=changed_pin):
            with self.assertRaisesRegex(ValueError, "Pinned source inputs changed"):
                REV.do_country("TZ", "plan")
        self.assertEqual({name: (city / name).read_bytes() for name in REV.ASSET_NAMES}, before)

        original_main = REV.GEN.main
        info = {"url": "offline-only", "bytes": 3, "sha256": "1" * 64}
        try:
            def fake_main():
                raw, source = REV.GEN.acquire("dar", [39.266396, -6.798067])
                REV.GEN.publish_city("root", "src/game/cities/dar", "world/playable-africa-rollout/receipts/dar.json", "stage",
                                     {name: "x" for name in REV.ASSET_NAMES}, b"receipt",
                                     {"countryIso2": "TZ", "cityId": "dar"}, {"source": source})
                self.assertEqual(raw, b"cached")
            REV.GEN.main = fake_main
            result = REV.compile_target("TZ", b"cached", info)
            self.assertEqual(result["sourceIdentity"], {"source": info})
        finally:
            REV.GEN.main = original_main

    def test_transitive_compiler_change_after_compile_refuses_publication(self):
        city, _receipt, _old_receipt, _new_receipt, before, _after, fixture_patches = self.make_do_country_fixture()
        try:
            compile_once = REV.capture_compile
            def mutate_after_compile(*args):
                result = compile_once(*args)
                REV.GEOGRAPHY_COMPILER.write_bytes(b"changed after compile")
                return result
            with patch.object(REV, "capture_compile", side_effect=mutate_after_compile):
                with self.assertRaisesRegex(ValueError, "geographyCompilerSha256 changed"):
                    REV.do_country("TZ", "plan")
            self.assertEqual({name: (city / name).read_bytes() for name in REV.ASSET_NAMES}, before)
        finally:
            for item in reversed(fixture_patches): item.stop()

    def test_corrupt_archive_marker_refuses_resume(self):
        city, _receipt, _old_receipt, _new_receipt, before, _after, _fixture_patches = self.make_do_country_fixture()
        revision = REV.do_country("TZ", "plan")["revisionId"]
        with self.assertRaises(RuntimeError):
            with patch.object(REV.os, "rename", side_effect=RuntimeError("stop before city rename")):
                REV.do_country("TZ", "apply", revision)
        marker = REV.REVISION_ROOT / "dar" / revision / "archive-ready.json"
        marker.write_bytes(b"corrupt")
        with self.assertRaises(ValueError):
            REV.do_country("TZ", "resume", revision)
        self.assertEqual({name: (city / name).read_bytes() for name in REV.ASSET_NAMES}, before)


if __name__ == "__main__":
    unittest.main()
