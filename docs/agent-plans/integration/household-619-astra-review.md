# Household 619 source correction review

Decision: APPROVE the isolated loader correction at 619b8fbc7d1837d6225ce6eb0d0871739eb22d75, conditional on actual remote compiler and behavioral diagnostics. This closes the four source findings from 8e6757. It does not approve a durable adapter, runtime authority, residence, payment or activation.

Only server/households/consentView.ts changed from 8e6757: 99 additions, 20 deletions, now 304 lines. The diff from foundation35731140 still adds only this file. No source was edited or executed during this review.

| Source | SHA-256 |
| --- | --- |
| consentView.ts | 78e4eb7e451b7082a8c69b2f95f86536df90bbe3d695fbe37661ab593b3340d8 |
| records.ts | d03bfcacd3d7b985fe0b907b63cb6f1ecde560e89bb560f0e1be199ce817b4b4 |
| consent.ts | 2bd7dbca14e5e934f30045562a55f077567f8691f6666bdd63daa0781c33730a |
| lifeIdentity.ts | 31e457f73c6047147089c33ea76a802bdb694ff4485dda4b10776903b7bc594d |

Foundation commit is 35731140a32da445b8bfd95075f79c0948010694. Reads used fetched objects in the clean integration repository; the working checkout was not changed.

## F1–F4 closure

F1 is corrected at lines 251–252 and 265–266. Invitation endings now load owner and recipient indexes; membership endings load owner and member indexes plus member life index. The old valid leave fixture can now reach the authorized reducer branch instead of failing its universal owner-index check. The same correction covers decline, cancel, expiry and both system termination forms. It does not remove any index invariant.

F2 is corrected at line 104. The accepted invitation's own id must equal member.inviteId before any crosslink succeeds. The old wrong-key fixture now refuses. Line 105 awaits protectInviteRead with the exact ID and revision. This is a declared adapter obligation, not evidence of an implemented database read set.

F3 is corrected at lines 170 and 198. Intentionally unused pair facts are not-loaded. Invite/accept pair values come from point reads and pass the same snapshot boundary. A failed or not-loaded required pair is refused, never converted to absence.

F4 is corrected for a bounded inert-data boundary. snapshotData at lines 37–83 inspects own descriptors, copies values into fresh arrays or null-prototype records, rejects accessors without invoking their getters, rejects inherited custom prototypes and sparse arrays, limits nesting and data size, and freezes copies. The command is snapshotted before parseCommand and the constructed command/view graphs are frozen. Point rows, pair facts and system authority all use this boundary. The system predicate now validates subject, cause and evidence instead of claiming full Authority from kind alone.

Storage reads are awaited outside the reflection catch at lines 110–116. Read failures and protectInviteRead failures reject the load, so the surrounding store transaction must abort. This deliberately differs from malformed data, which returns a tagged refusal. Neither path manufactures absence.

## Transaction boundary still required

The loader does not authenticate a cookie, resolve a life locator, validate a stored home against estate state, commit an expectation, apply a write or consume a liability handoff. sessionLife and systemAuthority remain trusted transaction ports. They must be built only by the real server adapter from current authoritative records; a structurally valid object is not a grant of authority.

Every point lookup and supporting accepted-invitation read must belong to the same store transaction. protectInviteRead must register and validate the supporting revision, not merely return a resolved promise. The adapter must retain all other supporting expectations too, including exact session/life/home/pair provenance. A frozen copy protects against alias mutation; it does not by itself stop stale database writes.

The snapshot guard is not a sandbox for hostile JavaScript Proxy objects. Reflection can invoke proxy traps. Actual ports must return bounded stored row values. Reflect.ownKeys also enumerates an object's keys before the 64-key refusal; existing transport and stored-record byte limits still matter. Snapshot budgets apply per row, while the operation's bounded read count limits total accepted rows. Do not pass whole keyed collections through this function.

Same-character repetition is still refused rather than deduplicated into a valid graph. The foundation's full roster/pending and temporal checks remain unchanged. Actor/system selection, exact home/epoch checks and reducer refusal rules are preserved.

## Minimum remaining remote diagnostics

- Run the old F1 fixture through loader plus reducer for all seven corrected paths, plus valid register/invite/accept/close.
- Verify the wrong-key invitation refuses before protection; a correct supporting read registers its ID/revision and a conflicting revision prevents commit.
- Use getter counters for raw command, point wrapper, nested identity and array slots. They must remain zero. Cover inherited fields, cycles, sparse/oversize data and reflection failure.
- Reject storage and protection promises inside an actual transaction and prove abort. Mutate the original inputs after load and verify the returned snapshots remain detached and frozen.
- Run the strict compiler and focused absence/not-loaded, system authority and repeated-character cases on the exact corrected bytes.

No such execution was performed here. No existing reports were overwritten. This review authorizes no spending and does not extend the human cutoff.

