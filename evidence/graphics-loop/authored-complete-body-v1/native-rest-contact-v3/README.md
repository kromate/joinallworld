# Native home-rest V3 fixture

V3 is an isolated source-shape correction to the V1/V2 rest-contact fixture. Frozen V1/V2 files are unchanged. The candidate uses the 3af default-home tile scale (`ROOM/grid = 10/12`), the source actor scale (`tile * .72 = .6`), and home `seatOf` anchors converted from tile units. Its support raycasts are constrained to the same prop-specific Y bands as the staged `nativeRestSupport` callback. Shower head-zone testing uses the source's item-local tile predicate.

The full callback/source comparison and remaining fixture limits are recorded in [source-shape-audit.md](source-shape-audit.md). The 15-pose runner still executes actual prepared body/clip assets, reports rejected poses as failures, and includes missing-prop rollback. This revision has only had a JavaScript syntax check; it has not had remote CPU, typecheck, or browser execution. Do not treat it as accepted until the root-owned bounded run completes.

`bundle-rest-contact-review.mjs` builds the isolated viewer. `render-rest-contact-review.mjs` is the headless review driver; it must run only through the root's bounded remote recipe. No production or game source is edited here.
