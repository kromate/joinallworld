// Toasts: one line of feedback under the top bar. At most two show at once (the oldest gives
// way), and a text that is already showing is not repeated: a stronger kind just recolours it.
import { ref } from 'vue'
import type { ToastKind } from '../types/panel.ts'
import { stripLeadEmoji } from '../../ui/dom.ts'
import { play } from '../../audio/play.ts'

export interface ToastItem { id: number; text: string; kind: ToastKind }

export const MAX_TOASTS = 2
const KINDS: readonly ToastKind[] = ['info', 'good', 'earn', 'spend', 'error']
/** How long a toast stays: longer for a longer sentence, never more than seven seconds. */
export const toastLifetime = (text: string): number => Math.min(7000, 2800 + text.length * 40)

/** While true (the first landing, see landingHold.ts) a toast that is not an error waits its turn. */
export const toastHold = ref(false)
const waiting: { text: string; kind: ToastKind }[] = []
const RELEASE_STEP_MS = 1200

export function createToasts(later: (run: () => void, ms: number) => unknown = (run, ms) => setTimeout(run, ms)) {
  const items = ref<ToastItem[]>([])
  let nextId = 1
  function dismiss(id: number): void { items.value = items.value.filter((item) => item.id !== id) }
  function toast(text: unknown, kind: ToastKind = 'info'): void {
    if (!text) return
    const body = String(text)
    if (toastHold.value && kind !== 'error') { if (!waiting.some((item) => item.text === body)) waiting.push({ text: body, kind }); if (waiting.length > 3) waiting.shift(); return }
    let tone: ToastKind = KINDS.includes(kind) ? kind : 'info'
    if (tone === 'good' && /\+₦/.test(body)) tone = 'earn'
    // A finished goal: the scene host answers with a sub-second burst of confetti (src/scene/reward.ts).
    const plain = (text: string): string => stripLeadEmoji(text) || text
    const isGoal = /^goal complete/i.test(plain(body))
    if (isGoal) globalThis.window?.dispatchEvent(new CustomEvent('jaw:cheer'))
    // One line for one thing: a goal's own toast says what was done and what it paid, so the plain "… completed." line of
    // the same moment gives way to it — whichever of the two arrives first.
    const isDone = tone === 'info' && / completed\.$/.test(body)
    if (isDone && items.value.some((item) => /^goal complete/i.test(plain(item.text)))) return
    if (isGoal) items.value = items.value.filter((item) => !(item.kind === 'info' && / completed\.$/.test(item.text)))
    const showing = items.value.find((item) => item.text === body)
    // Money has its own sound (from the ledger), a finished goal its own phrase; the rest are a soft tick, a chime or a knock.
    if (!showing) play(isGoal ? 'goal' : tone === 'error' ? 'refused' : tone === 'good' ? 'success' : tone === 'info' ? 'toast' : '')
    if (showing) { if (tone !== 'info') showing.kind = tone; return }
    const item: ToastItem = { id: nextId++, text: body, kind: tone }
    items.value = [...items.value, item].slice(-MAX_TOASTS)
    later(() => dismiss(item.id), toastLifetime(body))
  }
  releaseWaiting = () => { const next = waiting.shift(); if (!next) return; toast(next.text, next.kind); if (waiting.length) later(releaseWaiting, RELEASE_STEP_MS) }
  return { items, toast, dismiss }
}
let releaseWaiting: () => void = () => {}
/** Show what waited, one at a time. */
export const releaseToasts = (): void => releaseWaiting()

const shared = createToasts()
export const toasts = shared.items
export const toast = shared.toast
export const dismissToast = shared.dismiss
