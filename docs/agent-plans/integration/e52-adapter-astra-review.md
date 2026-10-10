# Household durable adapter source review

**MODIFY_BEFORE_INACTIVE_SOURCE_INTEGRATION.** Two source corrections are needed. This review does not approve a household endpoint, residence use, money or lifecycle authority.

Candidate `e52cae83fcbc31348f8b7160790ff37c9c22855c`, tree `bfd49bce5231d6cbdeedeeb1b33b81379ce19d31`, was read from immutable Git objects. The integration checkout remains clean at `3e3e0876fc50f3166a0d0968f8616b577da27870`. I read Root's inventory, all four adapter modules, relevant loader/reducer/identity contracts, keyed Store behavior, once composition and tests. Relative to f281 the delta is five files, the four adapter modules and durable test, with durableStorage already present but corrected. Relative to 619 the ten-file cumulative diff includes registration and domain-event discriminator changes.

1. **A1, P1: mutable facts change a committed request's fingerprint.** In durableService lines 48–55 and 87–101, the old receipt lookup recomputes its fingerprint using current actor revision, recordUpdatedAt, locationRevision and locator revision. Start from the existing register fixture and successfully commit request R for character X/life L. Advance only the canonical recordUpdatedAt by one in a later legitimate transaction, keeping X/L and the request unchanged. Retry R within the receipt window with a valid updated authority proof. The fingerprint differs and once.ts:136 throws client_id_conflict. Ordinary settlement already changes recordUpdatedAt at life-service.ts:140; travel and locator moves provide more examples. The successful operation no longer replays even though its original participant still owns it.

   Separate immutable request/participant identity from mutable commit read-set validation. Bind normalized command and exact immutable character/life for replay. If initial revision provenance must remain recorded, retain it with the receipt and compare against that original provenance rather than replacing it with current values. Preserve changed-body/kind conflicts and exact-life privacy. New operations must still validate all current source revisions. Add real-store replay cases after same-life settlement/move and after current consent changes, plus wrong-life/body refusal. Existing tests keep all authority facts and NOW unchanged.

2. **A2, P2: an absent own root still invokes an inherited getter.** durableStorage lines 88–93 reads db.households even when its own descriptor is absent. A concrete input is `Object.create({ get households() { hits++; return createHouseholdCollection() } })`. Calling householdPoint on this object invokes the getter and treats its returned root as storage. durableApply lines 80–89 follows the same pattern. This violates the strict missing/accessor boundary for malformed ordinary input. It is not a demonstrated remote exploit through the genuine Store.

   Return absence when there is no own root descriptor without evaluating the property. For apply, create a fresh root in that case. Preserve the fixed-path read when a genuine own data descriptor exists, because Node Store deliberately reports an undefined placeholder. Keep accessor, nonenumerable and own-undefined rejection. Test inherited root getter rejection and genuine Node/Worker keyed root support together.

The f281 existing-row bug is otherwise repaired. durableStorage:105 uses the genuine isKeyedMap WeakMap brand. It reads exactly the requested entry and treats the keyed descriptor as a presence marker. Ordinary maps return descriptor values without invoking row getters. Point-read storage errors propagate. All eleven maps are registered for entry layout.

Reducer/loader support reads and absence expectations are tracked. Linked accepted invitations join the read set. Trusted source verifiers run before apply. Every reducer expectation and write is validated before mutation, with count limits and duplicate-write rejection. The apply boundary accepts trusted reducer output; it is not an external raw-patch API.

The service composes the receipt and patch inside one owning Store transaction. It throws domain aborts through that transaction and formats refusal afterward, while unknown storage errors propagate. Node awaits durable file completion; Worker writes receipts and keyed entries inside one SQLite transaction and then waits for its durability barrier. A barrier failure remains uncertain commit status and must not be labeled guaranteed rollback. Events return only after the transaction resolves; duplicates return none.

Several boundaries remain deliberately incomplete:

- Canonical authority readers must verify session/device/account provenance, exact life container/locator, home incarnation and both social sources. A callback returning true does not establish that proof. The current apply layer also checks home/life/pair expectations against household mirror maps. Those projections must match canonical source facts transactionally; an external fact with a missing mirror correctly refuses.
- The service requires a session and present sessionLife even before system operations. No production system/lifecycle caller exists, and an existing lifecycle transaction must not nest this service's store.transact. Never fabricate a session or active life to make cleanup pass.
- Liability handling fails closed. Every membership ending produces a liability handoff, so leave/revoke/terminate and a close containing active members are currently unavailable. Do not activate acceptance without a safe termination path.
- Returned events are not a durable outbox. A crash after commit but before delivery followed by a duplicate loses notification. The design avoids duplicate return on replay, but does not prove exactly-once or eventual delivery.
- once may prune expired receipts during replay and periodically recount global Node receipt use. No household mutation is narrower than no entire-store mutation. Root validation reflects all keys before rejecting oversized corrupt roots; canonical point reads are bounded, arbitrary corrupt-object inspection is not strictly capped.
- lifeLocations and byCharacterLife have no production validators/writers here. The five tests cover synthetic register fixtures only. The Worker-labelled tests exercise createSqliteStore through node:sqlite/testStorage, not actual workerd HTTP. They do not prove canonical authority, other durable commands or event delivery.

Recommend one next host-binding unit after A1/A2: bind existing authenticated RouteRequest session resolution and exact existing-life authority to an inactive register-only service composition. Use request.requireSession inside the same transaction. Its actual shared source is protocol.ts:172–182, with Node server.ts:230–237,370 and Worker cloudflare-worker.ts:623–631 enforcing cookie/device/account and actor-header identity. Require an explicit current pin, the exact existing city slot, immutable identity and matching locator through inspectLifeIdentity. Do not call settleCity, mint a missing life, or use characterCity's newest-life fallback as identity authority.

For the original home, estate.home plus the current Residence or estate.away entry is the real source in life.ts:528–566. mainHomeUnit at residence.ts:16–19 supplies only city/LGA, not a stable home incarnation. Require a canonical HomeId/epoch/provenance binding; refuse absent or stale binding. e52 has no writer that can supply this prerequisite. The finite unit can truthfully prove authenticated refusal without mutations now; a permitted register proof must wait for actual writer-created life/home facts. Do not disguise synthetic seeded maps as that writer. Keep invocation disabled and shared host files under the one existing serialized cloud integration writer.

No test, compiler, build, runtime or browser was executed. Exact corrected-source compiler and genuine Node/workerd persistence, replay and failure evidence remain required before integration acceptance can advance.

| Immutable path | SHA-256 |
| --- | --- |
| server/households/durableStorage.ts | `00bb3cebe51ed7796485e64eead4995c369bb8287fa2c391bfa70a2fd0bb83f0` |
| server/households/durableReads.ts | `7410741e57a49ebd764c0ccb000c172138342bf32f52a987a2731173b9d24cbd` |
| server/households/durableApply.ts | `e4fb1bfda1fbdbeb2c3029e2f077aba7590643eb54c7ccb2fb4fb3d1446e75ae` |
| server/households/durableService.ts | `ce2eed20b0ecfdf4b0f7a455e6227a0988e138046d2e4357683b068bd35da9fa` |
| server/households/durable.test.ts | `0bf8e6c2ba8afd73ab1444f3ec980858be735928f1771100bc47d4d792a56f86` |
| server/households/consentView.ts | `78e4eb7e451b7082a8c69b2f95f86536df90bbe3d695fbe37661ab593b3340d8` |
| server/households/consent.ts | `c611ebf9ceda2e44902829b34e74fe42b3b190ba9c6a9b93ffa3544b34df59c7` |
| server/households/records.ts | `ec8b77b1ba951e5b26f2a17e885b13f22a28c5de404c64d366f21ed7935f146d` |
| server/households/lifeIdentity.ts | `31e457f73c6047147089c33ea76a802bdb694ff4485dda4b10776903b7bc594d` |
| server/keyed.ts | `fcb0980c057d9e658c64e5e69512c2b60cb7eb39365a9c9d5475872b9e92af68` |
| server/routes/once.ts | `6072fa044253a38d35b948a33163ea0a2e787ef197bcce3d3760393be94b7046` |
| server/types.ts | `4c21ae4c7b1166c9cd83bd8052a8e63ca6b634335168954b5a3b237c51c91b07` |
| server/store.ts | `4c739e503df0423661737c0805162bd887ae06669094acdbb868733a67c93296` |
| deploy/sqlite-store.ts | `a54149ccc1f4f1a4db69379a041b0fcd7c90f5830fbcbe7393d261c690f58b5d` |
| server/records/store.ts | `7155d954a77951770560ed559ddfede1a449bb45450d34175709e1468368e4d9` |
