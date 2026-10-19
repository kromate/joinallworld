# Agent work record

## Identity

- **Work ID:** `20261019-design-audit-shell-hud`
- **Owner:** design audit, shell-hud group
- **Model / effort:** Sonnet 5.5 / default
- **Thread:** local
- **UTC updated:** 2026-10-19
- **Status:** `ready-for-review`
- **Work state:** `implementation`

## Goal and boundaries

- **Goal:** Audit and fix the in-game shell on phones: HUD, bottom nav, online/share sheets, companion, person card, generic sheet chrome.
- **In scope:** `src/app/features/{hud,nav,notice,companion,calls,glue,announce}/`, `src/app/ui/`, `src/app/App.vue`, `src/ui/{shell,tokens,compact,controls}.css`, `src/ui/panels/` except `creator.css`. Design only.
- **Out of scope:** behaviour, data, `src/scene`, `src/game`, other groups' files.
- **Exclusive file ownership:** the shared style files above.
- **Dependencies:** none.

## Repository state

- **Repo:** Allworld, worktree on branch `design/shell-hud`
- **Branch / worktree:** `design/shell-hud`
- **Base:** `7017b6d01`
- **Port/process ownership:** dev server on port 5423, started and stopped by the capture script.

## Progress

### Done and exact evidence

- Worktree, screens file, before and after captures for 14 screens (phone and desktop).
- Fixes: online sheet note no longer clipped (inherited no-wrap from the top bar); companion header gear no longer covers the subtitle and keeps 8 px from Close; More menu is taller and shows a scroll hint; disabled nav tab is more readable; the clock no longer truncates at 340 px; removed dead top-bar and notice rules from `src/ui/shell.css` (minified 54869 to 50617 bytes).
- Evidence: `npm run typecheck:slot` clean; 75 tests pass in phone, entry, components, hud and companion test files.

### In progress / blockers

- Not captured: person card, notices and safety cards, calls (need another person or outside services).

### Immediate resume steps

1. Coordinator reviews the commit on `design/shell-hud`.

## Release state

- **Local implementation:** active
- **Deployment:** not-requested
