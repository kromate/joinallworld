/**
 * Which model-library integrations this page has switched ON. Every one is OFF by default: the running game uses its
 * own avatars (src/scene/characters.ts), its own atlas (src/world-map.ts) and its own batch-drawn map vehicles
 * (src/map3d/vehicles.ts). The library itself is always available to the workshop (models.html).
 *
 *   ?models=vehicles   the travelling player rides a model-library vehicle on the 3D city map (src/map3d/actor.ts)
 *   ?models=moments    the venue card now and then shows a local moment line (src/moments/, lazy) in place of its ambient line
 *
 * Several may be given, separated by commas. Unknown names are ignored.
 */
export const MODEL_FLAGS = Object.freeze(['vehicles', 'moments'] as const);
export type ModelFlag = (typeof MODEL_FLAGS)[number];
export type ModelFlags = Record<ModelFlag, boolean>;
export function modelFlags(search: string = globalThis.location?.search ?? ''): ModelFlags {
  let asked: string[] = [];
  try { asked = String(new URLSearchParams(search).get('models') ?? '').split(',').map((name) => name.trim()); } catch { asked = []; }
  return Object.fromEntries(MODEL_FLAGS.map((name) => [name, asked.includes(name)])) as ModelFlags; // fromEntries widens the keys to string
}
/** Whether the model-library trip vehicles are enabled for this host URL. */
export const modelLibraryEnabled = (search?: string): boolean => modelFlags(search).vehicles;
