# 03d Lagos-flight generator successor — source-only review

## Pins and scope

- Successor: `03d1d4d9d1b901b367cfd0a4f91455ac1334c9db`, tree `68ee94158784cb69c71372050997692eb73fea46`, parent `3a120c8e6d335488472cc9018a4f978b0e7ab56a`.
- Parent: `3a120c8e6d335488472cc9018a4f978b0e7ab56a`, tree `98df07ec74299478eaa6c98997947dbe906fded5`, parent `3e3e0876fc50f3166a0d0968f8616b577da27870`.
- Exact diff: one file, `scripts/city/build-catalogue.ts`, 19 insertions and 18 deletions. No generated/runtime file differs between parent and successor.
- Review was read-only. The generator, compiler, build, tests, server, browser, and network were not run.

## Source finding

**APPROVE for the R1 generator source correction only.** This is not runtime integration or startup-budget acceptance.

1. The canonical foreign-flight fixture is now optional. `standardFlight` is found from `compactableLagosFlight`; when none exists, the fixture block is skipped rather than throwing (`build-catalogue.ts@03d:86-107`). The normal compaction pass still maps every route; with no compact candidate, `firstCompact === -1`, `compactFlights` is empty, and `fullRouteLinks` remains every authored route (`:108-115`).
2. The Lagos–Kano fixture is independently optional. It is included only through `...(nigeriaFlight ? [nigeriaFlight] : [])`; the remaining reversed/custom/mutated foreign fixtures still run whenever a canonical foreign flight exists (`:88-105`). There is no Kano fallback and no invented route.
3. Unknown and custom routes remain full objects. Compaction requires Lagos origin, air mode, `beta: true`, a known foreign destination, canonical calculated fields, exact JSON equality, and exact key order `a|b|mode|beta|label|icon|km|fare|seconds` (`:72-84`). A custom key, reordered keys, missing key, changed field, domestic/unknown destination, reverse route, or other mode returns `null`. Compaction occurs only for an exact 15-item all-canonical suffix; otherwise all routes remain full (`:108-115`).
4. The delimiter fix is correct for both array shapes. With preceding full rows it emits `,\n    ...`; with zero full rows it emits `\n    ...` (`:117-118`). The compact-only case therefore starts with a spread element and has no leading comma/elision or sparse hole. With no compact suffix it emits neither delimiter nor spread.
5. Catalogue discovery/order, loader generation, route deduplication, and output writing are untouched (`:23-69,120-128`). The successor’s committed generated outputs are byte-identical to the parent:
   - `catalogue.generated.ts`: 4,125 bytes, SHA-256 `0969ee3c04a10152d1894706187bd9fd531b83295a4b7cb6bcaad692f1be3046`, 55 rows.
   - `loaders.generated.ts`: 3,226 bytes, SHA-256 `857c3a9cc6acc600db61e6f18259ee27046afe3ef997028909c09a5f37a12dea`, 55 loaders.
   - `routes.generated.ts`: 6,827 bytes, SHA-256 `eede408a489697e23567dd3ee2c0209aa4bbe931c4df755e557772353dddbcea`, 24 full route objects followed by 15 compact flights = 39 ordered routes.
6. Exact output identity proves the committed route order and object-key spelling/order are unchanged between 3a and 03d. In the current route file, compact destinations remain `accra, algiers, lome, nairobi, yaounde, abidjan, addis-ababa, cape-town, cotonou, dakar, cairo, rabat, kigali, kampala, lusaka` (`routes.generated.ts@03d:4-20`); the 24 full objects remain before the spread (`:26-292`). This review did not execute regeneration, so it does not claim a generated-freshness check.

## Byte and gate consequence

- Generator source is 8,992 bytes at 03d versus 9,004 at 3a (SHA-256 `17852d9efea92237dc07720de310f5a957cca8ebea16dbfea03eac35f10b367c` versus `8f3db46aa7351244eb3574514bbc3218a40cef03aff5e43465cb30fc983a3685`). This 12-byte source difference is build tooling, not shipped runtime evidence.
- Because all three committed generated outputs are identical and 03d changes only the generator, 03d supplies **zero demonstrated runtime byte saving**.
- The existing public 3a receipts remain the latest original measurement evidence: Node 22.23.3 and Node 24.19.0 builds passed, while both size runs failed startup Brotli at **195,739 bytes against 195,600, over by 139**. Other recorded startup values were raw 614,092/615,000 and gzip 222,987/223,000. Publication pin: `1fb6fd64308eb64fa7db8038e562d96623c94689`, tree `a0d8af7b3f97e075482e4806734b7a5988cebb11`.
- No successor receipt or original measurement was supplied for 03d. The integrated 3e source therefore remains over the startup Brotli cap on the available evidence. A future successor must provide its own original pinned measurement before any measured-pass claim.

## Acceptance boundary

Accepted: optional fixture construction, no-canonical/no-Kano behavior, compact-only delimiter correctness, and preservation of full fallback routes by source inspection.

Not accepted or claimed: generated freshness, compiler/build/test success, runtime equality after executing the generator, startup byte improvement, full integration, or budget pass.
