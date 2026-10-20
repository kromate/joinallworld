# Agent work record

## Identity

- **Work ID:** `play-app-mode-20261020`
- **Owner:** `Play app-mode worker`
- **Model / effort:** `implementation model / high`
- **Thread:** `coordinated feature task`
- **UTC updated:** `2026-10-20T19:38:00Z`
- **Status:** `ready-for-integration`
- **Work state:** `all focused checks passed`

## Goal and boundaries

- **Goal:** Keep external digital-money flows out of the Play app and prepare an optional, once-only Play rating prompt.
- **In scope:** Play-session detection and request headers; app-mode guards for Earn, boosts, tickets, gig pay, creator-pool claims, generic seller payment links, ad-slot rental, sponsored feed cards, and billboard inventory; in-game launch-bonus wording; a lazy rating prompt that is disabled by default; focused tests.
- **Out of scope:** Web-manifest shortcuts, central API-client integration, server route gates, terms and moderation work, Play Console work, publishing, deployment, and Android signing.
- **Exclusive file ownership:** `src/app/playMode.ts`, `src/app/playMode.test.ts`, `src/app/playModeUi.test.ts`, `src/app/startExtras.ts`, `src/app/features/feed/register.ts`, `src/app/features/feed/FeedApp.vue`, `src/app/features/earn/EarnApp.vue`, `src/app/features/promote/BusinessesApp.vue`, `src/app/features/promote/SponsoredCard.vue`, `src/app/features/promote/ShopFront.vue`, `src/app/features/feed/PlansApp.vue`, `src/app/features/feed/WorkApp.vue`, `src/app/features/neighbourhood/NoticeboardApp.vue`, `src/app/features/bonus/BonusHost.vue`, `src/app/features/bonus/BonusLine.vue`, `src/app/features/commerce/CommerceApp.vue`, `src/app/features/bank/BankApp.vue`, `src/app/features/watch/Premieres.vue`, `src/app/features/civic/AdsApp.vue`, `src/app/features/civic/register.ts`, `src/app/features/travel/MapApp.vue`, `src/app/features/travel/MapOverview.vue`, `src/app/features/showcase/ShopEditor.vue`, `src/app/features/showcase/ShareShop.vue`, `src/app/features/showcase/room/ShopInside.vue`, `src/app/features/rating/*`, `server/routes/feed.ts`, `server/routes/promote.ts`, `server/play-ads.test.ts`, `deploy/business.edge.test.ts`, `deploy/calls.edge.test.ts`, `deploy/chat.edge.test.ts`, `deploy/city-foundation.test.ts`, `deploy/cloudflare.test.ts`, `deploy/devices.edge.test.ts`, `deploy/places.edge.test.ts`, `deploy/showcase.edge.test.ts`, `deploy/spaces-models.edge.test.ts`, `deploy/storage.edge.test.ts`, `deploy/voice-notes.edge.test.ts`, and this record. The Play guard in `src/app/features/showcase/ShopPage.vue` was completed and the file was handed back to its moderation owner.
- **Input contract:** Source revision `9a84d02d497f2a0ed24de82e5947f50162a8ffe1`; the shared client adds `playRequestHeaders()` to requests; server routes independently refuse app-mode digital checkouts.
- **Output contract:** Exception-safe `isPlayApp()` and `playRequestHeaders()` exports, conservative app-mode UI guards, a default-off lazy rating prompt, and focused behaviour evidence.
- **Dependencies:** The integration owner owns the central client and server gates; the moderation worker receives `ShopPage.vue` after its Play guard lands.

## Repository state

- **Repo:** `joinallworld`
- **Host:** `isolated feature checkout`
- **Branch / worktree:** `play-store readiness branch / isolated checkout`
- **Base:** `9a84d02d497f2a0ed24de82e5947f50162a8ffe1`
- **Current commit:** `9a84d02d497f2a0ed24de82e5947f50162a8ffe1`
- **Dirty status:** `clean before this record`
- **Port/process ownership:** `none`

## Progress

### Done and exact evidence

- Digital checkout inventory completed — request routes and exact player-facing taps recorded in the task handoff.
- Play launch detection accepts only the exact URL parameter or Android-app referrer, remembers the first tab decision, remains safe when storage fails, and supplies the server header.
- App mode hides Earn, ticket prices and checkout, paid gig controls, boosts, generic seller payment links, real-store earnings and payout links, and related real-money claims. Physical store management remains available.
- App mode hides the Billboards phone app and rent screen, avoids ad and boosted-board map reads, removes billboard layers and sponsored feed cards, and omits boost labels while preserving ordinary business cards, messages and physical-shop visits.
- Launch-bonus promotional copy explicitly says in-game naira in app mode while web copy is unchanged.
- The rating prompt is lazy, app-only, once-only, reward-free, and default-off behind `VITE_PLAY_RATING_PROMPT=on`; it can follow a win, draw, or newly added friend, never a loss or called-off game.
- Focused suite passed: `9` tests, `0` failures. Evidence: `store/play/evidence/app-mode-focused.log` and `store/play/evidence/app-mode-focused.json`.
- Ads extension suite passed: `3` tests, `0` failures. Evidence: `store/play/evidence/app-mode-ads-focused.log` and `store/play/evidence/app-mode-ads-focused.json`.
- Final response audit found that hidden sponsored feed payloads still counted impressions and boosted listings still ranked first without their label. Play responses now omit sponsored payloads before impression counting and return directory and street listings in stable name/id order with `boosted: false`; ordinary listings and web ranking remain available.
- Premiere copy no longer promises listener-based front-row placement when the server still uses ticket order for priced events.
- Final Play ad-response suite passed: `2` tests, `0` failures. Evidence: `store/play/evidence/app-mode-play-ads.log` and `store/play/evidence/app-mode-play-ads.json`.
- Independent Worker edge fixtures now explicitly record current sharing-terms acceptance for players and accounts whose scenarios publish shops, messages, calls, room edits, voice notes, or models. The cookie-free signed notice announcer remains outside the user-sharing gate. Shared Node fixtures are owned by the terms worker.
- The Cloudflare conformance fixture keeps generic devices neutral and records acceptance only for actors that exercise guarded chat, voice, invitation, recovery-parity or founder-message paths. This preserves request-limit and row-budget fixture accounting. The Worker city journey supplies the explicit acceptance hook after quick start.
- Focused Worker consent evidence: the two-file candidate run reached `46/49`; its remaining founder reply consent miss was corrected and the exact founder test then passed (`1/1`). The consent-corrected result is `47/49`, with only the unrelated `/cities` metadata and socket-move row-budget assertions remaining. Exact source base `9a84d02d4`, using the same pinned tooling and candidate-built unchanged assets, also produced `47/49` with those same two failing test identities. Evidence: `edge-terms-focused-candidate-final`, `edge-terms-founder-focused`, and `edge-terms-focused-source-base-assets`.

### In progress / blockers

- Integration-owner typecheck/build/size checks remain.

### Immediate resume steps

1. Integration owner runs the shared typecheck/build/size checks.
2. Review the central client header integration and server refusal gates with the UI inventory below.

## Release state

- **Local implementation:** `ready-for-integration`
- **Deployment:** `not-requested`
- **Release gate:** Central client/server integration, focused checks, money-surface review, and release-owner acceptance remain.
- **References:** `docs/EARN.md`, `docs/PROMOTE.md`, `docs/STORE.md`

## Checkpoint history

| UTC | Status | Change or finding | Evidence | Next step |
|---|---|---|---|---|
| `2026-10-20T16:19:53Z` | `active` | Registered isolated ownership at the required source revision. | `git rev-parse HEAD` | Implement the helper contract first. |
| `2026-10-20T16:26:49Z` | `ready-for-integration` | Completed Play detection, UI guards, promotional wording, and default-off rating prompt. | `app-mode-focused`: 9 passed, 0 failed | Integration owner runs shared checks and reviews server/client gates. |
| `2026-10-20T16:34:00Z` | `ready-for-integration` | Suppressed ad-slot rental, billboard/boosted map inventory, sponsored feed cards and sponsored labels in Play mode while retaining ordinary business discovery. | `app-mode-ads-focused`: 3 passed, 0 failed | Integration owner applies response filters and runs shared checks. |
| `2026-10-20T16:56:11Z` | `active` | Neutralized Play business ordering and removed sponsored feed payloads before impressions; corrected Premiere front-row wording. | Source review; focused server check pending | Run the new focused Play ads server test through the shared heavy queue. |
| `2026-10-20T17:00:00Z` | `ready-for-integration` | Focused response behavior passed. | `app-mode-play-ads`: 2 passed, 0 failed | Integration owner completes shared checks. |
| `2026-10-20T17:19:00Z` | `ready-for-integration` | Edge player/account factories explicitly accept the current sharing rules before guarded sharing journeys. | Static source review and `git diff --check`; shared edge run owned by integration. | Integration owner completes the queued edge suite. |
| `2026-10-20T19:38:00Z` | `ready-for-integration` | Corrected the remaining Worker consent preconditions without changing generic device, rate-limit or row-budget setup. | Two-file candidate 46/49 plus founder-message targeted 1/1; exact-base 47/49 with the same two unrelated failures. | Integration owner stages this final record. |
