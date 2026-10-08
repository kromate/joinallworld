# Voice-note checkpoint

Local work began after the phone release, then the user made app-interior redesign the next release priority. Voice notes are unfinished and must not be claimed deployed.

Untracked source: `server/social/voice-notes.ts`, `src/types/voice-note.ts`, `src/app/features/messages/voiceRecorder.ts`.

Implemented boundaries: 60-second / 512,000-byte recording limit, 32kbps Opus hint, single Opus/WebM track parser with packet-derived duration and canonical container rewrite, and a browser recording state machine with microphone/object-URL ownership. The parser strips tags/seek metadata and rejects video, malformed/truncated containers and excessive duration/size. It does not decode or semantically moderate audio.

Evidence: a real Chrome MediaRecorder captured a synthetic tone without microphone access. Its 16,343-byte upload parsed and rewrote to 16,248 bytes / 3,900ms; FFmpeg decoded the cleaned recording. Independent short Opus fixtures passed; 61-second, video, truncated and oversized samples were rejected. A bounded 1,000-mutation diagnostic returned without uncaught errors; codec-payload mutations can remain accepted because this is container validation, not a codec decoder. Typecheck passed before the last small validator refinements.

Still required: private upload/retrieval routes, bounded Node/Worker blob lifecycle, authorization on every read, byte-fingerprint retry identity, history/removal/report cleanup, moderation handling, player controls, review/send/retry UI, lazy playback with no autoplay, identity/chat-change disposal wiring, codec compatibility (older Safari AAC path not implemented), end-to-end probes, full checks and deployment. No runtime caller imports these modules yet.

References: https://www.w3.org/TR/mediastream-recording/ ; https://www.matroska.org/technical/elements.html ; https://www.matroska.org/technical/notes.html ; https://webkit.org/blog/16574/webkit-features-in-safari-18-4/ . Modern Safari supports Opus/WebM; older Safari's AAC/MP4 support requires a separate verified path.

Synthetic diagnostic files live in `/tmp/allworld-voice-probe/`; the original browser download is `/Users/anthonyakpan/Downloads/browser-voice.webm`. Temporary `voice-probe.html` was removed. This checkpoint does not reduce the full parity roadmap.

Update: integration work is preserved in stash `5860c8e5e0f350a01378ceb4b28cf9a9238daed1`. It now includes private stores/routes, reporting/removal, recipient controls and recording/playback components; fast checks and 40 existing checks passed. Worker persistence/browser integration remain unverified. UI remediation is the current priority. See APP-FLOW-AUDIT.md.
