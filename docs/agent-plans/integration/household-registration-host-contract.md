# First household registration: host request contract

**Decision: approve this concrete interface contract for the next inactive implementation slice.** It settles the initial home-selection and generated-ID ordering questions. It does not approve activation: canonical lifecycle preservation, closure/removal/liability handling and real host evidence remain mandatory.

Sources: current canonical game/host source `3e3e0876fc50f3166a0d0968f8616b577da27870`; separate inactive household source `e52cae83fcbc31348f8b7160790ff37c9c22855c`. The checkout remains clean at 3e3. No implementation or execution occurred. JSON contains source hashes.

## Chosen finite product boundary

Implement two explicit authenticated mutations:

- **Register the current owned dwelling:** create an empty household for the exact home the actor currently owns and lives in. No invitation, member, effective residence selection, payment or room entry is created.
- **Enable invitations for this life:** assign durable identity to the caller's exact existing life so a later separately authorized invitation can name it. This is useful for recipients, including a normal guest life without a home. It grants no home access, does not settle onboarding and does not let an owner enroll another person.

The first registration slice selects only `estate.city`'s current residence with `estate.living === 'own'`. It does not select an away residence, someone else's home, a temporary Family/visit room, the rented dwelling represented by property.house, or a house using furniture/LGA alone. This is an explicit initial-slice restriction, not a permanent product rule prohibiting rented or multiple homes. Registering an additional currently occupied owned home does not change estate.home.

Existing estate source supports this precise selection: Residence has living/lga/plot/tier, EstateState contains current city and away/home, hasPlace requires a local government and a settled life, and property.house retains the last rented tier even while living is own. Therefore property.house alone is specifically the wrong owned-home selector.

## Public request and read-only conditions

Proposed routes (new, not existing): `GET /api/households/self-context`, `POST /api/households/register-owned`, and `POST /api/households/enroll-life`. The GET uses only the read-only projection described below. Each POST owns exactly one Store transaction.

```ts
type LifeCondition = Readonly<{
  characterId: CharacterId
  lifeId: LifeId | null
  cityId: CityId
  characterRevision: number
  recordUpdatedAt: number
}>
type BindingCondition =
  | Readonly<{ kind: 'unbound' }>
  | Readonly<{ kind: 'bound'; homeId: HomeId; epoch: number; revision: number }>
type OwnedDwellingCondition = Readonly<{
  living: 'own'
  lga: LgaId
  lgaAt: number | null
  plot: PlotAddress
  tier: HouseTierId
  binding: BindingCondition
}>
type RegisterOwnedRequest = Readonly<{
  version: 1
  clientId: TimedId
  operation: 'register-current-owned'
  expectedLife: LifeCondition
  expectedDwelling: OwnedDwellingCondition
  permissions: readonly ['sleep', 'cook']
  confirmation: 'create-empty-household'
}>
type EnrollLifeRequest = Readonly<{
  version: 1
  clientId: TimedId
  operation: 'enroll-current-life'
  expectedLife: LifeCondition
  confirmation: 'enable-household-invitations'
}>
```

Use existing parsed/branded ID/domain types; HTTP input is unknown until exact-key/data-descriptor validation. Numbers must be finite safe integers in their domain; timestamps nonnegative; epoch/revision use the actual canonical version rules. Plot coordinates use existing validPlot and the exact city's lgaOf validation. Reject extra keys, accessor input, wrong tuple order, arbitrary permissions, arrays in object positions, invalid IDs and oversized input. Bounded JSON body limit: 4096 bytes for these fixed small shapes; no arbitrary text.

An authenticated read-only household context projection supplies these expected fields from the exact canonical current record; it returns lifeId:null only for a genuinely unidentified record and binding:unbound only for genuine absence. It uses Store.read and strict current-pin resolution, never settleCity, normalizeCharacter, ID generation, registration, once or renewal writes. This is a view, not a persistent preflight reservation. Expose only the actor's own condition fields and truthful refusal reason; never expose salt, locator/session keys, accounts or another owner's home.

The conditions are stale-view fences, not authority. On a NEW mutation require exact equality against current canonical source. On an old successful replay do not recheck them against today's mutable values. A request with lifeId:null remains exactly that request on retry after assignment; the receipt's immutable life resolves its historical outcome.

Before replay, expectedLife.characterId must match the authenticated public actor. Existing host actor headers remain checks, not authority. If a non-null expectedLife.lifeId is supplied, it must be the exact current authenticated stored life for this endpoint; no lookup of “latest life”. Current city/revision/time/home/permission eligibility are checked only after receipt absence.

## Stable public intent fingerprint, independent of generated IDs

Use new once kinds `household.register-owned-v1` and `household.enroll-life-v1`. Add those two constants to LIGHT_KINDS under the serialized foundation writer; this is classification only, with existing quotas/windows/storage semantics unchanged.

Construct a fixed-order canonical ARRAY of the wrapper version, operation, authenticated CharacterId and every parsed public request field except clientId (the separate once key). Include all supplied expected-life and dwelling conditions, exact permissions and confirmation. Encode bound/unbound distinctly. Do not stringify arbitrary user object order. Do not include generated LifeId/HomeId/HouseholdId, sampled current revisions, time, locator/session/account keys or a freshly translated private command.

Fingerprint: `hh-host-v1:` followed by lowercase SHA-256 of that canonical UTF-8 array. This is 75 ASCII characters, below once's 96-character threshold, so the helper stores it verbatim instead of reducing it with hash53. Existing source uses WebCrypto SHA-256 on both hosts; the wrapper may compute it asynchronously before the synchronous once call. It is a request digest, not an authority ID. No secret/HMAC or provider configuration is needed.

The fingerprint intentionally does not add a generated current LifeId. Exact life binding instead lives in the strict successful receipt and is checked before ANY result is returned to the client. The public expectedLife.lifeId, if supplied, is still a request field covered by the digest. This allows one original lifeId:null intent to replay after the server assigns its life.

Private stored receipt shapes:
```ts
type HostReceipt =
  | Readonly<{
      format: 'household-host-v1'; operation: 'register-current-owned'
      ok: true; actorCharacterId: CharacterId; actorLifeId: LifeId
      homeId: HomeId; householdId: HouseholdId; epoch: number
    }>
  | Readonly<{
      format: 'household-host-v1'; operation: 'enroll-current-life'
      ok: true; actorCharacterId: CharacterId; actorLifeId: LifeId
    }>
```

The result contains no home snapshot, names, location history, financial fields or account identifiers. Public response may return those minimal own identifiers plus duplicate, clearly as historical outcome; a current household projection is a separate authorized read. Strict parser requires the known format, exact operation and actor/life equality. Registration success does not claim membership, room entry or current household availability.

Proposed wrapper signatures: `executeRegisterOwned(ctx: Pick<RouteContext, 'store' | 'once' | 'onceId' | 'now'>, request: RouteRequest, ports: CanonicalHouseholdWriterPorts, input: RegisterOwnedRequest): Promise<HostMutationResult>` and the corresponding `executeEnrollLife(..., input: EnrollLifeRequest): Promise<HostMutationResult>`. `HostMutationResult` is a tagged success containing the strict HostReceipt, duplicate flag and post-commit events, or a typed refusal code. `CanonicalHouseholdWriterPorts` is the real transaction-local writer/proof seam defined in the first-assignment contract, expanded to prepare/stage the exact current-owned binding; it is host-owned, never request-supplied. These proposed types must be implemented concretely, not as permissive casts or placeholder authority maps. RouteRequest supplies same-transaction requireSession. A private `prepareRegistrationInDraft(db, session, command, trusted)` performs only the existing async loader/reducer preparation and returns the validated patch/read-set proof; it neither opens a transaction nor writes a second receipt.

## Single-transaction sequence

1. Snapshot/parse request and validate onceId. Enter the existing Store.transact. Resolve the real session/device/account and exact current pinned life without settlement or minting. Create an identity inspection proof: identified, genuinely unidentified, or corrupt. Corrupt is terminal.
2. Compute the public-intent fingerprint. Probe ctx.once with the matching new kind and the private absent sentinel.
3. If the probe returns a receipt, require its exact format/operation/actor and an ALREADY IDENTIFIED canonical current record whose LifeId equals receipt.actorLifeId, with valid locator/ownership crosslinks. Only then return historical duplicate with no events. If the current record is unidentified, wrong-life or inconsistent, abort; never adopt the receipt's ID. No new ID is generated. Do not read current dwelling eligibility first. Same actor after normal travel/settlement can replay; switching to a different legacy life refuses, while switching back may replay within the once window.
4. If the probe conflicts, abort. No legacy fallback for these new wrapper kinds, no conflict-as-absence and no new client intent. Expiry/quota/unknown errors retain existing handling.
5. On absence, validate the expected-life conditions against the currently inspected record. Resolve the selected current owned dwelling and validate every expected dwelling field. Registration requires hasPlace, living:own, a valid non-null plot matching the current LGA, no unreconciled estate.old, a coherent existing/new binding and normal activity guards. A missing plot or pending home relocation returns home-address-pending; do not initialize a new home or start a move. These checks derive the right to register from the authenticated exact life plus its canonical owned residence; plot/LGA never identifies another owner's home or grants land title.
6. Enrollment requires only the exact existing normal active life, consistent expected fields and ownership. It does not require a home, friendship, settled onboarding or home-use eligibility. A new empty session without a CityLifeRecord refuses existing-life-required; this endpoint never creates gameplay state. System commands, GET, owner invite, accept and another person's read are NOT first-assignment entry points.
7. For a genuinely unidentified life, sample a server opaque LifeId and verify collision/tombstone absence; prepare and stage the real canonical identity/locator/character-life association/life-fact rows in this isolated draft. For an identified life preserve its ID. Revalidate all before-source witnesses before the first write. This is the accepted first-assignment draft flow, now simpler because no candidate ID is needed for the public receipt probe.
8. For registration only, prepare the canonical current-owned-home binding. Unbound: sample server opaque HomeId (also the residence incarnation identifier), verify absence, assign metadata to this exact retained current Residence, and create canonical HomeAuthorityFact with owner equal to the actual actor identity, epoch=1, revision=1, lifecycleRevision=1. Derive city/address from this exact stored dwelling; originalHome means estate.home===estate.city, not “the only home”. Capture a bounded allowed scene from this actual current room, with its first sceneRevision and real capability facts. Never invent available furniture/capabilities. Bound: reuse that exact valid HomeId/epoch after all owner/incarnation crosslinks pass; do not remint for an unavailable or corrupt binding.
9. Point-read the HomeIndex. If it names an existing household, return household-exists as a typed abort with no new writes. Do not treat a missing named household as absence. Otherwise sample server HouseholdId, check absence and build the existing private command:
   `{op:'register', householdId, homeId, epoch}`.
   No public caller supplies the generated IDs or the private reducer command.
10. Construct fresh trusted authority/read-set proofs from the real staged draft. Await the unchanged loadConsentView and reduceConsent. The generated private command is ONLY reducer input; it is not the wrapper receipt fingerprint.
11. In the final synchronous ctx.once callback with the original public-intent descriptor: check original untouched sources, exact post-staging insertions, fresh actor/read-set proofs; applyConsentPatch; return the strict HostReceipt. Enrollment instead verifies and commits only its real canonical identity metadata plus its enrollment receipt, without calling the consent reducer or creating a household/index of members.
12. Final callback must run on this new-operation branch. If it unexpectedly returns an old receipt, throw so staged metadata cannot leak into a duplicate commit. Every refusal/error after staging throws through Store.transact; converting it to a public refusal occurs outside the transaction. Success/event delivery is after durable acknowledgement only.

There is one outer transaction and one stored receipt for each wrapper. Do NOT call executeConsentCommand as a nested service from inside this callback or write both a wrapper and private-command receipt. Extract/reuse its transaction-local loader/reducer/apply preparation logic. Keep its existing external compatibility entry for e52/A1 operations separate.

All sampled IDs are server UUIDs validated with the existing brands. Collisions refuse without regeneration loops or changes to existing rows. A failed attempt persists no IDs; the same original request may later sample different candidates. A committed attempt persists IDs and receipt together, allowing exact replay without regeneration. On uncertain commit, obey the Store's fail-closed/reopen semantics.

## Point selectors and read-set ownership

Use the cookie/device/account point chain already supplied by sessionOfCookie, then the exact valid character pin and own session.cities[pin.city] record. No global session scan, public-id lookup selecting a newest life, body-selected alternate city, archive fallback or authoritative read from a transient room.

Registration reads one current residence directly from that record; it does not enumerate away homes. When already bound, read exactly its canonical HomeId row, HomeIndex, named household if any and owner CharacterIndex. The candidate identity/home/household absence checks are fixed point reads. Canonical identity association validation follows the corrected multi-life design. The existing bounded hosted/joined index cap remains the reducer's limit.

Current allowed scene capture must obey a named finite snapshot budget and return an explicit not-ready refusal if exceeded or unsupported. No whole-owner LifeState, inventory or private saved content enters the home projection. The canonical writer must preserve this snapshot/identity across travel, sanitation, home mutation, parking and account changes before activation.

The plot is descriptive stored home location, not a same-Store proof of the separate world shard's current allocation. Registration creates no spatial entry right, and actual entry remains gated on the separately reconciled address/room authority. Do not insert a shard read outside this transaction and pretend the Store expects it.

## Legacy compatibility and ownership allocation

e52 markerless receipts and A1 version2 receipts keep their bytes, kinds and original compatibility path. These new wrapper kinds use a different format and cannot reinterpret old results. Reusing an old id under a wrapper naturally conflicts; it never deletes, migrates, adopts an old LifeId, or changes the old fingerprint. The old command service's A1 dual-probe remains available to its exact old interface and preserves its documented mutable-provenance limit. No historical household endpoints are assumed.

Minimal writer allocation: the existing Cloud household writer implements private host-request parser/fingerprint/receipt wrapper and read-only self-context projection, plus the actual canonical writer and service transaction-local preparation extraction. The single existing integration writer owns route registry/host-port wiring, shared types and the two LIGHT_KINDS additions, serialized with that same unit. Do not modify general once implementation, Store APIs, Business, Family or wallet rules. Both wrappers remain unregistered/default inaccessible until Root allocates the lifecycle-preserving unit and its prerequisite repairs; this report itself changes no activation flags.

Acceptance requires real Node HTTP/file and Worker HTTP/persistent SQLite: normal existing owned dwelling registration; no-home recipient enrollment; read-only context proves no writes; forged owner/home/permissions/conditions refusal; commit failure leaves no metadata; same-id first retry after cold restart returns original generated IDs; changed body/kind/wrong current life refuses; travel/revision change does not break original retry; separate new ID on an already registered home cannot create a second household; explicit enrollment never creates membership/access. Snapshot original home/away inventory and receipts around all attempts. Existing old-receipt fixtures remain intact and exercise the old entry point. No synthetic authority rows may stand in for these host journeys.

This is now a concrete implementable first-register interface, with an explicit recipient enrollment action. The remaining work is implementation and evidence of the canonical lifecycle/scene writers, not another undecided home-input contract. Full consenting shared-home use, removal and optional contributions remain the intended outcome and are not claimed complete.
