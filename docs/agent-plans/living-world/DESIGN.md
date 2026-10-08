# Living-world design

All new records, states and interfaces in this file are proposals. Adapt their names to the current domain after the [baseline audit](BASELINE.md); avoid parallel implementations of existing mechanisms.

## One connected first journey

A new player enters a small district with a school, rental desk, shop and barber. Training and initial practice remain available with zero money. The player completes a short driving lesson, demonstrates steering/braking on a mapped route, passes a server-verified assessment and receives a visibly simulated licence. They take a permitted starter rental, collect a sealed restocking parcel from an NPC supplier depot, drive to the district shop and complete delivery. The shop receives the declared stock once and the player receives the agreed reward once. The player then learns a barber skill with an NPC, previews a style for a consenting customer, applies the approved choice and receives payment. They spend part of these earnings on a modest barber tool upgrade that unlocks one additional NPC practice style from the approved appearance catalogue. After reload or reconnect, qualifications, stock, earnings, customer appearance, owned upgrade, newly available style and mission progress agree.

Use NPC instructors, customers and dispatchers whenever humans are absent. Human participation changes who plays a role, not the transaction rules. A player can pause a lesson or decline a service without losing access to basic play. Offer clear recovery after a failed assessment, a disconnected customer or an abandoned delivery.

The world should explain the next action through the person, place or object involved. Show one useful next step, a reason when blocked, and an affordable alternative. Use keyboard and touch controls, readable mobile panels, reduced-motion support where appropriate, and feedback that does not depend only on colour or sound.

## Distinct domains

| Domain | Meaning | Must not imply |
| --- | --- | --- |
| Skill | Practised capability, with evidence and bounded progression | A licence, job, asset or civic vote |
| Qualification | Versioned in-game assessment result and permitted activities | A real professional credential or permanent permission to act on another player |
| Ownership | A saved asset or business interest | Permission to drive, operate every profession, or claim a real building |
| Permission | A revocable, scoped grant to use a vehicle, chair, shop or other person's appearance | Transfer of ownership or access beyond that operation |
| Reputation | Evidence-based record of completed interactions, with abuse controls | A universal social-credit score, moderation power or automatic civic eligibility |
| Civic eligibility | Explicit rules for candidacy, voting and role duration | Access to personal data, real funds, bans or operator tools |

Represent assessments and grants explicitly, including actor, scope, version, current status and relevant expiry. Preserve old saves with additive defaults and tested migrations. Domain outcomes should emit existing registry events that missions observe; mission progress must not call a second payment path.

## Driving and delivery

Owning a car does not qualify the owner to drive. A qualified player may rent or borrow a vehicle with a current permission grant. Revalidate qualification, vehicle availability and authorization at departure and consequential actions. A revoked loan must bring the trip to a defined safe stopping/recovery state; it cannot leave a player trapped or let a stale client retain control indefinitely.

Practice includes actual steering, braking, stopping and following a mapped route. A licence is awarded from server-validated assessment evidence, not a browser “passed” flag. Use client prediction for responsiveness only if the server can reject impossible speed, position, route and completion claims. Agree the minimum collision/road/vehicle interface with world and graphics owners before implementation; placeholder geometry is acceptable for contract tests, not final driving acceptance.

A delivery contract proposes `offered → accepted → collected → delivered`, with explicit `cancelled`, `expired` and recovery outcomes. Persist parcel identity, origin/destination, eligible carrier, agreed reward, custody and version. Validate proximity against authoritative position and the mapped destination. A second carrier cannot claim the same parcel, and a second request ID cannot pay an already delivered contract again. Specify what happens if a shop closes, a destination disappears or a carrier disconnects. The launch NPC job has no unaffordable collateral requirement.

Stock reservation, parcel custody, debit/credit and terminal settlement must be atomic where they share a store. Across authorities, use an outbox and reconciled state machine; never simulate a distributed transaction with two best-effort calls. Reuse current ledger and transaction boundaries before adding a new store.

## Barber and shops

Barber progression starts with apprenticeship and NPC practice. A customer chooses or approves an exact style preview and disclosed simulated price. A service grant binds customer, barber, style/version, price and expiry. Revalidate it before committing appearance and payment. Revocation, departure or disconnect before commit cancels cleanly; a committed service has one durable result and a visible recovery/refund policy. Never let a client select an arbitrary appearance payload for someone else.

Persist the customer's chosen result through the existing appearance authority. The graphics owner defines available hairstyles, model compatibility and the preview/apply interface. The gameplay owner handles consent, qualifications, settlement and progression. Do not change shared avatar assets or renderer code without that ownership agreement.

Shops reuse existing Business content and records. Add only missing contracts for stock, orders, delivery, fulfilment and refunds. Reprice and check stock on the server; two buyers racing for the last item cannot both succeed. A refund returns the correct simulated value once and reconciles stock according to the item's state. Failed, cancelled and partial operations must leave cash and inventory explainable in the ledger and audit trail.

## Later professions and civic play

| Proposed system | Complete play loop | Boundaries and evidence |
| --- | --- | --- |
| Fictional medicine | Course → authored NPC cases → assessment → opt-in player illness scenario → recovery | Use fictional conditions and actions. No diagnosis, treatment instructions, real medical records or real qualification claims. A player can decline/revoke participation and retain basic play. |
| Fictional law | Study a versioned game rulebook → collect permitted in-game evidence → present a case → bounded judgment → appeal | Separate roleplay evidence from private chats and operator reports. Player judges cannot ban accounts, access private data, move real funds or alter platform rules. Use bounded outcomes, conflicts-of-interest checks, recorded reasons and a separate appeal path. |
| Politics | Explicit eligibility → candidacy/election → limited term → bounded simulated budget → approved public project → visible result | Audit existing civic/politics systems first. Budget changes are ledgered; vote/reward replay is blocked; office has no moderation powers. World owners approve physical project changes. |

Keep these as later accepted units. A profession requires meaningful decisions and outcomes, not just a title, button or timer. NPC counterparts keep each learning/service loop testable and playable at low population.

## Real places and businesses

Keep three independent identities: `Place` for geography, `BusinessProfile` for a merchant/branch, and `WorldObject` for its game representation. Link them with provenance and effective dates. Several businesses can occupy a building, and one business can have several branches or a private service area. Listing a real shop never conveys real or in-game land ownership.

Use opt-in claims. Track contact control, authority to manage the business, and location evidence as separate checks with their own status, reviewer and expiry. A reachable email or a Google listing alone proves neither management authority nor ownership. Support competing claims, branch transfers, suspension, appeal, correction and removal. Store private evidence with restricted access and a retention policy; publish only the verification meaning actually established.

Merchant profiles can hold approved website/Instagram links, opening hours, timezone, services/classes, catalogue/booking destinations and licensed media. Collect an explicit media licence or owner permission with scope; public availability of a photo is not reuse permission. Hide residential addresses for service-area businesses and expose only the area the owner agrees to publish. Revalidate edited links and ownership changes.

The pilot contains a curated set of profiles and merchant-controlled booking/storefront links. Show where the player is going and which provider owns the transaction. Do not promise availability or a confirmed booking from a link click. Real health and legal services are excluded from this MVP.

Later native bookings require resources, staff/class capacity, duration, buffers, business timezone, daylight-saving behavior, bounded reservation holds, cancellation/no-show terms, reminders with consent, and idempotent confirmation/refund. Define a single inventory authority and conflict resolution before displaying live availability. Show a final total, fulfilment/cancellation terms and a support route before commitment. Research and current professional review determine applicable obligations; this plan provides no compliance guarantee.

Payments are a separate activation phase through the existing owner-approved provider path. Real NGN amounts use integer minor units and an authoritative commerce ledger, separate from noncash simulated points and Goalmatic credits. Reconcile authenticated provider events and refunds; a browser return is not proof of payment. Split settlement does not establish escrow or justify describing funds as protected escrow.

## Maps and assets

For every imported road, building footprint, listing and image, record source URL/dataset, licence, version/date, permitted use, transformation and attribution. Use licensed/open data or owner-provided information appropriate to the custom 3D world. Google Places is not a source to scrape into a permanent custom world database. Retaining an allowed place identifier does not grant the right to retain its other content.

For OSM-derived data, evaluate ODbL attribution and share-alike obligations for the actual distributed database/product. Data licensing is separate from tile/geocoder capacity: choose a suitable provider or self-hosted/import pipeline when usage exceeds public-service policy. Preserve current Natural Earth/geoBoundaries provenance as well. The [research register](RESEARCH.md) links the exact policies and limits checked.

## Goalmatic interface and resilience

Discover the existing integration owner, API and identity model before creating an adapter or account flow. Reuse `server/commerce/goalmatic.ts` for commerce as agreed by that owner. A proposed goals/tasks capability needs its own verified contract; do not route it through commerce by resemblance or invent operation names.

Stable account/workspace linking, approved scopes, consent and revocation are gates for external activation. Send minimal consented identifiers and events; keep credentials and personal evidence server-side. Game events must not publish to an external workspace merely because a player is signed in. Revoke grants, stop queued delivery and clear unauthorized cached views on disconnect/account change.

An internal capability interface may expose status, select/link, export milestone, fetch changes and disconnect. These are proposed internal capabilities, not verified Goalmatic endpoint names, scopes or webhooks. The existing owner supplies provider transport and authentication. Bind a stable Allworld account, workspace, external record, journey and consent generation; never infer identity from matching nicknames or email text. Export minimal typed game observations, explicitly distinct from proof of real qualifications, income or completed real tasks. External completion does not mint a game reward by default.

An integration outbox should persist `eventId`, `schemaVersion`, `aggregateVersion`, `connectionId`, `consentGeneration`, purpose and intended destination with the committed game event. Delivery is at least once with deduplication, not exactly once across services. Consumers handle late/out-of-order events, conflict, backoff, expiry and dead letters. Reconcile an ambiguous provider create before retrying it. Recheck current consent before dispatch or reconciliation. Disconnect stops both reads and writes and cancels queued exports; reconnect creates a new consent generation without replaying old work. Give operators a way to inspect a redacted failure and retry safely. An unavailable provider leaves local game missions usable; show external data as unavailable/stale rather than fabricating success. Mock contracts prove local integration behavior only.

## Cross-cutting acceptance

All consequential transitions require current identity, membership/venue/consent checks, payload validation, bounded resources, durable idempotency and domain uniqueness. Test simultaneous requests, lost responses, restart, reconnect, late messages and revocation. Preserve the client's offline read-only behavior, server authority and existing account-generation guards.

Keep startup/download budgets unchanged unless an explicit reviewed change is approved. Lazy-load profession panels, audio and assets. Measure real mobile input and frame behavior on an agreed representative device; viewport emulation is not thermal or device-performance proof. Record limitations instead of upgrading a local result into a production claim.
