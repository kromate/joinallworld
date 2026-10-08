# Combined reliability and feature-parity delivery

This is the current tracker for the combined work from the research chat and “Review thread for remaining work” (01a115e4-c2fc-7300-a97c-d9d0dedf9e91). Updated 8 October 2026.

## Source correction

The first research source comparison used the old dirty Desktop checkout at f115424c. It is a historical inventory, not an inventory of production. The integrated checkout is `/Users/anthonyakpan/.codex/worktrees/neighbourhood-life/JoinAllworld`; its clean starting point for this work was joinallworld/main at 1a329026. Production /api/health was read directly and reported joinallworld-75d481cc9e8f4fe214485c9e262. That is the release recorded in DEPLOYMENT-HANDOFF.md.

Current source already has quoted replies, reactions, pictures, pin/search/group management, calls, nearby voice, missions, shared table games, richer realism systems and many city modules. Recheck each historical gap against this baseline before implementing it. Do not merge the old dirty checkout wholesale.

## Tracker

| Unit | Implementation state | Evidence/release state | Next action |
|---|---|---|---|
| Reliability A1–A4 from linked chat | Integrated | Previous release 75d481cc recorded deployed; live build independently confirmed | Preserve wallet correctness, recorded history, account-generation guards and store authority fences |
| Current message actions | Implemented locally | Real HTTP probe passed ownership, conflict, retry, forwarding, deletion and quote-redaction paths; typecheck passed | Existing focused checks, built-browser acceptance, sealed package, production continuity |
| Groups view and swipe reply | Implemented locally | Compiled-browser Groups tab and swipe reply verified | Release and physical-device follow-up |
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
- Download check: startup 614,173 raw / 222,509 gzip bytes, within unchanged 615,000 / 223,000 limits; optional Messages code remains lazy. No physical-device thermal/capacity claim.
- Logs are local in `/tmp/allworld-parity-*`; synthetic identities are not published.
