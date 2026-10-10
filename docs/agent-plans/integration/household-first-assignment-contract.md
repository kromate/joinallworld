# First household identity assignment: transaction contract

**Decision: approve the following provisional-ID / real-draft staging flow as the narrow adapter prerequisite.** This corrects the earlier contract's ordering: generating an ID in memory may precede the receipt probe; inserting canonical metadata into an isolated Store draft may precede the async loader. Neither is a durable preflight write. Durability occurs only when the outer transaction successfully commits the assignment, consent patch and receipt together.

This is a design/source review against e52cae83fcbc31348f8b7160790ff37c9c22855c, not approval of an unreceived repair. A1/A2 acceptance and canonical lifecycle/home writer allocation remain prerequisites. No source, tests, compiler, server or browser was executed or modified. Exact pins are in the JSON.

## Existing APIs and the actual ordering conflict

- durableService.ts:81–93 authenticates, calls async trusted.sessionLife(), requires a present LifeAuthorityFact, and constructs its fingerprint before ctx.once.
- lifeIdentity.ts:222–247 can make a pure AssignmentPlan from an exact existing-unidentified record. newLifeId() only provides a candidate; the function itself does not insert metadata.
- routes/once.ts:126–156 is synchronous. It checks the existing receipt and quotas before invoking run(), and writes the returned success in the same Store draft. Its callback must not be async.
- consentView.ts:161–172 requires present canonical home and session-life facts for register. durableReads.ts:225–230 also compares the supplied actorProof to the freshly read sessionLife. Passing a fabricated present actor while the real record remains unidentified would violate that boundary.
- applyConsentPatch expects actual home/life authority rows in the draft. Reducer expectations cannot be satisfied by a separate synthetic read map.
- The outer Store callback already permits awaiting the loader. Both actual Stores isolate the draft until the outer callback succeeds; a throw aborts the draft.

Therefore: keep once and the async loader unchanged. Change the household service's identity preparation and canonical draft-write seam. Construct the durable reads only AFTER canonical staging, with a fresh post-staging actor proof.

## Concrete proposed private signatures

These names describe additions to the household adapter, not APIs that currently exist. They stay private to the canonical writer/service; none is supplied by a request.

```ts
type ActorIdentityRead =
  | { readonly kind: 'identified'
      readonly who: Identity
      readonly verifyOwnership: () => boolean }
  | { readonly kind: 'unidentified'
      readonly slot: SlotSnapshot
      readonly verifyUnidentified: () => boolean }

type FirstAssignmentPlan = Readonly<{
  kind: 'planned'
  identity: Identity
  assignment: AssignmentPlan
  verifyBefore: () => boolean
}>

type AppliedAssignment = Readonly<{
  kind: 'draft-applied'
  identity: Identity
  verifyAfter: () => boolean
}>

// All operate on the caller's exact Db draft. Parsers return a tagged refusal
// or throw a typed abort; storage failures propagate.
inspectActorForReceipt(db: Db, session: SessionRecord): ActorIdentityRead
prepareFirstAssignment(
  db: Db, actor: Extract<ActorIdentityRead, { kind: 'unidentified' }>
): FirstAssignmentPlan
stageFirstAssignment(db: Db, plan: FirstAssignmentPlan): AppliedAssignment
```

The actual implementation must include typed refusal results in these signatures or consistently use the service's typed abort. These are interface sketches, not executable type stubs. AssignmentPlan's character-association mismatch must be corrected under the canonical writer contract before it can be applied.

inspectActorForReceipt proves current authenticated ownership of the exact stored life/slot. It does not call settleCity, newest-life fallback or a getter that initializes identity; it does not require current membership, friendship, home availability, current location eligibility or a current “available” status to replay an otherwise authorized retained receipt. A missing or contradictory locator on an identified record is corruption, not an unidentified record.

prepareFirstAssignment requires an explicit authorized first household mutation and the exact existing record. It calls the server's opaque-ID generator once, validates the ID, checks canonical point absence including tombstones, and freezes a plan. It neither changes db nor returns TrustedPoint<LifeAuthorityFact>. A planned ID is not stored authority. Collision refuses; no derived IDs, overwrite, reset or unbounded retry.

stageFirstAssignment is a synchronous canonical writer. It checks all original source/absence witnesses immediately before writing, writes the real record's identity plus the actual locator/association/life-fact rows into the existing draft, then returns a verifier for their precise post-write state. It must not write any receipt or emit effects. A complete registration preparation may also stage a separately validated canonical home binding in this same draft; no caller-provided HomeId alone proves a dwelling.

## One transaction, step by step

1. Before the transaction: validate onceId and snapshot/parse the request exactly as the service currently does. Keep immutable normalized command fields; command-supplied epoch/revision remain request identity. Do not replace them with current values.

2. Inside the existing outer store.transact callback: resolveSession(db), then inspectActorForReceipt(db, session). Record exact session/device/account/current-slot provenance in its verifier.

3. **Already identified:** construct the A1 version2 stable fingerprint from the fixed normalized command and the stored immutable CharacterId/LifeId. Probe ctx.once with the private absent sentinel. Return a strictly validated known-version duplicate with events=[] before constructing mutable eligibility readers. On a stable conflict only, follow A1's exact legacy probe if the required genuine legacy actor facts can be read. Never use a plan or a proposed identity for legacy fallback. Then, only if absent, enter the new-operation branch.

4. **Unidentified:** verify this command is an explicitly allowed first-assignment mutation; do not automatically make every command an enrollment operation. Prepare a pure FirstAssignmentPlan with a random provisional LifeId. Use that ID with the exact character and unchanged command to construct the same A1 stable fingerprint. Probe ctx.once:
   - Sentinel from the callback proves that the existing helper found no live matching/reusable receipt and passed quota checks at that moment. Continue.
   - client_id_conflict is a terminal refusal for this unidentified branch. Do not run the markerless legacy fallback, guess the historical identity, inspect an old result to adopt its LifeId, or treat conflict as absence.
   - Any returned receipt is also a terminal inconsistency/refusal: an unidentified canonical record cannot prove ownership of an earlier household success, even if the candidate fingerprint/result happens to match. Never return it as an authorized success.
   - Expiry, quota, malformed result and unknown storage errors refuse/propagate without staging anything.

5. Once absence is established, immediately recheck the plan's original witnesses and call stageFirstAssignment(db, plan). This is a real mutation of the isolated Store draft, not of the committed database. It is the canonical writer's exact source-proven insertion, not a synthetic present map. The first actual durable insertion still depends on later successful consent/receipt commit.

6. Construct ports.authority(db, session) again if needed so it reads the draft's newly materialized state. Await a fresh sessionLife proof. Require its immutable identity to equal the planned identity and its exact locator/source rows to match AppliedAssignment. Pass this post-staging proof to createDurableConsentReads. Do not pass the earlier unidentified proof or make its absence verifier magically answer true after writing.

7. Await loadConsentView, run reduceConsent, reject unsupported liability handoffs, prepare the minimal version2 receipt. All occur within the same outer transaction. Any refusal now must THROW the service's typed abort out of the Store callback; returning {ok:false} from that callback would commit the tentative identity. The existing service already uses this outer-abort pattern. No GET/preflight persistence and no nested transaction.

8. Call ctx.once again with the exact descriptor/fingerprint used by the probe. Its callback is synchronous:
   - Set an internal didRun flag.
   - Recheck AppliedAssignment.verifyAfter(), authenticated ownership, the fresh actor proof and reads.verifyReadSet().
   - applyConsentPatch(db, result); throw on any refusal, malformed patch, unexpected liability or write failure.
   - Return only the version2 minimal success receipt.

   Outside this synchronous callback but still inside store.transact, strictly validate the returned receipt. If didRun is false on this new-operation branch, throw and discard the draft rather than returning a duplicate that accidentally commits the staged assignment. This should not happen under ordinary serialized Store use, but protects the seam from unexpected receipt insertion across an awaited step. Do not run the reducer/events again or assign a fresh intent.

9. Return the service's success from the outer callback only after that final receipt was written. The caller receives success/events only after store.transact durably resolves. Do not emit from staging or from a failed transaction. Existing post-commit delivery limitations are unchanged.

The second once call rechecks time/quota. Its failure after staging must abort everything. The helper may initialize/prune its receipt map during a probe; these are ordinary tentative draft changes, rolled back on a failed outer transaction. No broader claim that once is a read-only lookup is made.

## Correct expectation phases

Pre-stage witnesses include absent identity on the exact record, absence of the candidate locator/association/life fact (and fresh home rows if applicable), unchanged record/state references, salt, timestamp, exact selected slot, canonical residence source and session/account/device ownership.

Post-stage witnesses are explicit replacements for only the paths this writer intentionally changed: the precise inserted metadata and canonical rows with their planned versions/IDs. All other sources retain their original exact witnesses. Validate every precondition before the first write; construct the post-state proof from the actual stored draft values, not from the plan alone. Any unknown extra mutation fails verification.

The reducer's life/home revision expectations now refer to the actual rows inserted into this same draft. DurableConsentReads tracks their post-stage values plus the remaining canonical/index rows. The outer transaction owns atomicity against committed storage; do not retain a pre-stage “absent” read in the loader read set and later weaken its verifier to accommodate the insertion.

## Retry and failure behavior

Successful first attempt persists LifeId X and the version2 receipt together. On an unchanged retry or cold restart, inspectActorForReceipt reads X from the canonical record and its locator, takes the identified branch and derives the same stable fingerprint. No new ID generator call or mutable loader is needed.

A failed attempt may have sampled X and written it into a discarded draft, but stores neither X nor a success receipt. Retrying the SAME unexpired intent can sample Y; there was no committed successful action with X to preserve. This is not an automatic new intent, charge or payment retry. The request ID and command remain unchanged. If the commit acknowledgement was uncertain, fail closed per Store behavior and reopen; committed storage must contain both identity and receipt or neither. Do not assume absence or immediately retry while the Store is uncertain.

A legacy markerless success with missing current identity cannot be recovered by this mechanism. It refuses without rewriting/deleting the old receipt. The A1 legacy replay limitation remains intact.

## Narrow scope and unresolved APIs

Required private changes: durableService's actor inspection/branching and abort discipline; a real canonical assignment writer/proof; corrected identity/association validation and the minimum storage validators for its actual rows. Existing loader, reducer, general once helper, Store semantics and unrelated Business code need no semantic relaxation.

The present ConsentServicePorts.authority cannot describe an unidentified record. Add the separate inspection/preparation seam; do not extend TrustedPoint.present to mean “planned”. The canonical source readers/writers and lifecycle hooks are still absent in e52, so the new signatures cannot honestly be implemented by stubs.

A separate concrete registration-input issue remains: current register Command already requires homeId, householdId and epoch. This flow resolves LifeId ordering; it does not authorize a browser to invent a home binding. The allocated canonical writer must specify the trusted exact-dwelling selection and server-ID construction/retry mapping for that existing input, or return a precise not-ready refusal. It cannot make a home present solely because the command supplied an ID. Keep this explicit dependency before exposing a public first-registration endpoint; no new persistent preflight endpoint is approved here.

The first-assignment operation whitelist also needs the host contract. Existing invitations pin recipient LifeIds, so an owner reading an unidentified recipient is not allowed to enroll them. This flow must not silently turn owner invite or recipient accept into assignment of a different identity. No production caller exists to claim that issue is already solved.

Required remote evidence: genuine Node/file and Worker/SQLite first success and reopen replay; failed loader/reducer/final-once/apply/commit leaves no identity; concurrent first requests produce one stable stored identity; old markerless receipt + unidentified record refuses; wrong life/body/kind refuses; no generator call on identified replay; unexpected duplicate after staging aborts rather than commits; unchanged genuine authority read-set failure aborts. Bind all evidence to repaired source. No runtime acceptance is granted by this report.
