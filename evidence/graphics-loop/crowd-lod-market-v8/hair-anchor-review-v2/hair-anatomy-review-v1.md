# Hair placement source audit and acceptance gates

This is a source-only audit. It does not score the v2 pixels, which have not yet been captured, and it does not authorize a production geometry change.

## What the shipped measurements establish

The measurements in `../hair-anchor-review-v1/head-bone-witness.json` use metre-scaled rest positions from the shipped GLBs. The source male head bounding box is about 0.181 × 0.234 × 0.221 m; the generated Afro ball is 0.324 × 0.314 × 0.310 m. The Afro is therefore about 1.79 head-widths, 1.34 head-heights, and 1.41 head-depths. Its source center is y=1.7635 m, while the v2 candidate center is y=1.9421 m. The candidate changes only Y; the radii remain (0.162, 0.157, 0.155) m. Its vertical bounding-box overlap with the authored head falls from 0.2036 m to 0.025 m.

The source female head bounds are about 0.178 × 0.228 × 0.225 m. The bun ball is 0.172 × 0.180 × 0.168 m, roughly 0.97 head-widths, 0.79 head-heights, and 0.75 head-depths. Its candidate center moves from y=1.8409 m to 1.7965 m, with unchanged radii (0.086, 0.090, 0.084) m. Vertical bounding-box overlap rises from 0.0155 m to 0.060 m.

Those numbers make the asymmetric candidate plausible as a placement repair, but they do not prove scalp contact or visibility. A bounding box cannot show the Afro's front surface relative to the eyes, nor whether the bun's lower surface meets the back of the head. The male mass is already large relative to the head before the offset, so a successful eye reveal could still leave an oversized or floating-looking shape. The relevant generated primitives are the Afro/bun `b.ball` calls in `geometry-hair-anchor-v2.ts`; both use the existing Head-only weight and unchanged tint.

## Conditional next shape experiment

Do not change the v2 dimensions before its matched images are reviewed. If v2 shows that the Afro remains orb-like or has a visible scalp gap, the next isolated experiment should replace only the Afro's spherical lower half with a scalp-fitted cap: keep an authored upper crown volume, trace the lower boundary from actual Head triangles in the scalp-color region, and fit that boundary in the Head rest frame. Preserve the saved style/color and Head bone influence. Do not choose a smaller radius from the bounding-box ratios alone. If v2 instead shows continuous-looking attachment and a visible face, no shape change is justified by this source audit.

A bun failure should be handled separately from the Afro: use actual rear/side Head triangles to establish the bun's attachment boundary. Do not reuse a front-facing Afro cap rule for the bun.

## Pixel and geometry acceptance matrix

The prepared v2 matrix compares two pinned saved actors (male Afro/hoodie and female bun/owambe), source versus candidate placement, source versus compact body, and 0° front versus 90° profile, all at the same paused walk phase and the exact source-fitted camera per yaw. The live walk must first advance for at least 2.4 seconds. The candidate must keep the same normalized look, hairstyle dimensions, generated hair color/skin-index/skin-weight attribute bytes, body skeleton pose, and camera as source.

Independent review should inspect all 16 captured frames, with special attention to the Afro eye/forehead silhouette and the bun's rear attachment. The current witness reports Head/scalp deformed-vertex bounds, hair bounds, hair-to-Head nearest-vertex distances, and hair ray hits on body triangles selected from the eye UV windows. Those are diagnostic checks only: nearest vertices do not certify continuous mesh contact, and the UV rays do not certify visible pixels. The PNGs are the visibility evidence. If either family still has ambiguous attachment at these views, the next test should add a 45° view and a close face frame before approving further geometry edits.

## GPU package verifier contract

The GPU verifier must be pinned to one successful CPU workflow run by run ID, branch, commit, CPU source-manifest digest, build-manifest digest, and builder SHA. It expects exactly one `build-manifest.json` below the downloaded artifact, the pinned fixture output suffix, matching viewer/candidate/inventory input hashes, every emitted output hash, and exactly one CPU receipt named `v8-hair-anchor-v1-cpu-package.receipt.json`. The receipt must report completed status, child exit 0, verified process-group cleanup, unchanged inputs, the same source-manifest SHA, valid package manifest, and a nonempty artifact digest. The CPU workflow's artifact upload paths share `remote-ci-reviewed-v1` as their root, so the downloaded artifact should contain the fixture folder and `remote-results` receipt folder under that root.

The CPU runner itself returns success only after observing a positive memory sample and satisfying its 220 MiB group RSS / 25 second / 96 MiB Node heap limits. For defense in depth, the GPU verifier should also check those receipt fields directly before launching Chrome; a successful CI conclusion is not a substitute for recording the resource receipt. Chrome review remains a separate 2 GiB / 60 second SwiftShader diagnostic and is not mobile performance evidence.
