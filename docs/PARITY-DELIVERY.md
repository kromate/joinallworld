# Combined reliability and feature-parity delivery

This is the current tracker for the combined work from the research chat and “Review thread for remaining work” (01a115e4-c2fc-7300-a97c-d9d0dedf9e91). Updated 8 October 2026.

## Live release, 8 October 2026

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
| Recorded voice notes, video, stickers | Queued | Voice calls and pictures already exist; recordings are distinct | Bounded lazy media storage/recording design and authorization review |
| HUD/recovery polish and sustained mobile performance | Queued | Prior linked-chat viewport check is not physical-device proof | Measure representative current build; preserve download budgets |
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
