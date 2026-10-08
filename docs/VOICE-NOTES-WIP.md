# Voice-note integration handoff

The complete saved implementation is published on `codex/voice-notes-checkpoint`, commit `b193bd771c744ae0ce5b007180f36eb5838e704e`. It includes 21 implementation files plus its handoff document, including all seven previously untracked modules. The original stash `5860c8e5e0f350a01378ceb4b28cf9a9238daed1` is retained.

This is an older-base checkpoint, not a release. Its parent is `9f9bed3616ac43e0989ce42d856490cb57d94dba`. Cherry-pick its single implementation commit onto fresh main, preserving current Family consent/routes, shared controls, chat preference feedback, message actions and save contracts. Resolve shared-file conflicts deliberately. Do not deploy the older branch directly.

## Source included

- Private Node file and SQLite voice stores, upload and authorized retrieval routes.
- Opus/WebM validation with packet-derived duration and canonical container rewriting; 60 seconds and 512,000 bytes maximum.
- Friend/membership/block/recipient checks, byte-fingerprint retry identity, message history, removal and report handling.
- Recorder review/send UI, lazy native playback, and chat/identity-change cleanup.

## Evidence boundary

Before the checkpoint, local fast checks, 40 existing checks and HTTP authorization/retry/removal probes passed. A Chrome MediaRecorder synthetic tone was parsed, rewritten and decoded by FFmpeg. These are historical results, not acceptance of an integration with current main. The old base predates the compiler-abort detection fix; use current main's fail-closed compiler and unchanged budgets.

## Remaining acceptance

1. Exact merged type/build/budget and existing focused checks.
2. SQLite restart/blob persistence, authorized reads, deletion, report handling and bounded cleanup.
3. Two synthetic actors recording/reviewing/sending/retrying/playing; permission denial, offline behavior and switching account/chat during recording or playback.
4. Block/group-removal/recipient-setting changes and stale response disposal.
5. Codec compatibility: the older Safari AAC/MP4 recording path is not implemented. Unsupported capture must be explicit. Container validation does not decode or semantically moderate audio.
6. Sealed release, retained production namespace/migration/secrets, pre/post synthetic save continuity and live verification.

The human's current workflow assigns integration, conflict resolution and follow-up bug fixing to the agent on the other system. No production deployment or actual-user audio capture is claimed by this handoff.
