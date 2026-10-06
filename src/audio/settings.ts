// Sound preferences of this device: the part the first download needs (the HUD speaker and the engine read the same values).
// Stored in localStorage only; nothing here is sent to the server. The gains they mean are in levels.ts.

export const SOUND_KEY = 'joinallworld-sound-v1'
export interface SoundSettings {
  /** The speaker: false is muted. */
  on: boolean
  /** 0..1 over everything, and per category. */
  master: number
  effects: number
  ambience: number
  calls: number
  /** Quiet: no ambience and softer effects, for public places. */
  quiet: boolean
  /** The one-line "Sound is on" toast has been shown on this device. */
  told: boolean
}
export const SOUND_DEFAULTS: Readonly<SoundSettings> = { on: true, master: 0.8, effects: 0.6, ambience: 0.35, calls: 0.8, quiet: false, told: false }

type Store = Pick<Storage, 'getItem'> | null | undefined
/** The saved preferences; a value of the wrong kind or range is replaced by its default. */
export function readSound(storage: Store): SoundSettings {
  let saved: Record<string, unknown> = {}
  try { const parsed: unknown = JSON.parse(storage?.getItem(SOUND_KEY) ?? 'null'); if (parsed && typeof parsed === 'object') saved = parsed as Record<string, unknown> } catch { /* defaults */ }
  const out: Record<string, unknown> = { ...SOUND_DEFAULTS }
  for (const key of Object.keys(SOUND_DEFAULTS) as (keyof SoundSettings)[]) {
    const value = saved[key], fallback = SOUND_DEFAULTS[key]
    if (typeof value === typeof fallback && (typeof value === 'boolean' || (value as number) >= 0 && (value as number) <= 1)) out[key] = value
  }
  return out as unknown as SoundSettings
}

let current: SoundSettings | null = null
const listeners = new Set<() => void>()
const store = (): Storage | null => { try { return localStorage } catch { return null } }
const tell = (): void => { for (const listener of [...listeners]) listener() }

/** The live settings of this tab (read from storage on first use). */
export const getSound = (): SoundSettings => current ??= readSound(store())
/** Change some preferences, save them, tell the listeners. Returns false when the browser would not save. */
export function setSound(patch: Partial<SoundSettings>): boolean {
  current = { ...getSound(), ...patch }
  let saved = true
  try { store()?.setItem(SOUND_KEY, JSON.stringify(current)) } catch { saved = false }
  tell()
  return saved
}
/** One tap on the speaker. */
export const toggleMute = (): boolean => setSound({ on: !getSound().on })
/** Listen for changes (this tab's and, through the storage event, other tabs'). Returns the unsubscribe. */
export function onSoundChange(listener: () => void): () => void {
  if (!listeners.size && typeof window !== 'undefined') window.addEventListener('storage', (event) => { if (event.key === SOUND_KEY) { current = readSound(store()); tell() } })
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
