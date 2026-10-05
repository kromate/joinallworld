// The preferences the Settings tab keeps on this device. Pure (storage is passed in), so it is
// tested without a browser. Nothing here is sent to the server.

export const SETTINGS_KEY = 'joinallworld-settings-v1'
/** Hints (the pointer to the next step) live under their own key, shared with the × on the coach line: '1' = off. */
export const HINTS_KEY = 'joinallworld-coach-off'

export interface Settings { sound: boolean; music: boolean }
export const DEFAULTS: Settings = { sound: true, music: true }
export type SettingId = keyof Settings
export const OPTIONS: readonly { id: SettingId; label: string; hint: string }[] = [
  { id: 'sound', label: 'Sound effects', hint: 'Taps, coins and arrivals.' },
  { id: 'music', label: 'Music', hint: 'Background music in venues.' },
]

type Reader = Pick<Storage, 'getItem'> | null | undefined

/** The saved preferences, with anything missing or malformed replaced by its default. */
export function readSettings(storage: Reader): Settings {
  let saved: unknown = null
  try { saved = JSON.parse(storage?.getItem(SETTINGS_KEY) ?? 'null') } catch { saved = null }
  const source = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved as Record<string, unknown> : {}
  const value = (key: SettingId): boolean => (typeof source[key] === 'boolean' ? source[key] : DEFAULTS[key])
  return { sound: value('sound'), music: value('music') }
}

/** Are hints on? Anything but '1' under the hints key. */
export function hintsOn(storage: Reader): boolean {
  try { return storage?.getItem(HINTS_KEY) !== '1' } catch { return true }
}

export const NOT_SAVED = 'This browser would not save the setting, so it lasts only until you close the tab.'
export const WALLPAPER_NOT_SAVED = 'This browser would not save the wallpaper, so it lasts only until you close the tab.'

export const SESSION_RULES: string[] = [
  'As a guest your character lives on this device: there is no password and no e-mail address. A free account keeps it, and lets you play on any device.',
  'Without an account, a cookie in this browser is the only key to this life. Clearing cookies, or not playing for 30 days, ends the session; the life is kept on the server but cannot be reached again unless you had signed up.',
  'Other players only ever see your name and player code — never the cookie.',
  'Change your name and look in your Sim’s Profile tab.',
]
