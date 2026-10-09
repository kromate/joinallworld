# Hair-anchor v5 exact-geometry diagnostic

This isolated experiment compares the saved male-afro/hoodie and female-bun/owambe actors at source and Head-bounds candidate hair anchors. For each actor and anchor it captures front and profile yaws in original and compact body/wardrobe modes: 16 images total. Camera and fixed walk pose are frozen across all four cells for each actor/yaw.

The compact recipe retains each generated hair item’s complete source vertex range, index order, triangle count, and all source attributes; the body and non-hair wardrobe remain on the prior compact simplification path. A strict hash/triangle/vertex guard rejects any hair geometry change. This is diagnostic evidence only. It does not make afro/bun size more appropriate, establish eye visibility or continuous scalp contact, prove other hair styles, establish hardware/mobile performance, or accept the production renderer.

CPU compilation and GPU review run in dependent jobs in one workflow. The render job downloads only the artifact emitted by its successful package job, verifies the exact manifest hash and same-run commit/branch, then launches normal headless Chrome with ANGLE SwiftShader. Limits remain Node 96 MiB, group RSS 2 GiB, and 60 seconds for the renderer.
