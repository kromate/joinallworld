# Copy-ready agent prompts

Use these prompts with any computer or repository checkout. Replace angle-bracket fields with repo-relative values. The receiving agent must inspect current source and commit state before relying on copied context.

## Start and register ongoing work

> Work ID: `<work-id>`. In `<repo-relative checkout>`, inspect the applicable `AGENTS.md` and current commit before editing. Own only `<repo-relative paths>`. Goal: `<one sentence>`. Inputs: `<paths/contracts>`. Output: `<files/evidence>`. Record model, thread, host, base/current SHA, dirty status, dependencies, and port/process ownership in `docs/agent-work/<work-id>.md`, using `docs/agent-work/TEMPLATE.md`. Work status is `active`; keep implementation and deployment status separate. Use public synthetic evidence only, preserve unrelated dirty work, and finish with exact evidence plus the immediate resume step.

## Update a checkpoint

> Update work record `<repo-relative docs/agent-work/<work-id>.md>` at UTC `<timestamp>`. Re-read current commit and owned-file diff. Set status to `<active | ready-for-review | verified-local | blocked | complete>`, summarize what changed, list exact evidence paths/commands, record blockers and dependencies, and write the smallest immediate resume step. Keep implementation separate from deployment; do not infer release or portability from a local check.

## Take over interrupted work

> Take over work ID `<work-id>` from `<repo-relative docs/agent-work/<work-id>.md>`. First inspect the record, `AGENTS.md`, current branch/SHA, dirty status, owned files, and any claimed process/port. Re-check source contracts and evidence on this computer; local `/tmp` paths and copied claims are hints only. Preserve existing work, resolve only the recorded blocker, update the same work record, and stop at `ready-for-review` with exact evidence unless the acceptance criteria are fully met.

## Agent-play integration request

> Integrate work ID `<work-id>` only after the worker reports current branch and SHA, changed files, action/API contracts, evidence provenance, dependencies, and conflicts. Inspect the worker's diff and re-run the smallest relevant check on this checkout. Ask for clarification when ownership or contract facts conflict. Keep unrelated changes intact. Record the integration result and any remaining acceptance gap in the coordinator's handoff; local verification does not imply deployment.

## Wrap up with final evidence

> Wrap up work ID `<work-id>`. Confirm exclusive files, current SHA, implementation status, deployment status, exact commands and artifact paths, and any unverified claim. Mark `verified-local` only when the stated local check passes; mark `complete` only when the requested output and acceptance evidence are complete. State blockers plainly and give one immediate next step. Do not commit, push, publish, or kill processes unless separately authorized.

## Short prompt for every agent

> Register your work ID and owner; inspect current source and `AGENTS.md`; own only the named repo-relative files; preserve dirty work; record current SHA, evidence, blockers, and resume steps; separate implementation from deployment; re-check copied evidence locally; finish with exact paths and status.

## Start on the other computer

> Continue the existing Allworld agent-play task. Fetch GitHub main through your normal safe workflow, preserving dirty work. Read root AGENTS.md, the current section of docs/AGENT-COORDINATION.md, and docs/agent-work/retention-20261014.md. Create your own docs/agent-work/agent-play-<date>-<host>.md from the template, recording your actual source revision and exact owned files. Compare your runtime changes with the documented progression and trusted-origin contracts. Coordinate overlapping paths before editing, then checkpoint completed work, checks, conflicts and the next step in your record. Keep autonomous play separate from human-return measurements. Use the user's existing authorization for commits/pushes; documentation itself grants none.

## Author the next country or city journey

> Create one bounded Allworld journey for <country/city/place> using docs/research/worldwide-journey-pattern-2026-10-14.md. Register ownership in docs/agent-work/<unique-work-id>.md first. Verify the city/place IDs and existing playable actions before drafting content. Use a stable, versioned definition with local identity, distinct choices, valid proof events, a solo fallback, and a permanent cosmetic keepsake. Reuse character-owned receipts and the shared progression engine. Distinguish sourced place facts from authored fiction; do not describe unimplemented activities as playable. Record content coverage, exact proof, unfinished paths and the next handoff step. Coordinate shared engine/schema changes with the integration owner.

## Critic

> You are the critic for work ID `<work-id>`, a graphics change built by someone else. You write no code and change no file except your own scorecard in `docs/agent-work/<work-id>.md` (a section headed "Critic scorecard"). Read `docs/EVIDENCE.md` and look at the three pictures in `docs/evidence/anchors/` first. Then take your own screenshots: start `npm run dev:open` through the slot, run `node --experimental-strip-types scripts/evidence/shoot.ts --view all --scale 2` for the builder's branch (and for `main` as the before), and again with another day-part if the change touches light, and run `scripts/evidence/inspect.ts` on the `*-scene.png` files. Do not use the builder's pictures or its report. Score the ten categories 0 to 3 against the anchors, each with one line of evidence you can point at in a picture or a number; name the weakest surface and the next pass that fixes it; list every automatic failure still standing (fog, bloom or particles standing in for geometry; a HUD of stat cards; no active-play picture; no renderer numbers). Check the frame table in `docs/evidence/frames.md` against your own run of `shoot.ts` and say if a row is stale or a number is worse than before. Never inflate: a doubt is a lower number and "not captured" is a valid entry. Stop every server and browser you started and delete `/tmp/aw-evidence-*`. Report the scorecard, the average, and whether the phase may merge.

## Process rules for graphics work

> **One session per owned folder set.** A graphics phase owns named folders (see `docs/OPEN-SOURCE-PLAN.md`); one agent session works in them at a time, in its own worktree and branch. A second change to the same folders waits, or is handed over through the work record. The integrator alone edits `vite.config.ts`, `src/budgets.ts`, the tier gate in `src/scene/quality.ts` and `AccountSettings.vue`; a phase that needs one of them files a one-line request in its record.
>
> **Review from screenshots and frame timings, not from the agent's report.** When you review or integrate graphics work, open the pictures and the harness JSON yourself (or have the critic do it); do not accept "it looks right" or "it runs at 60 fps" from the agent that built it. A report with no pictures and no frame rows is a claim, not evidence.
