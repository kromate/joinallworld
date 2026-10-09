#!/usr/bin/env python3
"""Offline GLB, LFS texture, and exact MHCLO anchor checks for hair exports."""
import hashlib
import json
import struct
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXPECTED = {
    "short02": {"vertices": 1755, "split": 2061, "triangles": 3344, "textureSha": "47fe33831a3929567c733356dd66243116e05df2ace1f884ddca0080b728229f", "textureBytes": 3553543, "support": 1755, "unmatched": 0},
    "afro01": {"vertices": 2196, "split": 2276, "triangles": 2192, "textureSha": "dc0db7dd8a13802f02303ca7e49844b219e09db134471b7061538a8af8f7c7fb", "textureBytes": 4817185, "support": 2182, "unmatched": 14},
}


def read_glb(path):
    data = path.read_bytes()
    magic, version, length = struct.unpack_from("<III", data, 0)
    if (magic, version, length) != (0x46546C67, 2, len(data)):
        raise AssertionError(f"invalid GLB header: {path.name}")
    json_len, json_type = struct.unpack_from("<II", data, 12)
    if json_type != 0x4E4F534A:
        raise AssertionError("GLB is missing JSON chunk")
    doc = json.loads(data[20:20 + json_len].decode("utf-8"))
    bin_header = 20 + json_len
    bin_len, bin_type = struct.unpack_from("<II", data, bin_header)
    if bin_type != 0x004E4942 or bin_header + 8 + bin_len != len(data):
        raise AssertionError("invalid GLB binary chunk")
    return doc, data[bin_header + 8:bin_header + 8 + bin_len]


class HairExportTest(unittest.TestCase):
    def test_assets_and_lfs_diffuse(self):
        for name, expected in EXPECTED.items():
            with self.subTest(asset=name):
                metadata = json.loads((HERE / f"{name}-metadata.json").read_text())
                doc, binary = read_glb(HERE / f"{name}.glb")
                attrs = doc["meshes"][0]["primitives"][0]["attributes"]
                self.assertEqual(metadata["garmentAuthoredVertexCount"], expected["vertices"])
                self.assertEqual(metadata["garmentSplitVertexCount"], expected["split"])
                self.assertEqual(metadata["garmentTriangleCount"], expected["triangles"])
                self.assertEqual(metadata["anchors"]["sourceGroup"], "body")
                self.assertTrue(metadata["anchors"]["allRowsInExpectedGroup"])
                self.assertEqual(metadata["anchors"]["mappingTriplesMatchingBodyQuadTriangleSupport"], expected["support"])
                self.assertEqual(len(metadata["anchors"]["nonmatchingBodyTriangleSupportRowIds"]), expected["unmatched"])
                self.assertEqual(metadata["bodyHideSourceTriangleIds"], [])
                self.assertEqual(metadata["weights"]["bones"], 52)
                self.assertEqual(metadata["weights"]["unweightedAnchorCount"], 0)
                for attr in ("JOINTS_0", "WEIGHTS_0", "_MH_SOURCE_VERTEX", "_MH_ANCHOR_VERTICES", "_MH_ANCHOR_BARYCENTRICS"):
                    self.assertIn(attr, attrs)
                self.assertEqual(doc["meshes"][0]["extras"]["targetNames"], ["bodyFeminine", "bodyMasculine"])
                self.assertEqual(doc["materials"][0]["alphaMode"], "BLEND")
                self.assertTrue(doc["materials"][0]["doubleSided"])
                image = doc["images"][0]
                view = doc["bufferViews"][image["bufferView"]]
                png = binary[view["byteOffset"]:view["byteOffset"] + view["byteLength"]]
                self.assertEqual(len(png), expected["textureBytes"])
                self.assertEqual(hashlib.sha256(png).hexdigest(), expected["textureSha"])
                self.assertEqual(metadata["material"]["pngWidthHeight"], [2048, 2048])
                self.assertEqual(metadata["material"]["pngColorType"], "RGBA")
                self.assertEqual(metadata["sourcePins"]["textureSha256"], expected["textureSha"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
