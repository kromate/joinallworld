from __future__ import annotations

import hashlib
import io
import json
import tempfile
import urllib.error
import unittest
from pathlib import Path
from unittest.mock import patch

from world.tooling import terrain


class FakeResponse:
    status = 200
    reason = "OK"

    def __init__(self, body: bytes, declared: int | None = None):
        self.body = body
        self.offset = 0
        self.headers = {
            "Content-Length": str(len(body) if declared is None else declared),
            "Content-Type": "image/tiff",
            "ETag": '"etag-not-a-hash"',
            "Last-Modified": "Mon, 09 May 2022 12:44:58 GMT",
        }

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def geturl(self):
        return terrain.URL

    def read(self, length: int) -> bytes:
        value = self.body[self.offset:self.offset + length]
        self.offset += len(value)
        return value


class FakeOpener:
    def __init__(self, response):
        self.response = response

    def open(self, request, timeout):
        return self.response


def synthetic_point_tiff(path: Path) -> bytes:
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin

    step = 1 / 1200
    with rasterio.open(path, "w", driver="GTiff", width=1200, height=1200, count=1,
                       dtype="float32", crs="EPSG:4326", transform=from_origin(-1 - step / 2, 6 + step / 2, step, step),
                       nodata=-9999, compress="deflate", tiled=True, blockxsize=2048, blockysize=2048) as ds:
        ds.write(np.zeros((1200, 1200), dtype="float32"), 1)
        ds.update_tags(AREA_OR_POINT="Point")
    return path.read_bytes()


class TerrainAcquisitionTests(unittest.TestCase):
    def test_bounded_success_counts_exact_response_bytes(self):
        body = b"x" * terrain.EXPECTED_BYTES
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "terrain" / "attempts" / "test-run"
            root.mkdir(parents=True)
            (root / "attempts.jsonl").write_text("", encoding="utf-8")
            network = {"bytes": 0}
            with patch.object(terrain.urllib.request, "build_opener", return_value=FakeOpener(FakeResponse(body))):
                result, headers, partial = terrain.fetch_source(root, terrain.time.monotonic(), network)
            self.assertEqual(result, body)
            self.assertEqual(network["bytes"], terrain.EXPECTED_BYTES)
            self.assertEqual(headers["etag"], '"etag-not-a-hash"')
            self.assertEqual(partial.stat().st_size, terrain.EXPECTED_BYTES)

    def test_unexpected_length_is_rejected_before_read_and_audited(self):
        response = FakeResponse(b"ignored", declared=42)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "terrain" / "attempts" / "test-run"
            root.mkdir(parents=True)
            (root / "attempts.jsonl").write_text("", encoding="utf-8")
            with patch.object(terrain.urllib.request, "build_opener", return_value=FakeOpener(response)):
                with self.assertRaisesRegex(terrain.TerrainError, "length"):
                    terrain.fetch_source(root, terrain.time.monotonic(), {"bytes": 0})
            self.assertEqual(response.offset, 0)
            rows = [json.loads(line) for line in (root / "attempts.jsonl").read_text().splitlines()]
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["status"], "network-failure")
            self.assertIsNone(rows[0]["partialPath"])

    def test_failed_http_body_is_counted_and_preserved_without_claiming_failure_bytes(self):
        error = urllib.error.HTTPError(
            terrain.URL, 503, "Unavailable", {"Content-Length": "4", "Content-Type": "text/plain"}, io.BytesIO(b"oops"))
        class ErrorOpener:
            def open(self, request, timeout):
                raise error
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "terrain" / "attempts" / "test-run"
            root.mkdir(parents=True)
            (root / "attempts.jsonl").write_text("", encoding="utf-8")
            network = {"bytes": 0}
            with patch.object(terrain.urllib.request, "build_opener", return_value=ErrorOpener()):
                with self.assertRaisesRegex(terrain.TerrainError, "HTTP 503"):
                    terrain.fetch_source(root, terrain.time.monotonic(), network)
            self.assertEqual(network["bytes"], 4)
            rows = [json.loads(line) for line in (root / "attempts.jsonl").read_text().splitlines()]
            self.assertIsNone(rows[0]["networkBytesMeasured"])
            self.assertEqual(rows[0]["measuredNetworkBytesBeforeFailure"], 4)
            self.assertEqual(Path(rows[0]["partialPath"]).read_bytes(), b"oops")

    def test_build_root_and_output_paths_reject_symlinks(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            real = base / "real"
            real.mkdir()
            link = base / "linked"
            link.symlink_to(real, target_is_directory=True)
            with self.assertRaisesRegex(terrain.TerrainError, "symlink"):
                terrain.checked_root(str(link / "missing"))
            with self.assertRaisesRegex(terrain.TerrainError, "symlink"):
                terrain.ensure_dir(base, link / "child")

    @unittest.skipUnless(__import__("importlib").util.find_spec("rasterio") is not None,
                         "Rasterio pinned builder dependency is not installed")
    def test_raster_window_keeps_valid_zero_samples_and_mask_semantics(self):
        import numpy as np
        import rasterio

        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            tile = base / "synthetic.tif"
            step = 1 / 1200
            data = synthetic_point_tiff(tile)
            with rasterio.open(tile) as ds:
                self.assertEqual(tuple(float(v) for v in ds.xy(0, 0, offset="center")), (-1.0, 6.0))
                corner_x, corner_y = ds.transform * (0, 0)
                self.assertAlmostEqual(corner_x, -1 - step / 2)
                self.assertAlmostEqual(corner_y, 6 + step / 2)
            (base / "attempts").mkdir()
            sidecar, _ = terrain.build_sidecar(data, hashlib.sha256(data).hexdigest(), {"etag": None}, base / "attempts")
            sample = sidecar["values"]["samples"][0]
            self.assertEqual(sample["valueMeters"], 0.0)
            self.assertEqual(sample["state"], "data")
            self.assertEqual(sidecar["values"]["maskInvalidCount"], 0)
            self.assertEqual(sidecar["verticalReference"]["datum"], "EGM2008")
            self.assertEqual(sidecar["values"]["ellipsoidConversion"], "not-applied")
            self.assertTrue(all(-0.207 <= p["longitude"] <= -0.203 and 5.552 <= p["latitude"] <= 5.556
                                for p in sidecar["values"]["samples"]))

    @unittest.skipUnless(__import__("importlib").util.find_spec("rasterio") is not None,
                         "Rasterio pinned builder dependency is not installed")
    def test_cache_hit_recomputes_sidecar_and_corruption_is_preserved_without_network(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve() / "build"
            terrain_root = root / "terrain"
            attempts = terrain_root / "attempts"
            sources = terrain_root / "sources"
            sidecars = terrain_root / "sidecars"
            for directory in (attempts, sources, sidecars):
                directory.mkdir(parents=True, exist_ok=True)
            attempt_dir = attempts / "seed"
            attempt_dir.mkdir()
            data = synthetic_point_tiff(Path(temp) / "cache-source.tif")
            checksum = hashlib.sha256(data).hexdigest()
            headers = {"etag": "opaque", "lastModified": "metadata-only", "contentType": "image/tiff",
                       "contentLength": len(data)}
            sidecar, _ = terrain.build_sidecar(data, checksum, headers, attempt_dir)
            (attempt_dir / "source.tif").unlink()
            sidecar_raw = terrain.canonical(sidecar)
            sidecar_hash = hashlib.sha256(sidecar_raw).hexdigest()
            source_path = sources / f"{checksum}.tif"
            sidecar_path = sidecars / f"{sidecar_hash}.json"
            source_path.write_bytes(data)
            sidecar_path.write_bytes(sidecar_raw)
            index = {"requestHash": terrain.REQUEST_HASH, "tileId": terrain.TILE_ID, "sourceSha256": checksum, "sourceBytes": len(data),
                     "sidecarSha256": sidecar_hash, "sidecarBytes": len(sidecar_raw),
                     "sourcePath": source_path.name, "sidecarPath": sidecar_path.name,
                     "headers": headers, "derivation": sidecar["derivation"]}
            (terrain_root / "current.json").write_bytes(terrain.canonical(index))
            (attempts / "attempts.jsonl").write_text(terrain.canonical({
                "attemptId": "interrupted-old-run", "requestHash": terrain.REQUEST_HASH,
                "status": "started", "reservedUpperBoundBytes": terrain.MAX_NETWORK_BYTES,
            }).decode() + "\n", encoding="utf-8")
            with patch.object(terrain, "EXPECTED_BYTES", len(data)), \
                 patch.object(terrain.urllib.request, "build_opener", side_effect=AssertionError("cache hit must not network")):
                result = terrain.run(str(root))
                self.assertTrue(result["cacheHit"])
                self.assertEqual(result["networkBytes"], 0)
                sidecar_path.write_bytes(sidecar_raw[:-1] + b" ")
                with self.assertRaisesRegex(terrain.TerrainError, "sidecar cache checksum"):
                    terrain.run(str(root))
            self.assertTrue(source_path.exists())
            self.assertTrue(sidecar_path.exists())

    def test_failed_or_interrupted_reservation_blocks_fresh_network_but_cache_is_allowed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve() / "build"
            terrain_root = root / "terrain"
            attempts = terrain_root / "attempts"
            attempts.mkdir(parents=True)
            run_dir = attempts / "seed"
            run_dir.mkdir()
            # A start record with no terminal record represents interruption.
            audit = attempts / "attempts.jsonl"
            terrain.append_record(audit, {"attemptId": "interrupted", "requestHash": terrain.REQUEST_HASH,
                                          "status": "started", "reservedUpperBoundBytes": terrain.MAX_NETWORK_BYTES})
            with patch.object(terrain.urllib.request, "build_opener", side_effect=AssertionError("must not contact network")):
                with self.assertRaisesRegex(terrain.TerrainError, "cumulative pilot network cap"):
                    terrain.run(str(root))
            records = [json.loads(line) for line in audit.read_text().splitlines()]
            self.assertIn("not-admitted", [row["status"] for row in records])
            self.assertEqual(terrain.recorded_network_reservation(audit, terrain.REQUEST_HASH), terrain.MAX_NETWORK_BYTES)

    def test_failed_network_run_reserves_cap_and_prevents_second_adapter_call(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve() / "build"
            error = urllib.error.HTTPError(
                terrain.URL, 503, "Unavailable", {"Content-Length": "4", "Content-Type": "text/plain"}, io.BytesIO(b"oops"))
            class ErrorOpener:
                def open(self, request, timeout):
                    raise error
            with patch.object(terrain.shutil, "disk_usage", return_value=type("Usage", (), {"free": terrain.MIN_FREE_DISK_BYTES})()), \
                 patch.object(terrain.urllib.request, "build_opener", return_value=ErrorOpener()) as opener:
                with self.assertRaisesRegex(terrain.TerrainError, "HTTP 503"):
                    terrain.run(str(root))
                self.assertEqual(opener.call_count, 1)
                with self.assertRaisesRegex(terrain.TerrainError, "cumulative pilot network cap"):
                    terrain.run(str(root))
                self.assertEqual(opener.call_count, 1)
            audit = root / "terrain" / "attempts" / "attempts.jsonl"
            records = [json.loads(line) for line in audit.read_text().splitlines()]
            terminal = [row for row in records if row.get("status") == "failed"]
            self.assertEqual(len(terminal), 1)
            self.assertIsNone(terminal[0]["networkBytesMeasured"])
            self.assertEqual(terminal[0]["reservedUpperBoundBytes"], terrain.MAX_NETWORK_BYTES)


if __name__ == "__main__":
    unittest.main()
