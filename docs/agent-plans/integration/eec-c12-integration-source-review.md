# eec + c12 integration source review

**Decision: APPROVE this exact integration source tree for a candidate commit and later exact-SHA gates.** No merge-induced source blocker was found. This is not compilation, runtime, package, native UI, deployment, or production acceptance. No merge, checkout, source edit, test, compiler, build, server, browser, or deployment was performed by this reviewer.

Reviewed tree: `b08f02304e1255c6481459a337de4c5012f40503`.
Parents under comparison: eec `eec14690544a4646e4cd8a5ad280d61bbe2709ca` and corrected country c12 `c12b8ebd83cd301475fb1d7bf9e143af260d6621`.
Common ancestor: `c1f7c1f7369139ce559292318ba9842c23a28267`.
Read-only repository: `clean integration checkout`.

## Exact-byte preservation

The tree differs from eec in exactly 38 paths (461 insertions, 3 deletions). These are the expected 33 country asset/registry/receipt paths plus five checker, fixture and test paths. Every one has exactly the same Git blob as c12. The tree differs from c12 in exactly 38 other paths (1775 insertions, 121 deletions); every one has exactly the same Git blob as eec. The two path sets have no intersection and no mismatches. Consequently no combined/manual file version displaced either side in this merge.

The JSON companion records the Git blob and independently read SHA-256 of all 76 paths. The 33 country paths comprise 25 city files (five each for Cairo, Rabat, Kigali, Kampala and Lusaka), three generated catalogue/loader/route files, and five source receipts. Thus “33 runtime pins” includes provenance receipts; it is not 33 executable production files. The five additional paths are:

- `scripts/world/check-playable-africa-rollout.py`
- `server/testing/africaJourney.ts`
- `src/game/cities/allCities.test.ts`
- `src/map3d/geo/atlas.test.ts`
- `src/map3d/world.test.ts`

Their exact c12 bytes preserve mandatory bounded generation identity, receipt/facts/hash matching, the all-foreign source-check union, exact fifteen-country expectations and the known 3/2 journey batches. The strict checker was not weakened to permit missing identity or partial fixture coverage.

Representative SHA-256 pins:

| Path | SHA-256 |
|---|---|
| server/testing/africaJourney.ts | 66202144ded068a55708b7ac4684ea43b7717897c44d8e535033b657413dd880 |
| src/game/cities/allCities.test.ts | 4059377f9ddd8f51466aca9961f350274567d7037c0c085fe0581010b48ef15f |
| src/game/cities/catalogue.generated.ts | 0969ee3c04a10152d1894706187bd9fd531b83295a4b7cb6bcaad692f1be3046 |
| deploy/cloudflare-worker.ts | b53d611a9d3cf71c400a186eef8aa8c0495dce7df14c6623ada4ca42d68a6982 |
| server/social/service.ts | d8532e16cfd49f5e3fd4df77804cbff3ba518ac3725a65c1800da3232da61e6a |
| server/types.ts | d391f5d9b16a5ae53b2cb67f4d01ffa7078095b224adf9eb214bdb0fe9d85b4b |
| src/client.ts | f6bff3fb471d7ee49071ccf88af3454d29668a1cf29c93c76bc35e78d384adc4 |

## eec behavior and boundaries retained in source

All files outside the 38-country-path delta retain eec's exact bytes, including UI files, shared protocols, business code, social/voice/message-pin handling, account and character lifecycle, stores and host composition. Specific source observations support the mechanical result:

- Node keeps its default-false `interactiveTeachingStarts` option and literal-true display projection; Worker keeps its exact `INTERACTIVE_TEACHING_STARTS === '1'` authority/display composition. The route response capability remains host-derived rather than persisted or accepted from a request.
- The client keeps eec's connection/snapshot-generation capability fences and loss/transition clearing. New destination IDs use the existing city-transition path; they do not introduce a second capability source.
- Message pins retain the route, receipt kind, scoped conversation incarnation, expected pin revision/message version, permission checks, privacy projections and client frame/controller/UI modules. Shared types and route/frame allowlists are the eec versions, not the older c12 versions.
- Voice preference and visibility checks in social service remain eec bytes; the country branch does not bypass them. Business implementations are unchanged from eec, and its richer business journey/test files remain present.
- The starter-goal home-location correction remains eec. Existing home, Family, temporary visit, wallet, account and legacy-life authority modules are not rewritten by this merge.

This establishes source preservation, not proof that each feature works in the integrated runtime. No reviewed eec behavior is intentionally discarded, and no new parallel permission or identity model appears in the country delta. Unrelated later household/driving branches are not present merely because they were reviewed elsewhere.

## Observable coupling

The generated catalogue appends Cairo, Rabat, Kigali, Kampala and Lusaka in the same order as the five corresponding generated loader functions. The unchanged `catalogue.ts` pairs catalogue rows and loaders by index, so this alignment matters. Country codes and starter-state IDs remain distinct and match the reviewed source receipts. The five new authored Lagos air routes retain fares 334000, 279000, 268000, 285000 and 313000, respectively, and 20-second journey durations in the game route data. Neither settlement nor wallet charging logic changes here.

The unchanged registry derives open/playable and registered IDs from the same catalogue and lazy loaders. Its synchronous rules accessor can still be null when cold; callers must await the existing loader. The combined tree's all-city test loads content first, runs the older first/two-wave checkers, checks only the remaining foreign IDs with the strict rollout checker, and finally asserts exact union equality (`allCities.test.ts:36,63–84`). The final equality detects missing, extra or duplicate reported cities; it is not a subset acceptance.

Node `server/africa-host.test.ts:29` and Worker `deploy/africa-host.test.ts:47` both iterate `AFRICA_DESTINATION_BATCHES`. The merged fixture contains all five known batches, including Cairo/Rabat/Kigali and Kampala/Lusaka. Their host timeouts and existing 2,000,000-per-journey synthetic credit are unchanged. More cases increase work; no runtime duration or affordability result is inferred from source.

The separately reviewed external sealed verifier must still be assembled from its exact two approved files onto FA8. Its awaited `loadAllCityRules` and exact registered-foreign union are compatible with this registry, but the verifier must import the future integrated commit, not an old c12 checkout. An old ten-city tool cannot substitute for the fifteen-city coverage check. Tool identity, game source identity and built package identity remain distinct.

No unresolved shared-file merge conflict, dropped eec declaration, duplicate authority implementation or new identity fallback was found within this finite coupling review. Geometry, UI rendering, route persistence and cross-feature runtime behavior still require execution at the eventual commit.

## Handoff and limitations

Root may publish a candidate whose tree is exactly the reviewed tree. Record the new commit SHA and recheck its tree identity first; do not use the tree hash where a release tool requires a commit SHA. Any subsequent edit or different merge tree needs its own delta assessment. The existing separate C1-country release effort retains its priority and is not blocked by creating this integration candidate.

Run only the authorized later cloud gates on that exact commit: required compiler/build/source checks; fifteen-city Node and Worker host journeys and durable reopen; applicable business, voice, teaching and message-pin tests; exact-source/package guard and sealed fifteen-city verification; then rendered/native eec UI checks, including capability loss, retries and city transitions. The original eec UI/Business/voice/teaching/message-pin matrix and c12 country matrix are evidence inputs, not an automatically passing combined matrix. No fresh package can retain an old manifest source SHA or borrow its predecessor's archive hash.

The usage tool reported 81% used / 19% remaining during this review, above the human stop threshold of 4% remaining. No previous 09:00 cutoff was applied. No extra credits/resources were purchased.

Approval is limited to this source integration candidate. Original actors, score/license status, homes, wallets and saved state are untouched. The full goal remains open until integrated exact-SHA execution and required user-facing evidence exist.


Publication supplement: Integration assembled the approved tree as `7f2dd820cdeb2b14aa16c19e7f665cb84579be81` and pushed both delivery refs. Tooling `2df4569f5bc0bbabe90238c1482907a87eb75f67` was separately published before this review. These statements are Integration observations, not additional reviewer runtime execution.
