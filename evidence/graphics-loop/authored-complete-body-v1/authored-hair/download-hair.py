#!/usr/bin/env python3
"""Fetch two pinned MakeHuman CC0 hair meshes and verify their hm08 mappings.

This is asset preparation only. It does not convert meshes or change runtime
files. Reads are individually capped at 200 KB per source file and the 1.75 MB
base OBJ is read into memory only to validate MHCLO anchor IDs against its body
group. The complete asset pack is never downloaded.
"""
from __future__ import annotations

import hashlib
import json
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "source"
ASSET_COMMIT = "8cf9645b975a98eea056b140df11a1d278da0d10"
ASSET_TREE = "0850e8949d5d7a6eeb8140dbc9f9b053b6deec91"
ASSET_RAW = f"https://raw.githubusercontent.com/s20220526/makehuman-assets/{ASSET_COMMIT}"
BASE_COMMIT = "ec8d1d270b93b8e2e87e8a6160bb908665fe1fcd"
BASE_OBJ_URL = f"https://raw.githubusercontent.com/nirholas/three.ws/{BASE_COMMIT}/avatar-sources/anny/3dobjs/base.obj"
BASE_OBJ_BYTES = 1_749_303
BASE_OBJ_SHA256 = "8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c"
MAX_SOURCE_FILE = 200_000

ASSETS = {
    "afro01": {
        "directory": "base/hair/afro01",
        "obj": {"bytes": 130040, "sha256": "8344fffef15120a05a89219f31184ca2958537223fa885c885137ad1e97edcb8", "gitBlob": "6761cf10529561306e12bb8c1e32374c2864642c"},
        "mhclo": {"bytes": 149574, "sha256": "9977bd4507e2dd1408504b7a39a6f585ffa2d3ba3aa40ad4bdc2844884bbebb5", "gitBlob": "f99df0b4b6da7559634fb52de1db4d423e3110bc"},
        "mhmat": {"bytes": 1030, "sha256": "6da1c6778df2450b135009274ed0145dc2dffbc5d8e287fc1d4c69ba539b483c", "gitBlob": "04edb01a8c3b89dd8cb64a436ce01d10fe47794f"},
        "objCounts": {"vertices": 2196, "uvs": 2238, "faces": 1096, "triangleEquivalent": 2192},
        "mapRows": 2196,
        "textureReference": "afro_diffuse.png",
        "tags": ["Afro"],
    },
    "short02": {
        "directory": "base/hair/short02",
        "obj": {"bytes": 139742, "sha256": "48f979114adfa712165a69cc55c45a70831af1fb3cba8e2a89120f0c87407b64", "gitBlob": "dec7bb465c41de5d5adb67dd954825724aecf0cc"},
        "mhclo": {"bytes": 119240, "sha256": "625736cdb73e6d094df6e5a2df18f371781f1d2cd37b0ae15795c5d7051c3ec2", "gitBlob": "ef71336b19a43660b3ae7d7a49cb3c5e197c8d13"},
        "mhmat": {"bytes": 1323, "sha256": "2ed04c8aad9c1a35d858ca72091525d32b1da3b61b5a031634dd528fd8530f6d", "gitBlob": "f2ddc8e4156d7ec55297f5e0ba58563a76308849"},
        "objCounts": {"vertices": 1755, "uvs": 2061, "faces": 1672, "triangleEquivalent": 3344},
        "mapRows": 1755,
        "textureReference": "short02_diffuse.png",
        "tags": ["Short", "Male"],
    },
}
LICENSE = {
    "bytes": 7048,
    "sha256": "a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499",
    "gitBlob": "0e259d42c996742e9e3cba14c677129b2c1b6311",
}


def read_limited(url: str, limit: int) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "Allworld MakeHuman hair asset audit"})
    with urllib.request.urlopen(request, timeout=20) as response:
        chunks: list[bytes] = []
        size = 0
        while block := response.read(32 * 1024):
            size += len(block)
            if size > limit:
                raise ValueError(f"bounded read exceeded ({limit} bytes): {url}")
            chunks.append(block)
    return b"".join(chunks)


def git_blob_sha1(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def fetch_asset(relpath: str, metadata: dict[str, object]) -> tuple[bytes, dict[str, object]]:
    url = f"{ASSET_RAW}/{relpath}"
    expected_bytes = int(metadata["bytes"])
    data = read_limited(url, min(MAX_SOURCE_FILE, expected_bytes))
    sha = hashlib.sha256(data).hexdigest()
    blob = git_blob_sha1(data)
    if len(data) != expected_bytes or sha != metadata["sha256"] or blob != metadata["gitBlob"]:
        raise ValueError(f"source pin mismatch for {relpath}: {len(data)} {sha} {blob}")
    target = SOURCE / Path(relpath).name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return data, {"url": url, "path": target.relative_to(HERE).as_posix(), "bytes": len(data), "sha256": sha, "gitBlob": blob}


def obj_stats(data: bytes) -> dict[str, int]:
    counts = {"vertices": 0, "uvs": 0, "normals": 0, "faces": 0, "triangleEquivalent": 0}
    for line in data.decode("utf-8").splitlines():
        if line.startswith("v "):
            counts["vertices"] += 1
        elif line.startswith("vt "):
            counts["uvs"] += 1
        elif line.startswith("vn "):
            counts["normals"] += 1
        elif line.startswith("f "):
            counts["faces"] += 1
            counts["triangleEquivalent"] += max(0, len(line.split()) - 3)
    return counts


def obj_topology(data: bytes) -> dict[str, int]:
    vertices = 0
    faces: list[tuple[int, ...]] = []
    for line in data.decode("utf-8").splitlines():
        if line.startswith("v "):
            vertices += 1
        elif line.startswith("f "):
            faces.append(tuple(int(token.split("/")[0]) - 1 for token in line.split()[1:]))
    edge_uses: dict[tuple[int, int], int] = {}
    adjacency: list[set[int]] = [set() for _ in range(vertices)]
    for face in faces:
        for a, b in zip(face, face[1:] + face[:1]):
            edge = (min(a, b), max(a, b))
            edge_uses[edge] = edge_uses.get(edge, 0) + 1
            adjacency[a].add(b)
            adjacency[b].add(a)
    seen: set[int] = set()
    components = 0
    for start in range(vertices):
        if start in seen:
            continue
        components += 1
        seen.add(start)
        pending = [start]
        while pending:
            current = pending.pop()
            for neighbor in adjacency[current]:
                if neighbor not in seen:
                    seen.add(neighbor)
                    pending.append(neighbor)
    return {
        "uniqueUndirectedEdges": len(edge_uses),
        "boundaryEdges": sum(count == 1 for count in edge_uses.values()),
        "nonManifoldEdges": sum(count > 2 for count in edge_uses.values()),
        "connectedComponents": components,
        "isolatedVertices": sum(not neighbors for neighbors in adjacency),
    }


def parse_mhclo(data: bytes) -> tuple[list[tuple[tuple[int, int, int], tuple[float, float, float]]], dict[str, object]]:
    lines = data.decode("utf-8").splitlines()
    headers: dict[str, str] = {}
    mapping_start = None
    for index, line in enumerate(lines):
        text = line.strip()
        if text == "verts 0":
            mapping_start = index + 1
            break
        if text and not text.startswith("#"):
            parts = text.split(maxsplit=1)
            if len(parts) == 2:
                headers[parts[0]] = parts[1]
    if mapping_start is None:
        raise ValueError("MHCLO does not have the expected `verts 0` mapping start")
    rows = []
    for line in lines[mapping_start:]:
        parts = line.split()
        if not parts or parts[0].startswith("#"):
            continue
        if len(parts) != 9:
            raise ValueError(f"unexpected MHCLO mapping row with {len(parts)} fields")
        ids = tuple(int(x) for x in parts[:3])
        weights = tuple(float(x) for x in parts[3:6])
        offsets = tuple(float(x) for x in parts[6:9])
        if min(ids) < 0 or any(not (0.99998 <= sum(weights) <= 1.00002) for _ in (0,)):
            raise ValueError("invalid MHCLO anchor index or barycentric weight sum")
        rows.append((ids, weights, offsets))
    return rows, headers


def base_body_index_proof(base_obj: bytes, rows_by_asset: dict[str, list[tuple[tuple[int, int, int], tuple[float, float, float], tuple[float, float, float]]]]) -> dict[str, object]:
    if len(base_obj) != BASE_OBJ_BYTES or hashlib.sha256(base_obj).hexdigest() != BASE_OBJ_SHA256:
        raise ValueError("pinned Anny base OBJ hash/length changed")
    group = ""
    positions = 0
    body_positions: set[int] = set()
    quad_faces: list[tuple[int, ...]] = []
    body_face_sizes: dict[int, int] = {}
    for line in base_obj.decode("utf-8").splitlines():
        if line.startswith("v "):
            positions += 1
        elif line.startswith("g "):
            group = line[2:].strip()
        elif line.startswith("f ") and group == "body":
            refs = tuple(int(token.split("/")[0]) - 1 for token in line[2:].split())
            body_positions.update(refs)
            body_face_sizes[len(refs)] = body_face_sizes.get(len(refs), 0) + 1
            quad_faces.append(refs)
    support_triangles: set[tuple[int, int, int]] = set()
    for face in quad_faces:
        if len(face) == 4:
            a, b, c, d = face
            # Account for either valid diagonal of the authored quad; this is
            # a compatibility check, not a mesh triangulation decision.
            support_triangles.update((tuple(sorted(t)) for t in ((a, b, c), (a, c, d), (a, b, d), (b, c, d))))
        else:
            for i in range(1, len(face) - 1):
                support_triangles.add(tuple(sorted((face[0], face[i], face[i + 1]))))
    result_assets = {}
    for name, rows in rows_by_asset.items():
        refs = [tuple(sorted(ids)) for ids, _, _ in rows]
        invalid = sorted({index for ids, _, _ in rows for index in ids if index not in body_positions})
        exact_support = sum(ref in support_triangles for ref in refs)
        if invalid:
            raise ValueError(f"{name} MHCLO has anchors outside source OBJ body group: {invalid[:12]}")
        result_assets[name] = {
            "mapRows": len(rows),
            "anchorIndexRange": [min(i for ids, _, _ in rows for i in ids), max(i for ids, _, _ in rows for i in ids)],
            "allAnchorIndicesInBodyGroup": True,
            "mappingTriplesMatchingBodyQuadTriangleSupport": exact_support,
            "mappingTriplesTotal": len(rows),
            "nonmatchingTriples": len(rows) - exact_support,
        }
    return {
        "baseObjSha256": BASE_OBJ_SHA256,
        "baseObjBytes": len(base_obj),
        "anchorGroup": "body",
        "baseObjPositionCount": positions,
        "bodyGroupPositionIndexRange": [min(body_positions), max(body_positions)],
        "bodyGroupPositionCount": len(body_positions),
        "bodyFaceCount": sum(body_face_sizes.values()),
        "bodyFaceSizes": {str(key): value for key, value in sorted(body_face_sizes.items())},
        "assets": result_assets,
    }


def main() -> None:
    SOURCE.mkdir(parents=True, exist_ok=True)
    license_data = read_limited(f"{ASSET_RAW}/LICENSE.txt", LICENSE["bytes"])
    if len(license_data) != LICENSE["bytes"] or hashlib.sha256(license_data).hexdigest() != LICENSE["sha256"] or git_blob_sha1(license_data) != LICENSE["gitBlob"]:
        raise ValueError("MakeHuman license pin mismatch")
    (SOURCE / "LICENSE.txt").write_bytes(license_data)
    read_assets: dict[str, dict[str, bytes]] = {}
    results: dict[str, object] = {}
    map_rows = {}
    for name, meta in ASSETS.items():
        read_assets[name] = {}
        files = {}
        for extension in ("obj", "mhclo", "mhmat"):
            data, pin = fetch_asset(f"{meta['directory']}/{name}.{extension}", meta[extension])
            read_assets[name][extension] = data
            files[extension] = pin
        counts = obj_stats(read_assets[name]["obj"])
        if any(counts[key] != meta["objCounts"][key] for key in meta["objCounts"]):
            raise ValueError(f"{name} OBJ count mismatch: {counts}")
        rows, header = parse_mhclo(read_assets[name]["mhclo"])
        if len(rows) != meta["mapRows"] or len(rows) != counts["vertices"]:
            raise ValueError(f"{name} MHCLO map does not match its OBJ vertex count")
        if header.get("basemesh") != "hm08" or header.get("obj_file") != f"{name}.obj":
            raise ValueError(f"{name} does not target the expected hm08 base mesh")
        if b"delete_verts" in read_assets[name]["mhclo"]:
            raise ValueError(f"{name} unexpectedly has a delete_verts section")
        if meta["textureReference"].encode() not in read_assets[name]["mhmat"]:
            raise ValueError(f"{name} MHMAT texture reference changed")
        map_rows[name] = rows
        results[name] = {
            "assetPackLicense": "CC0 1.0",
            "tags": meta["tags"],
            "basemesh": header["basemesh"],
            "objCounts": counts,
            "objTopology": obj_topology(read_assets[name]["obj"]),
            "mhcloMapRows": len(rows),
            "deleteVertsDirective": False,
            "textureReferenceNotDownloaded": meta["textureReference"],
            "files": files,
            "mhcloMappingWeightSumRange": [min(sum(row[1]) for row in rows), max(sum(row[1]) for row in rows)],
            "mhcloOffsetCoordinateNote": "MHCLO stores Y-up/Z-depth offsets; converter must use MakeHuman convention or the documented Y/Z conversion.",
            "fitScaleHints": {key: header[key] for key in ("x_scale", "y_scale", "z_scale") if key in header},
        }
    base_obj = read_limited(BASE_OBJ_URL, BASE_OBJ_BYTES)
    if len(base_obj) != BASE_OBJ_BYTES:
        raise ValueError("base OBJ length mismatch")
    anchor_proof = base_body_index_proof(base_obj, map_rows)
    uv_path = HERE.parent / "skin-assets" / "uv-proof.json"
    uv_proof = json.loads(uv_path.read_text(encoding="utf-8"))
    if not uv_proof.get("uvComparison", {}).get("passes"):
        raise ValueError("existing authored body/base OBJ UV proof is not passing")
    pin = {
        "assetRepository": "https://github.com/s20220526/makehuman-assets",
        "assetCommit": ASSET_COMMIT,
        "assetCommitTreeSha": ASSET_TREE,
        "assetPackPage": "https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html",
        "license": {"name": "CC0 1.0", "repositoryFile": "source/LICENSE.txt", **LICENSE},
        "baseMesh": {"name": "hm08", "url": BASE_OBJ_URL, "provenance": "three.ws Anny base OBJ; same pinned source validated by skin-assets/uv-proof.json"},
        "anchorCompatibility": anchor_proof,
        "authoredGlbUvCrosscheck": uv_proof["uvComparison"],
        "assets": results,
        "scope": "Pinned source inputs only. No MHCLO conversion, visual review, runtime integration, texture transfer, or bun asset is claimed.",
    }
    (HERE / "hair-pin.json").write_text(json.dumps(pin, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "pass", "assets": {key: {"obj": value["objCounts"], "mapRows": value["mhcloMapRows"]} for key, value in results.items()}, "anchors": anchor_proof}, indent=2))


if __name__ == "__main__":
    main()
