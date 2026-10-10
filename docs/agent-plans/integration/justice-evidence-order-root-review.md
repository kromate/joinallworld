# Justice evidence-order source review

**Approve the narrow preserving repair contract; current source has a P1 save defect.** No implementation or release acceptance is implied.

Exact source `3e3e0876fc50f3166a0d0968f8616b577da27870`. Full five requested files read; local audit `e605acd28c3fd89d957e2ee0a769d05980d211f2` independently agrees and its five pins match.

## Normal inspection order can persist unreadable progress

JusticeApp renders every initial evidence inspect button simultaneously. transition appends newly inspected IDs in click order. readJusticePracticeState instead requires strictly increasing EVIDENCE_IDS order, then independently compares replay evidence arrays exactly. Seal-log at revision 0 is valid; dispatch-copy at revision 1 produces [seal-log, dispatch-copy], rejected by the next reader. Five of the six complete initial permutations encounter an inversion; only dispatch, arrival, seal stays valid throughout.

step runs inside store.transact/ctx.once, applies the transition and putRow checks size only. It then rereads the saved row, gets false and returns invalid_saved_justice_practice without throwing or replacing the row. The mutation and once result can therefore persist while the response has null practice/revision. current/start/further step cannot recover it under the old reader; UI fails closed and reconnect cannot repair it. This is source-derived, not an observed runtime incident.

## Existing tests do not deterministically cover inspection permutations

Pure tests use canonical finishInitialEvidence order. Service test begins dispatch and races arrival against seal: a seal winner followed by arrival can reach the same defect, but scheduler choice is not exhaustive permutation coverage. Existing tests cover many receipt/forgery/privacy guards which must remain.



## Compatibility boundaries

- Canonicalize only the derived inspectedEvidenceIds set using the fixed authored EVIDENCE_IDS order, including npc-recount last. Keep action receipts chronologically ordered with exactly their original IDs, expectedRevision, action/reason array order and outcome values. Do not sort, rewrite, drop or regenerate receipts.
- Parse schema, exact keys, known IDs, uniqueness, sizes, safe revisions, phase/decision consistency and receipt vocabulary/caps strictly before accepting compatibility. Reconstruct every chronological receipt from the empty authored state, including stale conflicts and terminal receipts, validating original outcomes and revision rules.
- For legacy compatibility, accept a raw evidence array only when it exactly equals either the canonical reconstructed set OR the first-successful-inspection chronology reconstructed from that same fully validated ledger. Do not accept arbitrary permutations merely because their membership matches. Repeated inspection feedback and refused/stale actions add no evidence.
- Require every other reconstructed field to match the persisted state exactly: schema/case/revision/phase/notice and both decisions including reason order. The compatibility exception must concern evidence ordering alone. A replay-consistent forged entire history is not cryptographically authenticated by this reader; retain server-owned storage/identity authority rather than overstating what replay validation proves.
- Return a canonical detached state without mutating the caller object. A current GET may project it without rewriting storage. The next authorized step may persist canonical derived evidence under the existing transaction and expected revision; normalization alone must not grant progress, increment revision, create a receipt or rewrite timestamps.
- Do not change ctx.once fingerprints or old external once results. Same-ID replay must retain original outcome and expose current canonical state; changed payload/request revision still conflicts. An old cached response inconsistent with current practice requires normal reconcile behavior, not a new grant or reset.
- Unsupported/future schema, invented/duplicate evidence, missing or duplicate receipts, outcome/revision/phase/decision mismatches, arbitrary reordered arrays not matching either allowed representation, account mismatch, oversized/capped records remain refused and stored unchanged. Do not replace with createJusticePractice on a service read failure.
- Retain caps: 24 practice receipts, 16384 state bytes, record limit state plus 512, 1024 rows, safe integer revisions/timestamps, existing rate/city/onboarding/busy/account guards and store transaction/CAS behavior. No cap eviction or broad migration.
- Keep public projection authored evidence/reviewed IDs only: no receipt IDs, raw actions/decisions, account identifiers or stored row. No impact on cash/ledger/home/inventory/messages/live politics or real justice state.

## Required proof from the existing owner

- Deterministic six initial permutations, after every individual inspection: apply outcome, canonical evidence, exact chronological receipts, serialize/read round trip and view; then complete the existing notice/review sequence.
- Legacy fixture for each reconstructible chronological prefix, including the actual seal-then-dispatch failure, canonical alternative representation, repeat-inspect feedback, stale revision receipt, same-ID replay after later progress and terminal replay; prove input/receipts/revisions unchanged by read.
- Reject matching-set arbitrary order not equal to ledger chronology or canonical order, altered evidence membership, missing/duplicated/reordered receipt, changed action/outcome/revision/decision, future schema and cap overflow; preserve invalid stored bytes.
- Owner-run service route permutation regressions with current after each step and real saved-row parsing, same-ID replay, changed-ID payload conflict, concurrent CAS loser, full completion, account separation and economy/privacy snapshots.
- Owner-run actual Node/Worker cold reopen and accessible mobile arbitrary inspection order before release. Existing source tests or this review do not establish deployed save/reconnect behavior.

## Exact source pins

- src/game/living-world/justice-practice.ts: `4bc13cf9b72efc5208be7369993021a245f4185e565d8f989dcd7b08ca812518` (30357 bytes).
- src/game/living-world/justice-practice.test.ts: `56071c2208e61da84f7f9781beb965bae40730ff3ea69c54209f39c91e90112a` (11511 bytes).
- server/living-world/justice-practice-service.ts: `6589a3b1442c2ba8158dfa78daf513b9f3f35c5664467d0c92c07c1106188833` (19157 bytes).
- server/living-world/justice-practice-service.test.ts: `1f8b6f9df6dd0bd091173477183ba1c9715a9d91b8308a3c13c119612b8c3511` (13006 bytes).
- src/app/features/living-world/JusticeApp.vue: `589f6e795e26033a29769f2959e3c64a7937c650c340c64f20d76b3794dde558` (18299 bytes).

LIVING remains the sole existing ONLINE source owner. This review ran no tests, browser, network, build or game/service code, made no repository edits and created no agent. Only the two requested /tmp reports were written.
