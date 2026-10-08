"""Isolated fixtures for the independent, read-only climate verifier."""

from __future__ import annotations

import calendar
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

SCRIPT = Path(__file__).with_name("verify_climate_attachment.py")
PIN_REL = Path("world/climate-attachment-pins.json")
OUTPUT_REL = Path(".cache/world-build/output/climate-packs")
NO_CLIMATE = "climate unavailable: no monthly regional climate source was provided"
PARAMETERS = ("T2M", "RH2M", "PRECTOTCORR", "WS10M")
UNITS = {"T2M": "C", "RH2M": "%", "PRECTOTCORR": "mm/day", "WS10M": "m/s"}


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def body(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8") + b"\n"


def write(root: Path, relative: str, raw: bytes) -> None:
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(raw)


def pin_file(root: Path, relative: str, raw: bytes) -> dict[str, Any]:
    write(root, relative, raw)
    return {"sha256": sha(raw), "bytes": len(raw), "path": relative}


def make_source(raw: bytes, request: dict[str, Any], url: str) -> dict[str, Any]:
    source_hash = sha(raw)
    return {
        "id": f"nasa-power-merra2-{source_hash[:16]}", "url": url,
        "release": "POWER v2.10.0 · MERRA-2 · 1991–2020",
        "license": "NASA Earthdata data-use policy; API response supplies no separate product license",
        "attribution": "NASA Langley Research Center POWER; meteorology from NASA GMAO MERRA-2",
        "sha256": source_hash, "bytes": len(raw), "provider": "NASA POWER", "apiVersion": "v2.10.0",
        "product": "monthly point", "sourceDatasets": ["MERRA2", "POWER"], "timeStandard": "LST", "fillValue": -999.0,
        "units": UNITS, "spatialResolution": {"latitudeDegrees": 0.5, "longitudeDegrees": 0.625},
        "requestedParameters": list(PARAMETERS), "monthlyRecordCount": 360, "annualRecordCount": 30,
    }


def make_fixture(root: Path, tile_source_id: str = "base-source") -> tuple[str, str, dict[str, Any]]:
    binding_id = "fixture-city"
    request = {
        "schemaVersion": 1, "id": binding_id, "regionId": "pilot:fixture-city", "name": "Synthetic City",
        "longitude": 2.2031, "latitude": 3.4037, "baseline": {"startYear": 1991, "endYear": 2020},
    }
    query = urlencode({"parameters": ",".join(PARAMETERS), "community": "SB", "longitude": "2.2031", "latitude": "3.4037", "start": "1991", "end": "2020", "format": "JSON"})
    url = f"https://power.larc.nasa.gov/api/temporal/monthly/point?{query}"
    records: dict[str, dict[str, Any]] = {}
    source_headers: dict[str, dict[str, str]] = {}
    names = {"T2M": "Temperature at 2 Meters", "RH2M": "Relative Humidity at 2 Meters", "PRECTOTCORR": "Precipitation Corrected", "WS10M": "Wind Speed at 10 Meters"}
    for param in PARAMETERS:
        values: dict[str, Any] = {}
        for year in range(1991, 2021):
            for month in range(1, 13):
                factor = (year - 1991) / 100
                if param == "T2M": value = 18 + month / 10 + factor
                elif param == "RH2M": value = 55 + month / 10 + factor
                elif param == "PRECTOTCORR": value = 0.7 + month / 100 + factor / 10
                else: value = 2 + month / 100 + factor / 100
                values[f"{year}{month:02d}"] = value
            values[f"{year}13"] = 1.0
        records[param] = values
        source_headers[param] = {"units": UNITS[param], "longname": names[param]}
    raw_doc = {
        "type": "Feature", "geometry": {"type": "Point", "coordinates": [2.203, 3.404, 28.0]},
        "properties": {"parameter": records},
        "header": {"title": "NASA/POWER Source Native Resolution Monthly and Annual", "api": {"version": "v2.10.0", "name": "POWER Monthly and Annual API"},
                   "sources": ["MERRA2", "POWER"], "fill_value": -999.0, "time_standard": "LST", "start": "19910101", "end": "20201231"},
        "messages": [], "parameters": source_headers, "times": {"data": 0.1, "process": 0.01},
    }
    raw = json.dumps(raw_doc, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")
    raw_hash = sha(raw)
    raw_path = ".cache/world-build/environment-source-cache/fixture-power.json"
    write(root, raw_path, raw)
    base_output = ".cache/world-build/campaigns/fixture-campaign/output"
    region = {"id": "synthetic-cell", "parentId": "country:test", "name": "Synthetic city cell", "kind": "cell", "countryCode": "GH",
              "timezone": "Africa/Accra", "bounds": [2.198, 3.402, 2.202, 3.406]}
    tile = {"schemaVersion": 1, "id": "test-tile", "regionId": region["id"], "bounds": region["bounds"],
            "anchor": {"longitude": 2.2, "latitude": 3.404, "height": 0},
            "buildings": [{"sourceId": tile_source_id}], "roads": [{"sourceId": tile_source_id}]}
    tile_body = body(tile)
    tile_hash = sha(tile_body)
    tile_ref = {"id": tile["id"], "path": f"tiles/{tile_hash}.json", "sha256": tile_hash, "bytes": len(tile_body),
                "brotliBytes": 10, "triangles": 0, "drawCalls": 0, "bounds": region["bounds"]}
    write(root, f"{base_output}/{tile_ref['path']}", tile_body)
    base = {"schemaVersion": 1, "compilerVersion": "fixture-compiler", "region": region, "frame": "wgs84-enu-m-v1",
            "verticalDatum": "WGS84-ellipsoid", "coverage": "foundation", "exceptions": [NO_CLIMATE, "Base geometry note remains"],
            "sources": [{"id": "base-source", "url": "https://example.test/base", "release": "fixture", "license": "test",
                         "attribution": "fixture", "sha256": "c" * 64, "bytes": 20}], "tiles": [tile_ref], "climate": None}
    base_body = body(base)
    base_hash = sha(base_body)
    base_path = f".cache/world-build/campaigns/fixture-campaign/output/manifests/{base_hash}.json"
    write(root, base_path, base_body)
    expected_region = region
    sample = {"longitude": 2.203, "latitude": 3.404}
    centre_offset = {"longitude": sample["longitude"] - 2.2, "latitude": 0.0}
    binding = {
        "schemaVersion": 1, "id": binding_id, "campaignId": "fixture-campaign",
        "baseManifest": {"sha256": base_hash, "bytes": len(base_body), "path": base_path},
        "expectedRegion": expected_region,
        "environmentManifest": {"sha256": "0" * 64, "bytes": 0, "path": ""},
        "environmentRequest": request,
        "rawSource": {"sha256": raw_hash, "bytes": len(raw), "path": raw_path, "url": url},
        "expectedSample": sample,
        "association": {"mode": "explicit-city-associated-native-grid-point", "sampleInsidePackBounds": False,
                        "centreOffsetDegrees": centre_offset, "maximumAbsoluteCentreOffsetDegrees": 0.01,
                        "disclosure": "Synthetic named-city association; not a cell average."},
    }
    monthly = []
    for month in range(1, 13):
        monthly.append({
            "temperatureC": sum(records["T2M"][f"{year}{month:02d}"] for year in range(1991, 2021)) / 30,
            "relativeHumidityPct": sum(records["RH2M"][f"{year}{month:02d}"] for year in range(1991, 2021)) / 30,
            "precipitationMm": sum(records["PRECTOTCORR"][f"{year}{month:02d}"] * calendar.monthrange(year, month)[1] for year in range(1991, 2021)) / 30,
            "windMps": sum(records["WS10M"][f"{year}{month:02d}"] for year in range(1991, 2021)) / 30,
        })
    env_source = make_source(raw, request, url)
    environment = {
        "schemaVersion": 1, "id": f"environment:pilot:{binding_id}:{raw_hash[:16]}",
        "region": {"id": request["regionId"], "name": request["name"]},
        "point": {"longitude": 2.203, "latitude": 3.404, "requestedLongitude": 2.2031, "requestedLatitude": 3.4037,
                  "semantics": "representative-point-selected-on-native-source-grid"},
        "baseline": {"startYear": 1991, "endYear": 2020, "years": 30},
        "profile": {"sourceId": env_source["id"], "period": "1991–2020 monthly normals", "months": monthly},
        "source": env_source,
        "derivation": {"algorithmVersion": "power-monthly-normal-v1", "temperature": "Arithmetic mean of the 30 provider monthly mean temperatures for the same calendar month, degrees Celsius.",
                       "humidity": "Arithmetic mean of the 30 direct provider RH2M monthly mean relative-humidity values; no derivation from temperature/dewpoint.",
                       "precipitation": "For each year and month, PRECTOTCORR monthly mean rate (mm/day) multiplied by the actual calendar days in that month; then arithmetic mean of the 30 resulting monthly totals (mm).",
                       "wind": "Arithmetic mean of the provider scalar WS10M monthly mean wind speeds at 10 m; not a vector-component-derived speed."},
        "exceptions": ["The requested coordinate is rounded to three decimal places by the NASA POWER service. The returned point is one native-grid sample, not a region-wide spatial average."],
    }
    env_body = body(environment)
    env_hash = sha(env_body)
    env_path = f".cache/world-build/output/environment/manifests/{env_hash}.json"
    write(root, env_path, env_body)
    binding["environmentManifest"] = {"sha256": env_hash, "bytes": len(env_body), "path": env_path}
    association = binding["association"]
    notes = [
        "Climate association: explicit Synthetic City (fixture-city) native-grid point association; this is not a measurement or spatial average of the pack cell.",
        f"Climate sample: requested (2.2031, 3.4037); returned (2.203, 3.404); sampleInsidePackBounds=false; centreOffsetDegrees=({centre_offset['longitude']}, 0); native spacing 0.5° latitude × 0.625° longitude.",
        "Climate baseline: 1991–2020 monthly normal, LST, not live weather; precipitation is monthly accumulation in millimetres derived from monthly mean mm/day rates, not rain intensity.",
    ]
    provenance = {
        "schemaVersion": 1, "product": "city-associated-monthly-climate-v1", "compiler": "climate-attachment-compiler-v1",
        "policy": "explicit-pinned-city-association-v1", "binding": binding, "environment": environment,
        "originalTiles": [tile_ref],
        "limitations": [
            f"{association['disclosure']} The returned point (2.203, 3.404) is outside the pack bounds; the requested point was (2.2031, 3.4037).",
            "The climate profile is a 1991–2020 monthly normal from a single native MERRA-2 grid sample, not current weather or a spatial average of the pack region.",
            "Precipitation is a monthly accumulation derived from the NASA POWER PRECTOTCORR monthly mean rate; it is not rain intensity.",
            "NASA POWER metadata does not provide a separate API product license; source attribution and the provider data-use notice are preserved.",
        ],
    }
    provenance_body = body(provenance)
    provenance_hash = sha(provenance_body)
    manifest = {**base, "sources": [*base["sources"], {k: env_source[k] for k in ("id", "url", "release", "license", "attribution", "sha256", "bytes")}],
                "climate": environment["profile"], "exceptions": ["Base geometry note remains", *notes, f"Climate attachment provenance sha256:{provenance_hash}"]}
    manifest_body = body(manifest)
    manifest_hash = sha(manifest_body)
    write(root, f"{OUTPUT_REL}/manifests/{manifest_hash}.json", manifest_body)
    write(root, f"{OUTPUT_REL}/provenance/{provenance_hash}.json", provenance_body)
    write(root, f"{OUTPUT_REL}/{tile_ref['path']}", tile_body)
    pin_doc = {"schemaVersion": 1, "policy": "explicit-pinned-city-association-v1", "bindings": [binding]}
    write(root, str(PIN_REL), body(pin_doc))
    return f"{OUTPUT_REL}/manifests/{manifest_hash}.json", manifest_hash, binding


class ClimateVerifierTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="climate-verify-")
        self.root = Path(self.temp.name).resolve()
        self.manifest_path, self.manifest_hash, self.binding = make_fixture(self.root)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def reset_fixture(self) -> None:
        self.temp.cleanup()
        self.setUp()

    def reset_fixture_with_unknown_tile_source(self) -> None:
        self.temp.cleanup()
        self.temp = tempfile.TemporaryDirectory(prefix="climate-verify-")
        self.root = Path(self.temp.name).resolve()
        self.manifest_path, self.manifest_hash, self.binding = make_fixture(self.root, "missing-source")

    def run_cli(self, manifest_hash: str | None = None) -> subprocess.CompletedProcess[str]:
        return subprocess.run([sys.executable, str(SCRIPT), "--repository-root", str(self.root), "--id", "fixture-city",
                               "--manifest", manifest_hash or self.manifest_hash], capture_output=True, text=True, check=False)

    def output_manifest(self) -> tuple[dict[str, Any], Path]:
        path = self.root / self.manifest_path
        return json.loads(path.read_text()), path

    def write_rehashed_manifest(self, value: dict[str, Any]) -> str:
        raw = body(value)
        new_hash = sha(raw)
        write(self.root, f"{OUTPUT_REL}/manifests/{new_hash}.json", raw)
        return new_hash

    def test_valid_source_reconstruction_and_outside_association_are_read_only(self) -> None:
        before = sorted((str(path.relative_to(self.root)), path.stat().st_size) for path in self.root.rglob("*") if path.is_file())
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        record = json.loads(result.stdout)
        self.assertEqual(record["status"], "verified")
        self.assertEqual(record["networkBytes"], 0)
        self.assertEqual(record["months"], 12)
        self.assertEqual(record["tiles"], 1)
        self.assertIn("sampleInsidePackBounds=false", self.output_manifest()[0]["exceptions"][2])
        after = sorted((str(path.relative_to(self.root)), path.stat().st_size) for path in self.root.rglob("*") if path.is_file())
        self.assertEqual(after, before)

    def test_wrong_month_is_rejected_even_when_manifest_is_rehashed(self) -> None:
        manifest, _ = self.output_manifest()
        manifest["climate"]["months"][0]["temperatureC"] += 1
        pins = json.loads((self.root / PIN_REL).read_text())
        binding = pins["bindings"][0]
        env_path = self.root / binding["environmentManifest"]["path"]
        environment = json.loads(env_path.read_text())
        environment["profile"]["months"][0]["temperatureC"] += 1
        environment_body = body(environment)
        environment_hash = sha(environment_body)
        environment_relative = f".cache/world-build/output/environment/manifests/{environment_hash}.json"
        write(self.root, environment_relative, environment_body)
        binding["environmentManifest"] = {"sha256": environment_hash, "bytes": len(environment_body), "path": environment_relative}
        write(self.root, str(PIN_REL), body(pins))
        provenance_path = manifest["exceptions"][-1].split(":", 1)[1]
        provenance_file = self.root / OUTPUT_REL / "provenance" / f"{provenance_path}.json"
        provenance = json.loads(provenance_file.read_text())
        provenance["binding"] = binding
        provenance["environment"] = environment
        provenance_body = body(provenance)
        provenance_hash = sha(provenance_body)
        write(self.root, f"{OUTPUT_REL}/provenance/{provenance_hash}.json", provenance_body)
        manifest["exceptions"][-1] = f"Climate attachment provenance sha256:{provenance_hash}"
        rehashed = self.write_rehashed_manifest(manifest)
        result = self.run_cli(rehashed)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("raw-source reconstruction", result.stderr)

    def test_rehashed_source_region_and_exception_tampering_are_rejected(self) -> None:
        original, _ = self.output_manifest()
        cases = []
        altered_source = json.loads(json.dumps(original)); altered_source["sources"][-1]["attribution"] = "different"
        cases.append(altered_source)
        altered_region = json.loads(json.dumps(original)); altered_region["region"]["name"] = "changed"
        cases.append(altered_region)
        omitted_note = json.loads(json.dumps(original)); omitted_note["exceptions"].remove("Base geometry note remains")
        cases.append(omitted_note)
        for value in cases:
            result = self.run_cli(self.write_rehashed_manifest(value))
            self.assertNotEqual(result.returncode, 0, result.stderr)

    def test_copied_tile_tampering_is_rejected(self) -> None:
        tile = self.output_manifest()[0]["tiles"][0]
        path = self.root / OUTPUT_REL / tile["path"]
        path.write_bytes(path.read_bytes() + b" ")
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("byte-identical", result.stderr)

    def test_duplicate_pin_keys_and_unsafe_symlink_inputs_fail_closed(self) -> None:
        write(self.root, str(PIN_REL), b'{"schemaVersion":1,"schemaVersion":1}')
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("repeats object key", result.stderr)
        self.reset_fixture()
        raw = self.binding["rawSource"]["path"]
        raw_path = self.root / raw
        raw_path.unlink()
        raw_path.symlink_to(self.root / "outside")
        (self.root / "outside").write_bytes(b"unsafe")
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("symlink", result.stderr)

    def test_offset_boundary_region_and_missing_tile_source_are_rejected(self) -> None:
        pins_path = self.root / PIN_REL
        pins = json.loads(pins_path.read_text())
        binding = pins["bindings"][0]
        binding["expectedRegion"]["bounds"] = [-0.002, -0.002, 0.002, 0.002]
        binding["expectedSample"] = {"longitude": 0.01, "latitude": 0}
        binding["association"]["centreOffsetDegrees"]["longitude"] = 0.01
        binding["association"]["centreOffsetDegrees"]["latitude"] = 0
        binding["association"]["sampleInsidePackBounds"] = False
        write(self.root, str(PIN_REL), body(pins))
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("association guard", result.stderr)

        self.reset_fixture()
        pins = json.loads((self.root / PIN_REL).read_text())
        pins["bindings"][0]["expectedRegion"]["bounds"] = [2.2, 3.406, 2.204, 3.402]
        write(self.root, str(PIN_REL), body(pins))
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("bounds are outside WGS84", result.stderr)

        self.reset_fixture_with_unknown_tile_source()
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unknown source", result.stderr)

    def test_rehashed_contradictory_climate_disclosure_is_rejected(self) -> None:
        manifest, _ = self.output_manifest()
        sample_index = next(index for index, item in enumerate(manifest["exceptions"]) if item.startswith("Climate sample:"))
        manifest["exceptions"][sample_index] = manifest["exceptions"][sample_index].replace("sampleInsidePackBounds=false", "sampleInsidePackBounds=true")
        result = self.run_cli(self.write_rehashed_manifest(manifest))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("disclosure", result.stderr)

    def test_truncated_raw_and_output_tree_entry_cap_are_rejected(self) -> None:
        raw_path = self.root / self.binding["rawSource"]["path"]
        raw_path.write_bytes(raw_path.read_bytes()[:20])
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("raw POWER source", result.stderr)
        self.reset_fixture()
        extra = self.root / OUTPUT_REL / "unreferenced"
        extra.mkdir()
        for index in range(1025):
            (extra / f"{index}.txt").touch()
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("entry cap", result.stderr)
        self.reset_fixture()
        oversized = self.root / OUTPUT_REL / "unreferenced-large.bin"
        with oversized.open("wb") as handle:
            handle.truncate(24 * 1024 * 1024 + 1)
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("byte cap", result.stderr)


if __name__ == "__main__":
    unittest.main()
