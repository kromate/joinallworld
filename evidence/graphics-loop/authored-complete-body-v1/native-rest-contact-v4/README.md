# Native rest contact V4

V3 corrected the mirrored home-prop geometry and scale, but its 14 remaining failures exposed a phase error: the runtime demanded the final lying/soaking/washing contact pose on the first frame of every enter/exit clip. A standing frame cannot satisfy the bed/tub/shower posterior and two-foot resting contract.

V4 separates transition validation from stable-pose validation. Entry and exit frames retain the named source clip and host placement, check sampled posterior points against prop penetration and sole points against the actual world floor, and require a planted sole while the mapped head/hip axis is upright. They do not run the stationary pelvis correction, require both soles on the prop, or require the shower head to be in the water column. Stable still/loop samples keep the existing strict prop, posterior, head-zone, and both-foot checks unchanged.

The runtime also derives the bed/mat lying anchor from the requested `lie` pose while `placeUse` is called before `show('lie')`. This avoids placing the first lie-down frame at the ordinary seated offset because the host registered the prop before the pose state changed.

The V4 workflow is: `node native-full-runtime-v4/bundle-prepared-factory.mjs`; `tsc -p native-full-runtime-v4/native-full-runtime.typecheck.json`; `tsc -p rest-contact-review.typecheck.json`; `node rest-pose-adapter-check.mjs`; `node native-rest-contact-check.mjs`; `node native-rest-15-pose-check.mjs`; then run `node bundle-rest-contact-review.mjs` and the bounded browser review. The 15-pose check imports the generated factory bundle from `native-full-runtime-v4/`; the browser entry imports the same V4 factory source directly and the HTML points at the V4 review bundle. Neither runner references V1/V2/V3 runtime code.

The inner factory config extends the repository `tsconfig.base.json` five directories up; the review config is at this folder root and extends four directories up. The factory bundle resolves `?url` assets to file URLs, including the actual authored GLBs and shoe hide map. All relative source imports in both nested runtime files resolve from this folder layout.

This source candidate has not been typechecked, run against the prepared GLBs, or visually reviewed. It is not accepted; the full 15-pose gate remains strict.
