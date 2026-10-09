# Lossless meshopt body compression

This experiment compresses the complete native body at `../parametric-base-facial.glb` (SHA-256 `9a2ff742bff609ad16219cfc7f2bbca03ac834305c595def364add6ee57c01cd`) with the installed `meshoptimizer` encoder. All 114 bufferViews use `EXT_meshopt_compression` with no quantization, filters, simplification, vertex remapping, or triangle reordering. Attribute and morph streams use `ATTRIBUTES`; source indices and sparse morph index buffers use `INDICES`, which preserves their byte order.

Khronos explicitly supports a required-extension GLB without physically stored uncompressed fallback bytes. Its extension spec says the parent `bufferView` still needs a valid buffer reference, and permits a URI-less placeholder buffer whose declared byteLength covers all uncompressed views. For a GLB, this placeholder should use buffer index 1 or later; if its URI is absent and it does not refer to the GLB BIN chunk, the extension must be listed in `extensionsRequired`. This file follows that pattern: buffer 0 is the GLB BIN containing the compressed streams, and buffer 1 is a URI-less fallback placeholder sized to cover the original views and tagged `EXT_meshopt_compression.fallback: true`. Every parent bufferView points to buffer 1, while its meshopt extension points to buffer 0. No source fallback payload is copied into the compressed GLB.

The source is 2,802,528 B. The generated GLB is 1,600,800 B, a measured reduction of 1,201,728 B (42.9%). Compressed streams contain 1,547,167 payload bytes plus 181 bytes of per-view alignment padding, covering 2,765,014 decoded bufferView bytes.

Primary implementation references:

- [Khronos EXT_meshopt_compression specification, “Fallback buffers”](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_meshopt_compression/README.md#fallback-buffers) documents the required-extension placeholder-buffer layout.
- [meshoptimizer gltfpack `finalizeBufferViews`](https://github.com/zeux/meshoptimizer/blob/master/gltf/gltfpack.cpp) writes compressed streams to the primary BIN, writes raw bufferView data only when a fallback stream is requested, and assigns parent views to the fallback offsets. This confirms optional fallback output.

Recreate and check from the repository root:

```sh
node evidence/graphics-loop/authored-complete-body-v1/authored-body-compression/compress-native-body.mjs
node evidence/graphics-loop/authored-complete-body-v1/authored-body-compression/compress-native-body-check.mjs
```

The check loads both original and compressed files through Three.js `GLTFLoader` with `MeshoptDecoder`, then byte-compares attributes, indices, all position and normal morph arrays, target dictionaries, bone ordering, and inverse bind matrices. It passed 90 comparisons. The Body retains 14,517 vertices, 80,268 indices, 39 position morph targets, and 52 bones; its index SHA-256 remains `4c29f318e20b87a2c0ddce3689fa0ab285ee390fc02e5f3a017736df772a3661`. For CPU-only parsing, the check strips image metadata from a temporary in-memory copy; it does not modify the generated GLB.

No production or viewer files were changed, and no rendered acceptance was performed.
