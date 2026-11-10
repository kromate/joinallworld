# Agent work record

## Identity

- **Work ID:** `20261110-first-hour`
- **Owner:** `Claude`
- **Model / effort:** `Fable 5.2 / default`
- **Thread:** `local`
- **UTC updated:** `2026-11-10T09:00:00Z`
- **Status:** `released`
- **Work state:** `done`

## Goal and boundaries

- **Goal:** The five checked findings of the 10 Nov growth audit that come after the first-visit fixes: count every life that reaches the game, keep a guest who moves home on goals they can do there, count real share sends, offer a visitor their own city, and point the first-minute card at someone who is present.
- **In scope:** `src/app/startExtras.ts`; `src/game/systems/goals.ts` (the `life.started` handler) with `src/game/settle.test.ts` and `src/game/integration.test.ts`; `src/ui/attention.ts` (`COACH_GOALS`); the fixed list of client signals (`src/types/growth.ts`, `server/growth/metrics.ts`); `ShareSheet.vue`, `growthStore.ts`, `loopShare.ts`, `captureShare.ts`; the share page's cache header (`server/routes/growth.ts`); `src/app/features/start/suggestCity.ts` (new) and `EntryPage.vue`; `src/app/features/firstminute/*`; the regenerated scene and talk provenance.
- **Out of scope:** ad accounts and spend, invite rewards, translation, house agents outside Lagos, the entry page's backdrop.
- **Exclusive file ownership:** the paths above, for this change only.
- **Input contract:** `origin/main` at `b4f0c6137` (the live build).
- **Output contract:** one commit; released by the usual checked package.
- **Dependencies:** none.

## Repository state

- **Repo:** `joinallworld`, a separate worktree
- **Host:** the owner's Mac
- **Branch / worktree:** `claude/first-hour-20261110`
- **Base:** `b4f0c6137`
- **Current commit:** see checkpoint history
- **Dirty status:** owned paths only
- **Port/process ownership:** a local server while testing; stopped when done

## Progress

### Done and exact evidence

1. **The visit hello for every life.** `startAfterReady` (a lazy chunk) now says the hello once the game is connected and the look is confirmed, for a guest too. Before, only a settled life sent it by itself, so `lives.new`, sessions and return days left guests out. **The numbers step on the release day**: new lives move towards the Play count, and the day-1 percentage can move either way because guests enter the cohort. That is counting, not behaviour.
2. **A guest who moves home goes on at home.** `life.started` moves the chain to Settle in when the life is at home (not when it chose to stay where it was). Settle in pays at once and the chip reads Eat something, Freshen up, Get a job. Before, the chip read "Head out to Freedom Park" and the job goal waited behind two park goals: 62 lives settled and 15 took a job. The two opening goals are passed over, not paid. `COACH_GOALS` is 6, so the coach line speaks up to the job goal. Lives already at chain 0 at home are not repaired.
3. **Real share sends are counted.** Six new aggregate signals: `share-copy`, `share-whatsapp`, `share-telegram`, `share-x`, `share-qr` (a tap, once per open sheet; a copy only when it worked) and `share-native` (only when the phone's sheet finished). The WhatsApp and X buttons of result cards had no handler. `share-sheet` and `share-fallback` keep their meaning. The share page is no longer kept by the browser, so a second opening is counted.
4. **The visitor's own city is offered.** On the home address, when the device's time zone names an open city (or a large one of the same country), the card says "<City> is open in Allworld — start there?" with "Start in <City>" above the tiles. Worked out on the device, no prompt, nothing sent. Nigeria's zone gets none; Play is unchanged.
5. **The first-minute card names someone who is there.** With no other person in the room, a regular standing in the venue is offered ("Say hello to <name>", their card) before "Walk to the Square", and the people line reads "<name> is here". A player back after three hours gets their current goal as the one button.

`src/game/systems/goals.ts` is a pinned source of the scene factory: its pin in `scripts/scene-factory/host-scenery.json` is refreshed, and the scene manifests, briefs and talk banks are rebuilt by their own scripts (`scenes:build`, `talk:build`: hashes only, content digests unchanged, no spend).

Gates: typecheck clean; build passes; `size:download` 0 over budget; smoke tests pass; targeted tests in the checkpoint history.

### In progress / blockers

None.

### Immediate resume steps

1. Mark 10 Nov 2026 on any chart of new lives or day-1 return.

## Release state

- **Local implementation:** `verified-local`
- **Deployment:** `live`
- **Release gate:** typecheck, build, size, tests, live smoke
- **References:** `docs/agent-work/first-session-20261109.md`, `docs/FEED.md`

## Checkpoint history

| UTC | Status | Change or finding | Evidence | Next step |
| --- | --- | --- | --- | --- |
| 2026-11-10T09:00:00Z | verified-local | five changes made | typecheck, build, size and smoke pass | targeted tests against the live commit's known failures, browser check, release |
| 2026-11-10T09:10:00Z | released | live as the commit that precedes this record's update | CI success, continuity ok for 2 identities, live smoke PASS 14 checks; 1,148 targeted tests, the only failures are ones the previous live commit has too | read the share and guest counts after a week |
