# Exhaustive CI and source-pinned boarding batch

## Evidence and acceptance

Full run 37888565489 at 3e173080506d659ced0b0dc466dd7e308e8d5848 reached the existing 25-minute maximum in both jobs. Node24 completed 3439 Node tests (3435 pass, zero failures, four original skips), then Worker checks were cancelled. Node22 did not finish its Node suite. Both compiler/build/download checks passed. This was a timing failure; it does not justify deleting tests, increasing limits, or assuming full acceptance.

The new TypeScript runner parses the unchanged canonical package test command, retaining all eight existing globs and required Node flags in exactly one source/scripts or server partition. Unknown commands, flags, shell syntax, empty partitions and duplicate globs fail closed. A spec reporter improves bounded diagnostics without changing cases. The runner uses its checkout as cwd, invokes Node without a shell, forwards parent cancellation to its child, awaits closure, preserves cancellation even on child exit zero, and removes signal listeners.

Full CI now requires successive source, server and Worker waves, each on Node22 and24, each with the existing25-minute cap and max-parallel2. Source retains full typecheck. Every wave builds the exact checkout and enforces the existing download budgets before tests. Source/server preserve pretest; Worker retains the unfiltered canonical test:edge. The protected production workflow and canonical npm test remain unchanged. All six full jobs plus release policy must succeed for a full result; a skipped or cancelled wave is not acceptance. CI has not yet established that these waves fit; collect actual terminal results and diagnose failures before a new attempt.

The runner stays TypeScript to preserve the repository's exact JavaScript allowlist. Release-policy checks include its eight regression cases. No whitelist, provider deadline, save/reward, auth, migration or deployment control is relaxed.

## Vehicle contract

The new sedan descriptor pins actual source hashes at75ad421adc6d1eb455c9f7a258bc63e315ce5955. It records model-space units and heading, authored driver and hinge anchors, exterior panel partition, current StandIn/fallback placement phases, and reduced-motion durations. It records certified doorway/interior solids and actor/clip volume as unknown. Placement phases do not prove a swept collision path or deterministic clip duration. canBoard and routeAuthorized remain false; trip allocation is not enabled.

Sol repaired descriptor forgery via hidden/symbol keys, prototypes and accessors, and finite-input arithmetic overflow. Six fixtures verify source hashes, actual CPU-built vehicle anchors/door pose, transforms and rejection boundaries. This is a published contract handoff for GRAPHICS, not rendered, mapped or physical boarding acceptance.

## Actual checks and review

First combined13-case run failed only the malformed-command fixture's error-message expectation: it rejected the malformed token with the correct token-boundary diagnostic. Sol corrected the expected rejection and retained malformed end-of-command coverage. Retest13/13 passed. After the CI-wave regression and TypeScript conversion, final checks passed19/19 (8runner,6vehicle,5existing release), zero skips,188.484208ms. Shared heavy1 guarded process elapsed0.520517625s, sampled owned-group peak195592192B, heap128MiB/group220MiB/wall15s; no guard stop. Logs and resource records are retained under /tmp/joinallworld-partition-boarding-ts-final. Sampling is not an OS-hard RSS guarantee.

Independent Luna source review found the missing runner cancellation/cwd and descriptor exactness/overflow issues before integration, then verified their repairs. No local full compiler/build/browser/GPU was run. Exact candidate remote compiler/build/budget/all-six-job results, real desktop/mobile/multiplayer/interruption/reload, mapped clearance/custody, NPC atomic wallet/privacy integration, staging and production observation remain required. All A1–A10 and phase exits remain open.

## First exact remote run and repair

Published dbf455c5174bc524b334c3e98f948d9e119a1df9 ran37892266977, terminalFAIL. Release policy25/25PASS, zero skips. Both Node22/24 client and test compilers aborted(SIGABRT), so builds/Node partitions and later mandatory server/Worker waves did not run. No compiler cleanliness or full acceptance. The new job-level1536MiB heap setting inadvertently also constrained the compiler, unlike previously passing3e remote settings; the aborted log does not include a fatal heap diagnostic, so heap-limit causation remains an inference until the repaired run.

Sol restores only the remote compiler step's existing unset NODE_OPTIONS, retaining1536MiB for game builds/tests,25-minute limits and two-job waves. Local compiler resource gates remain unchanged; no local full compiler was started. The test-project include now explicitly contains the new TypeScript runner fixture (previous root glob did not include it). The CI regression checks this inclusion and scoped compiler setting. Independent Luna review found no concrete blocker. Repair checks8/8PASS, zero skips,47.448125ms; guarded elapsed0.469976125s/sampled owned-group peak172998656B under the same128/220/15 limits. Exact fresh compiler/build/budget/all-wave results remain required.
