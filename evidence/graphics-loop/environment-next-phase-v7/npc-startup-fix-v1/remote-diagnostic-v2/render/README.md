# NPC startup-gate renderer diagnostic v2

This isolated render recipe consumes only the root-verified CPU artifact `environment-npc-startup-fix-v1-package-v1-37911271949`, from run `37911271949` at commit `0da02ca0f0e0c4350f2754615f58b2dcd6eaed37`. The artifact was root-verified as a completed diagnostic build (5,626 outputs, 5,392 public files, 40 city chunks); it is not a production-size or mobile certificate.

The push-bound workflow branch is `codex/graphics-environment-npc-startup-fix-v1-render-v2`; its active workflow path is `.github/workflows/graphics-environment-npc-startup-fix-v1-render-v2.yml`, which must byte-match `workflow-review-npc-v2.yml`. Package run, commit, and artifact are fixed in the selector, workflow, runner, and controller. The downloaded v1 package keeps its own v1 paths and output schemas; only the new review controls, review-pin schema, results, and branch are v2.

Before Chrome, the workflow seals its recipe and runs `preflight-module-links-npc-v2.mjs` after `npm ci`. That preflight links the controller's full ESM graph, checks all named exports, exact artifact selection, and the six Market/Beach × screenshot-method scopes. Each scope retains the home control, one target capture, and a peer transition. Limits remain 2 GiB owned process-group RSS, Node 96 MiB old space, 60 seconds, and three parallel scopes.

Source-only preparation and low-memory static checks only; no v2 package build or browser render has run. Screenshot evidence is diagnostic and does not claim physical-device performance or visual acceptance.
