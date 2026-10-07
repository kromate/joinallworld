# Goalmatic identity and commerce contracts

Research date: 2026-10-07. This note records current local source, not a product decision or a claim about production.

## Evidence state

The GM checkout is `/Users/anthonyakpan/Desktop/go/gm` at `d6517e4106875881e9c931763a2f5409d2d348ca` on `codex/fix-local-operation-confirmation`. The checkout is dirty. The two relevant modified files are `backend/functions/src/platform/catalog.ts` and `backend/functions/src/platform/appRuntime.ts`; their changes add service-identity work, not the commerce or standard App authorization contracts cited below. The commerce catalog last changed in `fb2305de838f4735ce59dc2ebee1f982458d212f`; the commerce runtime last changed in `58481f18e006b6f03f60e2bdd12b86a88a0bf17c`.

The SB checkout is `/Users/anthonyakpan/Desktop/go/SB` at `79bf67a8b26e39a18d027fbd69760b3ea7de0101` on `main`. It is also dirty, but the handoff, platform client, session, and guest-action files cited below are tracked and unmodified. No build, test, runtime call, browser check, deployed configuration read, or credential check was performed. Production availability is unverified.

The public GM platform contract reports API version `2026-07-01` and contract version `0.1.0`. `platformCatalogApi` is a public `GET`; `platformExecuteApi` is a `POST` and returns `{success,data,traceId}` or `{success:false,error,traceId}`. The request is `{operationId,operationVersion,input,context}`. [catalog.ts:38-39](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/catalog.ts:38) [http.ts:6-56](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/http.ts:6) [types.ts:94-159](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/types.ts:94)

Authentication is `Authorization: Bearer ...`: `gma_` is an installed-App session, `gms_` is a trusted service token, and `gm_` is an account API key. The gateway also checks the account, subject or delegation, site, deployment, operation scope, and operation audience. [auth.ts:14-64](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/auth.ts:14) [auth.ts:67-101](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/auth.ts:67)

## Identity, signup, installation, and workspace linking

### Native Goalmatic signup

The callable `verifyEmailOTPAndCreateAccount` takes `email`, `otp`, `fullName`, optional `referralCode`, and optional `signupMethod`. A successful new signup creates the Firebase Auth user, the `users/{uid}` profile, and the same-ID personal `accounts/{uid}` workspace in one batch, then returns `{code:200,message,userId,accountId,customToken}`. Existing matching Auth users resume the same account instead of creating a duplicate. [verifyEmailOTPAndCreateAccount.ts:15-23](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/auth/verifyEmailOTPAndCreateAccount.ts:15) [verifyEmailOTPAndCreateAccount.ts:52-78](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/auth/verifyEmailOTPAndCreateAccount.ts:52) [verifyEmailOTPAndCreateAccount.ts:117-190](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/auth/verifyEmailOTPAndCreateAccount.ts:117)

`ensurePersonalAccount` is a separate authenticated callable. It takes no caller-supplied user ID and returns `{success:true,accountId}` after getting or creating the signed-in user's personal workspace. [ensurePersonalAccount.ts:14-29](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/accounts/ensurePersonalAccount.ts:14) [ensurePersonalAccount.ts:53-56](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/accounts/ensurePersonalAccount.ts:53)

These are Goalmatic Firebase contracts. No dedicated public operation was found that accepts an independently authenticated Allworld user and silently provisions or links a Goalmatic identity. `createPartnerHandoffToken` only mints a Firebase custom token for a caller already authenticated in the same Goalmatic Firebase trust boundary. The deployed Firebase project/tenant used by Allworld was not inspected: this research does not prove that the two deployments use different projects. If they deliberately share a trust boundary, reuse still requires checking issuer/audience, Goalmatic profile/workspace lifecycle and consent, rather than assuming an Allworld account is already a fully provisioned Goalmatic user. [createPartnerHandoffToken.ts:6-16](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/auth/createPartnerHandoffToken.ts:6) [createPartnerHandoffToken.ts:18-35](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/auth/createPartnerHandoffToken.ts:18)

### Sign in with Goalmatic and installation

The supported installed-App path is an explicit PKCE authorization:

1. SB calls `apps.authorization-start@1.0.0` with `siteId`, an exact registered `redirectUri`, `state`, and `codeChallenge`. It receives `requestId`, `authorizationUrl`, and `expiresAt`. [catalog.ts:2108-2121](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/catalog.ts:2108)
2. SB stores state, verifier, and return path in HttpOnly cookies, then redirects the browser to Goalmatic. [goalmatic-app-handoff.ts:146-199](/Users/anthonyakpan/Desktop/go/SB/server/utils/goalmatic-app-handoff.ts:146)
3. The Goalmatic approval page requires an authenticated Goalmatic user. The user selects a workspace, chooses provisioned or linked Tables, binds required connections, and approves. [authorization.ts:19-22](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/apps/authorization.ts:19) [authorize.vue:499-538](/Users/anthonyakpan/Desktop/go/gm/frontend/src/pages/apps/authorize.vue:499)
4. Approval creates or updates an `app_installations` record for the chosen account, provisions bindings, stores granted scopes and connections, and creates a single-use authorization code. It returns `callbackUrl`, `accountId`, and a minimal user object. [appRuntime.ts:3209-3295](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/appRuntime.ts:3209) [appRuntime.ts:3345-3469](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/appRuntime.ts:3345)
5. SB exchanges the code with `apps.sessions-exchange`, input `{code,verifier,siteId}`. The output has access and refresh tokens plus their expiry fields. SB stores both as HttpOnly, SameSite Lax cookies. [catalog.ts:2124-2137](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/catalog.ts:2124) [goalmatic-app-handoff.ts:228-242](/Users/anthonyakpan/Desktop/go/SB/server/utils/goalmatic-app-handoff.ts:228) [app-runtime-session.ts:25-45](/Users/anthonyakpan/Desktop/go/SB/server/utils/app-runtime-session.ts:25)

`apps.sessions-validate` takes `{token,siteId}` and returns safe `user`, `account`, `session`, installation `bindings`, and Goalmatic `credits`. `apps.session-accounts-list` lists workspaces in which the session subject has a joined role. `apps.session-account-switch` takes `{token,siteId,targetAccountId}`, provisions the App in that accessible workspace, rotates both session tokens, revokes the old session, and returns the new account, user, session, bindings, and credits. [catalog.ts:2156-2169](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/catalog.ts:2156) [catalog.ts:2226-2255](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/catalog.ts:2226) [appRuntime.ts:3992-4037](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/appRuntime.ts:3992) [appRuntime.ts:4200-4226](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/appRuntime.ts:4200)

This installed-App path requires an authenticated Goalmatic identity and App/workspace approval. No integration from Allworld's current account service to this path was found. Automatic signup/provisioning therefore remains a design and configuration question, rather than an already proven integration.

## Store and order operations

GM imports these `commerce.*@1.0.0` operations into the main platform catalog. Each operation requires the installation-bound `storesTableId`, `productsTableId`, `ordersTableId`, `customersTableId`, `discountsTableId`, and `movementsTableId`. `products-import` also requires `importsTableId`. Inputs allow operation-specific fields. Every catalog output requires `revision`; the runtime adds the operation result. Writes use policy `app.commerce`, stable idempotency, and Table resource bindings. [catalog.ts:66](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/catalog.ts:66) [commerce/catalog.ts:4-43](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/commerce/catalog.ts:4)

The exact catalog entries and their operation-specific required inputs are below. Every row also requires the six common Table IDs. `P` allows a public shopper through the signed SB grant. `M` requires an authenticated owner or installed-App user.

| Audience | Operation | Additional required input |
| --- | --- | --- |
| P | `commerce.customer-account` | `action` |
| P | `commerce.catalog-get` | none |
| M | `commerce.summary-get` | none |
| P | `commerce.checkout-quote` | `lines` |
| P | `commerce.checkout-create` | `lines`, `customer`, `paymentMethod` |
| P | `commerce.order-get` | none in catalog; runtime needs `orderId` or `reference` |
| M | `commerce.order-update` | `orderId`, `action` |
| P | `commerce.test-payment` | `outcome` |
| M | `commerce.inventory-adjust` | `variantId`, `quantity`, `reason` |
| M | `commerce.product-save` | `data` |
| M | `commerce.product-archive` | `productId` |
| M | `commerce.store-save` | `data` |
| M | `commerce.theme-save` | `theme` |
| M | `commerce.store-launch` | none |
| M | `commerce.discount-save` | `data` |
| M | `commerce.customer-save` | `customerId`, `data` |
| M | `commerce.reservations-expire` | none |
| M | `commerce.indexes-backfill` | `family` |
| M | `commerce.products-import` | `importsTableId`, `rows`, `mode` |
| P | `commerce.digital-download` | `productId` |
| M | `commerce.payment-bind` | `connectionId`; runtime also requires `storeId` and `expectedRevision` |
| P | `commerce.payment-start` | `callbackUrl`; runtime also needs an addressed order and shopper proof |
| M | `commerce.refund-create` | `orderId`, `amount`, `reason` |
| M | `commerce.refund-refresh` | `orderId`, `refundId` |
| M | `commerce.media-resolve` | none |
| P | `commerce.payment-refresh` | none in catalog; runtime also needs an addressed order and shopper proof |

The catalog output schema guarantees only `revision` and permits other fields. The runtime supplies the richer results described below. This means the catalog alone is not a complete typed response contract. `order-get`, `payment-start`, and `payment-refresh` also depend on runtime-only order-address and shopper-proof fields. [commerce/catalog.ts:33-43](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/commerce/catalog.ts:33) [runtime.ts:695-725](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/commerce/runtime.ts:695)

The main shopper results are:

- `commerce.customer-account`: actions `status`, `requestCode`, `verifyCode`, `logout`, `profile`, `updateProfile`, `orders`, and `order`. It is restricted to the first-party SB storefront BFF and uses a separate storefront customer email-code session, not a Goalmatic workspace session. [runtime.ts:1107-1148](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/commerce/runtime.ts:1107)
- `commerce.catalog-get`: public store and active-product catalog, with pagination and optional category and search filters.
- `commerce.checkout-quote`: required `lines`; supports `variantId`, integer `quantity`, personalizations, optional discount, delivery method, and shipping rate. It returns server-priced lines, subtotal, discount, shipping, tax, total, currency, and delivery state. [model.ts:143-199](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/commerce/model.ts:143)
- `commerce.checkout-create`: required `lines`, `customer`, and `paymentMethod`; optional expected total and currency, address, discount, and delivery data. Payment methods are `test`, `transfer`, `cash`, `paystack`, or `whatsapp`. It creates a pending order, reserves stock for 30 minutes, and returns `{order,accessToken,revision}` plus bank or WhatsApp details when applicable. [model.ts:225-269](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/commerce/model.ts:225)
- `commerce.order-get`, `commerce.test-payment`, `commerce.digital-download`, `commerce.payment-start`, and `commerce.payment-refresh`.

Merchant-only operations include `commerce.summary-get`, `order-update`, `inventory-adjust`, `product-save`, `product-archive`, `store-save`, `theme-save`, `store-launch`, `discount-save`, `customer-save`, reservation cleanup, index backfill, product import, `payment-bind`, `refund-create`, `refund-refresh`, and media resolution. [commerce/catalog.ts:5-30](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/commerce/catalog.ts:5)

SB exposes declared guest actions through `GoalmaticGuest.query` and `.command`. The guest endpoint checks the signed public grant, action ID, route, input schema, reserved trusted fields, and idempotency key before adding bound Table IDs and trusted visitor or customer context. It then calls GM with a scoped service token. [sdk-snippets.ts:270-300](/Users/anthonyakpan/Desktop/go/SB/server/utils/site-renderer/sdk-snippets.ts:270) [guest action endpoint:12-90](/Users/anthonyakpan/Desktop/go/SB/server/api/app-runtime/guest/actions/[actionId].post.ts:12) [gm-platform-client.ts:115-176](/Users/anthonyakpan/Desktop/go/SB/server/utils/gm-platform-client.ts:115)

## Store checkout trace

For a Paystack purchase, the storefront sends an idempotent `commerce.checkout-create` guest command. GM reprices from the bound product and discount records, reserves inventory, and returns the pending order plus a 30-day order access token. The storefront then sends `commerce.payment-start` for that order with `callbackUrl` and either its signed-in customer session or the order access token. GM accepts only the installed connection and the exact registered runtime or verified storefront hostname. [runtime.ts:695-739](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/commerce/runtime.ts:695) [runtime.ts:741-763](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/commerce/runtime.ts:741)

`payment-start` persists a Paystack route and attempt before calling `/transaction/initialize`. It sends the order total in minor units, currency, email, stable reference, and callback URL. The returned checkout URL must be HTTPS on `checkout.paystack.com`. [runtime.ts:839-895](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/commerce/runtime.ts:839) [paystack.ts:79-95](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/integrations/merchantPayments/paystack.ts:79)

`merchantPaystackWebhook` accepts only POST. The commerce handler verifies the Paystack HMAC, matches the persisted route and test or live environment, and performs a provider GET verification before marking the order paid. Supported events are `charge.success` and Paystack refund lifecycle events. Browser return is not payment proof. [webhook.ts:6-15](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/integrations/merchantPayments/webhook.ts:6) [runtime.ts:1011-1054](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/commerce/runtime.ts:1011)

Refunds are merchant-only and idempotent. `commerce.refund-create` requires `orderId`, a positive minor-unit `amount`, and `reason`. GM persists the refund intent before calling Paystack. `commerce.refund-refresh` verifies one refund ID or reconciles Paystack's refund list against the stored merchant note. [runtime.ts:942-1008](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/commerce/runtime.ts:942)

## Booking and billing boundaries

Booking has `booking.page-get`, `booking.openings-list`, `booking.create`, and owner-only `booking.cancel`. `booking.create` requires the four booking Table IDs, `serviceId`, `startsAt`, and `contact`; it returns booking ID, reference, time, timezone, and status. The public page explicitly reports `payment: arranged-with-owner`. Creation writes a confirmed booking and returns `delivery: on-screen-only`. No booking operation starts checkout or records payment. [catalog.ts:1285-1346](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/catalog.ts:1285) [runtimeService.ts:236-256](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/apps/booking/runtimeService.ts:236) [runtimeService.ts:295-359](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/apps/booking/runtimeService.ts:295)

Goalmatic's central Paystack subscription and top-up code is separate from merchant commerce. It buys a Goalmatic plan or grants metered Goalmatic credits to an account. Credit status exposes plan tier, used, limit, remaining, purchased remaining, generation eligibility, and a billing URL. These credits are not naira, customer funds, merchant proceeds, or a withdrawable game balance. [createSubscription.ts:18-92](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/payments/paystack/createSubscription.ts:18) [applyCreditTopup.ts:58-113](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/transactions/applyCreditTopup.ts:58) [creditStatus.ts:5-17](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/platform/creditStatus.ts:5)

## Gaps that affect Allworld

- No dedicated identity-federation operation or Allworld integration was found. The supported installed-App flow needs an authenticated Goalmatic identity and workspace approval. Whether a shared Firebase deployment could simplify this is unverified and must not be inferred from matching email addresses.
- The commerce customer session is store-scoped and email-code based. It is not a Goalmatic player account and does not solve Allworld account linking.
- No App-facing Paystack subaccount, split, settlement, transfer-recipient, or transfer operation exists. Paystack transfer calls appear only in the internal partner and referral redemption functions, outside the platform catalog. [redeemPartnerEarnings.ts:62-71](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/partners/redeemPartnerEarnings.ts:62) [redeemReferralReward.ts:204-239](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/referrals/redeemReferralReward.ts:204)
- Merchant commerce assumes the seller connects a Paystack secret key through the authenticated callable `connectMerchantPaymentAccount`, which checks Goalmatic workspace access and stores an encrypted credential. The connection supports initialize, verify, and refund only. [index.ts:6-14](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/integrations/merchantPayments/index.ts:6) [paystack.ts:59-76](/Users/anthonyakpan/Desktop/go/gm/backend/functions/src/integrations/merchantPayments/paystack.ts:59)
- There is no reusable real-money player wallet, custody ledger, withdrawal contract, or bridge between Store payments and game balance. Allworld's simulated in-world balance must remain a separate domain. A real Paystack success may settle an order, but it must not mint, withdraw, or convert the game's simulated balance without a new reviewed money ledger and regulatory design.
- Booking payments require a new contract or a deliberate reuse of commerce orders. Current booking confirmation happens before any payment.
- Source contains the needed Store checkout mechanics, but deployment, secret configuration, live merchant connection, webhook routing, and production behavior remain unverified.
