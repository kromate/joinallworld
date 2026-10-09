# App UI integration handoff

9 October 2026. Source/local acceptance is ready on `codex/allworld-integrated-preview`, runtime `b9de1ab7599565c8925759ebb512bf75ee7db682`. WORLD is the sole production owner. This does not authorize a competing upload from the dirty Desktop checkout.

## Source and proof

Use `/Users/anthonyakpan/.codex/worktrees/neighbourhood-life/JoinAllworld` and `kromate/joinallworld`. The branch includes all earlier app/UI fixes plus the final mobile sticky-toggle rule. Exact [CI37909238070](https://github.com/kromate/joinallworld/actions/runs/37909238070) passes compiler/build/download/smoke/policy and474 existing focused checks:411 UI,41 scene/atlas,5 discovery,11 shopping/housing/career,6 Worker. Separate smoke15 and package guards17 also pass. Full checks are skipped; three older walking-threshold fixtures remain integration work.

Local final build23.54s. Startup614958raw/222771gzip/195168Brotli; first-paint35675Brotli. All current limits unchanged across40 city modules. No new scripts/assets/renderers for the final CSS fix.

[APP-FLOW-AUDIT](APP-FLOW-AUDIT.md) contains actual browser, action, save and receipt evidence. It covers Boutique/Jobs/Bank/Invest/Groceries/Cars/Profile/messages/discovery/Business, embedded Home, own-house navigation/free rental return, active-city capture/real PNG/consent, guest navigation, cold cross-city arrival and the visible activity toggle. Screenshots are in `docs/qa-screens/app-ui-2026-10-09/`.

Synthetic local continuity: October55425, Spacing5000, Garage749655; original13 furniture pieces retained. Garage keeps both original Lagos and additional Abaji home. No active actions or owned QA server/tabs/overrides/leases remain. Private proofs stay under `/tmp/allworld-app-ui-evidence/`; never commit identities/secrets/raw account data. Source plans and simulated success do not prove provider or physical-device delivery.

## Integration gates

1. Fetch fresh main and inspect overlap with the branch. Preserve LIVING-WORLD/GRAPHICS/WORLD intent and user-owned dirty changes; resolve real conflicts rather than resetting or replacing their files.
2. Integrate the source/checkpoint commits below in dependency order, or perform a reviewed branch merge. This is an inventory, not an instruction to blindly cherry-pick an entire range. Keep the TypeScript Node CSS loader and matching focused CI commands together. Voice checkpointb193bd77 remains separate and needs its own fresh integration/codec/media/permission/Worker proof.
3. Run the appropriate focused existing checks and current compiler/build/download gates on the final combined SHA. Fix the older walking-fixture assumptions with the responsible owner; do not change actual movement to satisfy stale numbers or claim full-suite acceptance from this branch.
4. Preserve `joinallworld-next`, `JOINALLWORLD`, `JoinAllworldState`, `joinallworld-sqlite-v1`, existing SQLite namespace and provider bindings/secrets. Follow [deployment handoff](DEPLOYMENT-HANDOFF.md) and `deploy/README.md` to seal the exact integrated source. WORLD performs the sole checked upload.
5. Record actual pre/post existing synthetic identity, cash, home/storage/ownership, receipts and duplicate-intent continuity. Verify expected public health, loaded bundle and real reconnect/action journeys after adoption. Last verified public build remains `joinallworld-a44629b38be751a9ad446051564`; the new UI is not yet a production claim.

## Open work

The complete stale-price/tax purchase contract, honest ambiguous Civic reply and actor-scoped caches are explicitly unimplemented in [BUSINESS-QUOTE-HANDOFF](BUSINESS-QUOTE-HANDOFF.md). Normal Business success with fresh price/zero tax does not close them. Voice/video, physical-device heat/zoom, all offline/race/provider journeys and the broader household/gifting/commerce/nightlife programme retain separate gates.

Research is partial. Final original capture739 replies/254 scheduled traversals;6 branches/58 image posts/28 residual URLs (13 scoped,15 unvisited), Recent sweep open; city129 unchanged. [All 58 historical announcement](research/lagos-life-announcement-current-matrix-2026-10-09.md) now has current source and specific gaps. [Current source comparison](research/lagos-life-current-comparison-2026-10-09.md), [original queue](research/lagos-life-original-pending-current.md), [city queue](research/lagos-life-pending-replies-current.md) and [58 announcement roots](research/lagos-life-source-post-review-queue.md) retain exact scope. X filtered/hidden/deleted/loading/image boundaries are not completed by a reply counter. Do not implement historical Missing rows without current source review.

## Source/checkpoint inventory

- `c5f4c4cb0b85449c0aed61ed0ba66d1a78e98ee1` — Improve Store form state and narrow-screen investment layouts
- `8129ed4f5e345d01d3c244765df01880ddc8eea2` — Make Business stock controls readable and protect pending edits
- `800ebd3babc2b40040f49a3db787d5e7d1c6f6c3` — Harden home visitor controls and improve mobile layout
- `80e48a8b83460979d8a5a6b4ea8f8d480504a6e6` — Expose a selectable home-link copy fallback
- `72c6f977e9d661bc71168c5b3e059b4821f2220f` — Scope report and statement state to the current character
- `58e6ba479069a770dcb97d4123e9ab567f0fd3b8` — Keep statement identity with its verdict within startup budget
- `9d1d488fed07c5d8b299d2ec188c96491df0e5f4` — Keep report identity watcher in component scope
- `14e802dea7459487e0e00a74a5235c60d8d159b2` — Make notification preference saving and pause state explicit
- `b29031f622812f00ab074b9a734cef57d7b81d4b` — Make chat privacy preference updates explicit and reversible
- `19ab34224191928656106f14bda7b5c630b8fb5b` — Scope older-character settings responses and clarify loading states
- `ce4d861e8646988bc49d7cf27f7ecf00cce56fcb` — Reload older-character choices after reconnect
- `0e49c29a843bc0d20d6f8b2e6905dd69a60c3e56` — Share the live hints preference across guidance surfaces
- `e524bf5573a92d7eb852971ae287a12607137627` — Clarify the lifetime of unsaved hints preferences
- `75ca35a98349c6c31b52b944fbe7626061dddb51` — Keep public records current and event actions readable offline
- `b2a2d38b49facf9662da27d64ae7cf55e40ea7ea` — Add opt-in remote app UI regression gate
- `0a122f8ef6f96246c624aca3b1c5652c0a986ff2` — Bound grocery batches to their cart and active character context
- `39a69989266f1f8fc8cef5c245e23c10c7917ce7` — Include existing grocery and health regressions in UI verification
- `d03eb8c9016c9c52b1423681ae8a596ee9997bbb` — Match quick refuel quantity to tank room and available cash
- `c26c14374047c02e9bcbf9816eae54da3d85be37` — Keep career choices current and allow app listings to wrap
- `3b394f4b127c1d3d1cfc14f9e34486c26f2eb0de` — Make bank records readable and show pending career and property actions
- `b528d3dd6281dffdcb5f1a888a850f40aa7daa3b` — Fit settling steps to the phone without a nested fullscreen backdrop
- `19e3e77f1e8e3d473780770e069f7bd9e2226367` — Keep phone forms fixed while inner content scrolls and clarify guest rentals
- `f462c9d8c33581657a7e3b7a7bd383c50fe11837` — Fix puzzle contrast and retries and clarify chess departures
- `122bae7d6d06d482dbe3730bcf0588ee13fdbe48` — Reload after a failed practice module instead of retrying its cached failure
- `42d262711bd05e2125cec3a72d77383003140d58` — Normalize server bot labels before rendering the single bot suffix
- `cf5f10d869f8abcac4ffb00b9894205068be87a3` — Keep action clocks consistent with snapshots and clarify money controls
- `cb5e96c608d174aad4cda00c0bfb9685e886facb` — Preserve wallet effects for adjustments and bonuses and align car labels
- `2b550d9d3d83ff3358e3663fd12d3121fb15b9f4` — Enforce advertised message lengths and explain oversized drafts
- `309018041338bf384acdea9e9ce74272a8b49594` — Keep the chat composer grid within narrow phone screens
- `6c7b3447e00008e7333ecff09c30d5c9da442ce9` — Snapshot JSON action payloads and keep Profile fields accessible
- `c5115e21281782098bcc817e1093d5b4f7d99784` — Keep action recovery wording concise within startup limits
- `7a55e74740a931e8f6b6a3788c87b9e1709a6471` — Clarify filtered neighbour results and expose public discovery
- `22fb786e02830cbb6dc555268f6e89d3d31931f3` — Keep paged badge ownership lazy and preserve startup caps
- `0e2afb59fdff39469e92ed390ebd3269500223b5` — Clear stale venue details when locating an owned house
- `39f13f39b9e8e0b0a5204c0fbe5835f7992c2ca0` — Derive capture home presence from the active saved character
- `273a4848d1d58333b8ba11f7f48e46236eaccb12` — Make guest visits readable, explicit and stable during navigation
- `87f91840cac1653f94e9597f9bc573c659e7e4c1` — Give social primary buttons a readable solid color pair
- `ca6d6b3e61a0bb637f5d8d093030f093dd4b3a5a` — Load the home builder before cross-city arrival and label map controls
- `6e3faf886444cd6b56767e99de19edfe72103031` — Run scene adapter checks with the required Node CSS loader
- `9cb2af78d45b63713b72909e3bd4d24d4d579593` — Keep the Node scene loader in the repository TypeScript convention
- `b9de1ab7599565c8925759ebb512bf75ee7db682` — Keep the mobile activity toggle pinned while spots scroll

The copyable next-agent brief is [NEXT-AGENT-PROMPT](NEXT-AGENT-PROMPT.md). All owned UI QA/research resources and the failed helper are terminal at handoff.
