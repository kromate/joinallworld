# Home/street clock lighting and owned shadow cleanup

Home and neighbourhood previously kept daylight skies when the clock reached night. This phase applies the existing indoor/outdoor clock presets, scales the existing Home lamp, restores the active emissive material after preparing another scene, and releases owned shadow targets before renderer teardown. Presets move unchanged into a shared module. No new light, asset, texture, dependency or rendering pass is added.

## Verified source and evidence

Runtime source58d754be merges mainacf75450. Corrected test source7c6979526bbc424c9997e5fdd1a54557b7153a5d preserves all seven original phase runtime/test files byte for byte and changes only the existing host regression file. Its exact-checkout runner verifies commit, tracked cleanliness and20 hashes before/after. Frozen main4f night/shadow controls fail the intended assertions; corrected affected tests pass48/48. Targeted TypeScript passes at the1536MiB heap cap.

The old host test assumed Home had no light preset; it now checks indoor daylight and independently checks HOST_LIGHTING fallback with a custom scene. Movement regressions retain their distance/collision/idle assertions, use one simulated wake/RAF clock and longer held-key intervals matching the existing human walking speed. Original47/43/4 failures and frozen-host movement reproductions remain preserved.

Actual Chrome/WebGL2 review used released body assets and a deterministic synthetic Lagos fixture. Source/camera/canvas guards confirm matched Home day/dusk/night and frozen-night views, and street day/night views. Night renders remain settled. Five procedural guests draw14 calls/9,384 triangles. A public walk arrives from z3.93 to3.23 and stops. Actual front-door travel works Home→street→Home after removing the crowd.

The frozen host leaves1 texture and1 unreleased shadow target before renderer teardown. Candidate records0 textures/0 unreleased targets at that point, with its map disposed by the host. One internal geometry remains before renderer disposal; final counters are0 geometries/0 textures/0 scenes. Console warning/error capture is empty. Evidence is retained locally in evidence/graphics-loop/lighting-clean-phase-v2/ and lighting-clean-phase-v3/, including matched screenshots, source manifests, TAP, compiler output and browser-report.json. This document does not claim physical-phone performance or whole-game completion.

## Release gates and remaining defects

Exact58d fast CI37847776748 passed policy/compiler/build/download and15/15 smoke. Lagos startup614,960 raw/222,913 gzip passes unchanged limits. Full CI37848281383 terminated failure on both Node22/24:3,186 tests,3,134 pass,48 fail,4 skipped. Compiler/build/download passed; Worker tests were skipped after npm-test failure. Four host assertions are corrected in7c; failures in other main workstreams still require triage. Fresh final-head CI remains required.

Browser findings remain open: five-guest tags overlap the door and prevented its route from starting; returning Home retained a procedural player although a fresh rebuild restored the canonical body. Their causes are not yet attributed. The390×844 fixture displays, but its QA overlay obscures the playable view and does not certify touch controls, real-phone latency or thermals. Dense canonical crowds, clothing, richer houses/cities/materials and complete persisted journeys remain separate work.

WORLD coordinates phased integration and production. GRAPHICS closed its owned tab1412593760, reset the viewport, stopped Vite5184/session12615 and browser lease29219 (both terminal130), verified all slots0/1 and explicitly handed the sole local intensive turn to WORLD. No graphics production upload occurred. Do not raise resource or graphics caps to turn unverified results into passes.
