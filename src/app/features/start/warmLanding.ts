// A device that has never played opens on the landing screen with the 3D preview of its character. The
// landing's code (the sheet, its stage, the preview and Three.js) is asked for at start-up, side by side
// with the scene, instead of one hop after another once the HUD is up: the preview is drawn as soon as
// the page can. A device with a saved life is not on the landing and fetches none of it.
// Nothing here runs the preview; it only fetches the modules the landing will import anyway.
import { STORAGE_KEY } from '../../../client.ts'
import { warmLookPreview } from './lookPreview.ts'

/** True when this browser has no saved life, so the first screen is the landing. */
export function isNewDevice(storage: Pick<Storage, 'getItem'> | null): boolean {
  try { return !storage || storage.getItem(STORAGE_KEY) === null } catch { return false }
}

let landing: Promise<void> | null = null

/**
 * Ask for the landing's code. Failures are ignored: the landing asks again when it needs it, with its own retry.
 * The scene waits for `landingCodeSettled()`, so on a slow connection the preview's download is not sharing the
 * line with the scene's: the preview is the first thing the player is looking at, the scene is behind the sheet.
 */
export function warmLanding(storage: Pick<Storage, 'getItem'> | null = globalThis.localStorage ?? null): void {
  if (landing || !isNewDevice(storage)) return
  const sheet = import('./QuickStartApp.vue').then(() => undefined, () => undefined)
  landing = Promise.all([sheet, warmLookPreview()]).then(() => undefined)
}

/** Resolves when the landing's code has arrived (or failed to), at once on a device that is not asked for it. Never rejects. */
export const landingCodeSettled = (): Promise<void> => landing ?? Promise.resolve()
