# Bounded remote neck-domain review, v4

V4 preserves the v3 candidate and bounds, while retaining the complete structured Chromium DevTools exception payload when a `Runtime.evaluate` call fails. The v3 artifact only reported `Uncaught`; its controller threw away the nested exception description/value/stack. V4 now writes those fields and the raw payload to both the `controller-error` breadcrumb and `review-results.json`.

The new Node tests cover TypeError/RangeError payloads, source coordinates, nested stack frames, values, and malformed payload rejection. They run in the existing bounded synthetic phase alongside the result-directory contract and geometry/domain tests. Build and synthetic caps remain 96 MiB heap, 220 MiB process-group RSS, 25 seconds; browser remains 2 GiB/60 seconds. Import/network failures stay strict. No v4 remote run has occurred.
