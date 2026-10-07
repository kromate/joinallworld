/**
 * The skinned-body spike's switch (phase 1, E-A). OFF by default: the game draws its own procedural avatar
 * (src/scene/characters.ts). With `?body=skinned` in the page URL, the HOME scene alone swaps the player's own
 * figure for one skinned mesh with baked clips (src/scene/body/skinned.ts), loaded after the room's first frame.
 *
 * This file is the only part of the spike the home scene imports up front. It holds no Three.js and no assets: the
 * body module and its loaders are fetched by importBody(), and only when bodyWanted() and bodyAllowed() both say so.
 * Anything that fails on the way (no WebGL2, a fetch, a parse) leaves the procedural avatar exactly as it is.
 */

/** True when the page asked for the skinned body: `?body=skinned`. */
export function bodyWanted(search: string = globalThis.location?.search ?? ''): boolean {
  try { return new URLSearchParams(search).get('body') === 'skinned'; } catch { return false; }
}

/** What the device check reads (navigator in a browser; a plain object in tests). */
export interface BodyDevice {
  connection?: { saveData?: boolean; effectiveType?: string } | undefined;
  hardwareConcurrency?: number | undefined;
  deviceMemory?: number | undefined;
}

/**
 * Whether this device should fetch the body at all. No on Data Saver, on 2G, and on the low tier: two cores or fewer,
 * or 2 GB of memory or less (what the browser reports; an unreported value does not count against the device).
 */
export function bodyAllowed(device: BodyDevice | null | undefined = globalThis.navigator as BodyDevice | undefined): boolean {
  if (!device) return false;
  const connection = device.connection;
  if (connection?.saveData === true || connection?.effectiveType === '2g' || connection?.effectiveType === 'slow-2g') return false;
  if (typeof device.hardwareConcurrency === 'number' && device.hardwareConcurrency > 0 && device.hardwareConcurrency <= 2) return false;
  if (typeof device.deviceMemory === 'number' && device.deviceMemory > 0 && device.deviceMemory <= 2) return false;
  return true;
}

/** A renderer that draws with WebGL2 (the body needs it; anything else keeps the procedural avatar). */
export function drawsWebGL2(renderer: { getContext?: () => unknown } | null | undefined): boolean {
  const Context = (globalThis as { WebGL2RenderingContext?: abstract new (...args: never[]) => unknown }).WebGL2RenderingContext;
  try { return Boolean(Context && renderer?.getContext && renderer.getContext() instanceof Context); } catch { return false; }
}

/** How many times the body module has been asked for (tests: none at all with the flag off). */
export const bodyImports = { count: 0 };

/** Fetch the body module. The only way the game reaches it. */
export function importBody(): Promise<typeof import('./skinned.ts')> {
  bodyImports.count += 1;
  return import('./skinned.ts');
}
