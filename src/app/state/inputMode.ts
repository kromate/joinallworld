// The page's current answer to "touch or keyboard?" (src/ui/inputMode.ts), kept live: the first touch or key press, a resize and a
// change of pointer update it. Read `input.touch` and `input.keys`.
import { reactive } from 'vue'
import { inputMode, readFacts } from '../../ui/inputMode.ts'

export const input = reactive({ touch: false, keys: true })
const seen = { touchSeen: false, keySeen: false }
let started = false
function update(): void { const now = inputMode(readFacts(globalThis.window, seen)); if (now.touch !== input.touch) input.touch = now.touch; if (now.keys !== input.keys) input.keys = now.keys }
/** Begin watching (once). Safe without a window. */
export function startInputMode(win: Window | undefined = globalThis.window): void {
  if (started || !win) return
  started = true
  update()
  win.addEventListener('touchstart', () => { if (!seen.touchSeen) { seen.touchSeen = true; update() } }, { passive: true })
  win.addEventListener('pointerdown', (event) => { if (event.pointerType === 'touch' && !seen.touchSeen) { seen.touchSeen = true; update() } }, { passive: true })
  win.addEventListener('keydown', (event) => { if (!seen.keySeen && event.key.length === 1 || event.key.startsWith('Arrow')) { seen.keySeen = true; update() } })
  win.addEventListener('resize', update, { passive: true })
  for (const query of ['(pointer: coarse)', '(any-pointer: fine)']) win.matchMedia?.(query).addEventListener?.('change', update)
}
/** The answer right now, for a caller outside a component (it also starts watching). */
export function currentInput(): { touch: boolean; keys: boolean } { startInputMode(); update(); return { touch: input.touch, keys: input.keys } }
