// The roadside chip's one memory: which event it has already drawn the eye to.

let shown = ''

/** The identity of a pending event: a new one is a new key. */
export const chipKey = (event: { id: string; at: number }): string => `${event.id}:${event.at}`
/** True the first time this key is seen (the chip pulses once), false for the same event after that and for no event. */
export function markShown(key: string): boolean {
  if (!key || key === shown) return false
  shown = key
  return true
}
/** For tests: forget what was shown. */
export const resetShown = (): void => { shown = '' }
