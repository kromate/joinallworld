# App flow remediation

8 October 2026. Reopened by the user after the first app-interior release. The previous 41-app entry-screen sweep was insufficient evidence for complete app behavior. This is the current acceptance plan; do not mark the whole UI programme complete based on shared CSS or an app opening.

## Current integration queue

Exact cumulative source `b2a2d38b` passed remote CI [37862623511](https://github.com/kromate/joinallworld/actions/runs/37862623511): typecheck, build/download/smoke, release policy, and **100 existing UI model/component checks (100 passed, 0 failed)**. These cover existing regressions, not every newly listed delayed-response/browser scenario. No new test expectations were added.

The human requested pushed slices for the agent on the other system to integrate, resolve conflicts and fix follow-up bugs. The UI branch is `codex/allworld-integrated-preview`. Merge its cumulative changes onto fresh main; individual correction commits are not standalone features. Fast CI proves type/build/download/smoke/policy gates, not complete browser behavior. The historical checkpoints below preserve the remaining acceptance details.

| Slice | Latest runtime checkpoint | Fast CI | Remaining acceptance |
|---|---|---|---|
| Store / Invest | c5f4c4cb | 37850351246 passed | Delayed directory/filter responses, cancel/save normalization, deposit actions, narrow layouts |
| Business | 8129ed4f | 37851320078 passed | Stock/price pending edits, different-shop draft reset, mobile rows |
| Home visiting / manual copy | 80e48a8b | 37853252819 passed | Refused/pending operations, native-share cancellation, clipboard denial, link wrapping |
| Report / Statement identity guards | 9d1d488f | 37856165507 passed | Delayed cross-character responses, draft/retry identity, statement context, focused model checks |
| Notification settings | 14e802de | 37856727022 passed | Paused selector, refused preference rollback, keyboard and mobile behavior |
| Chat privacy | b29031f6 | 37857267550 passed | Delayed/refused toggles and cross-device settings |
| Older-character Settings | ce4d861e | 37859045285 passed | Delayed identity changes, switch retries and reconnect |
| Shared hints | e524bf55 | 37860276621 passed | Storage denial, all consumers, dismiss/reopen/reload and manual versus automatic tours |
| Events / public records | 75ca35a9 | 37861362311 passed | Filter races, pagination/retry, offline calendar/actions and narrow cards |
| Voice-note checkpoint | b193bd77 on `codex/voice-notes-checkpoint` | Historical only; older base | Fresh-main integration, current compiler, private media lifecycle, Worker restart, capture/playback and compatibility |

Production acceptance in this thread is still the separately recorded a44629b3 phase. None of the newer review slices is claimed deployed here. Source inspection has not replaced the requested full screen-by-screen browser audit.

## Required scope

| Area | Required implementation and states | Evidence required | Current state |
|---|---|---|---|
| Shared controls | Owned foreground/background pairs for default, hover, selected, loading and disabled buttons; labeled reusable fields with clear, help and error states | Computed colors and keyboard behavior in real consumers | BaseButton selected variant and TextField implemented locally |
| Boutique | Distinct shop presentation, usable card spacing, actual try-on preview, reset, purchase, wear/take-off, insufficient funds, offline, pending | Exercise preview/reset and real purchase/equip using an isolated QA life; verify selected-button contrast | White-on-white root cause fixed locally; flow verification pending |
| Cars | Rendered vehicle artwork, catalogue and garage views, clear price/fuel/speed, buy/drive/sell, ownership and disabled reasons | Buy a vehicle on funded QA life, drive it, reopen/reload, sell; verify balances and state | Shared catalogue cards and original vehicle atlas implemented locally |
| Houses | Property cards with meaningful hierarchy/artwork; own home versus rentals; rent/move cost; move/upgrade/furniture links; unavailable/insufficient funds | Complete a QA move and check home, balance, rent and reload; verify all cross-app links | Pending |
| Jobs | Reusable search field, clear/filter/empty states, role disclosure, apply, current job, switch confirmation, quit, pending/offline | Search/clear/filter and actual QA apply/switch/quit; verify salary and role state | Search component extracted locally; action coverage pending |
| Family | NPC roles can be replaced by consenting real players; invitation, accept/decline, unlink/restore NPC; genuine message/call entry points | Two synthetic users complete invitation/acceptance and unlink; declined/blocked/removed users gain no role/access | Deployed at a44629b3; see final release receipt |
| Other app screens | Nested screens, forms and conditional states across Messages, Bank, Invest, Statement, business/store, civic/politics, household/land/street, games, travel, settings, support and onboarding | Per-screen action/state ledger. Privileged, external-provider and permission-dependent flows must be explicitly separated | Entry-screen sweep exists; deeper coverage remains open |

## Boutique diagnosis

`.boutique-try[aria-pressed=true]` set dark background and white text. The more-specific `.ph-appbody .ui-button:not(.is-primary):not(.is-danger)` rule replaced only its background with white. The result was white on white. Boutique now uses BaseButton for try-on and purchase/equip actions; its selected variant owns the color pair. Its compact-phone layout must not use a desktop viewport breakpoint to squeeze three columns into a 392px simulated phone.

TextField owns its input styles. Legacy global input rules exclude its class, avoiding a new specificity conflict. CatalogueCard owns the card structure; Cars and Houses should use it with domain-specific media/specifications/actions rather than duplicating ad hoc cards.

## Real-player Family implementation

1. Model a family slot as the existing NPC default or an accepted player link. Retain stable slot ids and distinguish game roles from assertions about real-world family relationships.
2. Let the player choose a friend for a slot and send an in-game invitation. The recipient sees the inviter and proposed role, and must accept. Do not silently assign a real person or contact anyone outside the game.
3. Persist pending/accepted/declined states with server-side membership, block and rate checks and idempotent commands. Cross-device updates must agree.
4. Replace only the accepted slot's presentation. Real-player entries open the existing direct-message and real-call flows, with online/offline/call-permission states. Do not run an NPC's eight-second simulation or mark a real call complete merely because its button was clicked.
5. Either participant can unlink; the owner can restore the NPC role. Blocking, account removal and declined invitations must not leave stale access or a hidden active relationship.
6. Preserve existing balances, household possessions and other roles. Any daily check-in reward for a real interaction needs a server-verified, bounded rule; no reward for invite spam or unanswered calls.
7. Verify the complete two-player lifecycle in isolated data, then run release checks and live synthetic acceptance before marking this feature shipped.

## Voice-note work preserved

Voice work is saved in Git stash `5860c8e5e0f350a01378ceb4b28cf9a9238daed1` (message: Voice-note integration checkpoint before app interaction audit). A tracked-change backup is `/tmp/allworld-voice-integration.patch`; the stash also holds new files. It passed `check:fast`, 40 existing focused checks and the temporary API probe for friends-only sending, authorized reads, retries, changed-byte conflicts, deletion, reports, group removal and blocking. It is not deployed and still needs Worker persistence and browser integration verification. Restore deliberately after checking overlap with Family/social changes; do not blindly pop it over later work.

## Added acceptance: mobile and first impressions

- Inspect narrow 320/390px screens and enlarged text; repair actual horizontal overflow, compressed controls, wrapping labels and inaccessible actions across app interiors.
- Map travel choices: replace six compressed chips with wrapping, named choices; separate venue title and status. Ride choices must wrap too. Verify selection, fare, trip action and scroll access on a small screen.
- Refresh original raster OG/share artwork, favicon and installed-app icons; verify public metadata and actual served images.
- Animate boot and board-loading presentation with lightweight artwork, accurate lifecycle labels and reduced-motion support. Preserve slow/error/retry states and startup download budgets.

## Local evidence, 8 October — remediation candidate

Compiled browser preview at localhost:5186, synthetic Release UI QA life:
- Boutique: Afro preview had foreground rgb(104,35,69) on rgb(248,232,240); purchased for 2,500; previewed Bun and reset to owned Afro.
- Cars: bought Agama for 350,000 and Tokunbo for 900,000, switched driving vehicle, sold Agama for 210,000; Garage retained Tokunbo.
- Rental house: moved to Lekki mini-flat for 51,000, then reloaded; home and 17,000 weekly rent persisted. Bank and five transaction rows reconciled to 906,500 from the initial 2,000,000. Later manual QA travel spent another 200.
- Jobs: searched, expanded Tech, applied to Intern; switched to Marketer with confirmation; quit with confirmation; empty search and clear/open-workplace filters worked.
- Map: 390px and 320px screenshots show named modes, fares and time in two rows. At 320px, sheet and every mode button had scrollWidth equal to clientWidth. Selection/travel engine is unchanged; full enlarged-text and all-app audit remains open. Ride picker now wraps and destination rows wrap their action.
- Boot: compiled Chrome screenshot showed the rendered globe; simulated slow loading recovered via Try again with saved balance intact. Computed animationName was none under reduced motion. Temporary network, media and viewport overrides were cleared. Scene lifecycle labels now follow actual host/session loading, never invented percentages.

These are specific exercised flows, not proof that every screen/state is finished. Family implementation and voice integration remain pending.

## First-impression assets

New original 3D social preview at /og/allworld.jpg (1200 by 630, 157,036 bytes); old PNG retained for existing cached links. JPEG preserves detail with half the PNG size budget. Root and referral metadata both use the new image and matching alt text. Updated raster favicon, touch and install icons. Loader reuses a 3,032-byte WebP; the decorative scene stylesheet is fetched after the playable shell. No additional WebGL context or animation library.

Generated originals (not copied brand artwork):
- ~/.codex/generated_images/01a11ae0-eea5-79e1-ae16-bc36056fbf4e/exec-d875d73a-de4d-46a2-9ff4-fa78c090b8d6.png
- ~/.codex/generated_images/01a11ae0-eea5-79e1-ae16-bc36056fbf4e/exec-a790387e-fa25-4893-9d78-c07d8ceafb01.png

Existing source-shape tests have known mismatches with this requested redesign: phone.test.ts expects hidden mode names in one row; panelsA.test.ts expects the old Jobs copy and ui-button Boutique class; seo.test.ts expects an SVG favicon, the old PNG metadata and outdated nine-city wording. No tests were modified, following the standing preference. The initial PNG-size failure was resolved by using a separate 157KB JPEG; the legacy PNG remains within its existing size guard. Do not report the full historical suite green.

### Loading backdrop correction

User rejected the plain loading background. Replaced it with a warm yellow canvas and original 3D characters, danfo, house, palm, die and colourful doodles. Decorative art is static, placed at the top and bottom, with central copy kept clear. Alpha WebP avoids a visible rectangular background edge on desktop; sizing adapts to short/narrow screens. The illustration stylesheet loads after first paint. No extra renderer or animation library. Final composite and integrated budget verification recorded before publishing the candidate.

Final loader overlay: public/icons/loading-neighbours.webp, 42,758 bytes, transparent 640px artwork derived from exec-3e137447-4288-45d7-aaaa-6676c05fefa5.png. Mobile 390x844 and desktop 1280x800 reviewed, including forced chunk-failure/retry layout; reduced-motion behavior verified in the earlier compiled flow. Integrated main build passes check:fast (15 smoke cases); startup 614,996 raw / 222,907 gzip / 194,997 Brotli. Decorative image bytes are additional on-demand media, explicitly outside the JavaScript budget. No production upload started: WORLD retains the coordinated release ownership.

### Family implementation checkpoint (not shipped)

The bounded consent model now lives in src/types/family.ts and server/social/family.ts. It has four owned slots, at most 16 incoming pending/accepted links, seven-day pending expiry, target-specific request ids, explicit acceptance and removal by either participant. The existing social friendship/block cut, idle-player cleanup and erased-account-character cleanup call its unlink helpers; retaining the active character as a guest retains its links; unblocking cannot revive a cleared link. This is source work only while other owners hold the serialized intensive turn. No API routes, visible Family controls, daily reward or completion claim yet.

Next integration: authenticated typed GET/POST family routes with transaction retry receipts and rate limits; bounded own/incoming views with public player data only; cross-device social-changed pushes; invitation picker/accept/decline/unlink and existing real message/call entry points. Prune invalid/blocked links before every read or mutation. Keep pending NPC roles available; only accepted links replace them. Do not award NPC call rewards through a linked player's row. Verify on Node and SQLite Worker and two synthetic browser actors when the resource handoff permits.

Fast CI for the prior illustrated UI candidate completed successfully: https://github.com/kromate/joinallworld/actions/runs/37818118875 (source 83a672a227490b1ba860cd10cf27ba7268a47d90). This is not deployment proof.

### Family integration source checkpoint

Authenticated GET/POST /api/social/family now connect the consent model to the shared transaction and exactly-once receipt boundary. Family receipts use the light quota; mutation rate is 12/hour. Public response indexes are bounded and include only participant public ids/names. Notifications open Family; changes notify both participants and their other devices.

Family UI now contains the invitation picker, accept/decline/cancel, confirmed unlink/restore, transport retry retaining its request id, and existing genuine message/call controls. Accepted Mother links also replace the Contacts favourite. The action boundary refuses NPC social.call for an accepted real-player role, including direct API attempts. This avoids awarding simulated NPC-call rewards for real-player links. Existing in-progress NPC calls are not retroactively reclassified.

No intensive checks or browser sessions were started during the reserved resource turn. These new files remain local and unverified until the handoff permits type/build, API persistence and two-actor browser checks. Do not deploy or mark Family complete based on this source checkpoint.

Family source review also addressed stale friend-search results after changing role/account, reused the current friend-presence status for call availability, and retained the NPC streak/duration explanations. Incoming main now includes WORLD's metadata-test alignment and zstd correction; those changes were preserved by fast-forward. Family remains unverified, uncommitted runtime work; no resource-handoff inference was made from free slot counts.

## Family verification and release candidate

On explicit resumption to fix, verify and deploy, corrected the exhaustive HTTP route list and the TextField nullable error prop. The compiler's old 1536 MiB cap aborted client/test projects; the runner correctly failed closed. A single serial compiler at 3072 MiB completed all projects. No baseline or budget was relaxed.

Temporary isolated API probes passed on Node and real Miniflare SQLite Worker: unauthenticated and unrelated-player refusal, friendship requirement, invitation/acceptance, duplicate send, receipt and accepted-role persistence across restart, stale-answer rejection, recipient unlink, duplicate retry after unlink without resurrection, decline, block/unblock cleanup, NPC-call refusal for accepted roles, and unchanged balances. Existing receipt/social/client/model regressions passed 65/65.

Compiled Chrome QA used two disposable characters on separate local origins. Actual friendship, Family invitation, recipient notification/acceptance and live owner update passed. Message opened the intended recipient and delivered a synthetic message. Recipient Leave role restored Mummy; friendship/chat stayed available. At 390px the Family body and all four cards had scrollWidth equal to clientWidth. Browser review found and fixed focus/scroll for the inline picker and unlink confirmation; it also prompted a canonical friend-name fallback before a chat's first message.

Stylesheet-loading wrappers were removed to reduce startup JavaScript: the small loader styles are now ordinary CSS imports. Background artwork remains a 42,758-byte static WebP, not a runtime 3D render. All final budget numbers and release identity belong in the release receipt after exact-source packaging and live verification. These probes do not claim microphone/audio-device testing or physical-phone thermal performance.

Final compiled 320px check: opening the invitation picker moved focus to family-search and scrolled it into view. No Family card/body horizontal overflow. Original two-player QA character and chat survived server restart. Bounded-model probe also passed inbox cap, exact seven-day expiry, accepted-role retention and counterpart cleanup. Final checks: 5 type projects clean, 15 smoke, 17 package guards, 5 Worker smoke, 65 existing social/receipt/client/model checks; separate Node and SQLite restart probes passed. Startup JS 614,960 raw / 222,903 gzip, first paint 35,697 Brotli, all within unchanged caps.

## Production acceptance

Family shipped in source a44629b38be751a9ad446051564704f6c3c6ae1b / provider64ed8462-6c2b-4c42-8d19-266bc93708e5. Public build, saved identities/balances/receipts, live Family consent/unlink/non-resurrecting retry, actual production UI and exact asset bytes verified. The final receipt is in PARITY-DELIVERY.md. Earlier local/unverified checkpoints above are historical and superseded for this phase; the all-app audit remains open.

## Next local slice: Store and Invest

Source inspection found that Store's in-flight directory guard skipped the replacement fetch after a city switch, then allowed the old city's response into the new view. Directory requests now carry a generation; city/owner/LGA changes invalidate old responses and fetch the current selection. Pagination stays single-flight. Unmount invalidates pending reads. This change is not yet runtime-verified.

Store earnings now stack each label above its amount, with wrapping headings/actions/addresses. Invest amount choices have a larger intrinsic width and wrap; term returns and deposit headings wrap instead of squeezing, supporting narrow screens and large values. Removed Invest card shadows. These are local source changes awaiting the next serialized verification turn; not part of the accepted a44629b3 release. Required checks: stale city/filter response, pagination, empty/error/retry; 320/390px layouts with large amounts; game-deposit open/early-close/maturity and unchanged ledger results. Real provider actions remain separate from game-money QA.

Store name/service-area now use the shared TextField with native required and length limits retained; the component gained those explicit input props. Invest confirmation actions now use BaseButton and cannot dismiss/switch while a close request is pending. Verification must cover those consumer states before deployment.

Store editor source review found that Cancel retained abandoned field values and profile refresh could overlap writes. Cancel/edit now restore saved fields; successful saves adopt normalized server values. Store writes/connect are blocked while profile loading, refresh is blocked while writing, and edit/cancel controls cannot race an in-flight save. Required verification includes cancel/reopen, normalized save response and delayed refresh/save ordering. Not yet executed or deployed.

## Store/Invest handoff contract

The human requested pushed implementation slices for the agent on the other system to integrate, resolve conflicts and fix follow-up bugs. This slice changes CommerceApp.vue, InvestApp.vue, TextField.vue and invest.css only; it does not alter schemas, balances, payment providers or save migration. Source whitespace checks pass. Runtime/browser checks remain outstanding; remote CI is requested on the exact pushed branch.

Acceptance for the integration agent:
- Delay directory response A, change city/owner/LGA to B, resolve B then A: only B remains. Repeat with pagination and errors.
- Edit store fields, cancel/reopen: saved values return. Save normalized values: reopen shows the server values. Refresh and save/connect cannot overlap.
- Verify required/max-length validation for Store fields and existing Jobs/Family TextField consumers.
- At 320/390px and enlarged text, inspect large earnings, deposit amounts/returns, long addresses and action wrapping.
- In disposable game data, open and close a deposit, check pending/insufficient/offline states and ledger continuity. Real commerce/provider consent or money movement needs its own authorized verification.
- Preserve the existing release namespace, saves, immutable assets and the voice-note stash. Merge against fresh main and report exact-source checks before deployment.

### Business stock and action layout handoff

Business stock rows previously let the price field and quantity stepper consume most of a narrow row, leaving the product label squeezed. Product description now gets a full-width row, with price and quantity grouped below. Cash/rent/action rows, confirmation controls, shop headers and ratings wrap. Price fields use 16px text, rating/report controls have 44px targets, and redundant card shadows were removed. No stock/price/cashbox API logic changed. Requires browser checks at 320/390px, long labels/large balances and pending/offline control states before acceptance.

Business controls now freeze stock quantities while a stock purchase is pending and price fields while a price save is pending, preventing success handling from discarding edits made during the request. A different shop id clears the previous shop's price/quantity draft; same-shop refreshes preserve unfinished edits. Close confirmation cannot be dismissed during its request. Verify delayed requests and close/reopen with overlapping product ids. These remain source-level changes awaiting exact-commit CI and browser acceptance.

Store/Invest exact commit c5f4c4cb0b85449c0aed61ed0ba66d1a78e98ee1 passed remote CI (typecheck-fast, build/download/smoke-fast and release policy): https://github.com/kromate/joinallworld/actions/runs/37850351246. The full suite was not requested by this workflow. Browser/interaction acceptance remains outstanding and is explicitly delegated in the human's push-and-integrate workflow.

### Home visitor controls handoff

Business commit8129ed4f5e345d01d3c244765df01880ddc8eea2 passed remote CI37851320078 (type/build/download/smoke/policy).

Home visitor controls now prevent overlapping invite/link/door actions, freeze affected choices while pending, and display refusal reasons for closing a door, ending a visit and revoking a link. endLink now returns its refusal instead of silently discarding it. Native-share cancellation no longer falls through to copying the link; failed clipboard copy gets an error tone. Existing door permissions and backend payloads are unchanged. Link rows wrap, search/number/select controls have 44px targets with 16px input text, and house-style swatches have 44px targets.

Acceptance for integration: delay each operation, verify repeated clicks do not launch concurrent requests; exercise offline/refused/successful door/end/revoke states; cancel native sharing and confirm clipboard stays unchanged; test 320/390px with long guest names and link actions. Preserve current guest permissions, invitation expiry and save state. This is pending UI protection, not a claim of new server-side retry identity after an ambiguous network failure. Real outbound shares must use synthetic QA recipients or explicit user authorization.

Home-link copy fallback now has a visible read-only URL field that selects its value on focus. This makes the existing “select the link and copy it yourself” failure instruction actionable without changing link permissions or automatically sharing it. Verify with clipboard permission denied.

### Report and Statement context handoff

Report cache/draft/receipt state is now bound to the current character. Identity changes reset it and invalidate old in-flight responses; on reopening, the shared model checks its owner before exposing cached data. Same-character drafts remain across closing/reopening. Sending disables form edits, and the model also preserves any newer draft rather than clearing it when an older send completes. Unchanged retries reuse their id; changed city/category/text obtains a new id. Component completion feedback is suppressed after unmount/character change.

Statement check results now retain their character identity as well as city. Character/city changes and unmount invalidate pending checks, preventing old results/toasts from appearing in a new context. This changes no wallet arithmetic or stored ledger. Report cards use flatter surfaces and 16px fields; statement summaries and daily/group rows wrap for large amounts.

Acceptance: two identities with delayed report load/send and statement responses, same-account reopening, changed vs unchanged retry bodies, drafts edited during pending submit, 320/390px long report IDs/moderator replies/large balances. Existing model tests and exact-source CI are required; browser acceptance is still delegated. No support report may be submitted to real moderators solely for UI testing—use an isolated fixture.

Report/Statement first CI37854522963 passed type checking but failed the raw startup cap by 9 bytes (615,009 vs615,000); smoke was not reached. The statement verdict and character identity were consolidated into one atomic stored value, removing the extra shared reactive allocation. A corrected exact-source run is required; the limit was not changed.

CI37855349242 still measured615,009 startup bytes, disproving the earlier allocation explanation. The report helper was the only source caller introducing Vue getCurrentScope. Its identity watcher moved into ReportApp's component scope; useSupport still binds the cached model to identity synchronously before returning it. This preserves cleanup/identity behavior without the new runtime export. Corrected CI must confirm the measurement; no budget change.

### Notification settings handoff

The pause select previously selected value `on` without a matching option, producing a blank control for an active pause. It now has a readable current-pause option and expiry in device time. Preference writes serialize, show saving/error feedback, and use a temporary displayed value which returns to server preferences on refusal; this also corrects native checkbox state after a failed save. The test-notification button guards repeated calls. Controls use 44px targets and a 16px select. Verify paused/resume/change-duration, delayed success/refusal, checkbox rollback and narrow layout using synthetic notification devices. Existing consent/setup and notification-delivery rules are unchanged.

Corrected Report/Statement commit9d1d488fed07c5d8b299d2ec188c96491df0e5f4 passed exact remote CI37856165507, including typecheck, build/download/smoke and release policy. Removing the component-scope query import resolved the startup gate without changing caps. Identity/draft/race browser scenarios remain required for integration acceptance.

### Chat privacy controls handoff

Notification commit14e802dea7459487e0e00a74a5235c60d8d159b2 passed exact CI37856727022. Chat group/mention/introduction preferences now use serialized writes, pending/error feedback and temporary displayed choices that revert to server preferences on refusal. Controls have 44px label targets, and long explanations wrap. Backend permission semantics and default values are unchanged. Integration acceptance: delayed success/refusal, rapid toggles, keyboard focus, cross-device refresh and 320px layout; use synthetic accounts.

Chat privacy commitb29031f6 passed exact remote CI37857267550 (type/build/download/smoke/policy). Voice source is now available to the integration agent as checkpointb193bd77 on codex/voice-notes-checkpoint; see VOICE-NOTES-WIP.md for the older-base warning and remaining acceptance. The UI integration branch and production saves were not altered by checkpoint export.

### Settings older-character list handoff

Account lifecycle service ownership stays with the other agent. Settings now binds its older-character listing/error responses to the current character and request generation, invalidating them on identity changes/unmount. Changing identity clears the displayed list and old switch receipt map before loading the new scope. Switching feedback is suppressed when its initiating context has gone; existing switchLegacy server/receipt behavior is unchanged. Loading/switching/offline states are visible and disable conflicting controls. Older-character rows wrap; wallpaper tiles use a larger minimum width and 12px labels. Verify delayed list/switch responses, failed switch retry identity, account/guest transitions, reopening, and 320px layout on disposable characters. No actual account switch is performed by source inspection.

The older-character list also reloads when the connection returns, covering a successful character switch whose identity arrives before the connection is ready. Failed-switch receipt ids remain intact across same-character reconnects.

Settings audit still open: hints persistence currently uses optional storage writes, so a null storage object can skip the write without a warning; the shared warning promises tab-lifetime behavior that all readers do not implement consistently. HUD attention, companion quiet mode and tour gating read this setting through different paths. A complete fix must preserve the same in-memory choice across those consumers and every writer, including the coach dismiss action, without raising startup budgets. Do not mark all Settings behavior complete from the older-character patch.

### Shared hints preference handoff

Settings ce4d861e passed exact CI37859045285. Hints now have one reactive per-tab value initialized from storage. Settings, HUD attention, companion quiet mode and tour eligibility consume it; coach dismiss updates it too. This removes the legacy event/read mismatch and keeps the choice consistent when storage is blocked. Settings now warns for a null storage object as well as a thrown write, and clears stale warnings after a successful change. Existing storage key/default are retained; other tabs take the saved value on reload, with no claim of new cross-tab synchronization. Acceptance: toggle/dismiss/reopen, blocked storage, reload with persisted values, companion quiet mode and auto-tour eligibility; manual tour behavior and startup caps must remain intact.

The hints storage-failure wording explicitly says reload or close, matching an in-memory page preference rather than promising persistence across a reload.

### Events and public-record controls handoff

Hints exacte524bf55 passed CI37860276621. Public-record reads now have request generations: replacing a filter starts a current request, clears old-filter rows and ignores late prior responses. Leaving/unmounting invalidates the request. Loading, retry and pressed-filter state are visible; paginated reads remain single-flight. Records seals/check arithmetic and civic write APIs are unchanged.

Events expose an offline explanation and disable travel/share/spray while preserving the local calendar download. Event action/spray groups wrap with larger text and flatter cards. Civic ledger/officer rows wrap, filter targets are44px, and redundant outer shadows were removed. Acceptance: delayed filter A→B and pagination/error/retry, leaving/reopening records, long titles/large amounts at320/390px, offline calendar export and blocked online actions, normal event travel/share/spray in disposable data. No real-world political action or external share was performed.

### Runnable remote UI regression gate

CI now has an opt-in `ui_checks` workflow-dispatch input. It builds the selected ref and runs existing UI model/component suites serially on the remote runner; default CI behavior and permissions remain unchanged. This gives the integration agent executable evidence while local resource ownership is elsewhere. It adds no new test expectations and does not replace real browser acceptance. Invoke with `gh workflow run ci.yml --repo kromate/joinallworld --ref codex/allworld-integrated-preview -f full_checks=false -f ui_checks=true`.
