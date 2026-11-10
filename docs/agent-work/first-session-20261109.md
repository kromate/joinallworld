# Agent work record

## Identity

- **Work ID:** `20261109-first-session`
- **Owner:** `Claude`
- **Model / effort:** `Fable 5.2 / default`
- **Thread:** `local`
- **UTC updated:** `2026-11-09T23:30:00Z`
- **Status:** `verified-local`
- **Work state:** `deployment`

## Goal and boundaries

- **Goal:** Stop losing first-time visitors before they play: remove the notice that covered the no-3D mode, stop telling a newcomer the world is empty, and count visits from in-app browsers.
- **In scope:** `index.html` (the inline notice script), `src/app/features/start/entryModel.ts` + test, `entryPlay.ts`, `EntryPage.vue`, `src/app/features/feed/FeedApp.vue` (opening tab), the fixed list of client signals in `src/types/growth.ts` and `server/growth/metrics.ts`.
- **Out of scope:** the first-session design itself, share loops, ad accounts and spend, character work in other checkouts.
- **Exclusive file ownership:** the paths above, for this change only.
- **Input contract:** `origin/main` at `ce49b5a5c` (the live build).
- **Output contract:** one commit; released by the usual checked package.
- **Dependencies:** none.

## Repository state

- **Repo:** `joinallworld`, a separate worktree
- **Host:** the owner's Mac
- **Branch / worktree:** `claude/first-session-20261109`
- **Base:** `ce49b5a5c`
- **Current commit:** see checkpoint history
- **Dirty status:** owned paths only
- **Port/process ownership:** local dev server on 5230 while testing; stopped when done

## Progress

### Done and exact evidence

First-party numbers, 30 days to 9 Nov 2026 (`GET /api/mod/growth/metrics?days=30`):

- 1,401 landings, 246 pressed Play, 94 still there after ten minutes; 111 new lives; day-1 return about 2%, day-7 about 1%; no life has made a friend.
- Paid, 22–25 Oct: TikTok 315 landings → 13 Play → 0 stayed; Facebook 233 → 20 → 3. The two TikTok videos that open `/` had 239 landings and no Play at all; the one that opens `/agents` had 76 → 13.
- `client.webgl-missing` was counted 298 times, 142 of them on the three paid days.

Reproduced on a local build of `ce49b5a5c` with a phone-sized browser whose canvas gives no WebGL context:

- The inline notice in `index.html` ("3D is switched off in this browser") filled the screen until the app's own dialog opened over it, and filled it again as soon as Play closed that dialog, on top of a working Lite app. Lite already starts by itself for such a browser (`src/app/state/lite.ts`).
- After the change the same browser shows the entry page at once, Play opens Lite, and the Feed opens on World instead of an empty Friends tab.

Changes:

1. `index.html`: the notice is kept for Opera Mini and for a browser too old to run the app; a browser with no 3D gets none. The count is still sent, with two new aggregate signals, `inapp-tiktok` and `inapp-meta`, read from the browser's name.
2. `entryModel.ts`: the pill on the entry page shows the live count only from five upwards (`LIVE_FLOOR`); below that it names the places only.
3. `FeedApp.vue`: when nobody asked for a tab and Friends comes back empty, the Feed opens on World.
4. `entryPlay.ts`, `EntryPage.vue`: Play no longer closes the card at the tap. It stays up saying "Starting…" until the life exists (the app closes it, with a backstop on `jaw:quick-start-done`). Before, the visitor saw a bare screen for two round trips; 246 Play taps became 120 lives.
5. `index.html`: a browser without `Object.hasOwn` or `structuredClone` (before Chrome 98, Safari 15.4) gets the existing "update your browser" notice instead of a blank page or a failure at Play, and is counted as `old-browser`.

Gates on the final tree: typecheck clean; build passes; `size:download` 0 over budget; startup test passes; 214 targeted tests pass (start, growth, quick start, protocol, release). The full suite did not finish inside an hour on this machine; the 59 files that had failures were run on `ce49b5a5c` untouched and on this branch: 100 failures on both, the same names, none in the changed areas.

### In progress / blockers

None.

### Immediate resume steps

1. Run the gates, push, release.
2. After a week, read `client.inapp-tiktok`, `client.inapp-meta` and `client.webgl-missing` beside the paid rows before any more ad money is spent.

## Release state

- **Local implementation:** `verified-local`
- **Deployment:** `prepared`
- **Release gate:** typecheck, build, size, tests, live smoke
- **References:** `docs/ADS-PLAN.md`, `docs/FEED.md`

## Checkpoint history

| UTC | Status | Change or finding | Evidence | Next step |
| --- | --- | --- | --- | --- |
| 2026-11-09T23:30:00Z | verified-local | three changes made and seen in a phone-sized browser with and without WebGL | targeted test `entryModel.test.ts` passes | gates, release |
