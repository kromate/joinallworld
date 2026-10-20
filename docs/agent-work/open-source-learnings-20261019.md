# Agent work record

## Identity

- **Work ID:** `20261019-open-source-learnings`
- **Owner:** Claude (T3 Code thread, owner's Mac)
- **Model / effort:** claude-fable-5-1 (started on claude-opus-5-5) / default
- **Thread:** local
- **UTC updated:** `2026-10-20T00:05:00Z`
- **Status:** `active` (integration of waves 0 and 1)
- **Work state:** `implementation`

## Goal and boundaries

- **Goal:** Read the 19 Oct X post on open-source repos for AI game development, find similar posts on other platforms and GitHub, and collate every idea that applies to Allworld.
- **In scope:** `docs/OPEN-SOURCE-LEARNINGS.md` (research) and `docs/OPEN-SOURCE-PLAN.md` (the implementation plan for all 36 ideas, 14 phases in 5 waves); this record.
- **Out of scope for this record:** the phases' own source (each has its own record, `docs/agent-work/os-phase*-20261019.md`); this record is the integrator's.
- **Exclusive file ownership:** `docs/OPEN-SOURCE-LEARNINGS.md`, `docs/OPEN-SOURCE-PLAN.md`, `docs/agent-work/open-source-learnings-20261019.md`
- **Input contract:** main at 7603fe394; web and GitHub read-only.
- **Output contract:** the research page with a suggested build order; the owner decides what to start.
- **Dependencies:** none. Overlaps in subject with `docs/WOW-PLAN.md` and `docs/agent-plans/viral/RESEARCH.md`; both read and referenced, neither edited.

## Repository state

- **Repo:** JoinAllworld, Desktop checkout (iCloud-synced; nothing pushed from here)
- **Host:** owner's Mac
- **Branch / worktree:** main
- **Base:** 7603fe394
- **Current commit:** 7603fe394 (uncommitted: the two files above)
- **Dirty status:** dirty; unrelated pre-existing changes in `docs/agent-work/docs-pages-features-20261019.md` and `docs/agent-work/story-phase3-stage-inventory-20261019.md` belong to other agents and were not touched
- **Port/process ownership:** none

## Progress

### Done and exact evidence

- Read the post and the ten repos it names; checked each repo's licence and last push with `gh api repos/<r>`.
- Searched X (via the public syndication API), Hacker News, the three.js forum, GitHub search, dev blogs and the Nigerian tech press; Reddit blocks the tools, LinkedIn and Threads returned nothing.
- Read code where the idea depended on it: `billpwchan/neon-zenith` `src/atmos/rain.js` and `src/core/governor.js`; `Faizankhan17623/OpenCity` `js/npcmemory.js` and `js/citynews.js`; the skill files of `gamedev-skills/awesome-gamedev-agent-skills` and `majidmanzarpour/threejs-game-skills`; `rawprogress/fable-cities` `PROMPT.md`.
- Checked Allworld's own state for each idea (`src/scene/quality.ts`, `src/scene/street-life/*`, `src/scene/ambient/*`, `src/scene/reward.ts`, `src/scene/camera-controls.ts`, `docs/WOW-PLAN.md`, `docs/ASSET-PIPELINE.md`, `docs/GRAPHICS-EXECUTION-CHECKPOINT.md`).
- Wrote `docs/OPEN-SOURCE-LEARNINGS.md`: 36 ideas in eight groups, a library table with licences and dates, a ten-step suggested order, and the source list.

### In progress / blockers

- None. Nothing is built; the page is a reading list with a proposed order.

### Immediate resume steps

1. The owner approves `docs/OPEN-SOURCE-PLAN.md` (or picks a wave); wave 0 (evidence tools, `fx` chunk, dependencies) starts first.
2. Each chosen step gets its own work record and branch per `AGENT.md`; steps 1–3 load with the scene host, never the first download (`src/budgets.ts`).

## Release state

- **Local implementation:** `verified-local` (docs only)
- **Deployment:** `verified` (waves 0 and 1 live as 53a738808 since 2026-10-20T00:01Z; release run 39343306083; `release-continuity.mjs after` passed)
- **Release gate:** none for docs; commit when the owner is happy with the page.
- **References:** `docs/OPEN-SOURCE-LEARNINGS.md`, `docs/WOW-PLAN.md`, `docs/agent-plans/viral/RESEARCH.md`

## Checkpoint history

| UTC | Status | Change or finding | Evidence | Next step |
|---|---|---|---|---|
| 2026-10-19T20:40:00Z | complete | Research page written; no source touched | `docs/OPEN-SOURCE-LEARNINGS.md` | owner chooses what to build |
| 2026-10-19T21:05:00Z | complete | Implementation plan written: 14 phases, ownership map, schedule, gates, default decisions | `docs/OPEN-SOURCE-PLAN.md` | owner approves wave 0 |
| 2026-10-19T22:30:00Z | active | Worth-it review: 21 ideas go (narrowed), 9 wait, 6 dropped; three-nebula and Yuka uninstalled | `docs/OPEN-SOURCE-PLAN.md` | run waves 0 and 1 |
| 2026-10-20T00:10:00Z | active | Wave 0 merged: phase 0 evidence tools (anchors proven at 12:00 vs 21:00, bot-walk baseline 8 stalls) and phase 0b fx chunk; scene-factory pins package-lock.json, so every dependency commit needs a re-pin | main 1eb1ee6c1 | wave 1 |
| 2026-10-20T01:20:00Z | active | Wave 1 merged: phase 1 rain and smoke (no shader errors on the Mac GPU, no measurable cost), phase 3 feel (shake patch applied, Reduce-shake switch added), phase 2 post stack (about 3 ms at 1080p, AO on by default); venue hosts re-pinned, talk banks rebuilt; budget measurement made hash-stable | main 37c4c5e3c, 137 targeted tests, typecheck clean | CI + critic, then release |
| 2026-10-19T23:50:00Z | active | Critic scorecard merged (`docs/evidence/critic-wave1-20261020.md`): rain earned its place, post stack not as shipped (now behind `?post=1`), feel unproven but cheap; rain no longer drawn over the cutaway home; talk-factory manifest committed; CI 39342130339 all budgets ok | main 53a738808 | release |
| 2026-10-20T00:01:00Z | active | Released: live build 53a738808, continuity check passed, page 200. Next wave started: phases 4, 7, 2b in their worktrees | `/api/health` | review the three phases, critic, release |
