// The settings the Settings tab lists and reads. Fetched with it: the first download needs only whether hints are on
// (settingsModel.ts).
import type { Reader } from './settingsModel.ts'

export const SETTINGS_KEY = 'joinallworld-settings-v1'
export interface Settings { sound: boolean; music: boolean }
export const DEFAULTS: Settings = { sound: true, music: true }
export type SettingId = keyof Settings
export const OPTIONS: readonly { id: SettingId; label: string; hint: string }[] = [
  { id: 'sound', label: 'Sound effects', hint: 'Taps, coins and arrivals.' },
  { id: 'music', label: 'Music', hint: 'Background music in venues.' },
]
/** The saved preferences, with anything missing or malformed replaced by its default. */
export function readSettings(storage: Reader): Settings {
  let saved: unknown = null
  try { saved = JSON.parse(storage?.getItem(SETTINGS_KEY) ?? 'null') } catch { saved = null }
  const source = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved as Record<string, unknown> : {}
  const value = (key: SettingId): boolean => (typeof source[key] === 'boolean' ? source[key] : DEFAULTS[key])
  return { sound: value('sound'), music: value('music') }
}
export const NOT_SAVED = 'This browser would not save the setting, so it lasts only until you close the tab.'
export const WALLPAPER_NOT_SAVED = 'This browser would not save the wallpaper, so it lasts only until you close the tab.'
export const SESSION_RULES: string[] = [
  'As a guest your character lives on this device: there is no password and no e-mail address. A free account keeps it, and lets you play on any device.',
  'Without an account, a cookie in this browser is the only key to this life. Clearing cookies, or not playing for 30 days, ends the session; the life is kept on the server but cannot be reached again unless you had signed up.',
  'Other players only ever see your name and player code — never the cookie.',
  'Change your name and look in your Profile tab.',
]
