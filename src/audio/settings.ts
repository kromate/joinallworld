// Sound preferences of this device. Small and dependency-free: the HUD speaker button, the Settings tab, the call tones and the
// lazily loaded audio engine all read the same values. Stored in localStorage only; nothing here is sent to the server.

export const SOUND_KEY = 'joinallworld-sound-v1'
export type SoundCategory = 'effects' | 'ambience' | 'calls'
export interface SoundSettings {
  /** The speaker: false is muted. */
  on: boolean
  /** 0..1 over everything. */
  master: number
  /** 0..1 per category. */
  effects: number
  ambience: number
  calls: number
  /** Quiet: no ambience and softer effects, for public places. */
  quiet: boolean
  /** The one-line "Sound is on" toast has been shown on this device. */
  told: boolean
}
export const SOUND_DEFAULTS: Readonly<SoundSettings> = { on: true, master: 0.8, effects: 0.6, ambience: 0.35, calls: 0.8, quiet: false, told: false }
/** What Quiet does to the effects level. */
export const QUIET_EFFECTS = 0.5

type Store = Pick<Storage, 'getItem'> | null | undefined
const level = (value: unknown, fallback: number): number => (typeof value === 'number' && value >= 0 && value <= 1 ? value : fallback)
const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)

/** The saved preferences, anything missing or malformed replaced by its default. */
export function readSound(storage: Store): SoundSettings {
  let saved: unknown = null
  try { saved = JSON.parse(storage?.getItem(SOUND_KEY) ?? 'null') } catch { saved = null }
  const s = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved as Record<string, unknown> : {}
  const d = SOUND_DEFAULTS
  return { on: flag(s.on, d.on), master: level(s.master, d.master), effects: level(s.effects, d.effects), ambience: level(s.ambience, d.ambience), calls: level(s.calls, d.calls), quiet: flag(s.quiet, d.quiet), told: flag(s.told, d.told) }
}

/** The gain a category plays at: 0 when muted, and 0 for ambience in Quiet. Call tones ignore Quiet (a ringing phone must still be heard). */
export function levelFor(settings: SoundSettings, category: SoundCategory): number {
  if (!settings.on) return 0
  if (category === 'ambience' && settings.quiet) return 0
  const quiet = category === 'effects' && settings.quiet ? QUIET_EFFECTS : 1
  return settings.master * settings[category] * quiet
}

let current: SoundSettings | null = null
const listeners = new Set<() => void>()
function storage(): Storage | null { try { return window.localStorage } catch { return null } }

/** The live settings of this tab (read from storage on first use). */
export function getSound(): SoundSettings { return current ??= readSound(storage()) }
/** The gain for a category right now. Call tones route their output through this. */
export function soundLevel(category: SoundCategory): number { return levelFor(getSound(), category) }
/** Change some preferences, save them and tell the listeners. Returns false when the browser would not save. */
export function setSound(patch: Partial<SoundSettings>): boolean {
  current = { ...getSound(), ...patch }
  let saved = true
  try { const target = storage(); if (!target) throw new Error('no storage'); target.setItem(SOUND_KEY, JSON.stringify(current)) } catch { saved = false }
  for (const listener of [...listeners]) listener()
  return saved
}
/** One tap on the speaker. */
export function toggleMute(): void { setSound({ on: !getSound().on }) }
/** Listen for changes (this tab's and other tabs'). Returns the unsubscribe. */
export function onSoundChange(listener: () => void): () => void {
  if (!listeners.size && typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  listeners.add(listener)
  return () => { listeners.delete(listener); if (!listeners.size && typeof window !== 'undefined') window.removeEventListener('storage', onStorage) }
}
function onStorage(event: StorageEvent): void {
  if (event.key !== SOUND_KEY) return
  current = readSound(storage())
  for (const listener of [...listeners]) listener()
}
