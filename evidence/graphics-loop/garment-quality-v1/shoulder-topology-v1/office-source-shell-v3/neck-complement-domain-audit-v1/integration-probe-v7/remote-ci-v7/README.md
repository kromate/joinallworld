# Bounded remote neck-domain request-lifecycle diagnostic, v7

V7 retains the frozen v6 geometry and exact-position/domain checks. Its only runtime fixture changes are load-generation trace entries and CDP tracking for GLB requests. The fixture still treats every failed request and every pending GLB request as fatal. Synthetic tests cover completed, redirected, canceled, and still-in-flight GLB records.

The remote runner preserves the previous CPU and browser caps, package closure, Chrome topology, source pins, matched appearance, and 60-frame/16-pose capture plan. V6 took about 56 seconds and ended with three `net::ERR_ABORTED` GLBs (clip pack, male body, female body); this near-cap runtime is why v7 is diagnostic-only and must not claim a pass if the unchanged cap is exceeded. No v7 tests/build/browser run has occurred locally; root owns remote publication and execution.
