# Neck-domain probe v4 (prepared, not run)

V4 is a distinct diagnostics-only copy of the v3 experiment. V3 passed build and synthetic tests, then failed during the initial fixture load with a `Runtime.evaluate` exception. V3's error formatter retained only `exceptionDetails.text` (`Uncaught`) and discarded the underlying CDP payload, so the actual geometry/asset exception cannot be recovered from that run. Its clip-pack `ERR_ABORTED` occurred as the failed controller cleaned up and is not enough to identify a root cause.

V4 adds `cdp-exception.mjs`, shared by the controller's evaluator and its failure report. It preserves `exceptionDetails.exception.description`, `value`, class/subtype, source coordinates, stack trace, and the raw JSON-safe CDP object. The synthetic test exercises payload retention and malformed-payload rejection. No geometry, mask, eligibility guard, network rule, or run limit changed from v3.

The recipe remains unrun. A future browser artifact must provide the actual exception before any geometry diagnosis; no screenshots, poses, or visual acceptance are claimed here.
