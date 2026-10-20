# Agent work record

## Identity

- **Work ID:** `2026-10-20-play-store-android`
- **Owner:** Claude (Claude Code, owner's main chat)
- **Model / effort:** `claude-opus-5-5 / low`
- **Thread:** local
- **UTC updated:** 2026-10-20
- **Status:** `active`
- **Work state:** `implementation`

## Goal and boundaries

- **Goal:** the Play Store Android package (Trusted Web Activity) and an offline page for the installed app, per [STORE.md](../STORE.md) steps 2 and 5.
- **In scope:** `public/sw.js` (a navigation-only fetch handler that shows a built-in offline page; still caches nothing), a lazy module that registers the worker inside the installed app, its line in `src/app/startExtras.ts`, tests, `docs/STORE.md`. The Android project lives outside the repository (`~/allworld-twa`, holds the signing key; never committed).
- **Out of scope:** Play Console actions (owner), the `PLAY_SIGNING_SHA256` secret (after the owner's first upload), Play Billing, iOS.
- **Exclusive file ownership:** `public/sw.js`, `src/app/features/start/offlineWorker.ts`, `src/app/features/start/offlineWorker.test.ts`, the offline-worker line in `src/app/startExtras.ts`, `docs/STORE.md`.
- **Dependencies:** owner: Play Console app, upload of the `.aab`, the App signing SHA-256.

## Repository state

- **Repo:** joinallworld, main checkout
- **Base:** `a6bd12c72`
- **Dirty status:** unrelated dirty records of other agents in `docs/agent-work/` are left alone.
- **Port/process ownership:** none

## Checkpoint history

| UTC | Status | Change or finding | Evidence | Next step |
|---|---|---|---|---|
| 2026-10-20 | active | registered | — | offline page, then the package |
