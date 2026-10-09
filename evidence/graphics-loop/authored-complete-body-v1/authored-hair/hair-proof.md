# MakeHuman hair source audit

This folder pins two small source hairstyles for the authored character experiment. It is source preparation only: no conversion, runtime integration, browser review, or visual acceptance has happened. The full asset packs were not downloaded.

## Selected inputs

The official MakeHuman system-assets listing identifies `afro01` and `short02` as hair assets and marks the system pack CC0. The repository's exact commit and `LICENSE.txt` are pinned in [hair-pin.json](hair-pin.json) and retained in `source/`. Both OBJ, MHCLO, and MHMAT files are individual files below 200 KB. Together, the six source files are 540,949 bytes; the license is another 7,048 bytes.

| Style | OBJ vertices / UVs / faces | Triangle equivalent | MHCLO mapping rows | OBJ SHA-256 | MHCLO SHA-256 |
|---|---:|---:|---:|---|---|
| `afro01` | 2,196 / 2,238 / 1,096 quads | 2,192 | 2,196 | `8344fffef15120a05a89219f31184ca2958537223fa885c885137ad1e97edcb8` | `9977bd4507e2dd1408504b7a39a6f585ffa2d3ba3aa40ad4bdc2844884bbebb5` |
| `short02` | 1,755 / 2,061 / 1,672 quads | 3,344 | 1,755 | `48f979114adfa712165a69cc55c45a70831af1fb3cba8e2a89120f0c87407b64` | `625736cdb73e6d094df6e5a2df18f371781f1d2cd37b0ae15795c5d7051c3ec2` |

`afro01` is the authored curly-style candidate. `short02` is a compact alternate, tagged `Short` and `Male`; the tag is a cue, not proof that it will fit the female morph equally well. Both source meshes are comfortably below a 7,000-triangle hair budget before any conversion or simplification.

The source mesh topology is all quad faces. The audited `afro01` OBJ has 2,950 unique edges, 1,516 boundary edges, no edges used by more than two faces, and 342 connected components. The `short02` OBJ has 3,426 unique edges, 164 boundary edges, no non-manifold edges, and one connected component. The many open components/boundaries in `afro01` are a material/shape review risk; the source topology should not be called a closed scalp shell.

## Fit mapping and body compatibility

Both MHCLO files declare `basemesh hm08`. Each uses `verts 0` followed by one nine-field row for each OBJ vertex: three base-mesh anchor indices, three barycentric weights, then three offsets. The rows' weights sum within `0.99999–1.00001`. MPFB's format documentation describes these weighted mappings and notes that the offsets use MakeHuman's Y-up/Z-depth convention; conversion must preserve that convention or apply its documented axis conversion.

The pinned Anny base OBJ from `three.ws` has a `body` group with 13,380 position IDs, range 0–13,379, made of 13,378 quads. Every anchor in both hair MHCLO files is inside this body group. `short02`'s 1,755 anchor triples all coincide with one of the two possible triangulations of a source quad. For `afro01`, 2,182 of 2,196 triples match; 14 anchor triples still use valid body position IDs but do not match any exact triangle formed from a source quad's corners. This is a source-topology caveat, not a reason to silently change the maps; the converter should retain and report those rows.

The source base OBJ is pinned by SHA-256 `8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c`. The existing skin audit proves its `body` group's `(v,vt)` order matches the authored GLB's 14,517 body UVs within `2.98e-8`. That establishes the model's UV lineage, but the MHCLO anchors still refer to base OBJ position IDs: conversion needs to map those source IDs to authored-body vertices/skin weights, preserving the exact source support and reporting any duplicated UV vertices or unsupported anchors. The MHCLO files contain no `delete_verts` directive, so these hairstyles do not request hiding body geometry.

## Material and bun limits

The MHMAT files are retained and pinned. They reference `afro_diffuse.png` and `short02_diffuse.png`; those image files were not fetched, so no texture bytes or appearance result are claimed. The runtime can use its own hair color while the converter keeps each MHMAT reference available as optional source metadata.

The pinned system-assets repository has no bun style. The separate official Hair 01 pack lists CC0 bun styles, but is a 217 MB pack and is outside this narrowly bounded source selection; no files from it were fetched. `ponytail01` is present in system assets, but it is a ponytail, not a bun. The source audit therefore recommends testing `afro01` first for the current curly-hair problem and treating a bun as a separate future asset search.

## Reproduction and sources

Run `download-hair.py` with the bundled Python runtime. It streams only the six pinned hair files and the license, reads the 1.75 MB pinned base OBJ into memory for anchor checks, validates file lengths/SHA-256/Git blob IDs, MHCLO mapping counts/weights, body-group anchor ranges, and the existing GLB UV proof. The latest run passed in 8.46 seconds with 45,023,232 bytes peak RSS and wrote `hair-pin.json`. No local browser, server, build, or runtime source was touched.

- [MakeHuman system assets listing](https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html)
- [Pinned MakeHuman asset repository commit](https://github.com/s20220526/makehuman-assets/tree/8cf9645b975a98eea056b140df11a1d278da0d10)
- [MakeHuman MPFB MHCLO format documentation](https://github.com/makehumancommunity/mpfb2/blob/master/docs/entities/clothes/mhclo.md)
- [Hair 01 pack listing](https://static.makehumancommunity.org/assets/assetpacks/hair01.html)
