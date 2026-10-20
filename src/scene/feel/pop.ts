/**
 * OWNER: scenes
 * THE POP: a chip, a coin or a purse squashes to (1.3, 0.7) and springs back with an overshoot in 180 ms. Chips in the page do it with
 * the CSS keyframes `feel-pop` (src/ui/shell.css); popStyle says how hard and how long. There is no mesh tween: nothing in a scene
 * pops yet, so it is left out until something does.
 */

export const POP_MS = 180
export const POP_MS_REDUCED = 90

/** How hard (0..1) and how long (ms) a pop is; reduced motion halves both. */
export function popStyle(amplitude: number, reduced: boolean): { amount: number; ms: number } {
  const amount = Math.min(1, Math.max(0, amplitude)) * (reduced ? 0.5 : 1)
  return { amount, ms: reduced ? POP_MS_REDUCED : POP_MS }
}

/** Pop a page element: sets --pop (strength) and --pop-ms, and (re)starts the CSS animation. Does nothing without a document. */
export function popElement(node: Element | null | undefined, amplitude: number, reduced: boolean): void {
  const el = node as HTMLElement | null | undefined
  if (!el?.style) return
  const { amount, ms } = popStyle(amplitude, reduced)
  el.style.setProperty('--pop', String(amount))
  el.style.setProperty('--pop-ms', `${ms}ms`)
  el.classList.remove('feel-pop')
  void el.offsetWidth // restart the animation if it is already running
  el.classList.add('feel-pop')
  const done = (event: Event): void => { if (event.target === el) { el.classList.remove('feel-pop'); el.removeEventListener('animationend', done) } }
  el.addEventListener('animationend', done)
}
