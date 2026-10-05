/**
 * OWNER: scenes
 * Scenes of Kano's own places, each asked for through `scene.variant` and held in VARIANTS[kind][variant]
 * like the variants of src/scene/venues-ibadan-b.ts and src/scene/venues-ogun-a.ts.
 */
import type { SceneDef } from './types.ts';

export const VARIANTS: Readonly<Record<string, Readonly<Record<string, SceneDef>>>> = {};
