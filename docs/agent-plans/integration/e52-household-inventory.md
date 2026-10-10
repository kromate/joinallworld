# Household durable-adapter source inventory at e52

## Pins and lineage

- Read-only object: `e52cae83fcbc31348f8b7160790ff37c9c22855c`, tree `bfd49bce5231d6cbdeedeeb1b33b81379ce19d31`, published as `origin/codex/cloud-household-consent-adapter-20261010`.
- Previously public view boundary: `619b8fbc7d1837d6225ce6eb0d0871739eb22d75`, tree `e842f10871ba4e33152a11e0702a554fafd85168`.
- Previously public storage-registration commit: `f28182fe08aaf9efecd412c64340dc609a66883d`, tree `285a5987858302d0790d8ee355121bc0f8b92264`. It is a sibling of internal `65e649869e15b12d8ae106115b9b38a4ba78d488` and has the exact same tree, so `f281` supplies the registration state used by the adapter line.
- Linear adapter history after `619b8f`: `ba4031a0` durable storage boundary; `65e64986` registration/receipt kinds; `86b36df7` transaction adapter and durability tests; `d3a21385` test-only Lagos fixture loading; `e52cae83` test-only receipt-key typing.
- Latest commit `e52cae83` changes only `server/households/durable.test.ts` (+3/-1): it annotates the synthetic once descriptor id as a timed template literal. Its parent `d3a21385` also changes only that test (+3), loading Lagos content for `createLife`. The production implementation is therefore the `86b36df7` state plus no later production edits.

## Cumulative changed paths and blob hashes

Relative to public `619b8f`, `e52` changes ten files: `consent.ts` (+6/-6 event discriminator rename), `records.ts` (+5/-5 matching event types), `keyed.ts` (+6 household keyed specs), `routes/once.ts` (+4/-1 household light receipt kinds), `types.ts` (+5/-1 identity/database registration), and five new adapter/test files. Relative to public `f281`, only the four adapter modules, their test, and the keyed-proxy adjustment in `durableStorage.ts` differ.

| e52 path | blob SHA-1 |
|---|---|
| `server/households/consent.ts` | `41f184967dc63cd8c38f2cd40a202a3bd6262cbd` |
| `server/households/records.ts` | `667b65222df5b35c37f178d5ac52a10e43f7da6c` |
| `server/households/durableStorage.ts` | `83b942fccb2c82f9a801386403a67ade63302224` |
| `server/households/durableReads.ts` | `89cc862e652dea21c990790575e9afc492e6d698` |
| `server/households/durableApply.ts` | `cbfe1ae05c6fd9122edeb3b77ef746353df4ca39` |
| `server/households/durableService.ts` | `51f52cc3247df20e121d4efaf5b9cf54dddc2dc1` |
| `server/households/durable.test.ts` | `a280a8e07408f128e19506c620e04e9f46f0139a` |
| `server/keyed.ts` | `7820ac705c9121a37842609f3a692442e8876081` |
| `server/routes/once.ts` | `06c7d47e6321224f76b59de773ffd3e24ea9a951` |
| `server/types.ts` | `849990d77663a1382bcf50ea38018bce7aece24c` |

## Actual exported boundary

- `durableService.ts:9-29,65-132` exports `ConsentReceipt`, `ConsentServiceResult`, `ConsentServicePorts`, and `executeConsentCommand`. The service accepts only a Store/once/time context, host `resolveSession` and `authority` ports, a once descriptor, and unknown command input.
- `durableReads.ts:9-29,88-95,181-265` exports trusted point/fact/authority types, bounded snapshotting, life-authority validation, and `createDurableConsentReads`. It tracks point fingerprints/revisions, exact trusted-source verifiers, and caps indexed character/life reads at 28/11.
- `durableApply.ts:11-12,70-101` exports apply result types and `applyConsentPatch`. It validates all reducer expectations and writes before the first mutation, caps expectations/writes/events at 128/128/32, rejects duplicate/unexpected rows, and refuses any liability.
- `durableStorage.ts:16-41,66-78,100-148` exports schema/map/root/point types, root validation, bounded `householdPoint`, mutation-only root creation, and row validation. Reads never initialize the root; own undefined/malformed data is invalid. At `e52`, keyed proxy reads use `isKeyedMap` and a single requested entry (`100-119`), without enumerating the map.

## Transaction, once, rollback, and Store wiring

- `executeConsentCommand` snapshots and parses the command before entering `store.transact` (`durableService.ts:65-83`). Inside that exact transaction it resolves the session and trusted actor life, verifies the actor point, and derives the receipt fingerprint from command plus actor/life revisions (`84-92`).
- It probes `ctx.once` with a private thrown symbol. A matching receipt returns `duplicate:true`, no events, after receipt fields and actor identity are rechecked (`93-103`). This occurs before home/view loading.
- A new operation creates tracked reads, loads the consent view, runs the reducer, and aborts when liabilities exist (`105-110`). Within the same `ctx.once` callback it re-verifies actor and adapter read sets, applies the patch, and returns the receipt (`118-126`). The service returns events only after the owning Store transaction resolves (`16-22,126-127`). Known consent aborts become `{ok:false,code}`; storage failures propagate for Store rollback (`128-131`).
- `server/types.ts:58-69` adds optional immutable `CityLifeRecord.identity`; `745-783` adds optional `Database.households` and registers it in `DATABASE_KEYS`.
- `server/keyed.ts:122-140` registers all eleven household maps for entry layout. `durableStorage.ts:100-119` is the matching Node/Worker lazy-map point reader.
- `server/routes/once.ts:50-65` classifies the eleven `household.<operation>` receipt kinds as light. The caller's supplied kind/fingerprint are replaced by `household.${command.op}` and the actor-bound fingerprint (`durableService.ts:76-91`).

## Registration and authority gaps

- There is no HTTP, system, or service endpoint registered by this branch. A full-tree search at `e52` finds `executeConsentCommand` only in its definition and `durable.test.ts`; `createDurableConsentReads` and `applyConsentPatch` likewise have no production caller outside their composition in `durableService.ts`. The service itself states that it registers no route or system endpoint (`durableService.ts:61-64`).
- No production implementation supplies `ConsentServicePorts`. Session authentication is still an abstract same-transaction `resolveSession`; actor life, system lifecycle authority, home provenance, life facts, and pair facts are abstract `TrustedConsentAuthority` readers (`durableService.ts:24-29`; `durableReads.ts:13-22`).
- `CityLifeRecord.identity` is optional and the branch adds no canonical lifecycle writer that assigns it. `lifeIdentity.ts` provides parse/inspect/plan functions, but full-tree search finds no production invocation of the assignment/move planners.
- The maps `homes`, `lifeFacts`, `pairFacts`, `lifeLocations`, and `byCharacterLife` are storage slots, not canonical facts by themselves. No production writer or synchronization binding populates them from session/life/home/social lifecycle authority.
- System causes (`blocked`, `unfriended`, life changes, erasure, home retirement) have validators but no registered lifecycle invocation. Returned domain events have no host dispatcher in this branch.
- Money is deliberately inactive: `durableStorage` has no liability store, the apply layer refuses liabilities, and the service aborts when the reducer produces any (`durableApply.ts:64-73`; `durableService.ts:108-110`). This inventory does not approve household, privacy, consent, or money activation.

## Durable test inventory

`server/households/durable.test.ts` has five cases; all exercise synthetic register fixtures only:

1. **storage edge rejects accessors without invoking them and propagates point-read faults** (`108-127`): an accessor row becomes invalid without calling the getter; a point-storage descriptor fault propagates.
2. **Node file Store: durable register receipt reopens and duplicate avoids current home loading** (`129-175`): first register succeeds with `household-opened`; household and once receipt persist; reopening returns a duplicate, performs zero home reads, and retains the open household.
3. **Node file Store: a failed durable write rejects without household or once receipt** (`177-191`): injected file persistence failure rejects and leaves both household and receipt absent.
4. **Worker SQLite Store: entries commit and close/reopen receipt replay share the real transaction layer** (`193-229`): household entries and one receipt commit, survive reopening, replay as duplicate with zero home reads, and retain the open household.
5. **Worker SQLite Store: SQL entry failure rolls back the household row and once receipt** (`231-246`): an SQL trigger failure rejects and rolls back both row and receipt.

The suite does not exercise invite/accept/decline/cancel/expire/leave/revoke/terminate/close through this durable service, production session/life/home/pair/lifecycle bindings, liability settlement, event dispatch, or an HTTP/system endpoint. No tests or runtime commands were executed for this inventory.

