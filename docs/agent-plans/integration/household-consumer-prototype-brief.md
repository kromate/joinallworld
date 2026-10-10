# Household consumer prototypes — bounded design brief

Date: 10 October 2026. Disposition: **APPROVE this bounded design exploration for the existing household worker after its durable adapter obligations are met.** This is a source-informed specification for three later prototypes, not implemented UI, an evaluated prototype, database proof, residence activation, or permission to modify shared host files. No application, compiler, test, browser, screenshot, server, or additional worker was run for this brief. Public reference pages were read with the web tool; local inspection was read-only.

## Evidence and limits

The governing durable contract is the private reviewed allworld-durable-household-contract.md input, SHA-256 `30d64bf19fed4b11c910cbd02f48c4c652a07d93bd5e01e4dc7d4279284ebf63`. Identity architecture: the private reviewed allworld-household-identity-architecture.md input, SHA-256 `d041499a90c44f3ec8fe8b476af132c5ac1c0458b6e21e2f704c9ed7b499359c`. The prior adapter brief is the private reviewed allworld-household-durable-adapter-ports.md input, SHA-256 `a295e8d4ac4d5004ca00ac514db669e7071068e5bb654fe1260f1eb9dc4366df`; it is an integration proposal, not a shipped API.

Reviewed pure foundation `35731140a32da445b8bfd95075f79c0948010694` and corrected loader `619b8fbc7d1837d6225ce6eb0d0871739eb22d75` have these file hashes:

| File | SHA-256 |
|---|---|
| server/households/records.ts | d03bfcacd3d7b985fe0b907b63cb6f1ecde560e89bb560f0e1be199ce817b4b4 |
| server/households/consent.ts | 2bd7dbca14e5e934f30045562a55f077567f8691f6666bdd63daa0781c33730a |
| server/households/lifeIdentity.ts | 31e457f73c6047147089c33ea76a802bdb694ff4485dda4b10776903b7bc594d |
| server/households/consentView.ts | 78e4eb7e451b7082a8c69b2f95f86536df90bbe3d695fbe37661ab593b3340d8 |

Existing consumer inspection is pinned to `eec14690544a4646e4cd8a5ad280d61bbe2709ca`, not a later unreceived adapter. `FamilyApp.vue` explicitly says a Family invitation does not grant home access; `FamilyCommand` has role invite/answer/remove semantics. `HomeChip.vue` distinguishes temporary visiting from the owner home. `homeScene.ts` and `homeState.ts` drive owner editing and kitchen state. None is a durable household authority surface. `VisitHome.vue` offers temporary invitations and share links; those must remain separate from explicit durable invitations to an ordinary friend. The new work must not convert a visit, share link, Family role, or founder relationship into membership.

Consumer source hashes are recorded in the JSON companion. The governing frontend-design, web-design-guidelines, and principle-exhaust-the-design-space skills were read. Current [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) inform semantic controls, visible keyboard focus, labeled inputs, announced asynchronous status, accessible dialogs, reduced motion, safe-area spacing, and readable error states. The 48px minimum below is this brief's explicit requirement, not a claim about existing controls.

## Three primary reference patterns

| Reference | Useful pattern | Boundary for Allworld |
|---|---|---|
| [Google Home: manage people and permissions](https://support.google.com/googlehome/answer/9155535?hl=en) | Choose a specific home, review a recipient's permissions, accept an invitation, and expose separate leave/remove actions. | Borrow the named-home review. Do not borrow broad Admin privileges or equate a household with a family group. Our first permissions are fixed Sleep and Cook. |
| [Apple Home: share control](https://support.apple.com/en-us/102386) | Resident and guest invitations are distinct; permission changes, removal, and leaving belong to a named home. | Keep durable membership distinct from temporary visits. Do not copy accessory control, schedules, account requirements, or assume another permission system is revoked automatically. |
| [Airbnb: invite guests](https://www.airbnb.com/help/article/1175) and [remove guests](https://www.airbnb.com/help/article/3737) | Joining reveals defined trip information; leaving/removal has a clear consequence; invitations can cease to work. | Borrow a precise access preview and end-state explanation. Do not import link-based durable authority, reservations, checkout expiry, booking payments, or automatic social connections. |

These references do not establish original-home retention. That guarantee comes solely from Allworld's contract. Their commercial or device permissions are not Allworld requirements.

## Shared consent and navigation contract

Invitation review always names the owner, home, city, recipient, exact server expiry, and fixed permissions. Use: “Sleep and cook here using your own ingredients. Joining is free.” If the recipient has an original home: “Your home in [city] stays yours. Its existing costs continue.” Otherwise: “You do not have a home of your own yet. Joining does not create one.” Do not present permissions as editable switches when the implementation only supports a fixed set.

Only the addressed current life can accept or decline. The owner can invite an eligible ordinary friend and cancel a pending invitation; a member can leave; the owner can remove a member. The server must derive ordinary friendship from both explicit friend records and enforce blocks. `server/social/service.ts:866` distinguishes ordinary friendship from automatic founder friendship. This narrows any ambiguous generic-friends advice in the earlier adapter brief.

Acceptance does not enter, teleport, change title, select an owner's save, create a Family relationship, or replace the original home. A separate “Go to this home” action uses existing travel rules; entry occurs only after arrival in the same city and normal idle/door guards. A remote accepted home remains listed without promising immediate access. Owners being offline or away does not by itself revoke valid durable membership.

Keep three actions distinct: “Step outside” exits to the persisted local public anchor and retains membership; “Leave household” ends membership; “Walk to your home” uses the existing same-city journey. Cross-city return uses the existing route/fare or an explicitly reviewed eligible credit offer. Never label public egress “Returned home,” automatically purchase travel, take a loan, waive rent, or move the original home. No rent, contribution, owner inventory, title, furnishing, or home-edit controls are in this slice.

Membership and physical occupancy are different limits: 12 durable roster entries including the owner; at most 5 non-owner scene occupants under the existing combined visitor/resident rule. Pending invitations do not reserve a roster place. An entry refusal leaves membership intact. Do not render these numbers as beds or promise entry based on roster capacity. Generic coexistence refusals must not identify who blocked whom.

## Prototype A — Your homes, with a home detail page

Starting point: a dedicated “Your homes” view reached from Home. The primary object is a place. Use a compact original-home section, a list of accepted shared homes, and an invitation count. Original and shared home identities never merge. This is the strongest candidate for ongoing use across cities.

```text
Your homes                         Invitations 1
Your home · Ibadan                 Open details
------------------------------------------------
Shared homes
Ola's home · Lagos                 View home >
Member · Sleep and Cook
------------------------------------------------
[home detail]
Ola's home · Lagos
Your home in Ibadan stays yours.
Sleep · Cook with your own ingredients
[Plan journey]               [Leave household]
```

Owner flow: select the owned home → “Invite someone to share this home” → one eligible friend → review home/recipient/permissions/7-day invitation expiry → “Send invitation.” Keep temporary “Invite friends over” in a separate section with its existing duration. Pending rows show “Cancel invitation”; accepted rows show “Remove member,” with a named confirmation and public-egress consequence if needed.

Recipient flow: Invitations → named invitation → full permission/original-home review → Accept or Decline → accepted home detail. The accepted state says “You joined [home]. You have not travelled there.” Details offer the actual permitted journey or entry, followed by separate access-ending controls. After entry, the same detail page lists only server-permitted Sleep/Nap/Cook actions and “Step outside.” Owner actions never appear.

Visual emphasis: a simple two-place locator connecting the original and shared cities, with textual labels sufficient without color or a map. It illustrates retained homes, never a route quote. No decorative world map, card wall, or photo dependency. Tradeoff: one more navigation step from an invitation; best discoverability for multiple memberships and original-home retention.

## Prototype B — Invitation review and a persistent access record

Starting point: an inbox item opens a full-height review. The primary object is the consent decision and its durable result. Three visible sections are Home, Your access, and Your own home; they are all visible before acceptance, not hidden across a long wizard.

```text
Home invitation                    Close
Ola invited you to share their home in Lagos.
Your access     Sleep · Cook with your ingredients
Your own home   Ibadan · kept, existing costs continue
Invitation ends [local date/time]
[Decline]                       [Accept invitation]
------------------------------------------------
Joined [date/time]               Current access: available
[View home and journey]          [Leave household]
```

Owner flow: one recipient picker → review sheet → sent record with expiry and Cancel. Recipient acceptance transforms the record into a membership detail with a receipt/status region. The receipt is historical; fresh current access appears separately. A replayed success cannot turn an ended membership green. The receipt retains only the minimal allowed data, not indefinite former home addresses or member details.

Daily access is reachable through “Shared homes” in Home, linking to the same record. A current access detail shows journey/entry and the permitted activities, so this alternative is not an inbox-only dead end. Leave/remove confirmation shows whose access ends and what happens if currently inside; it never describes leaving as selling or abandoning the original home.

Visual emphasis: a quiet permission summary with strong aligned labels and a distinct dated decision line. No fake legal signature, required consent checkbox repeating the Accept button, or account-style billing table. Tradeoff: best uncertainty/retry and consent comprehension; weaker place discovery and more text. Test whether people mistake a historical success receipt for current access.

## Prototype C — Doorway access sheet with an invitation preview

Starting point: the shared home's door or a remote “View shared home” link opens the same accessible sheet. The primary object is the boundary between the public world and the home. A small invitation preview reaches this sheet remotely; it never requires travel to consent.

```text
[public street / static fallback]
------------------------------------------------
Ola's home · Lagos
Invitation · ends [date/time]
Sleep and Cook · your ingredients
Your Ibadan home remains yours.
[Review and accept]             [Decline]
------------------------------------------------
[joined, at this door]          [inside]
[Enter home]                   [Sleep] [Cook]
                               [Step outside]
Access details >               Access details >
```

Owner flow starts at the owned home's access sheet: Share home → eligible friend → explicit review → Send. Recipient flow opens a preview sheet → review/accept → joined sheet. If remote, “Plan journey” replaces Enter; if nearby but busy, show the specific ordinary guard and an enabled way to return to the current activity. A membership badge must not imply presence. Inside, keep Step outside permanently reachable; put Leave household in Access details so routine exit is not an accidental termination. Removal/end-state replaces unavailable activities with a clear status and lawful egress; it does not strand a disabled screen.

The sheet must work as plain DOM without WebGL and without loading the owner's private game state. Door/scene art is supplementary. Use a text heading and location when the canvas cannot render. Visual emphasis: one restrained threshold illustration and a stable bottom action area, not a new 3D home editor. Tradeoff: clearest entry/use/exit distinction and shortest daily path; hardest remote discoverability, accessibility, scene integration, and stale-context handling.

## Shared visual and interaction specification

Prototype tokens: paper `#F7F9FC`, ink `#172534`, muted ink `#536377`, line `#CBD5E1`, action blue `#1657B8`, danger `#A82335`. These are candidate tokens, not verified contrast results; check actual adjacent pairs before delivery. Use the existing locally available application sans stack; headings 22/28 medium, body 16/24 regular, metadata 14/20, tabular numerals only for costs/times. No new font download or asset dependency. Layout uses 8px spacing with 16px mobile gutters and a readable desktop column, not full-width stretched forms.

Every interactive target, including close, checkbox label, icon, row, and retry, has a minimum 48×48 CSS-pixel hit area. Support 320px and 390px widths, 200% text zoom, wrapped long names, safe-area padding, and an on-screen keyboard without hiding the selected input or final actions. No fixed-height text truncation for identity, price, permission, or error information. Distinguish destructive actions with words as well as color.

Use native buttons and labeled inputs; visible focus; logical reading order; dialogs with named headings, trapped focus while open, inert background, Escape dismissal, and focus returned to the trigger. Closing during a sent request does not mean the command was cancelled. Resume its status on reopening. On invalidation, move focus to the new status heading rather than a removed action. Announce command results politely; errors are adjacent and associated with the relevant field. Do not auto-focus a mobile search field on opening. User-triggered transitions only; reduced-motion preference removes movement. No hover-only information or countdown announcement every second.

## Required states, prices, expiry, and recovery in all three

| Situation | Required behavior |
|---|---|
| Offline before sending | Last-known information is labeled with its retrieval time. Accept/invite/enter/use are unavailable; explain reconnection. No background mutation queue or automatic acceptance on reconnect. |
| Sent, reply unknown | Show “Checking whether this completed.” Preserve the exact intent ID and fingerprint. Recheck/retry the same intent within the supported retention window; never create a second intent merely because the first timed out. Navigation may close the sheet without discarding status. |
| Receipt retained | Show its minimal terminal result, then fetch fresh access. Old success does not restore membership or repeat activity effects. After the supported 24-hour window, reconcile canonical state before offering a genuinely new action. |
| Expired/cancelled/changed invitation | Disable acceptance based on the fresh server result; show exact expired time or a privacy-safe unavailable message. Do not infer successful decline. The client timer is advisory; server time decides. Seven-day expiry applies to invitations, not membership. |
| Roster full or home pending full | Distinguish the relevant capacity without claiming a reserved place. Refresh; preserve a still-valid invitation. A new explicit attempt is a new intent only after the old result is known. |
| Scene full / coexistence refused | Membership remains. Show a generic entry refusal and return to the public world. Do not reveal another resident's block relationship. |
| Life, home epoch, selection or permission changes | Drop stale private projections and fence late callbacks, including A→B→A life switches. Ask for a fresh review when the binding changes; never retarget an invitation to the replacement home. |
| Forced removal while using a fixture | Use server activity settlement: Sleep stops accruing at invalidation; incomplete Cook follows the existing cancellation rule. No browser timer grants effects, debits, refunds, or completion. Show actual settled result and public egress. |
| Original home absent / onboarding required | Do not claim ownership or settlement. Acceptance and eligible use are distinct; explain the actual use gate and retain a safe public exit. |
| Money/resources | Invitation and joining cost zero. Existing original-home obligations continue. Show only actual personal recipe ingredients and supported action costs. Cross-city travel displays the existing confirmed quote; credit needs its separate explicit commitment. No rent payment, contribution, fabricated quote, auto grocery purchase, or owner fuel charge. |

When voluntary exit/end is blocked by an existing busy guard, explain Finish or Cancel using the actual activity contract. Forced revocation follows authoritative settlement and egress. Never use a generic close button as a hidden activity cancellation.

## API and type dependencies — proposed requirements, not delivered endpoints

The reviewed foundation defines consent operations and trusted reads; it does not provide the consumer HTTP projection, physical entry, action execution, or renderer. Route spelling below is illustrative. The existing remote adapter worker should settle the concrete schema against the real transaction framework before UI wiring. Do not build a client by casting a pure command into a trusted transaction view.

1. **Actor-scoped list/detail reads** (for example `GET /api/households` and invitation detail): server time, exact character/life binding, projection revision, invitations, memberships, named home/city, current home epoch, current original-home summary or explicit absence, and permission/entry availability. Return bounded collections and opaque server identifiers; GET must not mint identity or change life/home state. The owner list and recipient view require different privacy projections.
2. **Consent mutation input**: stable `clientId`, discriminated invite/accept/decline/cancel/leave/revoke action, target IDs, and explicit expected revisions/epoch. Invite selects one eligible friend and one owned home; server allocates consequential record IDs and trusted actor facts. Actor/life/home fields from the browser are expectations to compare, never authority. System-only commands are unavailable to this consumer. Server returns a typed refusal or a minimal receipt plus enough information to refresh the exact projection.
3. **Intent reconciliation**: retained strict-fingerprint receipt lookup/replay before loading current consent facts, scoped to the authenticated identity. The UI needs a way to distinguish known refusal, known success, unknown transport result, and no longer retained intent. A new endpoint is not mandatory if the existing command path supplies this safely. Do not expose another life's receipts.
4. **Access, arrival and egress projection**: current selected membership/home/epoch, exact city and idle eligibility, lawful journey option, physical presence separate from membership, available scene capacity, and an opaque validated public egress anchor. Entry/exit commands atomically revalidate these facts. Selection must not overwrite `estate.home` or swap the actor's save with an owner's snapshot.
5. **Narrow activity input and result**: a discriminated Sleep/Nap/Cook request with membership/home/epoch expectations, fixture ID and capability revision, and a recipe only for Cook. The server resolves `HomeUseContext`, actor-owned ingredients, lawful costs/duration, durable activity lease, start/cancel/settlement, and effective invalidation time. Return only permitted fixture actions and the member's result. No arbitrary `home.*` action forwarding or owner editing payload.

Suggested DTO names are `HouseholdConsumerView`, `InvitationView`, `MembershipView`, `SharedHomeAccessView`, `HouseholdCommandResult`, and `SharedHomeUseCommand`; these are requirements to define, not claims that exported types exist. Use the foundation's branded `CharacterId`/`LifeId` server-side and validated serialized IDs at the wire boundary. A projection should represent unavailable/not-loaded/absent distinctly internally; never invent a home, relationship, or permission to make a friendly screen render.

All supporting reads must join the real transaction's expectation/read set. Canonical actor/life and original-home provenance, epochs, social pair facts, roster and pending indexes, receipts, activity leases, and presence must agree at commit. No whole-save client writes. A canonical household detail alone cannot authorize Sleep or Cook. If physical access and member resource settlement are not implemented, label that stage “consent only” and keep shared-home-use completion open.

## Finite implementation boundary and comparison

The **same existing remote household worker** may later create three isolated prototypes under a newly allocated `proposals/household-consumer/` directory: a README, three entry views, shared styles, a typed fictional fixture/state driver, and a state matrix. No registered production navigation or extra runtime dependency is needed for the comparison. Use fictional people and homes, not live user data. All three run the same state corpus; fixture mutation is demonstration only. Do not call that durable proof.

After comparison, a separate explicit integration slice can allocate new `src/app/features/household/` components/store/types and the smallest Home entry-point change. Existing Family and temporary-visit commands remain separate. `HomeChip.vue`, home scene access, travel, social lifecycle, shared server types/routes/host options, and existing foundation files require coordinated allocation; they are not implicitly granted by this brief. Shared host files remain with the existing cloud integration writer. Do not duplicate that writer or change deployment flags, provider bindings, secrets, or money code.

| Criterion | A: home list | B: consent record | C: doorway |
|---|---|---|---|
| Main question answered | Which homes can I use? | What did I agree to, and what is true now? | May I enter/use/exit here? |
| Strongest moment | Multi-home selection and retained original home | Permission review and uncertain-request recovery | In-world daily use and safe exit |
| Main failure to test | Joining mistaken for moving | Old receipt mistaken for current access | Temporary visit or physical presence mistaken for membership |
| Integration burden | New list/detail and Home entry | Inbox/detail plus daily-access link | Scene/door integration plus equally functional DOM fallback |
| Remote/cross-city clarity | Naturally visible | Explicit after acceptance | Requires deliberate remote preview and journey state |

Recommended starting hypothesis: A for the durable home chooser, B's explicit review within it, and C's entry/exit behavior only after real physical-access APIs exist. Still implement and compare three distinct flows before selecting; do not present a blend as evidence that three prototypes were evaluated. Track task completion, incorrect beliefs about ownership/fees, accidental leave attempts, discovery of retry status, and keyboard completion. Do not invent measured scores or click counts.

The comparison corpus must include same-city and cross-city recipients, no original home, long names, owner offline, last roster place accepted elsewhere, scene full, offline before submit, reply lost after commit, expiry during review, original-life switch and A→B→A, home replacement, cancellation/removal, and mid-Sleep/mid-Cook invalidation. Require a user to distinguish Step outside from Leave household in every layout.

Actual delivery remains gated on cloud compiler/tests for exact pins; genuine Node and Worker durable transactions and reopen/replay evidence; simultaneous accept/capacity and revocation checks; original-home/receipt preservation; strict actor/life fencing; member-only action settlement; and native rendered mobile/keyboard/focus/offline journeys. Computed-state tests and mock prototypes do not prove DOM behavior, persistence, scene permission enforcement, or money safety. No score, license, home, wallet, or existing runtime actor reset is authorized.


Root independently matched all fourteen foundation/consumer source hashes. This brief is design exploration only; three actual rendered prototypes remain required. Actual successor f28182fe storage seams are under separate review, with no durable or public household activation accepted.
