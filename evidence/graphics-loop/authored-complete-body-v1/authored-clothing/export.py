#!/usr/bin/env python3
"""Bounded offline MakeHuman MHCLO -> accessory GLB baker (stdlib only)."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import os
import struct
import sys
import tempfile
import urllib.request
from pathlib import Path

BODY_PIN = "ec8d1d270b93b8e2e87e8a6160bb908665fe1fcd"
ASSET_PIN = "8cf9645b975a98eea056b140df11a1d278da0d10"
BODY_ROOT = f"https://raw.githubusercontent.com/nirholas/three.ws/{BODY_PIN}/avatar-sources/anny/"
ASSET_ROOT = f"https://raw.githubusercontent.com/s20220526/makehuman-assets/{ASSET_PIN}/base/clothes/male_casualsuit01/"
MAX_DOWNLOAD = 5_000_000  # exact-pinned 2048px CC0 hair PNGs are 3.55/4.82 MB; SHA/length checks are mandatory
SOURCES = {
    "base.obj": (BODY_ROOT + "3dobjs/base.obj", "8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c", 1_749_303),
    "basemesh_vertex_groups.json": (BODY_ROOT + "mesh_metadata/basemesh_vertex_groups.json", "8cb1417bc55ae5ec8aa99f90734e81ed5fbb556511ff6a2c00e0534b70911444", 81_984),
    "rig.mixamo.json": (BODY_ROOT + "rigs/rig.mixamo.json", "b4e491bacdcae797e53b7692169cf6a160c50fcc1eda5f0982e92fac1561ae56", 84_107),
    "weights.mixamo.json": (BODY_ROOT + "rigs/weights.mixamo.json", "4561be4d7c0093d70e3dba4fbacbbbb6d66781573779fb12a0509cefa181b8ae", 2_372_203),
    "male_casualsuit01.mhclo": (ASSET_ROOT + "male_casualsuit01.mhclo", "78503ed7f56c149843d85e06e1164bc6871ce7319b2ef689237046352cc90de4", 570_419),
    "male_casualsuit01.obj": (ASSET_ROOT + "male_casualsuit01.obj", "001921d237e408c35103720d046aa37f9c5512db1a179a5ede6a065cd504ba89", 699_545),
}
HAIR_INPUTS = {
    "short02": {
        "kind": "hair", "obj": ("https://raw.githubusercontent.com/s20220526/makehuman-assets/" + ASSET_PIN + "/base/hair/short02/short02.obj", "48f979114adfa712165a69cc55c45a70831af1fb3cba8e2a89120f0c87407b64", 139_742),
        "mhclo": ("https://raw.githubusercontent.com/s20220526/makehuman-assets/" + ASSET_PIN + "/base/hair/short02/short02.mhclo", "625736cdb73e6d094df6e5a2df18f371781f1d2cd37b0ae15795c5d7051c3ec2", 119_240),
        "mhmat": ("https://raw.githubusercontent.com/s20220526/makehuman-assets/" + ASSET_PIN + "/base/hair/short02/short02.mhmat", "2ed04c8aad9c1a35d858ca72091525d32b1da3b61b5a031634dd528fd8530f6d", 1_323),
        "texture": ("https://download.tuxfamily.org/makehuman/assets/1.1/base/hair/short02/short02_diffuse.png", "47fe33831a3929567c733356dd66243116e05df2ace1f884ddca0080b728229f", 3_553_543, "47fe33831a3929567c733356dd66243116e05df2ace1f884ddca0080b728229f"),
        "pointer": ("https://raw.githubusercontent.com/s20220526/makehuman-assets/" + ASSET_PIN + "/base/hair/short02/short02_diffuse.png", "27e0a8d958c8d00ae7ff0dd3d59d4b6712f9a3c2b33d34c5fa5154aaa809b5ef", 132),
        "textureName": "short02_diffuse.png", "textureLfsSize": 3_553_543, "textureField": "diffuseTexture short02_diffuse.png", "color": [1.0, 1.0, 1.0, 1.0],
    },
    "afro01": {
        "kind": "hair", "obj": ("https://raw.githubusercontent.com/s20220526/makehuman-assets/" + ASSET_PIN + "/base/hair/afro01/afro01.obj", "8344fffef15120a05a89219f31184ca2958537223fa885c885137ad1e97edcb8", 130_040),
        "mhclo": ("https://raw.githubusercontent.com/s20220526/makehuman-assets/" + ASSET_PIN + "/base/hair/afro01/afro01.mhclo", "9977bd4507e2dd1408504b7a39a6f585ffa2d3ba3aa40ad4bdc2844884bbebb5", 149_574),
        "mhmat": ("https://raw.githubusercontent.com/s20220526/makehuman-assets/" + ASSET_PIN + "/base/hair/afro01/afro01.mhmat", "6da1c6778df2450b135009274ed0145dc2dffbc5d8e287fc1d4c69ba539b483c", 1_030),
        "texture": ("https://download.tuxfamily.org/makehuman/assets/1.1/base/hair/afro01/afro_diffuse.png", "dc0db7dd8a13802f02303ca7e49844b219e09db134471b7061538a8af8f7c7fb", 4_817_185, "dc0db7dd8a13802f02303ca7e49844b219e09db134471b7061538a8af8f7c7fb"),
        "pointer": ("https://raw.githubusercontent.com/s20220526/makehuman-assets/" + ASSET_PIN + "/base/hair/afro01/afro_diffuse.png", "f558e275ba7fe28b213ad12e462ab8f63fd6a6de2f42497e7b7509c9ff91269f", 132),
        "textureName": "afro_diffuse.png", "textureLfsSize": 4_817_185, "textureField": "diffuseTexture afro_diffuse.png", "color": [1.0, 1.0, 1.0, 1.0],
    },
}
for sex in ("female", "male"):
    for ethnicity in ("african", "asian", "caucasian"):
        name = f"{ethnicity}-{sex}-young.target.gz"
        digest = {
            "african-female-young.target.gz": "1147ae55ecb0f66bade3f45176b3af187e265878322db172ad1090e9f3108e84",
            "asian-female-young.target.gz": "ee17da733288434e5b6fa120497f1fa6e72bf7faad5d694b0431d7275139170d",
            "caucasian-female-young.target.gz": "e9d6212373ac5f1e2c596fa145e363385f4d169c3c6c88ede3bab93b681af041",
            "african-male-young.target.gz": "05ed84d6df36e788cdfa8da0be15376850524b960cf2f17f3e592b9cf7d21c85",
            "asian-male-young.target.gz": "0928ed8b9f08f60afb9884cf9e9f33a939ed3a85d7f136de9ccc88a76981d6d7",
            "caucasian-male-young.target.gz": "ffe69537e53148edff2776204ba48cf3f1cbc729665e8f0a3976e2a6e96c2e0",
        }.get(name)
        # The final entry is corrected below from its independently measured source hash.
        if name == "caucasian-male-young.target.gz":
            digest = "ffe69537e53148edff2776204ba48cf3bf1f3cbc72966592c8a562ab80b07333"
        SOURCES[name] = (BODY_ROOT + "targets/macrodetails/" + name, digest, None)


def fetch(cache: Path, name: str) -> bytes:
    url, expected, expected_size = SOURCES[name]
    path = cache / name
    if path.exists():
        data = path.read_bytes()
    else:
        request = urllib.request.Request(url, headers={"User-Agent": "authored-clothing-bake/1"})
        with urllib.request.urlopen(request, timeout=20) as response:
            length = int(response.headers.get("Content-Length", "0"))
            if length > MAX_DOWNLOAD:
                raise ValueError(f"refusing oversized source {name}: {length} bytes")
            data = response.read(MAX_DOWNLOAD + 1)
        if len(data) > MAX_DOWNLOAD:
            raise ValueError(f"refusing oversized source {name}: >{MAX_DOWNLOAD} bytes")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    actual = hashlib.sha256(data).hexdigest()
    if actual != expected or (expected_size is not None and len(data) != expected_size):
        raise ValueError(f"source hash/length mismatch for {name}: {len(data)} bytes, SHA-256 {actual}")
    return data


def parse_obj(raw: bytes):
    positions, uvs, faces, group = [], [], [], ""
    for line in raw.decode("utf-8").splitlines():
        if line.startswith("v "):
            positions.append(tuple(map(float, line.split()[1:4])))
        elif line.startswith("vt "):
            uvs.append(tuple(map(float, line.split()[1:3])))
        elif line.startswith("g "):
            group = line.split()[1]
        elif line.startswith("f "):
            corners = []
            for token in line.split()[1:]:
                indices = token.split("/")
                corners.append((int(indices[0]) - 1, int(indices[1]) - 1 if len(indices) > 1 and indices[1] else -1))
            faces.append((group, corners))
    return positions, uvs, faces


def target_deltas(raw: bytes, vertex_count: int):
    result = {}
    for line in gzip.decompress(raw).decode("ascii").splitlines():
        t = line.strip()
        if not t or t.startswith("#"):
            continue
        fields = t.split()
        index = int(fields[0])
        if index < 0 or index >= vertex_count:
            raise ValueError(f"target source index out of range: {index}")
        result[index] = tuple(map(float, fields[1:4]))
    return result


def parse_mhclo(raw: bytes):
    lines = raw.decode("utf-8").splitlines()
    scales = {}
    rows = []
    deleting = False
    mapping = False
    delete_indices = set()
    for line in lines:
        t = line.strip()
        if not t or t.startswith("#"):
            continue
        parts = t.split()
        key = parts[0]
        if key == "verts":
            mapping = True
            continue
        if key in ("x_scale", "y_scale", "z_scale"):
            scales[key[0]] = (int(parts[1]), int(parts[2]), float(parts[3]))
        elif key == "delete_verts":
            deleting = True
        elif deleting:
            i = 0
            while i < len(parts):
                start = int(parts[i]); i += 1
                if i < len(parts) and parts[i] == "-":
                    end = int(parts[i + 1]); i += 2
                else:
                    end = start
                delete_indices.update(range(start, end + 1))
        elif mapping:
            if len(parts) != 9:
                raise ValueError(f"unsupported MHCLO mapping row with {len(parts)} fields")
            indices = tuple(map(int, parts[:3]))
            bary = tuple(map(float, parts[3:6]))
            offsets = tuple(map(float, parts[6:9]))
            if min(indices) < 0 or abs(sum(bary) - 1.0) > 1e-4:
                raise ValueError(f"invalid MHCLO map row {len(rows)}")
            rows.append((indices, bary, offsets))
    if set(scales) != {"x", "y", "z"} or not rows:
        raise ValueError("MHCLO must contain axis references and maps")
    return scales, rows, delete_indices


def add3(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def mapped_positions(base, delta, scales, rows):
    shape = [add3(p, delta[i]) for i, p in enumerate(base)]
    axis_sizes = {}
    for axis, (first, second, reference) in scales.items():
        component = {"x": 0, "y": 1, "z": 2}[axis]
        axis_sizes[axis] = abs(shape[first][component] - shape[second][component]) / reference
    output = []
    for indices, bary, offset in rows:
        anchor = [sum(shape[indices[j]][k] * bary[j] for j in range(3)) for k in range(3)]
        output.append(tuple(anchor[k] + offset[k] * axis_sizes["xyz"[k]] for k in range(3)))
    return output


def blend_targets(files, vertex_count):
    acc = [[0.0, 0.0, 0.0] for _ in range(vertex_count)]
    for name in files:
        for i, d in target_deltas(fetch(CACHE, name), vertex_count).items():
            for k in range(3):
                acc[i][k] += d[k] / 3.0
    return [tuple(v) for v in acc]


def f32(values):
    return struct.pack("<" + "f" * len(values), *values)


class Glb:
    def __init__(self):
        self.bin = bytearray()
        self.views, self.accessors = [], []

    def accessor(self, name, payload, component, kind, count, target, bounds=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        offset = len(self.bin)
        self.bin.extend(payload)
        view = len(self.views)
        self.views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(payload), "target": target})
        item = {"bufferView": view, "componentType": component, "count": count, "type": kind, "name": name}
        if bounds:
            item.update(bounds)
        index = len(self.accessors)
        self.accessors.append(item)
        return index

    def blob_view(self, payload, mime_type):
        while len(self.bin) % 4:
            self.bin.append(0)
        offset = len(self.bin)
        self.bin.extend(payload)
        view = len(self.views)
        self.views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(payload), "name": mime_type})
        return view

    def write(self, path, document):
        document["bufferViews"] = self.views
        document["accessors"] = self.accessors
        while len(self.bin) % 4:
            self.bin.append(0)
        document["buffers"] = [{"byteLength": len(self.bin)}]
        json_chunk = json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        json_chunk += b" " * ((4 - len(json_chunk) % 4) % 4)
        total = 12 + 8 + len(json_chunk) + 8 + len(self.bin)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("wb") as out:
            out.write(struct.pack("<III", 0x46546C67, 2, total))
            out.write(struct.pack("<II", len(json_chunk), 0x4E4F534A)); out.write(json_chunk)
            out.write(struct.pack("<II", len(self.bin), 0x004E4942)); out.write(self.bin)


def main():
    global CACHE, SOURCES
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset", choices=("male_casualsuit01", "short02", "afro01"), default="male_casualsuit01")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--cache-dir", type=Path, default=Path(tempfile.gettempdir()) / "joinallworld-authored-clothing-cache")
    args = parser.parse_args()
    asset_name = args.asset
    hair = HAIR_INPUTS.get(asset_name)
    asset_kind = "hair" if hair else "clothing"
    group_name = "body" if hair else "helper-tights"
    if hair:
        SOURCES[f"{asset_name}.obj"] = hair["obj"]
        SOURCES[f"{asset_name}.mhclo"] = hair["mhclo"]
        SOURCES[f"{asset_name}.mhmat"] = hair["mhmat"]
        SOURCES[f"{hair['textureName']}.lfs-pointer"] = hair["pointer"]
        SOURCES[hair["textureName"]] = hair["texture"][:3]
    if args.output_dir is None:
        default_dir = Path(__file__).parent.parent / "authored-hair" / "out" if hair else Path(__file__).parent / "out"
        args.output_dir = default_dir
    CACHE = args.cache_dir
    CACHE.mkdir(parents=True, exist_ok=True)

    texture_bytes = None
    texture_pointer = None
    if hair:
        texture_pointer = fetch(CACHE, f"{hair['textureName']}.lfs-pointer").decode("ascii")
        if f"oid sha256:{hair['texture'][3]}" not in texture_pointer or f"size {hair['textureLfsSize']}" not in texture_pointer:
            raise ValueError("pinned Git LFS pointer does not match referenced hair texture SHA/size")
        texture_bytes = fetch(CACHE, hair["textureName"])
        if len(texture_bytes) != hair["textureLfsSize"]:
            raise ValueError("resolved hair texture size does not match pinned LFS pointer")
        if texture_bytes[:8] != b"\x89PNG\r\n\x1a\n" or texture_bytes[25] != 6:
            raise ValueError("referenced hair diffuse must be a PNG with RGBA alpha channel")

    base, _, body_faces = parse_obj(fetch(CACHE, "base.obj"))
    rig = json.loads(fetch(CACHE, "rig.mixamo.json"))
    raw_weights = json.loads(fetch(CACHE, "weights.mixamo.json"))["weights"]
    bone_names = list(rig["bones"])
    bone_index = {name: i for i, name in enumerate(bone_names)}
    if set(raw_weights) != set(bone_names):
        raise ValueError("weight bone set does not exactly cover pinned rig")
    per_source = [[] for _ in base]
    for name, entries in raw_weights.items():
        for vertex, weight in entries:
            per_source[vertex].append((bone_index[name], float(weight)))
    scales, rows, delete_vertices = parse_mhclo(fetch(CACHE, f"{asset_name}.mhclo"))
    if any(not per_source[i] for indices, _, _ in rows for i in indices):
        raise ValueError("MHCLO anchor without exact source weights; nearest-neighbor fallback is forbidden")

    garment_pos, garment_uv, garment_faces = parse_obj(fetch(CACHE, f"{asset_name}.obj"))
    if len(garment_pos) != len(rows):
        raise ValueError("MHCLO row count does not match authored OBJ vertices")
    if not all(0 <= i < len(base) for row, _, _ in rows for i in row):
        raise ValueError("MHCLO map references absent base vertex")

    female_names = [f"{eth}-female-young.target.gz" for eth in ("african", "asian", "caucasian")]
    male_names = [f"{eth}-male-young.target.gz" for eth in ("african", "asian", "caucasian")]
    neutral = [(0.0, 0.0, 0.0)] * len(base)
    female = blend_targets(female_names, len(base))
    male = blend_targets(male_names, len(base))
    mapped_neutral = mapped_positions(base, neutral, scales, rows)
    mapped_female = mapped_positions(base, female, scales, rows)
    mapped_male = mapped_positions(base, male, scales, rows)

    # Source baker's shared transform: 0.1 metres per MakeHuman unit, +Z front,
    # and Y floor from the pinned joint-ground vertex group.
    source_groups = json.loads(fetch(CACHE, "basemesh_vertex_groups.json"))
    anchor_ranges = source_groups.get(group_name)
    if not anchor_ranges:
        raise ValueError(f"pinned source has no {group_name} vertex range")
    anchor_group_ids = {i for start, end in anchor_ranges for i in range(start, end + 1)}
    anchor_source_ids = {i for row, _, _ in rows for i in row}
    if not anchor_source_ids <= anchor_group_ids:
        raise ValueError(f"MHCLO rows reference source vertices outside {group_name}")
    body_triangle_support = set()
    for face_group, corners in body_faces:
        if face_group == "body":
            ids = [vertex for vertex, _ in corners]
            if len(ids) == 4:
                # Support means a triple is one triangle under either diagonal
                # of the source quad, independent of the exported fan diagonal.
                body_triangle_support.update(tuple(sorted(tri)) for tri in ((ids[0], ids[1], ids[2]), (ids[0], ids[2], ids[3]), (ids[0], ids[1], ids[3]), (ids[1], ids[2], ids[3])))
            else:
                for j in range(1, len(ids) - 1):
                    body_triangle_support.add(tuple(sorted((ids[0], ids[j], ids[j + 1]))))
    supported_anchor_rows = [i for i, (indices, _, _) in enumerate(rows) if tuple(sorted(indices)) in body_triangle_support]
    unsupported_anchor_rows = [i for i in range(len(rows)) if i not in set(supported_anchor_rows)]
    ground_ranges = source_groups.get("joint-ground")
    if not ground_ranges:
        raise ValueError("pinned source has no joint-ground range")
    ground_ids = [i for start, end in ground_ranges for i in range(start, end + 1)]
    floor_y = sum(base[i][1] for i in ground_ids) / len(ground_ids) * 0.1
    transform = lambda p: (p[0] * 0.1, p[1] * 0.1 - floor_y, p[2] * 0.1)

    # Preserve authored OBJ seams by splitting only on the actual (position, UV) corner pair.
    split_index, split_from = {}, []
    triangles = []
    for group, corners in garment_faces:
        for j in range(1, len(corners) - 1):
            tri = (corners[0], corners[j], corners[j + 1])
            output_tri = []
            for source_vertex, uv_index in tri:
                key = (source_vertex, uv_index)
                if key not in split_index:
                    split_index[key] = len(split_from)
                    split_from.append(key)
                output_tri.append(split_index[key])
            triangles.append(output_tri)
    if not triangles or len(split_from) < len(garment_pos):
        raise ValueError("authored OBJ face parsing produced no complete garment topology")

    positions, uvs, morph_f, morph_m = [], [], [], []
    joint_rows, weight_rows = [], []
    source_vertex_ids, anchor_vertex_ids, anchor_barycentrics = [], [], []
    clamped_blend_lane_count = 0
    zero_sum_fallback_count = 0
    for source_vertex, uv_index in split_from:
        source_vertex_ids.append(source_vertex)
        anchor_vertex_ids.extend(rows[source_vertex][0])
        anchor_barycentrics.extend(rows[source_vertex][1])
        positions.extend(transform(mapped_neutral[source_vertex]))
        # OBJ vt coordinates conventionally use a lower-left image origin;
        # glTF TEXCOORD_0 uses the image upper-left origin. The pinned source
        # maps confirm this transform: flipping V raises alpha coverage on the
        # source hair triangles from 59.14% to 79.02% (short02) and from 57.91%
        # to 97.64% (afro01). Clothing exports retain their existing OBJ UVs.
        source_uv = garment_uv[uv_index] if uv_index >= 0 else (0.0, 0.0)
        uvs.extend((source_uv[0], 1.0 - source_uv[1]) if hair else source_uv)
        morph_f.extend(tuple((mapped_female[source_vertex][k] - mapped_neutral[source_vertex][k]) * 0.1 for k in range(3)))
        morph_m.extend(tuple((mapped_male[source_vertex][k] - mapped_neutral[source_vertex][k]) * 0.1 for k in range(3)))
        indices, bary, _ = rows[source_vertex]
        blended = {}
        for source_i, factor in zip(indices, bary):
            for bone, weight in per_source[source_i]:
                blended[bone] = blended.get(bone, 0.0) + factor * weight
        clamped_blend_lane_count += sum(1 for weight in blended.values() if weight < 0.0)
        nonnegative = {bone: max(0.0, weight) for bone, weight in blended.items()}
        strongest = sorted(((bone, weight) for bone, weight in nonnegative.items() if weight > 0.0), key=lambda pair: (-pair[1], pair[0]))[:4]
        total = sum(value for _, value in strongest)
        if total <= 0:
            # Deterministic fallback for fully canceled extrapolative blends:
            # choose the anchor with greatest barycentric coefficient (tie by
            # lowest source vertex ID), then transfer its positive source lanes.
            fallback_source = sorted(zip(indices, bary), key=lambda pair: (-pair[1], pair[0]))[0][0]
            fallback = sorted(((bone, max(0.0, weight)) for bone, weight in per_source[fallback_source] if weight > 0.0), key=lambda pair: (-pair[1], pair[0]))[:4]
            total = sum(value for _, value in fallback)
            if total <= 0:
                raise ValueError(f"no positive deterministic source fallback at authored vertex {source_vertex}")
            strongest = fallback
            zero_sum_fallback_count += 1
        joint_rows.append([item[0] for item in strongest] + [0] * (4 - len(strongest)))
        weight_rows.append([item[1] / total for item in strongest] + [0.0] * (4 - len(strongest)))

    # Flat authored triangles become smooth vertex normals; seams remain split at OBJ UVs.
    normal = [0.0] * len(positions)
    for tri in triangles:
        a, b, c = [positions[index * 3:index * 3 + 3] for index in tri]
        ab = [b[k] - a[k] for k in range(3)]; ac = [c[k] - a[k] for k in range(3)]
        cross = (ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0])
        for index in tri:
            for k in range(3): normal[index * 3 + k] += cross[k]
    for i in range(len(split_from)):
        length = math.sqrt(sum(normal[i * 3 + k] ** 2 for k in range(3)))
        if length > 0:
            for k in range(3): normal[i * 3 + k] /= length

    # Conservative MPFB face-hide rule: retain boundary faces; remove only source
    # quads whose every vertex is in MHCLO delete_verts. Each quad maps to two
    # source-body fan triangles, matching the upstream baker's quad triangulation.
    hidden_faces, hidden_triangles = [], []
    source_face_id = 0
    for group, corners in body_faces:
        if group != "body":
            continue
        vertex_ids = [v for v, _ in corners]
        if all(v in delete_vertices for v in vertex_ids):
            hidden_faces.append(source_face_id)
            hidden_triangles.extend((source_face_id * 2, source_face_id * 2 + 1))
        source_face_id += 1

    # Compare all three source recipes without mutating the authored OBJ.
    def fit_stats(mapped):
        errors = [math.sqrt(sum((mapped[i][k] - garment_pos[i][k]) ** 2 for k in range(3))) for i in range(len(rows))]
        ordered = sorted(errors)
        return {"mean": sum(errors) / len(errors), "p95": ordered[int(0.95 * (len(ordered) - 1))], "max": ordered[-1]}
    fit_neutral = fit_stats(mapped_neutral)
    fit_female = fit_stats(mapped_female)
    fit_male = fit_stats(mapped_male)
    mean_error, p95_error, max_error = fit_male["mean"], fit_male["p95"], fit_male["max"]
    if asset_kind == "clothing" and (mean_error > 0.2 or p95_error > 0.28 or max_error > 0.4):
        raise ValueError(f"male source fit check failed: mean {mean_error:.3f}, p95 {p95_error:.3f}, max {max_error:.3f} source units")

    glb = Glb()
    count = len(split_from)
    position_accessor = glb.accessor("POSITION", f32(positions), 5126, "VEC3", count, 34962,
        {"min": [min(positions[k::3]) for k in range(3)], "max": [max(positions[k::3]) for k in range(3)]})
    normal_accessor = glb.accessor("NORMAL", f32(normal), 5126, "VEC3", count, 34962)
    uv_accessor = glb.accessor("TEXCOORD_0", f32(uvs), 5126, "VEC2", count, 34962)
    joints_flat = [v for row in joint_rows for v in row]
    joint_accessor = glb.accessor("JOINTS_0", struct.pack("<" + "H" * len(joints_flat), *joints_flat), 5123, "VEC4", count, 34962)
    weight_accessor = glb.accessor("WEIGHTS_0", f32([v for row in weight_rows for v in row]), 5126, "VEC4", count, 34962)
    source_vertex_accessor = glb.accessor("_MH_SOURCE_VERTEX", struct.pack("<" + "I" * count, *source_vertex_ids), 5125, "SCALAR", count, 34962)
    anchor_vertex_accessor = glb.accessor("_MH_ANCHOR_VERTICES", struct.pack("<" + "H" * len(anchor_vertex_ids), *anchor_vertex_ids), 5123, "VEC3", count, 34962)
    anchor_bary_accessor = glb.accessor("_MH_ANCHOR_BARYCENTRICS", f32(anchor_barycentrics), 5126, "VEC3", count, 34962)
    index_flat = [v for tri in triangles for v in tri]
    index_accessor = glb.accessor("indices", struct.pack("<" + "I" * len(index_flat), *index_flat), 5125, "SCALAR", len(index_flat), 34963)
    female_accessor = glb.accessor("bodyFeminine POSITION delta", f32(morph_f), 5126, "VEC3", count, 34962)
    male_accessor = glb.accessor("bodyMasculine POSITION delta", f32(morph_m), 5126, "VEC3", count, 34962)

    image_view = glb.blob_view(texture_bytes, "image/png") if texture_bytes else None
    material = {"name": f"{asset_name}-cc0-palette", "pbrMetallicRoughness": {"baseColorFactor": hair["color"] if hair else [0.2, 0.24, 0.31, 1.0], "metallicFactor": 0.0, "roughnessFactor": 0.84}, "doubleSided": bool(hair)}
    textures = {}
    if texture_bytes:
        material["pbrMetallicRoughness"]["baseColorTexture"] = {"index": 0}
        material["alphaMode"] = "BLEND"
        textures = {"samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}], "images": [{"name": hair["textureName"], "mimeType": "image/png", "bufferView": image_view}], "textures": [{"sampler": 0, "source": 0}]}
    document = {
        "asset": {"version": "2.0", "generator": "authored-clothing/export.py"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": asset_name, "mesh": 0}],
        "meshes": [{"name": asset_name, "weights": [0.0, 0.0], "extras": {"targetNames": ["bodyFeminine", "bodyMasculine"], "jointNames": bone_names},
            "primitives": [{"attributes": {"POSITION": position_accessor, "NORMAL": normal_accessor, "TEXCOORD_0": uv_accessor, "JOINTS_0": joint_accessor, "WEIGHTS_0": weight_accessor, "_MH_SOURCE_VERTEX": source_vertex_accessor, "_MH_ANCHOR_VERTICES": anchor_vertex_accessor, "_MH_ANCHOR_BARYCENTRICS": anchor_bary_accessor}, "indices": index_accessor,
                "material": 0, "mode": 4, "targets": [{"POSITION": female_accessor}, {"POSITION": male_accessor}]}]}],
        "materials": [material],
        "extras": {"license": "CC0-1.0", "skinBinding": "JOINTS_0 indices use mesh extras.jointNames; attach to matching 52-bone authored actor skeleton", "bodyHideMetadata": f"{asset_name}-metadata.json" if hair else "body-hide-map.json", "textureSource": hair["textureName"] if hair else None},
        **textures,
    }
    output = args.output_dir / f"{asset_name}.glb"
    glb.write(output, document)
    metadata_name = f"{asset_name}-metadata.json" if hair else "body-hide-map.json"
    source_ref = {"body": BODY_PIN, "asset": ASSET_PIN}
    if hair:
        pointer_text = texture_pointer.strip().splitlines()
        source_ref.update({"textureSha256": hair["texture"][3], "textureBytes": hair["textureLfsSize"], "lfsPointerSha256": hair["pointer"][1], "lfsPointer": pointer_text})
    metadata = {
        "schema": "joinallworld.authored-accessory.v1" if hair else "joinallworld.authored-clothing-body-hide.v1",
        "asset": asset_name,
        "assetKind": asset_kind,
        "sourcePins": source_ref,
        "sourceMesh": "hm08 base.obj group body; source OBJ quad order; each quad fans to two triangles",
        "deleteSemantics": "MHCLO has no delete_verts directive; no body faces are hidden." if hair and not delete_vertices else "Conservative: remove a source body quad only when all four original source vertex IDs are in MHCLO delete_verts; partially affected boundary quads are retained.",
        "bodyHideSourceFaceIds": hidden_faces,
        "bodyHideSourceTriangleIds": hidden_triangles,
        "bodyHideVertexIds": sorted(delete_vertices),
        "bodySourceFaceCount": source_face_id,
        "bodySourceTriangleCount": source_face_id * 2,
        "removedBodyFaces": len(hidden_faces),
        "removedBodyTriangles": len(hidden_triangles),
        "garmentAuthoredVertexCount": len(garment_pos),
        "garmentSplitVertexCount": count,
        "garmentTriangleCount": len(triangles),
        "anchors": {"rows": len(rows), "uniqueSourceIds": len(anchor_source_ids), "sourceIndexMin": min(anchor_source_ids), "sourceIndexMax": max(anchor_source_ids), "sourceGroup": group_name, "sourceGroupRanges": anchor_ranges, "allRowsInExpectedGroup": True, "helperTightsOnly": group_name == "helper-tights", "nearestNeighborFallback": False, "mappingTriplesMatchingBodyQuadTriangleSupport": len(supported_anchor_rows), "mappingTriplesTotal": len(rows), "nonmatchingBodyTriangleSupportRowIds": unsupported_anchor_rows, "glbAttributes": {"_MH_SOURCE_VERTEX": f"original {asset_name}.obj v index, repeated only for OBJ UV seams", "_MH_ANCHOR_VERTICES": "MHCLO's three original hm08 source vertex indices", "_MH_ANCHOR_BARYCENTRICS": "the exact three MHCLO barycentric weights"}},
        "weights": {"source": "pinned weights.mixamo.json", "bones": len(bone_names), "unweightedAnchorCount": 0, "maxInfluences": 4, "negativeBarycentricBlendLanesClampedToZero": clamped_blend_lane_count, "zeroSumDeterministicAnchorFallbackCount": zero_sum_fallback_count, "fallbackRule": "If all clamped barycentric bone lanes sum to zero, choose the MHCLO anchor with highest barycentric coefficient (tie by lowest hm08 source vertex ID), then use its positive source weights; error if that source has no positive weights.", "allNormalized": True, "jointNamesOrder": bone_names},
        "morphs": ["bodyFeminine", "bodyMasculine"],
        "morphRecipe": "The exact upstream builder's 1/3 African + 1/3 Asian + 1/3 Caucasian young target for each sex; garment deltas are mapped target shape minus mapped neutral shape, including MHCLO axis-reference scaling per shape.",
        "coordinates": {"source": "MakeHuman Y-up, +Z-facing", "output": "metres, Y-up, +Z-facing; x/y/z * 0.1 and joint-ground centroid subtracted from Y"},
        "maleFitErrorSourceUnits": {"mean": mean_error, "p95": p95_error, "max": max_error},
        "sourceFitErrorByBodyShapeUnits": {"neutral": fit_neutral, "bodyFeminine": fit_female, "bodyMasculine": fit_male},
        "renderAcceptance": "not performed; this is source-space/export evidence only",
        "material": {"mhmat": f"{asset_name}.mhmat" if hair else "no hair texture", "diffuseTexture": hair["textureName"] if hair else None, "sourceDiffuseColor": hair["color"][:3] if hair else None, "objToGltfV": "1-v" if hair else "unchanged", "pngWidthHeight": [2048, 2048] if hair else None, "pngBitDepth": 8 if hair else None, "pngColorType": "RGBA" if hair else None, "alphaMode": "BLEND" if hair else "OPAQUE", "textureColorSpace": "sRGB" if hair else None},
        "generatedGlb": str(output),
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / metadata_name).write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps({"glb": str(output), "bytes": output.stat().st_size, "metadata": str(args.output_dir / metadata_name), "garmentVertices": len(garment_pos), "splitVertices": count, "triangles": len(triangles), "hiddenBodyTriangles": len(hidden_triangles), "negativeBlendLanesClamped": clamped_blend_lane_count, "zeroSumFallbacks": zero_sum_fallback_count, "maleFitMean": mean_error, "maleFitP95": p95_error, "maleFitMax": max_error}, indent=2))


if __name__ == "__main__":
    main()
