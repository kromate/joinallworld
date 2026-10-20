# Agent work record

## Identity

- **Work ID:** `os-phase4-ticker-20261020`
- **Owner:** Claude (Fable 5.1 brief, run by a Sonnet 5.5 agent)
- **Model / effort:** Sonnet 5.5 / default
- **Thread:** local
- **UTC updated:** 2026-10-20T00:00:00Z
- **Status:** ready-for-review
- **Work state:** implementation

## Goal and boundaries

- **Goal:** Phase 4 of docs/OPEN-SOURCE-PLAN.md, narrowed: a city news ticker (Square, HUD notice slot, danfo radio) and a one-day client-side memory of people you greeted or bought a drink for.
- **In scope:** `src/news/` (new, lazy only), `src/app/features/gist/Ticker.vue`, small hooks in `PlacePanel.vue`, `NoticeHost.vue`, `DanfoRun.vue`, `NpcCard.vue`, a wave and a bark in `src/scene/ambient/layer.ts`, tests, docs.
- **Out of scope:** any server table, the "splashed" and "lift" kinds, a radio voice, `src/scene/venue-scenes.ts` and `src/venue-world.ts` (pinned host files), `vite.config.ts`, `src/budgets.ts`.
- **Exclusive file ownership:** `src/news/**`, `src/app/features/gist/Ticker.vue`.
- **Input contract:** main at 53a738808.
- **Output contract:** branch `claude/os-p4-ticker`, CI budget lines all ok.
- **Dependencies:** none.

## Repository state

- **Repo:** joinallworld, worktree `Documents/Allworld-notes/work/os-p4-ticker`
- **Host:** the owner's Mac
- **Branch / worktree:** `claude/os-p4-ticker`
- **Base:** 53a738808dbbdb7a3eba39b6c798931b0084c8ad
- **Current commit:** see git log
- **Dirty status:** owned changes only
- **Port/process ownership:** none

## Progress

### Done and exact evidence

- `src/news/` (banks, observer, ticker, live, radio, acquaintance, memory-lines) and their tests: `node --experimental-strip-types --test src/news/*.test.ts` (all pass); plus the layer test for the wave and bark in `src/scene/ambient/layer.test.ts` (3 older tests in that file fail the same way on main 53a738808: park@10 characters 306000 triangles, a busy market, the full tier's far crowd; not caused by this work).
- `Ticker.vue` mounted in `PlacePanel.vue` (Square) and, as a small root of its own, in the notice slot by `src/app/features/gist/mountTicker.ts`, started from `src/app/chatter/start.ts`; danfo radio hook in `DanfoRun.vue`; memory write in `NpcCard.vue`; wave and bark in `layer.ts`.
- Typecheck clean: `scripts/agent-slot.ts heavy -- env NODE_OPTIONS=--max-old-space-size=7168 npm run typecheck`.
- CI run 39345985436 (branch `claude/os-p4-ticker`), all fast jobs success; STARTUP_RAW 614012 (same as main), STARTUP_GZIP 221009, STARTUP_BROTLI 194671, SCENE_HOST_RAW 83315, LOADING_RAW 90561, FX_RAW 106008: every line ok, no budget raised.

### In progress / blockers

- No screenshot: both server slots were held by other sessions for the whole run.

### Immediate resume steps

1. Review the branch; the integrator merges. Pinned host files are untouched.

## Release state

- **Local implementation:** active
- **Deployment:** not-requested
- **Release gate:** CI budget lines all ok; integrator review
- **References:** docs/OPEN-SOURCE-PLAN.md Phase 4, docs/GIST.md

## Checkpoint history

| UTC | Status | Change or finding | Evidence | Next step |
|---|---|---|---|---|
| 2026-10-20 | active | Design settled. Findings: `src/scene/venue-scenes.ts` and `src/venue-world.ts` are pinned host files, so a `memory` field on `CrowdEntry` cannot reach the layer without touching them; the layer reads the store by id instead. Stalls are player-run (no regular to remember), so "bought" comes from the NPC card's drink. | host-scenery.json | write src/news |
