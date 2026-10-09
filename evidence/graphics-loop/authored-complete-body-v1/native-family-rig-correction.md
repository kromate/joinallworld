# Native family rig correction

This isolated adapter aligns the authored rig's rest joints with the same family macro shapes already applied to the body geometry. It leaves source geometry and morph data untouched. The cause is measurable in the pinned builder: it derives 52 neutral bone anchors from source-indexed `MEAN`/`CUBE` vertex groups, then exports family geometry morphs separately. The runtime had been applying those geometry morphs without corresponding bone-anchor changes.

`applyNativeFamilyRigCorrection(root)` is intended to run immediately after `loadCompleteCharacter()` and before constructing pose/action controllers or presentation. It reads `bodyFeminine` and `bodyMasculine` from the actor's `Body` morph influences, validates and normalizes them, and blends the pinned source anchors. It requires the `Body`, `Eyes`, `Teeth`, and `Tongue` skinned meshes to use the actor's private, identically ordered 52-bone rig. It updates each actor-owned skeleton wrapper's inverse binds in root-relative coordinates and does not change the actor root transform.

The return value includes measured fit metrics and idempotent `restore()` / `dispose()` methods. A failed precondition or failed verification rolls back the bone positions and inverse binds. The source template remains immutable; callers must still dispose the character through its existing owner. Construct the native source-position sampler after this correction so it captures the corrected rest rig. Old quaternion-retargeted clips are not part of this proof.

The coefficient table is derived from the exact source builder's 52 source-indexed anchor groups, with male/female targets using the same three-ethnic macro recipe and floor convention as the generated family shapes. No nearest-vertex fitting is used. Source and coefficient hashes are recorded in `native-family-rig-correction-check-result.json`.

## Bounded CPU evidence

Run:

```sh
node --max-old-space-size=128 --experimental-strip-types evidence/graphics-loop/authored-complete-body-v1/native-family-rig-correction-check.mjs
```

The check passed against the pinned 2,692,984-byte expressive GLB. It created real GLTFLoader clones for female, male, and a 70/30 mixed-family actor. For each actor it checked all 52 corrected anchors, all four skeleton wrappers, inverse bind matrices, unchanged root transform, source-template immutability, actor isolation, restoration, and rejection of invalid zero/zero family weights. It compared all 15,066 skinned body vertices in world space before and after correction, including a translated, rotated, nonuniformly scaled female root; the largest measured displacement was `1.22e-15 m`. The exact results are in `native-family-rig-correction-check-result.json`.

The adapter also passes a standalone strict TypeScript check with the repository's ES2023, ESNext/Bundler, JSON-module, and strict options.

This proves CPU bind-pose consistency only. It does not establish rendered appearance, native action quality, garment/footwear fit, or runtime/mobile performance. Other static identity morphs, including face, build, and height, can also move anchor vertices; their bone-anchor deltas are not included yet. The next visual check should use the real native pose/action controller and the prepared suit/shoe presentation after correction, with the same actor and source family look before/after.
