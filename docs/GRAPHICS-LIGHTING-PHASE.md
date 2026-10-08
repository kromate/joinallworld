# Home/street clock lighting and owned shadow cleanup

Home and neighbourhood previously kept daylight skies when the clock reached night. This phase applies the existing indoor/outdoor clock presets, scales the existing Home lamp, restores the active emissive material after preparing another scene, and releases owned shadow targets before renderer teardown. Presets move unchanged into a shared module. No new light, asset, texture, dependency or rendering pass is added.

## Verified source and evidence

Runtime source58d754be merges mainacf75450. Corrected test source7c6979526bbc424c9997e5fdd1a54557b7153a5d preserves all seven original phase runtime/test files byte for byte and changes only the existing host regression file. Its exact-checkout runner verifies commit, tracked cleanliness and20 hashes before/after. Frozen main4f night/shadow controls fail the intended assertions; corrected affected tests pass48/48. Targeted TypeScript passes at the1536MiB heap cap.

The old host test assumed Home had no light preset; it now checks indoor daylight and independently checks HOST_LIGHTING fallback with a custom scene. Movement regressions retain their distance/collision/idle assertions, use one simulated wake/RAF clock and longer held-key intervals matching the existing human walking speed. Original47/43/4 failures and frozen-host movement reproductions remain preserved.

Actual Chrome/WebGL2 review used released body assets and a deterministic synthetic Lagos fixture. Source/camera/canvas guards confirm matched Home day/dusk/night and frozen-night views, and street day/night views. Night renders remain settled. Five procedural guests draw14 calls/9,384 triangles. A public walk arrives from z3.93 to3.23 and stops. Actual front-door travel works Home→street→Home after removing the crowd.

The frozen host leaves1 texture and1 unreleased shadow target before renderer teardown. Candidate records0 textures/0 unreleased targets at that point, with its map disposed by the host. One internal geometry remains before renderer disposal; final counters are0 geometries/0 textures/0 scenes. Console warning/error capture is empty. Evidence is retained locally in evidence/graphics-loop/lighting-clean-phase-v2/ and lighting-clean-phase-v3/, including matched screenshots, source manifests, TAP, compiler output and browser-report.json. This document does not claim physical-phone performance or whole-game completion.

## Release gates and remaining defects

Exact58d fast CI37847776748 passed policy/compiler/build/download and15/15 smoke. Lagos startup614,960 raw/222,913 gzip passes unchanged limits. Full CI37848281383 terminated failure on both Node22/24:3,186 tests,3,134 pass,48 fail,4 skipped. Compiler/build/download passed; Worker tests were skipped after npm-test failure. Four host assertions are corrected in7c. This is the predecessor failure, retained for comparison with the completed91b results below.

Browser findings remain open: five-guest tags overlap the door and prevented its route from starting; returning Home retained a procedural player although a fresh rebuild restored the canonical body. Their causes were not attributed during that browser run; the fixture-wiring qualification below now changes the next reentry check. The390×844 fixture displays, but its QA overlay obscures the playable view and does not certify touch controls, real-phone latency or thermals. Dense canonical crowds, clothing, richer houses/cities/materials and complete persisted journeys remain separate work.

WORLD coordinates phased integration and production. GRAPHICS closed its owned tab1412593760, reset the viewport, stopped Vite5184/session12615 and browser lease29219 (both terminal130), verified all slots0/1 and explicitly handed the sole local intensive turn to WORLD. No graphics production upload occurred. Do not raise resource or graphics caps to turn unverified results into passes.


## Completed91b CI and shared handoff status

On published91b0d452577eb2d694839751534fa1f942416bcc, [fast CI37852261197](https://github.com/kromate/joinallworld/actions/runs/37852261197) passed policy, type checking, build, download limits and15/15 smoke. Startup remains614,960 raw /222,913 gzip bytes. [Full CI37852339575](https://github.com/kromate/joinallworld/actions/runs/37852339575) is terminal failure on BOTH Node22/24: each3,187 tests /3,139 pass /44 fail /4 skipped. The four corrected host tests plus the independent no-preset fallback passed in both actual full-job logs. Worker tests were skipped after npm-test failure. Remaining campus/app/server/game/movement failures require owning-workstream diagnosis; they are not waived. Raw logs and44-location diagnoses are retained in the primary evidence/graphics-loop/lighting-clean-phase-v1 directory.

The city-scenes test process failed while Node imported campus/unilag/world-adapter.css. The old movement test expects more than2 units after half a second although main walking speed is1.82 units/second; the primary graphics candidate contains a duration/speed assertion, still UNRUN for current source. WORLD received exact failure evidence and coordinates the wider repairs. This report update changes documentation only; the phase runtime, assets and tested fixtures remain unchanged.

## Home reentry fixture fidelity and unpublished candidates

Source review found that the isolated v3 viewer omits the `jaw:home-frame` listener that application `startHome()` forwards through `redrawScene()` to visible scene `update()`. Its reentry screenshot may show a stale canvas after an asynchronous body commit. It therefore does not establish a production identity defect or prove the optional primary startBody hypothesis necessary. V3 screenshots/reports remain preserved. Prepared lighting-clean-phase-v4 uses unchanged released source/assets, app-ready event forwarding on/off, notification and canonical-body observations, and a fully collapsible QA overlay. Its12 runtime/asset hashes match v3. This A/B review is UNRUN and comes before accepting a reentry repair.

Separate primary source revision5 prepares canonical NPC/peer identity, pose/gaze/fallback release, task boundaries, reentrant actor ownership guards and body-loading lifetime checks. Thirty focused checks (14crowd/5venue-host/5shared-cache/6StandIn) and targeted compiler/browser checks remain UNRUN while LIVING owns the sole local intensive turn. Source assertions still prohibit static heavy body/asset/decoder imports. No local primary candidate is included in this lighting release or entitled to its48/48 result. Next explicit cleanup/handoff is LIVING→GRAPHICS→WORLD; no competing graphics test/build/server/browser/upload is running.

The entire graphics goal remains incomplete: full clothing/pose/contact and lower-detail identity, richer cities/houses/interiors/materials/vegetation/water, complete persisted journeys, dense scene budgets/residency and real Android/iPhone frame/input/thermal checks are open. No cap, baseline or production version changed in this report phase.
