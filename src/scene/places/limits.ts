// OWNER: scenes (unique places)
// The per-model limits of the unique-places programme (docs/agent-plans/unique-places/CONTRACT.md "Output and acceptance per model").
// Triangle limits mirror the named budgets in src/budgets.ts (PLACE_MODEL_*); a test holds them equal. No imports: the generator, the
// Worker-side tests and the browser read this file.
export const PLACE_MODEL_LIMITS = Object.freeze({
  lod0: Object.freeze({ triangles: 20_000, brotliBytes: 110_000, bytes: 1_048_576 }),
  lod1: Object.freeze({ triangles: 4_000, brotliBytes: 30_000, bytes: 262_144 }),
  lod2: Object.freeze({ triangles: 500, brotliBytes: 6_000, bytes: 32_768 }),
})
/** The largest horizontal size of a model at LOD0, metres (building and site together). */
export const PLACE_MODEL_MAX_SIZE_M = 120
/** Scene units per metre: a 1.75 m person is 2.45 units tall. Equal to METRES_TO_SCENE in src/scene/recipe/contract.ts (a test holds them equal). */
export const PLACE_METRES_TO_SCENE = 2.45 / 1.75
