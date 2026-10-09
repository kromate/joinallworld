# Native seat-surface diagnostic

This is a CPU-only probe, not a chair-fit acceptance test. It loads the pinned expressive body and production clip pack, applies the measured male/female rig correction, mounts the current authored outfit plus shoes, then samples the exact source `sit` clip at 40 clamped times. At each time it asks the existing solver to anchor hips at a stated virtual seat plane, measures the actual indexed Body/outfit vertices supported by `mixamorigHips` and the two proximal-thigh bones, and calculates the vertical pelvis delta that would align the region minimum to that plane.

The cached probe keeps every indexed vertex whose total weight on those three bones is at least `0.15`; it rejects more than 4096 candidates. An independent pass over all distinct indices in each active draw range recomputes the same anatomical region and must match the cached minimum to `1e-7` metres before and after the proposed delta. This checks the cache’s accounting. It does not prove that the selected region is the right visible upholstery-contact surface, that the motion between samples is safe, or that a specific chair is correctly placed.

The diagnostic matrix contains the actual male casual suit, female casual outfit, and female office suit. The plane height is set to `0.55` scene metres as a test input, not copied from game furniture. The report records the source-sit phase, solver reach/foot status, candidate and full-region counts, measured pelvis offset, and residual. Shoes are supplied to the existing solver for floor-foot handling but excluded from the seat-region support set; hair is also excluded.

Run only in the root’s bounded resource window:

```sh
node --max-old-space-size=160 evidence/graphics-loop/authored-complete-body-v1/native-seat-surface-check.mjs
```

The check has not been executed in this lane. The report must be read from `native-seat-surface-check-result.json` after a bounded run. A residual near zero only means the arithmetic applied the measured offset; root visual review still needs an actual chair, full body/clothing pixels, hand/arm placement, leg reach, and transition samples.
