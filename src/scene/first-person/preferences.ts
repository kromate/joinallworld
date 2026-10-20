// Camera preferences belong to this browser only. The scene controller and Settings share this
// small boundary so a blocked localStorage still leaves the chosen view active for the visit.

export const VIEW_PREFERENCES_KEY = 'joinallworld-view'
export const VIEW_PREFERENCES_EVENT = 'jaw:view-preferences'

export interface ViewPreferences {
  mode: 'third' | 'first'
  bob: boolean
  vignette: boolean
  snapTurn: boolean
  /** Reduce shake and flashes: true or false is the player's choice; null follows the system's reduced-motion setting. */
  reduceShake: boolean | null
}

export const VIEW_PREFERENCES_DEFAULTS: Readonly<ViewPreferences> = {
  mode: 'third',
  bob: false,
  vignette: false,
  snapTurn: false,
  reduceShake: null,
}

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>
type PreferenceEventTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener' | 'dispatchEvent'>

/** Turn untrusted storage into a complete preference value, defaulting each invalid field. */
export function parseViewPreferences(value: unknown): ViewPreferences {
  let parsed = value
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) as unknown } catch { parsed = null }
  }
  const saved = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  return {
    mode: saved.mode === 'first' || saved.mode === 'third' ? saved.mode : VIEW_PREFERENCES_DEFAULTS.mode,
    bob: typeof saved.bob === 'boolean' ? saved.bob : VIEW_PREFERENCES_DEFAULTS.bob,
    vignette: typeof saved.vignette === 'boolean' ? saved.vignette : VIEW_PREFERENCES_DEFAULTS.vignette,
    snapTurn: typeof saved.snapTurn === 'boolean' ? saved.snapTurn : VIEW_PREFERENCES_DEFAULTS.snapTurn,
    reduceShake: typeof saved.reduceShake === 'boolean' ? saved.reduceShake : VIEW_PREFERENCES_DEFAULTS.reduceShake,
  }
}

export interface ViewPreferenceStore {
  read(): ViewPreferences
  set(patch: Partial<ViewPreferences>): boolean
  onChange(callback: () => void): () => void
}

/** Injectable store used by the browser singleton and focused Node tests. */
export function createViewPreferenceStore(storage: PreferenceStorage | null, events: PreferenceEventTarget | null = null): ViewPreferenceStore {
  let current: ViewPreferences | null = null
  const listeners = new Set<() => void>()
  let listening = false

  const read = (): ViewPreferences => {
    if (current) return current
    try { current = parseViewPreferences(storage?.getItem(VIEW_PREFERENCES_KEY) ?? null) } catch { current = { ...VIEW_PREFERENCES_DEFAULTS } }
    return current
  }
  const tell = (): void => { for (const callback of [...listeners]) callback() }
  const announce = (): void => {
    if (!events) return
    try { events.dispatchEvent(new CustomEvent(VIEW_PREFERENCES_EVENT, { detail: read() })) } catch { /* notifications are best effort */ }
  }
  const onStorage = (event: Event): void => {
    const change = event as StorageEvent
    if (change.key !== VIEW_PREFERENCES_KEY) return
    current = parseViewPreferences(change.newValue)
    tell()
    announce()
  }
  const listen = (): void => {
    if (!events || listening) return
    events.addEventListener('storage', onStorage)
    listening = true
  }
  const unlisten = (): void => {
    if (!events || !listening || listeners.size) return
    events.removeEventListener('storage', onStorage)
    listening = false
  }

  return {
    read,
    set(patch) {
      current = parseViewPreferences({ ...read(), ...patch })
      let saved = storage !== null
      try { storage?.setItem(VIEW_PREFERENCES_KEY, JSON.stringify(current)) } catch { saved = false }
      tell()
      announce()
      return saved
    },
    onChange(callback) {
      listeners.add(callback)
      listen()
      return () => { listeners.delete(callback); unlisten() }
    },
  }
}

let deviceStore: ViewPreferenceStore | null = null
function devicePreferences(): ViewPreferenceStore {
  if (deviceStore) return deviceStore
  let storage: Storage | null = null
  try { storage = globalThis.localStorage ?? null } catch { /* blocked storage keeps preferences in memory */ }
  const events = typeof window === 'undefined' ? null : window
  return deviceStore = createViewPreferenceStore(storage, events)
}

export function readViewPreferences(): ViewPreferences { return devicePreferences().read() }
export function setViewPreferences(patch: Partial<ViewPreferences>): boolean { return devicePreferences().set(patch) }
export function onViewPreferencesChange(callback: () => void): () => void { return devicePreferences().onChange(callback) }
