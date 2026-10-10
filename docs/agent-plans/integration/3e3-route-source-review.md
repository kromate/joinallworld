# Compact route source review

**APPROVE_EXACT_ROUTE_ENCODING_SOURCE_EQUIVALENCE_ONLY.** No blocking route or fare change found.

Candidate `3e3e0876fc50f3166a0d0968f8616b577da27870` has parent `7f2dd820cdeb2b14aa16c19e7f665cb84579be81`. The integration checkout is clean and remains at that exact parent. The complete diff changes only `scripts/city/build-catalogue.ts` and `src/game/cities/routes.generated.ts`.

The 55 catalogue rows and 55 loaders are byte-identical to the parent. The generator preserves city discovery/order, conflict detection and the insertion order of the authored-link Map. Its output mapping replaces only the 15 foreign flight object literals with calls, in the same positions after the 24 unchanged full-object rows.

I read the full generator, generated route module, generatedLinks functions, travel timetable/timedLink, destination-rule construction and registry consumers. The 15 calls preserve every endpoint, Unicode label, icon, distance, fare and duration in the old literals. The helper reconstructs the exact field order `a,b,mode,beta,label,icon,km,fare,seconds`. It performs no runtime distance/fare/time calculation. Each call returns a fresh ordinary object. The old generated objects were also ordinary mutable objects; only the outer array was frozen. The new version retains that behavior.

Generator lines 73–84 restrict compact encoding to Lagos-first air links with beta=true, a known foreign destination, the exact ordered key list, and complete JSON equality with a freshly built canonical row. Canonical distance uses the same rounded great-circle calculation from destination atlas to Lagos 3.4/6.45 as the authored destination rules. Fare uses generatedAirFare; seconds use timedLink/intercitySeconds. Canonical label and icon must also match exactly.

Generator line 89 preserves full JSON serialization when any comparison fails. Reversed endpoints, other origins, domestic links, custom fare/km/time/label/icon, an explicit status field or extra enumerable fields therefore retain full objects. Exact key order is deliberately conservative: a reordered canonical object falls back rather than changing its insertion order. This protects custom authored values without partially replacing them.

The unchanged registry at lines 143–170 retains its undirected pair key, authored priority over generated links, catalogue union, caches and directional `linksFrom` behavior. Since a/b/mode and row order are unchanged, this encoding does not change directional route identities or destination selection. The generator imports geography/fare/timing helpers at build time; the generated runtime file adds no such dependency.

The compact destination order is Accra, Algiers, Lomé, Nairobi, Yaoundé, Abidjan, Addis Ababa, Cape Town, Cotonou, Dakar, Cairo, Rabat, Kigali, Kampala and Lusaka.

This approval applies to trusted authored city data and the exact bytes reviewed. It is not a new hostile-object parser: getters, proxies, toJSON and non-JSON properties were already outside the previous JSON-based generator's preservation contract. Future canonical rule changes can affect which rows qualify; nonmatching authored values still fall back safely.

No source, generator, test, compiler, build, server or browser ran in this review. The helper's explicit CityLink return type preserves the public contract but can broaden inferred element types, so the changed candidate still needs compiler checks. No budget improvement is accepted from source size alone. Root's independent nonexecuting decoded-row comparison and the cloud generator-freshness, compiler, route/fare, build, budget and host checks remain required. No release, payment, residency or issuance activation follows from this report.

| Candidate file | SHA-256 |
| --- | --- |
| scripts/city/build-catalogue.ts | `e1bc9391c715467b48474b4d1ab05a1a75cb4773b9d111f9a411044b7558ea2b` |
| src/game/cities/routes.generated.ts | `594abff1a5904fabb318c8a286cf99eb23fb614dc3e71bbc0ba2c03af596bfa6` |
| src/game/cities/catalogue.generated.ts | `0969ee3c04a10152d1894706187bd9fd531b83295a4b7cb6bcaad692f1be3046` |
| src/game/cities/loaders.generated.ts | `857c3a9cc6acc600db61e6f18259ee27046afe3ef997028909c09a5f37a12dea` |
| src/game/cities/generatedLinks.ts | `3860ff242e16bf482f8a26d6e53a528787f8f0d47404b8207e138f4c0816eb2a` |
| src/game/content/travel.ts | `5f8f5a5c659d07da0c0ce0a0d50d609c88a74b616acb5312b2adad8b80d82f1f` |
| src/types/content.ts | `b83c63408552c125a161782b8332c04879f8c56dadea7794998e4438051d21e2` |
| src/game/cities/registry.ts | `c785929592a90590cfc6a107b7db466dc40515f11770d7a1cbb4d427da1f4efa` |
| src/game/cities/africa/rules.ts | `a616559f029d2cb4ae8e63eb1bce8fe9f4c4bf8ff2f581aeacf10c8c740a6eb2` |

Parent generator SHA-256: `9499e633a83ca4326b934dfeb0d8d181602257d352528fdba6d7e1c218039bf5`. Parent routes SHA-256: `1bf2e138c33ea59104666a4ccd3b49f05ba81c5d0e13a7d659075e3863a8dd97`.

