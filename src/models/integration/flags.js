/**
 * Which model-library integrations this page has switched ON. Every one is OFF by default: the running game uses its
 * own avatars (src/scene/characters.js), its own atlas (src/world-map.js) and its own batch-drawn map vehicles
 * (src/map3d/vehicles.js). The library itself is always available to the workshop (models.html).
 *
 *   ?models=vehicles   the travelling player rides a model-library vehicle on the 3D city map (src/map3d/actor.js)
 *
 * Several may be given, separated by commas. Unknown names are ignored.
 */
export const MODEL_FLAGS = Object.freeze(['vehicles']);
export function modelFlags(search = globalThis.location?.search ?? '') {
  let asked = [];
  try { asked = String(new URLSearchParams(search).get('models') ?? '').split(',').map((name) => name.trim()); } catch { asked = []; }
  return Object.fromEntries(MODEL_FLAGS.map((name) => [name, asked.includes(name)]));
}
/** Whether the model-library trip vehicles are enabled for this host URL. */
export const modelLibraryEnabled = (search) => modelFlags(search).vehicles;
