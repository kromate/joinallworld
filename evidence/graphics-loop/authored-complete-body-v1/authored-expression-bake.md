# Authored facial expression bake

The new `parametric-base-facial.glb` adds five source-authored facial morphs to the pinned complete-body actor while keeping its original four meshes, geometry, UVs, joints, and morph data intact.

| Mesh | Added target names |
| --- | --- |
| Body | `nativeFacialBlinkLeft`, `nativeFacialBlinkRight`, `nativeFacialJawOpen`, `nativeFacialSmileLeft`, `nativeFacialSmileRight` |
| Eyes | none |
| Teeth | `nativeFacialJawOpen` |
| Tongue | `nativeFacialJawOpen` |

The targets come from the pinned MakeHuman `extra-targets` `faceunits01` pack at `7eaba3453134385bb5ea9811ef0b33b85b4b556d`. The pack metadata and repository license both declare CC0 1.0. The bake script verifies SHA-256 and exact byte length for the input actor, official targets, pack metadata, license, hm08 OBJ, and group metadata. It maps target rows by original hm08 vertex IDs and expands them to the actor's exact UV seam duplicates.

The output is 2,802,528 bytes, SHA-256 `9a2ff742bff609ad16219cfc7f2bbca03ac834305c595def364add6ee57c01cd`. It is 109,544 bytes larger than the source actor. New targets use glTF sparse FLOAT VEC3 accessors with unsigned-short vertex indices. Decoded output is exactly equal to dense candidate arrays (max component error 0); the sparse payload is 105,686 bytes versus 875,688 dense bytes, saving 770,002 payload bytes. Blink closes the source lid loops from a measured 4.746 mm mean gap to a slight 0.161 mm overlap at weight 1. `jawOpen` maps to 2,249 body rows, 68 lower-teeth rows, and 226 tongue rows. The two official smile targets map to 1,640 and 1,641 body source rows.

Run `node bake-authored-expressions.mjs` from this directory to recreate the GLB and [machine-readable report](./authored-expression-bake-report.json). The script decodes both source and output through the project Three.js GLTFLoader and confirms that original attributes, indices, and morphs are byte-identical, and that sparse targets decode exactly to dense arrays. The new targets contain POSITION deltas only, matching the source pack's target convention. Render acceptance with the existing eye geometry and family/head morphs remains pending.
