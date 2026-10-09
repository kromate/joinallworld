# Combined authored clothing/body/shoe A/B (diagnostic only)

This fixture uses the same prepared actor, normalized look, seed, pose and view for each source/candidate image pair. The candidate combines:

- Trouser-hem sock-triangle removal on male office trousers and both casual looks, using the private shoe-index helper. Female office is an explicit skirt no-op.
- A female-office Body index candidate seeded only by pixel-attributed source triangle 3136. The connected patch helper requires actual active garment-ray coverage, a maximum 40 mm garment gap, a maximum 45 mm connected surface radius and at most 220 triangles. Existing office and shoe body-hide maps are unioned with that patch.

The source body index is hashed from the pinned raw source GLB and is copied to a private candidate geometry; the candidate shares actor skeleton/material/attributes and does not mutate source templates. Canvas capture uses `preserveDrawingBuffer: true`; the runner rejects suspiciously small PNGs and requires source/candidate hashes to differ in visible sampled groups. Female-office pixels must be reviewed before treating the patch as a fix.

Run `node .../verify-source-pins.mjs`, then typecheck with the adjacent `clothing-body-shoe-ab-v1.typecheck.json`, run the bundle script, and finally run the bounded `render-clothing-body-shoe-ab-v1.mjs`. The fixture has not been built or rendered yet. It makes no gameplay, mobile, or broad garment-coverage claim.
