# Fifth starter source batch review

This is a source-plan review for Tanzania (Dar es Salaam, `dar`), Republic of
the Congo (Brazzaville, `brazz`), Democratic Republic of the Congo (Kinshasa,
`kin`), Madagascar (Antananarivo, `antananarivo`) and Malawi (Lilongwe,
`lilongwe`). The compact IDs and starter state labels for TZ, CG and CD follow
the generator's explicit reviewed identity policy; they are internal game
identifiers, not official place or administrative codes. All five candidate
city output directories were absent when reviewed.

The offline generator plan currently reports all five rows ready and under the
150-byte catalogue-row-plus-loader ceiling: TZ 148, CG 143, CD 148, MG 149 and
MW 141 bytes. Each row has exact ISO joins, a pinned Natural Earth admin-0
outline reference, a selected-place coordinate and a matching IANA timezone.
No cached city samples were present at planning time. The serial source runs
have now generated all five bounded samples. The receipts record 12,861,241
OpenStreetMap bytes in total and these retained feature counts:

| Country | City | Buildings | Roads | Download bytes |
| --- | --- | ---: | ---: | ---: |
| TZ | Dar es Salaam (`dar`) | 350 | 154 | 6,927,731 |
| CG | Brazzaville (`brazz`) | 350 | 37 | 2,861,352 |
| CD | Kinshasa (`kin`) | 146 | 32 | 336,792 |
| MG | Antananarivo (`antananarivo`) | 350 | 107 | 2,372,902 |
| MW | Lilongwe (`lilongwe`) | 188 | 19 | 362,464 |

Against the post-merge source state, all five offline source checks report
`pinned-assets-match`; all five isolated city engine verifiers report
`verified`. Dar's first verifier attempt stopped before assertions because
shared `three` package metadata was invalid (`ERR_INVALID_PACKAGE_CONFIG`); its
recovered verifier run passed. These counts describe bounded acquired samples,
not whole-city coverage. The accompanying JSON packet pins the five receipts
and the exact 37 tracked source paths for this source-and-isolated-engine
review.

The settlement names, city coordinates and “Admin-0 capital” classifications
come from the pinned Natural Earth place inventory; its capital classification
is explicitly stale and must not be presented as a current official capital
designation. Country outlines come from the pinned Natural Earth admin-0
release and preserve their source geometry. Airport names and coordinates are
OurAirports dataset records, selected by the inventory's nearest same-country
scheduled-airport rule. They are dataset points, not official aviation
reference points, confirmation of current operations, or evidence of routes or
schedules. In particular, the city point and airport point are distinct
coordinates for each candidate.

Any generated visitor services, prices, descriptions, and travel links remain
authored game content; they do not establish real services, fares, or current
flight schedules. Building silhouettes and road lines describe only the
bounded acquired samples, not whole-city coverage. Those claims should remain
explicitly limited when reviewing the resulting city modules. Dar's generated
`facts.ts` includes these caveats and identifies the OurAirports record as a
dataset source. Its airport point is distinct from the settlement point; the
dataset record does not establish present operations or an official aviation
reference point. Its country geometry is the pinned Natural Earth outline, and
its building and road counts describe only the bounded central sample.

The source and isolated engine checks do not establish Node 22/24 remote CI,
strict types, host/browser behavior, durable save behavior, download or phone
budgets, or production availability. These cities remain unregistered in
production.
