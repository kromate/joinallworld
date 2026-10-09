# Authored component isolation (V29 factory)

Diagnostic-only source fixture to identify whether pale calf pixels come from the body, casual garment, or shoe mesh. It loads one actual prepared casual actor at a time from the frozen factory snapshot `native-prepared-factory-v29.ts` copied byte-for-byte from commit `fa5726c717c285ec1671b331e0544c2f85b4bb7a` (SHA-256 `ecf30896371cdf65317894e5f2add34eb7679f0f8b9c5f72210457159f38f5e2`). It does not use the current V32 factory.

The controls load male casual, female casual, or female office, then toggle actual `Body`, the matching authored garment, and `Authored footwear shoes01` meshes on the same actor, pose, and camera. Presets include combined, body-only, clothes-only, shoes-only, and no-shoes. The remote runner captures idle and two walk phases from front and side for all five states. JSON reports the exact look/seed, mesh visibility, triangles, pose, and renderer counters. This is a component attribution aid, not a visual quality or gameplay acceptance result.

Bundle with `node evidence/graphics-loop/authored-complete-body-v1/native-full-runtime-v1/calf-component-toggle-v1/bundle-calf-component-toggle.mjs`; serve the repository root with the existing static fixture server, then open `/evidence/graphics-loop/authored-complete-body-v1/native-full-runtime-v1/calf-component-toggle-v1.html`. No production files are modified.
