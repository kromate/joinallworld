#!/usr/bin/env python3
"""Downsample only embedded hair PNGs in existing GLBs; geometry bytes remain unchanged."""
import argparse
import hashlib
import io
import json
import struct
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
EXPECTED = {
    "short02": {
        "input": "short02.glb",
        "originalGlb": "2ebb82af65352ccf72e1108c8d4a7e2ec206b991061abc5018a44bd54343abee",
        "textureSha": "47fe33831a3929567c733356dd66243116e05df2ace1f884ddca0080b728229f",
        "textureBytes": 3_553_543,
    },
    "afro01": {
        "input": "afro01.glb",
        "originalGlb": "510b3d92625608892299a9e2e1edd64ae8fea4adc87a5cd41f891224c614fa68",
        "textureSha": "dc0db7dd8a13802f02303ca7e49844b219e09db134471b7061538a8af8f7c7fb",
        "textureBytes": 4_817_185,
    },
}
MAX_PNG_BYTES = 500_000


def parse_glb(data):
    magic, version, total = struct.unpack_from("<III", data)
    if magic != 0x46546C67 or version != 2 or total != len(data):
        raise ValueError("expected a complete GLB v2")
    json_len, json_type = struct.unpack_from("<II", data, 12)
    if json_type != 0x4E4F534A:
        raise ValueError("GLB first chunk must be JSON")
    json_start, json_end = 20, 20 + json_len
    document = json.loads(data[json_start:json_end].decode("utf-8"))
    bin_len, bin_type = struct.unpack_from("<II", data, json_end)
    if bin_type != 0x004E4942 or json_end + 8 + bin_len != len(data):
        raise ValueError("invalid GLB binary chunk")
    return document, data[json_end + 8:], json_start, json_end, json_end + 8


def alpha_counts(image):
    histogram = image.getchannel("A").histogram()
    return {"transparent": histogram[0], "partial": sum(histogram[1:255]), "opaque": histogram[255]}


def encode_texture(png):
    with Image.open(io.BytesIO(png)) as original:
        original.load()
        if original.mode != "RGBA" or original.size != (2048, 2048):
            raise ValueError(f"expected 2048x2048 RGBA pinned texture, got {original.size} {original.mode}")
        alpha_extrema = original.getchannel("A").getextrema()
        if alpha_extrema != (0, 255):
            raise ValueError(f"texture has unexpected alpha range {alpha_extrema}")
        source_alpha_counts = alpha_counts(original)
        if source_alpha_counts["transparent"] == 0 or source_alpha_counts["opaque"] == 0:
            raise ValueError("source texture alpha channel must contain transparent and opaque pixels")
        attempts = []
        for resolution in (1024, 512):
            # Resize premultiplied pixels so transparent RGB does not bleed a
            # background fringe into partially transparent strand edges.
            with original.convert("RGBa") as premultiplied:
                reduced = premultiplied.resize((resolution, resolution), Image.Resampling.LANCZOS)
                rgba = reduced.convert("RGBA")
                output = io.BytesIO()
                rgba.save(output, format="PNG", optimize=True, compress_level=9)
                result = output.getvalue()
                output.close()
                rgba.close()
            attempts.append({"resolution": [resolution, resolution], "pngBytes": len(result)})
            if len(result) <= MAX_PNG_BYTES:
                with Image.open(io.BytesIO(result)) as check:
                    check.load()
                    if check.mode != "RGBA" or check.size != (resolution, resolution):
                        raise ValueError("encoded mobile texture failed mode or dimension check")
                    if check.getchannel("A").getextrema() != alpha_extrema:
                        raise ValueError("resized texture did not retain transparent and opaque alpha endpoints")
                    mobile_alpha_counts = alpha_counts(check)
                    if mobile_alpha_counts["transparent"] == 0 or mobile_alpha_counts["opaque"] == 0:
                        raise ValueError("mobile texture alpha channel lost transparent or opaque pixels")
                return result, resolution, alpha_extrema, source_alpha_counts, mobile_alpha_counts, attempts
        raise ValueError("512px PNG still exceeds the 500KB embedded texture budget")


def rewrite_glb(name, input_path, output_path):
    spec = EXPECTED[name]
    original = input_path.read_bytes()
    if hashlib.sha256(original).hexdigest() != spec["originalGlb"]:
        raise ValueError(f"original {name} GLB changed; refusing to rewrite unexpected geometry")
    document, binary, json_start, json_end, bin_start = parse_glb(original)
    if len(document.get("images", [])) != 1:
        raise ValueError(f"expected exactly one source diffuse image in {name}")
    view_index = document["images"][0]["bufferView"]
    view = document["bufferViews"][view_index]
    offset, old_length = view["byteOffset"], view["byteLength"]
    original_png = binary[offset:offset + old_length]
    if len(original_png) != spec["textureBytes"] or hashlib.sha256(original_png).hexdigest() != spec["textureSha"]:
        raise ValueError(f"embedded {name} image does not match the already pinned CC0 texture")
    if offset + old_length > len(binary) or len(binary) - (offset + old_length) > 3:
        raise ValueError("texture bufferView must be last except GLB alignment padding")
    new_png, resolution, alpha_range, source_alpha_counts, mobile_alpha_counts, texture_attempts = encode_texture(original_png)
    # Preserve all geometry and accessor bytes verbatim. The only binary section
    # replaced is the last image bufferView, followed by fresh 4-byte padding.
    prefix = binary[:offset]
    new_binary = bytearray(prefix)
    new_binary.extend(new_png)
    new_binary.extend(b"\0" * ((4 - len(new_binary) % 4) % 4))
    geometry_hash = hashlib.sha256(prefix).hexdigest()
    view["byteLength"] = len(new_png)
    document["buffers"][0]["byteLength"] = len(new_binary)
    json_chunk = json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    json_chunk += b" " * ((4 - len(json_chunk) % 4) % 4)
    total = 12 + 8 + len(json_chunk) + 8 + len(new_binary)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as out:
        out.write(struct.pack("<III", 0x46546C67, 2, total))
        out.write(struct.pack("<II", len(json_chunk), 0x4E4F534A))
        out.write(json_chunk)
        out.write(struct.pack("<II", len(new_binary), 0x004E4942))
        out.write(new_binary)

    # Re-read output and prove every pre-image geometry byte and mesh declaration
    # survives unchanged; only image size and container lengths may differ.
    output_doc, output_binary, _, _, _ = parse_glb(output_path.read_bytes())
    if output_binary[:offset] != prefix or hashlib.sha256(output_binary[:offset]).hexdigest() != geometry_hash:
        raise ValueError("geometry/accessor binary changed during texture rewrite")
    for key in ("nodes", "meshes", "accessors", "bufferViews"):
        if key == "bufferViews":
            left = [v for i, v in enumerate(document[key]) if i != view_index]
            right = [v for i, v in enumerate(output_doc[key]) if i != view_index]
        else:
            left, right = document[key], output_doc[key]
        if left != right:
            raise ValueError(f"non-image GLB declaration changed: {key}")
    return {
        "asset": name,
        "originalGlbBytes": len(original),
        "originalGlbSha256": hashlib.sha256(original).hexdigest(),
        "mobileGlb": str(output_path),
        "mobileGlbBytes": output_path.stat().st_size,
        "mobileGlbSha256": hashlib.sha256(output_path.read_bytes()).hexdigest(),
        "sourceTextureBytes": old_length,
        "mobileTextureBytes": len(new_png),
        "textureBytesSaved": old_length - len(new_png),
        "textureReductionPercent": round((1 - len(new_png) / old_length) * 100, 2),
        "mobileGlbBytesSaved": len(original) - output_path.stat().st_size,
        "textureResolution": [resolution, resolution],
        "textureAttempts": texture_attempts,
        "textureMode": "RGBA",
        "alphaExtrema": list(alpha_range),
        "sourceAlphaPixelCounts": source_alpha_counts,
        "mobileAlphaPixelCounts": mobile_alpha_counts,
        "mobileTextureSha256": hashlib.sha256(new_png).hexdigest(),
        "geometryAndAccessorPrefixSha256": geometry_hash,
        "geometryAndAccessorPrefixBytes": offset,
        "nonImageGeometryBytesIdentical": True,
        "meshAccessorDeclarationsIdentical": True,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", type=Path, default=HERE)
    parser.add_argument("--output-dir", type=Path, default=HERE)
    args = parser.parse_args()
    results = []
    for name, spec in EXPECTED.items():
        source = args.input_dir / spec["input"]
        output = args.output_dir / f"{name}-mobile.glb"
        results.append(rewrite_glb(name, source, output))
    report = {"schema": "joinallworld.mobile-hair-texture-bake.v1", "pillowVersion": Image.__version__, "textureSelection": "try optimized premultiplied-alpha Lanczos 1024x1024; if PNG exceeds 500,000 bytes, use 512x512", "sourceGeometryPolicy": "replace only final embedded image bufferView; verify all bytes before it and geometry/accessor JSON remain unchanged", "assets": results}
    report_path = args.output_dir / "mobile-hair-report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"report": str(report_path), "assets": results}, indent=2))


if __name__ == "__main__":
    main()
