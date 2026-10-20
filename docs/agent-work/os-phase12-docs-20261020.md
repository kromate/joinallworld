# Agent work record

## Identity

- **Work ID:** `20261020-os-phase12-docs`
- **Owner:** Claude (open-source plan, Phases 12 and 13)
- **Model / effort:** Sonnet 5.5 / default
- **Thread:** local
- **UTC updated:** 2026-10-20T04:30:00Z
- **Status:** `ready-for-review`
- **Work state:** `implementation`

## Goal and boundaries

- **Goal:** Art direction page, provenance for the shipped models that did not come through `scripts/assets/`, a local image-to-3D runbook, and the three measurable growth deltas (cost model, first-load check, peers list).
- **In scope:** `docs/ART-DIRECTION.md`, one-line links in `docs/ASSET-PIPELINE.md` and `docs/ASSETS.md`, the runbook section in `docs/ASSET-PIPELINE.md`, `scripts/assets/provenance/meshy.json` with its small checker and test, a "viral week" section in `docs/CAPACITY.md`, `scripts/evidence/first-load.ts` (+ test, + a line in `docs/EVIDENCE.md`), a "Peers to watch" section in `docs/OPEN-SOURCE-LEARNINGS.md`.
- **Out of scope:** game features, `scripts/body/retarget.ts` (the plan names it; it is not asked for here), any server or browser run, any install.
- **Exclusive file ownership:** the files above.
- **Dependencies:** none.

## Repository state

- **Repo:** joinallworld, worktree `Allworld-notes/work/os-p12-docs`
- **Branch / worktree:** `claude/os-p12-docs`
- **Base:** `b004c4e78`
- **Port/process ownership:** none.

## Progress

### Done and exact evidence

- Provenance: `scripts/assets/provenance/meshy.json` (166 files: 38 vehicles, 127 street files, 1 atlas), `scripts/assets/provenance.ts` (`--check`), `provenance.test.ts`. Licence `unverified` throughout; groups say origin, evidence, terms, what is left. Not in `manifests/` because budget.ts and credits.ts would read it as a pack (licence words, packs folder): Help credits cannot list it without changing the licence set.
- `docs/ART-DIRECTION.md`; links in ASSET-PIPELINE.md and ASSETS.md; runbook section in ASSET-PIPELINE.md (licences read with `gh api` on 20 Oct); "where every other shipped model is accounted for" table in ASSETS.md.
- `docs/CAPACITY.md` "A viral week": about $610 a month at 100,000 daily players; prices read from Cloudflare's pages on 20 Oct; the single object, not the bill, is the limit.
- `scripts/evidence/first-load.ts` + `first-load.test.ts` (7 tests, pure judging). Not run against a server. Line added to `docs/EVIDENCE.md`.
- "Peers to watch" in `docs/OPEN-SOURCE-LEARNINGS.md`.
- Tests: `node --experimental-strip-types --test scripts/assets/*.test.ts scripts/evidence/*.test.ts src/licence.test.ts`: 74 of 75 pass; the one failure (`cartridge-assets.test.ts`, "lite has assets") also fails on the main checkout and is not from this work.

### In progress / blockers

- CI run recorded in the checkpoint history.

### Immediate resume steps

1. Integrator: merge `claude/os-p12-docs`; the owner reads Meshy's terms for his plan and fills the `terms` of the two Meshy groups in `provenance/meshy.json`.

## Release state

- **Local implementation:** `active`
- **Deployment:** `not-requested`
- **Release gate:** CI `release-policy` green; integrator merges.
- **References:** `docs/OPEN-SOURCE-PLAN.md` Phases 12 and 13.

## Checkpoint history

| UTC | Status | Change or finding | Evidence | Next step |
|---|---|---|---|---|
| 2026-10-20T03:30:00Z | active | Worktree made; survey done | this file | write the provenance manifest |
| 2026-10-20T04:30:00Z | ready-for-review | All deliverables committed and pushed | `git log origin/main..claude/os-p12-docs` | CI, then merge |
