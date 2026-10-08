/** Shared local capture state. A panel may close while its short video keeps recording. */
import { effectScope, reactive, watch } from 'vue'
import type { EffectScope } from 'vue'
import { useApp } from '../../state/app.ts'
import { social, sync } from '../social/useSocial.ts'
import { CaptureFailure, captureFailureText, capturePng, recordCanvas } from './captureModel.ts'
import type { CanvasRecording } from './captureModel.ts'

const MAX_MS = 30_000
const MIN_VISIT_MS = 1_000

interface CaptureSessionState {
  busy: boolean
  recording: boolean
  secondsLeft: number
  photoUrl: string | null
  videoUrl: string | null
  error: string
  note: string
}

export const captureSession = reactive<CaptureSessionState>({
  busy: false,
  recording: false,
  secondsLeft: 0,
  photoUrl: null,
  videoUrl: null,
  error: '',
  note: '',
})

interface CaptureAccess { allowed: boolean; reason: string; maxDurationMs: number; revision: string; visitBound: boolean }
let recorder: CanvasRecording | null = null
let monitor: EffectScope | null = null
let observer: MutationObserver | null = null
let ticker: ReturnType<typeof setInterval> | undefined
let handlers: { offline: () => void; pagehide: () => void; visibility: () => void } | null = null
let generation = 0
let startedAt = 0

function access(): CaptureAccess {
  const { game } = useApp(), state = game.state.value, me = social.me
  const denied = (reason: string): CaptureAccess => ({ allowed: false, reason, maxDurationMs: 0, revision: '', visitBound: false })
  if (!game.connected.value || globalThis.navigator?.onLine === false) return denied('Reconnect before recording your home.')
  if (game.mode.value !== 'venue') return denied('Return to the 3D scene before capturing it.')
  if (state.location !== 'home') return denied('Capture is available in your home. Shared streets and venues are paused.')
  if (!me || social.error) return denied('Confirming who is in your home. Try again in a moment.')
  if (me.visiting || me.house.role !== 'host' || me.house.host.id !== me.me.id) return denied('Only the host can record their own home.')
  if (me.house.hostStatus !== 'home') return denied('Return home before recording.')
  const guests = me.house.guests
  if (!guests.length) return { allowed: true, reason: '', maxDurationMs: MAX_MS, revision: me.house.capture?.revision ?? '', visitBound: false }
  const capture = me.house.capture
  if (!capture?.ready) return denied('Every guest must allow recording for this visit first.')
  const remaining = capture.endsAt - game.serverNow() - 250
  if (remaining < MIN_VISIT_MS) return denied('This visit is ending. Wait for a new visit before recording.')
  return { allowed: true, reason: '', maxDurationMs: Math.min(MAX_MS, remaining), revision: capture.revision, visitBound: remaining <= MAX_MS }
}

export function captureAccess(): Readonly<CaptureAccess> { return access() }

function revoke(url: string | null): void { if (url) URL.revokeObjectURL(url) }
function clearOutput(): void {
  revoke(captureSession.photoUrl); revoke(captureSession.videoUrl)
  captureSession.photoUrl = null; captureSession.videoUrl = null
}
function stopTicker(): void { if (ticker !== undefined) clearInterval(ticker); ticker = undefined }
function stopMonitor(): void {
  monitor?.stop(); monitor = null
  observer?.disconnect(); observer = null
  if (handlers) {
    globalThis.window?.removeEventListener('offline', handlers.offline)
    globalThis.window?.removeEventListener('pagehide', handlers.pagehide)
    globalThis.document?.removeEventListener('visibilitychange', handlers.visibility)
    handlers = null
  }
  stopTicker()
}

function cancelActive(reason: string): void {
  const active = recorder
  if (!active) return
  generation++
  recorder = null
  captureSession.recording = false
  stopMonitor()
  active.cancel()
  captureSession.note = reason
  captureSession.error = ''
}

function contextKey(): string {
  const { game } = useApp(), state = game.state.value, me = social.me
  return JSON.stringify([
    state.location, game.mode.value, game.connected.value, state.estate.city,
    me?.visiting?.host.id ?? null, me?.house?.role ?? null, me?.house?.host.id ?? null,
    me?.house?.hostStatus ?? null, me?.house?.capture?.revision ?? null,
    me?.house?.capture?.ready ?? false, me?.house?.capture?.endsAt ?? null, social.error,
    (me?.house?.guests ?? []).map((guest) => guest.id).sort(),
  ])
}

function watchRecording(canvas: HTMLCanvasElement, run: number, startKey: string): void {
  const app = useApp(), venue = app.scene.venue.value
  const scope = effectScope(true)
  monitor = scope
  scope.run(() => watch(contextKey, (next) => {
    if (next !== startKey || app.scene.venue.value !== venue) cancelActive('The home visit or scene changed. Your clip was discarded.')
  }, { flush: 'sync' }))
  const offline = (): void => cancelActive('Connection lost. Your clip was discarded.')
  const pagehide = (): void => cancelActive('The page closed. Your clip was discarded.')
  const visibility = (): void => { if (globalThis.document?.hidden) cancelActive('The page was hidden. Your clip was discarded.') }
  handlers = { offline, pagehide, visibility }
  globalThis.window?.addEventListener('offline', offline, { once: true })
  globalThis.window?.addEventListener('pagehide', pagehide, { once: true })
  globalThis.document?.addEventListener('visibilitychange', visibility)
  if (typeof MutationObserver !== 'undefined' && canvas.parentElement) {
    observer = new MutationObserver(() => { if (!canvas.isConnected) cancelActive('The scene canvas closed. Your clip was discarded.') })
    observer.observe(canvas.parentElement, { childList: true, subtree: true })
  }
  ticker = setInterval(() => {
    if (run !== generation) return
    if (!canvas.isConnected) { cancelActive('The scene canvas closed. Your clip was discarded.'); return }
    captureSession.secondsLeft = Math.max(0, Math.ceil((activeDuration - (Date.now() - startedAt)) / 1000))
  }, 250)
}

let activeDuration = MAX_MS

/** Refresh the server-owned guest roster immediately before capturing. */
async function preflight(): Promise<CaptureAccess> {
  await sync()
  return access()
}

export async function takeScenePhoto(): Promise<void> {
  if (captureSession.busy || captureSession.recording) return
  captureSession.error = ''; captureSession.note = ''
  captureSession.busy = true
  const run = ++generation
  try {
    const permit = await preflight()
    if (!permit.allowed) { captureSession.error = permit.reason; return }
    const app = useApp(), venue = app.scene.venue.value, canvas = venue?.captureCanvas()
    if (!canvas) { captureSession.error = 'The scene is not ready yet. Try again in a moment.'; return }
    const startKey = contextKey()
    clearOutput()
    const blob = await capturePng(canvas)
    if (run !== generation || startKey !== contextKey() || app.scene.venue.value !== venue) return
    try { captureSession.photoUrl = URL.createObjectURL(blob) }
    catch { captureSession.error = 'This browser could not prepare the photo download.' }
  } catch (error: unknown) {
    if (run === generation) captureSession.error = error instanceof CaptureFailure ? captureFailureText(error.code) : captureFailureText('canvas_not_ready')
  } finally {
    captureSession.busy = false
  }
}

export async function startSceneRecording(): Promise<boolean> {
  if (captureSession.busy || captureSession.recording) return false
  captureSession.error = ''; captureSession.note = ''
  captureSession.busy = true
  const run = ++generation
  try {
    const permit = await preflight()
    if (!permit.allowed) { captureSession.error = permit.reason; return false }
    const app = useApp(), venue = app.scene.venue.value, canvas = venue?.captureCanvas()
    if (!canvas) { captureSession.error = 'The scene is not ready yet. Try again in a moment.'; return false }
    const startKey = contextKey()
    clearOutput(); activeDuration = permit.maxDurationMs; startedAt = Date.now(); captureSession.secondsLeft = Math.ceil(activeDuration / 1000)
    recorder = recordCanvas(canvas, {
      complete(blob) {
        if (run !== generation) return
        recorder = null; captureSession.recording = false; stopMonitor()
        try { captureSession.videoUrl = URL.createObjectURL(blob) }
        catch { captureSession.error = 'This browser could not prepare the video download.' }
        if (captureSession.videoUrl) { captureSession.note = 'Your clip is ready. Download it or discard it.'; app.game.toast('Your clip is ready in Capture.', 'good') }
      },
      fail(code) {
        if (run !== generation) return
        recorder = null; captureSession.recording = false; stopMonitor(); captureSession.error = captureFailureText(code)
      },
      limitReached() {
        if (run !== generation) return
        if (permit.visitBound) cancelActive('The visit ended. Your video was discarded.')
        else captureSession.note = 'The 30-second limit was reached. Your clip is being saved.'
      },
    }, activeDuration)
    captureSession.recording = true
    watchRecording(canvas, run, startKey)
    app.api.redrawScene()
    return true
  } catch (error: unknown) {
    recorder = null; captureSession.recording = false; stopMonitor()
    captureSession.error = error instanceof CaptureFailure ? captureFailureText(error.code) : captureFailureText('unsupported')
    return false
  } finally {
    captureSession.busy = false
  }
}

export function stopSceneRecording(): void {
  if (!recorder) return
  captureSession.note = 'Saving your clip…'
  recorder.stop()
}
export function discardCapture(): void {
  if (recorder) cancelActive('The recording was discarded.')
  generation++
  clearOutput(); captureSession.error = ''; captureSession.note = ''; captureSession.secondsLeft = 0
}
