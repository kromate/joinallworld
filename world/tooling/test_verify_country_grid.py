from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import verify_country_grid as audit


def canon(value: Any) -> bytes:
    return (audit.canonical(value) + "\n").encode("utf-8")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def put_asset(directory_root: Path, category: str, value: Any) -> dict[str, Any]:
    body = audit.canonical(value).encode("utf-8")
    digest = sha(body)
    path = f"{category}/{digest}.json"
    target = directory_root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(body)
    return {"path": path, "sha256": digest, "bytes": len(body)}


def build_fixture(root: Path, geometry: dict[str, Any] | None = None) -> tuple[str, str, dict[str, Any]]:
    if geometry is None:
        geometry = {"type": "Polygon", "coordinates": [[[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9], [0.1, 0.1]]]}
    directory_root = root / "output" / "country-inventory"
    source = {"id": "natural-earth-10m", "url": "https://example.test/pinned.geojson", "release": "fixture-release",
              "license": "test-only", "attribution": "synthetic fixture", "sha256": "a" * 64, "bytes": 1234}
    country = {"id": "country:natural-earth:NE_ID%3A1", "parentId": "continent:fixture", "name": "Fixture",
               "kind": "country", "countryCode": "ZZ", "bounds": [0.1, 0.1, 0.9, 0.9],
               "sourceFeatureIds": ["natural-earth-10m:NE_ID:1"], "provider": "world", "outline": "available", "exceptions": []}
    parts_value = {"type": "MultiPolygon", "coordinates": [geometry["coordinates"]]}
    positions = sum(len(ring) for ring in geometry["coordinates"])
    part_pin = put_asset(directory_root, "outlines", parts_value)
    part_pin.update({"polygonOffset": 0, "polygonCount": 1, "coordinatePositions": positions})
    outline_index = {"schemaVersion": 1, "countryId": country["id"], "sourceRef": country["sourceFeatureIds"][0],
                     "geometryType": geometry["type"], "polygonCount": 1, "coordinatePositions": positions,
                     "totalPartBytes": part_pin["bytes"], "parts": [{"path": part_pin["path"], "polygonOffset": 0,
                     "polygonCount": 1, "bytes": part_pin["bytes"], "coordinatePositions": positions}]}
    outline_pin = put_asset(directory_root, "outline-index", outline_index)
    node_index = {"schemaVersion": 1, "node": country, "outlineIndexPath": outline_pin["path"], "children": []}
    node_pin = put_asset(directory_root, "nodes", node_index)
    nigeria = {"id": "legacy-ng", "parentId": "continent:fixture", "name": "Nigeria", "kind": "country", "countryCode": "NG",
               "bounds": None, "sourceFeatureIds": ["natural-earth-10m:NE_ID:2"], "provider": "legacy-ng", "outline": "missing", "exceptions": []}
    nigeria_pin = put_asset(directory_root, "nodes", {"schemaVersion": 1, "node": nigeria, "outlineIndexPath": None, "children": []})
    continent = {"id": "continent:fixture", "parentId": "world:earth", "name": "Fixture Region", "kind": "continent", "countryCode": None,
                 "bounds": None, "sourceFeatureIds": [], "provider": "world", "outline": "missing", "exceptions": []}
    continent_pin = put_asset(directory_root, "nodes", {"schemaVersion": 1, "node": continent, "outlineIndexPath": None,
                                "children": [{"id": country["id"], "name": country["name"], "path": node_pin["path"]},
                                             {"id": nigeria["id"], "name": nigeria["name"], "path": nigeria_pin["path"]}]})
    world_node = {"id": "world:earth", "parentId": None, "name": "World", "kind": "world", "countryCode": None,
                  "bounds": None, "sourceFeatureIds": [], "provider": "world", "outline": "missing", "exceptions": []}
    world_pin = put_asset(directory_root, "nodes", {"schemaVersion": 1, "node": world_node, "outlineIndexPath": None,
                            "children": [{"id": continent["id"], "name": continent["name"], "path": continent_pin["path"]}]})
    identity = {"schemaVersion": 1, "baselineSourceId": "baseline-fixture", "candidateSourceId": source["id"], "baselineUnits": 2,
                "candidateUnits": 2, "retained": [], "added": [{"featureKey": "NE_ID:1", "countryId": country["id"], "name": "Fixture"},
                                                                  {"featureKey": "NE_ID:2", "countryId": "legacy-ng", "name": "Nigeria"}],
                "missing": [], "protectedCountryId": "legacy-ng", "exceptions": []}
    identity_pin = put_asset(directory_root, "identity", identity)
    manifest = {"schemaVersion": 1, "compiler": "country-directory-compiler-v1", "source": source,
                "baselineSource": source, "baselineInventoryHash": "b" * 64, "sourceUnitCount": 2,
                "nodeCount": 4, "outlineCount": 1, "partCount": 1, "rootNodePath": world_pin["path"],
                "identityPath": identity_pin["path"], "rollups": [{"id": continent["id"], "name": continent["name"], "countryCount": 2, "sourceUnitCount": 2, "exceptionCount": 0}],
                "representation": "whole-polygon-groups", "limits": {"partBytes": 512000, "countryBytes": 2097152, "positions": 100000}, "exceptions": []}
    manifest_pin = put_asset(directory_root, "manifests", manifest)
    pins = {"manifest": manifest_pin, "node": node_pin, "outlineIndex": outline_pin, "parts": [
        {key: part_pin[key] for key in ("path", "sha256", "bytes")} ]}
    request = {"schemaVersion": 1, "id": "fixture", "directoryManifestHash": manifest_pin["sha256"],
               "countryId": country["id"], "level": 0,
               "limits": {"positions": 100000, "bboxCells": 300000, "cells": 100000, "operations": 100000000, "outputBytes": 16000000}}
    # Hand-authored for the 0.1..0.9 square: it touches only level-0 cell x180/y90.
    position_count = sum(len(ring) for ring in geometry["coordinates"])
    cells = [{"id": "geo-grid-v1:l0:x180:y90", "level": 0, "column": 180, "row": 90,
              "bounds": [0.0, 0.0, 1.0, 1.0], "polygonIndices": [0], "state": "not-started"}]
    candidates = 1
    plan = {"schemaVersion": 1, "compilerVersion": "country-source-cut-grid-v1", "requestHash": audit.digest(audit.canonical(request)),
            "request": request, "country": country, "source": source, "boundaryPins": pins,
            "geographicCoverage": "source-bound-grid-denominator", "geometryCoverage": "not-acquired",
            "selection": "inclusive-planar-source-cut-polygon-cell-contact", "ownership": "global-half-open-grid-seam-pole-v1",
            "grid": {"level": 0, "stepDegrees": 1, "columns": 360, "rows": 180}, "cells": cells,
            "counts": {"polygons": 1, "positions": position_count, "bboxCandidates": candidates,
                       "selectedCells": len(cells), "operations": 0}, "limitations": ["synthetic fixture"]}
    return save_plan(root, plan)


def save_plan(root: Path, plan: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
    body = canon(plan)
    plan_hash = sha(body)
    rel = f"country-grids/fixture/plans/{plan_hash}.json"
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    receipt = {"schemaVersion": 1, "requestHash": plan["requestHash"], "planHash": plan_hash,
               "planPath": f"plans/{plan_hash}.json", "bytes": len(body)}
    completion = root / "country-grids" / "fixture" / "completions" / f"{plan['requestHash']}.json"
    completion.parent.mkdir(parents=True, exist_ok=True)
    completion.write_bytes(canon(receipt))
    return rel, plan_hash, plan


class CountryGridAuditTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.rel, self.plan_hash, self.plan = build_fixture(self.root)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_valid_plan_rederives_source_cells_and_completion(self) -> None:
        receipt = audit.verify(self.root, self.rel, self.plan_hash)
        self.assertTrue(receipt["verified"])
        self.assertEqual(receipt["polygons"], 1)
        self.assertEqual(receipt["positions"], 5)
        self.assertEqual(receipt["selectedCells"], 1)
        self.assertEqual(receipt["networkBytes"], 0)

    def test_rehashed_missing_cell_is_rejected(self) -> None:
        self.plan["cells"] = []
        rel, digest_value, _ = save_plan(self.root, self.plan)
        with self.assertRaisesRegex(audit.VerifyError, "counts|cells"):
            audit.verify(self.root, rel, digest_value)

    def test_rehashed_changed_bounds_are_rejected(self) -> None:
        self.plan["cells"][0]["bounds"][0] = -1
        rel, digest_value, _ = save_plan(self.root, self.plan)
        with self.assertRaisesRegex(audit.VerifyError, "cells"):
            audit.verify(self.root, rel, digest_value)

    def test_hole_only_cell_is_not_reported_as_contact(self) -> None:
        geometry = {"type": "Polygon", "coordinates": [
            [[0.0, 0.0], [4.0, 0.0], [4.0, 4.0], [0.0, 4.0], [0.0, 0.0]],
            [[0.2, 0.2], [1.8, 0.2], [1.8, 1.8], [0.2, 1.8], [0.2, 0.2]],
        ]}
        _, polygons, _ = audit.geometry_polygons(geometry)
        cells, _, _ = audit.derive(polygons, 2)
        self.assertNotIn((721, 361), {(cell["column"], cell["row"]) for cell in cells})

    def test_source_cut_seam_adds_only_contacting_opposite_edge_cell(self) -> None:
        geometry = {"type": "Polygon", "coordinates": [[
            [179.5, 0.1], [180.0, 0.1], [180.0, 0.9], [179.5, 0.9], [179.5, 0.1],
        ]]}
        _, polygons, _ = audit.geometry_polygons(geometry)
        cells, candidates, _ = audit.derive(polygons, 0)
        keys = {(cell["column"], cell["row"]) for cell in cells}
        self.assertIn((359, 90), keys)
        self.assertIn((0, 90), keys)
        self.assertGreaterEqual(candidates, len(keys))

    def test_single_seam_vertex_on_dyadic_latitude_edge_contacts_both_rows(self) -> None:
        geometry = {"type": "Polygon", "coordinates": [[
            [180.0, 0.5], [179.5, 1.0], [179.0, 0.5], [179.5, 0.0], [180.0, 0.5],
        ]]}
        _, polygons, _ = audit.geometry_polygons(geometry)
        cells, _, _ = audit.derive(polygons, 1)
        keys = {(cell["column"], cell["row"]) for cell in cells}
        self.assertIn((0, 180), keys)
        self.assertIn((0, 181), keys)

    def test_arbitrary_seam_crossing_is_fail_closed(self) -> None:
        geometry = {"type": "Polygon", "coordinates": [[
            [170, 0], [-170, 0], [-170, 1], [170, 1], [170, 0],
        ]]}
        with self.assertRaisesRegex(audit.VerifyError, "seam crossing"):
            audit.geometry_polygons(geometry)

    def test_latitude_index_matches_full_ring_predicates_on_tricky_fixtures(self) -> None:
        fixtures = [
            {"type": "Polygon", "coordinates": [
                [[0.0, 0.0], [1.25, 0.0], [0.75, 1.25], [0.5, 0.5], [0.0, 1.25], [0.0, 0.0]],
                [[0.25, 0.25], [0.5, 0.25], [0.5, 0.5], [0.25, 0.5], [0.25, 0.25]],
            ]},
            {"type": "Polygon", "coordinates": [[
                [180.0, 0.5], [179.5, 1.0], [179.0, 0.5], [179.5, 0.0], [180.0, 0.5],
            ]]},
            {"type": "Polygon", "coordinates": [[
                [-3.0, -2.0], [2.0, -2.0], [2.0, 2.0], [-3.0, 2.0], [-3.0, -2.0],
            ]]},
        ]
        scale = 4
        for geometry in fixtures:
            _, polygons, _ = audit.geometry_polygons(geometry)
            for polygon in polygons:
                cells = set(audit.candidate_ids(polygon, 2))
                columns = [column for column, _ in cells]
                rows = {row for _, row in cells}
                min_column, max_column = max(0, min(columns) - 1), min(360 * scale - 1, max(columns) + 1)
                # Include neighbors whose closed edge can touch a source boundary.
                for row in list(rows):
                    if row > 0: rows.add(row - 1)
                    if row < 180 * scale - 1: rows.add(row + 1)
                test_cells = {(column, row) for column in range(min_column, max_column + 1) for row in rows}
                segment_rows = audit.build_row_segments(polygon, test_cells, scale)
                for column in range(min_column, max_column + 1):
                    for row in rows:
                        rect = audit.cell_rect(column, row, scale)
                        north = audit.row_crossings(segment_rows[0], segment_rows[1][row], rect[3], len(polygon))
                        south = audit.row_crossings(segment_rows[0], segment_rows[1][row], rect[1], len(polygon))
                        self.assertEqual(audit.polygon_hits_rect(polygon, rect),
                                         audit.indexed_polygon_hits_rect(segment_rows[0], segment_rows[2].get((column, row), []), south, north, rect, len(polygon)),
                                         (geometry["type"], column, row))

    def test_protected_nigeria_node_is_rejected(self) -> None:
        directory = self.root / "output" / "country-inventory"
        pins = self.plan["boundaryPins"]
        node_path = directory / pins["node"]["path"]
        node_index = audit.parse(node_path.read_bytes(), "node")
        node_index["node"]["id"] = "legacy-ng"
        node_index["node"]["countryCode"] = "NG"
        node_index["node"]["provider"] = "legacy-ng"
        new_pin = put_asset(directory, "nodes", node_index)
        self.plan["boundaryPins"]["node"] = new_pin
        rel, digest_value, _ = save_plan(self.root, self.plan)
        with self.assertRaisesRegex(audit.VerifyError, "protected|mismatched|linked"):
            audit.verify(self.root, rel, digest_value)

    def test_bad_completion_binding_is_rejected(self) -> None:
        path = self.root / "country-grids" / "fixture" / "completions" / f"{self.plan['requestHash']}.json"
        receipt = audit.parse(path.read_bytes(), "completion")
        receipt["planHash"] = "0" * 64
        path.write_bytes(canon(receipt))
        with self.assertRaisesRegex(audit.VerifyError, "completion"):
            audit.verify(self.root, self.rel, self.plan_hash)

    def test_symlinked_plan_path_is_refused(self) -> None:
        target = self.root / self.rel
        link = target.parent / ("e" * 64 + ".json")
        link.symlink_to(target)
        with self.assertRaisesRegex(audit.VerifyError, "symlink"):
            audit.verify(self.root, str(link.relative_to(self.root)), "e" * 64)


if __name__ == "__main__":
    unittest.main()
