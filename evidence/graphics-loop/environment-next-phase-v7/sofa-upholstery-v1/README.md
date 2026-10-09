# Isolated sofa upholstery prototype

`home-scene-before.ts` and `home-scene-candidate.ts` are ignored diagnostic copies of the current Home builder. Their imports are rebased to the current primary source graph. The only candidate behavior changes are an isolated planar beveled cushion helper and replacement of the sofa's two stacked box pads per seat with a core plus five closed bevel/top quads. No production source, state, anchors, collision data, material, texture, or draw layer was changed.

The focused Node test instantiates both actual builders with the same Lagos furniture state and production `createKit`/`createLife`. It compares furniture draw meshes, triangles and geometry-array bytes, placed objects, walk solids, entrance, walk bounds and selected occupancy samples; it also verifies seat-anchor equality and cushion face winding/edge closure.

Command: `node --experimental-strip-types --test evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1/sofa-upholstery.test.mjs` (3 passed). Measured furniture batch cost: Velvet Sofa 192→184 triangles and 14,976→14,352 bytes; Family Sofa 240→228 triangles and 18,720→17,784 bytes; each remains one merged furniture mesh. Diagnostic full-source clone delta is +1,354 raw / +415 gzip / +341 Brotli bytes; this is not a production lazy-chunk measurement.

Visual acceptance is pending. The prototype still needs matched gameplay-distance and close day/night views, including a seated avatar and at least front/three-quarter angles. The bevel may be rejected if it does not read as upholstery in those images.

An optional matched browser fixture source is staged as `index-sofa-compare.html` / `viewer-sofa-compare.ts`. It keeps the same actual host, state, furniture, crowd, scenes, and controls in both modes; only the Home builder changes between the production Home scene and this clone. It has not been bundled, served, or viewed.
