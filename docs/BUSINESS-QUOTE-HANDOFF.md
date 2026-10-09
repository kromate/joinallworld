# Business purchase quote handoff

Source audit: 9 October 2026, APP UI runtime `22fb786e`. This is an implementation plan, not a completed fix or production proof.

Integration is now implementing this contract in the clean delivery checkout. Current source emits tax-inclusive quantity quotes and compares them inside `createOnce` before real shop settlement. The UI sends the shown price/total; fixture callers and focused acceptance cases are being migrated. Account-safe retries are the same active delivery phase. Until exact-source Node/Worker/browser gates and named production adoption pass, this remains unaccepted source. [PARITY-DELIVERY](PARITY-DELIVERY.md) is the current release tracker; the audit below records the original defect.

The Business screen sends shop, product and quantity. The server charges the seller's current price plus current sale levies. A seller can change the price after the buyer loads the screen, and the market response does not expose a tax-inclusive quote. Binding only the unit price would still leave the tax amount unconfirmed.

New purchases should require the displayed unit price and the displayed total for the requested quantity. Existing saved receipts must remain replayable. Accepting a new unquoted purchase from an old tab cannot also guarantee that its unseen old price was honored.

## Implementation

1. Preserve `ShopItem.price` as the seller's unit price. Add server-computed quotes for quantities 1 through `BUSINESS.qtyMax` (currently 3), using the existing levy functions at one read time. Compute tax on the combined subtotal; multiplying the one-unit tax can produce a different rounded result.
2. Render the total on Buy and explain included tax. The current Vue screen buys one unit. If quote data is absent, offer refresh instead of sending an unquoted purchase.
3. Send `expectedPrice` and `expectedTotal`, both safe positive integers. Keep them optional in the wire type for old receipt replay, but require both inside the callback for a new operation. Missing, partial or malformed quotes get an explicit refusal and refresh instructions.
4. Preserve the old receipt fingerprint exactly when both fields are absent: `[cityId, shopId, String(product), String(units)]`. For quoted requests, append a version marker and the two amounts. Place validation inside `createOnce`, so existing receipt lookup precedes current quote validation. A changed quote with a previously successful request ID must conflict.
5. Compare against the canonical price and total before mutating shop settlement. Retain location, block, ownership, device, stock, allowance and network-limit guards. Recheck availability after settlement. On a quote change, return the fresh market and require another user click; never buy automatically. Preserve current response `amount` semantics as the pre-tax subtotal.
6. Migrate all fixture callers, then run the existing Node and Worker journeys and browser checks below. Document that old tabs can read and replay saved purchases, while new unquoted buys require reload. No save migration or new quote store is needed.

## Callers and contracts

- Browser: `src/app/features/business/BusinessApp.vue`.
- Shared Node/Worker route and service: `server/routes/business.ts`, `server/business/service.ts`.
- Wire DTOs: `src/types/business.ts`.
- Existing unquoted fixtures: `server/business.test.ts`, `server/combined.test.ts`, `server/politics.test.ts`, `server/politics-assembly.test.ts`, and `server/testing/businessJourney.ts`, used by `deploy/business.edge.test.ts`.

The fixtures currently expect successful unquoted operations. A complete contract change needs those callers migrated; passing them by retaining unrestricted unquoted writes would prove only a partial rollout. No test expectations or fixture callers were changed in this UI phase.

## Acceptance

Use the actual service and transaction store on disposable data. Verify stale-price and tax-only changes refuse without a buyer purchase debit or shop purchase mutation; distinguish normal actor settlement from purchase changes. Check multi-unit tax rounding, exact-total payment, base-price credit to the shop, same-ID replay after a price change, changed-quote conflicts, old unquoted receipt replay, and the new missing-quote refusal. Run the existing business, combined, politics, assembly and Worker journeys. Finally exercise browser stale quotes and the ordinary open, stock, buy, collect and close lifecycle with matching ledger and balances.

Two adjacent issues need separate ownership: `civicClient.ts` currently claims “Nothing was charged” after an ambiguous transport error, and civic caches lack an explicit actor key in the inspected wrapper. The former needs honest uncertainty wording while retaining retry IDs; the latter needs its own identity-transition proof before changing shared cache behavior. Do not infer either is fixed from normal purchases.

The current UI branch preserves this plan for the integrator rather than applying a partial price fence or breaking old purchase callers. Normal Business QA uses a fixed seller price, a fresh buyer view and verified zero sale tax. It cannot certify stale-quote, ambiguous-response or actor-switch safety. Provider-backed My Store is a separate product and is excluded from these simulated-shop actions.
