# Actual WebGL source-chart comparison (prepared only)

This viewer isolates the v3 source-corner skinning equation from garment-shape changes. It loads the actual shipped male/female body and clip GLBs through the production `loadBody`, with one normalized office look per family. The production wardrobe renderer applies the same body index mask in both actors. The helper uses the public ordered `itemTriangles` ranges to filter only `outfit:office` triangles above its authored hem; hair, shoes, and any other item ranges are retained. It then inserts the same source-conformal, zero-ease office top on each actor using the same cloned production fabric material. The left variant uses ordinary Three.js skinning on that zero-ease chart; the right adds the four source-corner bind-position attributes and replaces the vertex-position skinning chunk. No body, mask, clip, color, fit, or chart topology differs between them.

The production overlay remains for the lower outfit and accessories; the new source chart is a second draw in both variants. The fixture reports the filtered overlay triangles, chart triangles/bytes, total rendered triangles/draw calls, and the exact adapter cache key. It verifies shared source-chart attributes/indices before rendering and compares actual post-mask body/skeleton bytes across the two actors. It explicitly renders both variants once so WebGL shader compilation errors are captured in the exposed snapshot API.

Controls: body family, source vs chart skinning, eight yaws, full/shoulder closeup, idle/walk/sit/interact reach, fixed walk phase, and continuous walk/interact. `window.__OFFICE_CHART_FIXTURE__` exposes deterministic `load`, `setVariant`, `setPose`, `setYaw`, `setFocus`, `snapshot`, and `shaderErrors` calls. This folder is source-only and has not been bundled or rendered; no WebGL compilation or pixel acceptance is claimed.

Known limits: the source-chart is exactly body-conformal at rest, so it is a deformation diagnostic, not a realistic shirt-ease candidate. The adapter changes positions only; Three's standard skinned-normal path remains unvalidated. The existing body mask can retain mixed boundary triangles, and the simple hem partition must be checked against the rendered indices. The extra chart draw and 48 bytes per chart vertex are diagnostic costs, not a production allocation proposal. Browser SwiftShader screenshots, if later run, would test shader/pixel behavior only, not mobile performance.

Frozen source pins:

- production wardrobe geometry `1b2dbfc4dd9557b6216eceb01ddd5f9bcf4119e48788a220589444902d5458ec`
- production wardrobe renderer `4b053592fdc8efdad0e9cd5071cb853594c2db53829cd74116bf578f439f82da`
- source-conformal zero-ease builder `8512d1ae241ee42e6d22491862df4d3807e408d21fd2497fa4a3f0304a4946b5`
- exact chart builder `75c04c98071a2df4d90a223e7b0065464a50847370e6d3beeea2e24804f7a04c`
- shader adapter `bdd57daee82013d0df1f435c947e2b8edd582d4550bc9365b1651dc247c26b02`
- male body `b0078206da9f7de0bf346be8133522cf514009f03f262f716613dd196d180686`
- female body `977ca5e73ba7b19af2627dab1ba0f0ef3e3d8548bf7b4d54f45faf22cd56001c`
- clip pack `89a2c636d3a9d1d9eac0e1125c20ca14d030c55ae27561dd8644b30645fd3d47`
