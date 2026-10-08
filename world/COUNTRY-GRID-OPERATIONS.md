# Country-grid operations and acceptance

The compiler produces a complete source-bound geographic planning denominator from cached country outlines. It does not download buildings, publish scene packs or count geography as playable. Nigeria remains protected. The original directory and all previous outputs stay immutable.

## Cache-only build and independent audit

Run from this isolated worktree; one heavy command at a time:

```sh
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- node --experimental-strip-types world/country-grid-cli.ts build world/country-grid-fixtures/senegal-v1.json
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- python3 world/tooling/verify_country_grid.py --root /Users/anthonyakpan/.codex/worktrees/world-foundation/joinallworld/.cache/world-build --plan-path country-grids/senegal-country-grid-v1/plans/cee5d9a270d5daa263c3ee56497e797e3acd04a302675a54e4098b2860061d9c.json --plan-hash cee5d9a270d5daa263c3ee56497e797e3acd04a302675a54e4098b2860061d9c
```

Fiji and Antarctica fixtures use the same build command. Published plans/completion paths and exact hashes are in `country-grid.json`. Repeat verifies the same source, plan and receipt without network, new attempts or publication changes. A missing or corrupt completed plan fails closed; an exact immutable plan written before its completion receipt may resume. No job ledger is introduced by grid publication.

Each product uses a level1, half-degree lattice. Exact dyadic predicates preserve boundary-touching cells, holes, source-cut antimeridian contacts and polar edges. Every cell remains `not-started`, and geometry coverage remains `not-acquired`. Country codes may be null: identities come from pinned source/directory keys. These cartographic outlines do not prove current official boundaries or spherical topology.

## Measured acceptance

| Source | Selected cells | Plan bytes | Operations |
|---|---:|---:|---:|
| Senegal | 100 | 16,859 | 44,109 |
| Fiji | 51 | 10,233 | 12,664 |
| Antarctica | 25,467 | 3,513,554 | 38,989,654 |

All three actual products passed independent Python reconstruction of source pins, every cell/bound/contributing polygon, denominator and completion. First/cache repeat are identical except the cache-hit flag. All **860** preserved source, directory, previous product and ledger pins remain identical. Final verification passes **503/503 World tests**, World TypeScript and **11/11** independent Python fixtures. The publisher regression waits for an actual worker-online event, aborts it, confirms exit before rejection, then verifies a clean subsequent build. Test runs use isolated temporary state.

The initial Antarctica full-ring scan exceeded the unchanged 100M operation cap. That failure remains in `country-grid-global-scale.json`; a bounded latitude-row index of original segments corrected scaling without changing source geometry or raising caps. `country-grid-global-scale-indexed.json` preserves the subsequent measurements. The independent verifier uses separately implemented rational scanline/index predicates, with full-ring reference fixtures. Source-directory JSON uses its historical canonical bytes WITHOUT newline; new grid plans/completions use canonical JSON PLUS newline. A Python/JavaScript shortest-decimal tie may fail closed; acceptance proves these actual products.

A subsequent cache-only sequential profile covered the complete 258-map-unit catalogue: **257 compiled in memory / one protected Nigeria / zero failures**, **99,780 cells**, **14,579,350 summed estimated plan bytes**, **155,135 ms** total elapsed and **216,956,928 bytes** maximum sampled process RSS. It published **zero** products and used **zero** network. Per-country caps remain unchanged; summed operations across separate requests are not a per-job cap. This is a denominator scaling profile, not source-acquisition throughput or a world-completion forecast. All 13 null-code units remain represented. Evidence is `country-grid-global-catalogue-profile.json`.

## Limits and next stage

Requests are capped at16KB; plans at16MB; positions100,000; bbox candidates300,000; selected cells100,000; operations100M; segment references2M. Publisher deadline60s, heap512MiB, sampled RSS768MiB, dedicated output32MiB/4,096 entries/depth6, plus100MB free-disk reserve. Independent audit has its own120s/512MiB/40MB read limits. See the frozen spec for exact semantics. Sampled RSS is not guaranteed peak or a physical-device measurement.

Next bind this immutable denominator into the existing bounded campaign executor, with typed source-density failure accounting, atomic parent-to-child query subdivision, explicit captured/zero-supported-feature/failed/pending query coverage, and a durable global ownership/dedup stage before geometry compilation. Do not sum overlapping queries as unique country buildings or reinterpret zero supported features as empty physical geography. No new source acquisition occurred in this milestone. Photorealism, terrain datum conversion, wider regional conditions, source-distribution rights, gameplay integration and device/soak gates remain separate.
