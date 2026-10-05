/**
 * Touch or keyboard? Decided from several facts, because no single one is reliable (a phone in a desktop emulator, a laptop with a
 * touch screen, a tablet with a keyboard). Pure: the facts are passed in, so the decision is tested without a browser.
 *
 *   touch  gestures are offered: the pointer is coarse, the device reports touch points, a touch was seen, or the screen is
 *          narrow and has no fine pointer
 *   keys   key shortcuts are offered: there is a fine pointer, a key was pressed, or the device is not a touch one at all
 *
 * A device that is both (a touch laptop) gets both groups. The facts change live: the first touch or key event updates them.
 */
export interface InputFacts {
  /** matchMedia('(pointer: coarse)') */
  coarse: boolean
  /** matchMedia('(pointer: fine)') or '(any-pointer: fine)' */
  fine: boolean
  /** navigator.maxTouchPoints */
  touchPoints: number
  /** The viewport width in pixels. */
  width: number
  /** A touch event has arrived on this page. */
  touchSeen: boolean
  /** A real key has been pressed on this page. */
  keySeen: boolean
}
export interface InputMode { touch: boolean; keys: boolean }
export const NARROW = 720

export function inputMode(facts: InputFacts): InputMode {
  const touch = facts.coarse || facts.touchPoints > 0 || facts.touchSeen || (facts.width <= NARROW && !facts.fine)
  const keys = !touch || facts.fine || facts.keySeen
  return { touch, keys }
}

/** The facts as the page reports them now. */
export function readFacts(win: Pick<Window, 'matchMedia' | 'navigator' | 'innerWidth'> | undefined = globalThis.window, seen: { touchSeen?: boolean; keySeen?: boolean } = {}): InputFacts {
  const media = (query: string): boolean => win?.matchMedia?.(query).matches === true
  return { coarse: media('(pointer: coarse)'), fine: media('(pointer: fine)') || media('(any-pointer: fine)'), touchPoints: win?.navigator?.maxTouchPoints ?? 0, width: win?.innerWidth ?? 1024, touchSeen: seen.touchSeen === true, keySeen: seen.keySeen === true }
}
