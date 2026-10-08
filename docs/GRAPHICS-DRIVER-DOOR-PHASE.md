# Driver-door source phase — 8 October 2026

Sedan, hatchback, SUV and cab placed their public boarding door opposite and behind the driver. This phase corrects the existing `buildCar` door call to the driver's negative-X side/z+0.42, a positive-Z front hinge and outward opening. It retains public anchors, panel dimensions, model triangle/draw counts, other vehicle calls and allocation behavior.

Scope: `src/models/vehicles/index.ts`, `src/models/vehicles/vehicles.test.ts`, this report and graphics coordination/execution documentation. Based on current main bcc376a2 after a reviewed merge that preserves the current WORLD/APP rows. No geometry-data, geography, account, persistence, budget or production-upload changes.

Executed Node22.19 control: original frozen model exits1 on the intended driver-side assertion; corrected complete vehicle suite8/8 exits0. All four styles and three detail tiers are checked through translated/rotated/scaled vehicle roots and multiple opening fractions; existing allocation/determinism/disposal/model budgets remain passing. Temporary baseline files were removed. Targeted browser-fixture vue-tsc exits0. Full production/test-project typecheck and integrated release checks remain pending; publish this as a reviewable candidate, not a sealed release.

Root actual Chrome matched open/half-open pixels confirm the corrected side/front hinge and public-anchor tracking. Street sedan model664 triangles/seven draws, full marker frame826 triangles/ten draws, DPR2; actual disposal leaves zero geometry/texture counters and console errors/warnings absent. Local evidence: `evidence/graphics-loop/driver-door-v1/test-report.json`, `root-before-open-matched.png`, `root-candidate-open-matched.png`, `root-candidate-half-side.png`, `root-open-diagnostics.json`, `root-disposed.json`. These local files are not published or cross-computer evidence; the committed test and this precise report are the portable record.

The static opaque shell/window still fills the visual doorway. Complete actor boarding, contact, doorway clearance, production motion and mobile acceptance remain open. LIVING-WORLD was informed of that boundary; WORLD alone owns integration/sealing/upload after its checks. Do not report the entire boarding flow fixed or fold this unverified phase into the unrelated country-reader release.

Baseline model SHA256 `dacf1578027c39d9d5839b5df2e55d1be58daa72646eaf66cd1817dc086764c3`; candidate `c341b3776e6d69482969c26948a1469cd82c3e954f03ef5f2e114d5e363a1b25`; test `83656f775fc22c8e019f7d27858b660ffce13d0affb64ab4fe206e78fe5a1400`.
