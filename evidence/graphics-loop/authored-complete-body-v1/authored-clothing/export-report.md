# Offline authored-clothing export report

The bounded exporter completed on the pinned MakeHuman inputs. It produced a 1,120,612-byte GLB (SHA-256 `1f8d4fd4b867785226a9c057562289381ae071cf5acbcca248133a3216ae476f`) and body-hide map without changing the source body or adding runtime dependencies.

Measured output:

- Authored outfit: 8,426 source vertices, 8,984 vertices after preserving OBJ UV seams, 16,672 triangles.
- MHCLO map: 8,426 rows and 2,284 unique anchor vertices, all inside source group `helper-tights` (indices 15,328–18,001). Every referenced source vertex has weights in the pinned `weights.mixamo.json`.
- Skin transfer: all 52 pinned rig bones are represented; 37 negative lanes from extrapolative MHCLO blends were clamped to zero before strongest-four selection and normalization. An independent GLB decode reports `WEIGHTS_0` min 0, max 1, and per-vertex sums of 1. No zero-sum fallback was needed for this bake; its deterministic rule is recorded in `body-hide-map.json`. No nearest-neighbor path exists.
- Body deletion: 3,364 fully covered body quads are hidden as 6,728 source-order triangles. Boundary quads with any non-deleted vertex remain.
- Male-fit check against the authored garment OBJ: mean 0.141, p95 0.220, maximum 0.301 MakeHuman units (1.41 cm, 2.20 cm, 3.01 cm after scale).
- GLB morphs: `bodyFeminine` and `bodyMasculine`, made from the upstream builder's sex-specific three-ethnicity average target recipes.

`/usr/bin/time -l` measured 0.71 seconds wall time and 108,380,160 bytes maximum resident set (about 103.4 MiB) on this machine, under the 45-second / 128-MiB ceiling. The offline structural test passed all four checks. The source cache is outside the workspace under the system temporary directory and each source file is hash-checked on read.

This is export/source evidence only. No browser, viewer, project build, or render was run. Clothing behavior during animation, fit across morphs, body hide mapping against the runtime body's exact primitive order, and final material appearance still need integration and remote visual review.
