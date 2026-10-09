# Authored presentation CPU ownership check

The unshimmed production adapter check passes for two actual actors: male with `short02` hair and female with `afro01` hair, both wearing the authored casual suit. It validates the real decoded GLB indices, skin attributes, morph mappings, and skeleton links. Only Vite `?url` imports are rewritten to local file URLs. Raw GLB hashes are verified before image references are stripped for Node decoding. A 1×1 placeholder texture is supplied only where the hair adapter requires a map object; the check makes no pixel or visual-fit claim.

Run:

```sh
node --max-old-space-size=32 --experimental-strip-types evidence/graphics-loop/authored-complete-body-v1/authored-presentation-check.mjs
```

The run passed in 0.40 seconds with a 32 MiB V8 heap and 164,659,200 bytes maximum RSS. Result: `authored-presentation-check-result.json`, SHA-256 `7a2f8334d619f3df604c91206b16cde8b734f1d4aab9b87e3fe7f610a3fa8f08`.

Checks passed for the exact body mask source index and triangle counts; outfit and hair joint indices; nonnegative four-lane weights with per-vertex sums from 0.999999955 to 1.000000043; actor-private skeletons and independent poses; finite posed overlay vertices; exact body-mask restoration; one-time disposal of both suit materials, hair material, and private outfit/hair geometries; and shared Kit-owned body geometry. The suit’s prefixed Mixamo joint names now categorize correctly, and template morph names are available on the sibling meshes.

Inputs were pinned by SHA-256:

| Input | SHA-256 |
| --- | --- |
| `parametric-base-expressive.glb` | `0152129ce2c6022911747f9d7a6df3fdb72a9e6e1bea73db414da1cb8f483077` |
| `clip-pack.glb` | `89a2c636d3a9d1d9eac0e1125c20ca14d030c55ae27561dd8644b30645fd3d47` |
| `male_casualsuit01.glb` | `1f8d4fd4b867785226a9c057562289381ae071cf5acbcca248133a3216ae476f` |
| `body-hide-map.json` | `dbe0c82a3e31da4e6ce37f4f1d9dc8611143c7c9e6dbef72ffea8d281aebe099` |
| `short02-mobile.glb` | `9e2f77d23b6bcf34b5e4fef12c672d73496f5d43ed6a88b7dbf48748dc680a8c` |
| `afro01-mobile.glb` | `3ce7a4c9c42268f3d7333fe1cb1cca9a8529a244ddd98870009b2c6b44a97ce9` |

Checker SHA-256: `b9fe417aa3fadeb8ed8e2352555fac7da06854894682d35f92981b3c2ecc544c`. The adapter and rig hashes recorded by the result are `8c551bd8e797fcf4f8eda3cac64960edf09fbc6ced35d2de1a46596685df1cab` and `d2b03ca536c7507a15c211bf5ed41d764a838f2091e5fedeb6f7e11340c92002`.

The checker does not exercise texture pixels, material appearance, alpha silhouette, renderer `onBeforeRender` morph synchronization, other outfits/accessories, or mobile performance. Those require the separate browser review.
