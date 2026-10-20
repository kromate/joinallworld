# Agent work record

## Identity

- **Work ID:** `20261019-os-phase2-post`
- **Owner:** Claude (open-source plan, Phase 2)
- **Model / effort:** Sonnet 5.5 / default
- **Thread:** local
- **UTC updated:** 2026-10-20T00:00:00Z
- **Status:** `ready-for-review`
- **Work state:** `implementation`

## Goal and boundaries

- **Goal:** One post stack for the HIGH tier (postprocessing composer, N8AO, bloom, climate grade, vignette, SMAA, tone mapping), delegated to from `quality.ts`.
- **In scope:** `src/scene/fx/post.ts`, `grade.ts` (+ tests), delegation in `src/scene/quality.ts`.
- **Out of scope (narrowed by the coordinator, 2026-10-19):** the first-cut street-light map (`lightmap.ts`) and the spill hooks. It returns later with the baked hero street. `street-kit.ts` and `venues-common.ts` are not touched (they hold no materials anyway).
- **Gates added by the coordinator:** measure the stack on the Mac; if AO is over 3 ms or the whole stack over 5 ms, AO becomes default-off behind `?ao=1`. Report fx chunk raw and gzip from CI. Import only named classes from `postprocessing`.
- **Exclusive file ownership:** `src/scene/fx/post.ts`, `post.test.ts`, `grade.ts`, `grade.test.ts`, `n8ao.d.ts`, `src/scene/quality.ts` (delegation only).
- **Dependencies:** `claude/os-p0b-fx` (owns `src/scene/fx/index.ts` and the budget; not touched here).

## Repository state

- **Repo:** joinallworld, worktree `Allworld-notes/work/os-p2-post`
- **Branch / worktree:** `claude/os-p2-post`
- **Base:** `090f1e97b`
- **Port/process ownership:** none

## Progress

### Done and exact evidence

- Read the code. `createBloom` had no caller before this work (only `ensureEnvironment` is used, by the avatar preview). No venue, street or home host draws through a composer yet; a host adopts `createBloom` (or the fx host) to show the stack.
- `grade.ts` and `post.ts` written with tests: `node --experimental-strip-types --test src/scene/fx/*.test.ts` (22 pass, includes main's `index.test.ts`). Twelve grade fingerprints are pinned in `grade.test.ts`.
- Typecheck: client and test projects clean at 7 GB heap (`npm run typecheck`'s 3.5 GB heap runs out in the test project).
- `quality.ts`: `createBloom` keeps its signature (one optional trailing `grade` argument) and delegates to `fx/post.ts`.
- Street harness (`src/scene/street-harness.ts`, dev only): `?post=1` draws through the stack, `AO is on, `&ao=0` turns it off, `&bench=1` exposes `window.__bench(frames, 'plain'|'post')`.
- CI run 39328266128 (before dropping SMAA): fx chunk 336,874 raw / 161,801 gzip, FX_GZIP over its provisional 120,000. SMAA's images were about 60 kB gzip, so SMAA was replaced by 4x MSAA (commit after that run). CI rerun: 39330014232.
- Standalone Rollup sizes (vite lib build of post.ts, game/ external): postprocessing named classes 267 kB raw / 93 gzip with SMAA, 160 / 33 without; n8ao 174 / 87.

### In progress / blockers

- Frame timings on the Mac (Apple M4 Pro, real GPU through Chrome headless=new, ms per frame with a one-pixel read after each frame, median of 7x40 frames, three alternating rounds; other agents' captures were running, so +-0.5 ms noise): street harness, dusk, `quality=high`.
  - 1920x1080: plain 1.7 to 2.0; stack without AO 3.4 to 4.3 (about +2); stack with AO 4.8 to 5.0 (about +3.1 over plain, AO itself about +0.7 to 1.5).
  - 2880x1620 canvas (2x; the stack's buffers are capped at 1.5x): plain 2.5 to 2.7; without AO 4.1 (+1.5); with AO 6.3 to 6.4 (+3.7, AO itself about +2.2).
  - Both gates pass (AO under 3 ms, stack under 5 ms), so AO is default on; `?ao=0` turns it off. Caveats: this street is light (plain 2 ms) and AO redraws the scene for depth, so it grows with the scene; an M4 Pro is a fast GPU; integrated GPUs on the high tier (any desktop) can be several times slower. The governor (phase 7) should be able to drop it.
- Wired: `venue-world.ts` (the one place venues, the street and homes are drawn) starts `loadFx` after the first frame on the high tier only, draws through `fx.post` when present, resizes it in `frame()`, re-grades in `applyLook()` and disposes with the host. `loadFx(tier, context)` in `fx/index.ts` builds the stack behind `fxUsesPost`. `look.ts` and the scene builders (`venue-scenes.ts`, `street-scene.ts`, `home-scene.ts`) needed no change: they never call a renderer, and `lazyEnvironment` is only used by the avatar preview.
- Before/after at dusk, 1280x800: `docs/evidence/out/os-phase2-before.png`, `-after-ao.png`, `-after.png` (stack without AO; git-ignored); 800 px copies for the critic: `docs/agent-work/os-phase2-post-before.png`, `-after.png`. The picture changes subtly: deeper violet sky, a soft vignette, slightly cooler shadows, faint contact darkening where fences meet the ground.
- Final CI run 39338244351 (success): STARTUP_RAW 613,913, STARTUP_GZIP 223,137, STARTUP_BROTLI 196,222, SCENE_HOST_RAW 81,672 / GZIP 30,863, FX_RAW 247,367 / FX_GZIP 105,832, LOADING ok. fx chunk includes n8ao because origin/main did not yet have the `fx-ao` rule.
- One real startup regression found and fixed on the way: the first wired build had engine +2.81 kB (STARTUP_RAW 616,723, smoke test over its 616,000). Cause: `import('../../game/cities/registry.ts')` inside `fx/index.ts` made Rollup keep every export of the registry in the engine chunk. Replaced by a static `import { cityRules }` (commit 7b68d4485); engine is back to 250.00 kB. Found by diffing the engine chunk of two throwaway `story/` builds (deleted).
- venue-world.ts is pinned by scripts/scene-factory/host-scenery.json: its new SHA is in commit 24fa3e68f (mechanical, `npm run scenes:build`, 1,151 scenes unchanged; droppable and redoable at integration).
- An earlier STARTUP_BROTLI over (196,356 vs 196,300): hash noise. STARTUP_RAW is 613,913 in main's run, in run 39328266128 and in 39330014232, gzip within 6 bytes, and nearly every chunk filename (even untouched ones such as AccountSettings) differs between main's build and mine, so brotli sees different random hash strings (main 196,250, mine 196,322 and 196,356). Startup code did not change.
- CI run 39330014232 (with MSAA, no SMAA): fx chunk 246,265 raw / 105,369 gzip, FX_RAW and FX_GZIP ok. STARTUP_BROTLI over by 56 bytes (196,356 vs 196,300) although STARTUP_RAW is identical to main (613,913) and gzip is lower: brotli noise from chunk hashes, main sat at 196,250. Not caused by a size change in startup code.

### Immediate resume steps

1. Re-run the harness URL above on a lower-end GPU for a second ms row.
2. Phase 7's governor to switch AO off when frames are slow; the integrator to confirm `fx-ao` is its own chunk (origin/main did not yet carry it when this was written).

## Release state

- **Local implementation:** `active`
- **Deployment:** `not-requested`

## Checkpoint history

| UTC | Status | Change or finding | Evidence | Next step |
|---|---|---|---|---|
| 2026-10-19T22:00:00Z | active | Scope narrowed: light map dropped | coordinator message | build grade and post |

## Critic scorecard (wave 1)

- Critic: Claude (Fable 5.1), 20 Oct 2026; full card in [../evidence/critic-wave1-20261020.md](../evidence/critic-wave1-20261020.md#phase-2-one-post-stack-bloom-grade-vignette-n8ao-msaa-on-the-high-tier-20261019-os-phase2-post).
- Average before to after (street only; Kano and home not captured): 1.30 to 1.25 (no category moved; Performance evidence 2 to 1.5 because calls and triangles read 1 and 1 under the composer).
- Failures standing: HUD of cards; HUD over the pavement; no renderer diagnostics after the change (frames.md not updated).
- Verdict: no, not as shipped: the change is barely visible (deeper sky, vignette; I cannot find the AO) for +1.5 ms (+3.7 with AO) and 106 kB gzip; ship AO off or behind `?post=1` until a pair shows it.
- Weakest surface: street Lighting (nothing emits); next change: lamp, window and sign emitters above the bloom threshold plus a warm ground disc under each.
