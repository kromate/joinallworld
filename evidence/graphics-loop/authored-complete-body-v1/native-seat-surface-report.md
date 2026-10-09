# Native seat-surface diagnostic

This is a CPU-only probe, not a chair-fit acceptance test. It loads the pinned expressive body and production clip pack, applies the measured male/female rig correction, mounts the current authored outfit plus shoes, then samples the exact source `sit` clip at 40 clamped times. At each time it asks the existing solver to anchor hips at a stated virtual seat plane, measures indexed Body/outfit vertices in a rear-pelvis envelope, and calculates the vertical pelvis delta that would align the region minimum to that plane.

V25 showed why a broad pelvis-plus-thigh weight filter was not a valid butt reference: for the female office suit, the selected minimum came from the thigh/skirt at `0.3002 m` while the hip anchor was `0.55 m`; after the foot solver reposed the legs, the suggested `+0.2498 m` pelvis shift still left the region `172.3 mm` below the virtual seat and made the feet unreachable. The revised cached set requires at least `0.15` Hips weight, with Hips outweighing either proximal-thigh influence, and a rest-position behind the measured foot-to-toe forward axis inside pelvis-width and hip-to-knee-derived vertical bounds. A masked body may legitimately contribute zero vertices because its outfit mask removes the pelvis. More than 4096 candidates or an empty union is a hard refusal.

An independent pass scans every distinct active index and independently rebuilds the same anatomical region before pose application; it must match cached membership and then the posed region bounds. This checks accounting. It does not prove that the region is the right visible upholstery-contact surface, that motion between samples is safe, or that a specific chair is correctly placed.

The diagnostic matrix contains the actual male casual suit, female casual outfit, and female office suit. The plane height is set to `0.55` scene metres as a test input, not copied from game furniture. The report records the source-sit phase, solver reach/foot status, candidate and full-region counts, measured pelvis offset, and residual. Shoes are supplied to the existing solver for floor-foot handling but excluded from the seat-region support set; hair is also excluded.

Run only in the root’s bounded resource window:

```sh
node --max-old-space-size=160 evidence/graphics-loop/authored-complete-body-v1/native-seat-surface-check.mjs
```

The check has not been executed in this lane. The report must be read from `native-seat-surface-check-result.json` after a bounded run. A residual near zero only means the arithmetic applied the measured offset; root visual review still needs an actual chair, full body/clothing pixels, hand/arm placement, leg reach, and transition samples.
