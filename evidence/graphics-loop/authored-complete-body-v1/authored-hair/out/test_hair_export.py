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


def accessor_values(document, binary, index, fmt, width):
    accessor = document["accessors"][index]
    view = document["bufferViews"][accessor["bufferView"]]
    offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    count = accessor["count"] * width
    return struct.unpack_from("<" + fmt * count, binary, offset)


def source_uvs_by_vertex(name):
    source = HERE.parent / "source" / f"{name}.obj"
    uvs, result = [], {}
    for line in source.read_text().splitlines():
        if line.startswith("vt "):
            fields = line.split()
            uvs.append((float(fields[1]), float(fields[2])))
        elif line.startswith("f "):
            for token in line.split()[1:]:
                fields = token.split("/")
                if len(fields) > 1 and fields[1]:
                    vertex, uv = int(fields[0]) - 1, int(fields[1]) - 1
                    result.setdefault(vertex, set()).add(uvs[uv])
    return result


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
                weight_accessor = doc["accessors"][attrs["WEIGHTS_0"]]
                weight_view = doc["bufferViews"][weight_accessor["bufferView"]]
                start = weight_view["byteOffset"] + weight_accessor.get("byteOffset", 0)
                weights = struct.unpack_from("<" + "f" * (weight_accessor["count"] * 4), binary, start)
                self.assertGreaterEqual(min(weights), 0.0)
                self.assertLessEqual(max(weights), 1.0)
                for vertex in range(weight_accessor["count"]):
                    self.assertAlmostEqual(sum(weights[vertex * 4:vertex * 4 + 4]), 1.0, places=6)
                self.assertEqual(doc["meshes"][0]["extras"]["targetNames"], ["bodyFeminine", "bodyMasculine"])
                self.assertEqual(doc["materials"][0]["alphaMode"], "BLEND")
                self.assertTrue(doc["materials"][0]["doubleSided"])
                self.assertEqual(doc["materials"][0]["pbrMetallicRoughness"]["baseColorFactor"], [1.0, 1.0, 1.0, 1.0])
                source_ids = accessor_values(doc, binary, attrs["_MH_SOURCE_VERTEX"], "I", 1)
                output_uvs = accessor_values(doc, binary, attrs["TEXCOORD_0"], "f", 2)
                source_uvs = source_uvs_by_vertex(name)
                for vertex, source_id in enumerate(source_ids):
                    u, v = output_uvs[vertex * 2:vertex * 2 + 2]
                    self.assertTrue(any(abs(u - source_u) < 1e-6 and abs(v - (1.0 - source_v)) < 1e-6
                                        for source_u, source_v in source_uvs[source_id]),
                                    f"{name} vertex {vertex} does not use flipped OBJ UV for source vertex {source_id}")
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
