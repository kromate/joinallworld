# Clothing/body/shoe A/B V7: exact patch-ID telemetry

This is a V6-derived telemetry-only fixture. It leaves the sampled clothing/body/shoe candidate unchanged and adds the exact sorted `triangleIds` returned by the female-office pixel-seeded body coverage patch to each rendered state. The purpose is to capture those 25 IDs from the accepted GPU run so a later factory can pass them through its single `additionalBodyHideSets` call before Body masking is owned.

It retains the V6 clip snapshot loader: one `cache: "no-store"` clip-pack `ArrayBuffer` fetch shared across independent Kits, with `GLTFLoader.parseAsync` called separately for each Kit. The renderer still treats every failed network request as a hard failure and requires the complete byte length plus five parsed Kit instances.

The report distinguishes `requests`, `bytesRead`, `cacheHits`, `parseSuccesses`, and `kitsParsed`; every candidate Body coverage object also includes its exact sorted source triangle IDs. The source run remains diagnostic rather than broad visual or gameplay acceptance.

Run the V7 pin verifier, typecheck config, bundle script, then bounded render script. This remains an ignored diagnostic; no gameplay integration or mobile claim is implied.
