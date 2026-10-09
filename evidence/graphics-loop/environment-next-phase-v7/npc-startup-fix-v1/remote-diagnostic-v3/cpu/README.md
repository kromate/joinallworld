# NPC startup-fix remote CPU package v2

This additive diagnostic package repairs the v1 artifact’s broken HTML-to-entry reference. The immutable v1 run (37911271949, CPU source commit 0da02ca0f0e0c4350f2754615f58b2dcd6eaed37) emitted `app/viewer-npc-v1.js`, while its `index.html` requested `./app/viewer.js`. The v2 compiler keeps the exact frozen v1 viewer/HTML and runtime receipts, derives the real app entry from esbuild’s metafile, rewrites the one HTML module URL to that emitted path, and validates the URL against the SHA/byte records for compiled outputs. It does not add an alias.

The contract test runs before sealing and includes the actual v1 HTML/manifest witness: it must reject that mismatched pair and accept the manifest-bound entry. The finalizer and restricted host repeat the exact-entry validation before packaging or serving. Runtime source and its focused startup test receipt remain unchanged from the exact v1 package inputs.

The packaging recipe remains the previously reviewed serial split pipeline (384 MiB remote process-group diagnostic ceiling, Node 96 MiB old-space, 25 seconds). These limits are packaging controls only, not production, visual, mobile, GPU, or download-budget acceptance. No build or browser acceptance is claimed by this source preparation.
