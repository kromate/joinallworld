# Agent work record

## Identity

- **Work ID:** `os-phase1-weather-20261019`
- **Owner:** Claude (open-source plan, phase 1)
- **Model / effort:** Sonnet 5.5 / default
- **Thread:** local (spawned by the coordinator)
- **UTC updated:** 2026-10-19T22:50:00Z
- **Status:** ready-for-review
- **Work state:** implementation

## Goal and boundaries

- **Goal:** Phase 1 "Weather you can see": GPU rain with a cover test and splashes; grill and generator smoke from one small own emitter.
- **In scope:** `src/scene/fx/{rain-plan,rain,cover,smoke-plan,smoke,weather}.ts` and their tests; hook lines in `src/scene/venue-scenes.ts`, `src/scene/neighbourhood-scene.ts` (the street host; `street-life/street-scene.ts` is pure and has no scene), `src/scene/home-scene.ts`; rain sound recipe in `src/audio/data.ts`.
- **Scope narrowing from the coordinator (owner rule: only what clearly outweighs its drawbacks):** rain is the deliverable. three-nebula is NOT used. Smoke only if the own emitter stays near 150 lines and at most two draw calls per scene; grill and generator smoke only, no per-vehicle exhaust, no harmattan dust. `burst()` only if free from the same emitter. Sound: rain recipe only (wind and generator drone only if one recipe each with no director change). Rain must cost under 1.5 ms at the phone count in my own timing, or say it was not measured.
- **Out of scope:** post stack, light map (phase 2; `lightmap` is an optional uniform), vehicle exhaust, harmattan dust.
- **Exclusive file ownership:** the files above.
- **Decisions:** three-nebula not used (coordinator's scope narrowing; the own emitter is `smoke.ts`, 97 lines, one draw call). No new sound recipes: `src/audio/data.ts` already has `rain`, `rain-zinc` and `generator` scapes and the director already plays them on weather and outage moments, so nothing was added there. The venue host imports only `roof-record.ts` statically (about 1 kB); everything else is behind `import('./fx/weather.ts')`, so the scene-host chunk does not carry rain, smoke or the cover grid. Deviations: the street host is `neighbourhood-scene.ts` (`street-life/street-scene.ts` is pure layout, no scene); `weather.ts` and `roof-record.ts` are extra files; home rain is on the yard round the house (no window-glass drops).
- **Dependencies:** phase 0b defines the `fx` chunk; my lazy `import('./fx/weather.ts')` lands there once merged. `src/scene/fx/index.ts` is left alone.

## Repository state

- **Repo:** Allworld worktree
- **Host:** this Mac
- **Branch / worktree:** `claude/os-p1-weather` in `Allworld-notes/work/os-p1-weather`
- **Base:** 090f1e97b
- **Current commit:** see git log
- **Port/process ownership:** none

## Progress

### Done and exact evidence

- Pure planners and tests: `src/scene/fx/rain-plan.ts`, `cover.ts`, `smoke-plan.ts` (+ `.test.ts`), `src/scene/roof-record.ts` (the awning recorder; outside `fx/` on purpose, see below) — `node --experimental-strip-types --test src/scene/fx/*.test.ts` (32 pass).
- Draw modules: `rain.ts` (2 meshes, 2 draw calls: drops + splashes), `smoke.ts` (1 mesh, 1 draw call for every source), `weather.ts` (the one door the hosts import lazily).
- Hooks: `venue-scenes.ts`, `neighbourhood-scene.ts` (the street host), `home-scene.ts`; each one lazy `import('./fx/weather.ts')` and only when wet (or a grill/running generator in a venue).
- `npm run typecheck` clean at `--max-old-space-size=6144` (3584 aborts in the `test` project with out-of-memory; not related to this work).
- 24 failures in `src/scene/*.test.ts src/scene/ambient/*.test.ts src/venue-world*.test.ts` are identical on the base commit 090f1e97b (checked in a temporary worktree): character assets missing in this checkout.

- Merged `origin/main` (7ec83aab5, the fx host). The hosts call `import('./fx/index.ts').then(fx => fx.loadFxHere())`; `index.ts` gained `weather` on `FxHost` and `loadFxHere()` (loads at the FX_IMPORTS marker).
- CI on `claude/os-p1-weather` fails in prebuild at "host scenery.sourceFiles[1214] no longer matches its pinned SHA-256": `src/scene/venue-scenes.ts` is pinned by `scripts/scene-factory/host-scenery.json`, so ANY hook line there needs the scene-factory re-pin (`host-scenery.json` hash, then `npm run scenes:build`, then `npm run talk:build`: 570 files). Not done on the branch (integrator). Done on a throwaway branch `tmp/os-p1-weather-ci` (since deleted): CI run 39328077636 all jobs green, budgets: LOADING_RAW 90561/92000, LOADING_GZIP 35277/37000, STARTUP_RAW 613913/616000, STARTUP_GZIP 223116/223500, STARTUP_BROTLI 196286/196300, SCENE_HOST_RAW 82146/192000, SCENE_HOST_GZIP 31076/71000, FX_RAW 14628/400000, FX_GZIP 5781/120000 (all ok).
- GL verified (23:00 local, Apple M4 Pro via Metal, evidence harness `shoot.ts --gpu metal --uncapped --scale 1 --query "quality=<tier>&wet=<0|1>"`, server on 5213): zero console errors in all 12 runs (no GLSL errors; the known /api/street/me 409 is the only classified entry). Frame gaps (uncapped, p50/p95 ms), wet vs dry: high street 1.5/2.7 vs 1.4/2.8, kano 1.5/2.9 vs 1.5/2.9, home 1.2/2.7 vs 1.2/2.5; phone street 1.5/2.7 vs 1.6/2.8, kano 1.4/3.0 vs 1.4/2.9, home 1.1/2.7 vs 1.0/2.6. Rain is inside the noise (under 0.2 ms) on this GPU; not measured on the Android emulator or a phone. Triangles +12k at high (6000 drops x 2) and +1.2k at phone (instances counted by renderer.info); draw calls +1 to +3.
- Screenshots for the critic: `docs/agent-work/os-phase1-weather-{street,kano,home}.png` (high tier, wet=1, taken inside the wake window so the crowns show; resized to 780-880 px wide).
- Changes made for the evidence: `?wet=1|0` override (`src/scene/weather-query.ts`, re-exported from `fx/weather.ts`, applied where the three hosts compute their conditions); `--query` flag in `scripts/evidence/shoot.ts` and `views.ts`; splashes hidden when the window closes or under settle; streak and crown brightness raised after the first pictures were too faint at dusk.
- Splashes only show while the loop runs, so the harness's own still `-scene.png` (taken before the dwell) shows streaks only; the critic PNGs come from a copy of shoot.ts that wakes the scene for 2.5 s before the shot (kept out of the repo).

### Immediate resume steps

1. `git log --oneline -10` and read the checkpoint table.

## Checkpoint history

| UTC | Status | Change or finding | Evidence | Next step |
|---|---|---|---|---|
| 2026-10-19 | active | Record created; scope narrowed by the coordinator | this file | rain-plan.ts first |

## Critic scorecard (wave 1)

- Critic: Claude (Fable 5.1), 20 Oct 2026; full card in [../evidence/critic-wave1-20261020.md](../evidence/critic-wave1-20261020.md#phase-1-weather-you-can-see-os-phase1-weather-20261019).
- Average before to after: street 1.30 to 1.35, Kano 1.20 to 1.30, home 1.56 to 1.56 (VFX 1 to 1.5 street, 1 to 2 Kano, unchanged at home).
- Failures standing: HUD of cards; HUD over the pavement; frames.md has no wet rows. Smoke is not captured in any picture, so not scored.
- Verdict: yes, but tune (the ground is not wet, one near-lens streak, rain falls through the home cutaway).
- Weakest surface: the rainy street's ground; next change: darken, gloss and dim the sun when wet (one uniform on ground and wall materials).
