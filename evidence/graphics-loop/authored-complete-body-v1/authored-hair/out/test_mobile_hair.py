#!/usr/bin/env python3
"""Prove mobile GLBs only replace a verified embedded RGBA texture."""
import hashlib
import io
import json
import runpy
import unittest
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
MOBILE = runpy.run_path(str(HERE / "mobile-hair.py"))
EXPECTED = {
    "short02": ("a2637b4d14055cbd537b9b0f6e46c695b4a5bdc99e7d779956d58218ffc626a0", 504432),
    "afro01": ("3d37f4a379c19b4d64a9c21bb08418858ede79317a477b34b3fdfb965fd11474", 659456),
}


class MobileHairTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = json.loads((HERE / "mobile-hair-report.json").read_text())
        cls.report_by_name = {item["asset"]: item for item in cls.report["assets"]}

    def test_texture_budget_and_alpha(self):
        for name, (expected_sha, expected_size) in EXPECTED.items():
            with self.subTest(asset=name):
                mobile_path = HERE / f"{name}-mobile.glb"
                data = mobile_path.read_bytes()
                self.assertEqual(len(data), expected_size)
                self.assertEqual(hashlib.sha256(data).hexdigest(), expected_sha)
                doc, binary, *_ = MOBILE["parse_glb"](data)
                self.assertEqual(doc["materials"][0]["alphaMode"], "BLEND")
                self.assertTrue(doc["materials"][0]["doubleSided"])
                self.assertEqual(doc["meshes"][0]["extras"]["targetNames"], ["bodyFeminine", "bodyMasculine"])
                image = doc["images"][0]
                view = doc["bufferViews"][image["bufferView"]]
                png = binary[view["byteOffset"]:view["byteOffset"] + view["byteLength"]]
                with Image.open(io.BytesIO(png)) as texture:
                    self.assertEqual(texture.mode, "RGBA")
                    self.assertEqual(texture.size, (512, 512))
                    alpha = texture.getchannel("A")
                    self.assertEqual(alpha.getextrema(), (0, 255))
                    histogram = alpha.histogram()
                    self.assertGreater(histogram[0], 0)
                    self.assertGreater(sum(histogram[1:255]), 0)
                    self.assertGreater(histogram[255], 0)
                report = self.report_by_name[name]
                self.assertLess(report["mobileTextureBytes"], 500_000)
                attempts = {tuple(entry["resolution"]): entry["pngBytes"] for entry in report["textureAttempts"]}
                self.assertGreater(attempts[(1024, 1024)], 500_000)
                self.assertLessEqual(attempts[(512, 512)], 500_000)
                self.assertEqual(report["textureResolution"], [512, 512])
                self.assertTrue(report["nonImageGeometryBytesIdentical"])
                self.assertTrue(report["meshAccessorDeclarationsIdentical"])
                original_doc, original_binary, *_ = MOBILE["parse_glb"]((HERE / f"{name}.glb").read_bytes())
                old_view = original_doc["bufferViews"][original_doc["images"][0]["bufferView"]]
                new_view = doc["bufferViews"][doc["images"][0]["bufferView"]]
                old_prefix = original_binary[:old_view["byteOffset"]]
                new_prefix = binary[:new_view["byteOffset"]]
                self.assertEqual(old_prefix, new_prefix)
                self.assertEqual(original_doc["accessors"], doc["accessors"])
                self.assertEqual(original_doc["meshes"], doc["meshes"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
