# Agent work record

## Identity

- **Work ID:** `20261020-design2-phone-apps`
- **Owner:** design round two, phone-apps agent
- **Model / effort:** Sonnet 5.5 / default
- **Thread:** local
- **UTC updated:** 2026-10-20
- **Status:** `ready-for-review`
- **Work state:** `implementation`

## Goal and boundaries

- **Goal:** Make the in-game phone device and the phone-life and phone-money apps work well on tablet (768), 1920 and 3440 wide screens without changing phone or laptop layouts.
- **In scope:** `src/ui/phone/phone.css`, `src/app/features/phone/PhoneDevice.vue`, `src/app/features/sim/SimSheet.vue`.
- **Out of scope:** scene, game, budgets, shared shell files, server code.
- **Exclusive file ownership:** the files claimed as phone-life and phone-money in the design-audit claims folder.
- **Dependencies:** branch `design/all` (round one).

## Decisions

- The device grows a step on screens at least 700 px wide and 1000 px tall: 448 px wide, up to 920 px tall, and always clear of the top bar. Icons 64 px, app text 16 px. Screens over 2400 px already get the interface zoom, so no separate step for them.
- The Wider button shows from 700 px (was 900), so tablets can open the wide sheet; wide mode itself is unchanged.
- Tables and Games open wide by default on windows of at least 1400 x 900, until the player makes their own choice with the button (the choice lasts across apps, as before).
- On desktop the home bar sits in a 20 px strip under the app body instead of over the last lines.
- Notification shade notes use light text (they were dark on dark).
- Sim sheet tabs trimmed from 480 px so all seven fit.

## Repository state

- **Branch / worktree:** `design2/phone-apps`
- **Base:** `85f19fc64`
- **Port/process ownership:** dev server on 5451, started and stopped by the capture script only.

## Progress

### Done and exact evidence

- Type check clean (`npm run typecheck:slot`).
- Tests: `src/ui/phone/phone.test.ts`, `phoneChrome.test.ts`, `src/app/components.test.ts`, `showcase.test.ts`, `companion.test.ts`, `sheetScope.test.ts`: 77 pass, 0 fail.
- After shots at phone, desktop, tablet, hd, ultrawide for phone-life and phone-money in the design-audit shots folder.

### In progress / blockers

- None.
