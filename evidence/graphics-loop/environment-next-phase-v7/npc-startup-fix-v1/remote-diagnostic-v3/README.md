# NPC startup-fix diagnostic package v2

This folder contains only the corrected CPU packaging recipe. The actual v1 CPU artifact failed its pre-browser entrypoint check: `index.html` requested `./app/viewer.js`, while the emitted manifest listed `app/viewer-npc-v1.js`. The v2 CPU recipe keeps the already reviewed v1 runtime/viewer and renderer controls frozen, derives the HTML entry from the real compiler metafile, and verifies the URL against the hashed outputs.

The v1 renderer recipe remains under `remote-diagnostic-v1/render`; it is not a v2 renderer acceptance and must not be run against a v2 package until separately reviewed and pinned. No build, browser, visual, or mobile acceptance is claimed by this source-only preparation.
