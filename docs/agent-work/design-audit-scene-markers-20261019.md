# Scene markers (crown and ground marks)

- Branch: scene/markers (worktree from design/all), port 5481
- Owned: src/scene/characters.ts (crown), src/scene/controls.css, src/scene/markers.ts (+test), src/scene/ambient/hub.ts (one line in attach())
- Done: new crown (3D and DOM tag); head dots; spot ring, near ring and tap ripple swapped by name from the hub after the scene builds its marks (restyleMarks); animation in the meshes' own onBeforeRender, so no loop and no per-frame allocation.
- Not done: the dark activity-spot pads (props.ts spotMarker, pinned and merged into the scene mesh); request logged.
