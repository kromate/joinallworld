# A1 legacy receipt compatibility contract

**Approve the versioned dual-probe design, with an explicit legacy replay limit.** Do not replace e52's fingerprint function globally and call compatibility solved. This is a bounded repair contract for the existing household owner, not approval of unreceived implementation.

Reviewed source: `e52cae83fcbc31348f8b7160790ff37c9c22855c`. The checkout remains `3e3e0876fc50f3166a0d0968f8616b577da27870`. No source or tests ran.

e52 stores only ok, operation, householdId and immutable actor character/life in its result. Its fingerprint also contains the full parsed command and four mutable authority fields. once.ts:76 reduces long fingerprints to a prefix, length and hash53. Those bytes cannot reconstruct the missing command or authority provenance. Comparing only the minimal result would allow different invite/member/epoch/revision/reason inputs to masquerade as an old success.

Use the existing once helper unchanged:

1. Parse/snapshot the request and authenticate ownership of the exact actor life in the same Store transaction.
2. For the new format, construct a fixed-field normalized command and bind it to immutable actor character/life. Keep command-supplied expected revision and epoch, since those are request identity. Exclude newly sampled actor revision, settlement time, location revision and locator revision. Use an explicit fingerprint prefix such as `household-consent-v2:` and add `receiptVersion:2` to the stored minimal result. Normalize invite recipient to its two identity fields. Expose only the current minimal public outcome.
3. Probe ctx.once with the stable fingerprint and the existing private thrown sentinel for an absent receipt. A matching result must have recognized version2 metadata and exact actor/op/household fields. Return duplicate with no view load, patch or events.
4. If the sentinel reports absence, run the normal new-operation path. Validate all current source/read-set facts and atomically apply plus record the version2 receipt. Never create another old-format receipt.
5. Only a canonical client_id_conflict from that stable probe permits a legacy probe. Compute the exact old e52 serialization from the old parsed command and the currently verified actor fact. Preserve old parser/serialization behavior for this candidate, including nested recipient order, rather than applying new normalization. Call ctx.once again with this computed candidate and a callback that must throw if unexpectedly invoked.
6. A matching markerless legacy result may return its original minimal duplicate after exact actor/op/household validation. A mismatch refuses and aborts. Never pass the stored fp back as the submitted fingerprint, treat conflict as absence, rewrite the receipt, or automatically retry under a new ID. Unknown version metadata fails closed.
7. Expiry, quotas, storage failures and malformed results do not trigger legacy fallback. Unknown failures propagate. The two synchronous probes use the existing serialized transaction and need no new receipt lookup API.

This preserves legacy receipts and the old matching behavior. It does **not** make an old success replayable after its mutable fingerprint inputs change. For that case, e52 does not store enough evidence to distinguish an unchanged command from a different command accompanied by changed provenance. Refuse without mutation and report the limitation honestly. Do not create a provenance backfill from current state. A future independently authenticated original journal could change what is provable, but none exists in this source and none belongs in this repair.

The claim for new receipts is narrower and useful: a version2 success remains replayable after legitimate settlement or relocation of the same immutable life, provided its ownership is still provable and the request ID remains within the existing once window. A different active life is never a substitute. Parked/archive ownership remains a host-authority requirement rather than something the fingerprint repairs.

No compatibility migration may delete, replace or reset an old receipt. The ordinary once retention window and pruning behavior remain unchanged. Absolute permanent retention of every historical receipt is not supplied by this framework. The lack of production household callers in e52 reduces rollout exposure but does not prove all QA/stored receipts are absent.

Required cloud evidence should be finite:

- Create legacy receipts with the exact e52 code. Show unchanged-authority replay survives reopen and leaves receipt bytes intact. After a same-life mutable revision change, demonstrate the documented refusal with no migration, loader/apply or event.
- Refuse changed legacy body/kind/wrong actor/life even where its minimal op/household result would match.
- Create a version2 success, legitimately advance same-life authority, close/reopen and replay before loader. Require the original outcome, no duplicate event and unchanged household/receipt. Also refuse changed request/participant and malformed or unknown receipt version.
- Verify sequential same-store patch+once rollback on file/SQL commit failure, propagate unknown errors, preserve uncertain-barrier semantics, and retain expiry/quota behavior. Keep receipt output minimal and within its existing limit.

The same cloud owner should change only household private fingerprint/version/probe code and focused tests; A2 stays with its separately assigned repair. No once.ts/business rewrite, recovery subsystem, endpoint, host activation, payment or residence authority is needed. Exact corrected source and its bound execution evidence still require review.

| Reviewed file | SHA-256 |
| --- | --- |
| server/households/durableService.ts | `ce2eed20b0ecfdf4b0f7a455e6227a0988e138046d2e4357683b068bd35da9fa` |
| server/routes/once.ts | `6072fa044253a38d35b948a33163ea0a2e787ef197bcce3d3760393be94b7046` |
| server/households/records.ts | `ec8b77b1ba951e5b26f2a17e885b13f22a28c5de404c64d366f21ed7935f146d` |
| deploy/sqlite-store.ts | `a54149ccc1f4f1a4db69379a041b0fcd7c90f5830fbcbe7393d261c690f58b5d` |
