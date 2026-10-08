"""Fault and conservation tests for the read-only fine pilot verifier."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any


SCRIPT = Path(__file__).with_name("verify_fine_pilot.py")
RELEASE = "a" * 40
PLANAR = (
    "OGC validity uses only 2D longitude/latitude in a plane; higher ordinates are ignored "
    "and this does not establish spherical validity on the ellipsoid."
)
SPATIAL = "e326286e0ff4651680bfa2918fb22990fed50cb7d27d79dd21143ac7e74b0da9"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")


def write_json(path: Path, value: Any, newline: bool = False) -> tuple[str, bytes]:
    body = canonical(value) + (b"\n" if newline else b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return sha(body), body


def write_asset(root: Path, folder: str, value: Any, newline: bool = False) -> str:
    body = canonical(value) + (b"\n" if newline else b"")
    digest = sha(body)
    (root / folder).mkdir(parents=True, exist_ok=True)
    (root / folder / f"{digest}.json").write_bytes(body)
    return f"{folder}/{digest}.json"


def fixture(root: Path) -> tuple[str, str]:
    repo = root
    code = "TC"
    iso3 = "TST"
    source_id = "stable-test-adm1"
    country_id = "country:test:NE_ID%3A1"
    release = RELEASE
    source_root = repo / ".cache/world-build/fine-source-cache"
    source_path_rel = ".cache/world-build/fine-source-cache/"

    geoms = [
        {"type": "Polygon", "coordinates": [
            [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
            [[1, 1], [1, 2], [2, 2], [2, 1], [1, 1]],
        ]},
        {"type": "MultiPolygon", "coordinates": [[[[5, 0], [6, 0], [6, 1], [5, 1], [5, 0]]]]},
    ]
    names = ["Alpha Region", "Beta Region"]
    keys = ["TST-ADM1-1", "TST-ADM1-2"]
    geojson = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"shapeID": key, "shapeName": name, "shapeGroup": iso3, "shapeType": "ADM1"}, "geometry": geom}
        for key, name, geom in zip(keys, names, geoms)
    ]}
    raw_source = json.dumps(geojson, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    source_hash = sha(raw_source)
    source_root.mkdir(parents=True, exist_ok=True)
    (source_root / f"{source_hash}.geojson").write_bytes(raw_source)

    source = {
        "id": source_id,
        "url": f"https://raw.githubusercontent.com/wmgeolab/geoBoundaries/{release}/releaseData/gbOpen/{iso3}/ADM1/geoBoundaries-{iso3}-ADM1.geojson",
        "release": release,
        "license": "CC-BY-4.0 fixture",
        "attribution": "Synthetic test fixture",
        "sha256": source_hash,
        "bytes": len(raw_source),
    }
    pin = {
        "schemaVersion": 1, "provider": "geoBoundaries", "source": source,
        "input": source_path_rel + source_hash + ".geojson", "countryCode": code, "countryIso3": iso3,
        "adminLevel": "ADM1", "layerId": "TST-ADM1-TEST", "canonicalType": "Region",
        "representedYear": "2020", "buildDate": "Dec 12, 2023", "expectedUnits": 2,
        "originalLicense": "CC BY 4.0", "licenseEvidence": ["https://example.test/license"],
        "metadataSha256": "b" * 64, "metadataBytes": 64, "boundaryPolicy": "Fixture source depiction policy.",
    }
    pin_path = repo / "world/test-fine-pin.json"
    write_json(pin_path, pin)

    directory_root = repo / ".cache/world-build/output/country-inventory"
    parent_source = {"id": "ne-test", "url": "https://example.test/ne", "release": "c" * 40, "license": "Public domain", "attribution": "Test", "sha256": "d" * 64, "bytes": 100}
    references = ["ne-test:NE_ID:1", "ne-test:NE_ID:2"]
    parent_nodes = [
        {"id": "world:earth", "parentId": None, "name": "World", "kind": "world", "countryCode": None, "bounds": None, "sourceFeatureIds": [], "provider": "world", "outline": "missing", "exceptions": []},
        {"id": "continent:test", "parentId": "world:earth", "name": "Test", "kind": "continent", "countryCode": None, "bounds": None, "sourceFeatureIds": [], "provider": "world", "outline": "missing", "exceptions": []},
        {"id": country_id, "parentId": "continent:test", "name": "Testland", "kind": "country", "countryCode": code, "bounds": None, "sourceFeatureIds": [references[0]], "provider": "world", "outline": "missing", "exceptions": []},
        {"id": "legacy-ng", "parentId": "continent:test", "name": "Nigeria", "kind": "country", "countryCode": "NG", "bounds": None, "sourceFeatureIds": [references[1]], "provider": "legacy-ng", "outline": "missing", "exceptions": []},
    ]
    by_id = {row["id"]: row for row in parent_nodes}
    children = {
        "world:earth": ["continent:test"],
        "continent:test": [country_id, "legacy-ng"],
        country_id: [], "legacy-ng": [],
    }
    child_paths: dict[str, str] = {}

    def publish_node(node_id: str) -> str:
        node = by_id[node_id]
        child_refs = []
        for child_id in children[node_id]:
            child_path = publish_node(child_id)
            child_refs.append({"id": child_id, "name": by_id[child_id]["name"], "path": child_path})
        index = {"schemaVersion": 1, "node": node, "outlineIndexPath": None, "children": child_refs}
        rel = write_asset(directory_root, "nodes", index)
        child_paths[node_id] = rel
        return rel

    publish_node("world:earth")

    identity = {
        "schemaVersion": 1, "baselineSourceId": "ne-test", "candidateSourceId": "ne-test",
        "baselineUnits": 2, "candidateUnits": 2, "retained": [], "missing": [], "protectedCountryId": "legacy-ng",
        "added": [
            {"featureKey": "NE_ID:1", "countryId": country_id, "candidateName": "Testland"},
            {"featureKey": "NE_ID:2", "countryId": "legacy-ng", "candidateName": "Nigeria"},
        ],
        "exceptions": [],
    }
    identity_rel = write_asset(directory_root, "identity", identity)
    dir_manifest = {
        "schemaVersion": 1, "compiler": "country-directory-compiler-v1", "source": parent_source, "baselineSource": parent_source,
        "baselineInventoryHash": "e" * 64, "sourceUnitCount": 2, "nodeCount": 4, "outlineCount": 0, "partCount": 0,
        "rootNodePath": child_paths["world:earth"], "identityPath": identity_rel, "rollups": [],
        "representation": "whole-polygon-groups", "limits": {"partBytes": 512000, "countryBytes": 2097152, "positions": 100000}, "exceptions": [],
    }
    dir_manifest_hash, _ = write_json(directory_root / "manifests" / ("0" * 64 + ".json"), dir_manifest)
    manifest_path = directory_root / "manifests" / ("0" * 64 + ".json")
    manifest_path.rename(directory_root / "manifests" / f"{dir_manifest_hash}.json")

    output = repo / ".cache/world-build/output/fine/tc/adm1"
    nodes: list[dict[str, Any]] = []
    outline_references: list[tuple[str, str]] = []
    position_total = 0
    feature_rows = []
    for key, name, geometry in zip(keys, names, geoms):
        node_id = "admin:geoBoundaries:" + hashlib.sha256(f"{country_id}\0ADM1\0geoBoundaries\0{key}".encode()).hexdigest()
        positions = sum(1 for point in geometry["coordinates"][0][0] if isinstance(point, list)) if geometry["type"] == "MultiPolygon" else sum(len(ring) for ring in geometry["coordinates"])
        if geometry["type"] == "MultiPolygon":
            positions = sum(len(ring) for polygon in geometry["coordinates"] for ring in polygon)
        position_total += positions
        longs = [point[0] for polygon in ([geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]) for ring in polygon for point in ring]
        lats = [point[1] for polygon in ([geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]) for ring in polygon for point in ring]
        node = {
            "id": node_id, "parentId": country_id, "countryCode": code, "name": name, "kind": "admin", "adminLevel": "ADM1",
            "adminType": "Region", "bounds": [min(longs), min(lats), max(longs), max(lats)], "aliases": [],
            "sourceRef": {"sourceId": source_id, "release": release, "layerId": pin["layerId"], "featureKey": key},
            "coverage": "geographic-outline", "exceptions": ["Boundary depiction follows source policy: Fixture source depiction policy."],
        }
        nodes.append(node)
        outline_path = write_asset(output, "outlines", geometry)
        outline_references.append((node_id, outline_path))
        feature_rows.append({"featureKey": key, "status": "valid", "valid": True, "empty": False, "reason": None})
    nodes.sort(key=lambda node: node["id"])
    outline_by_id = dict(outline_references)
    node_index_path = write_asset(output, "node-index", {"schemaVersion": 1, "countryId": country_id, "nodes": [{"node": n, "outlinePath": outline_by_id[n["id"]]} for n in nodes]})
    registry_path = write_asset(output, "registries", {
        "schemaVersion": 1, "provider": "geoBoundaries", "countryId": country_id, "adminLevel": "ADM1",
        "entries": [{"id": n["id"], "sourceFeatureKeys": [n["sourceRef"]["featureKey"]], "names": [n["name"]], "status": "active", "replacedBy": []} for n in nodes],
    })
    topology_path = write_asset(output, "topology", {
        "schemaVersion": 1, "validator": "duckdb-spatial-ogc-planar-v1", "sourceSha256": source_hash, "sourceBytes": len(raw_source),
        "expectedUnits": 2, "checkedUnits": 2, "validUnits": 2, "invalidUnits": 0, "unsupportedUnits": 0,
        "tooling": {"duckdbVersion": "1.5.6", "spatialVersion": "04270fe", "spatialSha256": SPATIAL},
        "rows": sorted(feature_rows, key=lambda row: row["featureKey"]), "exceptions": [PLANAR],
    }, newline=True)
    coverage_path = write_asset(output, "coverage", {
        "expectedUnits": 2, "sourceUnits": 2, "acceptedUnits": 2, "rejectedUnits": 0,
        "coordinatePositions": position_total, "exceptions": [PLANAR],
    })
    fine_manifest = {
        "schemaVersion": 2, "compiler": "fine-inventory-compiler-v2", "coarseInventoryHash": dir_manifest_hash,
        "countryId": country_id, "source": pin, "sourceUnitCount": 2, "nodeIndexPath": node_index_path,
        "registryPath": registry_path, "coveragePath": coverage_path, "topologyPath": topology_path, "exceptions": [PLANAR],
    }
    manifest_hash, _ = write_json(output / "manifests" / ("0" * 64 + ".json"), fine_manifest)
    (output / "manifests" / ("0" * 64 + ".json")).rename(output / "manifests" / f"{manifest_hash}.json")
    return f".cache/world-build/output/fine/tc/adm1/manifests/{manifest_hash}.json", "world/test-fine-pin.json"


class FinePilotVerifierTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="fine-pilot-verify-")
        self.root = Path(self.temp.name).resolve()
        self.manifest, self.pin = fixture(self.root)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def invoke(self, manifest: str | None = None) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--repository-root", str(self.root), "--manifest", manifest or self.manifest, "--pin", self.pin],
            text=True, capture_output=True, check=False,
        )

    def test_valid_full_source_conservation_including_hole_and_multipolygon(self) -> None:
        before = sorted(str(path.relative_to(self.root)) for path in self.root.rglob("*"))
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stdout)
        record = json.loads(result.stdout)
        self.assertEqual(record["status"], "verified")
        self.assertEqual(record["units"], 2)
        self.assertEqual(record["coordinatePositions"], 15)
        self.assertEqual(record["networkBytes"], 0)
        self.assertIn("parent outline geometry is outside", record["limitations"][-1])
        after = sorted(str(path.relative_to(self.root)) for path in self.root.rglob("*"))
        self.assertEqual(after, before, "verification must be read-only")

    def test_rejects_tampered_source_even_when_geometry_output_remains_valid(self) -> None:
        pin = json.loads((self.root / self.pin).read_text())
        source_path = self.root / pin["input"]
        source_path.write_bytes(source_path.read_bytes().replace(b"Alpha Region", b"Other Region"))
        result = self.invoke()
        self.assertEqual(result.returncode, 2)
        self.assertIn("SHA-256 mismatch", result.stdout)

    def test_rejects_outline_with_new_hash_if_it_is_not_exact_source_geometry(self) -> None:
        output = self.root / ".cache/world-build/output/fine/tc/adm1"
        manifest = json.loads((self.root / self.manifest).read_text())
        index_path = output / manifest["nodeIndexPath"]
        index = json.loads(index_path.read_text())
        outline_rel = index["nodes"][0]["outlinePath"]
        outline_path = output / outline_rel
        outline = json.loads(outline_path.read_text())
        outline["coordinates"][0][0][1][0] = 4.1
        new_rel = write_asset(output, "outlines", outline)
        index["nodes"][0]["outlinePath"] = new_rel
        new_index_rel = write_asset(output, "node-index", index)
        manifest["nodeIndexPath"] = new_index_rel
        mpath = self.root / self.manifest
        new_hash, _ = write_json(mpath.parent / ("f" * 64 + ".json"), manifest)
        (mpath.parent / ("f" * 64 + ".json")).rename(mpath.parent / f"{new_hash}.json")
        result = self.invoke(f".cache/world-build/output/fine/tc/adm1/manifests/{new_hash}.json")
        self.assertEqual(result.returncode, 2)
        self.assertIn("differs from pinned source", result.stdout)

    def test_rejects_count_corruption_and_unsafe_asset_path(self) -> None:
        output = self.root / ".cache/world-build/output/fine/tc/adm1"
        original = json.loads((self.root / self.manifest).read_text())
        for mutate, expected in (
            (lambda row: row.update(sourceUnitCount=1), "sourceUnitCount differs"),
            (lambda row: row.update(nodeIndexPath="../escape.json"), "hash-addressed node-index asset"),
        ):
            manifest = dict(original)
            mutate(manifest)
            temporary = output / "manifests" / ("e" * 64 + ".json")
            manifest_hash, _ = write_json(temporary, manifest)
            temporary.rename(temporary.parent / f"{manifest_hash}.json")
            result = self.invoke(f".cache/world-build/output/fine/tc/adm1/manifests/{manifest_hash}.json")
            self.assertEqual(result.returncode, 2)
            self.assertIn(expected, result.stdout)

    def test_rejects_symlinked_private_source_ancestor(self) -> None:
        pin = json.loads((self.root / self.pin).read_text())
        source_dir = self.root / ".cache/world-build/fine-source-cache"
        outside = self.root / "outside"
        outside.mkdir()
        source_file = source_dir / Path(pin["input"]).name
        outside_source = outside / source_file.name
        outside_source.write_bytes(source_file.read_bytes())
        source_file.unlink()
        source_dir.rmdir()
        source_dir.symlink_to(outside, target_is_directory=True)
        result = self.invoke()
        self.assertEqual(result.returncode, 2)
        self.assertIn("symlink ancestor", result.stdout)

    def test_cli_rejections_remain_machine_readable_json_on_stdout(self) -> None:
        result = subprocess.run([sys.executable, str(SCRIPT), "--unknown"], text=True, capture_output=True, check=False)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stderr, "")
        self.assertEqual(json.loads(result.stdout)["status"], "rejected")


if __name__ == "__main__":
    unittest.main()
