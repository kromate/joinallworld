# Agent work record

## Identity

- **Work ID:** `20261019-os-phase0-evidence`
- **Owner:** Claude (open-source plan, Phase 0)
- **Model / effort:** Sonnet 5.5 / default
- **Thread:** local subagent of the integrator
- **UTC updated:** 2026-10-19T00:00:00Z
- **Status:** `ready-for-review`
- **Work state:** `implementation`

## Goal and boundaries

- **Goal:** Build the evidence tools for the open-source plan: scorecard, screenshot harness, pixel inspector, bot walk, frame table, critic prompt, skills.
- **In scope:** `docs/EVIDENCE.md`, `docs/evidence/`, `scripts/evidence/`, `.claude/skills/`, an additive section in `docs/AGENT-PROMPTS.md`, one glob in the `test` script of `package.json`.
- **Out of scope:** any game source, `.gitignore`, `src/budgets.ts`, `vite.config.ts`; no deploy, no push to main.
- **Exclusive file ownership:** `docs/EVIDENCE.md`, `docs/evidence/**`, `scripts/evidence/**`, `.claude/skills/**`, `docs/agent-work/os-phase0-evidence-20261019.md`; additive edits to `docs/AGENT-PROMPTS.md`; the test glob in `package.json`.
- **Input contract:** a running `npm run dev:open` server (port 5211) opened with `?diagnostics` (the page then exposes `window.__jaw`).
- **Output contract:** the files above, three anchor PNGs, unit tests, a pushed branch `claude/os-p0-evidence`, a CI run.
- **Dependencies:** none.

## Repository state

- **Repo:** joinallworld, git worktree outside the Desktop checkout
- **Host:** the owner's Mac
- **Branch / worktree:** `claude/os-p0-evidence`, worktree under the notes folder `work/os-p0-evidence`
- **Base:** `090f1e97b`
- **Current commit:** see git log
- **Dirty status:** only the owned paths above
- **Port/process ownership:** dev:open on 5211 and one headless browser, both started and stopped by this work; none left running.

## Progress

### Done and exact evidence

- Tools: `scripts/evidence/{cdp,views,shoot,png,metrics,inspect,walk}.ts` — `node --experimental-strip-types --test scripts/evidence/*.test.ts` gives 18 passing tests; glob added to the `test` script in `package.json`.
- Typecheck: `NODE_OPTIONS=--max-old-space-size=7168 npm run typecheck` through the heavy slot: clean, 5 projects (3584 MB runs out of memory in the test project).
- Anchors: `docs/evidence/anchors/` (three views, page and scene PNG each), taken with `shoot.ts --view all --scale 1 --dwell 3` on 19 Oct 2026.
- Frame table: `docs/evidence/frames.md` from `shoot.ts --view all --scale 2` (capped and `--uncapped`) and `walk.ts`; the walk exits 1 today (8 stalls, worst 233 ms stepping out to the street).
- Docs: `docs/EVIDENCE.md`, critic prompt and process rules in `docs/AGENT-PROMPTS.md`; skills in `.claude/skills/`.
- Merged `origin/main` (7ec83aab5) as the integrator asked.
- Review round (coordinator): view renamed `street-dusk` and shot from the street pose (eye height, street-life scene); `--prove-clock` added and passes (street 156.6 to 67.8, Kano 196.7 to 50.0, home 194.4 to 52.0); `Date.now` shifted in the page as well; walk gate is now 'no more than 8 stalls' (`STALL_BASELINE`); anchors, frames and docs re-taken. 20 tests pass.
- Server on 5211 and every browser stopped; `/tmp/aw-evidence-*` profiles deleted; `.data-open` of this worktree removed.

### In progress / blockers

- `.gitignore` line 10 (`evidence/`) hides every folder called `evidence`, including `docs/evidence/` and `scripts/evidence/`. Files are added with `git add -f`. Integrator request: change the line to `/evidence/` and add `docs/evidence/out/`.
- Android emulator column of the frame table is "not measured".
- CI: run 39327814622 passes (release-policy, typecheck-fast, build-and-smoke-fast; budget lines all ok, FX lines n/a). The first run, 39326567527, failed release-policy because a doc named the open-mode setting; fixed.

### Immediate resume steps

1. `git log --oneline -10` in the worktree.
2. `gh run list -R kromate/joinallworld --branch claude/os-p0-evidence` and read the budget lines.

## Release state

- **Local implementation:** `active`
- **Deployment:** `not-requested`
- **Release gate:** integrator review; CI budget lines all ok
- **References:** `docs/OPEN-SOURCE-PLAN.md` Phase 0

## Checkpoint history

| UTC | Status | Change or finding | Evidence | Next step |
|---|---|---|---|---|
| 2026-10-19 | active | Work record opened | this file | start the dev server and build the harness |
| 2026-10-19 | verified-local | CI 39327814622 green | gh run view 39327814622 | integrator review |
| 2026-10-19 | ready-for-review | Tools, docs, anchors, skills committed; typecheck clean | git log | push and run CI |
