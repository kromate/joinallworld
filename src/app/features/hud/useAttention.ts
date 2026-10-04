// The attention system in the Vue shell (src/ui/attention.ts): the one next step is ringed, spelled out
// in the coach line for the first starter goals or in a small bubble when the control is far from where
// the player last clicked, and a few things that happen elsewhere (money, a low need, something new in
// More, a card that has just appeared) are announced by a brief pill. It is silent on a Clean screen,
// with Hints off, and it tapers: each situational pointer is shown a few times and then retired.
// Nothing here keeps time: the movements are CSS animations that end by themselves.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { createAttention, nextStep } from '../../../ui/attention.ts'
import type { Attention, NextStep, Point, StepContext } from '../../../ui/attention.ts'
import { isTrip } from '../venue/venueModel.ts'
import { useApp } from '../../state/app.ts'
import { COACH_KEY } from './coachModel.ts'

/** How many times each situational pointer has been acted on (it retires after a few: attention.ts TAPER). */
export const SEEN_KEY = 'joinallworld-hints-seen'
/** A need under this is low. */
const LOW_NEED = 35

function readSeen(): Record<string, number> {
  try { const value: unknown = JSON.parse(globalThis.localStorage?.getItem(SEEN_KEY) ?? 'null'); return value && typeof value === 'object' ? value as Record<string, number> : {} } catch { return {} }
}
function readOff(): boolean { try { return globalThis.localStorage?.getItem(COACH_KEY) === '1' } catch { return false } }

export function useAttention() {
  const { game, shell } = useApp()
  const off = ref(readOff())
  const step = shallowRef<NextStep | null>(null)
  let attention: Attention | null = null
  let lastClick: (Point & { at: number }) | null = null
  let seen = readSeen()
  let stepId = ''
  let wasBusy = ''
  let lastWaiting = 0
  let lastCash: number | null = null
  let lastNeeds: Record<string, number> | null = null
  let lastLife = ''

  const root = (): HTMLElement | null => document.getElementById('life-overlay')
  const inOverlay = (selector: string): boolean => Boolean(root()?.querySelector(selector))

  function evaluate(): NextStep | null {
    const state = game.state.value, view = game.view.value
    return nextStep({
      state, view: view as StepContext['view'], mode: game.mode.value, expanded: shell.ui.expanded, clean: shell.ui.clean, hintsOff: off.value, sheet: shell.sheet.value?.kind ?? null, seen,
      apps: (id) => shell.byId.get(id), has: inOverlay,
      picked: game.mode.value === 'map' && inOverlay('[data-slot="main"] .map-go:not(:disabled)'),
    })
  }
  /** After the DOM the ring points into has been drawn (the venue panel, or the phone once it is open). */
  function point(): void {
    const next = evaluate()
    // A step that was showing and is now gone (or replaced) was acted on: count it, so the situational pointers taper off.
    if (stepId && stepId !== 'goal' && stepId !== next?.id) {
      seen = { ...seen, [stepId]: (seen[stepId] ?? 0) + 1 }
      try { globalThis.localStorage?.setItem(SEEN_KEY, JSON.stringify(seen)) } catch { /* counted for this visit */ }
    }
    stepId = next?.id ?? ''
    step.value = next
    for (const node of document.querySelectorAll('#life-dialog .is-coach')) node.classList.remove('is-coach')
    if (!attention) return
    const coach = next?.id === 'goal' && next.bubble
    const recent = lastClick && Date.now() - lastClick.at < 6000 ? lastClick : null
    // The coach line already says a goal step; only the situational pointers get a bubble of their own.
    attention.point(next?.target ?? null, { text: next && !coach && next.bubble ? next.text : '', from: recent })
    if (next?.app && shell.sheet.value?.kind === 'phone') document.querySelector(`#life-dialog [data-ph-app="${CSS.escape(next.app)}"]`)?.classList.add('is-coach')
  }

  /** Things that happen elsewhere: a card that has just appeared, money, a low need, something new in More. */
  function notice(): void {
    if (!attention) return
    const state = game.state.value, view = game.view.value
    const life = `${view.session?.id ?? ''}:${view.cityId}`
    if (life !== lastLife) { lastLife = life; lastCash = null; lastNeeds = null }
    const active = state.activeAction, busy = active ? `${active.kind}:${active.id}` : ''
    if (busy && busy !== wasBusy && lastClick && Date.now() - lastClick.at < 2500) {
      const card = document.querySelector<HTMLElement>(isTrip(active) && game.mode.value === 'map' ? '#life-overlay [data-slot="main"]' : '#life-overlay [data-slot="progress"]')
      attention.arrive(card, lastClick)
    }
    wasBusy = busy
    if (!view.connected) return
    // Money off the venue view (the map, a sheet): nothing else says it where the player is looking.
    if (lastCash !== null && state.cash !== lastCash && (game.mode.value !== 'venue' || Boolean(shell.sheet.value))) {
      const change = state.cash - lastCash
      const text = `${change > 0 ? '+' : '−'}₦${Math.abs(change).toLocaleString('en-NG')}`
      attention.announce(text, { at: '.hud-cash', kind: change > 0 ? 'good' : 'spend' })
    }
    lastCash = state.cash
    const needs: Record<string, number> = {}
    for (const need of view.needs.order) {
      const value = Math.round(state.needs[need] ?? 0)
      needs[need] = value
      if ((lastNeeds?.[need] ?? 0) >= LOW_NEED && value < LOW_NEED) attention.announce(`${need.charAt(0).toUpperCase()}${need.slice(1)} is low`, { at: '.hud-mood', kind: 'warn' })
    }
    lastNeeds = needs
    const waiting = root()?.querySelectorAll('.life-tray .is-active').length ?? 0
    if (waiting > lastWaiting && !shell.ui.trayOpen) attention.announce('Something new is waiting in More', { at: '.life-round[aria-controls="life-tray"]' })
    lastWaiting = waiting
  }

  const onClick = (event: PointerEvent): void => { lastClick = { x: event.clientX, y: event.clientY, at: Date.now() } }
  const onHints = (): void => { off.value = readOff() }
  function dismiss(): void {
    off.value = true
    attention?.clear()
    try { globalThis.localStorage?.setItem(COACH_KEY, '1') } catch { /* still off for this visit */ }
  }
  onMounted(() => {
    attention = createAttention({ root: root() ?? document.body, dialog: document.getElementById('life-dialog') as HTMLDialogElement | null })
    document.addEventListener('pointerdown', onClick, true)
    window.addEventListener('jaw:hints', onHints)
    void nextTick(() => { point(); notice() })
  })
  onBeforeUnmount(() => { document.removeEventListener('pointerdown', onClick, true); window.removeEventListener('jaw:hints', onHints); attention?.destroy(); attention = null })
  watch([game.state, game.mode, shell.sheet, off, () => shell.ui.clean, () => shell.ui.expanded, () => shell.ui.trayOpen], () => { void nextTick(() => { point(); notice() }) }, { flush: 'post' })
  /** The goal line the coach speaks for (the first starter goals); null when the pointer is only a ring or a bubble. */
  const coach = computed(() => (step.value?.id === 'goal' && step.value.bubble ? step.value : null))
  return { step, coach, dismiss }
}
