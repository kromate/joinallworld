# Clock lighting and shadow-resource ownership phase

Home and neighbourhood currently retain static daylight skies and host lights when the server clock reaches night. The host also leaves its allocated sun-shadow render target to renderer teardown. This phase applies the existing indoor/outdoor clock presets to those scenes, scales the existing Home point light, restores the active shared emissive material after preparing another venue, and explicitly releases owned light shadow targets before renderer disposal.

The presets move unchanged from venue-scenes into a lightweight shared module; existing public exports are retained. No new light, texture, asset, rendering pass or dependency is added. Geometry, avatar identity, world coordinates, source data, gameplay budgets and the pending canonical-body/wardrobe/scenery/vehicle experiments are outside this phase.

## Exact-source verification status

This branch is independently reconstructed from main4f74913cee13a827fc7581a25b8f70d7311ad55c. A temporary clean Git index accepts its exact seven-source/test-file patch. **Clean-branch Node/type/build/download/browser checks are pending.** Existing primary-candidate64 tests/types0 and browser results are separate and do not certify this branch. Added six meaningful regressions cover clock changes without geometry churn, Home/street host presets, prepared-scene glow restoration, and owned shadow disposal including repeat teardown.

Earlier primary-candidate desktop WebGL comparison observed the old orphan1 versus candidate host-owned map disposal0 before renderer teardown, then0 geometry/0 texture/0 scene. This uses local candidate bodies and a synthetic fixture, not this branch's released body/geometry or a persisted production journey.

## Remaining acceptance

Run the frozen old-host negative controls and focused affected suites on this exact branch, full compiler/build/download gates, actual clean-source matched day/dusk/night pixels, public walk/Home-street transition, five guests and real shadow events before renderer teardown. No original download/dense/device limit is waived. Phone frame/input/thermal/resource acceptance and the full graphics overhaul remain open.

WORLD coordinates phased integration and production; no production upload is authorized by a branch or green CI alone. Current local intensive turn is WORLD, then LIVING, then GRAPHICS after explicit terminal handoffs. GRAPHICS prepared this source only, with no local test/build/server/browser overlap.
