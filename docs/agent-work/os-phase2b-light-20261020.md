# Agent work record

## Identity

- **Work ID:** `20261020-os-phase2b-light`
- **Owner:** Claude (open-source plan, Phase 2b)
- **Model / effort:** Sonnet 5.5 / default
- **Thread:** local
- **UTC updated:** 2026-10-20T02:30:00Z
- **Status:** `ready-for-review`
- **Work state:** `implementation`

## Goal and boundaries

- **Goal:** Light that comes from things (lamps, windows, signs at dusk and night, ground pools) and a wet ground, on the home street; then say whether `?post=1` now shows a difference worth its cost.
- **In scope:** `src/scene/street/night-lights.ts` (+ test), `src/scene/street/light-pools.ts`, `src/scene/street/wet-ground.ts`, `src/scene/neighbourhood-scene.ts`, `src/scene/street-life/scenery.ts`, `shopfronts.ts`, `parts.ts` (small additions), `src/scene/models/scene-models.ts` (a per-building seed attribute), `src/game/conditions/look.ts` (sun warmth when wet), `src/scene/weather-query.ts` (`?outage=`), `scripts/evidence/views.ts` (+ test: `street-night` view), `docs/evidence/frames.md`, pictures.
- **Out of scope / left out:** baked light map; new texture files; extra draw calls on the phone tier; venue street scenes and the map dive (the home street is what the harness and the critic scored).
- **Pinned files:** none edited so far (props.ts, kit.ts, lighting.ts, look.ts, build.ts, venue-world.ts are pinned and untouched).
- **Dependencies:** wave-1 critic `docs/evidence/critic-wave1-20261020.md`.

## Repository state

- **Repo:** joinallworld, worktree `Allworld-notes/work/os-p2b-light`
- **Branch / worktree:** `claude/os-p2b-light`
- **Base:** `53a738808`
- **Port/process ownership:** none (the dev server on 5216 was stopped).

## Progress

### Done and exact evidence

- `street-night` view added (21:00); `node --experimental-strip-types --test scripts/evidence/*.test.ts` 20 pass.
- Before pictures and numbers on unchanged code: `docs/evidence/out/before-{post0,post1,wet}/` (git-ignored).

- Code (commits on the branch): `src/scene/street/night-lights.ts` (the hour's numbers, pure), `light-pools.ts` (one instanced additive mesh, not on the phone tier), `wet-ground.ts` (one uniform on a copy of the solid material), wiring in `neighbourhood-scene.ts` and `street-life/scenery.ts`, a per-building seed attribute in `models/scene-models.ts`, the sun losing warmth when wet in `game/conditions/look.ts`, `?outage=` in `weather-query.ts`, the `--sid` option and `street-night` view in `scripts/evidence/`.
- Tests: `node --experimental-strip-types --test src/scene/street/night-lights.test.ts src/scene/street-life/scenery.test.ts src/game/conditions/look.test.ts src/scene/home-lighting.test.ts scripts/evidence/*.test.ts` all pass. Typecheck clean (`npm run typecheck`, 7 GB heap).
- CI run 39351373544 (success; typecheck-fast, build-and-smoke-fast, release-policy). STARTUP_RAW 614,012 (main 613,913; +99 bytes from `game/conditions/look.ts`), STARTUP_GZIP 221,002, STARTUP_BROTLI 194,775, SCENE_HOST_RAW 83,315 / GZIP 31,037, FX_RAW 106,008 / FX_GZIP 29,281, LOADING ok. An earlier run (39347658102) failed on a test-file type error and on `createRadialGradient` missing in a stand-in canvas; both fixed.
- Pictures: `docs/agent-work/os-phase2b-light-{dusk,night,night-post,wet}.png` (left before, right after; night-post is after code, `?post=0` left and `?post=1` right). Frame and draw-call rows in `docs/evidence/frames.md`.

### In progress / blockers

- Other tests in the street-life and scene folders (`draw.test.ts`, `venue-floor.test.ts`, `scenes.test.ts`, `city-scenes.test.ts` ...) fail here for reasons outside this change (the native-people catalogue and character assets are not built in this checkout); they do not import the changed code paths.

### Immediate resume steps

1. See the commits on the branch; rerun the shoot commands in the final report.

## Release state

- **Local implementation:** `active`
- **Deployment:** `not-requested`

## Checkpoint history

| UTC | Status | Change or finding | Evidence | Next step |
|---|---|---|---|---|
| 2026-10-20T01:00:00Z | active | before pictures taken, view added | docs/evidence/out/before-* | build emitters |

## Critic scorecard (wave 2)

- Critic: Claude (Fable 5.1, `os-critic-wave2`), 20 Oct 2026, from the committed pictures only; full card in `docs/evidence/critic-wave2-20261020.md`.
- Scores before to after (average): dusk 1.30 to 1.30 (barely different, pools at 0.4 invisible); night 1.35 to 1.40 (Lighting 1.5 to 2: pools under far lamps and a shop front, near field unlit); wet 1.35 to 1.45 (Materials 1 to 1.5, Lighting 1 to 1.5: a banded sheen blob, the road unchanged).
- Standing failures: HUD cards and HUD over the pavement; no HUD-on active-play picture and no `inspect.ts` figures for this phase. The `night-post` pair was shot with AO on (kerb ghost), so no picture shows the live default (post on, AO off).
- Verdict: yes, but tune: it earns its place on cost (one call, +99 bytes, nothing in the frame rows), about a third of wave 1's "light and the wet" item; keep AO off, do not lower the bloom threshold, shoot `?post=1&ao=0` at 2x before claiming the live look.
- Next change: headlamps, tail lamps and a contact shadow for every vehicle on the existing pool mesh (Lighting, Obstacles, and something for wet roads to reflect); raise dusk pool strength.
