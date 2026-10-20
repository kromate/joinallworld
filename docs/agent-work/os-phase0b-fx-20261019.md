# Agent work record

## Identity

- **Work ID:** `os-phase0b-fx-20261019`
- **Owner:** Claude (open-source plan, phases 0b and 0c)
- **Model / effort:** Sonnet 5.5 / default
- **Thread:** local
- **UTC updated:** 2026-10-19T21:00:00Z
- **Status:** `ready-for-review`
- **Work state:** `implementation`

## Goal and boundaries

- **Goal:** Add the empty lazy `fx` chunk, its tier gate and budgets, and the dependency licence test.
- **In scope:** `src/scene/fx/index.ts` and test, the `fx` rule in `vite.config.ts`, `FX_RAW`/`FX_GZIP` in `src/budgets.ts`, their checks in `src/scene/city-scenes.test.ts` and `scripts/download-budget.ts` (+ test), the dependency assertion in `src/licence.test.ts`, one NOTICE.md row found missing by that test.
- **Out of scope:** any real fx code (phases 1-3), `quality.ts`, merging, deploying.
- **Exclusive file ownership:** `src/scene/fx/index.ts`, `src/scene/fx/index.test.ts`, `docs/agent-work/os-phase0b-fx-20261019.md`; edits to the integrator's `vite.config.ts` and `src/budgets.ts` limited to the fx rule and FX entries.
- **Input contract:** main 090f1e97b, `postprocessing`, `n8ao`, `three-nebula`, `yuka` installed and in NOTICE.md.
- **Output contract:** branch `claude/os-p0b-fx`; CI lines for FX_RAW/FX_GZIP read `n/a` (no chunk yet) and all other budget lines `ok`.
- **Dependencies:** none.

## Repository state

- **Repo:** joinallworld, worktree `Allworld-notes/work/os-p0b-fx`
- **Host:** the owner's Mac
- **Branch / worktree:** `claude/os-p0b-fx`
- **Base:** 090f1e97b
- **Current commit:** see git log of the branch
- **Dirty status:** clean after commits
- **Port/process ownership:** none

## Progress

### Done and exact evidence

- Host, tier gate (`fxTierFor`, `fxUsesPost`), `FX_IMPORTS` marker: `node --experimental-strip-types --test src/scene/fx/index.test.ts` (5 pass).
- `fx` manualChunks rule; three's `examples/jsm/{environments,postprocessing,shaders}` deliberately stay with the import graph (quality.ts and src/spaces/world/look.ts use them; moving them would make the environment map fetch the particle and steering code).
- Budgets and checks: `scripts/download-budget.test.ts` (13 pass); city-scenes assertions exercised against a fake `dist/` (pass with the chunk, fail on a static import, fail when over budget; the fake dist is deleted).
- Licence test: found `meshoptimizer` (MIT, a `dependencies` entry) missing from NOTICE.md; row added.

- CI run 39323435615 (`full_checks=false`): all three jobs success; every STARTUP/LOADING/SCENE_HOST/FIRST_PAINT line `ok`, FX_RAW and FX_GZIP `n/a` (no fx chunk yet). The first run (39322203597) failed in prebuild because main's 090f1e97b changed package-lock.json, which scripts/scene-factory/host-scenery.json pins; commit f49570073 re-pins it with `npm run scenes:build` (285 generated manifests). Drop it if main fixes the pin first.
- Typecheck: clean with `NODE_OPTIONS=--max-old-space-size=7168`; 3584 ran out of heap in the `test` project.

### In progress / blockers

- None.

### Immediate resume steps

1. `gh run list -R kromate/joinallworld --branch claude/os-p0b-fx`, then read the budget lines from the log.
2. Integrator: merge when every line is ok.

## Release state

- **Local implementation:** verified-local
- **Deployment:** not-requested
- **Release gate:** CI budget lines all ok; integrator merge.
- **References:** docs/OPEN-SOURCE-PLAN.md Phase 0b, 0c

## Checkpoint history

| UTC | Status | Change or finding | Evidence | Next step |
|---|---|---|---|---|
| 2026-10-19T21:10:00Z | ready-for-review | Phase 0b/0c implemented locally | tests above | typecheck, push, CI |
