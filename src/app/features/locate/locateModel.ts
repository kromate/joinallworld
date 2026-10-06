// The location-confirmed check without a DOM (docs/LOCATION.md): ask the browser where the device is ONCE, test it here against the
// boundary of the player's main-home local government, and report one word.
//
// LOCATION PRIVACY. The position exists only inside the callback of getCurrentPosition: it is reduced to a verdict by the pure test
// and dropped. It is never stored (not in a variable that outlives the callback, not in reactive state), never logged, never put in
// an error message, an analytics event or a request. What may leave the device afterwards is the action
// `estate.confirm-residence { lga, ok: true }` and nothing else, and only after a match. No watching, no background use: one
// getCurrentPosition per button press, with high accuracy off and a short timeout.
import { reactive } from 'vue'
import type { ResidenceView } from '../../../types/view.ts'
import { loadLocateApi } from './locateApi.ts'
import type { LocateApi } from './locateApi.ts'

export type CheckOutcome =
  | 'confirmed'     // the device is in (or at the border of) the area
  | 'outside'       // the device places the player somewhere else right now
  | 'inaccurate'    // the fix is too imprecise to say (a desktop placed by its network address)
  | 'denied'        // the player (or the browser) refused location for this site
  | 'unavailable'   // the device could not work out where it is
  | 'timeout'       // it took too long
  | 'insecure'      // the page is not on https: browsers give no location
  | 'unsupported'   // no location in this browser
  | 'no_boundary'   // this city has no boundary data to test against

/** One attempt: the browser is asked once, with these settings. */
export const POSITION_OPTIONS: PositionOptions = Object.freeze({ enableHighAccuracy: false, timeout: 10000, maximumAge: 0 })

export interface CheckDeps {
  geolocation: Pick<Geolocation, 'getCurrentPosition'> | undefined
  secure: boolean
  /** The lazy modules (a test hands in its own). */
  api?: () => Promise<LocateApi>
}
export const browserDeps = (): CheckDeps => ({ geolocation: globalThis.navigator?.geolocation, secure: globalThis.isSecureContext !== false })

/** What the check needs of the player's main home. */
export type CheckTarget = Pick<ResidenceView, 'city' | 'lga'>

/** Ask the browser where the device is and say whether it is in the main home's local government. Resolves; never rejects, never returns the position. */
export async function checkResidence(target: CheckTarget, deps: CheckDeps = browserDeps()): Promise<CheckOutcome> {
  if (!deps.secure) return 'insecure'
  const geolocation = deps.geolocation
  if (!geolocation) return 'unsupported'
  let api: LocateApi
  try { api = await (deps.api ?? loadLocateApi)() } catch { return 'no_boundary' }
  if (!api.has(target.city)) return 'no_boundary'
  const pack = await api.load(target.city).catch(() => null)
  if (!pack) return 'no_boundary'
  return new Promise<CheckOutcome>((resolve) => {
    try {
      geolocation.getCurrentPosition(
        // The position lives only in this callback: it becomes a word and is gone.
        (position) => {
          const verdict = api.judge(pack, target.lga, position.coords.latitude, position.coords.longitude, position.coords.accuracy)
          resolve(verdict === 'inside' || verdict === 'near' ? 'confirmed' : verdict)
        },
        (error) => resolve(error?.code === 1 ? 'denied' : error?.code === 3 ? 'timeout' : 'unavailable'),
        POSITION_OPTIONS)
    } catch { resolve('unavailable') }
  })
}

/** The words for each outcome. `area` is the name of the local government, `unit` what the city calls it. */
export function outcomeText(outcome: CheckOutcome, area: string, unit = 'local government'): string {
  switch (outcome) {
    case 'confirmed': return `Your device places you in ${area}. Your badge is on.`
    case 'outside': return `Your device places you outside ${area} right now. You can try again when you are home.`
    case 'inaccurate': return 'This device could only tell roughly where it is (a few kilometres or more, as a desktop computer often does), so nothing was confirmed. Try on a phone, outside or near a window.'
    case 'denied': return 'Location is switched off for this site, so nothing was checked.'
    case 'unavailable': return 'This device could not work out where it is just now. Try again in a moment, outside or near a window.'
    case 'timeout': return 'Finding the device took too long. Try again in a moment.'
    case 'insecure': return 'Browsers only share a location with secure (https) pages, so this cannot be checked here.'
    case 'unsupported': return 'This browser cannot share a location, so there is nothing to check.'
    case 'no_boundary': return `The ${unit} boundaries for this city are not available to check against yet.`
  }
}

/** How to allow location for this site, in one line for the browser the player has. */
export function allowHelp(userAgent: string): string {
  const ua = userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua)) return 'In Safari, tap the aA button in the address bar, choose Website Settings, set Location to Allow, then try again. (If it stays off: Settings, Privacy & Security, Location Services, Safari Websites.)'
  if (/Android/i.test(ua) && /Firefox/i.test(ua)) return 'Tap the lock icon in the address bar, choose Permissions, set Location to Allow, then try again.'
  if (/Android/i.test(ua)) return 'Tap the icon at the left of the address bar, choose Permissions, set Location to Allow, then try again.'
  if (/Firefox/i.test(ua)) return 'Click the permissions icon at the left of the address bar, remove the blocked Location setting, then try again.'
  if (/Edg\//i.test(ua) || /Chrome|CriOS/i.test(ua)) return 'Click the icon at the left of the address bar, open Site settings, set Location to Allow, then try again.'
  if (/Safari/i.test(ua)) return 'In the Safari menu choose Settings, then Websites, then Location, set this site to Allow, then try again.'
  return 'Allow location for this site in your browser\'s site settings, then try again.'
}

/** What the card shows between presses: nothing leaves this object but words. */
export interface LocateUi { step: 'rest' | 'explain' | 'checking'; outcome: CheckOutcome | null }
export const locateUi = reactive<LocateUi>({ step: 'rest', outcome: null })
