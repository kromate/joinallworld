# Combined reliability and feature-parity delivery

This is the current tracker for the combined work from the research chat and “Review thread for remaining work” (01a115e4-c2fc-7300-a97c-d9d0dedf9e91). Updated 9 October 2026.

## Messaging release, 8 October 2026

Source `bd69e765373e15a0e884b6406f7b4a06139a6acb` is deployed to `joinallworld-next`. Cloudflare version `2a557cac-ae7a-4a24-94eb-2a9be114b1ec` received 100% traffic at 11:13:50 UTC. Public health adopted `joinallworld-bd69e765373e15a0e884b6406f7` at 11:19:10 UTC. The existing provider binding names/types and SQLite namespace were verified unchanged.

- Live synthetic send, edit, idempotent replay, recipient visibility, delete and recipient tombstone passed.
- The two existing release-verification identities retained their balances and duplicate-action receipts. Pre-upgrade UTC recovery reference: 2026-10-08T11:12:48.608Z. This was a reference, not an executed backup or restore.
- Public smoke passed 9 checks and 282 requests, including 201 city chunks for 40 cities, in 72.6 seconds.
- The public Messages UI exposed Chats, Groups and Updates. Local compiled-browser interaction checks and the 390×844 viewport check passed. No real users were messaged for verification.
- Exact sealed Worker probe passed send/edit, SQLite restart, mutation replay, delete and recipient history. Package guard digest: `98ddb32d273fd8e2d7ed43099863c9da03555c3e9cf2e923ff5560c64c7fb73f`.
- Worker upload: 4,401.53 KiB, 1,705.02 KiB gzip; provider-reported startup 123 ms. These are single-release measurements, not a capacity or thermal guarantee.
- Final download measurements: startup 614,173 raw / 222,552 gzip / 194,703 Brotli bytes, all within unchanged limits. The Messages chunk is lazy.
- Source CI passed: https://github.com/kromate/joinallworld/actions/runs/37768152777.

Only the messaging slice below was added in this release. The broader roadmap and linked chat's Phase B remain open.

## Source correction

The first research source comparison used the old dirty Desktop checkout at f115424c. It is a historical inventory, not an inventory of production. The integrated checkout is `/Users/anthonyakpan/.codex/worktrees/neighbourhood-life/JoinAllworld`; its clean starting point for this work was joinallworld/main at 1a329026. Production /api/health was read directly and reported joinallworld-75d481cc9e8f4fe214485c9e262. That is the release recorded in DEPLOYMENT-HANDOFF.md.

Current source already has quoted replies, reactions, pictures, pin/search/group management, calls, nearby voice, missions, shared table games, richer realism systems and many city modules. Recheck each historical gap against this baseline before implementing it. Do not merge the old dirty checkout wholesale.

## Tracker

| Unit | Implementation state | Evidence/release state | Next action |
|---|---|---|---|
| Reliability A1–A4 from linked chat | Integrated | Previous release 75d481cc recorded deployed; live build independently confirmed | Preserve wallet correctness, recorded history, account-generation guards and store authority fences |
| Current message actions | Deployed at bd69e765 | Node/Worker/browser and live synthetic checks passed | Voice-note/media follow-up remains separate |
| Groups view and swipe reply | Deployed at bd69e765 | Compiled-browser gesture check, phone-width layout and public navigation verified | Physical-device follow-up |
| Recorded voice notes, video, stickers | Voice boundaries started locally | Unwired Opus parser/recorder; see VOICE-NOTES-WIP.md. No voice-note release | Resume after the user-prioritized app redesign; finish the full private send/playback path |
| Phone UI polish | Deployed at bb04c64f | 42 rendered 3D raster icons, calmer wallpaper, four category pages; 27 existing checks and typecheck passed; desktop/mobile inspected, paging defect fixed | Public artwork and saved-state continuity verified |
| App interiors and headers | Further source/local slices ready throughb9de1ab7; verification9cb2af78; first releases remain separate | Exact CI37909238070 passes474 focused checks; mobile activity toggle remains physically visible while its rail scrolls. Boutique/Jobs/Profile/chats, Cars/deposits/Business/directories, owned-house navigation/free return, PNG export, guest consent/navigation/contrast and cold cross-city home arrivals have local action/save/receipt proof in APP-FLOW-AUDIT.md | Other system integrates fresh main, resolves conflicts, seals Worker and verifies production; remaining offline/video/identity/physical-device and older scene-fixture cases stay explicit |
| HUD/recovery polish and sustained mobile performance | Queued | Prior linked-chat viewport check is not physical-device proof | Measure representative current build; preserve download budgets |
| Real-player Family roles | Deployed at a44629b3 | Node/SQLite restart probes, two-player browser flow and live synthetic consent/unlink/continuity passed | Existing call transport is reused; physical-device audio remains a separate check |
| Housing, household/staff/family, economy and player work | Re-audit required | Historical parity inventory is stale | Reconcile current source before accepting a missing feature; deliver bounded complete loops |
| City/travel/campus progression | Re-audit required | Prior deployed smoke recorded 40 city chunks; closed-city conclusions from old checkout are obsolete | Validate actual gameplay coverage city by city |
| Feed/events/governance/fictional justice | Re-audit required | No new implementation claim | Compare current modules and select remaining complete loops |
| Reliability B / PostgreSQL / balanced accounting / partitioning | Pending | Linked chat explicitly leaves these unfinished; production remains SQLite | Separate migration/capacity proof; no partial PostgreSQL prototype activation |
| Real commerce/provider activation | Pending separate provider proof | Existing source does not prove provider delivery | Preserve account/provider boundaries; no plan upgrades |

## Message-action contract

- Existing messages load without new fields. Edited/deleted messages carry a monotonic version; older responses cannot replace newer client content.
- Only a current member may change their own non-system/non-payment messages. Text editing is allowed for 15 minutes and runs moderation again. Payments cannot be erased through message deletion.
- Deletion leaves a tombstone and redacts stored reply excerpts in that conversation. Picture bytes are scheduled for deletion only after the transaction commits. Existing forwarded copies and recipient screenshots are independent.
- Mutations use existing durable, light-class receipts. Repeating an operation returns the current authorized view without replaying the mutation. Send retries still recognize the original body using a digest after an edit or deletion.
- Text forwarding resolves the source server-side after membership/visibility checks. It sends a marked copy through normal destination, block, moderation and rate rules. No original conversation identifier is disclosed to recipients.
- Groups is a filter over existing bounded conversation pages. Empty filtered pages can load the next page. Swipe reply has the existing accessible Reply button as an alternative.

## Constraints and evidence

User authorized implementation and deployment. Preserve existing Cloudflare Worker/SQLite namespace and provider settings. No upgrades; Neon stays Free. No automatic cashout, real-money gambling, explicit-content or destructive-player-loss scope. Use fast release checks plus affected checks, without claiming full exhaustive/physical-device verification.

The requested Luna release auditor hit the account usage limit before returning findings. Primary agent handles the work directly; model retries would not resolve that limit. No new tests are added by this slice; existing checks and disposable non-test HTTP probes are used.

This tracker does not claim the entire parity roadmap is implemented. Source, local verification, deployed artifact and live acceptance are separate states.

## First slice verification

- Typecheck: five projects clean. Existing focused selection: 49/49 passed after correcting the disabled-action UI behavior.
- Existing source smoke/contracts: 15/15. Worker release checks: 5/5. Sealed-package guard negative controls: 17/17.
- Disposable HTTP probe: ownership/outsider denial, edit replay/conflict, original-send retry after mutation, forward source validation, deletion/quote redaction, reaction denial, stale-response merge and edit expiry passed.
- Compiled browser on isolated localhost data: guest entry; send; edit with Edited marker; forward with Forwarded marker; delete with tombstone; horizontal reply gesture. Existing server-rendered component checks also pass.
- Download check: startup 614,173 raw / 222,552 gzip bytes, within unchanged 615,000 / 223,000 limits; optional Messages code remains lazy. No physical-device thermal/capacity claim.
- Logs are local in `/tmp/allworld-parity-*`; synthetic identities are not published.

## Phone UI phase

User added phone polish before the next deployment. `PHONE-POLISH.md` records references, original artwork and the implementation. Every registered phone app has artwork; the atlas is lazy, 208 KiB. Existing phone/model checks passed 27/27; typecheck is clean. First design review covered desktop and 390×844. Final functional confirmation proved Money selects page 1 and Life page 0, with disjoint page-button hit targets and no document overflow at 390px. My land opened and returned to the phone.

Voice notes remain the next substantial media phase; no voice-note implementation or deployment is claimed by the phone work. Live calls do not satisfy that requirement. Preserve the full gameplay and reliability programme above.


## Rendered 3D phone release, 8 October 2026

Source `bb04c64fd8f5ed0b2024df07da0b8de20adfc26d` deployed as Cloudflare version `fe6e4a0b-b0ff-4a1c-aeda-f22c4fc7b079`, receiving 100% traffic at 12:10:23 UTC. Public health confirmed `joinallworld-bb04c64fd8f5ed0b2024df07da0` at 12:16:11 UTC. The earlier flat icon generator was removed; all 42 app icons now use rendered 3D artwork.

- CI passed: https://github.com/kromate/joinallworld/actions/runs/37774595734.
- Local fast checks passed: five type-check projects, production build, unchanged download budgets, 15 smoke checks. Existing phone/model checks passed 27/27; package guards 17/17 and Worker smoke 5/5.
- Sealed package digest: `0ad369a60b822be4311703cf3514ca47345d51d1bac67a5770188bafdb83b5eb`.
- Public atlas `/assets/app-icons-488c8228.webp` returned 200 and 212,876 bytes; SHA-256 matched the source asset (`62d612c58e3f06849fa70bdc80e531b7e3ef8028381aae9120a457af1321357c`). Public browser inspection confirmed 3D icons, notification badges and dock; local desktop/mobile and City page were inspected.
- Public smoke passed nine checks / 282 requests / 40 cities in 47.7 seconds during propagation. After the API switched, both existing synthetic release identities retained identity, balance and duplicate-action receipts.
- Worker startup: 127 ms. Startup download: 614,173 raw / 222,534 gzip / 194,729 Brotli bytes, inside unchanged limits. Icon rendering uses a static lazy WebP, not runtime 3D rendering. Physical-device thermal performance remains unmeasured.

The broader feature-parity roadmap remains open.


## App interiors release

Source `cfbc133b36b5d4e8d071bb8223fbfc59e6a33289` deployed as `77d0ab82-7f21-4431-9ad9-9d6e8d60740b`. Public build confirmed at 13:45:31 UTC, 8 October 2026. See APP-INTERIORS.md for scope, real design references, comparison prototypes, all 41 regular app entries inspected, and validation. The shared system and headers apply across apps; Jobs, Messages, Bank, Games, Rich List, Neighbours and charts received specific layout/interaction changes. This release does not claim voice-note delivery or completion of the broad feature-parity roadmap.

## Family and build-fix release — 8 October 2026

Exact source `a44629b38be751a9ad446051564704f6c3c6ae1b` deployed as Cloudflare version `64ed8462-6c2b-4c42-8d19-266bc93708e5`, 100% traffic at 20:20:18 UTC. Public health adopted `joinallworld-a44629b38be751a9ad446051564` at 20:23:55 UTC. CI passed: https://github.com/kromate/joinallworld/actions/runs/37837874488.

The build fix registered both Family routes in the exhaustive protocol list, corrected the optional input-error prop, and removed unnecessary JavaScript stylesheet loaders. The fail-closed compiler completed all five projects serially with a 3072 MiB heap after the 1536 MiB cap aborted two projects; no baseline or download cap was relaxed. Family adds consent-based real-player roles, invitation expiry and limits, unlink/restore, block/deletion cleanup and real message/call controls. Accepted real roles cannot earn rewards through simulated NPC calls.

Verification: 15 smoke checks, 17 package guards, 5 focused Worker checks and 65 existing social/receipt/client/model checks passed. Separate Node and SQLite probes exercised auth, consent, duplicate requests, restart persistence, stale replies, unlinking, blocking and balance preservation. Browser QA used two disposable characters and verified recipient notifications, live acceptance, message delivery and NPC restoration. Final 320px layout had no card/body overflow and correct picker focus.

The sealed package has 6,112 files, 100,298,010 bytes and largest file 4,515,249 bytes, within unchanged archive caps. Digest: `6b118baa0bd4115a86b238717170d65cedf8a1fa33ca546120e8ac6eaf5b86ed`. Worker startup: 170 ms. Startup JavaScript: 614,960 raw / 222,903 gzip; startup Brotli 195,228; first paint Brotli 35,697, all within unchanged limits.

The existing `joinallworld-next` / `JOINALLWORLD` SQLite binding and `joinallworld-sqlite-v1` migration were retained. No save reset, migration replacement, provider-secret change or new database was performed. Before/after checks preserved the same two existing synthetic public identities, balances and duplicate-action receipts. The production Family consent/unlink/retry probe passed and cleaned up its links. After adoption, public smoke passed 9 checks / 281 requests / 40 cities in 54.9 seconds. Live Chrome loaded the existing user character and Family screen without console errors.

Public Family JavaScript, loading backdrop and OG image returned 200 with exact source hashes. The broader app-flow audit, voice-note stash and reliability B roadmap remain open. This phase does not claim physical-phone thermal performance or a newly verified microphone/audio-device path. All owned QA servers, temporary tabs and resource leases were stopped.
