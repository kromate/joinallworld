#!/usr/bin/env python3
"""Focused tests for opt-in South Sudan point selection and compact-ID generation."""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from types import ModuleType
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/world/build-africa-starters.py"
GEN = ModuleType("africa_starters_tested")
GEN.__file__ = str(SCRIPT)
exec(compile(SCRIPT.read_bytes(), str(SCRIPT), "exec"), GEN.__dict__)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def make_fixture(root):
    country_id = "country:natural-earth:fixture-ss"
    place_id = "place:natural-earth:fixture-juba"
    outline = {"bytes": 16, "coordinatePositions": 4, "path": ".cache/outline.json", "polygonCount": 1, "sha256": "b" * 64}
    admin_geometry = {"sourceFeatureRef": "admin0:fixture-ss", "geometryType": "Polygon", "outlineParts": [outline]}
    timezone_pin = {"label": "IANA tz database zone.tab from local host", "path": ".cache/zone.tab", "sha256": "a" * 64}
    coords = [31.580026, 4.829975]
    row = {
        "iso2": "SS", "iso2Eh": "SS", "isoIdentityStatus": "Natural Earth ISO_A2 and ISO_A2_EH agree",
        "country": "South Sudan", "countryId": country_id, "admin0A3": "SDS", "gaps": [GEN.SELECTION_GAP_ASSET, GEN.SELECTION_GAP_A3],
        "chosenCity": {"name": "Juba", "naturalEarthPlaceId": place_id, "coordinatesWgs84": coords, "iso2": "SS", "sourceClass": "Admin-0 capital", "timezoneFromPlaceRecord": "Africa/Khartoum", "pointAssetPath": None, "pointAssetSha256": None, "pointAssetStatus": "not found"},
        "cityTimezone": {"ianaTimezone": "Africa/Juba"},
        "airportCandidate": {"isoCountry": "SS", "name": "Juba International Airport", "coordinatesWgs84": [31.601101, 4.87201], "sourceRecordUrl": "https://ourairports.com/airports/HJJJ/"},
        "admin0Geometry": admin_geometry,
    }
    inventory_raw = json.dumps({"schemaVersion": 1, "countries": [row], "sourceFiles": [timezone_pin]}, separators=(",", ":")).encode()
    point_rel = "world/playable-africa-rollout/south-sudan/point.geojson"
    point_path = root / point_rel
    point_path.parent.mkdir(parents=True)
    feature = {"type": "Feature", "id": place_id, "geometry": {"type": "Point", "coordinates": coords},
               "properties": {"name": "Juba", "countryIso2": "SS", "countryId": country_id, "selectedIanaTimezone": "Africa/Juba", "countryAdm0A3": "SDS", "placeAdm0A3": "SSD", "capitalDesignationClaimed": False, "sourceClass": "Admin-0 capital", "sourceTimezone": "Africa/Khartoum"}}
    point_raw = json.dumps({"type": "FeatureCollection", "features": [feature]}, separators=(",", ":")).encode()
    point_path.write_bytes(point_raw)
    caveats = ["ADM0CAP is 0, so this is not an official capital designation.", "Country SDS and place SSD differ; no alias is applied.", "Natural Earth has Africa/Khartoum; Africa/Juba is selected from zone.tab.", "Only the city point is emitted; the country polygon is not emitted."]
    selection = {"name": "Juba", "naturalEarthPlaceId": place_id, "coordinatesWgs84": coords, "countryId": country_id,
                 "countryIsoA3": "SSD", "countryAdm0Iso": "SSD", "countrySovA3": "SDS", "placeSovA3": "SSD",
                 "admin0A3MismatchPreserved": {"country": "SDS", "place": "SSD"},
                 "iso2JoinAccepted": True, "noThreeLetterCodeAlias": True, "selectedIanaTimezone": "Africa/Juba",
                 "timezoneSelectionEvidence": {"source": "system zone.tab", "status": "nearest zone.tab coordinate in matching ISO country", "zoneTabPath": ".cache/zone.tab", "zoneTabSha256": "a" * 64}}
    identity = {"countryIso2": "SS", "countryIso2Eh": "SS", "countryId": country_id, "placeId": place_id,
                "countryAdm0A3": "SDS", "placeAdm0A3": "SSD", "countrySovA3": "SDS", "placeSovA3": "SSD", "countryIsoA3": "SSD", "countryAdm0Iso": "SSD",
                "iso2JoinAccepted": True, "noThreeLetterAliasApplied": True, "threeLetterCodeDiscrepancyRetained": True}
    geometry = {"countryId": country_id, "countryFeatureRef": "admin0:fixture-ss", "topologyValid": True, "containmentAccepted": True,
                "countryPolygonIsValidationInputOnly": True, "sourceGeometryType": "Polygon", "outlineOutputReference": outline}
    packet = {"schemaVersion": 1, "packetKind": "versioned-natural-earth-city-point-source-packet",
              "scope": "Source point and selection evidence only; no runtime admission, city geometry acquisition, or city-completeness assertion.",
              "inventory": {"path": "world/playable-africa-rollout/inventory.json", "sha256": digest(inventory_raw), "bytes": len(inventory_raw), "countryIso2": "SS", "countryId": country_id},
              "citySelection": selection, "identityEvidence": identity, "geometryEvidence": geometry, "caveats": caveats,
              "output": {"path": point_rel, "bytes": len(point_raw), "sha256": digest(point_raw), "featureCount": 1, "geometryType": "Point"}}
    packet_raw = json.dumps(packet, separators=(",", ":")).encode()
    packet_path = root / "selection.json"
    packet_path.write_bytes(packet_raw)
    inventory_path = root / "world/playable-africa-rollout/inventory.json"
    inventory_path.write_bytes(inventory_raw)
    return row, packet, packet_path, digest(packet_raw), inventory_raw


class JubaSelectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.row, self.packet, self.packet_path, self.packet_hash, self.inventory_raw = make_fixture(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def attempt(self, mutate=None):
        packet = copy.deepcopy(self.packet)
        if mutate:
            mutate(packet)
        raw = json.dumps(packet, separators=(",", ":")).encode()
        self.packet_path.write_bytes(raw)
        return GEN.resolve_juba_selection(self.row, self.packet_path, digest(raw), root=self.root, inventory_raw=self.inventory_raw)

    def test_default_refuses_gaps_and_ordinary_selection_is_unchanged(self):
        ordinary = {"iso2": "EG", "gaps": []}
        rows, bindings = GEN.apply_optional_juba_selection([ordinary])
        self.assertIs(rows[0], ordinary)
        self.assertEqual(bindings, {})
        with self.assertRaisesRegex(ValueError, "unresolved inventory gaps"):
            GEN.validate_row(self.row, verify_cached_sources=False)

    def test_valid_opt_in_resolves_only_two_gaps_and_binds_packet_and_point(self):
        resolved, binding = self.attempt()
        self.assertEqual(resolved["gaps"], [])
        self.assertEqual(resolved["chosenCity"]["pointAssetPath"], self.packet["output"]["path"])
        self.assertIn("pinned point accepted", resolved["chosenCity"]["pointAssetStatus"])
        self.assertEqual(resolved["chosenCity"]["pointAssetSha256"], self.packet["output"]["sha256"])
        self.assertEqual(binding["packetSha256"], self.packet_hash)
        self.assertEqual(binding["packetPath"], "selection.json")
        self.assertEqual(binding["pointSha256"], self.packet["output"]["sha256"])

    def test_tracked_juba_packet_and_point_resolve_from_isolated_copy(self):
        repository = SCRIPT.parents[2]
        inventory_raw = (repository / "world/playable-africa-rollout/inventory.json").read_bytes()
        inventory = json.loads(inventory_raw)
        row = next(item for item in inventory["countries"] if item["iso2"] == "SS")
        packet_raw = (repository / "world/playable-africa-rollout/south-sudan/selection.json").read_bytes()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            packet_path = root / "world/playable-africa-rollout/south-sudan/selection.json"
            packet_path.parent.mkdir(parents=True)
            packet_path.write_bytes(packet_raw)
            point_path = packet_path.parent / "point.geojson"
            point_path.write_bytes((repository / "world/playable-africa-rollout/south-sudan/point.geojson").read_bytes())
            (root / "world/playable-africa-rollout/inventory.json").write_bytes(inventory_raw)
            resolved, binding = GEN.resolve_juba_selection(row, packet_path, digest(packet_raw), root=root, inventory_raw=inventory_raw)
        self.assertEqual(resolved["chosenCity"]["name"], "Juba")
        self.assertEqual(resolved["gaps"], [])
        self.assertIn("SDS", binding["caveats"][1])

    def test_wrong_packet_hash_and_inventory_pin_are_refused(self):
        with self.assertRaisesRegex(ValueError, "SHA256 mismatch"):
            GEN.resolve_juba_selection(self.row, self.packet_path, "0" * 64, root=self.root, inventory_raw=self.inventory_raw)
        with self.assertRaisesRegex(ValueError, "current rollout inventory"):
            self.attempt(lambda p: p["inventory"].update(sha256="0" * 64))
        outside = self.root.parent / "outside-selection.json"
        outside.write_bytes(self.packet_path.read_bytes())
        try:
            with self.assertRaisesRegex(ValueError, "inside the repository root"):
                GEN.resolve_juba_selection(self.row, outside, digest(outside.read_bytes()), root=self.root, inventory_raw=self.inventory_raw)
        finally:
            outside.unlink(missing_ok=True)

    def test_identity_place_coordinates_timezone_geometry_and_evidence_are_checked(self):
        mutations = [
            lambda p: p.update(packetKind="wrong-kind"),
            lambda p: p["identityEvidence"].update(countryIso2="SD"),
            lambda p: p["citySelection"].update(naturalEarthPlaceId="other"),
            lambda p: p["citySelection"].update(coordinatesWgs84=[0, 0]),
            lambda p: p["citySelection"].update(selectedIanaTimezone="Africa/Khartoum"),
            lambda p: p["geometryEvidence"].update(containmentAccepted=False),
            lambda p: p["geometryEvidence"].update(outlineOutputReference={"path": "other.json"}),
            lambda p: p["citySelection"]["timezoneSelectionEvidence"].update(zoneTabPath="other.tab"),
            lambda p: p.pop("caveats"),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                with self.assertRaises(ValueError):
                    self.attempt(mutate)

    def test_unrelated_gap_is_not_removed(self):
        self.row["gaps"].append("independent unresolved source gap")
        self.inventory_raw = json.dumps({"schemaVersion": 1, "countries": [self.row], "sourceFiles": [{"label": "IANA tz database zone.tab from local host", "path": ".cache/zone.tab", "sha256": "a" * 64}]}, separators=(",", ":")).encode()
        self.packet["inventory"].update(sha256=digest(self.inventory_raw), bytes=len(self.inventory_raw))
        resolved, _ = self.attempt()
        self.assertEqual(resolved["gaps"], ["independent unresolved source gap"])
        with self.assertRaisesRegex(ValueError, "independent unresolved source gap"):
            GEN.validate_row(resolved, verify_cached_sources=False)

    def test_non_ss_and_unpaired_flags_are_refused(self):
        with self.assertRaisesRegex(ValueError, "only for SS"):
            GEN.resolve_juba_selection({"iso2": "EG"}, self.packet_path, self.packet_hash, root=self.root, inventory_raw=self.inventory_raw)
        with self.assertRaisesRegex(ValueError, "must be supplied together"):
            GEN.apply_optional_juba_selection([self.row], self.packet_path, None)
        with self.assertRaisesRegex(ValueError, "requires explicit --country SS"):
            GEN.apply_optional_juba_selection([{"iso2": "EG"}], self.packet_path, self.packet_hash)

    def test_malformed_packet_and_oversized_point_are_refused(self):
        self.packet_path.write_bytes(b"{")
        with self.assertRaisesRegex(ValueError, "valid JSON"):
            GEN.resolve_juba_selection(self.row, self.packet_path, digest(b"{"), root=self.root, inventory_raw=self.inventory_raw)
        self.packet_path.write_bytes(json.dumps(self.packet, separators=(",", ":")).encode())
        point = self.root / self.packet["output"]["path"]
        point.write_bytes(b" " * (GEN.MAX_POINT_BYTES + 1))
        packet_hash = digest(self.packet_path.read_bytes())
        with self.assertRaisesRegex(ValueError, "exceeds"):
            GEN.resolve_juba_selection(self.row, self.packet_path, packet_hash, root=self.root, inventory_raw=self.inventory_raw)

    def test_plan_request_ledger_enforces_persistent_budget(self):
        cache = self.root / "cache"
        cache.mkdir()
        centre = self.row["chosenCity"]["coordinatesWgs84"]
        bounds = [round(centre[0]-.003, 6), round(centre[1]-.003, 6), round(centre[0]+.003, 6), round(centre[1]+.003, 6)]
        url = "https://api.openstreetmap.org/api/0.6/map?bbox=" + ",".join(map(str, bounds))
        ledger = cache / "requests.json"
        ledger.write_text(json.dumps([{"url": url, "status": "started"}]))
        self.assertEqual(GEN.source_request_state(cache, centre), (False, False, True))
        ledger.write_text(json.dumps([{"url": "one"}, {"url": "two"}]))
        self.assertEqual(GEN.source_request_state(cache, centre), (False, False, True))
        ledger.write_text("{}")
        with self.assertRaisesRegex(ValueError, "must be a list"):
            GEN.source_request_state(cache, centre)

    def test_symlink_fifo_and_changed_point_are_refused(self):
        link = self.root / "selection-link.json"
        link.symlink_to(self.packet_path)
        with self.assertRaises(ValueError):
            GEN.resolve_juba_selection(self.row, link, self.packet_hash, root=self.root, inventory_raw=self.inventory_raw)
        fifo = self.root / "selection-fifo.json"
        os.mkfifo(fifo)
        with self.assertRaisesRegex(ValueError, "regular"):
            GEN.resolve_juba_selection(self.row, fifo, self.packet_hash, root=self.root, inventory_raw=self.inventory_raw)
        point_path = self.root / self.packet["output"]["path"]
        original = point_path.read_bytes()
        point_path.unlink()
        point_link = point_path.with_suffix(".link")
        point_link.write_bytes(original)
        point_path.symlink_to(point_link)
        with self.assertRaises(ValueError):
            GEN.resolve_juba_selection(self.row, self.packet_path, self.packet_hash, root=self.root, inventory_raw=self.inventory_raw)
        point_path.unlink()
        os.mkfifo(point_path)
        with self.assertRaisesRegex(ValueError, "regular"):
            GEN.resolve_juba_selection(self.row, self.packet_path, self.packet_hash, root=self.root, inventory_raw=self.inventory_raw)
        point_path.unlink()
        point_path.write_bytes(original)
        (self.root / self.packet["output"]["path"]).write_text("{}")
        with self.assertRaisesRegex(ValueError, "point GeoJSON pin mismatch"):
            GEN.resolve_juba_selection(self.row, self.packet_path, self.packet_hash, root=self.root, inventory_raw=self.inventory_raw)

    def test_receipt_binds_selection_identity(self):
        resolved, binding = self.attempt()
        resolved["jubaSelectionBinding"] = binding
        identity = {"cityId": "juba", "stateId": "ss-starter", "stateName": "Starter zone"}
        output = self.root / "cities"
        names = {"facts.ts", "geometry.ts", "index.ts", "content.ts", "map.ts"}
        asset_pins = {}
        for name in names:
            target = output / "juba" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(name)
            raw = target.read_bytes()
            asset_pins[name] = {"bytes": len(raw), "sha256": digest(raw)}
        receipt = {"countryIso2": "SS", "cityId": "juba", "generationIdentity": identity,
                   "inventorySha256": digest(self.inventory_raw), "selectedPlace": resolved["chosenCity"],
                   "airportCandidate": resolved["airportCandidate"], "sources": {"naturalEarth": resolved["admin0Geometry"]},
                   "jubaSelection": binding, "assets": asset_pins}
        GEN.verify_assets(receipt, resolved, resolved["chosenCity"], resolved["airportCandidate"], identity, digest(self.inventory_raw), output_root=output)
        receipt["jubaSelection"] = copy.deepcopy(receipt["jubaSelection"])
        receipt["jubaSelection"]["packetSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "selection identity changed"):
            GEN.verify_assets(receipt, resolved, resolved["chosenCity"], resolved["airportCandidate"], identity, digest(self.inventory_raw), output_root=output)

    def test_compact_city_source_generation_is_idempotent(self):
        root = self.root / "repo"
        data = root / "world/playable-africa-rollout"
        output = root / "src/game/cities"
        geometry_dir = root / "pinned"
        data.mkdir(parents=True)
        geometry_dir.mkdir()
        geometry_file = geometry_dir / "land.json"
        geometry_file.write_text(json.dumps({"coordinates": [[[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]]}))
        row = {"iso2": "TZ", "iso2Eh": "TZ", "isoIdentityStatus": "Natural Earth ISO_A2 and ISO_A2_EH agree",
               "country": "Tanzania", "countryId": "country:tz", "gaps": [],
               "chosenCity": {"name": "Dar es Salaam", "coordinatesWgs84": [39.2, -6.8], "iso2": "TZ", "pointAssetPath": "point.json", "pointAssetSha256": "a"*64},
               "cityTimezone": {"ianaTimezone": "Africa/Dar_es_Salaam"},
               "airportCandidate": {"isoCountry": "TZ", "name": "Airport", "coordinatesWgs84": [39.1, -6.9], "sourceRecordUrl": "https://example.test/airport"},
               "admin0Geometry": {"outlineParts": [{"path": str(geometry_file), "sha256": digest(geometry_file.read_bytes())}]}}
        point_file = root / "point.json"
        point_file.write_text("point")
        row["chosenCity"]["pointAssetSha256"] = digest(point_file.read_bytes())
        geometry_file.write_text(json.dumps({"coordinates": [[[[39.0, -7.0], [39.5, -7.0], [39.5, -6.5], [39.0, -6.5], [39.0, -7.0]]]]}))
        row["admin0Geometry"]["outlineParts"][0]["sha256"] = digest(geometry_file.read_bytes())
        (data / "inventory.json").write_text(json.dumps({"sourceFiles": [], "countries": [row]}))
        pinned = lambda path, expected: json.loads(Path(path).read_text()) if digest(Path(path).read_bytes()) == expected else (_ for _ in ()).throw(ValueError("pin mismatch"))
        acquire = lambda identifier, centre: (b"<osm/>", {"url": "fixture", "sha256": digest(b"<osm/>")})
        road_points = [[39.2, -6.8], [39.2, -6.77]]
        convert = lambda raw, centre: ([{"id": "osm:way:1", "ring": [[39.19, -6.81], [39.21, -6.81], [39.21, -6.79], [39.19, -6.81]], "heightM": 5, "heightKind": "estimated"}], [{"id": "osm:way:2", "name": "Road", "major": False, "points": road_points}], {"buildings": 1, "roads": 1})
        arguments = ["build-africa-starters.py", "--country", "TZ", "--acquire"]
        with patch.multiple(GEN, ROOT=root, DATA=data, OUTPUT=output, RECEIPTS=data / "receipts", pinned=pinned, acquire=acquire, convert=convert):
            with patch.object(sys, "argv", arguments), redirect_stdout(io.StringIO()):
                GEN.main()
            receipt_path = data / "receipts/dar.json"
            first = json.loads(receipt_path.read_text())
            self.assertEqual(first["generationIdentity"], {"cityId": "dar", "stateId": "tz-zone", "stateName": "Starter"})
            facts_source = (output / "dar/facts.ts").read_text()
            facts_raw = facts_source.split("export const FACTS = ", 1)[1].split(" satisfies DestinationFacts", 1)[0]
            facts = json.loads(facts_raw)
            self.assertEqual(facts["bounds"][3], -6.77)
            geometry_source = (output / "dar/geometry.ts").read_text()
            geometry_raw = geometry_source.split("export const GEOMETRY: DestinationGeometry = ", 1)[1].rstrip()
            geometry = json.loads(geometry_raw)
            self.assertEqual(geometry["roads"][0]["points"], road_points, "the source way remains complete, not clipped")
            self.assertEqual(max(point[1] for polygon in geometry["land"] for ring in polygon for point in ring), facts["bounds"][3],
                             "country land is clipped to the final geometry-derived bounds")
            with patch.object(sys, "argv", arguments), redirect_stdout(io.StringIO()):
                GEN.main()
            self.assertEqual(json.loads(receipt_path.read_text()), first)

    def test_retained_sample_extent_includes_complete_features_and_refuses_outliers(self):
        initial = [10.0, 20.0, 10.1, 20.1]
        building = {"ring": [[10.02, 20.02], [10.03, 20.02], [10.03, 20.03], [10.02, 20.02]]}
        road = {"points": [[10.05, 20.05], [10.05, 20.115]]}
        self.assertEqual(GEN.retained_sample_bounds(initial, [building], [road]), [10.0, 20.0, 10.1, 20.115])
        self.assertEqual(initial, [10.0, 20.0, 10.1, 20.1], "the input box is not mutated")
        with self.assertRaisesRegex(ValueError, "bounded starter extent"):
            GEN.retained_sample_bounds(initial, [], [{"points": [[10.05, 20.121]]}])
        with self.assertRaisesRegex(ValueError, "invalid WGS84"):
            GEN.retained_sample_bounds(initial, [], [{"points": [[10.05, float("nan")]]}])


class MoroniQueryRevisionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.centre = [43.240244, -11.704158]
        self.original = self.root / ".cache/world-build/playable-africa/moroni"
        self.revision = self.root / ".cache/world-build/playable-africa-revisions/moroni" / GEN.MORONI_QUERY_REVISION
        self.original.mkdir(parents=True)
        self.original_url_bounds = [round(self.centre[0]-.003, 6), round(self.centre[1]-.003, 6),
                                    round(self.centre[0]+.003, 6), round(self.centre[1]+.003, 6)]
        self.original_url = "https://api.openstreetmap.org/api/0.6/map?bbox=" + ",".join(map(str, self.original_url_bounds))
        raw = b"<osm version='0.6'></osm>"
        self.original.joinpath("source.osm").write_bytes(raw)
        self.original.joinpath("source.json").write_text(json.dumps({"url": self.original_url, "bounds": self.original_url_bounds,
                                                                       "bytes": len(raw), "sha256": digest(raw)}))
        self.original.joinpath("requests.json").write_text(json.dumps([{"url": self.original_url,
                                                                          "reservedBytes": GEN.MAX_DOWNLOAD,
                                                                          "status": "complete", "receivedBytes": len(raw),
                                                                          "sha256": digest(raw)}]))
        self.patch = patch.object(GEN, "ROOT", self.root)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()

    def test_revision_uses_same_point_wider_fixed_bbox_and_one_remaining_lifetime_attempt(self):
        before = {path.name: path.read_bytes() for path in self.original.iterdir()}
        cached, malformed, exhausted, url, bounds = GEN.moroni_revision_state(self.centre)
        self.assertEqual(bounds, [43.228244, -11.716158, 43.252244, -11.692158])
        self.assertEqual(url, "https://api.openstreetmap.org/api/0.6/map?bbox=43.228244,-11.716158,43.252244,-11.692158")
        self.assertEqual((cached, malformed, exhausted), (False, False, False))
        self.assertEqual({path.name: path.read_bytes() for path in self.original.iterdir()}, before,
                         "planning is read-only against the prior Moroni cache and request ledger")

    def test_mocked_revision_acquisition_debits_separate_ledger_without_touching_original(self):
        before = {path.name: path.read_bytes() for path in self.original.iterdir()}
        payload = b"<osm version='0.6'></osm>"

        class Response:
            def __init__(self):
                self.sent = False

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def read(self, _size):
                if self.sent:
                    return b""
                self.sent = True
                return payload

        with patch.object(GEN.urllib.request, "urlopen", return_value=Response()) as open_url:
            raw, receipt = GEN.acquire_moroni_revision(self.centre)
        self.assertEqual(raw, payload)
        self.assertEqual(receipt["queryRevision"], GEN.MORONI_QUERY_REVISION)
        open_url.assert_called_once()
        self.assertEqual(open_url.call_args.kwargs["timeout"], 30)
        self.assertEqual({path.name: path.read_bytes() for path in self.original.iterdir()}, before)
        revision_ledger = json.loads((self.revision / "requests.json").read_text())
        self.assertEqual(len(revision_ledger), 1)
        self.assertEqual(revision_ledger[0]["reservedBytes"], GEN.MAX_DOWNLOAD)
        self.assertEqual(revision_ledger[0]["status"], "complete")
        self.assertEqual(GEN.moroni_revision_state(self.centre)[:3], (True, False, True))

    def test_revision_cache_requires_completed_unique_request_and_exact_source_identity(self):
        self.revision.mkdir(parents=True)
        raw = b"<osm version='0.6'></osm>"
        url, bounds = GEN.moroni_revision_query(self.centre)
        receipt = {"url": url, "bounds": bounds, "bytes": len(raw), "sha256": digest(raw),
                   "queryRevision": GEN.MORONI_QUERY_REVISION}
        self.revision.joinpath("source.osm").write_bytes(raw)
        self.revision.joinpath("source.json").write_text(json.dumps(receipt))
        self.revision.joinpath("requests.json").write_text(json.dumps([{"url": url, "reservedBytes": GEN.MAX_DOWNLOAD,
                                                                           "status": "complete", "receivedBytes": len(raw), "sha256": digest(raw)}]))
        self.assertEqual(GEN.moroni_revision_state(self.centre)[:3], (True, False, True))
        receipt["bounds"] = [0, 0, 1, 1]
        self.revision.joinpath("source.json").write_text(json.dumps(receipt))
        with self.assertRaisesRegex(ValueError, "does not match the pinned query"):
            GEN.moroni_revision_state(self.centre)

    def test_combined_attempt_cap_malformed_ledger_and_symlink_cache_refuse(self):
        self.revision.mkdir(parents=True)
        url, _ = GEN.moroni_revision_query(self.centre)
        self.revision.joinpath("requests.json").write_text(json.dumps([{"url": url, "reservedBytes": GEN.MAX_DOWNLOAD,
                                                                           "status": "started"}]))
        self.assertEqual(GEN.moroni_revision_state(self.centre)[:3], (False, False, True))
        self.revision.joinpath("requests.json").write_text("{}")
        with self.assertRaisesRegex(ValueError, "must be a list"):
            GEN.moroni_revision_state(self.centre)
        self.revision.joinpath("requests.json").unlink()
        self.revision.joinpath("source.osm").symlink_to(self.original / "source.osm")
        with self.assertRaises(ValueError):
            GEN.moroni_revision_state(self.centre)


if __name__ == "__main__":
    unittest.main()
