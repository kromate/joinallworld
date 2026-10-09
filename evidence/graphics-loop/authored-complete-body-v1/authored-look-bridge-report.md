# Same-assets authored look bridge

This is an ignored adapter prototype. It leaves production files untouched and does not select or load different assets.

`authored-look-bridge.ts` normalizes a complete incoming look with the actor's captured seed and accepts only changes to face, expression, skin, shirt color, trouser color and hair color. It reads the actual prepared actor body family from the actor port and rejects a body/look mismatch at construction. Before applying an update it verifies that the character, skin and presentation adapters are ready, normalizes the whole look, enforces the same seed, and compares all structural fields. Changes to body family, hairstyle, outfit, fabric, accessories, wearables, age, build or height are rejected before any mutator runs. Missing fields are rejected rather than filled with new seeded defaults.

For accepted updates, face changes go through the actual `CompleteCharacter.updateIdentity(look, seed)` method; expression-only changes use `setExpression`. Skin and prepared clothing/hair colors go through actor-private `setColor` and `setColors` ports. The bridge commits its stored look only after those calls return. It guarantees preflight rejection is mutation-free. It does not claim rollback if an arbitrary adapter throws after the commit has begun; integration adapters must bind to live, actor-private handles and expose accurate `isReady()` state.

The bounded check loaded the real pinned facial GLB and clip pack, created male and female actors, exercised real face morph updates and private body material recoloring, and instrumented the palette setter interface. It verified allowed fields, expression-only updates, rejection-before-mutation for structural changes and wrong seeds, incomplete-look refusal, prepared body mismatch, unavailable presentation refusal, and Kit cleanup. Run with:

```sh
node --max-old-space-size=48 --experimental-strip-types evidence/graphics-loop/authored-complete-body-v1/authored-look-bridge-check.mjs
```

The presentation color port in this CPU check is instrumented; the check does not load the texture-backed skin or outfit/hair assets and does not render pixels. Browser integration still needs to bind the real `applySkinMaterial` result and `AuthoredPresentation` handle, verify their current prepared asset/look provenance, and test color changes across both families and the currently selected hair assets. This bridge does not support asset changes, wardrobe changes or alternate age/build/height shapes.

## Frozen files

- Bridge SHA-256: `41a35d893a11ff4af9441cf8f19b523e57168df4d006e80f45cb3dadcf7e458f`
- Check SHA-256: `e47336ef899f717472722e85216f45e11c1bfad430db7c5e8430332c4efee0e0`
- Result SHA-256: `26b3b31cec79c46f6ccbb410ceac300d1ca608e36824ad7c1402e65acb4130a4`
