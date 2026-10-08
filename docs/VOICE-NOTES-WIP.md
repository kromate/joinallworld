# Voice-note integration checkpoint

This branch publishes the complete tracked and untracked voice-note implementation preserved in stash `5860c8e5e0f350a01378ceb4b28cf9a9238daed1`, based on `9f9bed3616ac43e0989ce42d856490cb57d94dba`. It is a recovery/integration candidate, not a release. The original stash is retained.

## Implemented source

- Private Node and SQLite voice stores and upload/read routes.
- Opus/WebM validation and canonical container rewrite; 60-second/512,000-byte caps.
- Membership/friend/block/recipient-preference checks, retry byte fingerprints, removal and report moderation paths.
- Recorder review/send controls and lazy native playback with disposal on chat/identity changes.

## Required integration

Cherry-pick the single checkpoint commit onto fresh main, preserving Family routes/consent, message edits, current provider configuration, and save state. Resolve shared-file conflicts deliberately. Use main's current fail-closed compiler, release guards and budgets; the old base predates compiler-abort detection. Do not replace main with this older branch.

Historical local fast checks, 40 existing checks and an HTTP authorization/retry/removal probe passed before the stash. Those are not fresh acceptance for current main. Still required: exact merged type/build/budget checks; SQLite restart/blob lifecycle; two-actor recording/review/send/retry/playback; permission denial and offline behavior; group removal/block/report/delete; identity/chat-change cleanup; provider response headers; production continuity and live verification. Older Safari AAC/MP4 recording is not implemented; unsupported capture must remain explicit. The container validator does not decode or semantically moderate audio.

No production upload, save migration, credential change or actual-user recording is authorized by this checkpoint itself. The human's current workflow assigns integration/conflict/follow-up bug handling to the agent on the other system.
