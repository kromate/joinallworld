# Independent country package: scoped seal acceptance

Integration accepts the original execution receipts for country source `c12b8ebd83cd301475fb1d7bf9e143af260d6621` and distinct cloud package `28e4f93df5e608b63d3d862173b03b418d70c141803de7f69a6ed836ffb5030d`. [Root execution review](c12-cloud-seal-root-review.json) records the exact public receipt and tool pins. This acceptance does not transfer to combined UI source `3e3e0876`, its failing startup budgets, or production.

## What passed

The actual original receipt and log at public commit `e424c0bd902fff71e899a481f2dc8ef9710779fd` record all 14 outcomes passing: package guard/identity, packaged Worker SQLite startup, 31 selected served assets covering all 15 registered foreign cities, each destination batch's travel and homeward recovery checks, and persisted SQLite restart. Actual verifier elapsed time including its cleanup is 144,672 ms against the unchanged 168,000 ms limit; the outer wrapper took 235.05986 seconds including lease waiting. Node 24.19.0, npm 11.9.0, one heavy slot and a 1,536 MiB heap are recorded.

Root fully read the original receipt and raw log and the immutable verifier, coverage and rate-policy sources. The raw outcome object exactly equals the published observations. Every selected asset's static size and hash matches the new manifest; served bytes match except the explicitly checked canonical preview-origin HTML transform. Both rate waits retain the same intent and authenticated address, using the canonical 31st write in the 60-second bucket. No repeated seal or changed limit was used.

[Independent metadata verification](c12-root-digest-and-bounds-verification.json) matches seven public evidence pins and eight tracked source/tool pins, and recomputes both package digests using the actual guard's ordered JSON algorithm. Both packages contain 6,228 physical files. The new package is 103,751,182 bytes: only the Worker metadata differs, by 4,236 bytes; the other 6,226 payload records match. Root did not independently inspect the new payload bytes locally. The recorded guard execution belongs to this package's own seal, not the original package's acceptance.

## Remaining acceptance

These are fresh isolated synthetic HTTP fixtures. They use real session/authentication, wallet and receipt paths, same-store restart and rollback checks, with controlled timestamp advances and fault injection. They do not prove normal UI flight waiting, rendered cities, phone interactions, reconnect or preservation of existing production players. `releaseReady:false` remains explicit.

The receipts record clean exact HEAD/status after execution and unchanged source, but before/after per-file maps are empty. No unrecorded clean-before or per-file execution parity is claimed. Country-only [four Node 22 gates](c12-node22-four-gates-review.md) are separately accepted: compiler, build, download and smoke. That remote compiler explicitly used a 4,096 MiB heap; build/download/smoke used 1,536 MiB. Local limits are unchanged. Full game/UI/release gates and physical device checks remain separate.

[Astra numerical browser contract review](remote-country-bounds-review.md) approves the pinned 711aac timing, resource and owned-cleanup requirements. Launch remains held for the actual immutable controller, operator binding, reviewed Chromium/CDP arguments, live owned handles and admission above the human 4% stop threshold. No browser action, production upload, new paid capacity or artifact-access workaround occurred in this review.
