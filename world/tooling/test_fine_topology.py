from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "world" / "tooling" / "fine_topology.py"
PYTHON = ROOT / ".cache" / "world-build" / "tooling" / "venv" / "bin" / "python"
EXTENSION = ROOT / ".cache" / "world-build" / "tooling" / "extensions" / "v1.5.6" / "osx_arm64" / "spatial.duckdb_extension"
CRS84 = "urn:ogc:def:crs:OGC:1.3:CRS84"


def poly(points: list[list[float]], holes: list[list[list[float]]] | None = None) -> dict[str, Any]:
    return {"type": "Polygon", "coordinates": [points, *(holes or [])]}


def rectangle(west: float, south: float, east: float, north: float) -> dict[str, Any]:
    return poly([[west, south], [east, south], [east, north], [west, north], [west, south]])


class FineTopologyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if not PYTHON.exists() or not EXTENSION.is_file():
            raise unittest.SkipTest("private DuckDB 1.5.6 runtime or pinned Spatial extension is unavailable")
        cls.temp = tempfile.TemporaryDirectory(prefix="fine-topology-", dir=ROOT / "world" / "tooling")
        cls.root = Path(cls.temp.name).resolve()
        cls.build_root = cls.root / ".cache" / "world-build"
        cls.extension_root = cls.build_root / "tooling" / "extensions" / "v1.5.6" / "osx_arm64"
        cls.extension_root.mkdir(parents=True)
        # Copy (never modify) the reviewed local extension into an isolated, canonical-layout fixture.
        shutil.copyfile(EXTENSION, cls.extension_root / EXTENSION.name)
        cls.source_root = cls.build_root / "fine-source-cache"
        cls.source_root.mkdir()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.temp.cleanup()

    def request(self, features: list[dict[str, Any]], *, expected: int | None = None, crs: Any = None) -> tuple[dict[str, Any], bytes]:
        document: dict[str, Any] = {"type": "FeatureCollection", "features": features}
        if crs is not None:
            document["crs"] = crs
        raw = json.dumps(document, separators=(",", ":"), allow_nan=False).encode()
        digest = hashlib.sha256(raw).hexdigest()
        source = self.source_root / f"{digest}.geojson"
        source.write_bytes(raw)
        return ({"schemaVersion": 1, "input": str(source), "sourceSha256": digest, "sourceBytes": len(raw),
                 "expectedUnits": len(features) if expected is None else expected,
                 "extensionRoot": str(self.extension_root)}, raw)

    def feature(self, key: str, geometry: dict[str, Any], group: str = "RWA", shape_type: str = "ADM1") -> dict[str, Any]:
        return {"type": "Feature", "properties": {"shapeID": key, "shapeName": key, "shapeGroup": group, "shapeType": shape_type}, "geometry": geometry}

    def invoke(self, request: dict[str, Any], *, expected_exit: int) -> dict[str, Any] | None:
        completed = subprocess.run([str(PYTHON), "-I", str(SCRIPT)], input=json.dumps(request).encode(),
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20, check=False)
        self.assertLessEqual(len(completed.stdout), 64 * 1024)
        self.assertLessEqual(len(completed.stderr), 2048)
        self.assertEqual(completed.returncode, expected_exit, completed.stderr.decode(errors="replace"))
        if expected_exit == 1:
            self.assertEqual(completed.stdout, b"")
            return None
        report = json.loads(completed.stdout)
        self.assertEqual(report["tooling"], {"duckdbVersion": "1.5.6", "spatialVersion": "04270fe",
                                            "spatialSha256": "e326286e0ff4651680bfa2918fb22990fed50cb7d27d79dd21143ac7e74b0da9"})
        self.assertEqual(report["checkedUnits"], report["validUnits"] + report["invalidUnits"])
        self.assertEqual(report["expectedUnits"], report["checkedUnits"] + report["unsupportedUnits"])
        return report

    def run_geometry(self, geometry: dict[str, Any], *, expected_status: str, exit_code: int) -> dict[str, Any]:
        request, _ = self.request([self.feature("RWA-ADM1-test", geometry)])
        report = self.invoke(request, expected_exit=exit_code)
        assert report is not None
        self.assertEqual(report["rows"][0]["status"], expected_status)
        self.assertEqual(report["sourceSha256"], request["sourceSha256"])
        self.assertEqual(report["sourceBytes"], request["sourceBytes"])
        return report

    def test_simple_and_dateline_polygons_with_holes_are_planar_valid(self) -> None:
        simple = self.run_geometry(rectangle(29, -2, 30, -1), expected_status="valid", exit_code=0)
        self.assertEqual((simple["validUnits"], simple["invalidUnits"], simple["unsupportedUnits"]), (1, 0, 0))
        explicit_crs, _ = self.request([self.feature("exact-crs84", rectangle(29, -2, 30, -1))],
                                       crs={"type": "name", "properties": {"name": CRS84}})
        self.assertEqual(self.invoke(explicit_crs, expected_exit=0)["validUnits"], 1)
        dateline = poly(
            [[179, 0], [-179, 0], [-179, 3], [179, 3], [179, 0]],
            [[[179.4, 1], [-179.4, 1], [-179.4, 2], [179.4, 2], [179.4, 1]]],
        )
        report = self.run_geometry(dateline, expected_status="valid", exit_code=0)
        self.assertIn("2D longitude/latitude", report["exceptions"][0])

    def test_self_crossing_hole_outside_and_overlapping_multipolygon_are_invalid(self) -> None:
        bowtie = poly([[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]])
        outside_hole = poly([[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
                            [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]])
        overlapping_holes = poly([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [
            [[2, 2], [5, 2], [5, 5], [2, 5], [2, 2]],
            [[4, 4], [7, 4], [7, 7], [4, 7], [4, 4]],
        ])
        overlap = {"type": "MultiPolygon", "coordinates": [rectangle(0, 0, 2, 2)["coordinates"], rectangle(1, 1, 3, 3)["coordinates"]]}
        for geometry in [bowtie, outside_hole, overlapping_holes, overlap]:
            report = self.run_geometry(geometry, expected_status="invalid", exit_code=2)
            self.assertEqual(report["invalidUnits"], 1)
            self.assertFalse(report["rows"][0]["valid"])

    def test_polar_and_ambiguous_global_images_are_unsupported_not_valid(self) -> None:
        polar = poly([[-90, 89], [0, 90], [90, 89], [-90, 89]])
        report = self.run_geometry(polar, expected_status="unsupported", exit_code=2)
        self.assertEqual(report["unsupportedUnits"], 1)
        self.assertEqual(report["checkedUnits"], 0)
        self.assertIsNone(report["rows"][0]["valid"])
        global_ring = poly([[-170, 0], [0, 1], [170, 0], [-170, 0]])
        report = self.run_geometry(global_ring, expected_status="unsupported", exit_code=2)
        self.assertEqual(report["unsupportedUnits"], 1)

    def test_multipolygon_parts_with_global_aggregate_span_are_unsupported(self) -> None:
        geometry = {"type": "MultiPolygon", "coordinates": [
            rectangle(-70, -5, 70, 5)["coordinates"], rectangle(160, -5, 180, 5)["coordinates"],
        ]}
        report = self.run_geometry(geometry, expected_status="unsupported", exit_code=2)
        self.assertEqual(report["checkedUnits"], 0)
        self.assertEqual(report["unsupportedUnits"], 1)

    def test_source_hash_count_crs_nigeria_and_shape_mismatches_fail_without_report(self) -> None:
        valid = rectangle(29, -2, 30, -1)
        cases: list[tuple[dict[str, Any], str]] = []
        initial_request, _ = self.request([self.feature("one", valid)])
        bad_hash = dict(initial_request, sourceSha256="0" * 64)
        cases.append((bad_hash, "hash"))
        cases.append((dict(initial_request, expectedUnits=2), "count"))
        cases.append((dict(initial_request, sourceBytes=8 * 1024 * 1024 + 1), "byte cap"))
        crs_request, _ = self.request([self.feature("crs", valid)], crs={"type": "name", "properties": {"name": "EPSG:4326"}})
        cases.append((crs_request, "CRS"))
        null_crs, _ = self.request([self.feature("null-crs", valid)])
        document = json.loads(Path(null_crs["input"]).read_bytes())
        document["crs"] = None
        raw_null = json.dumps(document, separators=(",", ":")).encode()
        null_hash = hashlib.sha256(raw_null).hexdigest()
        null_path = self.source_root / f"{null_hash}.geojson"
        null_path.write_bytes(raw_null)
        null_crs.update(input=str(null_path), sourceSha256=null_hash, sourceBytes=len(raw_null))
        cases.append((null_crs, "null CRS"))
        for key, group in [("ng", "NGA"), ("wrong-level", "RWA")]:
            feature = self.feature(key, valid, group=group, shape_type="ADM2" if key == "wrong-level" else "ADM1")
            req, _ = self.request([feature])
            cases.append((req, "NGA" if group == "NGA" else "ADM1"))
        for request, _label in cases:
            self.invoke(request, expected_exit=1)
        # Alter the cache payload after constructing its immutable path/hash pin.
        source_path = Path(initial_request["input"])
        source_path.write_bytes(source_path.read_bytes() + b" ")
        self.invoke(initial_request, expected_exit=1)

    def test_duplicate_key_feature_limit_and_total_position_limit_fail(self) -> None:
        duplicate, _ = self.request([self.feature("same", rectangle(0, 0, 1, 1)), self.feature("same", rectangle(2, 2, 3, 3))])
        self.invoke(duplicate, expected_exit=1)

        ring = [[0, 0], [1, 0], [1, 1]]
        ring.extend([[0, 1] for _ in range(40_001 - 1 - len(ring))])
        ring.append([0, 0])
        over_feature, _ = self.request([self.feature("too-many", poly(ring))])
        self.invoke(over_feature, expected_exit=1)

        ring_a = [[0, 0], [1, 0], [1, 1]]
        ring_a.extend([[0, 1] for _ in range(38_000 - 1 - len(ring_a))])
        ring_a.append([0, 0])
        features = [self.feature(f"global-{index}", poly([[point[0] + index * 2, point[1]] for point in ring_a])) for index in range(4)]
        over_total, _ = self.request(features)
        self.invoke(over_total, expected_exit=1)

    def test_request_limits_path_isolation_and_runtime_pins(self) -> None:
        request, _ = self.request([self.feature("valid", rectangle(0, 0, 1, 1))])
        for malformed_version in (True, 1.0, "1"):
            self.invoke(dict(request, schemaVersion=malformed_version), expected_exit=1)
        wrong_extension = dict(request, extensionRoot=str(self.build_root / "tooling" / "extensions" / "current"))
        self.invoke(wrong_extension, expected_exit=1)
        wrong_input = dict(request, input=str(self.root / "outside.geojson"))
        self.invoke(wrong_input, expected_exit=1)
        self.invoke({**request, "extra": True}, expected_exit=1)
        too_large_request = json.dumps(request).encode() * 1_000
        result = subprocess.run([str(PYTHON), "-I", str(SCRIPT)], input=too_large_request,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20, check=False)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, b"")


if __name__ == "__main__":
    unittest.main()
