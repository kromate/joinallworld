// The pure part of the select of the control kit (src/ui/controls.js): which option an arrow key,
// Home, End or typed letters move to. The component (ListboxSelect.vue) holds the DOM; a test holds
// these equal to the existing functions.

export interface ListboxOption { value: string; label: string; disabled?: boolean }

/** The index of the next enabled option from `from` in direction `step` (no wrap). */
export function nextEnabled(options: readonly ListboxOption[], from: number, step: 1 | -1): number {
  for (let i = from + step; i >= 0 && i < options.length; i += step) if (!options[i]?.disabled) return i
  return from
}

/** The option a typed prefix goes to: the next one after `from` whose label starts with it. */
export function typeAhead(options: readonly ListboxOption[], from: number, typed: string): number {
  const want = typed.toLowerCase()
  for (let n = 1; n <= options.length; n += 1) {
    const i = (from + n) % options.length
    const option = options[i]
    if (option && !option.disabled && option.label.toLowerCase().startsWith(want)) return i
  }
  return from
}

/** On a small touch screen the platform's own picker is kept (coarse pointer, at most 720px wide). */
export function keepsNative(win: Pick<Window, 'matchMedia' | 'innerWidth'> | undefined = globalThis.window): boolean {
  return win?.matchMedia?.('(pointer: coarse)').matches === true && (win.innerWidth || 0) <= 720
}

/** What a key does to an open list. `null`: not a key of the list. */
export type ListboxKey = 'close' | 'next' | 'previous' | 'first' | 'last' | 'choose' | 'leave' | 'type'
export function listboxKey(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>): ListboxKey | null {
  const key = event.key
  if (key === 'Escape') return 'close'
  if (key === 'ArrowDown') return 'next'
  if (key === 'ArrowUp') return 'previous'
  if (key === 'Home') return 'first'
  if (key === 'End') return 'last'
  if (key === 'Enter' || key === ' ') return 'choose'
  if (key === 'Tab') return 'leave'
  if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) return 'type'
  return null
}
/** What a key does to a closed list: open it. */
export const opensList = (key: string): boolean => key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' '
