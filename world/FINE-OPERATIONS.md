# Administrative source operations

These commands operate only in the isolated world-builder worktree. They do not write the game database or replace Nigeria's legacy provider. Run them from the repository root with the existing Node runtime; the topology command additionally requires the already-pinned private Python/DuckDB/Spatial cache. Nothing installs tooling or resolves a newer source release automatically.

## Frozen discovery catalogue

```sh
node --experimental-strip-types world/fine-catalogue-cli.ts --inventory-hash 8c40558c7cd6eff38be2c6d94bdaaafc04bfdc3f601fb45c4441d16b4b7d0a4f
```

This is cache-only verification. It checks the frozen metadata body and Natural Earth source hashes and bytes, the coarse manifest and complete hierarchy, and every field of the reconstructed catalogue. A changed inventory binding fails. The retained snapshot has 199 metadata records: 198 consistent ADM1 identities and one inconsistent India identifier. Against the 177 coarse source units, 167 layers link, 30 lack a coarse counterpart, one is invalid, and Nigeria is protected. Nine coarse countries have no matching metadata. Twenty reported layers exceed the 32-unit pilot limit. The 3,281 reported units include the invalid row's metadata count; they are not an admitted geometry denominator.

The official API response was captured once: 350,392 response-body bytes, SHA-256 `3c742bab8428c987437e48dc5a9a6df826d5b47d3e06c613356733bd4ce3da98`. See [FINE-CATALOGUE-EVIDENCE.md](FINE-CATALOGUE-EVIDENCE.md) for its capture time, HTTP/cache evidence and missing country names. Seven-character candidate commits and license descriptions remain discovery evidence. This command never downloads candidate geometries or grants source admission.

## Exact reviewed source acquisition

```sh
node --experimental-strip-types world/fine-cli.ts verify-source world/fine-sources.json
node --experimental-strip-types world/fine-cli.ts acquire world/fine-sources.json --duration-ms 120000
```

`verify-source` cannot start a network attempt or spend a network reservation. It validates retained exact bytes and their receipt; a missing receipt can be restored with explicit verified-cache provenance and zero network evidence. Missing or corrupt source bytes fail. `acquire` is the explicit network operation: it accepts only a reviewed full-commit URL from a validated source pin, requests identity encoding, rejects redirects, streams and checks the exact hash/length, and publishes the immutable source before its receipt. It does not resolve Git LFS pointers, parse geometry, choose licenses, or retry automatically.

Admission limits are 120 seconds including the shared-lock wait, an 8 MiB cumulative response allowance per source SHA-256, a 40 MiB retained source subtree, and a 100 MiB free-space reserve plus response allowance. Traversal is bounded to 4,096 entries/depth eight. Attempt records are fsynced before contact, capped at 512 entries/2 MiB with two-record headroom. Failed partials remain. Changing descriptive pin metadata cannot reset the source's spent allowance. Interrupted or stale attempts retain their full remaining reservation; a completed response is charged its measured bytes. The meter counts a whole delivered stream chunk even if it crosses the allowance, while the retained prefix remains bounded. Measurements describe delivered response-body bytes, not protocol overhead or an absolute transport-level overshoot guarantee.

The retained Rwanda source has been independently verified through first/repeated cache reuse with zero new network bytes. Its earlier acquisition accounting remains in [FINE-SOURCE-EVIDENCE.md](FINE-SOURCE-EVIDENCE.md); receipt restoration does not relabel that original capture as a zero-download acquisition. An exhausted allowance still permits a verified cache hit. A corrupt audit or receipt fails closed and is retained for review.

## Separate polygon topology evidence

The current tooling pin is macOS arm64, including an `osx_arm64` Spatial extension and the bundled Python 3.12 runtime. Other hosts need a separately reviewed platform/runtime pin; this implementation does not install or select one implicitly.

```sh
node --experimental-strip-types world/fine-cli.ts topology world/fine-sources.json --duration-ms 60000
```

The fixed private worker verifies source bytes and feature identities, uses DuckDB 1.5.6 and the pinned Spatial extension, and disables external access before geometry queries. It checks planar 2D OGC validity and emptiness. Dateline rings and holes use a consistent unwrapped validation image; original source coordinates are preserved. Polar, global-span and ambiguous longitude images remain unsupported. This does not establish spherical validity, real-world boundary correctness, matching borders between units, or license rights. Higher ordinates are ignored by the topology query.

The Node parent owns the shared build lock, a 60-second wall deadline, a sampled 512 MiB child RSS limit, 64 KiB report/16 KiB stderr limits, and child termination with awaited closure. Local attempt evidence starts before launch. Immutable reports and append-only per-attempt records live under `.cache/world-build/fine-topology/`, separately from browser/game output, bounded to an 8 MiB subtree and 256 attempt files with 100 MiB free-space reserve. Successful cache reproduction has no model or network calls. Exit 2 means invalid or unsupported geometry findings; exit 1 means failed validation or execution, and exit 0 means all pinned features passed this validator's stated domain.

These reports are evidence sidecars. The existing Rwanda fine manifest and preview still disclose structural-only compiler validation. Attaching verified topology evidence to a new compiler version and browser manifest is the next integration task; do not remove the existing warning merely because a separate command passed. Larger country partitions, missing country/level policies, source-specific rights, deeper administration, selected settlements and an all-country resumable campaign remain separate required milestones.
