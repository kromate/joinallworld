# Administrative campaigns against the expanded directory

The 258-unit directory now has a separate source-bound discovery report, an Africa-first campaign plan and a durable cache-only executor. These products do not change the old 177-unit inventory, its Rwanda binding, Nigeria or game data. Country outlines and administrative outlines remain distinct from explorable cities and playable destinations.

## Accepted local evidence

The pinned 199-row metadata snapshot joins **192** country units, leaves **55** without metadata and **10** with source-resolution exceptions, and protects **one Nigeria**. The report retains **198 valid ADM1 identities and one invalid India metadata row**; the valid India layer remains separately linked. The **3,281** metadata-reported units include the invalid row's count and are not admitted geometry. Twenty metadata layers exceed the pilot limit; eighteen eligible country units require partitioning after other exclusions.

Report `dda57deffe7d09612a9595aedba4f7378821d328d2111039906854dd1d702a4a` is **266,519 bytes**. First/repeat supervised builds took **766/963 ms**, used zero network and reproduced identical bytes. Published hierarchy, source references and joins were independently checked against the 13,287,234-byte Natural Earth source and 350,392-byte metadata snapshot.

The original `fine-campaign-sources.json` reviewed input is Rwanda only; the following evidence describes that preserved historical campaign. Plan `f8015e06b3504481db6277d6bd0d8418a429b6c6c3807cb9879a41ace900ac25` contains exactly 258 units: **one ready, one protected, 55 missing metadata, ten ambiguous identities, 172 unreviewed sources, eighteen requiring partitioning and one excluded Ghana source**. Africa's 55 source units have priority zero; the other 203 have priority one. Discovery URLs and license strings cannot automatically become executable inputs.

The first real campaign compiled Rwanda; the repeat revalidated its completed ledger result with **one total job attempt**, zero new network and the same report `2469dd1e014e6ec41cca9c55f4627793310ac331cae8722ad76de82e689cc6ea`. It reports **one compiled country, 256 explicit exceptions, one protected provider and zero queued units**. Durable state is **260,294 bytes in four files**, with its lock released. This means the supplied reviewed work is exhausted; it does not mean global administration is complete.

Rwanda's new fine manifest is `a55a237f7ac870631d227d323c937fb32593c5410bc115518663d44ec7269291`, bound explicitly to directory `b3fb51b5660ed22b2ee354235c60291d6857b3dd9245afbabec3fc15918c8501`. First/repeat fine builds took **4,349/2,557 ms**, zero network. All five administrative IDs, geometry types, holes and **58,470 positions** are identical to the old fine result; logical size is **2,159,566 bytes**. The old coarse and fine manifests still hash to their original filenames and remain readable.

Browser checks at actual **586×804**, document width 586, reject the old parent hash under the new directory, accept all five new-bound divisions, render Eastern Province, clear results when returning to regions, and prevent Nigeria fine ingestion. No console errors were observed. These checks do not establish phone performance, global topology, political boundary correctness, distribution rights or playability.

## Repeatable commands

Run from the isolated `world-foundation` worktree. All inputs must already be verified in its private cache.

```sh
node --experimental-strip-types world/fine-directory-catalogue-cli.ts --directory-hash b3fb51b5660ed22b2ee354235c60291d6857b3dd9245afbabec3fc15918c8501
node --experimental-strip-types world/fine-campaign-cli.ts plan world/fine-campaign-sources.json --catalogue .cache/world-build/fine-directory-catalogue/reports/dda57deffe7d09612a9595aedba4f7378821d328d2111039906854dd1d702a4a.json
node --experimental-strip-types world/fine-campaign-cli.ts run world/fine-campaign-sources.json --catalogue .cache/world-build/fine-directory-catalogue/reports/dda57deffe7d09612a9595aedba4f7378821d328d2111039906854dd1d702a4a.json --max-jobs 1 --duration-ms 120000
```

`plan` prints the full deterministic plan without executing it. `run` rebuilds the supplied plan from its hash-verified private report before creating state. Reviewed pin files are explicitly listed in `fine-campaign-sources.json`; no model, network discovery or candidate download occurs during this executor. Adding a reviewed pin changes the plan hash and creates a separate campaign rather than altering the old ledger.

Individual fine builds use `--inventory-product country-directory`; omitting the flag preserves the legacy product and request identity. Wrong namespace/hash combinations fail closed. Fine schema 2 already records the exact parent manifest hash, so no existing immutable manifest is reinterpreted.

## Bounds and recovery

Catalogue work uses the shared acquisition lock and a fixed worker: 120 seconds including preparation, 256 MiB old/32 MiB young heap, and sampled process RSS capped at 512 MiB. Abort waits for worker exit before releasing the lock. Durable pending/terminal attempts, a 20 MiB/128-entry private output cap and free-space/publication reserves are checked before writes. Repeated immutable reports are verified before reuse.

Campaign sessions run for at most 120 seconds and admit at most 300 job attempts per invocation. Each ready job has two lifetime attempts. The campaign uses a dedicated lock to avoid nesting the shared acquisition lock around the fine compiler. Compilation retains its existing worker, source, topology, output and audit limits. Successful jobs verify every referenced manifest/index/outline/topology/registry/coverage asset and compare complete geometry with the pinned raw source. Prior immutable versions may coexist. Completed output is verified again on resume; corruption stops the run and preserves the ledger for diagnosis rather than declaring completion or resetting attempts.

State has a 2 MiB/128-entry/depth-four cap and preflight reserves for plans, reports, SQLite and journals. The campaign's database is limited to 512 KiB with checked SQLite page limits and WAL truncation before/after mutations. Oversized transactions roll back; existing oversized databases fail admission. SQLite's page quota and checkpoint semantics are documented in the [official PRAGMA reference](https://www.sqlite.org/pragma.html#pragma_max_page_count). Larger reviewed batches must be partitioned within the admitted state budget. This is a local bounded process, not a promise of continued execution after sleep or session closure.

Focused fault tests use temporary fixtures: cancellation during an admitted worker run followed by resume, missing/corrupt assets, wrong report hashes and namespaces, symlink locks, state preflight refusal and full-database rollback. Actual cache-only first/repeat acceptance did not inject faults into real output. Evidence is in `.cache/world-build/evidence/fine-directory-catalogue-*.json`, `fine-campaign-*.json`, `rwanda-directory-*.json` and `rwanda-directory-eastern.jpg`. All **236 integrated Node tests**, world TypeScript and the preview production build pass. Preview JS is **648.99 KB minified / 169.68 KB gzip**; the existing >500 KB warning remains. This independent preview is outside the game startup bundle.

## Source promotion and expanded pilot campaign

[FINE-PROMOTION.md](FINE-PROMOTION.md) documents the implemented policy join, audited pointer transport, geometry acquisition and resumable topology preparation. The separate `fine-campaign-africa-pilots.json` adds Djibouti without altering the original Rwanda-only registry or ledger. Full-denominator first/repeat evidence reports **two compiled, 255 exceptions, one protected Nigeria, zero pending and zero network** across 258 units. Plan `bba0a6130e1e22b1d6f0125e1872ebd866036d6f8bb08ddbc85ff33b40b58eb6`; report `83b869ac660f26490e89dc9f90022e565657445fcb5f7dfa5d6c0f006acd97df`.

Djibouti manifest `f25fa2cb8f9502d799f64ab2f0e70cb05eac0d89e545737af15a26b7ee7f3e42` retains six exact source regions and 312 positions, with 22,603 logical bytes. Rwanda's manifest and every old product remain unchanged. Namibia has no admitted input: its verified 13-feature source disagrees with the metadata's 14. The campaign retains its generic unreviewed-source exception; the detailed terminal mismatch and actual attempt accounting are in preparation evidence. Source-count failure cannot be repaired by accepting fewer units or inventing boundaries.

```sh
node --experimental-strip-types world/fine-campaign-cli.ts plan world/fine-campaign-africa-pilots.json --catalogue .cache/world-build/fine-directory-catalogue/reports/dda57deffe7d09612a9595aedba4f7378821d328d2111039906854dd1d702a4a.json
node --experimental-strip-types world/fine-campaign-cli.ts run world/fine-campaign-africa-pilots.json --catalogue .cache/world-build/fine-directory-catalogue/reports/dda57deffe7d09612a9595aedba4f7378821d328d2111039906854dd1d702a4a.json --max-jobs 2 --duration-ms 120000
```

Current acceptance is 285 integrated Node tests and world TypeScript. The prior preview build remains accepted; no client import graph changed. Actual browser checks at 586×804 verify six Djibouti regions and visually inspect Arta, with zero console errors. First/repeat and independent receipts are `fine-africa-pilots-*.json`, preparation evidence is `fine-preparation-*.json`, and screenshot is `djibouti-arta-preview.jpg` under `.cache/world-build/evidence/`.

## Next implementation ownership

1. Select another explicit, license-reviewed African batch within remaining aggregate acquisition/cache quotas. A candidate URL or pointer does not authorize geometry. Ghana remains excluded.
2. Research a replacement Namibia version with matching original metadata and source geometry. Preserve the old terminal record, hashes, attempts and source; a newly reviewed version gets a new request identity.
3. Implement a distinct bounded representation for layers exceeding source/unit/position caps. Preserve whole features, identities and old products; do not simply raise pilot limits.
4. Add deeper administrative/settlement coverage policies, terrain datum conversion and climate/terrain attachment, then a bounded resumable supervisor. Completed preparation does not automatically add a source to the reviewed compile registry.
5. Preserve Nigeria's accepted visual improvements on `codex/nigeria-rendering` (`6ad7579b`, follow-up `01c4c8f1`): lighting/materials, lagoon visibility and Lagos/Abuja/Kano renderer acceptance. Reconcile concurrent graphics only during separate integration review; preserve player/database records.
