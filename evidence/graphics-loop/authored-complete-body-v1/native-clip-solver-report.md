# Native clip solver diagnostic

`createNativeClipSolver(...).applyFrame(frame, support)` consumes the actor-owned source sampler's exact mutable frame synchronously. It maps joint positions into the native anatomical frame and solves native two-bone chains with reach clamps; it never transfers legacy clip quaternions. `support` is mandatory and selects flat feet, explicit left/right stair levels, a caller-provided seat hip anchor, or a body-contact diagnostic. There is no idle fallback.

## CPU evidence

Run:

```sh
node --max-old-space-size=48 --experimental-strip-types evidence/graphics-loop/authored-complete-body-v1/native-clip-solver-check.mjs
```

The bounded image-free check passed for all 60 exact clip names in the pinned clip pack (body SHA-256 `9a2ff742bff609ad16219cfc7f2bbca03ac834305c595def364add6ee57c01cd`; clip-pack SHA-256 `89a2c636d3a9d1d9eac0e1125c20ca14d030c55ae27561dd8644b30645fd3d47`). It applied each midpoint to the actual decoded authored-body skeleton, checked finite positions and reach clamps, and verified body geometry/index bytes and the shared source hierarchy were unchanged after cleanup. It also checked exact still/transition clip names for all 15 `BodyPose` values plus both stair clips.

Results: 44/60 midpoint cases reported a valid lowest weighted sole against the selected explicit floor. Two stair clips (`stairs-up`, `stairs-down`) reported `feet-residual-unresolved`; the other foot penetrates its separately specified level. Eleven seated clips reported `seat-anchored-contact-unverified`, and three prone/sleep clips reported `body-contact-diagnostic-only`. The latter 16 cases are deliberately not counted as contact passes. Full per-clip measurements and hashes are in `native-clip-solver-check-result.json`.

## Limits and next acceptance gates

- The check uses one decoded combined authored body at its default shape. It does not establish male/female look fitting, expression parity, or independent per-look geometry.
- Flat-foot support measures only precomputed weighted foot/toe candidates (about 2.5k vertices), not the full body. It still performs candidate vertex skinning during each apply and is not a mobile performance benchmark.
- Stair support currently corrects the lower weighted sole to its declared side's floor and then checks both sides. The two midpoint stair frames fail that test; continuous stair motion needs a two-foot endpoint/support solve and rendered stair review.
- Seat support places the pelvis at a supplied world anchor but does not prove seat/thigh contact. Lying scans the full body and is diagnostic only; it is unsuitable for a runtime loop without a bounded contact set.
- This is positional landmark transfer. Axial twist, fingers, gaze, face morphs, wardrobe, footwear, props, and root trajectory are not transferred or accepted. No GPU pixels, clothing fit, playable integration, or visual naturalness claim is made.

This prototype shows that the complete clip library can be routed through a source-position API without silently substituting idle. It does not complete a full-body replacement.
