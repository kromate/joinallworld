# GPU source-corner comparison v4 — binding witness (prepared, unexecuted)

This distinct fixture follows v3's exact appearance replay. It does not modify v3/v5 sources or receipts and has not been executed.

The v5 run passed attribute replay then failed an opaque raw/displayed bind guard. It compared `bindMatrixInverse` for equality, although an attached SkinnedMesh recomputes that matrix from its current world transform. The standalone parsed GLTF and fitted production actor can have different parent-space world matrices. This fixture records finite local/world matrices, bind matrix, raw/displayed inverse and each inverse versus Three's bind-mode equation, plus ordered bone names and per-bone inverse-bind deltas. It still requires identical bind mode, local matrix, bind matrix, bone names and inverse-bind matrices; both inverses must exactly match the canonical relation. The raw/current inverse difference is reported rather than waved through.

Appearance replay remains strict: copy the production in-place masked index, draw range and groups to a private raw parse, invoke the same exact appearance controller, then require every current attribute byte and layout to match the displayed actor. The untouched full GLB index is saved first and installed only on a private clone of the current displayed geometry. The body mask is rechecked unchanged. CPU chart counts stay guarded at male 3,266 triangles/1,778 vertices and female 3,541/1,893, with 9,002 full source triangles.

The controller now records `loadFailure` and the remote CDP fails immediately on a fail-closed initial UI status rather than waiting through a timeout. No visual or mobile-performance acceptance is claimed.
