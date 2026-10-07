# Living neighbourhoods

Updated 7 October 2026. This is the delivery tracker for the remaining realism work and the connected-neighbourhood direction. It supersedes the delivery order in `REALISM-PLAN.md`; `REALISM.md`, `EMBODIMENT.md`, and `REAL-VALUE.md` remain design references. Implementation and production status are separate.

## Confirmed scope and order

Anthony confirmed: **include the entire older roadmap**, including whole-city/intercity streaming and the real-life marketplace. N1–N7 are the first connected-neighbourhood delivery, not the end of the programme. Complete the remaining building/compound, smart-object, wardrobe, calendar, street, intercity, and Phase R work described by the reference documents. Real-money provider/legal prerequisites stay explicit; code or a simulated provider must never be reported as a live verified service.

After that programme, implement [the supplied progression brief](PROGRESSION-BRIEF.md): establish the economy baseline, fix demonstrated balance problems, complete the six-chapter Hostel Hustle aspiration, make its decisions playable in the world, and add one recurring community event with solo and multiplayer paths. That follow-on is queued; it has not started. Its video reference is `/Users/anthonyakpan/Downloads/Video-57247.mp4`.

Anthony explicitly chose to keep test files unchanged. Use existing checks and temporary diagnostics. Do not conceal failures of frozen schema/speed expectations, change those tests, or report a full check as passed when it stopped there.

## The experience

Make a place, give friends a reason to come over, and live a story together. A player arranges their home, opens the front door, walks down a street with real neighbouring lots, visits a nearby friend, spends time together, and walks home. Local story scenes and capture now have acceptance evidence. Modular building and compound work remains active.

Anthony chose both playable story scenes and photo/video scenes, with playable scenes first. A playable scene is a setting a player arranges with props, activities, and a short sequence of moments that invited players can join. Examples: a courtyard birthday, a cooking challenge, a rehearsal, or a neighbourhood football watch party. Capture was added after the scene became playable.

N1 established an actual server location outside, a visible doorway, walking, return, and reload behavior. N2/N3 now bind street presence and home visits to real lots and permissions. The evidence remains local rather than production proof.

## Starting point

Source baseline: `e659ca1` on 7 October 2026. PRs 1–18 are merged. The last production identity checked in the preceding review was source `1398eed`, before the body, trust, and chatter merges. Recheck the release source before any release; this document is not evidence of current production behavior.

Reuse these existing capabilities:

- Allocated `PlotAddress { lga, estate, plot }`, estate layout, owned-home tiers, construction time, and server-side payments.
- Furnishing, placement validation, storage, and saved-look compatibility.
- Door choices, knocks, invitations, blocks, visit expiry, house capacity, and social rooms.
- Walk grids, avatar animation, click/keyboard/touch movement, and lazy scene loading.
- City casts, routines, dilemmas, conditions, personal space, sound, and the merged body/trust/chatter work.

The memory/gossip/consequence implementation from `codex/realism-memory` has been recovered, but still needs a dedicated player-facing acceptance scenario. Continue the current storeys/building/compound work under N4; do not treat older branch state as a shipped feature. Objects and wardrobe remain separate roadmap work.

## Delivery order and acceptance

| Unit | Player outcome | Acceptance evidence | State / next action |
| --- | --- | --- | --- |
| N1. Through your front door | Walk to the visible door, step onto the street, explore, and go back inside the same furnished home | Real server transitions; rejected paths; reload outside; furniture retained; accessible keyboard/mobile return | Historical local acceptance below; production/device gates remain |
| N2. A real street of real lots | See actual neighbouring plots and walkable facades for friends who live there | Stable address geometry; bounded directory and presence; privacy, block, and row isolation; no fabricated residents | Implemented and locally verified on Node and Worker. `street-presence-api.json`, `geometry.json`, `final-street-guest-view.jpg` |
| N3. Walk over and visit | Walk to a friend's door, visit their furnished interior, leave onto that street, and return home | Two independent players; door/block/expiry checks; limited home projection; host status and exit position | Implemented and locally verified on Node/browser. `next-api.json`, `final-guest-visit.jpg`, `final-guest-left-at-host-door.jpg` |
| N4. Grow the place | Preview and buy adjacent land, add rooms/floors, and create a shared compound | One-charge purchase/replay; competing claims; adjacent addresses; collision and reachable gates; saved layouts | Land backend and current geometry have local evidence; modular building/compound blueprint work remains active. `land-api.json`, `geometry.json`, `final-land-quote.jpg`, `final-first-floor.jpg` |
| N5. Create a playable story scene | Save a named setting, arrange props, set activities/moments, invite friends, play, end, and replay | Draft/publish, action receipts, replay, unchanged home/cash, host guest controls | Implemented and locally verified on Node/browser. Worker create/publish/start pass, but the second eviction diagnostic timed out before replay could be verified. `next-api.json`, `worker-next-api.json`, `final-story-host.jpg`, `final-mobile-story-guest.jpg` |
| N6. Capture the story | Frame a shot, take a photo, and record a short scene-only clip | Photo/video preview; guest consent default-off; revoke, stale visit, block, departure, expiry and privacy gates | Implemented and locally verified in browser plus real HTTP/socket fixture. `capture-consent-api.json`, `final-photo-preview.jpg`, `final-video-preview.jpg`, `final-capture-revoked.jpg`, `final-mobile-capture.jpg` |
| N7. A neighbourhood that remembers | Neighbours remember visits and choices; everyday events create reasons to return | Bounded memories/consequences; no gossip about another player's private actions; dedicated browser/save acceptance | Memory code recovered; no dedicated new browser scenario yet |
| N8. Beyond the block | Walk from home to venues, use transport, and travel between cities | Bounded street tiles, actual venue entry, fallback travel, and a completed intercity return | Lagos/Ibadan packed assets and Node/browser venue round trip pass, including the corrected return camera. Worker persistence, city-street peers/traffic and intercity travel remain open |

Every unit ends with a local acceptance record before its release gate. Nothing is marked production-complete from a merge or a successful build alone.

## N1 implementation contract

The existing server action route remains authoritative. `home.door` carries `direction: 'outside' | 'inside'`. Outside changes `state.location` from `home` to `neighbourhood`; inside reverses it. Both reject busy lives and the wrong origin. Repeated requests use the existing action receipt mechanism. No new money, ownership, or furniture state is introduced.

The neighbourhood is a shared venue definition available to every loaded city. Its scene is separate from the city-specific venue assets. A scene exposes a door approach position; the host walks there and then asks the app to dispatch the action. The scene never changes a life itself. An accessible control calls the same action if 3D is unavailable. Loading errors retain a usable return path.

At N1 the exterior was a walkable own-home frontage with anonymous surrounding scenery. N2 now scopes street membership to real plot rows, and N3 handles friend-door admission. Do not transmit positions into one city-wide street room.

Rejected design: a local `outside` view while `state.location` remains `home`. It is smaller, but the server would keep advertising the player as inside and apply the wrong visit rules. The selected design uses an ordinary accepted location and preserves the existing host-leave behavior.

Deferred design: a new district ownership aggregate with duplicate lot records. The existing allocator already owns addresses. Add only the identifiers and revision checks needed to prevent stale door links from following a released plot to a new resident. Do not create a second source of ownership truth.

## Rules for the next units

- An address is not permission. Resolve the current resident and apply visit rules at admission, not just when rendering a door.
- Recycled plots must not redirect old invitations to a new owner. Bind an invitation to the resident and a residence revision.
- Return from a visit to the street that was actually entered from. Do not silently return to the visitor's own interior.
- A visited-home projection contains allowed layout/style/furniture data only. Never send a host's whole life, inventory, balance, or private history.
- Street presence is scoped by city, local government, estate and block; it is not a city-wide crowd. Blocks apply to presence, chat, and voice.
- Lot expansion uses the existing wallet/receipt path and a single authoritative ownership transaction. Rehearse migration and concurrent claims before release.
- Scene creation uses owned/allowed props and bounded data. No arbitrary code, externally supplied scripts, or client-granted rewards. Published scene revisions are immutable while a group is playing them.
- Guests retain control of their movement, participation, sound, and camera visibility. A scene ending does not erase furniture or charge guests.
- Keep guest-first entry. A guest can play the first scene without an account; durable sharing and ownership follow the existing account rules.
- Measure download, memory, draw calls, and movement on mobile. Additional geometry loads with the scene, not the landing screen. Do not raise a budget just to make a new feature pass.

## Discoverability and phone acceptance

Every mechanic needs an obvious, contextual next action. Show cost, duration, requirements, and what will happen before a purchase or timed action. Empty, blocked, offline, and unavailable states explain why and offer a useful next step. Core actions must remain usable on a narrow phone layout without requiring players to discover an unrelated menu.

Current UI changes add a direct HomeChip “Upgrade & manage home” entry, move Upgrade above appearance, group home shortcuts under Houses, offer “Step outside” from Neighbours, and link a land-shortage message to Houses. The bounded 390×844 browser acceptance passed; evidence is recorded in the usage and discovery checkpoint below.

## Remaining realism work outside this sequence

The separate avatar unit has completed local body, wardrobe and object-interaction verification; see `AVATAR-WORK.md` for exact evidence and low-end/emulation limitations. Efik language review remains open. Preserve old looks and the low-end fallback in subsequent integrations.

Phase R remains in the confirmed programme. Listing core is written but pending integration; stalls, seller analytics/share cards, Passport, gigs, notices, classes, and learning quests are not accepted complete. Anthony chose Firebase phone and Dojah ID providers, but no credentials were supplied and no live provider calls or verifications have occurred. Until configured providers return verified results, those tiers remain unavailable. Real-money levels above L0 remain outside the current authorization and depend on later business/legal/payment decisions.

## Ownership and evidence

| Work | Owner/model | Boundary |
| --- | --- | --- |
| Architecture, state/privacy decisions, integration | Primary coordinator | One owner for contracts and merged result |
| Domain and scene-host implementation | GPT-6.1 Sol, medium | Bounded coupled implementation; no browser use |
| Inventory and isolated street geometry | GPT-6 Luna, medium | Read-only inventory, then one new scene module |
| Browser/desktop acceptance | Astra | One interactive operator, desktop and narrow-mobile pass |

Use one implementation worker at a time after current tasks settle. Keep shared files with one writer and delegate only a finite, non-overlapping unit with a concrete acceptance result. Run heavy commands through the repository's agent-slot script; avoid duplicate broad builds and repeated checks after unchanged code. Record elapsed time/retries where observable; monetary and token cost are unknown unless the host reports them.

Current work is local implementation. Preserve the original dirty checkout, the recovery worktrees, and unfinished realism branches. No release, commit, push, or external messages are part of this unit's completion claim.

### Current checklist

- [x] Ground the existing home, movement, plot, and permission paths.
- [x] Compare local exterior and authoritative neighbourhood designs; select the server-backed transition.
- [x] Record the new sequence and the playable-scenes-first decision.
- [x] N1–N3 local door, lot, scoped-presence, and friend-visit flows have API/browser evidence.
- [x] N4 land backend and current compound geometry have local evidence; modular building/compound blueprint work remains active.
- [x] N5 story lifecycle and N6 capture consent/preview have local API/browser evidence; Worker story eviction replay remains a gap.
- [x] Recover the memory/gossip/consequence logic.
- [ ] Add a dedicated N7 browser/save acceptance scenario.
- [ ] N8 renderer, server authority and whole-city/intercity user journeys remain unfinished.

### Historical N1 local acceptance, 7 October 2026

This is the original N1 acceptance snapshot, retained for provenance. Later local evidence and current check limitations are recorded below.

Preview: `http://127.0.0.1:5184/`. At that snapshot the implementation was uncommitted in this attached worktree. Another task added the fast-check commands in commit `57bde97` while this work was underway; its CI/package changes were preserved and are not part of the neighbourhood diff.

- `npm run slot -- heavy -- npm run check:fast` passed: all five TypeScript projects, production build, download budgets, and 15 smoke/protocol/release checks.
- Existing focused home, home-power, visit, community, movement and scene checks ran. The first batch had 91 passes and one tag-list expectation failure: a host without a door handler displayed an inert door button. Door controls now require that capability; the affected scene checks and protocol/action checks passed on the focused rerun, 25 checks. No tests were added or edited.
- Final first-paint JavaScript: 90,274 / 92,000 raw bytes. Largest startup: 217,058 / 223,000 gzip bytes. Shared scene host: 188,399 / 192,000 raw and 70,635 / 71,000 gzip bytes. No budget was raised. Exterior geometry is a separate lazy chunk.
- A fresh local guest completed a real HTTP walkthrough. Invalid direction/location and busy use were refused; furniture movement outside returned `not_home`; the same action ID replayed without a second transition; changed payload under that ID returned HTTP 409. Reload retained `neighbourhood`. Cash, all 13 furniture entries, and missions were unchanged by door round trips. Ordinary travel still completed to the park.
- Astra verified a fresh guest in an isolated browser: desktop exit, street click movement, reload outside, a 390×844 exterior, keyboard return through the door, the same 13-object home, corrected place/district heading, and no console errors. A first Chrome session had ambiguous input interference; that return concern did not reproduce in isolated IAB. Idle-poll movement stability was not conclusively measured.
- Review fixes removed coplanar road/grass flicker, corrected the door's accessible name, kept the title human-readable, and hid community controls where no street room exists.

At the time of this N1 slice, the full suite and Worker runtime were not rerun. Later Node/Worker and browser observations are recorded below; physical-device and production acceptance remain separate.

Workers: GPT-6.1 Sol implemented the bounded domain/adapter unit; GPT-6 Luna inventoried prior work, built the isolated scene, and ran the HTTP walkthrough; Astra performed browser acceptance. Integration handled the shared app wiring and review corrections. Exact model tokens, monetary cost, and per-worker elapsed time were unavailable. One type-import correction and one bounded visual correction batch were needed.

### N2–N7 local acceptance, 7 October 2026

- `next-api.json` passed its fresh Node fixture checks for adjacent lots, same-street directory privacy, block/row checks, friend-door admission, limited host-home projection, story receipts/replay, visit leave, host departure, expiry, walk-in access while the host is out, and stale plot refusal. `street-presence-api.json` passed scoped presence, chat, voice, row movement, hidden-resident, and indoors-return checks. `geometry.json` passed shared-frontage collision, reachable gates, expanded-yard traversal, anonymous vacant lots, and bounded geometry checks. Browser evidence includes `final-street-guest-view.jpg` and `final-guest-visit.jpg`.
- `land-api.json` records passing Node registry/API races, receipt replay, failure-boundary recovery, restart recovery, and bounded startup/heartbeat recovery. `geometry.json` and `final-land-quote.jpg`/`final-first-floor.jpg` show current local lot and building presentation. This does not complete modular-building/compound blueprints; N4 remains active, and land acceptance is not Worker proof.
- Story scene create/publish/start/moment advance/end and unchanged possessions passed the Node API fixture. Browser captures are `final-story-host.jpg` and `final-mobile-story-guest.jpg`. The Worker probe passed door persistence, street lookup, and scene creation/publish/start, but the second eviction diagnostic timed out with active references. Running-scene persistence/replay after that eviction remains unverified; this is not evidence of lost scene data.
- `capture-consent-api.json` passed nine real HTTP/socket checks: grants default off, all guests must grant, the host receives an aggregate ready frame, revoke changes the revision, stale visit IDs and unauthorized callers are refused, guests cannot inspect each other's grant flags, and block/departure/expiry remove capture readiness. Browser captures show photo/video preview and revoke states in `final-photo-preview.jpg`, `final-video-preview.jpg`, `final-capture-revoked.jpg`, and `final-mobile-capture.jpg`.
- Memory/gossip/consequence code is recovered, but no dedicated new browser scenario is recorded. N7 remains unaccepted.

Current verification is not a full check. `/tmp/allworld-neighbourhood-final-budget.log` shows measured download budgets within their existing limits. `/tmp/allworld-neighbourhood-final-types.log` stops at the frozen `src/types/engine.test.ts` reader shape, which lacks stories; the old movement expectations also remain stale. `allworld-neighbourhood-checks.log` recorded 91/92 with a home tag-list expectation for the new door; `allworld-neighbourhood-followup.log` passed its focused 25/25 rerun. No tests were changed. This is local evidence only, not production or physical-device proof.

N4 pure blueprint compilation and N8 offline tile generation have passed focused diagnostics. Their live editor, renderer and authority integration remain. Phase R listing routes are registered and the public feed/unauthenticated owner refusal pass an isolated HTTP check; marketplace UI remains. Account deletion now removes listings, contacts and viewer records for active and parked characters; export includes only the account owner’s supplied contacts and aggregate analytics. Focused privacy diagnostics pass. Public reads now validate only accessed entries and do not hydrate unrelated contacts or analytics; the bounded write validator still scans the whole collection and needs scaling review before a large rollout. Separate avatar-chat E-A/B/C work remains in progress. N2/N3 are not the next queued units. The older progression brief remains queued until the complete previously accepted roadmap is handled.

### Usage and discovery checkpoint

Anthony asked to keep AI usage low. The current bounded tile, blueprint, listing and documentation workers have returned and are idle. Continue subsequent implementation units serially with one suitable cheaper worker; reserve Astra for consequential decisions and focused integration/browser verification. Do not repeat broad checks without a new acceptance gap.

The home HUD now opens Houses directly with **Upgrade & manage home**. Upgrade options precede appearance settings; related furniture, land, story and neighbour routes are grouped in a collapsed section. My street can walk the player outside instead of only telling them to leave, and land shows the exact savings shortfall and a Houses shortcut. A narrow-screen overflow was found and corrected. The focused browser recheck passed at 390×844: document clientWidth and scrollWidth both 390, complete upgrade prices and buttons visible. My land recognizes the starter home and offers an adjoining plot, with the exact shortage and disabled purchase. No currency was spent. Evidence: `evidence/neighbourhood/home-discovery-mobile-fixed.jpg` and `home-discovery-land-fixed.jpg`. The existing local preview backend was refreshed to load the new routes. No test files changed.

The user selected continued execution of the full roadmap with one implementation agent at a time. N8 live street integration is the sole current worker unit; the avatar chat has returned its bounded object/wardrobe handoff and is idle. Parent integrated Firebase/Dojah handlers and lazy verification screens; synthetic-provider HTTP checks pass, while real provider sandbox/configuration and Worker runtime remain open. See `TRUST-PROVIDERS.md`.

The latest provider/UI build passes, but its measured startup JavaScript is 609,341 raw bytes against the unchanged 609,000-byte limit. Shared scene and compressed/startup/body budgets pass. Outdoor venue construction and duplicate community-room checks were subsequently consolidated; their budget recheck is pending the next integrated build. Test files and budgets remain unchanged.

N8 authority now has 8/8 controlled-clock Node HTTP checks over the actual generated gate-to-CcHub route, including strict admission, movement/retry limits and no repeat arrival reward. Parent reran the diagnostic after integration. Renderer/client/host are not implemented yet. Parent added private WS proof snapshots and canonical viewer position for reconnects; pure restore/idle/clear checks pass, but actual Worker eviction remains unverified. Street execution is holding while the separately resumed avatar worker finishes a bounded fix, preserving the one-worker limit.

### Street browser checkpoint

On the isolated built preview, actual controls completed estate-gate admission, keyboard movement with accepted position sequence, reload into the same walk, CcHub entrance, venue exit, and estate return. The long leg used the fixture's accelerated clock through the real validated movement API, not a full observed real-time browser walk. Evidence: `evidence/street/city-entry.jpg`, `venue-entry.jpg`, and `estate-return-before-position-fix.jpg`.

Browser findings were fixed in source: the neighbourhood camera now follows the walker across the row; presence normalization uses the canonical street factor rather than the generic 19.5/reach factor; the game entry declares its compressed avatar assets and receives only the required WebAssembly and embedded-blob texture permissions. The latter passed actual built-page loading without current-origin avatar errors. The unchanged security-header suite now has nine passes and one obsolete Node exact-header expectation; no test file was edited.

Return-to-estate position raced the new room join and briefly reset to the house. Source now resolves the durable estate-return point before socket rejoin and restores it after the accepted transition; this correction still needs browser recheck. New street host initially used only the procedural figure and passed radians as normalized procedural stride. Source now uses the existing gated skinned stand-in and the proper distance-derived phase; recheck pending. Raw location/door IDs and technical provenance text were also replaced with readable names/instructions. Street visuals, mobile acceptance, full sparse assets and actual Worker eviction remain open.

Primary fixed live look propagation through committed-state room verification and the existing people-list nudge. A real HTTP look change with two same-room sockets and a social watcher preserved voice and position while exposing the new wardrobe/appearance without rejoin. Evidence `evidence/avatar/live-look-http.json`.

### Serial implementation checkpoint

The user's latest pacing choice confirms continued execution of the full roadmap with one implementation agent at a time. The street-assets worker is idle while the avatar chat repairs a visually reproduced same-anchor activity transition freeze. Chrome remains assigned to that chat. The focused preview-boundary, room-group and receipt checks passed 33/33; test files remain unchanged.

Full-city planning found 42,248 sparse tiles and 6,077 virtual estates without a safe connector under the existing rule. No public assets were emitted. The next unit will anchor these virtual estates at explicitly generated entrances on existing valid ground roads, retaining their virtual addresses and recording any cross-LGA fallback. These are not surveyed physical estates or mapped connecting roads. Recalculate the asset count before emission. Cloudflare's documented Free limit is 20,000 static files per Worker version; the account plan is unverified, so preparation must fit that ceiling including ordinary app assets and a retained street version. Source: https://developers.cloudflare.com/workers/platform/limits/ .

Versioned manifest retention and caller-only estate-door projection passed five focused diagnostic checks. Node and Worker asset readers now accept the optional retained-version filename; Node current/retained/missing/invalid-path reads passed. Street HTTP contracts now cover all six routes, and the existing exact route-registration check passes. The full protocol file reports two passes and two failures: its bare context omits the required checks object, and its visit expectation still includes a removed private capture field. The aggregate typecheck reports only the frozen engine reader's missing stories entry. No test files changed.

Latest measured startup raw JavaScript is 612,728/609,000 bytes; compressed startup and shared-scene budgets pass. Further source changes have not yet been measured. Budgets remain unchanged; the earlier smaller measurements above are historical. The avatar correction is stable and the single street worker has resumed generated-portal placement and measurement. Chrome remains assigned to the avatar chat for its remaining visual checks.

Portal measurement now covers all 10,240 Lagos and 5,632 Ibadan virtual estate gates, using 3,000 and 7,225 logical tiles respectively. Lagos has 1,024 cross-LGA generated entrances, covering Alimosho and Ifako-Ijaiye because the authored road data has no valid ground-road candidate in those areas; all other entrances stay within their address LGA. Ibadan's IITA Forest has no safe walking connector and retains timed travel. The manifests are each approximately 3.1 MB. Evidence: `evidence/street/portal-count.json` and the per-city portal mappings. No public assets were emitted at this checkpoint.

The sole Sol worker is packaging at most four logical tiles per immutable file, capped at 256 KiB, to fit current and retained versions within the hosting file ceiling. The client still receives one projected tile at a time and keeps at most nine. Dense internal door data is validated separately; public tiles retain the caller's own estate gate and public venue entrances with the existing 64-door limit. Preparation remains local and must pass hash, identity, projection, retention and size checks before acceptance.

### Packed assets and built consumer acceptance

Local preparation and integrity checks passed for both cities. Lagos has 750 packs and Ibadan 1,807 packs; two retained versions occupy 5,122 files. Conservative app headroom brings the total to 5,834, below 20,000. Manifests are 3,401,548 and 3,826,635 bytes; maximum pack sizes are 126,307 and 55,992 bytes. All 15,872 estate approaches remain walkable after building generation. Quantization now precedes LGA classification: Lagos retains its approved 1,024 fallbacks and Ibadan has none. Seven packed-reader checks and five real-filesystem pointer/retention checks pass, including corruption, dense-door isolation and same-version retries. Current manifest replacement is atomic and follows immutable-file copying. Evidence: `prepared-assets.json`, `packed-check.json`, `publish-check.json`, and each city's `prepared-check.json` under `evidence/street`.

The integrated production build passed. Startup raw JavaScript is 612,795/609,000 bytes, the only download-budget failure; shared scene is 172,189/192,000 raw and 64,032/71,000 gzip. One new producer TypeScript union error was corrected with explicit plan/prepared discriminants and a focused script check passed. The aggregate frozen engine reader failure remains. The sole Sol worker is now moving expanded venue activities behind their existing expansion control, preserving functionality and adding loading/retry states, to reduce real startup work without changing budgets.

The built Node proof-corridor browser recheck passed rigged street-avatar loading, walking, return at the estate arch and reload at that same arch. At 390×844 the page and scroll widths both equal 390; walking help, continue-walking and return controls work, with no browser errors. Evidence: `estate-return-fixed.jpg`, `mobile-walking-help.jpg`, `mobile-estate-return.jpg`. This browser used the isolated proof corridor; it does not yet prove a full-city packed-assets user journey or Worker eviction. Solid city entrance markers still obscure the avatar and scenery is visually unfinished. Door-marker and street-scene polish remain open.

### Deferred activities and full-city consumer checkpoint

All unchanged download budgets now pass: startup 608,997/609,000 bytes, saving 3,798 bytes. Expanded cards and their formatting helpers load on demand; the tiny shared trip predicate remains immediate. Loading/failure/retry states and parent command guards remain. Build and focused Vue typecheck pass. This leaves only three bytes of startup headroom. Evidence: `evidence/street/startup-budget.json`.

An isolated built Node fixture now uses the real public packed-asset bridge. Actual controls entered from the estate, loaded the city, entered CcHub, expanded Café corner activities, completed Gist with Founders, reopened activities and left to the street. The activity increased Social and completed an existing introductory goal, awarding its expected ₦500. Mobile cards fit 390 pixels. Long outward and return legs used accelerated fixture time through the real validated movement API. Evidence: `lazy-activities-mobile.jpg`.

The full venue round trip exposed a transition bug: return kept the authoritative gate position `{x:19.29,z:0}` but the view showed the distant house frontage until reload. Reload correctly placed the avatar at world X81.02 with camera X90.02 and the city-gate tag visible. Source diagnosis is active; the short proof round trip above does not close this broader case. Evidence: `full-return-camera-before.jpg`. Full-city console logs also caught empty-tile `Object3D.add` warnings; the pending renderer revision avoids adding an empty mesh list.

Renderer polish is implemented but awaits the next integrated visual pass: open entrance arches, capped road markings and façade details, exact original footprints and navigation. Numeric checks across 147 proof/worst/dense tiles pass; maximum measured 1,536 triangles and two draw calls per tile. Ground row coalescing preserves every mask cell and hole. Evidence: `polish-check.json`. No test files or limits were changed. A misleading no-activities message on city streets was also corrected in the lazy panel, pending that build.

The subsequent integrated build and every unchanged download budget passed, with startup still 608,997 bytes. The actual-host probe isolated the return problem to the idle camera: restoration moved the walker but did not apply the orbit's new target. Applying the settled camera fixes it while preserving zoom/yaw and avoiding idle redraws. The built packed-city CcHub round trip now returns directly to the visible estate arch without reload; desktop/mobile visual checks and current-origin console checks pass. Evidence: `return-camera-probe.json`, `full-return-camera-fixed.jpg`, `polished-city-desktop.jpg`, `polished-city-mobile.jpg`. Worker proof is the sole next implementation/verification unit.

Account export/deletion now includes street journeys. Erased active characters and deleted parked characters lose their journey records; keeping the active character as a guest preserves its journey. Exports copy only the account's own character journeys. Actual account-service checks cover both erase choices, export nonmutation and unrelated-player preservation: `evidence/street/account-privacy.json`.
