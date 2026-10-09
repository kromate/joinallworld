#!/usr/bin/env python3
"""Fetch the two pinned MakeHuman system skin maps and make mobile-size comparisons.

The PNGs are downloaded individually, streamed, and SHA-256/length checked against
their Git LFS pointers. The 1.75 MB base OBJ is fetched only into memory for a
reproducible UV check; it is not copied into this folder or runtime assets.
"""
from __future__ import annotations

import hashlib
import json
import struct
import urllib.request
from pathlib import Path

try:
    from PIL import Image, __version__ as PILLOW_VERSION
except ImportError:  # Download/provenance/UV proof still works without conversion.
    Image = None
    PILLOW_VERSION = None


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
ASSET_COMMIT = "8cf9645b975a98eea056b140df11a1d278da0d10"
BUILD_COMMIT = "ec8d1d270b93b8e2e87e8a6160bb908665fe1fcd"
SYSTEM_ASSET_ROOT = "https://download.tuxfamily.org/makehuman/assets/1.1/base/skins/textures"
RAW_GITHUB = f"https://raw.githubusercontent.com/s20220526/makehuman-assets/{ASSET_COMMIT}"
BUILD_RAW = f"https://raw.githubusercontent.com/nirholas/three.ws/{BUILD_COMMIT}"
GLB = REPO / "evidence/graphics-loop/authored-character-spike-v1/parametric-base-expressive.glb"
GLB_SHA256 = "0152129ce2c6022911747f9d7a6df3fdb72a9e6e1bea73db414da1cb8f483077"
BASE_OBJ_SHA256 = "8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c"
BASE_OBJ_BYTES = 1_749_303
LICENSE_GIT_BLOB = "0e259d42c996742e9e3cba14c677129b2c1b6311"
MAX_FILE_BYTES = 2_000_000

SKINS = {
    "male": {
        "name": "middleage_african_male",
        "png": "middleage_darkskinned_male_diffuse.png",
        "mhmat": "base/skins/middleage_african_male/middleage_african_male.mhmat",
        "mhmat_blob_sha1": "07afe889be8d2e0a62a96fdcfce62689cda8475b",
        "bytes": 3_046_762,
        "sha256": "ced478cfdd2b86391f0f92a4408b287ad70adb0dd0e9271ba606d0b028b47c6b",
        "git_lfs_sha256": "ced478cfdd2b86391f0f92a4408b287ad70adb0dd0e9271ba606d0b028b47c6b",
    },
    "female": {
        "name": "middleage_african_female",
        "png": "middleage_darkskinned_female_diffuse.png",
        "mhmat": "base/skins/middleage_african_female/middleage_african_female.mhmat",
        "mhmat_blob_sha1": "d0724fe4f3995782411dff606c7bd2fd14d7a1ad",
        "bytes": 4_197_671,
        "sha256": "c3c9ab972ad46fbda64cedfd1d0a626c2a8e739fd345c4c349102eaacc947699",
        "git_lfs_sha256": "c3c9ab972ad46fbda64cedfd1d0a626c2a8e739fd345c4c349102eaacc947699",
    },
}


def read_limited(url: str, max_bytes: int) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "Allworld skin UV audit"})
    with urllib.request.urlopen(request, timeout=30) as response:
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = response.read(64 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise ValueError(f"response exceeds bounded read ({max_bytes} bytes): {url}")
            chunks.append(chunk)
    return b"".join(chunks)


def fetch_verified(url: str, destination: Path, expected_bytes: int, expected_sha256: str) -> dict[str, object]:
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "Allworld skin asset audit"})
    temporary = destination.with_suffix(destination.suffix + ".partial")
    digest = hashlib.sha256()
    total = 0
    try:
        with urllib.request.urlopen(request, timeout=30) as response, temporary.open("wb") as output:
            while True:
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > expected_bytes:
                    raise ValueError(f"download exceeded pinned length: {url}")
                digest.update(chunk)
                output.write(chunk)
        actual_sha = digest.hexdigest()
        if total != expected_bytes or actual_sha != expected_sha256:
            raise ValueError(f"pin mismatch for {url}: bytes={total}, sha256={actual_sha}")
        temporary.replace(destination)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    return {"url": url, "bytes": total, "sha256": digest.hexdigest(), "path": destination.relative_to(HERE).as_posix()}


def git_blob_sha1(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def parse_glb(path: Path) -> tuple[dict, bytes]:
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != GLB_SHA256:
        raise ValueError("pinned expressive GLB hash differs")
    if data[:4] != b"glTF" or struct.unpack_from("<I", data, 4)[0] != 2:
        raise ValueError("expected GLB v2")
    cursor = 12
    doc, binary = None, None
    while cursor < len(data):
        length, kind = struct.unpack_from("<II", data, cursor)
        cursor += 8
        chunk = data[cursor:cursor + length]
        cursor += length
        if kind == 0x4E4F534A:
            doc = json.loads(chunk.decode("utf-8").rstrip(" \t\r\n\0"))
        elif kind == 0x004E4942:
            binary = chunk
    if doc is None or binary is None:
        raise ValueError("GLB is missing JSON or BIN chunk")
    return doc, binary


def accessor_floats(doc: dict, binary: bytes, accessor_index: int, width: int) -> list[tuple[float, ...]]:
    accessor = doc["accessors"][accessor_index]
    view = doc["bufferViews"][accessor["bufferView"]]
    if accessor["componentType"] != 5126 or accessor["type"] != {2: "VEC2", 3: "VEC3"}[width]:
        raise ValueError("expected float VEC2/VEC3 accessor")
    offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    stride = view.get("byteStride", width * 4)
    return [struct.unpack_from("<" + "f" * width, binary, offset + i * stride) for i in range(accessor["count"])]


def source_body_uvs(obj_text: str) -> list[tuple[float, float]]:
    uvs: list[tuple[float, float]] = []
    seen: set[tuple[int, int]] = set()
    result: list[tuple[float, float]] = []
    group = ""
    for line in obj_text.splitlines():
        if line.startswith("vt "):
            _, u, v, *_ = line.split()
            uvs.append((float(u), float(v)))
        elif line.startswith("g "):
            group = line[2:].strip()
        elif line.startswith("f ") and group == "body":
            for corner in line[2:].split():
                values = corner.split("/")
                key = (int(values[0]) - 1, int(values[1]) - 1 if len(values) > 1 and values[1] else -1)
                if key in seen:
                    continue
                seen.add(key)
                u, v = uvs[key[1]] if key[1] >= 0 else (0.0, 0.0)
                result.append((u, 1.0 - v))  # Upstream builder's OBJ→glTF V flip.
    return result


def uv_and_cheek_proof(base_obj: bytes, textures: dict[str, Path]) -> dict[str, object]:
    source_hash = hashlib.sha256(base_obj).hexdigest()
    if len(base_obj) != BASE_OBJ_BYTES or source_hash != BASE_OBJ_SHA256:
        raise ValueError(f"pinned base OBJ mismatch: bytes={len(base_obj)} sha256={source_hash}")
    doc, binary = parse_glb(GLB)
    body = next(mesh for mesh in doc["meshes"] if mesh["name"] == "Body")["primitives"][0]
    positions = accessor_floats(doc, binary, body["attributes"]["POSITION"], 3)
    actual_uvs = accessor_floats(doc, binary, body["attributes"]["TEXCOORD_0"], 2)
    expected_uvs = source_body_uvs(base_obj.decode("utf-8"))
    if len(expected_uvs) != len(actual_uvs):
        raise ValueError(f"UV count mismatch source={len(expected_uvs)} GLB={len(actual_uvs)}")
    max_error = max((abs(a - b) for expected, actual in zip(expected_uvs, actual_uvs) for a, b in zip(expected, actual)), default=0.0)
    if max_error > 1e-7:
        raise ValueError(f"source/GLB UV correspondence exceeded tolerance: {max_error}")

    cheek_rules = {"absXMetres": [0.032, 0.078], "yMetres": [1.505, 1.535], "zGreaterThanMetres": 0.13,
                   "description": "front-facing lateral cheek vertices; excludes central nose/mouth and eye/brow height"}
    cheek_indices = [i for i, (p, uv) in enumerate(zip(positions, actual_uvs))
                     if cheek_rules["absXMetres"][0] <= abs(p[0]) <= cheek_rules["absXMetres"][1]
                     and cheek_rules["yMetres"][0] <= p[1] <= cheek_rules["yMetres"][1]
                     and p[2] > cheek_rules["zGreaterThanMetres"]]
    if not cheek_indices:
        raise ValueError("cheek sample rule selected no source vertices")

    cheek_reference: dict[str, object] = {}
    for family, image_path in textures.items():
        with Image.open(image_path) as image:
            rgb = image.convert("RGB")
            width, height = rgb.size
            sums = [0.0, 0.0, 0.0]
            pixels: set[tuple[int, int]] = set()
            for index in cheek_indices:
                u, v = actual_uvs[index]
                px = min(width - 1, max(0, round(u * (width - 1))))
                # The GLB UV is (u, 1-OBJ-v), and GLTFLoader uses flipY=false;
                # Pillow's top-origin row therefore uses the already-flipped GLB v.
                py = min(height - 1, max(0, round(v * (height - 1))))
                pixels.add((px, py))
            for px, py in pixels:
                srgb = rgb.getpixel((px, py))
                for channel, value in enumerate(srgb):
                    c = value / 255.0
                    sums[channel] += c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
            cheek_reference[family] = {
                "sampleRule": cheek_rules,
                "bodyVertexSamples": len(cheek_indices),
                "uniqueTexturePixels": len(pixels),
                "linearRgbMean": [value / len(pixels) for value in sums],
                "srgbMean": [value / len(pixels) for value in [
                    sum(rgb.getpixel(pixel)[c] / 255.0 for pixel in pixels) for c in range(3)
                ]],
                "textureSize": [width, height],
                "pixelVConvention": "GLB TEXCOORD_0 V is already OBJ V-flipped; use y = V*(height-1) for top-origin PNG rows (GLTFLoader flipY=false)",
            }
    return {
        "sourceBaseObj": {"url": f"{BUILD_RAW}/avatar-sources/anny/3dobjs/base.obj", "bytes": len(base_obj), "sha256": source_hash},
        "sourceBuilder": {"url": f"{BUILD_RAW}/scripts/build-parametric-base.mjs", "commit": BUILD_COMMIT,
                          "mapping": "Body group, unique (v,vt) key, TEXCOORD_0=(u,1-v)"},
        "authoredBodyGlb": {"sha256": GLB_SHA256, "uvCount": len(actual_uvs), "positionCount": len(positions)},
        "uvComparison": {"expectedSourceUvCount": len(expected_uvs), "actualGlbUvCount": len(actual_uvs),
                         "maxAbsoluteFloatError": max_error, "passes": max_error <= 1e-7},
        "cheekColorReference": cheek_reference,
    }


def convert_mobile_variants(originals: dict[str, Path]) -> dict[str, object]:
    if Image is None:
        return {"available": False, "reason": "Pillow is not installed in this Python interpreter"}
    outputs: dict[str, object] = {"available": True, "pillowVersion": PILLOW_VERSION, "variants": {}}
    for family, source in originals.items():
        with Image.open(source) as opened:
            rgb = opened.convert("RGB")
            per_family: dict[str, object] = {}
            for side in (1024, 512):
                variant = rgb.resize((side, side), Image.Resampling.LANCZOS)
                path = HERE / "mobile" / str(side) / f"middleage_african_{family}_q90.jpg"
                path.parent.mkdir(parents=True, exist_ok=True)
                variant.save(path, format="JPEG", quality=90, subsampling=0, optimize=True, progressive=True)
                content = path.read_bytes()
                per_family[str(side)] = {"path": path.relative_to(HERE).as_posix(), "width": side, "height": side,
                                         "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest(), "quality": 90,
                                         "subsampling": "4:4:4", "resampler": "Lanczos"}
            outputs["variants"][family] = per_family
    return outputs


def main() -> None:
    if Image is None:
        print("NOTE: Pillow unavailable; PNG download/UV proof will run, JPEG comparisons skipped.")
    source_dir = HERE / "source"
    assets: dict[str, object] = {}
    images: dict[str, Path] = {}
    material_proof: dict[str, object] = {}
    for family, spec in SKINS.items():
        path = source_dir / spec["png"]
        url = f"{SYSTEM_ASSET_ROOT}/{spec['png']}"
        assets[family] = fetch_verified(url, path, spec["bytes"], spec["sha256"])
        images[family] = path
        mhmat_url = f"{RAW_GITHUB}/{spec['mhmat']}"
        mhmat_bytes = read_limited(mhmat_url, 16_384)
        if git_blob_sha1(mhmat_bytes) != spec["mhmat_blob_sha1"]:
            raise ValueError(f"MHMAT Git blob hash mismatch: {family}")
        mhmat_path = source_dir / Path(spec["mhmat"]).name
        mhmat_path.parent.mkdir(parents=True, exist_ok=True)
        mhmat_path.write_bytes(mhmat_bytes)
        text = mhmat_bytes.decode("utf-8")
        expected_tag = f"tag {spec['name'].split('_')[1]}"
        expected_texture = f"diffuseTexture ../textures/{spec['png']}"
        if expected_texture not in text or "tag middleage" not in text or expected_tag not in text:
            raise ValueError(f"MHMAT does not establish expected skin/age mapping: {family}")
        material_proof[family] = {"url": mhmat_url, "path": mhmat_path.relative_to(HERE).as_posix(),
                                  "gitBlobSha1": spec["mhmat_blob_sha1"], "sha256": hashlib.sha256(mhmat_bytes).hexdigest(),
                                  "bytes": len(mhmat_bytes), "textureReference": expected_texture}

    license_url = f"{RAW_GITHUB}/LICENSE.txt"
    license_bytes = read_limited(license_url, 32_768)
    if git_blob_sha1(license_bytes) != LICENSE_GIT_BLOB:
        raise ValueError("CC0 asset license Git blob pin mismatch")
    license_path = source_dir / "LICENSE.txt"
    license_path.write_bytes(license_bytes)

    base_obj_url = f"{BUILD_RAW}/avatar-sources/anny/3dobjs/base.obj"
    base_obj = read_limited(base_obj_url, MAX_FILE_BYTES)
    uv_proof = uv_and_cheek_proof(base_obj, images)
    mobile = convert_mobile_variants(images)
    pin = {
        "source": "MakeHuman system assets, base skins; CC0 1.0",
        "systemAssetPage": "https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html",
        "assetRepository": "https://github.com/s20220526/makehuman-assets",
        "assetCommit": ASSET_COMMIT,
        "assetCommitDate": "2022-12-18T13:24:49Z",
        "assetCommitTreeSha": ASSET_COMMIT,
        "license": {"url": license_url, "path": license_path.relative_to(HERE).as_posix(),
                    "gitBlobSha1": LICENSE_GIT_BLOB, "sha256": hashlib.sha256(license_bytes).hexdigest(), "bytes": len(license_bytes)},
        "images": {family: {**SKINS[family], **assets[family], "dimensions": [2048, 2048], "channels": "RGB",
                            "lfsOidSha256": SKINS[family]["git_lfs_sha256"]} for family in SKINS},
        "materials": material_proof,
        "uvCompatibility": uv_proof,
        "mobileComparisons": mobile,
        "scope": "Audit/proof assets only; no production or runtime asset was changed.",
    }
    (HERE / "uv-proof.json").write_text(json.dumps(uv_proof, indent=2) + "\n")
    (HERE / "skin-pin.json").write_text(json.dumps(pin, indent=2) + "\n")
    print(json.dumps(pin, indent=2))


if __name__ == "__main__":
    main()
