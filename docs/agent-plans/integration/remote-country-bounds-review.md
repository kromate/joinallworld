# Remote country numeric bounds review

**APPROVE contract only; launch remains held.** Reviewed the complete contract at 711aac363b4f3315e8a236a9d1acd5b0d52b7b2a. Only the contract changes against its immediate parent d559946e030c79ea5df21e4ea1bad89e05897fd2; the cumulative940diff includes earlier files.

The timing is consistent: readiness≤T0+120, helper720s, naturalexpiry≤T0+840, then at least60s cleanup within the900s wholephase. New actions stop at min(stageDeadline−60,T0+780). The unchanged helper sets its deadline once afterbootstrap; SIGWINCH restart uses remainingdeadline and doesnotrenew it. The controller must cancel in-flight operations at absolutebounds.

The4GiB aggregate owned-process RSS/≤500ms sampling, HTTP20s cancellation, CDP10s, screenshot15s,2MiB/32/48MiB PNG caps and16MiB publicoutput are concrete reviewable caps. Both screenshot and CDP limits apply; screenshot15s cannot override CDP10s. The controller must include descendants and failclosed when measurement fails. These are limits, not proof a journey fits.

Natural cleanup must prove actualdisposal/absence beforelease release. Emergency cleanup targets only recordedownedgroups, preservesprivate data and recordsinterrupted/cleanupfailed ratherthanclaimingstopped. This explicitexception governs the final generic stoppedcheckpoint wording. No helperpatch orrenewal isapproved.

Still missing: immutable controller/modelbinding, reviewed browser/CDP pins/args, cloudpackageguard/provenance/ownsealedproof, livehandles/readiness and actualmeasurements. No launchauthorized.

Pins:

- Contract: f38bdb14436f78a37516d961159519444ea249755ade95edf1cf43dc88ee7460
- Helper: 55f38b91528966dbb43dfc80274471de11fb010b2bc3dc66b9b4f2712d619f56
- Capability policy: af748ece4eccbb2a9dfc7ad9901a13b3d06d4afc1ef497c53bf140d74a51b5ef

No browser, stage, tests, compiler, sourceedits, network or newworker.
