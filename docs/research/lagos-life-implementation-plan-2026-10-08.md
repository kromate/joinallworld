# Allworld implementation plan: Lagos-life parity

> Historical source comparison only: the source audit used the dirty Desktop checkout at f115424c. Its gap classifications must be rechecked against current integrated source before implementation. Current delivery and production receipts are in [PARITY-DELIVERY.md](../PARITY-DELIVERY.md). See [SOURCE-ARCHIVE.md](SOURCE-ARCHIVE.md) for accepted overrides and remaining research coverage.

Date: 2026-10-08  
Scope: source-grounded implementation sequence for the gaps in [`lagos-life-source-audit-2026-10-08.md`](./lagos-life-source-audit-2026-10-08.md).  
Evidence level: planning document. It does not claim that a feature is shipped, deployed, or at production parity.

The plan keeps guest-first entry, lazy feature loading, server authority for durable state, and the standalone Allworld product boundary. Each milestone ends with a runnable local proof before the next milestone starts. Do not add a large feature batch to the first download.

## Guardrails for every milestone

- Preserve guest entry through character setup, city arrival, and later account claim.
- Keep durable commands behind the existing action and receipt boundary. Use stable operation IDs for retries.
- Keep city, venue, home, social, wallet, and business state scoped by identity and city.
- Keep Goalmatic commerce separate from simulated cash. Do not use real-money gambling, cash-out, deposits, or provider balances as game mechanics.
- Keep explicit sexual scenes, forced player-loss crime, and real-money gambling or cashout outside automatic parity work. These are recorded product decisions, not approved implementation requirements. Consider bounded, consensual fictional alternatives separately.
- Use the existing lazy panel registration for new phone surfaces. The initial compressed JavaScript must not grow for features that are not needed during entry.
- Treat the following as targets until measured: no more than 5% regression in cold-ready time, p95 frame time at or below 33.3 ms on the baseline mobile device, bounded room fan-out, no polling or rendering while a panel is hidden, 50 messages per history page, and on-demand media loading.

## P0: preserve a reliable playable base

P0 removes the failure modes that would invalidate every later feature. It owns persistence, login, reconnect, map access, HUD density, and mobile heat before richer content is added.

### P0.1 Make identity and life recovery explicit

Use the existing account and character routes, `server/life-service.ts`, action receipts, `server/routes/once.ts`, and the reconnect state in `src/reconnect.ts`.

Add a single client recovery state model with these states: `ready`, `offline`, `reconnecting`, `storage-unavailable`, `life-recovery-required`, and `account-choice`. Keep the state separate from the venue socket state. A connected socket does not prove that life data is current.

Acceptance criteria:

- A guest can reload during onboarding and continue the same draft.
- A signed-in player can restore the active character and choose a parked character without duplicating a life.
- A lost response can be retried with the same operation ID and produces one durable outcome.
- Invalid or unavailable wallet data fails closed with a recovery action and does not invent cash.
- The UI explains when a room is live but the life is read-only.

Runtime proof:

1. Start as a guest, interrupt the network during onboarding, reconnect, and confirm that the same guest life returns.
2. Sign in, park or restore a character, refresh, and compare public ID, city, wallet, house, and pending action.
3. Repeat one money command after dropping its response and confirm one ledger entry and one receipt.
4. Force the storage-unavailable path and confirm that the player can recover without a second charge.

Keep the existing automatic-work toggle in this persistence proof. A disabled toggle, one daily commute, a cancelled commute, and a reload must restore the same career state.

### P0.2 Make map and city gates truthful

Keep `src/game/cities/registry.ts` as the city authority. Separate catalogue previews from playable city modules. Make map links, airport boards, coach links, and travel actions use the same `playableCityIds()` gate.

Acceptance criteria:

- Lagos opens a playable life.
- Ibadan remains compatible with stored-life behavior until its city state is deliberately opened.
- Abuja, Port Harcourt, Delta, Benin City, Lokoja, and Okene show a clear preview or unavailable state with no accidental life creation.
- Relocation stores an away residence and never creates a second active life for the same city.
- A closed destination cannot be reached through a direct action, a map link, an airport board, or a saved pending trip.

Runtime proof:

- Walk the world-to-city-to-venue path for Lagos.
- Open every listed future city from the map and confirm the same closed response.
- Relocate a life, reload during the trip, and confirm one arrival and one away residence.

### P0.3 Reduce HUD and mobile heat

Add a persisted HUD density state with `expanded`, `compact`, and `minimal` modes. Keep needs, connection, and the current action discoverable in every mode. Put coach text, notices, and secondary actions behind the compact surface.

Use the existing touch controls, responsive phone shell, lazy panel registration, scene detail tiers, and `deploy/frame-budget.ts` as the integration seams.

Acceptance criteria:

- A player can collapse the HUD on a small screen without losing movement, phone, needs, connection, or active-action controls.
- Hidden phone panels unregister listeners and do not poll.
- Hidden scenes stop their render loop and audio work.
- Cold-ready time stays within the 5% target against a recorded baseline.
- p95 frame time stays at or below the 33.3 ms target on the baseline mobile device during entry, a venue, and a crowded room.

Runtime proof:

- Capture cold-ready time with the default entry path before and after the change.
- Run a 360×740 and baseline-device pass through entry, map, venue, home, and phone.
- Record frame time, draw calls, triangles, render-loop state, polling state, memory warnings, and horizontal overflow.

## P1: complete reliable social communication

P1 builds on `src/types/social.ts`, `server/routes/social.ts`, `server/social/service.ts`, `server/ws/rooms.ts`, `MessagesApp.vue`, and the existing outbox.

### P1.1 Stabilize conversations and privacy

Add clear-conversation and delete-for-self operations with a separate server record for per-user visibility. Keep deletion for everyone as an explicit, time-limited operation with an audit-safe tombstone. Add typing state, DM consent, read-receipt visibility, mark-all-read, message highlighting, and conversation search.

Keep history pages at 50 messages. Keep room chat transient and direct/group/house messages durable. Add bounded group size and mention limits rather than copying an external app's limits without product review.

Acceptance criteria:

- A player can clear a conversation locally without deleting the other member's history.
- A sender can delete an eligible message for everyone and both views show the same tombstone.
- A recipient can disable typing and read receipts without exposing that preference.
- A new DM follows the consent rule and gives a clear refusal path.
- Mark-all-read updates Chats and Updates once and survives reload.
- Search returns only conversations and message pages the current player may read.

Runtime proof:

- Use two accounts to exercise consent, typing, receipt privacy, clear, delete, search, group mentions, and mark-all-read.
- Disconnect one account during each mutation and retry the same operation ID.
- Confirm blocked or muted players receive neither hidden presence nor deleted content.

### P1.2 Add media and richer message actions

Extend the message boundary with typed attachments, reply references, reactions, forwarding references, stickers, and voice-note metadata. Store media outside the message row, load it on demand, and expire view-once media after an authorized read. Never place raw provider URLs or unbounded blobs in the durable social record.

Acceptance criteria:

- Hold-to-record creates a bounded voice note with cancellation and retry.
- Photos and video show a thumbnail first, load on demand, and respect access checks.
- View-once media expires for the recipient after the authorized view.
- Reply, reaction, forward, sticker, and attachment actions remain idempotent.
- Gallery saving is an explicit device action and is never claimed as server storage.

Runtime proof:

- Exercise upload, retry, access denial, view-once expiry, forward, reply, reaction, and deletion across two devices.
- Measure the entry bundle to confirm media code is lazy.
- Check that a 50-message page with attachments does not render or fetch media until visible.

## P2: deepen home and embodiment

P2 uses `src/game/systems/home.ts`, `home-layout.ts`, `BuyMode.vue`, `src/game/content/furniture.ts`, `src/scene/movement.ts`, `avatar-rig.ts`, `lookModel.ts`, and the scene camera contracts.

### P2.1 Make homes persistent, editable, and legible

Add per-item color and light controls, drag placement across valid back and side walls, persistent sit and lie anchors, and a contextual action catalogue for sleep, TV, dates, gym, and cooking. Keep server validation authoritative and preserve furniture on rental moves and own-plot upgrades.

Acceptance criteria:

- A player can drag every wall item to each valid wall slot, rotate it, reload, and see the same placement.
- A player can change a supported furniture color or light setting and see the price before committing.
- Sit and lie actions preserve the pose after an interruption and stop cleanly.
- Contextual actions expose their needs, duration, skill gates, and cancellation rules before start.
- Shared-home access never grants ownership of another player's furniture.

Runtime proof:

- Fill a small room with floor and wall objects, rotate and drag them, reload, and compare the saved layout.
- Interrupt sleep, TV, date, gym, and cooking actions at start, mid-progress, and completion.
- Measure scene frame time with the room full and the camera moving around walls.

Add contextual room placement for a misplaced bathtub, kitchen item, or bedroom item only when the destination room and free slot are known. Do not silently move an item across rooms.

### P2.2 Improve avatar, wardrobe, camera, pets, and transport presentation

Keep the procedural avatar and wardrobe as the low-detail path. Add contextual outfits, profile-image support only after the media/privacy contract is ready, apartment camera rotation and zoom, moving pets, visible parking, tap-to-switch cars, test drives, garage limits, and a net-worth view.

Acceptance criteria:

- Existing saved looks still render at low, medium, and high detail.
- A player can change display name and supported outfit fields without losing the guest or account identity.
- Apartment camera rotation and zoom restore to a safe default on reload.
- Owned cars show the selected car, fuel, resale, and parking state without changing game cash twice.
- Test drives never create ownership and a garage limit is enforced server-side.

Runtime proof:

- Load legacy and current looks in creator, home, venue, and crowd scenes.
- Exercise camera controls and car purchase, selection, test drive, sale, and reload.
- Run the mobile frame budget with the apartment, avatar, pet, and visible car together.

Treat pets as persistent home entities with bounded movement, care, and disposal. Keep the first pet release to dog, cat, and parrot assets. Voice learning remains a later media decision.

Treat generator and inverter furniture as power sources. Add NEPA outages only as a city event with explicit start, end, affected powered items, fuel rules, and recovery. The announcement is not proof that the current source has an outage simulation.

## P3: build a safe work and commerce layer

P3 keeps the existing real-world commerce channel separate from game cash. It uses `server/business/`, `src/app/features/business/`, `src/types/business.ts`, the career system, and a new game-only work contract.

### P3.1 Add player-run companies and in-game shops

Create an in-game company model with an area, staff roster, kiosk-to-plaza upgrades, simulated products, and simulated earnings. Keep the existing `My Store` flow as a separate real-product storefront. Never mix real orders, provider settlements, or Goalmatic credits with simulated cash.

Acceptance criteria:

- A player can create a game company, choose an area, hire bounded NPC or player staff, upgrade its footprint, and collect only simulated earnings.
- Staff wages and company inventory settle through one durable command.
- A real-world store remains provider-owned and opens only through the existing account and commerce gates.
- A player cannot use game money to pay a provider or use provider funds to buy game assets.

Runtime proof:

- Run two game companies in one city and confirm ownership, staff, area, and earnings isolation.
- Disconnect during hire, upgrade, and settlement and retry each operation.
- Run the real-store local contract separately and confirm game cash is unchanged.

### P3.2 Add escrow gigs and professional work

Introduce a game-only Hustle contract: brief, quote, escrow, work stages, client approval, rating, dispute, and payout. Add lawyer/client/provider search only inside a bounded in-game directory. Add decorator drafts with preview and acceptance.

Acceptance criteria:

- Escrow holds simulated funds and cannot debit the client or pay the worker twice.
- A client can accept, reject, or dispute a deliverable with bounded evidence.
- Ratings cannot be changed by an unauthorized player.
- Decorator previews do not mutate the home until acceptance.

Runtime proof:

- Complete accepted, rejected, disputed, expired, and retried contracts with two accounts.
- Verify escrow conservation and one payout receipt after forced response loss.

## P4: expand cities, transport, and academic career progression

P4 uses the city registry, `src/game/cities/*`, `src/game/systems/travel.ts`, campus types and routes, career ladders, and table venues.

### P4.1 Open city modules in small releases

Build each city as a separately validated module. Start with Abuja and Port Harcourt because they already have registry previews and transport hubs. Add Delta, Benin City, Lokoja, and Okene only after each has sourced districts, venues, roads, housing, travel links, and a clear open gate.

Acceptance criteria:

- Each city has its own content hash, venue registry, housing, travel modes, NPCs, and save migration.
- A closed city cannot be entered through stale links or pending trips.
- An active character keeps its prior city residence when travelling.
- City-specific radio, ads, elections, tables, and social presence never leak across city scopes.

Runtime proof:

- Run a fresh guest and a returning life through each city’s entry, travel, home, venue, and reconnect path.
- Exercise a city change during an active action and confirm one final state.

### P4.2 Complete travel and vehicle loops

Add scheduled flight and coach services after destination modules open. Add shared rides, seat reservations, fare splits, car fuel tanks, repairs, mechanic jobs, visible parking, and limited test drives. Keep routes server-timed and city-scoped.

Acceptance criteria:

- Flight, coach, shared ride, and private car paths show fare, duration, destination gate, cancellation rule, and arrival venue.
- Fuel and repair charges are idempotent and never create a negative wallet.
- A shared ride cannot expose another passenger's private state.

### P4.3 Finish campus and career links

Complete lectures, night catch-up, assignments, exams, CGPA, hostel, SUG elections, strikes, graduation, and an explicit degree-to-career modifier. Keep TDB and strike behavior in one campus domain model rather than scattered career checks.

Reconcile the career catalogue before adding tracks. Compare the current fourteen tracks with the announced Doctor, Civil Service, Broadcasting, Real Estate, Aviation, and Product Manager tracks, then add only tracks with workplaces, skills, pay, schedule, and city content. Treat announced pay increases as unverified until the economy simulation and weekly-bill affordability check pass.

Acceptance criteria:

- A student can enter, matriculate, attend, defer, fail, pass, graduate, and leave without losing hostel or ledger consistency.
- One closed semester produces one CGPA and one degree outcome.
- SUG ballots are student-only, city-scoped, and one-vote-per-term.
- A degree changes only the documented career tracks and never grants an unearned promotion.

## P5: model households, family, and care

P5 uses social relationships, home ownership, economy billing, family calls, needs, and the home action engine.

### P5.1 Add family growth and household relationships

Add consensual partnership, weddings, household membership, baby lifecycle, kinship links, cohabitation, rent split, shared furniture permissions, and group house-party invites. Keep the current family NPC call loop as the fallback for players who do not join a household.

Acceptance criteria:

- Household membership requires consent from every affected player.
- Rent, furniture, invitations, and chat permissions resolve from one household record.
- A baby has bounded state, care actions, growth stages, and rename authorization.
- Leaving a household preserves each player’s own life, wallet, and inventory.

### P5.2 Add household staff and care services

Add helper, chef, driver, guard, nanny, wellness group, one-to-one sessions, journal entries, breathing exercises, skill-gated cooking, and needs effects. Model weekly wages and service schedules as durable household actions.

Acceptance criteria:

- Staff roles have explicit wages, schedules, effects, and cancellation rules.
- A service cannot run when the household cannot pay or when its target is absent.
- Journal and wellness content remains private to the owner and authorized provider.
- Care effects settle once after reconnect and never exceed configured bounds.

Add a collapse threshold to health only after the existing sickness, hospital, and recovery flow has a measured user path. A collapse must be reversible, bounded, and idempotent. The hospital bill must appear in the statement with its cause.

## P6: build social publishing, events, and governance

P6 uses social storage, civic routes, calendar events, radio, moderation, venues, and the existing growth mission surface.

### P6.1 Add the Gist feed and creator media

Add posts with latest, trending, and following views; location and car tags; likes, comments, mentions, groups, artist attribution, uploads, and on-demand media. Reuse the moderation boundary and the P1 attachment contract. Keep feed pagination bounded.

Acceptance criteria:

- Feed results are scoped by visibility, block state, city, and following relationship.
- Ranking is deterministic for the same snapshot and has bounded fan-out.
- Mentions and group notifications respect consent and group membership.
- Artist uploads retain attribution and a safe external link policy.

Runtime proof:

- Publish, edit, delete, report, block, mention, like, comment, and media posts across two accounts.
- Confirm a blocked player cannot infer private posts or mentions.
- Measure feed read volume and render time on a 50-item page.

### P6.2 Add scheduled public events

Add stadium fixtures, chants, scores, concert tickets, club rounds, VIP broadcasts, Owambe and Mosque rituals, investor pitches, and mission hooks through one calendar/event registry. Keep event state city-scoped and server-timed.

Acceptance criteria:

- An event has a schedule, venue, capacity, ticket or free-entry rule, start, end, result, and replay-safe settlement.
- A cancelled event refunds simulated tickets once.
- A club round and a concert do not become gambling or real-money cash-out paths.
- Missions can point to events without creating duplicate rewards.

### P6.3 Add governance and lawful justice

Extend the current Governor election to a deliberately scoped national model with one race at a time, ballot links, commissioners, policy choices, and campaign-manager roles. Add court cases and hearings as non-violent, consent-safe civic work. Keep robbery, forced player loss, jailbreak, and copied real-world enforcement mechanics out of the default product.

Acceptance criteria:

- Every race has one authority, one ballot, one result, and one city or national scope.
- Policy changes have a start, end, affected systems, and audit record.
- Court actions cannot remove player assets without explicit product approval and a reversible appeal path.

## P7: add optional economy and creative systems after the base is stable

P7 is intentionally last. It uses the property, economy, civic ads, radio, business, and event seams only after P0–P6 have stable persistence and measured budgets.

### P7.1 Add optional property and market systems

Add property auctions, gifting, co-ownership, landlord investment homes, tenant contracts, land growth, tax brackets, weekly statements, hosting fees, bail as a reversible civic fee, and trailer or sponsor earnings. Keep all values simulated and bounded.

Acceptance criteria:

- Ownership changes have one durable transaction, a visible counterparty, and an undo or dispute policy.
- Tax, rent, wages, and hosting fees produce statements with source and period.
- Auctions close server-side, reject stale bids, and cannot create negative cash.
- Co-owned property has explicit voting, maintenance, exit, and recovery rules.

Add haulage trailers as simulated assets with a purchase cost, daily settlement, driver share, breakdown state, repair action, and one receipt per day. Reuse the existing city-scoped Rich List and its privacy preference for cash and weekly earnings. If product wants an opt-in default, change that preference deliberately rather than creating a second list. Do not use the rich list as a real financial ranking.

### P7.2 Add fictional markets and creative advertising

Add fictional stocks, a refinery or industrial economy, richer billboard and sea-plot creatives, sponsor slots, branded phone partners, stats dashboards, and radio artist global slots only as simulated, moderated systems. Keep picture uploads, links, and audio on-demand.

Acceptance criteria:

- Fictional market prices are clearly separated from real money, provider funds, and financial advice.
- Ads have moderation, expiry, ownership, removal, and reporting paths.
- Sponsor and partner integrations cannot access private player data without an explicit capability.
- Creative media is lazy, bounded, and removable.

## Specific requests to retain within the milestones

These are implementation requirements for the proposed plan, not claims that the current source has them. Reconfirm the source before starting each item.

| Milestone | Required detail | Acceptance evidence |
|---|---|---|
| P0.1 | Recovery for claimed guests, email and federated accounts; account deletion and username-change discovery | Recover the same life across two devices without exact-balance or signup-date guessing. Account deletion is a separate deliberate user action. Keep stable internal IDs when display handles change. |
| P0.2 | Map search and city-specific location tabs | Search a venue by name, filter by city, and arrive in the correctly named destination. Do not reuse Lagos venue labels in other cities. |
| P0.3 | Phone app ordering, unobstructed work tasks, update visibility | Reach every phone app and interactive work control at mobile size. Show an available update without interrupting a durable action or repeatedly prompting. |
| P1.1 | DM requests, pin/unread filters, mark-all-read, separate Groups filter | A nonfriend cannot bypass the selected contact rule. List operations remain fast with 100 conversations and do not lose unread state. |
| P1.1 | House-chat history visibility | A newly admitted visitor cannot read messages from before their permitted membership window. Re-entry and household membership have explicit retention rules. |
| P1.1 | Transfer confirmation/PIN request | First decide whether reauthentication is warranted for simulated transfers. Always show the actual recipient, amount, fee, limit, and authoritative final receipt. Do not build a second weak credential store. |
| P1.2 | Voice/video distinction and profile pictures | Reuse existing voice calls and proximity audio. Add video only as a separate optional media feature. Moderate and resize profile pictures; never download them on the entry path. |
| P2.1 | Wardrobe, decor variants, lighting, wall placement and preview | Try an item or finish before paying; changing back to an owned finish costs nothing. Display owned inventory clearly. Lamps, TV orientation, seats and bath poses match their visible objects. |
| P2.2 | Style presets, local dances, photo mode and travel memories | Save outfit presets; verify purchased hair/shoes visibly change the avatar. Capture an in-game photo and optionally tag its fictional location. Bound animation and image costs. |
| P3.1 | Bulk restock, reduce stock, and accurate availability | A batch transaction reports per-item outcome and is safe to retry. A stocked public shop appears on the directory/map and never says sold out merely because a stale client snapshot was loaded. |
| P3.1 | Branch management and business categories | Sell or close one branch without deleting the entire company. Add farming/livestock, bookstore, construction, hospitality and other catalogue entries only with a complete production/sales loop. |
| P3.2 | Worker search, portfolios, direct offers and rehiring | Find by profession or player name, inspect relevant work, send a scoped offer from chat, and rehire a completed worker without reposting a public job. |
| P3.2 | Decorator permissions and uninterrupted chat | Owner grants expiring room-edit permission with a spending limit. Decorator can work while the owner is away and chat without leaving the draft. Preview references an inventory/layout revision; rejection changes neither the live layout nor the wallet. |
| P4.1 | Remaining requested places | Track Abuja, Port Harcourt, Ibadan, Benin, Enugu, Warri/Delta, Lokoja, Okene, Ilorin and Imo as distinct research/content items. Reconcile other active city work before creating duplicates. LASU and other universities need their own playable module scope. |
| P4.2 | Fuel, repair, garages, shared rides and temporary lodging | Fuel decreases with the chosen trip rule, refilling has a visible receipt, passengers consent to travel, and an away-city stay preserves the home and inventory in the origin city. |
| P4.3 | Faster progression without inconsistent multiplayer clocks | Keep one authoritative shared clock. Tune activity and semester duration independently; do not let one player's sleep skip another player's event or payment. Existing 40-second career shifts already differ from the competitor complaint about hour-long waits. |
| P4.3 | Repeatable missions, dream changes and profession gates | Reuse current daily/weekly missions. Add varied skill challenges and reversible dream selection with no reward duplication. Changing a goal must not reset earned progress silently. |
| P5.1 | Couples actions, shared home use, wedding funding and separation | Both participants accept synchronized actions. Define shared costs and ownership. Baby rename, kinship, separation and optional custody/child-support mechanics need explicit, bounded game rules before implementation. |
| P5.2 | Staff that perform visible useful work | A hired chef accepts an actual meal choice; helpers respond to bounded dirt/maintenance state. Staff are neither decorative props nor unbounded per-frame simulations. |
| P6.1 | Feed moderation, live voice and media requests | Reuse actual voice transport. Paginate the feed; apply block/report and moderation rules to edits and attachments. Do not imply end-to-end encryption unless the transport and storage actually provide it. |
| P6.2 | Actual visitor games, tournaments and stadium play | Reuse Whot/Ayo/Ludo. Add snooker, tic-tac-toe or football as separately playable modes with rules, matchmaking, reconnect and results. Brackets, spectating and ticketing must have bounded room sizes and lazy assets. |
| P6.2 | Club music, artist slots, celebration visibility and notification controls | Provide licensed/authorized audio, opt-in playback, artist rotation and mute controls. A buyer sees their own acknowledged celebration; nearby users receive one bounded event. |
| P6.3 | Useful public offices and professional justice | A governor can perform documented policy actions. One-race eligibility, ballot search, election notices, campaign roles, lawyer selection and case-outcome notifications each have an observable outcome. Do not conflate player-abuse reporting with fictional police gameplay. |
| P7.1 | Loans, collateral, savings groups, market resale and taxation | Model simulated principal, repayment, default, collateral consent, valuations and receipts. Distinguish purchase cost, current value, sale proceeds, stake, gross return and net profit. Simulate affordability and both sides of the transfer-limit debate before setting values. |
| P7.1 | Optional fictional casino variants | If selected, build slots, blackjack, video poker and Hold'em behind lazy game modules with server-authoritative randomness, explicit rules, bounded play-currency stakes and verifiable settlement. No cashout or provider-money connection. Casino play is not required to access ordinary social features. |
| P7.2 | Artist/advertiser tooling, help search and sponsored utilities | Reuse billboard/sea-plot source. Add moderation, expiry, campaign reporting and creative loading limits. Begin Ask/help with searchable maintained guidance; an AI service is a separate provider/credential decision. |
| Product decision | Offline mode, external integrations, aggressive crime, adult content, real cash rewards | Preserve each request in the research catalogue. Define scope and costs before accepting it. Offline drafting/local activities cannot mutate a server-authoritative shared economy without reconciliation. |

## Runtime proof checklist

Use this checklist at every milestone. Record the exact local build, source revision, device viewport, account type, city, and feature flag.

- Entry: guest setup, account claim, reload, offline start, reconnect, and city gate.
- Persistence: one operation ID, response loss, retry, reload, and ledger or state comparison.
- Social: two accounts, block, mute, consent, group membership, room bounds, and hidden-panel cleanup.
- Home: placement, color, light, pose, furniture permissions, household leave, and reload.
- Travel: fare, duration, cancellation, destination gate, vehicle fuel, shared ride, and arrival.
- Campus: admission, lecture, exam, hostel, election, graduation, and career modifier.
- Events: schedule, join, capacity, cancellation, reward, ticket refund, and mission trigger.
- Economy: tax, rent, wage, escrow, auction, ownership, statement, and negative-balance refusal.
- Mobile: cold-ready time, p95 frame time, draw calls, triangles, memory, horizontal overflow, hidden polling, hidden rendering, and media fetches.
- Release boundary: source, local preview, private test, candidate, approval, provider delivery, and live production remain separate evidence states.

## Delivery order and stop conditions

Deliver one milestone at a time. A milestone is complete only when its source change, runtime proof, state migration, and rollback path are reviewed.

Stop the next milestone when any of these conditions appears:

- guest entry or account restore regresses;
- a retry can duplicate money, ownership, a reward, or a message;
- a city or room leaks state across scope;
- hidden panels poll or render;
- the cold-ready or mobile frame target regresses beyond its target;
- the feature needs real-money gambling, cash-out, explicit sexual content, or forced player loss.

The audit remains the source inventory. This plan is a sequence for implementation and proof, not a claim that any planned work has begun or shipped.
