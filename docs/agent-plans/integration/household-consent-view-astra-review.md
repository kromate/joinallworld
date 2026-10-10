# Household consent-view independent review

Decision: MODIFY candidate 8e6757eb92653b3df621cf5e88653b5d6f9bbab4. Two concrete loader defects block acceptance: seven operations lack the owner index required by the reducer, and accepted-invitation crosslink validation accepts a wrong-key row. Two boundary issues also need correction or an explicit enforced contract.

This is a source-only review. No compiler, tests, build, server, browser, implementation changes or worker delegation were performed. Predictions below are from the exact source, not observed test results.

## Exact source

Fetched objects were read in the isolated Integration review checkout. The diff from foundation 35731140a32da445b8bfd95075f79c0948010694 adds only server/households/consentView.ts, 225 lines. All three foundation files are unchanged.

| File | SHA-256 |
| --- | --- |
| consentView.ts | 4f48fe97c498ccf579045b51b921366be9f9828d96637e5a2e5ec55893c2fd0c |
| records.ts | d03bfcacd3d7b985fe0b907b63cb6f1ecde560e89bb560f0e1be199ce817b4b4 |
| consent.ts | 2bd7dbca14e5e934f30045562a55f077567f8691f6666bdd63daa0781c33730a |
| lifeIdentity.ts | 31e457f73c6047147089c33ea76a802bdb694ff4485dda4b10776903b7bc594d |

All paths above are under server/households. I read the four full files and consulted the durable household contract. The previously approved pure foundation does not certify this loader or a future database adapter.

## Findings and reproducible inputs

### F1, P1: seven operations always omit a required index

consentView.ts lines 172–173 load only the recipient index for decline, cancel, expire and terminate-invitation. Lines 186–187 load only the member character/life indexes for leave, revoke and terminate. consent.ts line 172 requires the owner's character index for every non-register operation before any of these branches.

A concrete valid fixture can use these UUIDs:

- O = 00000000-0000-4000-8000-000000000001, owner life LO = 00000000-0000-4000-8000-000000000002.
- R = 00000000-0000-4000-8000-000000000003, member life LR = 00000000-0000-4000-8000-000000000004.
- Home = 00000000-0000-4000-8000-000000000005, household H = 00000000-0000-4000-8000-000000000006.
- Invitation I = 00000000-0000-4000-8000-000000000007, membership M = 00000000-0000-4000-8000-000000000008.

Set now=100. Home is available with owner {character:O,life:LO}, epoch=1 and revision=0. H has revision=1, epoch=1, createdAt=0, lastEventAt=20, state=open, active=[M], pending=[], and the same home/owner. M is active, revision=0, acceptedAt=20, points to I/H/Home/epoch1, member {character:R,life:LR}, with permissions ["sleep","cook"]. I is accepted, revision=1, createdAt=10, expiresAt=604800010, answeredAt=20, membershipId=M and matching identities/bindings/permissions.

Home index has id=Home, revision=0 and householdId=H. Owner character index has id=O, revision=0, hosted=[H], joined=[], incoming=[]. R character index has id=R, revision=0, hosted=[], joined=[M], incoming=[]. LR life index has id=LR, revision=0, joined=[M]. sessionLife returns present available LR with id=LR, who={character:R,life:LR}, revision=0. systemAuthority returns absent. All point lookups return their matching rows.

Command: {op:"leave",householdId:H,revision:1,epoch:1,membershipId:M,memberRevision:0}.

The loader constructs a valid-shaped view containing only R's character index. Passing it to reduceConsent returns index_mismatch, because O was never loaded. This also prevents the membership end and liability handoff. Substituting the valid actor/system authority and corresponding operation demonstrates the other six failures. For invitation operations, use a pending I, H.active=[], H.pending=[I], and R.incoming=[I].

Required correction: include h.owner.character and the target character once in all seven views. Preserve real point absence; do not fabricate an owner index or remove the reducer check.

### F2, P1: accepted invitation ID is not tied to the membership's pointer

consentView.ts lines 34–37 call tx.invite(member.inviteId), but never compare the returned invite.id with member.inviteId. Other indexed reads explicitly enforce key/value identity.

Use the complete fixture above and an owner-authorized close command with reason owner_closed. Let tx.invite(I) return a stored row identical to the accepted invitation except id=J, where J=00000000-0000-4000-8000-000000000009. Keep membershipId=M and all other checked crosslinks unchanged.

The row passes isInvite and linkedMemberInvites. The close view can load all proper character/life indexes, pass isView, and produce a successful reducer patch despite the broken M→I→M link. This is a malformed stored key/value fixture, not an invented actor permission.

Required correction: require invite.id === member.inviteId. The actual adapter must also keep this supporting read in the transaction's protected read set. Its revision is not included in the reducer patch expectations, because the accepted invitation is not placed in the View.

### F3, P2: unqueried pair facts are marked absent

Lines 95 and 123 create {state:"absent"} when no relationship lookup was made. A register or actor close with an existing canonical pair still receives an absent pair fact in its returned view. This contradicts the explicit distinction between absence and not-loaded.

Current register/close/end reducers do not use that pair to authorize, so this is not a demonstrated privilege escalation. Use {state:"not-loaded"} for intentionally unneeded pair facts. The existing View type supports it. Only an actual point lookup may report absence.

### F4, P2: accessor and error behavior is not a safe unknown-data boundary

Line 81 calls parseCommand directly. Lines 28, 43–44, 114 and 223 run foundation guards on returned objects. Those guards read properties directly and do not reject accessors or inherited fields.

Concrete inputs:

- rawCommand = { get householdId() { throw new Error("getter executed") } }. The parser invokes the getter and the loader promise rejects.
- For a valid register command, tx.home returns {state:"present",value:{get id(){throw new Error("row getter executed")}}}. Row validation invokes the getter and rejects the promise.
- A rejected tx.home promise escapes point at line 43. It is not a tagged load refusal.

Nonthrowing stateful getters also remain aliased in the returned command/view; readonly types do not make those snapshots immutable.

This is a boundary acceptance gap, not a claim that canonical inert JSON rows can execute getters. The approved reducer expects trusted canonical facts. lifeIdentity.ts already uses descriptor-safe reads, but the loader neither invokes that parser nor enforces a comparable inert-data boundary.

Before durable integration, either enforce a bounded plain-data snapshot decoder before these validators or add descriptor-safe loader validation. Reject accessors without invoking them. Define storage exceptions as transaction aborts or tagged failures with abort semantics; never catch a storage error and turn it into absent. A generic catch alone does not prevent getter side effects.

## All eleven operation views

All non-register paths read household, its bound home and home index, system authority and session life. The loader never guesses a replacement home from the actor. The reducer still owns authorization, revision/time checks and semantic graph validation.

| Operation | Required character indexes | Life indexes | Review |
| --- | --- | --- | --- |
| register | Home owner | None | Present, with F3/F4 boundary limits |
| invite | Owner, recipient | None | Present; complete roster/pending and pair queried |
| accept | Owner, recipient | Recipient | Present; owner fact and pair queried; invite read twice in actor path |
| decline | Owner, recipient | None | Owner missing, F1 |
| cancel | Owner, recipient | None | Owner missing, F1 |
| expire | Owner, recipient | None | Owner missing, F1 |
| terminate-invitation | Owner, recipient | None | Owner missing, F1 |
| leave | Owner, member | Member | Owner missing, F1 |
| revoke | Owner, member | Member | Owner missing, F1 |
| terminate | Owner, member | Member | Owner missing, F1 |
| close | Owner, all active members, all pending recipients | All active members | Reads all mutable indexes; atomic application remains unimplemented |

For canonical stable inputs, reads are bounded by the named household: active<=11, pending<=16, character reads<=28, life reads<=11. Including linked accepted invitations and the repeated accept invitation read, source-derived upper bounds are register 5, invite 48, accept 35, invitation endings 7, member endings 9, and close 82 asynchronous point calls. F1 adds one call to each ending path. now() is separate. These are source counts, not measured runtime or database-cost proofs.

Repeated character identity within a roster, within pending invitations, or across active and pending is invalid under completeRoster/completePending. Rejecting duplicate close IDs is therefore consistent with the current foundation; do not deduplicate malformed graph rows into an apparently valid household. Inviting or accepting an already-related character remains a reducer refusal. Distinct members with duplicate life IDs are refused by indexedLives.

## Authority and transaction limits

Actor authority is sourced only from tx.sessionLife, never command fields. This is the correct dependency direction, but the method's name does not prove it reads the authenticated exact session life. The adapter must bind the real session, character, life locator and slot using the approved identity foundation. No newest/current-life fallback, opportunistic assignment during GET, or body-supplied LifeFact is acceptable.

System authority is sourced only from tx.systemAuthority. The line-114 predicate claims Authority after checking only kind; final isView validates the remainder and the reducer checks subject/cause/evidence. Retain those final checks. A runtime object tagged system is not itself authority. Only an internal lifecycle/maintenance entry point may provide it, using current transaction evidence. An absent session is supported for such jobs; not-loaded is refused.

Owner/home identity, epoch, home index linkage, household revision, time regression, role, current pair identities and current-life availability are checked by the reducer after load. Loader ok means a view was assembled, not permission to commit. Structural UUID brands correctly come from records.ts and match lifeIdentity.ts; they do not prove which actor owns a UUID.

Close loads the linked mutable indexes and the reducer emits all relationship endings, index changes and liability handoffs together. This file performs no commit. Atomic delivery bars, financial settlement, event delivery, once receipts and lifecycle consequences remain adapter obligations.

## Next finite durable-adapter requirements

1. Correct and review this loader, then prove all eleven valid operations through loader plus reducer using actual cloud checks. Include the fixtures above, explicit absent versus not-loaded, corrupt key/value rows, accessors, same-character repetition, stale revisions/epochs, and wrong life/pair authority. Shape-only loader checks would miss F1.
2. Implement one named adapter inside the real store.transact. It must obtain authenticated exact-life authority and real home/pair facts, implement keyed point reads with no global player scan, and preserve immutable canonical snapshots plus every supporting read.
3. Validate reducer expectations and real absence before commit. Apply writes, minimal once receipt, events and mandatory liability consumer effects atomically. Inject failures before/after each logical group and prove no partial consent/index/money/activity changes. Do not publish room changes before commit.
4. Put authorized minimal receipt replay before new-intent loading. A successful close or leave must remain confirmable after the household closes or membership ends; retry must not recreate consent or expose fresh host data. Preserve existing timed IDs and fingerprint semantics.
5. Connect account parking/archive/legacy swaps, erasure, home replacement and pair changes to the exact identity/epoch authority. Preserve original homes and Family labels. Source identity assignment/move plans alone do not install these lifecycle hooks.
6. Prove actual Node/Worker keyed persistence, restart, races and bounded access on exact pinned candidate bytes. Heavy checks remain cloud-only under the existing limits and cutoff. Residence, occupancy, egress/travel, member-only sleep/cook, payments and UI remain separate unimplemented requirements.

No durable authority, residence, payment, runtime or release acceptance is granted. This review changes no owner files, grants no score/licence or money, authorizes no paid resources, and does not extend the 2026-10-10 09:00 Lagos / 08:00 UTC cutoff.

