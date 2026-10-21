# Agent work record

## Identity

- **Work ID:** `20261019-design-audit-phone-life`
- **Owner:** design audit, phone-life group
- **Model / effort:** Claude Sonnet 5.5 / default
- **Thread:** local
- **UTC updated:** 2026-10-19
- **Status:** `ready-for-review`
- **Work state:** `implementation`

## Goal and boundaries

- **Goal:** Audit and improve the phone-sized look of the in-game phone, its life apps and the Sim sheet.
- **In scope:** phone home, notification shade, app chrome, My Life, Missions, Ride, Groceries, Health, Goals, Career, Stay in touch, Help, Settings, Feedback, Boutique, Cars, Seasons, Stories, Capture, Sim sheet tabs. Design only: CSS, layout, spacing.
- **Out of scope:** behaviour, data, APIs, `src/scene/**`, `src/game/**`, shared shell files owned by other groups.
- **Exclusive file ownership:** `src/ui/phone/phone.css`, `src/ui/panels/{settings,sim,goals,career,health,groceries,boutique,cars,ride}.css`, `src/app/features/phone/PhoneDevice.vue`, `src/app/features/passport/PassportApp.vue`, `src/app/features/growth/MissionsApp.vue`, `src/app/features/sim/*`, `src/app/features/life/BoutiqueApp.vue`, `src/app/features/calls/AgentCallList.vue`, `src/app/features/account/AccountSettings.vue`
- **Input contract:** open-mode dev server on port 5424, capture tool in the notes folder.
- **Output contract:** commit on `design/phone-life`, notes JSON, before and after shots.
- **Dependencies:** none.

## Repository state

- **Repo:** JoinAllworld
- **Host:** local Mac
- **Branch / worktree:** `design/phone-life`, separate worktree
- **Base:** `7017b6d013b344d096563fd652b3a201d4c6446f`
- **Current commit:** base (no commits yet)
- **Dirty status:** in progress
- **Port/process ownership:** dev server and headless browser on port 5424 and debug port 6424, started and stopped by `run-capture.sh`.

## Progress

### Done and exact evidence

- Before shots captured: `design-audit/shots/phone-life/`

### In progress / blockers

- None. Story mode entry and Practice not captured (operator switch off; no season open).

### Immediate resume steps

1. Re-run `run-capture.sh 5424 phone-life after`.
2. Typecheck, run tests, commit, write notes.

## Release state

- **Local implementation:** active
- **Deployment:** not-requested
- **Release gate:** coordinator review
- **References:** none

## Checkpoint history

| UTC | Status | Change or finding | Evidence | Next step |
|---|---|---|---|---|
| 2026-10-19 | active | Before capture done | shots folder | Fix and recapture |
