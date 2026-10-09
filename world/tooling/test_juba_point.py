#!/usr/bin/env python3
"""Synthetic contract tests for the separately versioned Juba point packet."""
from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/world/build-juba-point.py"
juba = type(sys)("build_juba_point")
juba.__file__ = str(SCRIPT)
exec(compile(SCRIPT.read_bytes(), str(SCRIPT), "exec"), juba.__dict__)


class PointGeometryTests(unittest.TestCase):
    def setUp(self):
        self.polygon = [
            [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
            [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]],
        ]

    def test_point_inside_outer_ring_and_outside_hole(self):
        accepted, details = juba.point_in_polygon((2, 2), self.polygon)
        self.assertTrue(accepted)
        self.assertEqual(details, "inside_outer_outside_holes")

    def test_hole_interior_and_hole_boundary_are_rejected(self):
        self.assertEqual(juba.point_in_polygon((5, 5), self.polygon), (False, "inside_hole"))
        self.assertEqual(juba.point_in_polygon((3, 5), self.polygon), (False, "on_hole_boundary"))

    def test_outside_and_outer_boundary_are_rejected(self):
        self.assertEqual(juba.point_in_polygon((12, 5), self.polygon), (False, "outside_outer_ring"))
        self.assertEqual(juba.point_in_polygon((0, 5), self.polygon), (False, "point_on_outer_boundary"))

    def test_invalid_self_intersecting_ring_fails_topology_validation(self):
        bow_tie = [[[0, 0], [10, 10], [0, 10], [10, 0], [0, 0]]]
        with self.assertRaisesRegex(juba.PacketError, "self-intersects"):
            juba.validate_polygon(bow_tie)

    def test_hole_outside_exterior_fails_topology_validation(self):
        invalid = [self.polygon[0], [[12, 12], [13, 12], [13, 13], [12, 13], [12, 12]]]
        with self.assertRaisesRegex(juba.PacketError, "hole is not strictly inside"):
            juba.validate_polygon(invalid)

    def test_country_topology_work_is_bounded_before_quadratic_validation(self):
        oversized_ring = [[float(index % 170), float(index % 80)] for index in range(juba.MAX_COUNTRY_POSITIONS + 1)]
        with self.assertRaisesRegex(juba.PacketError, "topology limit"):
            juba.validate_country_geometry({"type": "Polygon", "coordinates": [oversized_ring]})

    def test_nonfinite_or_out_of_range_points_are_refused(self):
        for point in ([float("nan"), 1], [float("inf"), 1], [181, 0], [0, -91]):
            with self.subTest(point=point), self.assertRaises(juba.PacketError):
                juba.finite_wgs84_point(point)


class SourceIdentityTests(unittest.TestCase):
    def setUp(self):
        self.country = {"properties": {
            "NE_ID": juba.COUNTRY_NE_ID, "ADMIN": "South Sudan", "TYPE": "Sovereign country",
            "ISO_A2": "SS", "ISO_A2_EH": "SS", "ADM0_A3": "SDS", "SOV_A3": "SDS",
            "ISO_A3": "SSD", "ADM0_ISO": "SSD",
        }}
        self.place = {"properties": {
            "NE_ID": juba.PLACE_NE_ID, "NAME": "Juba", "ISO_A2": "SS",
            "ADM0_A3": "SSD", "SOV_A3": "SSD", "FEATURECLA": "Admin-0 capital", "ADM0CAP": 0,
        }}
        self.inventory = {"countryId": juba.COUNTRY_ID, "chosenCity": {"naturalEarthPlaceId": juba.PLACE_ID}}

    def test_exact_iso_join_accepts_and_preserves_a3_mismatch(self):
        evidence = juba.validate_feature_identity(self.country, self.place, self.inventory)
        self.assertTrue(evidence["iso2JoinAccepted"])
        self.assertTrue(evidence["threeLetterCodeDiscrepancyRetained"])
        self.assertTrue(evidence["noThreeLetterAliasApplied"])
        self.assertEqual(evidence["countryAdm0A3"], "SDS")
        self.assertEqual(evidence["placeAdm0A3"], "SSD")

    def test_wrong_place_iso_is_refused(self):
        self.place["properties"]["ISO_A2"] = "SD"
        with self.assertRaisesRegex(juba.PacketError, "exact ISO_A2 SS"):
            juba.validate_feature_identity(self.country, self.place, self.inventory)

    def test_wrong_country_iso_alpha2eh_is_refused(self):
        self.country["properties"]["ISO_A2_EH"] = "SD"
        with self.assertRaisesRegex(juba.PacketError, "ISO_A2 and ISO_A2_EH"):
            juba.validate_feature_identity(self.country, self.place, self.inventory)


class PinnedSourceTests(unittest.TestCase):
    def test_size_hash_and_intake_limit_are_enforced(self):
        content = b"pinned"
        digest = hashlib.sha256(content).hexdigest()
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "tiny.geojson"
            path.write_bytes(content)
            data, pin = juba.read_pinned_source(path, len(content), digest, max_bytes=32)
            self.assertEqual(data, content)
            self.assertEqual(pin["sha256"], digest)
            with self.assertRaisesRegex(juba.PacketError, "size mismatch"):
                juba.read_pinned_source(path, len(content) + 1, digest, max_bytes=32)
            with self.assertRaisesRegex(juba.PacketError, "SHA256 mismatch"):
                juba.read_pinned_source(path, len(content), "0" * 64, max_bytes=32)
            with self.assertRaisesRegex(juba.PacketError, "intake bound"):
                juba.read_pinned_source(path, len(content), digest, max_bytes=5)

    def test_source_symlinks_are_refused(self):
        content = b"pinned"
        digest = hashlib.sha256(content).hexdigest()
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "target.geojson"
            link = Path(temp) / "source.geojson"
            target.write_bytes(content)
            link.symlink_to(target)
            with self.assertRaisesRegex(juba.PacketError, "open source|regular non-symlink"):
                juba.read_pinned_source(link, len(content), digest, max_bytes=32)

    def test_source_fifos_are_refused_without_blocking(self):
        with tempfile.TemporaryDirectory() as temp:
            fifo = Path(temp) / "source.geojson"
            try:
                os.mkfifo(fifo)
            except (AttributeError, NotImplementedError, OSError) as error:
                self.skipTest(f"FIFO unavailable: {error}")
            with self.assertRaisesRegex(juba.PacketError, "regular file"):
                juba.read_regular_file_bounded(fifo, 32, "source")


class DeterministicOutputTests(unittest.TestCase):
    def test_serialization_is_deterministic(self):
        first = {"z": "Juba", "a": [31.580026, 4.829975]}
        second = {"a": [31.580026, 4.829975], "z": "Juba"}
        expected = b'{\n  "a": [\n    31.580026,\n    4.829975\n  ],\n  "z": "Juba"\n}\n'
        self.assertEqual(juba.json_bytes(first), expected)
        self.assertEqual(juba.json_bytes(second), expected)
        self.assertEqual(json.loads(expected), first)

    def test_normal_mode_is_idempotent_and_refuses_divergence_before_writing(self):
        with tempfile.TemporaryDirectory() as temp:
            first = Path(temp) / "point.geojson"
            second = Path(temp) / "selection.json"
            data = b'{"type":"FeatureCollection"}\n'
            juba.expected_outputs({first: data, second: b"{}\n"})
            timestamp = first.stat().st_mtime_ns
            juba.expected_outputs({first: data, second: b"{}\n"})
            self.assertEqual(first.stat().st_mtime_ns, timestamp)

            first.write_bytes(b"divergent")
            second.unlink()
            with self.assertRaisesRegex(juba.PacketError, "refusing to overwrite divergent"):
                juba.expected_outputs({first: data, second: b"{}\n"})
            self.assertFalse(second.exists(), "preflight must happen before either output is written")
            self.assertEqual(first.read_bytes(), b"divergent")

    def test_check_mode_never_writes_and_detects_missing_outputs(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "point.geojson"
            with self.assertRaisesRegex(juba.PacketError, "--check found missing"):
                juba.expected_outputs({path: b"point"}, check_only=True)
            self.assertFalse(path.exists())
            path.write_bytes(b"point")
            timestamp = path.stat().st_mtime_ns
            juba.expected_outputs({path: b"point"}, check_only=True)
            self.assertEqual(path.stat().st_mtime_ns, timestamp)

    def test_output_symlink_is_refused_without_touching_target(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "target"
            link = Path(temp) / "point.geojson"
            target.write_bytes(b"target")
            link.symlink_to(target)
            with self.assertRaisesRegex(juba.PacketError, "non-regular or symbolic-link"):
                juba.expected_outputs({link: b"point"})
            self.assertEqual(target.read_bytes(), b"target")


if __name__ == "__main__":
    unittest.main()
