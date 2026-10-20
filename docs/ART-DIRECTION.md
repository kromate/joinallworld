# Art direction

Written 20 October 2026 (open-source plan, Phase 12). One page: what every model, texture and scene must be, so that assets made
by different hands, tools and sessions look like one world. The numbers are enforced by code where code can enforce them; this page
says where. How files are made and checked is in [ASSET-PIPELINE.md](ASSET-PIPELINE.md); where each shipped file came from is in
[ASSETS.md](ASSETS.md); how a change is judged is in [EVIDENCE.md](EVIDENCE.md).

## 1. The frame (fixed; not a matter of taste)

- **Scale.** 1.5 scene units to the metre (`UNITS_PER_METRE`, `src/scene/street-life/street-scene.ts`), and real sizes: a person
  is 1.7 m to the eye, a car about 4 m. A model whose size is wrong is wrong, not "stylised": `prepare.ts` refuses one.
- **Camera.** The street is seen from the pavement at eye height; a home from a raised, isometric view. An asset
  must read at the size it is drawn on a phone, not at the size it was modelled.
- **Texture.** One 1024 px WebP per model, or one per family of models that share it. Light is baked into the colour (ambient
  occlusion in corners, under eaves, where things meet the ground), so a model needs no shadow map of its own.
- **Triangles.** At most 3,000 for a character and 1,500 for a prop or vehicle (`CAPS`, `scripts/assets/pack-types.ts`), and a
  whole screen under 60,000 to 100,000 triangles and 60 draw calls. The fix for a refusal is a lighter model, never a higher cap.
- **The phone tier is the floor.** Every asset must look finished on the plain renderer with no post-processing and no AO pass.
  The HIGH tier may add to it and never repairs it.

## 2. The look Allworld already has

- **Low-poly done well.** Straight walls, clean edges, flat or lightly painted surfaces, shading baked in, no outline pass. A
  lumpy generated mesh fails this however detailed it is.
- **Palette.** The app's green `#183b2a` and amber `#e8a643`; cream, a warm red and a blue; concrete greys; a dark `#20232c`; two
  grass greens. The values are `PALETTE` in `scripts/assets/blender/common.py`: add a colour there, with its role, before using one.
- **Bodies.** Warm, expressive, human proportions: not toy-like, not realistic. The world has two shipped skeletons (the male and
  female bodies in `src/scene/body/assets/`, [ASSETS.md](ASSETS.md)); every outfit, hair and motion goes onto those, and a third
  body is never added.
- **Local idiom is the test of "looks like here".** A Yaba face-me-I-face-you (a long two-storey block, rooms on both sides of a
  central passage, balconies and a shared line of doors), a Lekki duplex (rendered walls, flat roof, big glass, a boundary wall
  and gate), a Kano compound (earth-coloured mud-brick walls, flat roofs, a decorated parapet). A grey box with a different sign
  on it is not a different city.

## 3. Families: approve one, then make the rest

Before producing a family (ten shopfronts, six danfo liveries, a set of stalls) make **one hero asset**, put it in the game at
game scale, and have it pass section 5. Then make the family with the **palette, proportions and edge treatment held fixed**; only
the stated variables change (colour, signs, one feature). If a later member drifts, go back to the hero and make a constrained
change; do not keep editing the drifted copy. Names, pivots and sizes are set by script, not by eye.

## 4. Zero assets first

Props, interiors and street dressing are **built by code** (the generators in `src/scene/`, the vertex-colour kit, the AO bake)
unless a file clearly beats the generator **in the game, at native scale, in the same view**. A file costs bytes, a request, a
provenance row and a licence to read; a generator costs none of these and can vary by seed. A file earns its place for one thing
the generator cannot do (a hero vehicle, a landmark, a face), and the evidence is the two screenshots side by side. An
existing example: the buka's stew pot is a CC0 model baked into the scene's own arrays, so it needs no loader and no request.

## 5. Acceptance gates

An asset or scene is accepted only when all of these hold:

1. **Judged in the game**, on the evidence harness (`scripts/evidence/shoot.ts`), at the three reference views and the phone size.
   Never from a render in a modelling tool: `preview.py` shows a model for a first look, not for acceptance.
2. **The scorecard** ([EVIDENCE.md](EVIDENCE.md)): scored by a critic who did not build it; no category under 2 and an average of
   2.3 or more for a change that claims to look better.
3. **The numbers pass**: `npm run assets:budget` (caps, texture size, game bytes) and the scene's own budgets in CI.
4. **Provenance is recorded** and the licence is read: a real manifest for a CC0, CC BY or own pack (`scripts/assets/manifests/`),
   or a row in `scripts/assets/provenance/` while the terms are not yet read. A file with neither is not merged.
5. **Nothing from another game**: no model, name, logo or look copied from a commercial game.
