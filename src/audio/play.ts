// The only part of the sound the first download carries: a hook that does nothing until the first tap, click or key. That gesture
// fetches the audio engine (a chunk of its own); before it, nothing is created and events are dropped. Events that arrive while
// the chunk loads are kept (a few) and played when it is up.
import type { LifeState } from '../types/life.ts'
import type { PanelView } from '../app/types/panel.ts'
import type { Engine } from './engine.ts'

let engine: Engine | null = null
let loading = false
let calling = false
let latest: [LifeState, PanelView] | null = null
const waiting: string[] = []

function wake(): void {
  if (engine) { engine.unlock(); return }
  if (loading) return
  loading = true
  import('./engine.ts').then(({ createEngine }) => {
    engine = createEngine()
    if (!engine) return
    engine.call(calling); engine.unlock()
    if (latest) engine.observe(...latest)
    for (const name of waiting.splice(0)) engine.play(name)
  }).catch(() => { loading = false })
}
if (typeof window !== 'undefined') for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, wake, { capture: true, passive: true })

/** Play a named sound (see EVENTS in data.ts), or `cmd:<type>` for an accepted command. */
export function play(name: string): void { if (engine) engine.play(name); else if (loading && waiting.length < 6) waiting.push(name) }
/** The game changed: the life and its view. */
export function observe(state: LifeState, view: PanelView): void { latest = [state, view]; engine?.observe(state, view) }
/** A voice call is ringing or connected: ambience steps back and interface sounds soften. */
export function setCallActive(on: boolean): void { calling = on; engine?.call(on) }
