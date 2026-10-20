# Agent work record

## Identity

- **Work ID:** `20261020-os-phase7-governor`
- **Owner:** Claude (open-source plan, Phase 7)
- **Model / effort:** Sonnet 5.5 / default
- **Thread:** local
- **UTC updated:** 2026-10-20T00:00:00Z
- **Status:** `ready-for-review`
- **Work state:** `implementation`

## Goal and boundaries

- **Goal:** A frame governor that steps the render scale down and probes back up (idea 17), and shader warm-up that covers what is drawn later plus a loading screen that waits for the first real draw (idea 18).
- **In scope:** `src/scene/governor.ts` + test, `src/scene/street-life/adaptive.ts` + test, `src/scene/shader-warmup.ts` + test, hook lines in `src/venue-world.ts` (pinned host file: not re-pinned here), one hold in `src/app/scene/ScenePane.vue`, frame rows in `docs/evidence/frames.md`.
- **Out of scope:** anything that changes what is drawn; any new bytes in the first download; re-pinning `scripts/scene-factory/host-scenery.json` (integrator).
- **Exclusive file ownership:** the files above.
- **Dependencies:** phase 1 (rain) and phase 2 (post stack) are on main.

## Repository state

- **Repo:** joinallworld, worktree `Allworld-notes/work/os-p7-governor`
- **Branch / worktree:** `claude/os-p7-governor`
- **Base:** `53a738808`
- **Port/process ownership:** dev server on 5215 (slot 2) while measuring; stopped afterwards.

## Progress

### Done and exact evidence

- `src/scene/governor.ts` + `governor.test.ts` (12 tests): 90-slot ring, p90 over 21 ms steps down 0.1 (floor 0.6), 45 clean frames probe up, a missed probe doubles the wait (ceiling 16x), a step that buys under 5 % is undone and the verdict says `pressed`, a lone gap over 150 ms is ignored, a gap over 1 s is not a frame, a rebuilt scene's first 2 s are not judged, `?scale=` locks. `node --experimental-strip-types --test src/scene/governor.test.ts`.
- `adaptive.ts` reads the governor's verdict (`pressed` shrinks, 5 s at full scale grows, doubling wait when growth was too much); `adaptive.test.ts` (9 tests). `draw.test.ts`'s adaptive test was rewritten for the new source; that file already fails 7 tests on main in this checkout (native street people, unrelated), so the rewritten test could not be run there.
- `shader-warmup.ts`: `hold(..., buffer)` links the scene's programs against the post stack's buffer once (`Post.target`, a one-line getter added to `fx/post.ts`); tests for rain (hidden splashes are compiled) and the buffer; a contract test that three's `compile` uses `traverse`.
- Hooks in `src/venue-world.ts` (see the report): governor creation, `applyScale`, feed in `tick`, `reset` in `setLocation`, release in `dispose`, `data-drawn` + `allworld-drawn` at the first draw, diagnostics `governor`. `src/app/scene/ScenePane.vue` `hostUp()` waits for it (2.5 s at most).
- Typecheck: `npm run typecheck` through the heavy slot, 5 projects, 0 errors.
- Evidence rows: `docs/evidence/frames.md`, section "Phase 7".
- CI run 39353622446 on the final commit `bce655867`: typecheck-fast and release-policy success; build-and-smoke-fast stops at the expected venue-world pin (`sourceFiles[1226]`), so no STARTUP / SCENE_HOST / FX lines. A throwaway branch with only the pin changed then stopped at the next check (generated scene manifests embed the host hash), so the budgets were not read; the integrator's `npm run scenes:build` + build reads them. Size estimate (esbuild, minified): governor.ts 2.1 kB raw / 1.1 kB gzip, adaptive.ts +0.4 kB, all in the scene host; ScenePane.vue (first download) about +0.3 kB raw. The throwaway branch is deleted.

### In progress / blockers

- The 150 to 200 ms gate stall is the street scene's build (JS), not shaders; out of this phase.
- Android emulator rows not taken.

### Immediate resume steps

1. Integrator: re-pin `scripts/scene-factory/host-scenery.json` (venue-world.ts) with `npm run scenes:build`.
2. Read STARTUP (ScenePane.vue grew by about 0.3 kB; STARTUP_BROTLI has been within 100 bytes of its limit) and SCENE_HOST on the pinned build.

## Release state

- **Local implementation:** active
- **Deployment:** not-requested
- **Release gate:** CI, typecheck-fast, evidence rows; prebuild is expected to fail on the venue-world pin (integrator re-pins).
- **References:** `docs/OPEN-SOURCE-PLAN.md` Phase 7, `docs/OPEN-SOURCE-LEARNINGS.md` ideas 17 and 18.

## Checkpoint history

| UTC | Status | Change or finding | Evidence | Next step |
|---|---|---|---|---|
| 2026-10-20 | active | Started | this file | baseline measurement |

## Critic scorecard (wave 2)

- Critic: Claude (Fable 5.1, `os-critic-wave2`), 20 Oct 2026, from the record and `frames.md` only; full card in `docs/evidence/critic-wave2-20261020.md`.
- Performance evidence: 2 of 3 (rows, bottleneck named, budgets ok after the re-pin; not 3 because there is no phone and no release build, most rows are n = 1 to 3 on a loaded Mac; the governor alone is 1.5).
- Measured gains are real and small: loading card gone at the first draw instead of 110 to 150 ms before it; worst frame with `?post=1` 150/117/117 to 100/83/83 ms (n = 3). The governor itself was exercised only by a fill-bound desktop stand-in and a 6x CPU throttle.
- "No stall over 100 ms in the first 10 s" was not met: the 150 to 200 ms gate stall is the street scene's build in one JS task, which a render-scale governor (it ignores lone gaps over 150 ms) and a shader warm-up cannot shorten; it needs the scene build sliced or started earlier.
- Verdict: yes (keep), unproven; do not count it as a speed gain until a phone row exists. Missing: a phone or Android emulator, a release build, a quiet machine with n of 5 or more, the gate stall as its own item.
