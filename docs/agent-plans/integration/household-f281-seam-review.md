# Household persistence seam review

**Decision: MODIFY before the durable adapter uses this boundary.** Reviewed exact commit `f28182fe08aaf9efecd412c64340dc609a66883d`, parent `ba4031a068549b4fcccc27963592b4f4cb159148`, from fetched Git objects in the clean integration checkout. Two concrete store-compatibility defects are source-established. No diagnostic, test, compiler, application, server, browser, or additional worker was run. No source was edited. Reproducer outcomes below are source predictions, not execution evidence.

The candidate changes only `server/keyed.ts`, `server/types.ts`, and `server/routes/once.ts` relative to that parent. It registers eleven household keyed maps, the optional root/identity types, and eleven light receipt kinds. `durableStorage.ts` is inherited. There is no `durableAdapter.ts` or consumer of `householdPoint`/`validateStoredRow` elsewhere in this fetched tree. Registration is not proof of an implemented durable transaction or lifecycle writer.

| Exact source | SHA-256 |
|---|---|
| server/households/durableStorage.ts | 28a8a8f7a101dc836074974d327dc014c14c31e067550f5d8c736cfb88904dd8 |
| server/keyed.ts | fcb0980c057d9e658c64e5e69512c2b60cb7eb39365a9c9d5475872b9e92af68 |
| server/store.ts | 4c739e503df0423661737c0805162bd887ae06669094acdbb868733a67c93296 |
| deploy/sqlite-store.ts | a54149ccc1f4f1a4db69379a041b0fcd7c90f5830fbcbe7393d261c690f58b5d |
| server/households/lifeIdentity.ts | 31e457f73c6047147089c33ea76a802bdb694ff4485dda4b10776903b7bc594d |

## S1 — P1: genuine keyed rows are always rejected

Location: `server/households/durableStorage.ts:114–120`, specifically line 120. Store contract: `server/keyed.ts:333–352,373,380,452`.

The actual `KeyedMap` proxy's descriptor trap returns an enumerable writable data descriptor with **value undefined for every existing key**. Its `get` trap separately returns the parsed/cached row. Reading `map[key]` does not change the descriptor trap. Thus `householdPoint` reaches `descriptor.own === true`, obtains a valid non-undefined `value`, and still returns invalid because `descriptor.value === undefined`. This affects previously stored rows and rows inserted into a genuine keyed map during the transaction, in either host's entries layout. A plain-object fixture does not expose it.

Concrete input: create the normal version-1 collection, with `lifeFacts['22222222-2222-4222-8222-222222222222']` equal to:

```json
{"id":"22222222-2222-4222-8222-222222222222","revision":1,"who":{"character":"11111111-1111-4111-8111-111111111111","life":"22222222-2222-4222-8222-222222222222"},"state":"available"}
```

All ten other maps are empty. Split it with the existing `splitText('households', JSON.stringify(root))`; serve its `rootText` and `maps[].entries` through a `LayerSource` to the actual exported `Layer`; use `layer.get('households')` in an ordinary `{ households: loadedRoot }` wrapper. `householdPoint(wrapper, 'lifeFacts', lifeId)` should return present with that exact row. The source instead returns invalid. Repeating after an explicit first `loadedRoot.lifeFacts[lifeId]` read has the same result. No malformed data is needed.

**Narrow repair:** use the existing `isKeyedMap` export at `keyed.ts:452`, backed by its private WeakMap. Branch only for this genuine store identity, not for a matching descriptor shape, a property named `$keyed`, or arbitrary proxies. For a genuine map, use own-presence and the actual indexed read; undefined actual value remains invalid. For ordinary maps, take the own enumerable **data descriptor's value directly**, refuse own undefined, and return absent without indexed access when there is no own descriptor. This also avoids inherited getters on missing ordinary keys. Preserve refusal of accessors and non-enumerable data. Keep the result as `StoredPoint<unknown>`; presence does not establish row-schema or authorization validity.

Do not modify the shared KeyedMap descriptor convention to fix one adapter. Do not simply delete the `descriptor.value` check for every input. The consumer/storage module can import `isKeyedMap` without adding a new public store primitive.

## S2 — P1: Node's transaction root is rejected before the row lookup

Location: `server/households/durableStorage.ts:96–102`, specifically line 100. Store contract: `server/store.ts:255–267,299`. Worker contrast: `deploy/sqlite-store.ts:573–585`.

Node's `open()` returns a transaction/read DB proxy whose descriptor trap also supplies value undefined for an existing top-level collection. `rootOf` treats that placeholder as corrupt without performing the actual `db.households` read. This affects Node's existing household root in both legacy and entries layouts. Worker collection-root descriptors do return the actual value, so passing Worker plain maps can hide this separate Node failure.

Concrete input: persist the version-1 collection and valid life fact from S1 in a Node store. In a genuine store callback, pass its DB view directly to `householdPoint(db, 'lifeFacts', lifeId)`. Even if the maps are ordinary legacy objects, `Object.getOwnPropertyDescriptor(db, 'households')` has own value undefined; line 100 returns invalid. Pre-reading `db.households` does not change Node's descriptor implementation. An absent root correctly returns absent, explaining how a first-write-only fixture could miss later failures.

**Narrow repair:** explicitly separate the canonical transaction DB read from strict unknown-root validation. The existing adapter, which receives the trusted host transaction, should obtain own-presence and perform the actual `db.households` read once inside that transaction, preserving absence versus present-undefined. It can pass a tagged absent/present root to a strict storage helper, or materialize an ordinary wrapper containing `households` only when the trusted transaction reports the property present. An existing value of undefined must stay present-invalid; never use `value === undefined` alone as absence. Node's presence/read operations already join its tracked collection reads through `dbHas`/`peeked` and `layer.get`.

Prefer an explicit transaction-only extraction port and unknown-root parser over teaching generic `rootOf(unknownDb)` to invoke any caller's accessors. `isKeyedMap` recognizes map proxies only; it does **not** identify the Node DB proxy. Do not infer trusted DB identity from descriptor shape, `$store` presence, or `instanceof Object`. Keep plain raw `{ households: undefined }` and a raw accessor property invalid. The same remote household worker can implement this boundary in its new adapter/storage files without changing shared host files. The parent must allocate any signature changes to current callers once they exist.

## Other boundary findings and required scope decisions

**B1 — Collection-root bounds are conditional on canonical metadata.** `isHouseholdCollection` validates eleven named maps and version, then calls `Reflect.ownKeys` on the root at lines 77–79. On a canonical root this is twelve keys and does not enumerate any household map; the real Layer restores markers into an ordinary JSON root (`keyed.ts:498–503`). Good: there is no `Object.keys(map)`/full member scan here. However, a malformed root made from `createHouseholdCollection()` plus one million extra own properties incurs enumeration/allocation of all those root keys before rejection. A length check after `ownKeys` does not bound that work. The root is also revalidated for every point read.

Do not claim an unconditional constant-time unknown-input parser. Keep exact root schema rejection. Validate/canonicalize metadata once per transaction and reuse that result, without a global cache that can outlive mutation. State and enforce a bounded serialized root at the store/schema ingress if adversarial-size root data is in scope. Merely moving the same `ownKeys` call into another helper is not that bound. No child-map scan or collection-wide cleanup is justified by this repair. A proxy can always perform arbitrary work inside its traps; the trusted host boundary must remain explicit.

**B2 — Locator maps are registered but intentionally or accidentally unsupported by the row validator.** `HouseholdMapName` includes `lifeLocations` and `byCharacterLife`, but `validators` at lines 47–57 includes neither. `validateStoredRow('lifeLocations', validLocator)` therefore returns false even for `{kind:'erased', lifeId: lifeIdAbove, characterId: characterIdAbove, revision:1}` accepted by `parseLifeLocator`. Every `byCharacterLife` row also returns false. There are currently no consumers, so this is fail-closed incompleteness, not evidence of an accepted corrupt row or an executed lifecycle failure.

Before a generic adapter validator/writer uses those names, choose one explicit contract: narrow the validator's map-name type to the nine supported reducer/authority maps and route lifecycle maps through separate strict parsers; or supply both lifecycle validators. Reuse `parseLifeLocator` for locator shape, then check locator.lifeId equals the addressed key and exact owner/location crosslinks in the transaction. `byCharacterLife` needs a declared bounded point-index shape/key encoding and atomic bijection checks; the current source does not define its persisted value shape. Do not guess a string, array, or record schema, accept arbitrary `record`, invent a current-life fallback, or scan all locators to discover a life. Assignment and movement plans in `lifeIdentity.ts` are plans, not persistent index implementations.

**B3 — Shape validators are not an accessor-safe serialization boundary.** `validateStoredRow` directly invokes foundation guards after `record(value)`. For example `validateStoredRow('homes', { get id() { throw new Error('accessed') } })` invokes that getter through `records.ts:100–102` and throws. This is a concrete source prediction; no getter was run here. The map descriptor guard protects the map slot, not fields inside its value. Approved `consentView.ts` already snapshots untrusted read values through bounded descriptor-based parsing before its guards; preserve that separation in the new adapter. Validate plain serialized snapshots for incoming writes as well. Narrow the helper's documented precondition or make its unknown-input path accessor-safe; do not claim it is a total unknown parser merely because it returns boolean in TypeScript.

Host read/JSON parse failures are a separate category: propagate/abort the transaction through the host's error path, never translate a thrown storage read into absent or a successful refusal receipt. Reflection failures of untrusted objects should become invalid. `map[key]` at line 116 currently lies outside a catch; that is not by itself a reason to swallow genuine host failure. If total unknown-object validation is promised, also keep `Array.isArray` inside its reflection guard, since a revoked Proxy can throw there before `dataObject`'s present try block.

## Same-worker repair and actual acceptance gate

The bounded next patch is: (1) genuine `isKeyedMap` versus ordinary descriptor read; (2) transaction-root extraction with explicit present/absent and strict raw-root parsing; (3) accurate validator scope and immutable locator/index contract before lifecycle persistence; (4) bounded root and accessor-snapshot preconditions made explicit. Do not add alternative database implementations, initialize roots on reads, rewrite whole saves, weaken ordinary-object checks, or enable residence/payment/UI.

The cloud worker's later checks must use actual store implementations, not only hand-built proxy lookalikes. Cover Node legacy and entries plus Worker supported layouts: absent root, first authorized creation, existing row after commit and reopen, same-transaction insertion, missing key, deleted key, corrupt own undefined on a raw object, ordinary accessor with zero getter calls, inherited getter on a missing raw key with zero calls, spoofed synthetic-descriptor proxy not accepted as KeyedMap, and actual storage read failure abort with no write/receipt. Assert one addressed entry and no map key listing or unrelated row fetch in the point path. Root metadata parsing/Node physical persistence costs must be reported separately from logical row boundedness.

Once locator persistence is supplied, add exact key-to-life and character-life bijection, archive/park/legacy move preservation, collision/tombstone, and stale expected-location refusal in the same transaction. Required durable consent evidence remains atomic all-index changes, original-life/home retention, strict old-receipt replay before current loader, and restart behavior. Passing these seam checks alone cannot approve those broader properties. This review approves the concrete repair direction, not the fetched storage seam or any unreceived future implementation.


Root independently inspected the critical source branches and exact successor commit. This is source acceptance only; no fixed implementation, actual browser or durable journey is approved.
