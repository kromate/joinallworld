# Tuple route source review

**MODIFY_GENERATOR_BEFORE_INTEGRATION.** The current generated 39 routes remain equivalent, but the new generator rejects valid configurations before its fallback runs.

Candidate `3a120c8e6d335488472cc9018a4f978b0e7ab56a` has exact parent `3e3e0876fc50f3166a0d0968f8616b577da27870`; the literal baseline is `7f2dd820cdeb2b14aa16c19e7f665cb84579be81`. The clean integration checkout remains at 3e3. Only the generator and generated routes differ.

**R1, P2, generator lines 87–89.** Self-check setup now requires both a compactable foreign flight and the specifically oriented Lagos-to-Kano air link. These are new catalogue requirements, unrelated to safe encoding. Concrete cases:

- Change all foreign flights to legitimate custom fares or give them explicit status fields. Every row should fall back to its full object. Instead standardFlight is absent and generation throws.
- Remove or reverse only the Lagos-to-Kano air link. Its valid full-object replacement or absence previously serialized normally; now nigeriaFlight is absent and generation throws.
- A Nigeria-only fixture with no compactable foreign link fails rather than taking the explicit no-compaction path.

Decouple self-check fixtures from required live routes, or run only applicable checks when examples exist. Missing examples must not prevent full-object output. Retain exact key order and complete canonical equality for qualification.

When fixing R1, also handle the empty-prefix case at lines 116–117. The unconditional leading comma in compactSpread would emit a sparse first slot if a valid route list contained exactly 15 canonical flights and no full rows. This is currently blocked by the hard Kano assertion, so it is a repair constraint rather than a separate current-catalogue defect. Join nonempty output fragments with commas, and include this case in fallback validation.

For the exact current module, source equivalence holds. The 24 full rows are unchanged. The 15 tuple rows contain the same values and order as the earlier helper calls and 7f literals. map passes each tuple to a destructuring callback that ignores its extra index/array arguments. Each call creates a fresh ordinary mutable object with the original insertion order: a, b, mode, beta, label, icon, km, fare, seconds. The outer authored array remains frozen. The private tuples are not exported or mutated; their compile-time readonly annotation does not alter exported row mutability.

The exact-15-suffix guard is conservative. If canonical rows are interleaved or number more/fewer than 15, all routes retain full-object encoding, provided execution reaches that guard. The qualifier still checks canonical endpoint, foreign country, mode, beta, ordered keys, full label/icon/distance/fare/time equality. Custom, reordered, reversed, domestic and status-bearing objects are not silently normalized.

Catalogue and loaders retain their 55 rows and identical hashes. Geography/fare/time functions, CityLink shape and registry are unchanged. The same endpoints and mode preserve authored precedence and directional linksFrom identities.

The twelve embedded fallback checks were read, not executed. No generator, tests, compiler, build, runtime, browser or server ran here. No measured size or performance improvement is accepted. Root's independent decoded comparison and cloud gates remain separate; fixed budgets are not waived.

| Candidate path | SHA-256 |
| --- | --- |
| scripts/city/build-catalogue.ts | `8f3db46aa7351244eb3574514bbc3218a40cef03aff5e43465cb30fc983a3685` |
| src/game/cities/routes.generated.ts | `eede408a489697e23567dd3ee2c0209aa4bbe931c4df755e557772353dddbcea` |
| src/game/cities/catalogue.generated.ts | `0969ee3c04a10152d1894706187bd9fd531b83295a4b7cb6bcaad692f1be3046` |
| src/game/cities/loaders.generated.ts | `857c3a9cc6acc600db61e6f18259ee27046afe3ef997028909c09a5f37a12dea` |
| src/game/cities/generatedLinks.ts | `3860ff242e16bf482f8a26d6e53a528787f8f0d47404b8207e138f4c0816eb2a` |
| src/game/content/travel.ts | `5f8f5a5c659d07da0c0ce0a0d50d609c88a74b616acb5312b2adad8b80d82f1f` |
| src/types/content.ts | `b83c63408552c125a161782b8332c04879f8c56dadea7794998e4438051d21e2` |
| src/game/cities/registry.ts | `c785929592a90590cfc6a107b7db466dc40515f11770d7a1cbb4d427da1f4efa` |
