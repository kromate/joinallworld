# Agent work record

## Identity

- **Work ID:** `20261020-design-audit-shell-games-round2`
- **Owner:** design audit round two, agent shell-games
- **Model / effort:** Sonnet 5.5 / default
- **Thread:** local
- **UTC updated:** 2026-10-20T00:00:00Z
- **Status:** `ready-for-review`
- **Work state:** `implementation`

## Goal and boundaries

- **Goal:** Make the game shell (HUD) and the games read well at 768, 1920 and 3440 wide without changing phone or laptop layouts.
- **In scope:** `src/ui/shell.css`, `src/ui/tokens.css`, `src/ui/compact.css`, `src/ui/controls.css`, `src/app/ui/**`, `src/app/App.vue`, the games app, tables and arena components, `src/ui/panels/tables.css`.
- **Out of scope:** scene, game engine, behaviour, data, other groups' files.
- **Exclusive file ownership:** as claimed in the design-audit claims folder for groups shell-hud and games.
- **Input contract:** branch `design/all`.
- **Output contract:** commit on `design2/shell-games`, updated notes for both groups.
- **Dependencies:** none.

## Repository state

- **Repo:** Allworld, worktree of the main checkout
- **Host:** local Mac
- **Branch / worktree:** `design2/shell-games`
- **Base:** `4d080a3a1`
- **Current commit:** same as base until the first commit
- **Dirty status:** dirty with owned changes only
- **Port/process ownership:** dev server on 5456 (debug 6456), started and stopped by the capture script

## Progress

### Done and exact evidence

- Worktree created; round-two captures for both groups at tablet, hd and ultrawide (phone and desktop re-checked for every shell screen and the arena and chess screens).
- HUD: 16:9 middle on very wide windows (shell.css `#life-overlay` rule), the guide follows it (CompanionHost.vue), the chip list waits behind the menu on tablets, HUD pieces that peek beside the open phone are hidden on 521-999 px windows, money cue is a short pill (attention-dom.ts, shell.css), about 3.5 KB of dead shell.css removed.
- Games: arena lobby and result are one centred column (ArenaStage.vue), thumb pads capped at 1400 px (Football, Fight, Race), Lite list in columns (LiteGame.vue), chess board centred (ChessBoard.vue).
- Typecheck clean; attention, phone, showcase and companion tests pass.

### In progress / blockers

- Nothing open. A :has() rule that opened boards in a wider phone was dropped (Chrome left the layout half updated); recorded as a request to the phone owner in the design audit requests file.

### Immediate resume steps

1. Review the diff on `design2/shell-games`; the coordinator merges.

## Release state

- **Local implementation:** active
- **Deployment:** not-requested
- **Release gate:** coordinator review
- **References:** design audit brief files kept outside the repository

## Checkpoint history

| UTC | Status | Change or finding | Evidence | Next step |
|---|---|---|---|---|
| 2026-10-20T00:00:00Z | active | Registered | this file | audit |
