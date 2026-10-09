# Remote render review v5 candidate

This isolated candidate consumes only a newly successful v7 CPU package that includes the v7 viewer. The V4 package is intentionally not acceptable because its viewer has the readiness bug. `PINNED_PACKAGE_RUN_ID` and `PINNED_PACKAGE_COMMIT` are supplied from a reviewed manual dispatch after that package succeeds, and the package artifact name is derived and checked against that exact run ID.

Changes from v4 are narrow: transition polling requires the target place/time/location plus two stable observations with `host.easing === false` and `host.avatar.moving === false`; it deliberately does not reject a normal active render loop. Runtime.evaluate CDP calls have a 15-second per-command cap; all other CDP calls keep 7 seconds and the owned group keeps the existing 2 GiB / 60 second / Node 96 MiB / three-job limits. Invalid or PENDING captures remain diagnostic-only and cannot make a scope pass.

Regression tests cover an idle render loop that should settle and motion/easing that should not. No browser, bundle, build, or test was run for this candidate yet.
