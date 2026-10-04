// The local-government card without a DOM: what it is showing between renders, and finding the
// local government from the device's position.
//
// LOCATION PRIVACY. "Find my local government" asks the browser for a position, works out the
// local government ON THIS DEVICE from the boxes bundled in the city pack and keeps only the
// resulting id. The position is a local variable of one function: it is never stored, never
// logged, never put in an event and never sent: the action carries `{ lga, via: 'device' }` and
// nothing else. The player always confirms the answer before it is sent.
import { reactive } from 'vue'
import type { FoundLga, CityPackApi } from './cityPack.ts'
import { loadCityPackApi } from './cityPack.ts'

export interface LgaCardUi { finding: boolean; found: FoundLga | null; note: string; picking: boolean; sending: boolean }
/** One card state for the page (as before): a choice half made on one screen is still there on the next. */
export const lgaCardUi = reactive<LgaCardUi>({ finding: false, found: null, note: '', picking: false, sending: false })

export const GEOLOCATION_WHY: Readonly<Record<number, string>> = {
  1: 'Location is switched off for this site. Pick your local government from the list instead.',
  2: 'This device could not work out where it is. Pick your local government from the list instead.',
  3: 'Finding you took too long. Pick your local government from the list instead.',
}
export const NO_LOCATION = 'This device cannot share a location. Pick your local government from the list instead.'

export interface FindDeps {
  geolocation: Pick<Geolocation, 'getCurrentPosition'> | undefined
  /** Fetches the lazy map modules. */
  packs?: () => Promise<CityPackApi>
}

/** Ask the browser where the device is and turn the answer into a local government: here, and nowhere else. */
export async function findLga(ui: LgaCardUi, cityId: string, deps: FindDeps = { geolocation: globalThis.navigator?.geolocation }): Promise<void> {
  ui.note = ''
  ui.found = null
  if (!deps.geolocation) { ui.note = NO_LOCATION; ui.picking = true; return }
  ui.finding = true
  try {
    const packs = await (deps.packs ?? loadCityPackApi)()
    if (!packs.has(cityId)) { ui.note = NO_LOCATION; ui.picking = true; return }
    const pack = await packs.load(cityId)
    if (!pack) { ui.note = NO_LOCATION; ui.picking = true; return }
    const geolocation = deps.geolocation
    const found = await new Promise<FoundLga | null>((resolve, reject) => geolocation.getCurrentPosition(
      // The position exists only inside this callback: it is reduced to an id and dropped.
      (position) => resolve(packs.resolve(pack, position.coords.latitude, position.coords.longitude)),
      (error) => reject(error), { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }))
    if (found) ui.found = found
    else { ui.note = `You do not seem to be in ${pack.name} right now. Pick the local government you call home.`; ui.picking = true }
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    ui.note = (typeof code === 'number' ? GEOLOCATION_WHY[code] : undefined) ?? GEOLOCATION_WHY[2] ?? ''
    ui.picking = true
  } finally { ui.finding = false }
}
