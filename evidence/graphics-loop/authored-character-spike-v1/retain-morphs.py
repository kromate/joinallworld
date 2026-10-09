#!/usr/bin/env python3
"""Keep a small, named subset of sparse glTF morphs and repack a GLB.

This deliberately supports the inspected single-buffer GLB shape. It fails
closed if the source format or accessor relationships differ from that input.
"""
from __future__ import annotations

import hashlib
import json
import struct
import sys
from pathlib import Path


KEEP = {
    # Compact family/body variation candidate.
    "bodyFeminine", "bodyMasculine", "bodyMuscular", "bodySofter",
    "bodyHeavier", "bodyThinner", "heightTaller", "heightShorter",
    "shouldersWider", "shouldersNarrower", "chestVShape", "bustBigger",
    "bustSmaller", "hipsWider", "hipsNarrower",
    # A few saved face-shape choices.
    "headOval", "headRound", "jawWider", "jawNarrower", "noseWider",
    "noseNarrower", "cheekFullerLeft", "cheekFullerRight",
    # Small expression set: smile/frown, open jaw, eyelid closure, brow motion.
    "mouthCornersUp", "mouthCornersDown", "mouthLowerLipMiddleDown",
    "mouthDimples", "jawDrop", "eyeUpperLidDownLeft",
    "eyeUpperLidDownRight", "eyeLowerLidUpLeft", "eyeLowerLidUpRight",
    "browsUp", "browsDown",
}


def align4(buf: bytearray) -> None:
    buf.extend(b"\0" * ((-len(buf)) & 3))


def accessor_refs(gltf: dict) -> set[int]:
    refs: set[int] = set()
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            refs.update(prim.get("attributes", {}).values())
            if "indices" in prim:
                refs.add(prim["indices"])
            for target in prim.get("targets", []):
                refs.update(target.values())
    for skin in gltf.get("skins", []):
        if "inverseBindMatrices" in skin:
            refs.add(skin["inverseBindMatrices"])
    for anim in gltf.get("animations", []):
        for sampler in anim.get("samplers", []):
            refs.add(sampler["input"])
            refs.add(sampler["output"])
    return refs


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: retain-morphs.py INPUT.glb OUTPUT.glb")
    src_path, dst_path = map(Path, sys.argv[1:])
    src = src_path.read_bytes()
    if len(src) > 16 * 1024 * 1024:
        raise SystemExit("refuse input larger than the bounded 16 MiB spike limit")
    magic, version, total_len = struct.unpack_from("<4sII", src, 0)
    if magic != b"glTF" or version != 2 or total_len != len(src):
        raise SystemExit("expected a complete GLB v2")
    json_len, json_type = struct.unpack_from("<I4s", src, 12)
    if json_type != b"JSON":
        raise SystemExit("expected JSON as the first GLB chunk")
    json_start = 20
    json_end = json_start + json_len
    gltf = json.loads(src[json_start:json_end])
    bin_header = json_end
    bin_len, bin_type = struct.unpack_from("<I4s", src, bin_header)
    if bin_type != b"BIN\0" or bin_header + 8 + bin_len > len(src):
        raise SystemExit("expected one complete embedded BIN chunk")
    source_bin = src[bin_header + 8:bin_header + 8 + bin_len]
    if len(gltf.get("buffers", [])) != 1 or gltf["buffers"][0].get("uri"):
        raise SystemExit("only one embedded GLB buffer is supported")
    source_buffer_view_count = len(gltf.get("bufferViews", []))

    all_target_accessor_ids: set[int] = set()
    dropped_target_accessor_ids: set[int] = set()
    refs_before = accessor_refs(gltf)
    per_mesh: list[dict] = []
    old_weights: dict[int, list[float]] = {}
    for mesh_index, mesh in enumerate(gltf.get("meshes", [])):
        names = mesh.get("extras", {}).get("targetNames")
        if not isinstance(names, list):
            raise SystemExit(f"mesh {mesh_index} has no ordered extras.targetNames")
        primitives = mesh.get("primitives", [])
        if len(primitives) != 1 or len(primitives[0].get("targets", [])) != len(names):
            raise SystemExit(f"mesh {mesh_index} target-name/primitive layout differs")
        kept_indices = [i for i, name in enumerate(names) if name in KEEP]
        dropped = [i for i, name in enumerate(names) if name not in KEEP]
        prim = primitives[0]
        for target in prim["targets"]:
            all_target_accessor_ids.update(target.values())
        for target_index in dropped:
            dropped_target_accessor_ids.update(prim["targets"][target_index].values())
        prim["targets"] = [prim["targets"][i] for i in kept_indices]
        mesh["extras"]["targetNames"] = [names[i] for i in kept_indices]
        if "weights" in mesh:
            if len(mesh["weights"]) != len(names):
                raise SystemExit(f"mesh {mesh_index} default weight count differs")
            old_weights[mesh_index] = mesh["weights"]
            mesh["weights"] = [mesh["weights"][i] for i in kept_indices]
        pos_acc = gltf["accessors"][prim["attributes"]["POSITION"]]
        idx_acc = gltf["accessors"][prim["indices"]]
        per_mesh.append({
            "mesh": mesh.get("name", str(mesh_index)),
            "vertices": pos_acc["count"],
            "indices": idx_acc["count"],
            "triangles": idx_acc["count"] // 3,
            "sourceMorphTargets": len(names),
            "retainedMorphTargets": len(kept_indices),
            "retainedNames": [names[i] for i in kept_indices],
        })

    if not all_target_accessor_ids:
        raise SystemExit("no target accessors identified")
    if not all_target_accessor_ids.issubset(refs_before):
        raise SystemExit("morph accessor set contains an unreferenced target")
    keep_accessor_ids = refs_before - dropped_target_accessor_ids
    if any(i < 0 or i >= len(gltf["accessors"]) for i in keep_accessor_ids):
        raise SystemExit("accessor reference out of range")

    # Preserve all ordinary accessor views and image views. Morph targets are
    # repacked as per-accessor sparse chunks so shared source slabs shrink too.
    sparse_target_views: set[int] = set()
    for accessor_id in all_target_accessor_ids:
        accessor = gltf["accessors"][accessor_id]
        if "bufferView" in accessor:
            raise SystemExit(f"target accessor {accessor_id} unexpectedly has a dense bufferView")
        if "sparse" not in accessor:
            if accessor.get("min", [0, 0, 0]) != [0, 0, 0] or accessor.get("max", [0, 0, 0]) != [0, 0, 0]:
                raise SystemExit(f"target accessor {accessor_id} has implicit nonzero data")
            continue
        sparse = accessor["sparse"]
        sparse_target_views.add(sparse["indices"]["bufferView"])
        sparse_target_views.add(sparse["values"]["bufferView"])

    ordinary_views: set[int] = set()
    for accessor_id in keep_accessor_ids:
        accessor = gltf["accessors"][accessor_id]
        if "bufferView" in accessor:
            ordinary_views.add(accessor["bufferView"])
        if "sparse" in accessor:
            ordinary_views.add(accessor["sparse"]["indices"]["bufferView"])
            ordinary_views.add(accessor["sparse"]["values"]["bufferView"])
    for image in gltf.get("images", []):
        if "bufferView" in image:
            ordinary_views.add(image["bufferView"])
    ordinary_views -= sparse_target_views

    new_bin = bytearray()
    new_views: list[dict] = []
    view_map: dict[int, int] = {}

    def append_view(data: bytes, source_view: dict, *, target: int | None = None) -> int:
        align4(new_bin)
        offset = len(new_bin)
        new_bin.extend(data)
        view = {k: v for k, v in source_view.items() if k not in ("buffer", "byteOffset", "byteLength")}
        view["buffer"] = 0
        view["byteOffset"] = offset
        view["byteLength"] = len(data)
        if target is not None:
            view["target"] = target
        new_views.append(view)
        return len(new_views) - 1

    for old_view in sorted(ordinary_views):
        view = gltf["bufferViews"][old_view]
        start = view.get("byteOffset", 0)
        end = start + view["byteLength"]
        if end > len(source_bin):
            raise SystemExit(f"bufferView {old_view} exceeds source BIN")
        view_map[old_view] = append_view(source_bin[start:end], view)

    retained_target_accessor_ids = all_target_accessor_ids - dropped_target_accessor_ids
    for accessor_id in sorted(retained_target_accessor_ids):
        accessor = gltf["accessors"][accessor_id]
        if "sparse" not in accessor:
            continue  # glTF implicit-zero morph target, verified above
        if accessor.get("type") != "VEC3" or accessor.get("componentType") != 5126:
            raise SystemExit(f"target accessor {accessor_id} is not float VEC3")
        sparse = accessor["sparse"]
        count = sparse["count"]
        index_view = gltf["bufferViews"][sparse["indices"]["bufferView"]]
        value_view = gltf["bufferViews"][sparse["values"]["bufferView"]]
        index_size = {5121: 1, 5123: 2, 5125: 4}.get(sparse["indices"]["componentType"])
        if index_size is None:
            raise SystemExit("unsupported sparse index component type")
        index_start = index_view.get("byteOffset", 0) + sparse["indices"].get("byteOffset", 0)
        value_start = value_view.get("byteOffset", 0) + sparse["values"].get("byteOffset", 0)
        index_bytes = count * index_size
        value_bytes = count * 3 * 4
        if index_start + index_bytes > len(source_bin) or value_start + value_bytes > len(source_bin):
            raise SystemExit(f"sparse target {accessor_id} exceeds source BIN")
        new_i = append_view(source_bin[index_start:index_start + index_bytes], index_view)
        new_v = append_view(source_bin[value_start:value_start + value_bytes], value_view)
        sparse["indices"]["bufferView"] = new_i
        sparse["indices"]["byteOffset"] = 0
        sparse["values"]["bufferView"] = new_v
        sparse["values"]["byteOffset"] = 0

    # Drop removed morph accessors, then repair every standard accessor index.
    accessor_map: dict[int, int] = {}
    new_accessors = []
    for old_id, accessor in enumerate(gltf["accessors"]):
        if old_id in dropped_target_accessor_ids:
            continue
        if old_id not in retained_target_accessor_ids and "bufferView" in accessor:
            old_view = accessor["bufferView"]
            if old_view not in view_map:
                raise SystemExit(f"retained accessor {old_id} lost bufferView {old_view}")
            accessor["bufferView"] = view_map[old_view]
        if old_id not in retained_target_accessor_ids and "sparse" in accessor:
            for key in ("indices", "values"):
                old_view = accessor["sparse"][key]["bufferView"]
                if old_view not in view_map:
                    raise SystemExit(f"retained sparse accessor {old_id} lost view {old_view}")
                accessor["sparse"][key]["bufferView"] = view_map[old_view]
        accessor_map[old_id] = len(new_accessors)
        new_accessors.append(accessor)

    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            prim["attributes"] = {k: accessor_map[v] for k, v in prim["attributes"].items()}
            if "indices" in prim:
                prim["indices"] = accessor_map[prim["indices"]]
            for target in prim.get("targets", []):
                for key, value in list(target.items()):
                    target[key] = accessor_map[value]
    for skin in gltf.get("skins", []):
        if "inverseBindMatrices" in skin:
            skin["inverseBindMatrices"] = accessor_map[skin["inverseBindMatrices"]]
    for anim in gltf.get("animations", []):
        for sampler in anim.get("samplers", []):
            sampler["input"] = accessor_map[sampler["input"]]
            sampler["output"] = accessor_map[sampler["output"]]
    for image in gltf.get("images", []):
        if "bufferView" in image:
            image["bufferView"] = view_map[image["bufferView"]]
    gltf["accessors"] = new_accessors
    gltf["bufferViews"] = new_views
    gltf["buffers"][0]["byteLength"] = len(new_bin)

    # Assert the new document's accessor and buffer references are closed.
    for ref in accessor_refs(gltf):
        if ref < 0 or ref >= len(new_accessors):
            raise SystemExit(f"post-pack accessor {ref} is invalid")
    for accessor in new_accessors:
        view_ids = []
        if "bufferView" in accessor:
            view_ids.append(accessor["bufferView"])
        if "sparse" in accessor:
            view_ids.extend(accessor["sparse"][k]["bufferView"] for k in ("indices", "values"))
        for view_id in view_ids:
            if view_id < 0 or view_id >= len(new_views):
                raise SystemExit(f"post-pack bufferView {view_id} is invalid")

    json_bytes = json.dumps(gltf, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    json_bytes += b" " * ((-len(json_bytes)) & 3)
    bin_bytes = bytes(new_bin)
    bin_chunk = bin_bytes + b"\0" * ((-len(bin_bytes)) & 3)
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_chunk)
    dst = bytearray(struct.pack("<4sII", b"glTF", 2, total))
    dst.extend(struct.pack("<I4s", len(json_bytes), b"JSON"))
    dst.extend(json_bytes)
    dst.extend(struct.pack("<I4s", len(bin_chunk), b"BIN\0"))
    dst.extend(bin_chunk)
    dst_path.write_bytes(dst)

    report = {
        "source": str(src_path.name),
        "sourceBytes": len(src),
        "sourceSha256": hashlib.sha256(src).hexdigest(),
        "output": str(dst_path.name),
        "outputBytes": len(dst),
        "outputSha256": hashlib.sha256(dst).hexdigest(),
        "retainedMorphNames": sorted(KEEP),
        "sourceMorphAccessorCount": len(all_target_accessor_ids),
        "retainedMorphAccessorCount": len(retained_target_accessor_ids),
        "removedMorphAccessorCount": len(dropped_target_accessor_ids),
        "sourceAccessorCount": len(refs_before),
        "outputAccessorCount": len(new_accessors),
        "sourceBufferViewCount": source_buffer_view_count,
        "outputBufferViewCount": len(new_views),
        "sourceBinBytes": len(source_bin),
        "outputBinBytes": len(bin_bytes),
        "skinCount": len(gltf.get("skins", [])),
        "jointCount": len(gltf.get("skins", [])[0].get("joints", [])) if gltf.get("skins") else 0,
        "meshCount": len(per_mesh),
        "meshes": per_mesh,
        "limits": {"inputMaxBytes": 16 * 1024 * 1024, "noMorphBake": True, "sourceVertexDataPreserved": True},
    }
    report_path = dst_path.with_suffix(".report.json")
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: report[k] for k in ("sourceBytes", "outputBytes", "sourceSha256", "outputSha256", "sourceMorphAccessorCount", "sourceAccessorCount", "outputAccessorCount", "sourceBinBytes", "outputBinBytes", "jointCount")}, indent=2))
    for item in per_mesh:
        print(f"{item['mesh']}: {item['vertices']} vertices, {item['triangles']} triangles, {item['sourceMorphTargets']} -> {item['retainedMorphTargets']} targets")


if __name__ == "__main__":
    main()
