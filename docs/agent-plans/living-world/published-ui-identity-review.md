# Published UI identity review — 9 October 2026

Source reviewed: APP UI `9d1d488fed07c5d8b299d2ec188c96491df0e5f4`, including `72c6f977` and `58e6ba47`. Subsequent published `14e802dea7459487e0e00a74a5235c60d8d159b2` changes notification feedback, not these report paths. Main `754779063ff77b43adc5e9d5acc56492e0632d1b` contains the handoff, not the UI implementation. Sol and the existing verified `gpt-6-luna/high` worker independently read the source; no local test/browser acceptance was performed. Exact fast CI37856165507 passed for9d; that does not prove the following race cases. The UI slice is not integrated into LIVING.

## Findings requiring the APP UI owner's repair or handoff

1. `ReportApp.vue` watches identity in component scope, while `useSupport.ts` retains one shared model after unmount. A pending `supportModel.load()` only checks its captured generation. Closing the panel, switching characters, then completing the old request does not call `setIdentity` on this shared model until it is next opened. The old completion can therefore call `onLoaded`, which writes the shared Phone report cache and marks reports read. A mounted panel's submit toast has its own disposal/identity check; that does not fence these model callbacks after closure.
2. `supportModel.setIdentity()` clears its own list/draft/notice, but `src/ui/phone/reports.ts` retains module-global `latest`, `loaded`, `filed` and poll timing. `reportReplies()` reads that cache without a character identity. While the new character's list is pending, the badge can describe the previous character. The separate `checkReports()` request also has no captured character check before `noteReports`; both producers must follow the same identity contract.

These are source-level race findings, not observed production disclosures. The shared Phone badge mechanism predates this slice; simply declining its merge does not demonstrate that the current live UI has full identity isolation. Preserve existing report retry keys and same-character draft continuity when repairing it. Closing a form need not discard its draft; switching identities must invalidate old deliveries and cached badges synchronously.

Required isolated regressions: defer character A list/send; close panel; switch to B; finish A replies before/after B load; verify no old list, badge, notice, callback, read marker or toast reaches B. Also switch while mounted and while `checkReports()` is pending; preserve same-character close/reopen drafts and unchanged-body retry keys. Do not send test reports to production moderators. Source ownership stays with APP UI until an explicit scoped handoff.

## Reusable source with pending acceptance

Statement check results capture character, city and revision, reject stale replies/toasts, and invalidate on unmount. Statement history also fences pagination by identity. No actionable source defect was found there, but deferred check/history identity tests and actual UI acceptance remain required. Reuse published implementation after gates; do not recreate or blindly merge the entire UI branch.
