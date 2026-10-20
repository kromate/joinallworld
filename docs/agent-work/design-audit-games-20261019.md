# Agent work record

Copy this file to `docs/agent-work/<work-id>.md`. One worker owns one record and updates it at each checkpoint. The coordinator owns any shared index.

## Identity

- **Work ID:** `20261019-design-audit-games`
- **Owner:** `games design-audit agent`
- **Model / effort:** `<model> / <effort>`
- **Thread:** `<thread id or local>`
- **UTC updated:** `2026-10-20T01:30:00Z`
- **Status:** `ready-for-review`
- **Work state:** `implementation | deployment`

## Goal and boundaries

- **Goal:** `Design audit of the games screens (hub, Games and Tables apps, each game start and play screen, arena entries, replay) for phones.`
- **In scope:** `UI of the games hub, Games and Tables apps, Oro, the five table boards, Clans and the arena stage bar`
- **Out of scope:** `behaviour, data, 3D arena code, scene and shared shell styles`
- **Exclusive file ownership:** `src/app/features/games/*.vue, src/app/features/tables/*.vue, src/app/features/arena/ArenaStage.vue`
- **Input contract:** `main at 7017b6d01`
- **Output contract:** `branch design/games, before and after screenshots`
- **Dependencies:** `none`

## Repository state

- **Repo:** `Allworld, worktree`
- **Host:** `local`
- **Branch / worktree:** `design/games`
- **Base:** `7017b6d013b344d096563fd652b3a201d4c6446f`
- **Current commit:** `see branch head`
- **Dirty status:** `clean after commit`
- **Port/process ownership:** `none running; port 5428 reserved for the capture run`

## Progress

### Done and exact evidence

- Phone, 320 and desktop captures; typecheck clean; tables tests 61 pass — `design-audit/shots/games`

### In progress / blockers

- None

### Immediate resume steps

1. `Coordinator reviews the branch`
2. `Merge design/games`

## Release state

- **Local implementation:** `not-started | active | verified-local`
- **Deployment:** `not-requested | prepared | running | verified`
- **Release gate:** `<remaining approval or acceptance evidence>`
- **References:** `<repo-relative docs, issue, or source paths>`

## Checkpoint history

| UTC | Status | Change or finding | Evidence | Next step |
|---|---|---|---|---|
| `<timestamp>` | `<status>` | `<short update>` | `<exact path or command>` | `<next action>` |

Keep records portable: use synthetic examples and public evidence only. Never put credentials, tokens, private user data, machine-specific secrets, or raw personal-data dumps here. A local `/tmp` path is evidence on its originating host; re-run or copy the result before treating it as shared evidence. Do not auto-commit, push, kill another worker's process, or claim deployment from a local check.
