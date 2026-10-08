from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
PYTHON = ROOT / ".cache" / "world-build" / "tooling" / "venv" / "bin" / "python"
SCRIPT = ROOT / "world" / "tooling" / "admin1_topology.py"
EXTENSION = ROOT / ".cache" / "world-build" / "tooling" / "extensions" / "v1.5.6" / "osx_arm64" / "spatial.duckdb_extension"
CRS84 = "urn:ogc:def:crs:OGC:1.3:CRS84"


def polygon(points: list[list[Any]], holes: list[list[list[Any]]] | None = None) -> dict[str, Any]:
    return {"type": "Polygon", "coordinates": [points, *(holes or [])]}


def rectangle(west: float, south: float, east: float, north: float) -> dict[str, Any]:
    return polygon([[west, south], [east, south], [east, north], [west, north], [west, south]])


def feature(ne_id: int | str, geometry: dict[str, Any], adm0: str = "GHA") -> dict[str, Any]:
    return {"type": "Feature", "properties": {"ne_id": ne_id, "adm0_a3": adm0, "name": "kept"}, "geometry": geometry}


class Admin1TopologyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if not PYTHON.exists() or not EXTENSION.is_file():
            raise unittest.SkipTest("pinned private Python/DuckDB runtime or Spatial extension is unavailable")
        cls.temp = tempfile.TemporaryDirectory(prefix="admin1-topology-", dir=ROOT / "world" / "tooling")
        cls.root = Path(cls.temp.name).resolve()
        cls.build_root = cls.root / ".cache" / "world-build"
        cls.extension_root = cls.build_root / "tooling" / "extensions" / "v1.5.6" / "osx_arm64"
        cls.extension_root.mkdir(parents=True)
        # Use an isolated byte-for-byte copy of the pinned local extension.
        shutil.copyfile(EXTENSION, cls.extension_root / EXTENSION.name)
        cls.source_root = cls.build_root / "admin1-source-cache"
        cls.source_root.mkdir()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.temp.cleanup()

    def write_request(self, features: list[dict[str, Any]], *, raw: bytes | None = None,
                      crs: Any = "absent", request_name: str | None = None) -> tuple[dict[str, Any], bytes]:
        document: dict[str, Any] = {"type": "FeatureCollection", "features": features}
        if crs != "absent":
            document["crs"] = crs
        body = raw if raw is not None else json.dumps(document, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
        path_hash = request_name or hashlib.sha256(b"request\0" + body).hexdigest()
        path = self.source_root / f"{path_hash}.geojson"
        path.write_bytes(body)
        request = {"schemaVersion": 1, "input": str(path), "sourceSha256": hashlib.sha256(body).hexdigest(),
                   "sourceBytes": len(body), "expectedUnits": len(features), "extensionRoot": str(self.extension_root)}
        return request, body

    def invoke(self, request: dict[str, Any], expected_exit: int = 0) -> dict[str, Any] | None:
        result = subprocess.run([str(PYTHON), "-I", str(SCRIPT)], input=json.dumps(request, separators=(",", ":")).encode(),
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=40, check=False)
        self.assertLessEqual(len(result.stdout), 2 * 1024 * 1024)
        self.assertLessEqual(len(result.stderr), 16 * 1024)
        self.assertEqual(result.returncode, expected_exit, result.stderr.decode("utf-8", errors="replace"))
        if expected_exit == 1:
            self.assertEqual(result.stdout, b"")
            return None
        self.assertTrue(result.stdout.endswith(b"\n"))
        report = json.loads(result.stdout)
        self.assertEqual(report["validator"], "natural-earth-admin1-ogc-planar-v1")
        self.assertEqual(report["tooling"], {"duckdbVersion": "1.5.6", "spatialVersion": "04270fe",
                                            "spatialSha256": "e326286e0ff4651680bfa2918fb22990fed50cb7d27d79dd21143ac7e74b0da9"})
        self.assertEqual(len(report["rows"]), request["expectedUnits"])
        self.assertEqual(report["sourceSha256"], request["sourceSha256"])
        self.assertEqual(report["sourceBytes"], request["sourceBytes"])
        return report

    def test_more_than_32_units_are_complete_lexically_sorted_and_keep_source_ordinals(self) -> None:
        source_features = [feature(str(number), rectangle(number, 0, number + 0.5, 1)) for number in range(40, 0, -1)]
        request, _ = self.write_request(source_features, crs={"type": "name", "properties": {"name": CRS84}})
        report = self.invoke(request)
        assert report is not None
        self.assertEqual([row["sourceKey"] for row in report["rows"]], sorted(row["sourceKey"] for row in report["rows"]))
        row40 = next(row for row in report["rows"] if row["sourceKey"] == "NE_ID:40")
        self.assertEqual(row40["sourceOrdinal"], 0)
        self.assertTrue(all(row["status"] == "valid" for row in report["rows"]))

    def test_holes_dateline_and_higher_ordinates_are_valid_without_mutation(self) -> None:
        dateline = polygon([[179, 0, 5], [-179, 0, 6], [-179, 3, 7], [179, 3, 8], [179, 0, 5]],
                           [[[179.4, 1, 11], [-179.4, 1, 12], [-179.4, 2, 13], [179.4, 2, 14], [179.4, 1, 11]]])
        original = json.dumps(dateline, sort_keys=True)
        request, _ = self.write_request([feature(101, dateline)])
        report = self.invoke(request)
        assert report is not None
        self.assertEqual(report["rows"][0]["status"], "valid")
        self.assertEqual(json.dumps(dateline, sort_keys=True), original)

    def test_feature_above_fine_helper_limit_uses_new_100k_cap(self) -> None:
        steps = 10_001
        ring = [[i / steps, 0] for i in range(steps + 1)]
        ring.extend([[1, i / steps] for i in range(1, steps + 1)])
        ring.extend([[1 - i / steps, 1] for i in range(1, steps + 1)])
        ring.extend([[0, 1 - i / steps] for i in range(1, steps)])
        ring.append([0, 0])
        self.assertGreater(len(ring), 40_000)
        request, _ = self.write_request([feature(102, polygon(ring))])
        report = self.invoke(request)
        assert report is not None
        self.assertEqual(report["rows"][0]["status"], "valid")

    def test_self_intersection_outside_and_overlapping_holes_and_overlapping_parts_are_invalid(self) -> None:
        bowtie = polygon([[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]])
        outside_hole = polygon([[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
                               [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]])
        overlapping_holes = polygon([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [
            [[2, 2], [5, 2], [5, 5], [2, 5], [2, 2]], [[4, 4], [7, 4], [7, 7], [4, 7], [4, 4]],
        ])
        overlapping_parts = {"type": "MultiPolygon", "coordinates": [rectangle(0, 0, 2, 2)["coordinates"], rectangle(1, 1, 3, 3)["coordinates"]]}
        request, _ = self.write_request([feature(i + 1, geometry) for i, geometry in enumerate((bowtie, outside_hole, overlapping_holes, overlapping_parts))])
        report = self.invoke(request, expected_exit=2)
        assert report is not None
        self.assertTrue(all(row["status"] == "invalid" and row["valid"] is False for row in report["rows"]))

    def test_polar_and_ambiguous_longitude_images_are_unsupported(self) -> None:
        polar = polygon([[-90, 89], [0, 90], [90, 89], [-90, 89]])
        ambiguous = polygon([[0, 0], [180, 0], [180, 2], [0, 2], [0, 0]])
        global_span = polygon([[-170, 0], [0, 1], [170, 0], [-170, 0]])
        request, _ = self.write_request([feature(1, polar), feature(2, ambiguous), feature(3, global_span)])
        report = self.invoke(request, expected_exit=2)
        assert report is not None
        self.assertTrue(all(row["status"] == "unsupported" and row["valid"] is None and row["empty"] is None for row in report["rows"]))

    def test_nigeria_is_protected_before_geometry_predicates_and_alone_exits_successfully(self) -> None:
        malformed = {"type": "GeometryCollection", "geometries": []}
        request, _ = self.write_request([feature(1, malformed, "NGA")])
        report = self.invoke(request, expected_exit=0)
        assert report is not None
        self.assertEqual(report["rows"][0]["status"], "protected")
        self.assertEqual(report["rows"][0]["reason"], "protected-nigeria-no-topology")
        self.assertIsNone(report["rows"][0]["valid"])

    def test_hash_crs_duplicate_keys_and_count_mismatches_fail_closed(self) -> None:
        valid = feature(1, rectangle(0, 0, 1, 1))
        request, raw = self.write_request([valid])
        bad_hash = dict(request, sourceSha256="0" * 64)
        self.invoke(bad_hash, 1)
        self.invoke(dict(request, expectedUnits=2), 1)
        wrong_crs, _ = self.write_request([valid], crs={"type": "name", "properties": {"name": "EPSG:4326"}})
        self.invoke(wrong_crs, 1)
        duplicate_raw = b'{"type":"FeatureCollection","features":[],"features":[]}'
        duplicate, _ = self.write_request([], raw=duplicate_raw)
        self.invoke(duplicate, 1)
        changed_path = Path(request["input"])
        changed_path.write_bytes(raw + b" ")
        self.invoke(request, 1)
        self.invoke(dict(request, sourceBytes=64 * 1024 * 1024 + 1), 1)
        external = self.root / "external.geojson"
        external.write_bytes(raw)
        link = self.source_root / f"{'e' * 64}.geojson"
        link.symlink_to(external)
        linked_request = dict(request, input=str(link))
        self.invoke(linked_request, 1)

    def test_invalid_keys_feature_and_total_position_caps_and_cache_path_fail(self) -> None:
        request, _ = self.write_request([feature("01", rectangle(0, 0, 1, 1))])
        self.invoke(request, 1)
        duplicate, _ = self.write_request([feature(7, rectangle(0, 0, 1, 1)), feature("7", rectangle(2, 0, 3, 1))])
        self.invoke(duplicate, 1)
        ring = [[0, 0], [1, 0], [1, 1]]
        ring.extend([[0, 1] for _ in range(100_001 - len(ring) - 1)])
        ring.append([0, 0])
        too_many, _ = self.write_request([feature(10, polygon(ring))])
        self.invoke(too_many, 1)
        wrong_path = dict(request, input=str(self.root / "outside.geojson"))
        self.invoke(wrong_path, 1)
        extra = dict(request, extra=True)
        self.invoke(extra, 1)

    def test_integral_json_number_source_key_is_canonicalized_without_changing_ordinal(self) -> None:
        request, _ = self.write_request([feature(1.0, rectangle(0, 0, 1, 1))])
        report = self.invoke(request)
        assert report is not None
        self.assertEqual(report["rows"][0]["sourceKey"], "NE_ID:1")
        self.assertEqual(report["rows"][0]["sourceOrdinal"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
