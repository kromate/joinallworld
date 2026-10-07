// The browser side of the sound: one AudioContext, created only after the first tap, click or key (the lazily loaded chunk is
// fetched on that gesture, see play.ts). It listens for the interface itself (taps, switches, tabs), for the avatar walking,
// for the tab being hidden, and for the preferences changing, and hands everything to the director.
import { contentFor } from '../game/cities/runtime.ts'
import { toast } from '../app/state/toasts.ts'
import type { LifeState } from '../types/life.ts'
import type { PanelView } from '../app/types/panel.ts'
import type { CitySound } from '../types/content.ts'
import { Director, type Seen } from './director.ts'
import { getSound, onSoundChange, setSound } from './settings.ts'
import { COMPANION_SOUNDS, TABLE_SOUNDS } from './data.ts'

export interface Engine {
  play(name: string): void
  observe(state: LifeState, view: PanelView): void
  call(on: boolean): void
  /** Called on every gesture until the context runs (iOS needs the resume inside a gesture). */
  unlock(): void
}

/** The director's picture of a life. Exported for tests. */
export function seenOf(state: LifeState, view: PanelView): Seen {
  const act = state.activeAction
  const mode = act && 'mode' in act && typeof act.mode === 'string' ? act.mode : undefined
  return {
    life: view.session?.id ?? '', city: state.estate.city, location: state.location, mode: view.mode === 'map' ? 'map' : 'venue',
    act: act ? { kind: act.kind, id: String(act.id), ...(mode ? { mode } : {}) } : null,
    tags: view.activities.active?.tags ?? [], raining: view.health.weather.raining === true,
    ledger: view.wallet.ledger.slice(0, 8).map(line => ({ at: line.at, amount: line.amount, reason: line.reason })), now: view.now,
  }
}

const PRESS = 'button,[role=button],[role=tab],[role=switch],[role=menuitem],a[href],summary,.ui-row,input[type=checkbox],select'
const TOLD = 'Sound is on · tap the speaker to mute'

export function createEngine(): Engine | null {
  const win = window
  const Context = globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Context) return null
  let ctx: AudioContext
  try { ctx = new Context({ latencyHint: 'playback' }) } catch { return null }
  const kinds = new Map<string, string>()
  const variants = new Map<string, string>()
  const director = new Director(ctx, {
    settings: getSound,
    soundOf: (city): CitySound | undefined => { try { return contentFor(city).sound } catch { return undefined } },
    kindOf: (city, venue) => {
      const key = `${city}/${venue}`
      let kind = kinds.get(key)
      if (kind === undefined) { try { kind = contentFor(city).venues.find(item => item.id === venue)?.kind ?? '' } catch { return '' } kinds.set(key, kind) }
      return kind
    },
    variantOf: (city, venue) => {
      const key = `${city}/${venue}`
      let variant = variants.get(key)
      if (variant === undefined) { try { variant = contentFor(city).venues.find(item => item.id === venue)?.definition.scene.variant ?? '' } catch { return '' } variants.set(key, variant) }
      return variant
    },
    now: () => Date.now(),
    every: (run, ms) => { const id = setInterval(run, ms); return () => clearInterval(id) },
    after: (run, ms) => { const id = setTimeout(run, ms); return () => clearTimeout(id) },
    live: true,
  })
  const running = (): boolean => ctx.state === 'running'
  const tell = (): void => { if (!getSound().told && running() && getSound().on) { setSound({ told: true }); toast(TOLD) } }
  const play = (name: string): void => { if (running() && director.play(name)) tell() }
  const unlock = (): void => {
    director.touch()
    if (ctx.state !== 'running') ctx.resume().catch(() => undefined)
  }

  const press = (event: Event): void => {
    unlock()
    const target = event.target as Element | null
    const hit = target?.closest?.(PRESS)
    if (!hit || (hit as HTMLButtonElement).disabled || hit.getAttribute('aria-disabled') === 'true') return
    // A switch plays its own sound when it changes (below), not a tap as well.
    if (hit.matches('[role=switch],input[type=checkbox]') || hit.querySelector('[role=switch],input[type=checkbox]')) return
    play(hit.matches('[role=tab]') ? 'tab' : 'tap')
  }
  const changed = (event: Event): void => {
    const box = event.target as HTMLInputElement | null
    if (box?.matches?.('[role=switch],input[type=checkbox]')) play(box.checked ? 'toggle-on' : 'toggle-off')
  }
  const moved = (event: Event): void => { const at = (event as CustomEvent<{ x: number; z: number }>).detail; if (at) director.step(at.x, at.z) }
  const shown = (): void => director.setHidden(document.hidden)
  const named = (event: Event): void => { const id = (event as CustomEvent<string>).detail; if (typeof id === 'string') play(id) }

  win.addEventListener('pointerdown', press, { capture: true, passive: true })
  win.addEventListener('keydown', unlock, { capture: true, passive: true })
  win.addEventListener('change', changed, { capture: true, passive: true })
  win.addEventListener('jaw:avatar-move', moved)
  win.addEventListener('jaw:sound', named)
  win.addEventListener('jaw:table', (event) => { const at = (event as CustomEvent<{ game?: string; event?: string }>).detail; const id = at && TABLE_SOUNDS[`${at.game}:${at.event}`]; if (id) play(id) })
  win.addEventListener('jaw:companion', (event) => { const at = (event as CustomEvent<{ kind?: string; mood?: string }>).detail; const id = at && COMPANION_SOUNDS[at.mood === 'celebrate' ? 'celebrate' : String(at.kind)]; if (id) play(id) })
  document.addEventListener('visibilitychange', shown)
  onSoundChange(() => director.applySettings())
  shown()

  const engine: Engine = {
    play,
    observe(state, view) { director.observe(seenOf(state, view)); tell() },
    call: on => director.setCall(on),
    unlock,
  }
  if (/[?&]sounds\b/.test(win.location.search)) void import('./board.ts').then(board => board.mountBoard(director, ctx)).catch(() => undefined)
  return engine
}
