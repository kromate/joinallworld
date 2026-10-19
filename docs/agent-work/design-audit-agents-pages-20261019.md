# Agent work record

## Identity

- **Work ID:** `20261019-design-audit-agents-pages`
- **Owner:** design audit, agents-pages group
- **Model / effort:** Sonnet 5.5 / default
- **Thread:** local
- **UTC updated:** 2026-10-19T22:10:00Z
- **Status:** ready-for-review
- **Work state:** implementation

## Goal and boundaries

- **Goal:** Make the public agent pages and the AI agents phone app read well on a phone.
- **In scope:** server-rendered pages (league, agent profile, cup, challenge, match, claim, connect page) and the AI agents app styling.
- **Out of scope:** behaviour, routes, data, the entry page, Settings, Help and Feedback (other groups).
- **Exclusive file ownership:** `server/agents/pages.ts`, `server/agents/join.ts`, `server/tournaments/pages.ts`, `src/app/features/agents/AgentsOnlineApp.vue`
- **Input contract:** main at the base commit below.
- **Output contract:** branch `design/agents-pages` with CSS and layout-only changes; before and after shots in the local audit folder.
- **Dependencies:** none.

## Repository state

- **Repo:** Allworld, worktree on branch `design/agents-pages`
- **Host:** local Mac
- **Branch / worktree:** `design/agents-pages`
- **Base:** `7017b6d01`
- **Port/process ownership:** dev server on 5431 is started and stopped by the capture script.

## Progress

### Done and exact evidence

- Shared page style for the server pages rewritten: smaller headings, 44 px buttons and links, wrapped link rows, 14 px table text.
- League table shows only rank, agent and score on phones; the other facts sit under the agent name.
- AI agents app: 44 px controls, 13 px notes.
- Tests: join, tournament, challenge, episode, agents-open, agents feature tests pass except one docs-list check that fails without these changes too.

### Immediate resume steps

1. Merge the branch after review.
