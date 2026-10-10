# Sealed fifteen-city verifier and checker source review

**Decision: APPROVE the two narrowly scoped source deltas.** No source blocker found in the reviewed changes. This permits WORLD to assemble the two exact verifier files onto the pinned portable tooling baseline; it does not approve a whole-branch merge, execution, dispatch, package release, deployment, paid resources, or runtime behavior. No test, diagnostic, compiler, server, browser, or application was run in this review. No repository source was edited.

Reviewed fetched Git objects in `the clean integration checkout`:

- Verifier: `211d4442d37b5dfc50e8163e518a4370cfb5bbf5`, parent `dcd29b4e02557300d7ad6db803b687eb74962a66`.
- Checker/fixture expectations: `c12b8ebd83cd301475fb1d7bf9e143af260d6621`, parent `0a5e2983126e3dac406af1c3a121e9cbfef78feb`.
- Portable tooling baseline: `fa8ba00ac63be7ddf0edf80be27ea1a81a7ed6fe`.
- Special legacy fixture source: `3af17a01b8bd406bfb830ca0d2ee66d2d0093d28`.

## Exact reviewed bytes

| File / source | SHA-256 |
|---|---|
| 211: world/tooling/sealed-africa-coverage.mjs | c84e5e69225421b5fa58accf963f6456a84c2a797724ba89a4e0d4623a6948bb |
| 211: world/tooling/verify-sealed-africa.mjs | f6b59c1709ab30aaa36c4dc03b4dedbf2f73b5720d164356e208c5dba635b014 |
| 211: world/sealed-fifteen-coverage-source-acceptance.json | 8d2f6a1fa3fa1b36ce7b2524ebd8455501ffc2054474c19f8f5d5424df613aab |
| c12: scripts/world/check-playable-africa-rollout.py | d82adecbb101ac20386d303a0c7762a82714fb896eaa3bfbdecec1747b5b0ab7 |
| c12: server/testing/africaJourney.ts | 66202144ded068a55708b7ac4684ea43b7717897c44d8e535033b657413dd880 |
| c12: src/map3d/geo/atlas.test.ts | 1ecd4bc513d6d55fcf8b31ec26d0e4920ff00ff682b9ea71e1c1c7be2f929796 |
| c12: src/map3d/world.test.ts | ed7d2f852b5a51d969ff6b8726868f5333f926fd619883ad66562a215e111e80 |
| c12 and legacy: src/game/cities/registry.ts | c785929592a90590cfc6a107b7db466dc40515f11770d7a1cbb4d427da1f4efa |

211 has four changed files overall: two tool files, PROGRESS, and its acceptance JSON. The two tool files differ from FA8 by the same 37 insertions / 7 deletions inspected against 211's parent. `sealed-admin-rate-policy.mjs` and both named portable workflows have no FA8-to-211 diff. c12 changes four files against its immediate parent0a; the combined correction changes five files against91, including the earlier allCities test caller. These are distinct comparison bases.

## Coverage selection and cold registry

The helper admits exactly these layouts and order:

1. Legacy five: Yaounde, Lome, Accra, Nairobi, Algiers — only when the batch export is null/absent, the source SHA equals the special legacy SHA, and the legacy `AFRICA_CAPITALS` export equals that exact list.
2. Ten: the first five, then Cotonou/Abidjan/Dakar/Cape Town, then Addis Ababa.
3. Fifteen: those three batches followed by Cairo/Rabat/Kigali and Kampala/Lusaka.

The non-legacy path requires exactly three or five batches, nonempty city arrays, valid string city IDs, no duplicated destination, and deep equality against the known ordered batch prefix. It does not admit an arbitrary five-city addition, one oversized batch, a missing last batch, or reordered groups. It also does not pin every ten/fifteen source to a hardcoded SHA; the separate clean-source/package identity verifier pins the caller's requested exact source. That distinction is sound for this portable tool.

`verify-sealed-africa.mjs:375–390` imports the **requested source checkout's** registry, awaits `loadAllCityRules`, checks every returned rule has a string country ID, excludes only Nigeria's existing `ng`/`nigeria` identities, and compares the foreign city set exactly with the selected destinations. The helper checks nonempty IDs and uniqueness on both sides before sorted equality. Thus ten known batches cannot certify a source registry containing fifteen foreign cities, nor can fifteen certify ten. Extra/missing registered foreign cities fail closed.

This is the correct cold-loading path. `registry.ts:121–128` exposes cached synchronous rules as null until loaded; `loadAllCityRules` uses `playableCityIds().map(loadCityRules)`, and the loader verifies module/rule identity before caching (`64–81`). Playable and registered IDs draw from the same open catalogue plus explicitly registered fixtures (`109–114`), differing only in order, which is immaterial to the final set comparison. “Registered” here means the actual open/playable registry, not every closed future catalogue entry. The inspected legacy registry has identical bytes and supports this API. Legacy `africaJourney.ts` indeed exports `AFRICA_CAPITALS` under the expected old name.

The rule loader does not call `loadCityMap` or `loadCityContent`. The new destination module constructor builds rules while its map/content imports remain deferred callbacks. This supports the claimed rules-only intent; it is not a claim that every future source module has no top-level effects. The imported exact source remains trusted executable fixture code, as it was before this change.

The coverage assertion and selected asset resolution precede `makeHost` at verifier line 398, and therefore precede Miniflare construction at line 135. Miniflare's dependency is required, worker bytes are read, and an isolated temp folder is allocated before that assertion; the claim is **before emulation**, not before all preparation. Failure follows the existing cleanup path. Every selected city still requires exactly one content-addressed map and geometry chunk, plus index HTML: fifteen cities imply 31 selected assets. Missing geometry cannot silently reduce coverage.

## Identity, limits, and resources remain separated

The exact-source checks remain: source HEAD equals the requested forty-character SHA; tracked files are clean; package manifest source SHA matches; publish is boolean; and the canonical package guard checks the package. Package file records retain unique paths, hashes, and byte counts. The runtime runs package `worker.js` with packaged ASSETS, not source Worker replacements. The served-asset hash/byte checks and canonical HTML preview transform are unchanged.

Limits are unchanged: total verification budget 168000ms, request 12000ms, startup/import/rules-loading cap 20000ms, restart 15000ms, disposal 10000ms. Each journey's existing 145000ms local allowance is still capped by the remaining overall budget. Rules loading gets the existing startup limit and the remaining total budget; it does not extend the deadline. Existing Node >=24 requirement, argument allowlist, synthetic binding set, outbound fixture handling, restart storage path, rate-wait policy, failure exit behavior, and `releaseReady: false` remain unchanged. No arbitrary environment inheritance, provider change, package mutation, or new production flag is introduced by this delta.

More cities mean more rule loading, asset checks, journeys, and restarts within the same limits; this review does not claim equal resource consumption or that fifteen-city execution will finish within the deadline. Existing Promise timeout behavior does not forcibly interrupt synchronous imported code, and cleanup can run after the work deadline. These are inherited operational limits, not a new hard CPU/memory preemption guarantee. No source-only inspection establishes actual duration or runner/storage quota.

## c12: required generation identity and precise fixture expansion

At checker lines 106–112, `generationIdentity` is now mandatory and must be a dictionary, as must facts.state. Its city ID must equal the requested city. Its state ID must be a string of 1–128 characters and exactly equal facts.state.idunique; its state name must be a string of 1–256 characters and exactly equal facts.state.name. Missing, null, non-object, empty, oversized, wrong-city, or mismatched identity fails. Existing receipt-city, country, facts-city, exact five-asset-key, bounded byte/hash and literal FACTS checks remain. There is no “missing identity means old version” fallback anymore.

The checker still rejects duplicate JSON keys, nonfinite JSON constants, symlink paths, non-regular files, size changes, and file-byte/hash mismatch. It retains 256KiB receipts, 8MiB asset bounds, at most 53 unique requested city IDs of at most 64 characters, and emits success rows only after all requested cities pass. The new bounds count Python string characters, not bytes; existing file bounds separately limit bytes.

Scope precision: the identity object need not have exactly those three keys; additional metadata is not rejected. The new check proves exact equality of the required identity fields against the pinned FACTS object. It does not independently prove geographical naming, re-run generation, or attest all source datasets. Neither a broader closed-object schema nor extra geographical authority should be claimed.

`africaJourney.ts:12–18` adds exactly the known 3/2 batches. Funding at lines 90–99 remains one authenticated synthetic credit of 2,000,000 per journey fixture with ledger/effect assertions; route affordability is still checked against actual fares at lines 101–108. No fixture balance, fare, wallet formula, grant, or funding ceiling was raised. Running more separate fixtures naturally increases aggregate synthetic credits/case count; it is not ordinary guest affordability evidence. The existing per-city homeward funding/debit protocol is unchanged.

Atlas expectations now assert exactly fifteen foreign country IDs and those fifteen plus Nigeria for enterable countries. World tests add the exact country/city pairs EG/Cairo, MA/Rabat, RW/Kigali, UG/Kampala, ZM/Lusaka. They retain exact set comparisons instead of changing to permissive subset assertions. No production city/runtime implementation path changes in c12: every path outside the four-file diff is identical to its parent. This supports preservation of the prior 33 runtime-file pins when those pins refer to those unchanged paths; I did not independently rehash an external unnamed 33-entry manifest. The parent's separate manifest comparison remains the exact-pin evidence.

## Supplied evidence and what remains open

The acceptance JSON's two tool hashes match the actual reviewed bytes. It reports pure positive/negative coverage checks, four existing tests, 31 selected assets, and new-batch round-trip fares 1,762,000 and 1,196,000 against unchanged 2,000,000 fixture credit. Those are supplied observations, not executions performed by this reviewer. Its cold-load evidence explicitly concerns the older 50-city/ten-foreign WORLD prefix, not the corrected 55-city candidate. Its prior successful FA8 workflow run predates the two changed verifier files. Neither observation transfers runtime acceptance to this tool/source/package combination.

The record correctly keeps sealed Worker, exact candidate package, native UI, production continuity, and dispatch open. Any next approved run must record separately: assembled tool commit and both hashes; exact game source SHA including intended c12 changes; matching sealed package digest; dependency/runtime identity; actual covered-city union and 31 served assets; every batch journey/homeward result; restart/receipt/home preservation; failure/cleanup status and actual elapsed time. A timeout or missing batch is a failed/incomplete check, not permission to omit cities or silently raise limits/funding.

WORLD remains the sole tooling writer. Assembly is restricted to the two named exact tool files on FA8; do not merge the 211 branch wholesale or copy its acceptance record into runtime proof. c12's checker/fixture source acceptance is separate from that tool assembly and from the sealed game source/package identity. No release or activation approval is given here.

Root mechanical assembly completed at2df4569f5bc0bbabe90238c1482907a87eb75f67 on existing codex/world-sealed-eec-tools. Actualpush/freshrefmatch; exactlytwo namedtools files onFA8. WORLD solewriter lease returned. No execution/dispatch/package/release acceptance. Root additionally byte-compared all33 countryruntime paths against91 and matched each reviewed source hash.
