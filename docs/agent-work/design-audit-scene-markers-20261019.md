# Scene markers (crown and ground marks)

- Branch: scene/markers (worktree from design/all), port 5481
- Owned: src/scene/characters.ts (markerOf crown), src/scene/controls.css (tag styles), src/scene/markers.ts and its test
- Done: new 3D crown within the old triangle budget; DOM crown tag larger with outline, glow and a gentle bob (none under reduced motion); NPC and player dots get a white ring; markers.ts ground-mark builders, pulse and ripple helpers.
- Blocked: wiring the ground marks needs src/scene/venue-scenes.ts (pinned); request logged.
- Next step: coordinator decides on the pin rebuild, then replace buildMarks() lines with markers.ts calls.
