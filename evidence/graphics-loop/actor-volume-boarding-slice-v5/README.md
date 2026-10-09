# Actor geometry sampler v5 proposal (source-only, unrun)

This is a separate proposal folder; v4 remains frozen with its executed helper failure. The sampler reports a current actor-subtree AABB and active indexed-geometry triangle count only. It cannot prove frustum visibility, occlusion, floor clearance, swept movement, seat fit, collision safety, or that boarding is allowed. A trusted host supplies normalized appearance and phase metadata; that identity remains a host assertion, not an independently verified look certificate.

The production-adapter test parses both shipped body GLBs and the shipped walk clip. It uses the actual clone, appearance controller, wardrobe renderer and foot-contact controller, with the wardrobe as a sibling mesh and a translated/rotated/nonuniformly scaled actor parent. For every sampled sole point, the test independently transforms the production contact from the body's parent frame through `actor.matrixWorld` and compares the numeric world coordinate. It also measures active skinned vertex bounds from the actual masked base and actual office overlay and requires the overlay to extend beyond the visible base bounds. The active-bounds helper advances one triangle at a time and checks every referenced vertex index before skinning it. Wear/restore, appearance mutation, sampled walk pose, both contacts and sibling triangle accounting remain covered.

Exact narrow remote recipe after root review:

```sh
npm ci --no-audit --no-fund
node --max-old-space-size=96 --experimental-strip-types --test --test-concurrency=1 evidence/graphics-loop/actor-volume-boarding-slice-v5/sample-actor-geometry.test.ts
```

Run this one test through the existing serialized heavy-test slot, with a 220 MiB process-group RSS cap and 25 second wall cap. Do not run the complete suite or change shared caps for this proposal. The source test has not been executed here; the recipe is not a passing result. The prior remote v4 run failed in the active-bounds helper because its triangle-start loop advanced one index at a time. This v5 correction remains unexecuted.

The production source pins and actual GLB hashes are recorded in `source-pins.json`. This is not integrated into `loadBody` or gameplay, and does not prove gameplay boarding or physical clearance.
