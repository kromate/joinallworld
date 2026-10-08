# Allworld commerce: research and decisions before the spec

Follow-up: Anthony accepted the recommendations and authorized implementation, with earnings-only withdrawals and Paystack or BACH. The current specification, implementation and verification status is [COMMERCE.md](../COMMERCE.md). The remainder of this file preserves the research-stage evidence and questions.

Date: 7 October 2026. Status: research complete at the local-source and public-documentation level; product decisions pending. This is not an approved implementation spec. Anthony requested research first, questions next, and the spec and implementation plan after his answers.

## Requested outcome

Players can open businesses on land in Allworld, sell actual products and services, and receive real customer payments. Ordinary gameplay continues to show game money. Real purchases use a clearly identified Paystack checkout; business money remains separate from the simulated economy. Reuse Goalmatic's existing identity, Store Studio, Bookins and other relevant capabilities instead of rebuilding them in Allworld. Investigate automatic Goalmatic provisioning when a player creates an account.

The research interprets “all businesses in Nigeria” as broad business-type coverage with verified examples. An exhaustive company/branch directory would be a separate data programme. Allworld remains the standalone game in this checkout; this request does not authorize merging historical game repositories, changing source, deploying, making payments, contacting merchants or publishing a store.

## Evidence pack

- [Nigerian business landscape](nigeria-businesses.md): 30 business families, eight first-party examples, transaction models, category/provider constraints and directory limits.
- [Goalmatic App inventory](app-inventory.md): 14 discovered App directories, separate Omni Inbox, nine archived Apps, and reuse/defer decisions. Historical Allworld directories are not counted as independent integration features.
- [Platform contracts](platform-contracts.md): exact existing identity, commerce, booking, payment and billing operations; concrete source paths and missing capabilities.

## Findings that determine the design

| Need | Current evidence | Consequence |
| --- | --- | --- |
| Game money remains visible | Allworld HUD reads `state.cash`; wallet uses integer simulated naira | Keep this authority and its events separate from real financial records |
| Real product purchases | Core implements catalogue, quote, order, stock reservation, Paystack initialization, verification, refund and digital-download operations | Reuse this transaction boundary; build Allworld discovery and scoped access around it |
| Service appointments | Bookins/Core create confirmed appointments and report payment arranged with the owner | Paid appointments need a new relationship between time reservation, payment and confirmation |
| Seller real balance | Orders have payment/refund state; no App-facing settlement or withdrawal contract found | Sales totals are not a withdrawable wallet or proof of bank settlement |
| Automatic Goalmatic account | GM has native signup and personal-workspace creation, plus explicit App authorization | Allworld identity federation and desired onboarding cannot be assumed to exist |
| Existing merchant data | Store/Bookins resources belong to account-scoped installations | Link authorized existing installations where supported; do not duplicate their catalogues and orders into the game |
| All Goalmatic products | Some Apps are implemented; several commercial candidates are archived scaffolds | Offer relevant capabilities progressively; do not install or promise the entire catalogue automatically |

### Allworld source baseline

Target: `/Users/anthonyakpan/Desktop/JoinAllworld`, branch `main`, HEAD `f115424cab17535a063b406977927f1a5d2099c0` at initial inspection. Pre-existing changes: modified `CONTRIBUTING.md` and `package.json`; untracked `docs/EMBODIMENT.md`, `docs/REALISM-PLAN.md`, `docs/REALISM.md` and `tools/`. They were preserved. This research adds files only under this new documentation directory.

Directly inspected integration points:

- [Wallet authority](../../src/game/systems/wallet.ts) credits/debits game cash; [WalletSlice](../../src/types/life.ts) defines `cash`, `ledger` and `ledgerDays`. [HUD](../../src/app/features/hud/HudBar.vue) opens the simulated bank.
- [Economy](../../src/game/systems/economy.ts) implements simulated fixed deposits; it also contains rent/loan mechanics. These are not regulated real-money products and must not acquire a conversion path through commerce.
- [Account routes](../../server/routes/auth.ts) accept Firebase ID tokens. [Account service](../../server/accounts/service.ts) creates/binds accounts and preserves character state. This is not the Goalmatic installed-App session contract.
- [World registry](../../server/world/registry.ts) manages residents and house plots; [world routes](../../server/routes/world.ts) expose those locations. A residential plot is not yet a verified merchant tenancy.
- A targeted production-source search under `src`, `server` and `deploy` found no Goalmatic/Paystack checkout integration. No claim about deployed configuration is made.

## Proposed boundaries to resolve in the spec

Allworld owns the player, world location, business appearance and discovery. Goalmatic owns merchant authorization, account/installation bindings, product and booking records, provider connections and commerce execution. Paystack owns its payment processing and settlement reporting. Allworld may show an authorized financial view; it should not infer financial truth from browser state or game events.

There are three different units:

| Unit | Authority and presentation | No implied conversion |
| --- | --- | --- |
| Game cash | Existing game wallet; prominent HUD with clear game-money wording | No cash-out, bank settlement or game-interest conversion |
| Real commerce money | Server-authoritative order/refund and provider settlement records, in explicit fiat currency and minor units | No simulated wages, gifts, lotteries or deposits create real funds |
| Goalmatic credits | Central Goalmatic metering for optional billable tools | Not customer purchasing power or seller earnings |

A candidate real-money screen should distinguish sales, refunds, disputed amounts, pending settlement and paid-out amounts. “Available to withdraw” is inappropriate until an actual reviewed withdrawal capability exists. A buyer who pays each order at Paystack does not automatically need a stored-money wallet. We must settle that product decision first.

Proposed relationship, not an existing API/schema: an in-world business listing links a world location to the merchant's Goalmatic account and installation, plus an authorized public store or booking reference. Product data remains in its current installation. Public buyers receive only scoped catalogue/order access, never merchant tokens or private Table access. Native in-world purchasing needs a supported runtime bridge: the existing SB guest service uses signed grants and a trusted backend, and some customer-session operations are restricted to that backend. Simply calling those operations from a standalone browser is not sufficient.

Allworld's current player identity, Goalmatic's merchant/workspace identity, and Store's customer email-code sessions have different roles. Use verified subjects and supported authorization to connect them; do not merge by email or create a second identity behind the user's back. Automatic workspace/App provisioning should be idempotent, disclosed, scoped to selected business tools, and resumable after failure. Existing characters must survive linking or migration.

The likely product flow is: choose a business type and world location, establish merchant identity, connect/provision the selected business tools, configure actual offers and fulfillment, then activate real checkout. Browsing and styling can precede merchant verification; accepting real payments cannot rely on a fictional business or an unverified brand claim. Treat any existing public brand on the map as unclaimed until its owner is authorized.

## Reusable transaction path and missing work

The verified local Store path is:

`public catalogue -> server quote -> create pending order/reserve stock -> create Paystack checkout -> external payment -> signed webhook/provider verification -> paid order -> fulfillment/refund`

The Core implementation is in [commerce runtime](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/commerce/runtime.ts:839). Provider payment confirmation is not proof that a seller's bank was settled or the item was delivered.

Missing workstreams, whose scope and order depend on the answers below:

1. Identity and merchant provisioning: supported authorization from this standalone host, exact callback/domain registration, workspace ownership, account recovery, existing-user linking and installation lifecycle.
2. In-world business model: commercial location/tenancy rules, merchant claimant verification, public discovery, business type, service area and moderation.
3. Purchase integration: reuse Store operations, scoped shopper grants, return-to-world navigation, order history and server-authoritative pricing. Single-merchant orders are the provisional starting point.
4. Financial reporting: actual settlement reconciliation, refunds/disputes and evidence-backed balances. Managed splits/payouts require additional Core/provider contracts if chosen.
5. Paid bookings: time holds, expiry, payment attempts, confirmation, cancellation/refund and late-payment recovery. Never confirm paid appointments merely because today's nonpayment booking operation succeeds.
6. Additional business forms: digital entitlements, developer/service quotations and milestones, recurring services, delivery integrations and relevant merchant marketing/support tools.

The eventual plan should prove one complete merchant-to-customer journey before adding the other business families. Its acceptance evidence must include account isolation, two sellers in the same world, game/real/credit separation, payment cancellation, duplicate webhook/retry behavior, fulfillment/refunds, refresh/reconnect and a real provider test in the chosen environment. These are requirements for later verification, not tests run during this research.

## Provisional defaults, not accepted decisions

Research is Nigeria-first and prices real transactions in NGN initially. The data model should retain country/currency/service-area fields for later expansion. Adult verified sellers, merchant-owned fulfillment with an Allworld support/escalation route, one merchant per order, and no crypto, real-money wagering, lending, escrow or stored consumer funds are recommended pilot defaults. Do not charge a new Allworld fee until the monetization decision is settled.

An existing Paystack merchant connection currently requires a merchant credential through Goalmatic's protected integration flow; this is not yet the ideal bank-details-only seller onboarding experience. Managed subaccounts could change that experience, but need new platform support and agreement on the provider/business model. Paystack's [split-payment API](https://paystack.com/docs/payments/split-payments/) is a technical capability, while its [aggregator guidance](https://support.paystack.com/en/articles/4509698), [terms](https://paystack.com/terms) and [restrictions](https://support.paystack.com/en/articles/2127042) determine whether the exact operation is acceptable. No provider approval has been obtained.

## Seven decisions requested before the spec

1. **Real balance:** should it show seller earnings/payout status only, or should customers also deposit money, spend a stored balance, transfer and withdraw? Recommend earnings/status only; it matches checkout-based commerce and avoids a new wallet product, but provides less payment flexibility.
2. **Payment ownership:** should sellers connect their own Paystack account, or provide bank details under an Allworld-managed marketplace/split arrangement? Recommend existing merchant accounts for the first pilot because the adapter exists; this makes onboarding heavier. Managed settlement needs new contracts and provider review.
3. **Goalmatic identity:** should Goalmatic become the account system for every registered player, or should players connect it when activating a business? Recommend business activation first to preserve current players/guest entry; it introduces one explicit linking step. Automatic setup after that step should provision only the chosen tools.
4. **Merchant population:** start with player-created/owner-claimed businesses, or also build a searchable nationwide directory of existing Nigerian firms? Recommend opt-in merchants first; accurate listings and owner authorization are easier to establish, but initial coverage is smaller.
5. **First complete transaction:** physical goods, digital goods, paid appointments or freelance/project services? Recommend physical goods with merchant-managed pickup/delivery because the Store flow is most complete; services wait for booking/payment or quotation work.
6. **Land access:** can a player start on an existing plot/starter stall using game progression, or must they first rent/buy commercial space? Recommend a starter location and game-money upgrades; this reduces barriers to trading but postpones a commercial-property economy. No real land ownership is implied.
7. **Allworld revenue:** free pilot, commission per sale, shop subscription/rent, or optional paid business tools? Recommend a free pilot until purchase/fulfillment/payout behavior is proven; commission later needs the chosen settlement arrangement. This delays platform revenue while validating demand.

The spec and phased implementation plan will follow Anthony's answers. Remaining provider/legal questions will be assigned explicit validation owners and gates, not resolved by assuming the API permits them.

## Acceptance ledger for this research

| Unit | Owner/model | Source/evidence | State | Remaining boundary |
| --- | --- | --- | --- | --- |
| App inventory | Luna, medium; parent correction/integration | Store `a6311ba`, Bookins `4c990e4`, source links in inventory | Complete at source level | Installed/released behavior unverified |
| Core contracts | Sol, medium; parent checked key paths | GM `d6517e4`, SB `79bf67a`; dirty-tree caveats in contract memo | Complete at source level | Hosted API, credentials and provider state unverified |
| Allworld boundaries | Parent | `f115424`, local source anchors above | Complete at source level | Runtime behavior and deployment unverified |
| Nigerian categories and provider research | Parent | Official/public first-party sources, accessed 2026-10-07 | Complete for stated coverage | Not a census or merchant onboarding |
| Product decisions and spec | Anthony, then parent | Seven decisions above | Awaiting answers | No implementation authorized in this research turn |

Worker retries: one inventory correction pass; Core investigation resolved an imported-catalog false negative before completion. Monetary cost, token usage and precise per-worker elapsed time are unavailable and are not estimated. No application code was changed; no tests/builds/services, payments, deployments, commits or remote writes were performed.

## Local consolidation

The original inspection above is provenance. The current local integration uses the newer attached `codex/allworld-integrated-preview` checkout; portable Allworld links resolve to that repository. Real merchant code is isolated under `commerce`, with native simulated `business` preserved. See [the commerce checkpoint](../COMMERCE.md). No provider deployment or live transaction is implied.
