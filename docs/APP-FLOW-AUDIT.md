# App flow remediation

8 October 2026. Reopened by the user after the first app-interior release. The previous 41-app entry-screen sweep was insufficient evidence for complete app behavior. This is the current acceptance plan; do not mark the whole UI programme complete based on shared CSS or an app opening.

## Current integration queue

Exact cumulative source `30901804` passed remote CI [37878671956](https://github.com/kromate/joinallworld/actions/runs/37878671956): typecheck, build/download/smoke, release policy, **249 existing UI/message/authority/admin/bonus/ride checks, 9 existing shopping/housing/career checks and 4 Worker host/action checks (262 passed, 0 failed)**. These cover existing regressions, not every newly listed delayed-response/browser scenario. No new test expectations were added or changed.

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
| Groceries batch / Health layout | d03eb8c9 | 37864614906 passed, including 103 existing UI checks | Partial orders, identity/close/reopen/lost-reply races, fuel offers and narrow layouts |
| Career choices / catalogue wrapping / Bank records | 3b394f4b | 37867392052 passed, including 109 existing UI checks | Navigation and Jobs apply/switch/quit/reload accepted locally; delayed dilemma/retry, enlarged text and funded property actions remain |
| Embedded settling / focus scrolling / guest rental labels | 19e3e77f | 37869331514 passed, including 156 existing UI/start checks | Home320, Ready/Look390 and desktop, Face zoom and new landing accepted locally; physical-device and production acceptance remain |
| Game controls / contrast / failed-module recovery / chess copy | 42d26271 | 37871730141 passed, including 210 existing UI/start/table checks | Oro practice/play/result/reload recovery, chess AI/move/leave, Weave recall and Penalties turns accepted locally; pending-guess fault and full multiplayer/production remain |
| Deposit snapshot clock / money controls / grocery contrast | cf5f10d8 | 37873793219 passed, including 224 existing UI/authority/Worker checks | Actual-host roundtrip, immediate deposit card/locked total, statement/close/reload, grocery order/receipt and colors accepted locally; delayed/replay faults and integrated production remain |
| Admin/bonus effect propagation / Cars copy | cb5e96c6 | 37876799219 passed, including 252 existing checks | Actual-host durable effects/replay/nested repayment/rollback and funded car buy/use/drive/sell/reload accepted locally; integrated production remains |
| Ordinary chats / length validation / composer bounds | 30901804 | 37878671956 passed, including 262 existing checks | DM/group delivery, reply/reaction/edit/delete/forward,500-char/codepoint guard and320/390 bounds accepted locally; offline/media/cross-device and production remain |
| Profile action snapshot / field access / Goals cards | c5115e21 | 37883041814 passed, including 299 existing checks | Free color save/restore/reload, pointer access at320/390 and private action/retry isolation accepted locally; account transitions and integrated production remain |
| Neighbour filtering / public discovery / lazy page ownership | 22fb786e | 37885385999 passed, including 342 existing checks | Filter counts/empty state/off, regular People→Contacts search/result/profile at320/390 accepted locally; pagination/unknown badges and integrated production remain |
| Normal simulated Business lifecycle | 22fb786e | Same passing CI; actual normal actions and durable receipt/effect inspection | Open/stock/fresh fixed-price buy/collect/close/reload/server reconciliation and320/390 forms accepted locally. Quote/tax races, ambiguous replies, identity transitions and provider Store remain separate |
| Owned-house map selection / free rental return | 0e2afb59 | 37887179344 passed, including 353 existing checks | Stale card/selection cleared while keeping plot focus; manual selection and ordinary reopen retained; free move/rent removal/13 furniture/save continuity accepted locally |
| Canonical capture home presence | 39f13f39 | 37891313273 passed, including 396 existing checks | Actual owner UI/download/PNG, outside refusal/return and18-case active-city/consent adapter probes accepted. Normal guest consent and video browser paths remain |
| Guest consent disclosure / host layout / visit navigation / primary contrast | 87f91840 | 37896126761 passed, including 433 existing checks | Normal allow/revoke/leave, automatic entry, persistent manual Map/Phone, same-host reentry, readable320/390 card and9.86contrast accepted; video and integrated production remain |
| Voice-note checkpoint | b193bd77 on `codex/voice-notes-checkpoint` | Historical only; older base | Fresh-main integration, current compiler, private media lifecycle, Worker restart, capture/playback and compatibility |

Production acceptance in this thread is still the separately recorded a44629b3 phase. None of the newer review slices is claimed deployed here. Source inspection has not replaced the requested full screen-by-screen browser audit.

The original public-source feature and player-request research is now preserved under [research/SOURCE-ARCHIVE.md](research/SOURCE-ARCHIVE.md). Its Allworld gap columns describe the older checkout and require current-source reconciliation. The archive retains the original non-exhaustive reply-coverage boundary.

## Required scope

| Area | Required implementation and states | Evidence required | Current state |
|---|---|---|---|
| Shared controls | Owned foreground/background pairs for default, hover, selected, loading and disabled buttons; labeled reusable fields with clear, help and error states | Computed colors and keyboard behavior in real consumers | BaseButton selected variant and TextField implemented locally |
| Boutique | Distinct shop presentation, usable card spacing, actual try-on preview, reset, purchase, wear/take-off, insufficient funds, offline, pending | Exercise preview/reset and real purchase/equip using an isolated QA life; verify selected-button contrast | White-on-white root cause fixed; preview/reset, Braids purchase3500/Wearing, free Low cut wear, Bank debit and reload accepted locally. Offline/pending faults remain |
| Cars | Rendered vehicle artwork, catalogue and garage views, clear price/fuel/speed, buy/drive/sell, ownership and disabled reasons | Buy a vehicle on funded QA life, drive it, reopen/reload, sell; verify balances and state | Shared cards/artwork implemented; two buys, selected car/map fuel/actual drive, both sales, fallback/empty garage and reload accepted locally |
| Houses | Property cards with meaningful hierarchy/artwork; own home versus rentals; rent/move cost; move/upgrade/furniture links; unavailable/insufficient funds | Complete a QA move and check home, balance, rent and reload; verify all cross-app links | Shared catalogue/artwork and wrapping implemented; guest labels, rental debit/rent, free return/rent removal/13 furniture/reload and owned-plot map jump accepted locally. Paid upgrades/styles and integrated production remain |
| Jobs | Reusable search field, clear/filter/empty states, role disclosure, apply, current job, switch confirmation, quit, pending/offline | Search/clear/filter and actual QA apply/switch/quit; verify salary and role state | Reusable search and disclosure; search/filter/details, apply, Football→Community helper switch, quit/reload accepted locally. Delayed career choices/offline faults remain |
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

### Groceries batch and Health layout handoff

Groceries previously read its mutable basket throughout an asynchronous order, while quantity/Clear controls remained editable; it could also issue another batch action after leaving the screen. The batch now uses a quantity snapshot, locks controls during purchases, stops starting new actions after unmount/city/character changes, and subtracts only confirmed quantities. A character-bound shared pending state prevents reopening the app from launching a concurrent purchase; generation checks keep old completions from unlocking another character's operation. Closing the screen does not undo an already accepted purchase. Existing command/receipt and inventory/wallet rules are unchanged.

Groceries price labels and uses wrap, cards have a larger minimum width, and the basket toolbar wraps. Health status and cure-price rows wrap and redundant card shadows are removed; the game's health rules are unchanged. Required acceptance: delayed/partial/refused orders, Clear/stepper during pending, close/reopen, city changes, A→B→A transitions, lost replies/recovery receipt, refuel versus grocery concurrency, and 320/390px long prices. Use disposable characters and check both inventory and ledger. Baseline CI does not prove these new race scenarios.

The generator quick-buy now offers up to five litres bounded by both tank room and current game cash. Previously it enabled a five-litre purchase when only one litre was affordable. The displayed quantity/price now matches the sent amount; no game price changed. Include zero-cash, one-to-four affordable litres and a nearly full tank in acceptance.

Exact grocery/health candidated03eb8c9016c9c52b1423681ae8a596ee9997bbb passed remote CI37864614906: typecheck, production build/download/smoke, release policy, 100 existing UI model/component checks and 3 targeted existing Groceries/Health checks (103 passed,0 failed). This does not replace the new purchase-race acceptance scenarios above.

### Career, property and Bank follow-through, 9 October

Runtime3b394f4b follows c26c1437. Career clears the previous dilemma synchronously when its id or character changes; watcher cleanup rejects old lazy-load results after replacement/unmount. Loading/refusal states expose a retry. Jobs headings, pay, filters and schedule chips wrap. Catalogue titles/status, house/car specifications and showroom controls no longer rely on unbounded intrinsic widths. Jobs apply/switch/quit and property move/buy/use/sell show pending labels; confirmations stay locked while sending.

Bank wraps bill names/amounts and quick links, removes bill shadows, and shows complete transaction reasons and balance text. Wallet, payment commands, action receipts, prices and stored saves are unchanged by this unit.

Exact CI37866893652 passed type/build/download/smoke/policy but failed two newly included existing markup checks: the Jobs empty-state introduction and CarArt image label. The introduction now explains the unemployed state and next action; the artwork keeps a truthful drawing/3D description. No test expectations were changed. Corrected exact CI37867392052 passed all gates, 100 existing UI checks and9 existing shopping/housing/career checks (109 pass,0 fail). Logs: /tmp/allworld-bank-career-ui-ci.log. These are remote automated gates, not full browser or production acceptance.

### Verified phone settling repair, 9 October

Runtime19e3e77f includes b528d3dd and the focus-scroll correction. A phone-hosted fullscreen panel no longer applies the outer fullscreen dialog styles. Embedded settling uses the phone frame, removes the green backdrop/nested panel padding/shadow, and only mounts the avatar stage for Look. The form owns its scrolling; the phone viewport, creator root and panel use overflow:clip so native focus/scrollIntoView cannot move them. New step headings receive focus after the transition completes. Guest rental cards no longer claim Your home, and all guest move controls explain the existing settlement requirement. Gameplay commands, prices, wallet receipts and saves are unchanged.

Astra browser acceptance used two disposable actors on an isolated5196 backend. Jobs search/open filter/details, apply, switch, quit, navigation and reload passed. Boutique preview/reset/selected contrast passed; settlement then Braids purchase3500 produced Wearing and a matching Bank debit/balance72500, retained on reload; free Low cut wear also passed. Houses/Cars costs, shortfalls and empty garage were inspected. Guest/settled Houses labels and controls now agree with actual settlement state. Home320 and Ready→Look390 retain outer scrollTop0; the new heading is focused, preview and footer remain visible. Face zoom increased 3D render count4→25 and visibly enlarged the character. Fresh desktop landing retained its fullscreen preview, name field and footer. Messages list and Lumo layout were inspected without sending messages.

Early cross-app navigation failures disappeared after fresh reload and were dev-HMR artifacts. The initially suspected Face no-op was disproved by the frozen-source comparison. No unrelated shell or camera rewrite was made.

Reviewable synthetic screenshots: [Home320](qa-screens/app-ui-2026-10-09/home-sealed-320.jpg), [Look body390](qa-screens/app-ui-2026-10-09/look-body-sealed-390.jpg), [Look Face390](qa-screens/app-ui-2026-10-09/look-face-sealed-390.jpg), [new desktop landing](qa-screens/app-ui-2026-10-09/fresh-landing-final-desktop.jpg). Original report: /tmp/allworld-app-ui-evidence/acceptance-notes.md. All owned tabs, server and browser leases were closed; shared slots were verified free. The user requested quick reversible spacing/glitch repairs discovered during continued testing, including adjacent screens.

Exact final CI37869331514 passed type/build/download/smoke/release policy and156 existing UI/start checks. Startup remains614846raw/222895gzip, within unchanged615000/223000 caps. New onboarding/model/component invocation was added to the opt-in UI job; no test expectations were changed. Public health independently returned a44629b3 via curl after this source-only phase; there was no production upload.

Open acceptance remains funded car buy/use/sell, rental move/receipt/reload, offline Boutique, delayed promotion dilemmas, ordinary player-chat viewport, enlarged text, physical-device performance and fresh-main integration/production checks. This closes the named local spacing/guest-label milestone; it does not close all apps or the full parity roadmap.

### Home move and game action acceptance, 9 October

The isolated settled actor moved to Face-me-I-face-you, Mushin for the displayed7200. Cash72500→65300, Bank debit7200 and rent2400/week agreed; totalweekly14400 includes the existing12000 loan instalment. Safe before/after backend snapshots retained the exact owned-home object, all13 placed pieces and empty storage. Owned Plot1/Street1/Estate1 in LagosIsland and free return-home option remained. Reload retained65300. No production data or real provider was used.

At320/390, Oro practice accepted on-screen and physical guesses, showed short-word refusal, solved result and Another word. Chess Easy AI started, e2 exposed legal e3/e4, e4 received Nc6; Weave AI allowed placement, refused an undersized first word, and Recall restored rack7. Penalties shot/keeper turns produced1-1 with another turn. Attempts to sit at a second table while seated were refused correctly. Native Chrome handled leave confirmations; the CUA tab-dialog timeout/stale tracking was a tool issue.

Runtime42d26271 includes f462c9d8 and122bae7d. Oro amber uses dark ink and green uses a darker fill; actual computed pairs give about5.70/5.73 contrast. Header/hard-mode target and result/link wrapping are improved, card shadows removed. Keyboard/hard mode freeze while checking a guess. Practice module failure now has a clear error and explicit Reload game. Fault blocking the dictionary proved the original same-module Try again remained stuck after unblocking; the explicit reload cleared that failure, reopened Practice and accepted/scored a guess while retaining actor65300 and owned home. Daily fetch errors retain normal Try again.

Chess normalizes an existing server bot suffix before rendering one marker. It preserves a marker for bot names that have none, satisfying the existing component check without changing its expectation. Called-off status follows the server result; generic forfeit wording does not blame the opponent. Deferred bot-start intent clears on Back. No scoring, payout, rating or wallet rule changed.

CI37871093988 and37871486790 passed type/build/download/smoke/policy but failed the existing suffix check for an unsuffixed bot name. Corrected exact CI37871730141 passed all gates and210 existing UI/start/table checks. Startup614846raw/222924gzip stays within unchanged615000/223000 caps. No new test expectations. Evidence: /tmp/allworld-app-ui-evidence/game-actions-notes.md and /tmp/allworld-games-final-ci.log. Reviewed [recovered Oro](qa-screens/app-ui-2026-10-09/oro-recovered-122bae-320.jpg), [marked key colors](qa-screens/app-ui-2026-10-09/oro-marked-final-320.jpg), [single bot marker](qa-screens/app-ui-2026-10-09/chess-header-42d262-320.jpg).

All owned network blocks, tabs, server and leases were cleaned up; shared slots free. Open: pending-guess delay fault, full multiplayer/match endings, free return-home action, paid car transitions, physical devices and integrated production acceptance. Source/automated/local browser proofs remain distinct from deployment.

### Immediate deposit display and money acceptance, 9 October

Frozen pre-fix money/grocery pass: loan12000 reduced cash65300→53300 and loan72000→60000; next Saturday collection covered. Deposit1000 debited cash52300 but its card/locked amount stayed absent until reload. Close early returned1000 immediately. Rice/tomato batch600+300 changed inventory2→5 each and left52400; Clear/steppers/order/reload and receipt reconciliation passed. Statement agreed with8 changes. This was an actual projection defect, not evidence of a lost stored deposit.

Astra actual-engine and exported-host clone probes reproduced the defect with a1ms advancing clock: settlement stamped state.t, then host action took a later now(); deposit.openedAt exceeded the snapshot time. Client rebuilding at state.t correctly rejected the future record while retaining debitcash. Reload advanced the time and recovered it. Both player and internal action paths reproduced. No Vue patch or relaxed sanitizer was justified.

Astra reviewed production callers and approved the two-line host boundary change: act/playerAct use now:state.t. Audited synchronous transactions settle before acting; async external work re-reads/settles inside its commit. Receipt IDs, actor/owner fences, salt/RNG handling, revisions, updatedAt, wallet rates/caps/fees and save schemas remain unchanged. Fresh main had no overlap in the changed host/economy files. No stored state migration or backend fixture write was performed.

On frozen cf5f10d8 the actual host probe retained1deposit after roundtrip in both paths with now() still advancing and openedAt==state.t. Browser deposit1000/d1 immediately showed locked1000/card1005payout, cash51400, agreeing server statement; reload retained it; explicit early close returned52400 and removed it immediately. [Immediate deposit screenshot](qa-screens/app-ui-2026-10-09/invest-immediate-fixed-320.jpg). Safe probe/report paths: /tmp/allworld-app-ui-evidence/host-clock-fixed-cf5f10.json, deposit-clock-diagnosis.md and money-grocery-notes.md.

Grocery buy foreground/background now computes white on29,107,67 at14px, contrast6.49. Invest amount choices freeze during pending operations. Bank labels its recurring amount Usual weekly bills and repeats the authoritative already-covered collection line when prepaid, avoiding a claim that the full usual amount will be charged next time.

Exact CI37873793219 passed type/build/download/smoke/policy,213existing UI/start/table/effects/action-intent/salt checks,9targeted components and2Worker host/timed-action checks:224pass0fail. Startup614846raw/222922gzip stays inside unchanged615000/223000 caps. No test expectations added/changed. All owned tabs/server/leases stopped, viewport reset, shared slots free. This is locally/automatically verified source awaiting fresh-main integration and production release by WORLD; not a production-deposit claim.

### Funded garage and wallet effect propagation, 9 October

A separate QA Garage actor was created normally on the disposable backend. An approved local-only bootstrap composed actual createStore transaction, createOnce receipt, wallet.credit and walletEffectSink. Its1300000 credit produced cash1376000, one matching ledger/effect/receipt; replay was duplicate with no additional credit and reopen preserved it. Both original actors' canonical session hashes were unchanged. No cash/receipt JSON edit, provider or admin impersonation, production state, or random lottery reroll was used. Exact plan/proof remain in /tmp/allworld-app-ui-evidence/garage-fixture-plan.md and garage-funded-fixture.json.

Browser Bank/Statement reconciled the named QA credit before purchases. Agama350000 and Tokunbo900000 produced126000 and two owned garage entries. Drive switched between them. A displayed30-fuel/4second Agama trip to FreedomPark arrived with125970; Tokunbo's selected headline/quote showed60. Selling active Tokunbo returned540000 and selected Agama; selling the last vehicle returned210000, restored Public transport and empty garage. Final875970 reconciled with the server and survived reload. Original actors unchanged. Source copy now calls the map option Own car. [Two owned cars](qa-screens/app-ui-2026-10-09/cars-two-owned-390.jpg), [final statement](qa-screens/app-ui-2026-10-09/cars-final-statement-320.jpg). Report: cars-acceptance-notes.md in the same local evidence folder.

Fixture research found wallet.admin/bonus narrowed context to now and dropped the effect sink. Actual exported-host + durable scratchstore proof persisted cash/ledger/3 receipts for credit100,debit40,bonus25 but0 walletEffects. Astra audited callers and wallet.changed listeners: admin audit/bonus marker are separate metadata, with no duplicate journal; nested ride-debt repayment is a separate debit requiring its own ordinal. Fresh main had no wallet.ts overlap. The approved minimal correction forwards only ctx.money alongside the existing normalized now, preserving narrow context, serverOnly/caps/unrestricted/faucet/earnings rules, receipts and event ordering.

Patched cb5e96c6 scratch proof retained3 matching effects/ledger/receipts after reopen; replay added nothing. Nested repayment yielded distinct+200/-100 effects. A throwing sink rolled back session/effects/receipt, also after reopen. Shared QA backend was read only for this diagnostic and scratch was removed. Review/proofs: wallet-sink-review.md, wallet-sink-before-proof.json and wallet-sink-patched-proof.json under /tmp/allworld-app-ui-evidence. This fixes journaling, not balanced accounting/PostgreSQL or the separate reliability-B programme.

Exact CI37876799219 passed type/build/download/smoke/policy and252 existing focused checks:239 Node/UI/authority/admin/bonus/ride,9 targeted components,4 Worker host/admin/timed/ride. Startup614846raw/222927gzip stays inside unchanged615000/223000 caps. No new test expectations. All owned garage/probe resources cleaned up; original synthetic saves preserved. These sources await fresh-main integration and WORLD's production gates/upload; no live admin/bonus/car claim is made here.

### Ordinary player chat and composer acceptance, 9 October

Two existing disposable actors established friendship through normal request/accept UI, then verified DM send/recipient delivery, reaction, quoted reply/jump, edit/Edited propagation, delete confirmation/tombstone, ShiftEnter newline, thread scroll and Back/list at320/390. A405-character multiline/unbroken message delivered/wrapped with no overflow. Two-person QA group creation, Groups filter and marked forwarding survived recipient reload. No real users or audio/providers. Only the actor's own failed773-character outbox entry was removed.

Actual773-character POST returned400 invalid_message because server readme advertises body500 codepoints. Composer had the correct max prop and a1000-UTF16-unit bound for emojis, but no codepoint guard. Runtime2b550d9d added shared trimmed codepoint counting to compose/edit, an explicit remaining/over-limit explanation, disabled send/save and handler guards preserving oversized drafts. Editing now also permits the advertised emoji capacity via max*2 outer bound. Server limits/control/moderation and mention offsets are unchanged; textarea16px improves readability.

Frozen proof:773 draft retained,Remove273 shown,Send disabled and Enter emitted0POST; exact500ASCII delivered; emoji sample32codepoints/37UTF16units displayed32 and valid emoji edit propagated. Oversized edits stayed unsent. Initial320 grid min-content expanded to324px and clipped Send while documentwidth stayed320, proving document overflow alone was insufficient.

Corrected30901804 constrains composer grid to minmax(0,1fr) and form minwidth0/width100%. Exact bounds: at320 form/count/Send right310; at390 right380. Internal thread scroll and visible composer remained, short recipient delivery passed. [320composer](qa-screens/app-ui-2026-10-09/messages-composer-fixed-309-320.jpg), [oversized draft](qa-screens/app-ui-2026-10-09/messages-overlimit-fixed-320.jpg). Reports/bounds: /tmp/allworld-app-ui-evidence/messages-notes.md and messages-composer-bounds-309.json. All owned tabs/server/leases and viewport overrides cleaned up; QA balances unchanged.

Exact final CI37878671956 passes type/build/download/smoke/policy plus262existing focused checks (249Node/UI,9components,4Worker). Startup614846raw/222930gzip remains within unchanged615000/223000 limits; no test expectations changed. This closes the named local text-chat/length/composer milestone, with media/offline/cross-device/integrated production gates still distinct.

### Profile, Settings and life-panel acceptance, 9 October

The disposable QA Garage actor reproduced a free outfit-color save failure: nested reactive Look objects reached structuredClone in the action queue, throwing before persistence. At320/390, the avatar toolbar also covered the name input despite valid document bounds. Runtime6c7b3447 fixes the actual JSON action boundary before retry comparison or ID allocation, and gives the embedded Profile preview its static layout. Goals cards now use flat semantic borders. No server rules, save keys, prices, identity or retry receipts changed.

Astra reviewed and ran the actual patched client. A private JSON wrapper preserves outgoing action filtering and toJSON key semantics; parsed data is checked as unknown before use. Invalid cyclic/BigInt/array/undefined-toJSON payloads allocate no ID and issue no request, without clearing an existing pending action. Caller/getter mutation cannot change the persisted private intent; identical retries retain ID/body and persistence precedes transport. Other clone sites remain. See /tmp/allworld-app-ui-evidence/client-wire-boundary-review.md and client-actual-6c7b-proof.json.

Browser free Blue→Green saved immediately, survived reload, and was restored to Blue. Name QA Garage and cash875970 were unchanged. At320/390, the input center resolves INPUT and an actual pointer click focuses it; preview bottom508.52 precedes input top544.07. At390 Save right364 is inside the viewport. Goals320 is readable. Reviewed screenshots: [Profile320](qa-screens/app-ui-2026-10-09/profile-fixed-6c-320.jpg), [Goals320](qa-screens/app-ui-2026-10-09/goals-fixed-6c-320.jpg).

Settings wallpaper/Hints/quiet/volume choices survived reload and were restored to Lagoon/hints on/quiet off/volume80 with sound muted. Chat mention preferences saved/reloaded and were restored. Needs meters, Goals→Bank→Jobs and Missions→Map navigation passed at320/390; no reward or new financial action was taken. Notification preferences remain behind the age/device setup gate; no age assertion, OS permission, push/email or provider action was made. These are bounded local results, not whole Settings or physical-device acceptance.

Exact6c CI37881613658 passed compiler/UI/policy but exceeded startup raw by28bytes. The correction c5115e21 shortens three recovery messages while retaining all guards. Exact CI37883041814 passed type/build/download/smoke/policy and299 existing focused checks:284Node/UI,11components,4Worker. Startup614975raw/222947gzip/195281Brotli is within unchanged615000/223000/195600 caps. No test expectations changed. All owned resources were cleaned after acceptance. This source is pushed for fresh-main integration and WORLD's production release; not claimed deployed.

### Directory and public player discovery acceptance, 9 October

Frozen7a55e747 on the isolated5196 backend: Neighbours showed two homes, each in a different district. Location-confirmed only now marks the summary as city totals before filtering, reports matches among each group's loaded homes, and explains the zero-result view. Turning the filter off restores both rows. At320/390 there was no clipping or unexplained empty heading. The singular-home wording found during acceptance is corrected in the next source slice. [Filtered directory320](qa-screens/app-ui-2026-10-09/neighbours-filter-fixed-7a-320.jpg).

Rich List hide/show was exercised earlier on c5115e21 across two actors: hidden Garage disappeared from the observer's refreshed ranks, survived reload, and restored visibility returned875970. Neighbour Say hi opened the correct Garage profile and existing chat without sending. Map zoom/north/find-me/current-city selector, Home preview/Back and current-venue entry worked without charges; balances52400/875970 were unchanged. No geographic, all-city, physical-device or sustained-performance claim.

Source review corrected an initial interpretation: friendsMore is the founder/admin capability for the protected full Players directory, not an ordinary friend's count. That restriction remains. People now offers Find a player by name→existing Contacts public search. One-letter validation, no-match explanation, QA Garage's correct result/short code and View→profile passed at320/390. No privileged endpoint, new message, block, call, money transfer, location permission or age/provider declaration. [Public search390](qa-screens/app-ui-2026-10-09/contacts-found-7a-390.jpg).

Later Neighbours pages now subscribe to every raw loaded ID before filtering, retain only confirmed rows and release subscriptions on filter-off/unmount. Filtered paging is manual: a zero-match page cannot trigger automatic whole-city prefetch. City/group identity keys retire old page components. Unknown badges produce a checking explanation rather than a false absence claim. Pagination and unknown-badge loading were not available in the two-home browser fixture and remain unverified; no artificial residents/badges were created. Reports: /tmp/allworld-app-ui-evidence/directories-notes.md, directory-source-review.md and directory-fixed-notes.md. All owned resources and overrides were cleared; shared slots free at handoff.

An expanded local historical component run had six unrelated pre-existing expectation/fixture mismatches after the new People link was moved behind the normal overview gate: old Rich List/Gem CSS/wording and Family/Contacts mocks without current family data. These expectations were not rewritten. The focused Neighbours, regular/founder People and found-player checks pass5/5. Exact7a CI37884140116 passed compiler, release policy and342 focused checks (322Node/UI,5directory,11other components,4Worker), but failed startup raw615080 by80bytes. It is not a release-ready CI claim. Moving additional-page badge leases into their lazy owner reduced that increase; the current correction also keeps recovery wording concise without changing guards, storage, identity, receipts or server rules. Final exact CI is required before this slice is ready for integration.

Exact final22fb786e CI37885385999 passed type/build/download/smoke/policy and the same342 focused checks. Startup614996raw/222980gzip/195233Brotli remains inside unchanged615000/223000/195600 caps across40 cities. The final source fixes singular-home copy and keys later-page components by city/group/initial row IDs. Later-page badge leases stay with their lazy screen, avoiding an additional shared filter chunk in startup. Two city-moved/server-busy recovery sentences were shortened without changing branches or receipts. No test expectations changed. Runtime and browser evidence are source/local/CI proofs for the other system's integrator; production still reports the separately verifieda44629b3 and no new upload occurred here.

### Business money-contract findings

The [Business quote handoff](BUSINESS-QUOTE-HANDOFF.md) records a concrete source risk: the buyer posts no expected price, and sale levies are not included in the market quote. The reviewed complete design binds both unit price and total, preserves old receipt fingerprints/replays, rejects new unquoted buys, migrates existing fixture callers and verifies Node/Worker/browser journeys. It is not implemented in this UI slice. Normal shop actions with fixed price/fresh view/zero tax do not close that risk. Ambiguous Civic reply wording and actor-cache transitions are separately identified; no broad transaction/identity safety claim is made.

### Normal Business lifecycle acceptance, 9 October

Frozen22fb786e, private5196 only. The market's closed-until06:00 reason disabled travel correctly; no clock bypass was used. Independent screens were inspected until natural opening allowed a normal trip. QA App October completed one normal Nursing shift, earned3300, and restored Community helper and its original auto-go setting. Its cash52400→55700 and earned allowance3300 agreed with Bank/Statement; no fixture grant or provider was used.

QA Garage opened a provisions kiosk for12000 including the first week's rent. The price was saved to275 before the buyer opened a fresh view; the existing service showed zero sale levies. The supplier stepper buys five units at a time, and its displayed750 order stocked five. One buyer purchase debited275, leaving four. Seller reload showed four stock,275 in the till, one sold and zero NPC customers. Collect credited275; the displayed closure refund6160 was confirmed and persisted with no stall remaining.

Seller cash reconciled:875970−12000−750+275+6160=869655. Buyer cash reconciled:52400+3300−275=55425. Both Statements' Check with the server agreed, with11 seller changes and12 buyer changes. Parent inspected the stopped-store proof: five successful business once receipts, matching effects, no shops remaining, and the entire nonparticipating QA Spacing session unchanged. Participating actors' needs/location/progression advanced naturally through their normal actions.

At320/390, forms, price and stock controls, empty-name refusal, sold-out reasons, collection and close confirmation were readable and in bounds. [Final form320](qa-screens/app-ui-2026-10-09/business-final-form-320.jpg), [seller Statement390](qa-screens/app-ui-2026-10-09/business-seller-final-statement-390.jpg). Earlier scaled captures alone were not used as visual sign-off. Read-only My Store showed its saved-account/sign-in gate and empty Explore list; no legal consent, connection or external store was created.

This pass confirmed an adjacent defect: Houses→Show it on the map focused Garage's owned Plot2 in Lagos Island but retained the old Market travel card. The source correction clears the explicit destination and selected highlight while retaining the owned-plot focus. A rental's `home` destination must not substitute for the owned plot. It is undergoing a separate frozen-source recheck. The historical owned-house SSR check also expects the old Bigger houses heading, while unchanged current copy is Upgrade your house; no expectation was rewritten and it is not a navigation-click test. Focused travel/model checks and actual browser navigation are the relevant acceptance.

Evidence: /tmp/allworld-app-ui-evidence/business-actions-notes.md, business-final-private-proof.json and business-form-bounds.json. All owned tabs/overrides/server/leases were closed, shared slots free at handoff. Stale quotes/tax changes, lost replies, actor switching, provider Store and production integration remain outside this bounded successful lifecycle.

### Owned-house map correction and free return acceptance

Runtime0e2afb59 explicitly opens the city map with no destination before focusing the owned plot. Map synchronization clears selected only for that explicit null intent while the current destination is also null. Ordinary opens keep their previous selection, and a later user choice is not repeatedly cleared. No scene geometry, travel fares, save schema or ownership rules changed. Fresh-main overlap inspection found no changes to either touched travel component.

Frozen browser proof at320/390: selecting Market, then Houses→Show it on the map, removed the stale card while retaining Home/Plot2 focus. Manual General Hospital selection worked; ordinary close/reopen retained its card. Repeating the house jump cleared it. DOM marker evidence distinguishes Market's correct is-here presence from selected, which is absent after the jump. Bounds fit both widths. [Owned-plot focus390](qa-screens/app-ui-2026-10-09/map-house-final-focus-390.jpg).

QA App October then used Move into your own house · free from rented Mushin. Cash55425 stayed unchanged, active tenure became own and authoritative rental rent became null. Reload retained all13 placed furniture items, placement coordinates, empty storage, home metadata, inventory, owned plot/tier/style, loan and prepaid instalment. Bank usual bills14400→12000; no new cash transaction was added. Historical property.house still says mushin and is not the active tenure field. Garage869655/estate/furniture and the entire QA Spacing session stayed unchanged. [Owned home after reload390](qa-screens/app-ui-2026-10-09/map-house-free-move-reload-390.jpg).

Exact CI37887179344 passed compiler/build/download/smoke/policy and353 existing focused checks:333Node/UI/models,5directory components,11shopping/Profile components,4Worker. Startup614996raw/222981gzip/195323Brotli remains within unchanged caps across40 cities. Evidence: /tmp/allworld-app-ui-evidence/map-house-fixed-notes.md, map-house-marker-proof.json, map-house-bounds.json and map-house-canonical-proof.json. All owned tabs/server/leases/overrides were cleaned. These are reviewed source/local/CI results for integration; no production upload or whole-parity completion claim.

### Capture home presence and actual export acceptance

Capture stayed disabled at October's canonical own home after reopen, reload and foregrounding. Invite's home sentence was based on local state and did not prove server presence. The server HouseView classified home solely through an optional Home-room subscription. Exported-service probes reproduced an online owner home with no room being classified out, and a stale Home room overriding a canonically away actor.

Astra reviewed the required Node/Worker atHome adapters, active-character selection and privacy scopes. The initial any-city replacement was rejected: an inactive saved city can still contain a home snapshot, and the first guest's display city does not cover a mixed-city roster. Runtime39f13f39 resolves the online host's active character once, requires every retained visit to match that city, and uses the existing canonical atHome authority. Offline/reconnecting, missing helper/DB/session, expiry and false canonical checks stay denied. No room fallback, client Capture-guard relaxation, consent/admission/pruning change, save migration or wallet mutation. Fresh-main overlap inspection found no changes to the touched service.

The actual patched exported service passed18 scenarios with each production adapter's verbatim body: canonical home/no room, away/stale room, inactive/mixed city, consent, expiry, offline/reconnecting/unresponsive and missing authority. These are service/adapter diagnostics, distinct from booted Worker tests and UI. Reviewed plan/proofs: /tmp/allworld-app-ui-evidence/capture-home-review.md, capture-home-patched-node-proof.json and capture-home-patched-worker-proof.json. Active scope adds a bounded indexed session lookup and one home check rather than trying40 cities.

Normal owner UI enabled Take photo, rendered its preview and downloaded a real PNG. The [actual downloaded scene](qa-screens/app-ui-2026-10-09/capture-home-downloaded.png) is447513bytes,780×1688RGBA, SHA2566363250103504f7af4922d90cdab019923f1575c01a9a68b3fe25d9c3fc7ad9f. The image itself was inspected: own synthetic avatar/3D room/furniture, no HUD, phone, wallet or other players. The existing older download was preserved. CUA's download-event wait timed out, but the newly timestamped filesystem artifact proved success; no programmatic capture or permission bypass was used.

Discard cleared the preview. Normal Step outside refused capture in the shared street, and Go inside/reload restored readiness. Cash55425, own home and13 furniture items remained; Garage869655 unchanged. A truncated browser socket observation saw a normal home join, so the UI run is not described as a zero-room trace. No-room semantics are proven by the separate actual-service diagnostics. At320, action bounds were16.07–303.93; the photo was taken at390. [Returned-home controls320](qa-screens/app-ui-2026-10-09/capture-home-return-enabled-320.jpg).

Exact CI37891313273 passed compiler/build/download/smoke/policy and396 existing focused checks:374Node/UI/social/character/visit,5directory components,11shopping/Profile components,6Worker including the existing visit suite. Startup614996raw/222981gzip/195323Brotli stays within unchanged caps. No test expectations changed. All owned resources cleaned. Normal guest-consent/revoke/leave and video remain separate acceptance paths; no production deployment or universal export claim.

The preceding read-only Help/Support/Invite/Story pass fit320/390. Help shortcuts/disclosures, empty invite validation, and unsaved Story Add/Remove/empty-Save behavior passed. No Support report, external invite or scene was submitted; balances and saved scenes were unchanged. Report: /tmp/allworld-app-ui-evidence/capture-support-notes.md. These checks do not claim provider delivery or saved Story publication.

### Guest consent, navigation and narrow host card

Two normal synthetic actors completed Knock→Let them in→Enter. Without guest consent, owner Capture was disabled; Allow recording enabled it, Revoke disabled it, and Leave restored owner-only readiness. Guest Capture stayed denied. No guest photo/video, microphone, provider or real-user content was recorded. Final visits, guest lists, pending knocks and consent rows were empty, with cash55425/869655 and13 furniture items each unchanged. This closes the normal consent browser path previously left open; video recording and expiry/city-transition browser paths are still separate.

That pass exposed three presentation issues: the permission copy mentioned only video though it also enables photos; the guest host card compressed its name/status to ellipses at320; and the visiting-home view retained Market Shops here and Fabric-stall guidance from the visitor's saved physical location. It also left Map open after an accepted visit because shell.close closes Phone first.

Runtime273a4848 adds accurate photo/silent-video disclosure, a wrapped host-details row with a separate action row, visit-specific venue copy/activities, and temporary pointer suppression without changing stored Hints. Common coach cleanup replaces duplicated code. The existing neighbourhood transition controller now identifies each accepted visit by host plus visit ID, rejects stale responses by that key, and reveals the home once. Later sync/consent/layout updates preserve manual Map/Phone navigation; leaving clears the shown key. No physical-location command, room-join override, wallet/consent rule or saved-home change.

Frozen UI proof: Phone over Map→accepted Knock revealed the home automatically. Manage visit worked. Manual Map stayed open21seconds and Phone31.8seconds through normal5second refreshes and consent revocation. Leave restored Market actions/hints; friend entry to the same host with a new visit ID revealed home again and required new consent. At320, host text client/scroll widths match208px; name/status are full and wrapped, with separate127px buttons. All controls fit390 too.

One remaining measured defect was white13px/600 House chat text on amber217,130,0:2.94contrast. Runtime87f91840 gives shared social primary buttons a solid darkened app tint with white ink and a dark-green fallback. Actual Chrome color-mix foreground/background computes9.8554contrast at320/390. The [corrected guest card320](qa-screens/app-ui-2026-10-09/guest-contrast-fixed-320.jpg) retains full text and action bounds; House chat opened the correct existing home conversation without sending. Unsupported-browser fallback was not simulated.

The first guest UI build exceeded startup raw by153 and gzip by57. Keeping row rules in the existing shared stylesheet and removing repeated coach cleanup avoided an extra CSS dependency/duplicated startup code. Three Terser compression passes, still one worker/1536MiB locally, reduced the same interim UI by75raw/277gzip bytes with build18.9→21.7seconds. Final exact87f CI37896126761 passed compiler/build/download/smoke/policy plus433 focused checks:411Node/UI/attention/social,5directory,11other components,6Worker. Startup614958raw/222799gzip/195143Brotli remains inside unchanged caps across40 cities; no test expectations changed.

Reviewed reports: /tmp/allworld-app-ui-evidence/capture-consent-notes.md, visit-navigation-review.md, guest-ui-fixed-notes.md, guest-contrast-fixed-notes.md and their safe bounds/colors/canonical proofs. All owned resources and visits cleaned. These are source/local/CI acceptance for fresh-main integration and sealed production checks, not a production release or full-parity completion.
