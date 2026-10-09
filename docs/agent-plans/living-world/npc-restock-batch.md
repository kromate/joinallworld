# Fictional NPC restocking boundary

Selected 9 October 2026 from the actual first-journey source audit at implementation `3e173080506d659ced0b0dc466dd7e308e8d5848`. The programme remains the complete connected journey and subsequent phases. This unit resolves one accounting dependency; it does not accept mapped driving or delivery gameplay.

## Observed gap and outcome

The existing parcel module proposes a terminal stock/wage effect but no registered service persists it. Player-shop stock is paid and owner-controlled, and shop closure values remaining stock into the owner's payout. Free NPC deliveries must therefore use a separate explicitly fictional NPC inventory with no player-shop ownership, purchase, redemption or closure path.

Implement a bounded internal database helper for that separate inventory. It must read the current strictly validated actor/account-bound persisted parcel, enforce authored destination/product/quantity/wage terms, compare the inventory revision, and retain an actor generation watermark across replacement parcel generations. The caller must apply the fixed fictional wage and terminal custody in the same database transaction. A refused or duplicate operation must neither stock nor produce a second wage effect.

## Ownership and gates

- Existing verified `gpt-6-luna/high` worker `luna_goalmatic` owns only new `server/living-world/npc-inventory.ts` and `npc-inventory.test.ts`. The role name does not change its model or authorize live Goalmatic access.
- Sol independently reviews, repairs, integrates and releases. Shared routes, protocol, keyed storage/privacy, account adoption and wallet actions remain Sol-owned. Existing Business, WORLD and GRAPHICS source is read-only.
- No new worker, credential, provider operation, local compiler/build/browser/server or production upload is authorized by this unit. The live full CI handle remains `37888565489` at exact source `3e173080`; do not supersede it.
- The new parcel envelope is a declared integration contract, not an existing service: `livingWorld.parcels[publicId] = { v: 1, publicId, account, state: ParcelState }`. No browser-supplied terminal state or coordinates may be written as proof.
- Source tests cover exact stored terminal terms, actor/account mismatch, stock CAS, same/changed/new-ID and old-generation replay, replacement generations, clock/counter/size/row limits, corrupt/future quarantine and preservation of unrelated business/wallet state.

## Required integration before activation

1. Complete server-authoritative mapped vehicle controls, pinned safe supplier/shop/depot anchors, stopped-pose proof and durable finite fleet custody. Current practice driving, road proposals and actor diagnostics cannot supply that proof.
2. The delivery transaction must preflight custody, inventory capacity/revision and wallet bounds, then commit terminal parcel, stock, fixed wage, generation watermark and receipt together. A wallet or persistence failure after preparation must abort the entire transaction; returning a normal refusal after committing stock is insufficient.
3. Define work-earned/debt policy explicitly. Current mannequin/clerk training rewards do not establish delivery's `social.earned` behavior.
4. Integrate strict owner-only summaries, account adoption/rebinding and erasure atomically with parcel/watermark continuity. Do not erase a watermark independently and permit a retained terminal parcel to mint another reward.
5. Exercise real HTTP and Worker/SQLite races, response loss and restart, then actual mapped desktop/mobile/multiplayer/interrupted gameplay, exact staging and production/save observations. Fixtures and internal helper checks do not prove live delivery.

Whole PHASES acceptance A1–A10 and the first journey remain open. This record preserves the next bounded work; it does not execute while the runtime is stopped.
