#!/usr/bin/env python3
"""Small offline structural check for the generated authored outfit payload."""
import json
import struct
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"


class ClothingBakeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.glb = (OUT / "male_casualsuit01.glb").read_bytes()
        cls.metadata = json.loads((OUT / "body-hide-map.json").read_text())
        magic, version, length = struct.unpack_from("<III", cls.glb)
        if magic != 0x46546C67 or version != 2 or length != len(cls.glb):
            raise AssertionError("invalid GLB v2 header/length")
        json_length, json_type = struct.unpack_from("<II", cls.glb, 12)
        if json_type != 0x4E4F534A:
            raise AssertionError("first GLB chunk is not JSON")
        cls.document = json.loads(cls.glb[20:20 + json_length].decode("utf-8"))
        binary_header = 20 + json_length
        binary_length, binary_type = struct.unpack_from("<II", cls.glb, binary_header)
        if binary_type != 0x004E4942 or binary_header + 8 + binary_length != len(cls.glb):
            raise AssertionError("invalid GLB binary chunk")
        cls.binary = cls.glb[binary_header + 8:binary_header + 8 + binary_length]

    def test_authored_mesh_and_morph_contract(self):
        primitive = self.document["meshes"][0]["primitives"][0]
        self.assertEqual(self.metadata["garmentAuthoredVertexCount"], 8426)
        self.assertEqual(self.metadata["garmentTriangleCount"], 16672)
        self.assertIn("POSITION", primitive["attributes"])
        self.assertIn("TEXCOORD_0", primitive["attributes"])
        self.assertIn("JOINTS_0", primitive["attributes"])
        self.assertIn("WEIGHTS_0", primitive["attributes"])
        self.assertIn("_MH_SOURCE_VERTEX", primitive["attributes"])
        self.assertIn("_MH_ANCHOR_VERTICES", primitive["attributes"])
        self.assertIn("_MH_ANCHOR_BARYCENTRICS", primitive["attributes"])
        self.assertEqual(len(primitive["targets"]), 2)
        self.assertEqual(self.document["meshes"][0]["extras"]["targetNames"], ["bodyFeminine", "bodyMasculine"])

    def test_source_weights_and_hide_indices_are_proven(self):
        self.assertEqual(self.metadata["anchors"]["rows"], 8426)
        self.assertEqual(self.metadata["anchors"]["uniqueSourceIds"], 2284)
        self.assertTrue(self.metadata["anchors"]["helperTightsOnly"])
        self.assertFalse(self.metadata["anchors"]["nearestNeighborFallback"])
        self.assertEqual(self.metadata["weights"]["bones"], 52)
        self.assertEqual(self.metadata["weights"]["unweightedAnchorCount"], 0)
        self.assertTrue(self.metadata["weights"]["allNormalized"])
        self.assertEqual(self.metadata["removedBodyTriangles"], len(self.metadata["bodyHideSourceTriangleIds"]))
        self.assertEqual(self.metadata["removedBodyTriangles"], 2 * self.metadata["removedBodyFaces"])
        self.assertEqual(self.metadata["removedBodyTriangles"], 6728)
        self.assertTrue(all(0 <= i < self.metadata["bodySourceTriangleCount"] for i in self.metadata["bodyHideSourceTriangleIds"]))

    def test_source_fit_and_download_budget(self):
        fit = self.metadata["maleFitErrorSourceUnits"]
        self.assertLess(fit["mean"], 0.2)
        self.assertLess(fit["p95"], 0.28)
        self.assertLess(fit["max"], 0.4)
        self.assertLess(self.glb.__len__(), 1_500_000)
        self.assertEqual(self.metadata["renderAcceptance"], "not performed; this is source-space/export evidence only")

    def test_accessor_bounds_and_normalized_skin_weights(self):
        for accessor in self.document["accessors"]:
            view = self.document["bufferViews"][accessor["bufferView"]]
            sizes = {5123: 2, 5125: 4, 5126: 4}
            components = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
            byte_count = accessor["count"] * sizes[accessor["componentType"]] * components[accessor["type"]]
            self.assertLessEqual(accessor.get("byteOffset", 0) + byte_count, view["byteLength"])
            self.assertLessEqual(view["byteOffset"] + view["byteLength"], len(self.binary))
        primitive = self.document["meshes"][0]["primitives"][0]
        weight_acc = self.document["accessors"][primitive["attributes"]["WEIGHTS_0"]]
        weight_view = self.document["bufferViews"][weight_acc["bufferView"]]
        start = weight_view["byteOffset"] + weight_acc.get("byteOffset", 0)
        values = struct.unpack_from("<" + "f" * (weight_acc["count"] * 4), self.binary, start)
        self.assertGreaterEqual(min(values), 0.0)
        self.assertLessEqual(max(values), 1.0)
        for i in range(weight_acc["count"]):
            self.assertAlmostEqual(sum(values[i * 4:i * 4 + 4]), 1.0, places=6)
        self.assertGreater(self.metadata["weights"]["negativeBarycentricBlendLanesClampedToZero"], 0)
        self.assertIn("highest barycentric coefficient", self.metadata["weights"]["fallbackRule"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
