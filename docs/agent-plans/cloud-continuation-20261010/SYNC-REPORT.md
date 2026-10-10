# Continuation: synchronisation and coverage report

Prepared 2026-10-10 from a full fetch of the public repository. This report changes no item status. It records what was inherited, what the audit found, and what can start.

## Synchronisation

- 299 remote branches fetched. No reset, force-push or overwrite; pre-existing uncommitted work in the primary checkout was left untouched.
- Six manifest documents verified by byte count and SHA-256. Fifteen pinned source commits present.
- No pinned owner head has moved since the handoff. There is no newer owner source or evidence to reconcile.
- Runtime candidate `3e3e0876fc50f3166a0d0968f8616b577da27870` is eight commits ahead of `main`; `main` equals production `c1f7c1f7369139ce559292318ba9842c23a28267`.
- Held GRAPHICS `cf8b7417b5f428dc6cb59f601fbde560cd9a7c71` is not on the remote. It stays held for approval and is not treated as retrievable.
- The repository has no AGENTS.md or CLAUDE.md at the candidate.
- Each inherited patch and its disposition: [reconciliation-manifest.json](reconciliation-manifest.json).

## Coverage audit

| Inventory | Expected | Found | Result |
|---|---|---|---|
| INT repair items in the ledger | 35 | 35 | Complete |
| ANN requirement rows in the ledger | 58 | 58 | Complete |
| INT items in the human checklist | 35 | 35 | Complete |
| WORLD remaining units | 7 | 7 | In inventory and audit; were missing from the ledger by ID, now cross-referenced |
| LIVING R01 to R15 | 15 | 15 | In inventory and audit; now cross-referenced in the ledger |
| GRAPHICS inventory units | 8 | 8 | As WORLD |
| GRAPHICS final issues | 10 | 10 | As WORLD |
| Cloud checkpoint remaining units | 7 | 7 | As WORLD |
| Additional obligation groups | 8 | 8 | Present in the ledger |
| Automation lanes | 6 | 6 | Kept explicit in the ledger cross-reference |

Findings:

1. The ledger did not name the 22 WORLD, GRAPHICS and cloud unit IDs or R01 to R15; only the coverage audit did. The ledger now carries the cross-reference.
2. WORLD-GLOBAL-DETAIL, WORLD-MORONI-DURABILITY and WORLD-AFRICA-REMAINING have no INT item of their own. They are kept as own sub-items and cannot be closed by closing INT-010 or INT-011.
3. Nothing in the inventories is accepted as complete. Ten INT items have a source correction or a narrow pass with acceptance still open.
4. Three patches named in the manifest (wrist repair, WORLD accepted source, and the receipt branches) are based on production or on the earlier candidate, not on the combined candidate. They need a file-by-file review before integration; their passing evidence does not transfer.

## External blockers known at synchronisation

| Item | Blocker | Required action |
|---|---|---|
| INT-020, GFX-PHONE-PERFORMANCE, LIVING R08 (device part) | No physical iPhone/Safari/PWA hardware | Supported device and an operator |
| INT-014 and dependants (INT-015, INT-025, INT-026, INT-027 in part) | Held GRAPHICS source not published | Owner approval to publish or transfer the exact payload |
| LIVING R12 | External automation contract, access and consent | Owner authorisation and access |
| LIVING R13 | Real merchant contracts and authority | Separate owner authority |
| Additional obligation 7 (aggregate ranking) | Analytics sign-in expired | Owner re-authentication |
| INT-008, INT-018 in part | Historical private artifacts and captures unavailable | Owner transfer, if they still exist |

## Ready queue

Ordered by save/data hazard first, then easiest to hardest, respecting dependencies. Each unit is one worker, one branch, with listed files.

| Order | Item | Lane | Model | Unit |
|---|---|---|---|---|
| 1 | INT-035 | LIVING | Sonnet | Rebase `ef92f8f1` proof: six evidence orders, forged/future refusal, no-write GET and replay, Node and Worker cold reopen |
| 2 | INT-017 | WORLD | Sonnet | Close the startup compressed-size failure on the combined candidate with a measured change; no cap change |
| 3 | INT-005, INT-006 | LIVING | Sonnet | Fix compiler error TS2722 in the driving host successor `a6461c22`, then replay/freshness proof |
| 4 | INT-033 | LIVING | Sonnet | Durable boundary proof for counter exhaustion |
| 5 | INT-001, INT-021, INT-022 | LIVING | Haiku, Sonnet review | Runtime diagnostics for the corrected household loader |
| 6 | INT-002 | LIVING | Haiku, Sonnet review | Lesson feedback visible at 320px |
| 7 | INT-028 | WORLD | Haiku | Retain exact diagnostics and compiler evidence for the new candidate |
| 8 | INT-011 | WORLD | Sonnet | Five city journeys on an accepted candidate |
| 9 | INT-024 | GRAPHICS | Sonnet | Wrist repair rebased on the candidate; full compiler; floor evidence |

Not ready: INT-012, INT-019 (need INT-001/021/022/023 proof first); INT-016 (needs INT-005/006); INT-030, INT-031 (need INT-016); INT-014, INT-015 and their dependants (held source).

## Capability record

Recorded separately once worker capacity and the allowance window have been read for this session. Until then no worker is claimed online.
