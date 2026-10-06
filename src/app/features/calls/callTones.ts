// The sounds of a call, made with the Web Audio API (no audio files ship): a ringback for the caller, a different ring for
// the callee, and short tones for connected, ended, declined and failed. The volume is the shared call-sound level
// (src/audio/settings.ts, `calls`, which the speaker button and Settings change), read again whenever it changes.
//
// Browsers keep a page silent until the player has touched it. unlockCallAudio() is called inside the Call and Answer
// taps; a ring that comes before any touch is remembered and starts on the first tap or key press, and `toneState.locked`
// tells the incoming-call card to say so. Every tone stops at once through stopTones(). Vibration (phones) goes with the
// incoming ring only. Nothing here asks for a permission; a notification is shown only when the player already allowed them.
//
// The tests read `globalThis.__callTones` (the events in order, and what plays now) instead of listening.
import { reactive } from 'vue'
import { getSound, onSoundChange } from '../../../audio/settings.ts'
import { soundLevel } from '../../../audio/levels.ts'

export type ToneName = 'ringback' | 'ring' | 'connected' | 'ended' | 'declined' | 'failed'
export interface ToneEvent { tone: ToneName | null; event: 'start' | 'stop' | 'blocked'; at: number }
export const toneState = reactive({ locked: false })

const events: ToneEvent[] = []
let current: ToneName | null = null
let context: AudioContext | null = null
let master: GainNode | null = null
let loop: ReturnType<typeof setInterval> | null = null
let pending: ToneName | null = null
let listening = false
let unsound: (() => void) | null = null
let alert: { close(): void } | null = null
const live = new Set<{ stop(): void }>()

const note = (event: ToneEvent['event'], tone: ToneName | null): void => { events.push({ tone, event, at: Date.now() }); if (events.length > 200) events.shift() }
if (typeof globalThis !== 'undefined') (globalThis as { __callTones?: unknown }).__callTones = { events, playing: () => current, locked: () => toneState.locked }

const gain = (): number => Math.min(1, soundLevel('calls') * 0.6)
function audioContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null
  if (context) return context
  try {
    context = new AudioContext()
    master = context.createGain()
    master.gain.value = gain()
    master.connect(context.destination)
    unsound = onSoundChange(() => { if (master && context) master.gain.setTargetAtTime(gain(), context.currentTime, 0.02) })
  } catch { context = null }
  return context
}
/** One soft note, or two notes at once, starting `at` seconds from now. */
function tone(frequencies: number[], at: number, length: number, peak = 0.5): void {
  const audio = context, out = master
  if (!audio || !out || gain() <= 0) return
  const start = audio.currentTime + at, end = start + length
  const envelope = audio.createGain()
  envelope.gain.setValueAtTime(0.0001, start)
  envelope.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.03, length / 3))
  envelope.gain.setValueAtTime(peak, Math.max(start + 0.03, end - 0.06))
  envelope.gain.exponentialRampToValueAtTime(0.0001, end)
  envelope.connect(out)
  const oscillators = frequencies.map((frequency) => { const oscillator = audio.createOscillator(); oscillator.type = 'sine'; oscillator.frequency.value = frequency; oscillator.connect(envelope); oscillator.start(start); oscillator.stop(end + 0.02); return oscillator })
  const handle = { stop() { try { envelope.gain.cancelScheduledValues(audio.currentTime); envelope.gain.setValueAtTime(0.0001, audio.currentTime); for (const oscillator of oscillators) oscillator.stop() } catch { /* already finished */ } } }
  live.add(handle)
  oscillators[0]!.onended = () => { live.delete(handle); try { envelope.disconnect() } catch { /* gone */ } }
}

const PATTERNS: Record<ToneName, () => void> = {
  // The caller hears a calm double tone, 1.2 s of it and then silence.
  ringback: () => { tone([440, 480], 0, 1.2, 0.35) },
  // The callee hears a brighter two-note figure, twice.
  ring: () => { tone([784], 0, 0.16); tone([988], 0.18, 0.16); tone([784], 0.5, 0.16); tone([988], 0.68, 0.22) },
  connected: () => { tone([523], 0, 0.1, 0.4); tone([784], 0.12, 0.16, 0.4) },
  ended: () => { tone([784], 0, 0.1, 0.35); tone([523], 0.12, 0.2, 0.35) },
  declined: () => { tone([480], 0, 0.18, 0.35); tone([480], 0.3, 0.18, 0.35) },
  failed: () => { tone([392], 0, 0.14, 0.35); tone([330], 0.17, 0.14, 0.35); tone([262], 0.34, 0.24, 0.35) },
}
/** How long each short tone sounds, in ms. */
const LENGTH: Record<ToneName, number> = { ringback: 1200, ring: 900, connected: 300, ended: 350, declined: 500, failed: 600 }
const REPEAT: Partial<Record<ToneName, number>> = { ringback: 4000, ring: 2400 }

function unlock(): void {
  const audio = audioContext()
  if (!audio) return
  void audio.resume().then(() => {
    toneState.locked = audio.state !== 'running'
    if (audio.state === 'running' && pending) { const want = pending; pending = null; begin(want) }
  }).catch(() => { toneState.locked = true })
}
function waitForTouch(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  const go = (): void => {
    window.removeEventListener('pointerdown', go, true); window.removeEventListener('keydown', go, true); listening = false
    unlock()
  }
  window.addEventListener('pointerdown', go, true); window.addEventListener('keydown', go, true)
}
/** Call inside a tap (Call, Answer): the page may make sound from then on. */
export function unlockCallAudio(): void { unlock() }

function begin(tone: ToneName): void {
  current = tone
  note('start', tone)
  PATTERNS[tone]()
  const every = REPEAT[tone]
  if (every) loop = setInterval(() => { if (current === tone) PATTERNS[tone]() }, every)
  else setTimeout(() => { if (current === tone) { note('stop', tone); current = null } }, LENGTH[tone])
  if (tone === 'ring') vibrate()
}
function vibrate(): void {
  try { navigator.vibrate?.([350, 200, 350]) } catch { /* not allowed before a tap */ }
}
function playing(tone: ToneName): void {
  stopTones()
  const audio = audioContext()
  if (!audio) { note('blocked', tone); return }
  if (audio.state === 'running') { toneState.locked = false; begin(tone); return }
  // Still silent: remember a ring, and start it on the first touch. Short tones are not worth waiting for.
  note('blocked', tone)
  if (tone === 'ring' || tone === 'ringback') { pending = tone; toneState.locked = true; waitForTouch(); unlock() }
  else unlock()
}

export const startRingback = (): void => playing('ringback')
export const startIncomingRing = (): void => playing('ring')
export const playTone = (tone: Exclude<ToneName, 'ring' | 'ringback'>): void => playing(tone)

/** Silence everything now: the loops, the notes still sounding, the vibration, a notification. */
export function stopTones(): void {
  if (loop !== null) clearInterval(loop)
  loop = null; pending = null
  for (const handle of [...live]) handle.stop()
  live.clear()
  if (current !== null) { note('stop', current); current = null }
  try { navigator.vibrate?.(0) } catch { /* nothing to stop */ }
  toneState.locked = false
  alert?.close(); alert = null
}
/** The page is going away: stop and give the audio device back. */
export function closeCallAudio(): void {
  stopTones()
  unsound?.(); unsound = null
  const audio = context
  context = null; master = null
  void audio?.close().catch(() => {})
}

/** A system notification for a call that rings while the page is hidden, only when the player already allowed notifications. */
export function alertIncoming(name: string): void {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || typeof document === 'undefined' || document.visibilityState === 'visible') return
    const made = new Notification(`${name} is calling`, { tag: 'allworld-call', body: 'Open Allworld to answer.', requireInteraction: true })
    alert = made
  } catch { /* some phones only allow it from a service worker */ }
}
export const callSoundsOn = (): boolean => getSound().on && getSound().calls > 0
