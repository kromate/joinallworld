# Allworld stores: specification and implementation status

Updated 7 October 2026. Local consolidation ports real commerce to `/api/commerce`, `db.commerce`, and Phone `commerce`; the native simulated Business subsystem remains separate and intact. Anthony approved the recommended first release and requested implementation. This file supersedes the unresolved decisions in [the research pack](commerce-research-2026-10-07/README.md).

## Accepted product scope

- Players create a starter store on their current home plot. This is a virtual address, not real property ownership. It follows the active character's home; an unplaced character cannot publish a store.
- First release: adult, opt-in sellers, physical products, Nigerian naira, merchant-managed pickup/delivery and customer support, one merchant per checkout, no Allworld fee during the pilot.
- Goalmatic enters when the player activates their business. Existing Allworld accounts, guest entry and characters remain intact. Goalmatic performs its own sign-in/signup, workspace selection and Store installation/setup.
- Sellers may connect their own Paystack or BACH account. The provider identified in existing source and official docs is Bachs (`bachs.io`). Goalmatic's existing platform subscription/credit credentials are never reused for individual sellers.
- Game cash stays in the HUD and game bank. Real earnings appear inside My Store. Goalmatic metered credits remain a third, unrelated unit.
- No real-money deposits/top-ups, player transfers, staking, wagering, game-cash conversion or pooled player wallet.
- Withdrawals remain with the seller's provider for this pilot. Allworld opens the provider dashboard: Bachs handles withdrawals and Paystack handles its settlement flow. There is no new in-app withdrawal API or claim of a withdrawable balance.

The broader research covers 30 business families. Paid bookings, freelance-project milestones, recurring services, nationwide directory imports, additional cities/currencies and paid commercial land are later units, not implemented features of this first release.

## User journeys

### Seller

1. Open Phone -> My Store, or tap Open my store on the player's house card.
2. Sign in to save the business with the Allworld account. Choose a home plot if necessary.
3. Enter store name, physical-product category, description and actual delivery/pickup area. Confirm adulthood and responsibility for fulfillment. The starter draft is free and does not change game cash.
4. Continue with Goalmatic. Sign in/signup, select the merchant workspace, create or choose the Store Studio store, connect a merchant payment provider, add products and launch its public storefront.
5. Explicitly approve the external commerce-channel connection. Return to Allworld with a short-lived authorization code. Allworld's backend exchanges it using PKCE; the browser never receives the resulting merchant grant.
6. Review store details and choose Open to other players. Publication requires a currently valid production Store installation, a live connected payment provider, NGN and an allocated home plot. Private-test stores stay private and are labelled as test payments.
7. Use My Store for net sales collected, refunded amounts and orders awaiting payment. Open Store Studio for products/orders. Open the connected provider dashboard for available funds and payouts.
8. Pause the listing or disconnect. Disconnecting removes Allworld access and discovery but retains Goalmatic products/orders. Deleting an Allworld account removes its business record and attempts remote grant revocation; account export excludes grants, PKCE verifiers and device secrets.

### Shopper

1. Open Explore shops in My Store, the local-government panel, or another player's visible house card.
2. Browse shops in the selected city/home area. Real service area is shown independently from the virtual address.
3. Open the merchant's signed public storefront in a separate tab. Catalogue, cart, authoritative prices, stock reservation and checkout remain in Store Studio/Goalmatic.
4. Pay through Paystack or Bachs hosted checkout. Payment is confirmed by server verification and signed provider events. Returning to the browser alone does not mark an order paid.
5. The merchant fulfills or refunds through Goalmatic's order flow. Real purchases never change the customer's simulated cash.

## Architecture and why this shape was chosen

Two designs were considered. A new native Allworld catalogue/checkout would require reproducing shopper sessions, guest grants, carts, delivery, inventory, receipts and order access in a second client. A connected in-world store can instead reuse the existing Store Studio journey, while a narrow merchant channel supplies read-only store identity and earnings to Allworld. The latter is implemented for the pilot.

Allworld owns the world listing and its account/plot relationship. Store Studio and Goalmatic remain authoritative for products, customers, orders, refunds and payment connections. Providers remain authoritative for settled balances, bank destinations and withdrawals. There is no imported merchant order database inside the game.

### Allworld implementation

- [Commerce types](../src/types/commerce.ts) define the wire contract and the nine initial physical-product categories. The main HTTP contract and route-key list include every new endpoint.
- [Commerce routes](../server/routes/commerce.ts) implement draft/profile, connection, refresh, publication, disconnection and directory access.
- [Commerce service](../server/commerce/service.ts) owns projections and encryption. Data is a separate `db.commerce` collection, keyed by account identity, on both Node and Worker storage. It does not use the game wallet ledger.
- [Goalmatic adapter](../server/commerce/goalmatic.ts) is the single external HTTP boundary. It parses responses and validates currency, provider mode and URLs. Configuration is server-owned; browsers cannot choose a backend destination.
- [My Store](../src/app/features/commerce/CommerceApp.vue) is a lazy Phone panel. World house and local-government panels provide spatial entry points.

Business changes require the bound Allworld account, exact same-origin requests and a session CSRF token. Reads are separate from the CSRF-protected refresh mutation. Profiles are bounded plain text. Only the owner sees earnings. Public listings carry no Goalmatic account IDs, order records or credentials.

The one-time connection attempt is bound to account, device, state and exact callback. Both PKCE verifier and grant are AES-GCM encrypted using a private host key and account-associated data. Only hashes of issued codes/grants are held by the Goalmatic channel service. Codes expire after five minutes and grants after 30 days. A reconnect rotates the grant and revokes the previous one. Failed completion attempts revoke any newly issued grant they cannot persist.

Directory reads revalidate eligible storefronts through Goalmatic. The small process-local success cache lasts at most 30 seconds, is capped at 256 entries, and never caches private API responses for browsers. Revoked, paused, test or invalid stores are omitted. The signed storefront still enforces its own shopper permissions on every actual purchase.

### Reusable Goalmatic commerce channel

New owner operation: `commerce.channel-authorize@1.0.0`. It binds an administrator-approved external channel to one Store installation and its exact Tables. It requires an active Store, canonical signed public link, valid installation lifecycle, current account membership, ready summaries and configured currency/provider requirements.

New backend endpoint: `merchantCommerceChannelApi`, with only `exchange`, `overview` and `revoke` actions. Exchange uses S256 PKCE and a one-use code; overview/revoke require an opaque grant. The endpoint does not accept deposit, transfer, wagering or withdrawal commands. Its data includes store identity, read-only summaries and provider-owned navigation.

The generic contract lives in `gm/backend/functions/src/platform/commerce/channelCatalog.ts`, `channelService.ts` and `channelHttp.ts`. Store Studio adds an explicit connection banner and a declared capability. It renders nothing when no channel intent is present. The capability can serve other administrator-approved commerce clients unchanged.

### Merchant Bachs support

The existing Paystack behavior remains available. A provider-neutral adapter routes to the encrypted merchant's Paystack or Bachs connection. Bachs credentials are collected through Goalmatic's protected integration UI, scoped to the chosen workspace, and never stored in Allworld/browser storage. The new merchant webhook is separate from Goalmatic subscription/credit fulfillment.

Orders persist provider, checkout ID, payment ID and the separately signed Bachs charge ID. Checkout/refund POSTs use stable idempotency keys. Ambiguous outcomes require reconciliation; redirects and timeouts never imply success. Amounts remain integer minor units internally and become decimal major-unit strings only at the Bachs boundary. Payment/refund verification checks reference, currency, amount, provider, mode and relevant IDs.

Bachs refunds fail closed when the payment method/currency does not support them, when `is_refundable` is false, or when the signed charge identity is missing. The payment ID used for retrieval is not substituted for the charge ID required by refunds. No new custody balance or payout-request implementation was added.

Official contracts checked: [checkout](https://docs.bachs.io/api-reference/payments/create-checkout-session), [merchant checkout settings](https://docs.bachs.io/api-reference/organizations/get-checkout-settings), [webhooks](https://docs.bachs.io/guides/webhooks/overview), [refunds](https://docs.bachs.io/guides/refunds), [withdrawals](https://docs.bachs.io/guides/payouts/overview), and [supported businesses](https://docs.bachs.io/for-you/supported-businesses). The supported-business page includes physical e-commerce; provider onboarding/approval still applies to each seller.

## Configuration and delivery plan

Implementation is local and uncommitted. No deployment, publication, provider onboarding, live transaction or payout was performed.

1. **Local contracts and interfaces:** implemented across Allworld, Goalmatic Core/frontend and Store Studio. Preserve the other active changes in all three checkouts during integration. Existing dirty changes are not part of this feature's release.
2. **Publish the Core contract and Store capability together:** the catalog, executor, new channel HTTP export, merchant Bachs adapter/webhook, integration catalog/UI and Store Studio manifest/client must agree. Old installed Apps need the added channel/Bachs capabilities through their normal permission/update flow. Use the normal immutable build and private-test path before a Store release.
3. **Register the channel:** set `COMMERCE_CHANNELS_JSON` on both the platform executor and channel API to an operator-reviewed object such as `[{"id":"allworld","name":"Allworld","redirectUris":["https://joinallworld.com/?commerce_return=1"],"requiredCurrency":"NGN","requirePaymentProvider":true}]`. The hostname must be the actual deployed game origin; the example is not a claim that this origin/configuration is active. Required shared encryption-secret bindings must remain consistent with existing merchant integrations.
4. **Configure Allworld:** set `PUBLIC_ORIGIN` to that exact game origin; `GOALMATIC_COMMERCE_API_URL` to the deployed `merchantCommerceChannelApi` HTTPS endpoint; `GOALMATIC_STORE_URL` to the exact registered Store Studio runtime; `COMMERCE_CHANNEL_ID` to `allworld`. Incomplete configuration leaves connection unavailable while preserving local drafts. No provider API key belongs in these settings.
5. **Merchant setup:** connect the seller's test provider account in Goalmatic and configure `merchantPaystackWebhook` or `merchantBachsWebhook` for the same environment. For Bachs select supported collection/refund events and use the matching signing secret. Confirm the provider's business eligibility and own-bank payout setup. Do not reuse Goalmatic's central billing key.
6. **Hosted private-test acceptance:** prove merchant signup/installation, explicit channel consent, callback/reconnect, two merchant workspaces, live/test separation, buyer checkout, signed-event replay, refund, account switching/revocation and mobile layouts. Provider test-mode success is not live payout proof.
7. **Pilot activation:** after release authorization, activate a small verified merchant cohort. Record an actual order, actual fulfillment and provider settlement/withdrawal receipt. Only that proves real-money delivery. Keep the free pilot and single-merchant checkout scope.

Rollback is to disable the configured commerce channel and hide/disconnect Allworld listings. Provider credentials/orders remain in their owning Goalmatic workspace. Do not delete merchant records or reset game state. Prior Store packages must be checked for compatibility with newly stored Bachs order/payment fields before rolling them back.

## Verification ledger

| Check | Result | What it proves |
| --- | --- | --- |
| Allworld typecheck | Pass, five projects, no TS/Vue errors | Local source/wire/host consistency |
| Allworld production build | Pass | Local build artifact generated |
| Store Studio Vite build | Pass | Local Store source bundle generated |
| Store Studio source-policy check | Blocked by existing feedback component direct-HTTP findings | `GoalmaticFeedback.vue` and `feedback-widget-runtime.js` require their own cleanup; neither was changed for commerce |
| Goalmatic backend `tsc --noEmit` | Pass | Full current backend compiles without emitting artifacts |
| GM merchant connection components | TypeScript transpilation and Vue script/template compilation pass | Local syntax/template validity; not a full GM frontend build |
| Existing focused Allworld checks | 68 passed | Accounts, storage, protocol registration and component behavior remain compatible |
| Temporary local integration probe | Pass | Two-owner isolation, guest rejection, CSRF, duplicate starter creation, encrypted PKCE/grants, connection, unchanged game cash, live-only publication, revoked-listing suppression, export/delete cleanup and absent deposit/transfer routes |
| Actual-dependency provider probes | Pass | Legacy Paystack defaults and Bachs payment/charge identity handling |
| Store connection callback probe | Pass | Accepts a valid returned code/state and rejects changed origin/state; corrected an over-strict callback check discovered during integration |
| Core channel HTTP/PKCE probe | Pass with synthetic datastore and commerce runtime | Valid authorize/exchange/overview/revoke, wrong-verifier rejection, one-use code, no token in overview, and rejection of money commands; corrected transport metadata passed into a strict exchange schema |
| Full Allworld suite | Not clean | One fixed route-module-count expectation needs updating for the added module; other failures include missing test/source files, release-policy/entry checks and existing engine audit expectations outside this feature. No test files were modified. The missing business HTTP contract and bank-copy failures from the first run were corrected, then their focused checks passed. |
| Interactive browser QA | Blocked before app load | Visible IAB unavailable to the Astra worker; Chrome blocked the loopback preview with `ERR_BLOCKED_BY_CLIENT`. No desktop/mobile visual acceptance claimed. |
| Hosted/provider verification | Not run | Channel registration, release state, real seller connection, signed provider delivery, settlement and withdrawal are unverified |

Local verification used a temporary isolated database and synthetic provider responses. Those results do not establish Paystack/Bachs sandbox success, a Store release or production readiness. No new or modified test files, commits, pushes or remote writes were made.

## Work ownership

Sol implemented the generic merchant channel and Store consent surface; a second Sol implemented merchant Bachs checkout/verification/refunds. Luna handled the bounded connection UI and provider catalogue. Parent owned the accepted design, Allworld backend/UI, integration, type/build checks, source review and local protocol probe. Astra's browser-only worker reported the UI blocker without bypassing Chrome's block. Token/monetary cost and precise per-worker elapsed time were unavailable.

## Consolidation checkpoint

The newer local branch keeps the native simulated Business feature and ports this real merchant feature into its own `commerce` namespace. Source, route/type integration and synthetic backend/account privacy checks are local evidence. Provider sign-in, real seller onboarding, live payments, browser acceptance, the combined campus build and production deployment remain separate checks. The original primary checkout, package/tooling edits and baseline tests are preserved.
