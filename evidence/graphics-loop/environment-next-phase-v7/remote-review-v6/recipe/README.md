# Remote render review v6 candidate

This push-triggered diagnostic consumes only the independently successful v7 CPU package `environment-whole-slice-v7-package-v3-37902739360` from commit `c4d15a72f6df56b28535579380819bdaf2fad8a1`. The run ID, commit, and artifact name are pinned consistently in the workflow, Python supervisor, and CDP controller; the controller also verifies the downloaded artifact receipts before opening the app.

The viewer readiness fix requires target place/time/location and two stable observations with `host.easing === false` and `host.avatar.moving === false`. A normal active render loop does not block readiness. Runtime.evaluate CDP calls have a 15-second cap; the owned process group remains capped at 2 GiB RSS and 60 seconds, Node at 96 MiB, with three concurrent scopes. The three scopes cover Home/Neighbourhood day/night, Market/Beach day/night, and lifecycle-only. Invalid or pending captures remain diagnostic-only.

This is a remote browser diagnostic, not production, mobile, battery, or visual-quality acceptance. The source pin manifest seals the workflow and all controller, supervisor, and contract-test inputs. Run the local contract tests and Python AST/invocation checks before publication; no remote render has been run from this candidate yet.
