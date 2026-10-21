# Play moderation UI paths

## Identity

- **Work ID:** `play-moderation-20261020`
- **Owner:** moderation UI lane
- **UTC updated:** `2026-10-20`
- **Status:** ready-for-review
- **Work state:** implementation complete; integration review pending

## Goal and boundaries

- **Goal:** expose report and block entry points for ordinary direct messages, community chat/voice participants, and shop owners using the existing social moderation API.
- **Owned paths:** `src/app/features/messages/MessageBubble.vue`, `src/app/features/messages/MessagesApp.vue`, `src/app/features/messages/messagesText.ts`, `src/app/features/messages/messagesText.test.ts`, `src/app/features/community/CommunityPanel.vue`, `src/app/features/community/communityComponents.test.ts`, `src/app/features/showcase/ShopPage.vue`, this record.
- **Out of scope:** server route/schema/shared type changes, account data changes, browser use, console submissions, deployment, and live report/block actions.
- **Source:** isolated checkout at base `9a84d02d497f2a0ed24de82e5947f50162a8ffe1`; current commit remains that base with concurrent uncommitted work from other owners. ShopPage and CommunityPanel ownership handbacks were received before edits.
- **Dependencies:** existing `/api/social/reports` and `/api/social/block` contracts; app-mode guard changes in ShopPage were preserved.

## Changes and evidence

- Ordinary incoming non-scam direct messages now expose a Report action. The report identifies the sender and attaches bounded sender-prefixed text through the existing report endpoint. The conversation header continues to open the sender's PlayerCard for blocking.
- General community chat lines now expose Report with room/author context bounded in the UI; participant roster entries route to the existing PlayerCard report/block controls.
- ShopPage offers a confirmation step before blocking the shop owner through the existing social block API.
- Added focused tests for Unicode-safe bounded message report text and the message/community/shop UI contracts.
- `git diff --check` passed after the source and docs edits.
- Focused suite was run once through the approved bounded wrapper. It reported **56/57 passing**; the single failure was a test matcher expecting a literal apostrophe while SSR rendered the escaped `&#39;`. The assertion was corrected to accept either representation. The integration owner will include the corrected test in its combined focused suite; this lane did not rerun it.
- Compared a focused 32-file server batch at the candidate against isolated `origin/main` (`4b341ed895d58fe457964d90916d3d8e0f66cbb5`): candidate 157/237 passed, origin 125/237 passed. These totals are not a regression score because the candidate includes concurrent lanes and origin has unrelated failing suites. Full command and classifications are in private evidence `store/play/evidence/baseline-failures.md`.
- Added explicit test-fixture account consent after account linking; guest consent remains account-bound and is not silently migrated. The shared business journey exposes an optional test-host acceptance hook for the edge fixture owner; unclaimed automated agent creation remains unaccepted pending policy.
- Focused migration-test follow-up reached 212/237 on the corrected 32-file batch. A same-size origin-main and exact-base `9a84d02d` comparison each reported 125/237; see `store/play/evidence/baseline-failures.md` for test-identity overlap and remaining causes. Final follow-up fixture assertions for combined account sessions, the direct guest Play path, and route registry count/session shape were updated after the last run and await the integration owner's combined verification.

## Remaining gaps / review notes

- No report action was added for voice-only/audio behavior; roster report/block is available through PlayerCard.
- Arbitrary feed replies and other non-owned UGC surfaces still need an integration-wide moderation-path audit.
- Account erasure code does not establish deletion of all posts, conversations, or uploaded chat image/voice media; reconcile before making complete-erasure claims.
- Privacy page deployment and `support@joinallworld.com` delivery remain unverified.
- Play listing drafts retain `{CITY_COUNT}` / `{COUNTRY_COUNT}` placeholders until live catalogue counts and open-city status are checked.
- Source contains player-rented in-world ad slots and sponsored business listings; Play Ads declaration depends on whether these remain visible in the release app mode.

## Private review material

- `store/play/evidence/moderation-audit.md`
- `store/play/evidence/moderation-focused.log` and `.json`
- `store/play/console/01-data-safety.md` through `07-production-access.md`, plus `sources.md`
- `store/play/listing-draft.md` and `store/play/aso/listing-variants.md`

## Release state

- Local source changes only; no deployment, Play Console submission, or live moderation action.
- **Next executable step:** integration owner reviews the combined diff, reruns the focused suite with the corrected assertion, and resolves listed release facts/policy gaps.

## Non-server baseline comparison checkpoint

- Mapped all six directly reported non-server failures from the timed-out full-suite log to exact test files and lines.
- Ran the same five small files at candidate, exact `9a84` source base, and `origin/main`: 14 tests each, 8 passing and 6 failing in all three runs. All six failures are baseline-shared; no candidate-only result appeared.
- The bounded runs and detailed title mapping are recorded in private `store/play/evidence/baseline-failures.md`; logs are `nonserver-candidate.log`, `nonserver-base9a84.log`, and `nonserver-origin.log`.
- Did not rerun the all-city family or generated download-budget test. The existing `full-tests.log` was a timeout, not a complete suite result.
