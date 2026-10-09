# v4 source and runner review

This revision keeps the complete v3-fix1 source closure and compilation sequence. The measured fix1 failure was narrow: full-app compilation reached 230,907,904 bytes for the owned process group, 0.211 MiB above the previous 220 MiB diagnostic limit. The v4 runner therefore permits 384 MiB for this remote compile diagnostic only. It does not loosen the Node 96 MiB old-space cap or the 25-second total timeout, and it does not alter shipped game budgets.

Before publication, review the following:

- `run-bounded-linux-reviewed-v4.py` captures sampled process-group and per-PID/command RSS per phase and in the final receipt. Sampling is every 25 ms through `/proc` and records the runner plus its owned descendants without spawning a monitor process into the group. A final strict `/proc` scan must positively find the wrapper and no child before `cleanupVerified` is true or success can be reported; unreadable process state fails closed.
- The serial phases retain the full source seal, separate full pre/post verification, separate vendor/addon/app compilation, output seal, finalizer seal, one public copy, and review-host staging. Failure cleanup signals only processes found in the runner's own process group, escalating from TERM to KILL.
- The pin scope and consumed-byte checks are unchanged. Do not omit public files, city maps, runtime imports, or source verification to fit a limit.
- Review the JS import closure, CSS asset closure, import map, and both Three core/module outputs before accepting a package. The static package remains diagnostic and should not be mistaken for a production build or visual/performance result.

Do not run this recipe locally. Parent controls publication and the single bounded remote run. Preserve the prior v2, v3, and v3-fix1 output trees and receipts.
