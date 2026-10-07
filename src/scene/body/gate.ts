/**
 * The skinned body's capability gate (E-A). Every player gets the skinned body (src/scene/body/skinned.ts) in place of
 * the procedural avatar (src/scene/characters.ts) — there is no switch. The only ways out are what the device can do:
 * no WebGL2, a low-tier device, Data Saver or 2G, or a body file that fails to fetch or parse.
 *
 * This file is the only part of the body the scenes import up front. It holds no Three.js and no assets: the body
 * module and its loaders are fetched by importBody(), after the scene's first frame, and only when bodyAllowed() and
 * drawsWebGL2() both say so. Anything that fails on the way leaves the procedural avatar exactly as it is.
 */

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

/** How many times the body module has been asked for (tests: none at all without WebGL2). */
export const bodyImports = { count: 0 };

/** Fetch the body module. The only way the game reaches it. */
export function importBody(): Promise<typeof import('./skinned.ts')> {
  bodyImports.count += 1;
  return import('./skinned.ts');
}
