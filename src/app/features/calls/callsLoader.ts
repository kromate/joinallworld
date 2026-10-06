// The always-loaded part of calls: it listens to the social socket and loads the controller
// (src/calls.ts) and the screens only when there is something to show: the first call the player
// places, or the first `call-incoming` frame. Until then calls cost this one small file.
import { onCallFrame, onSocketClose, sendFrame } from '../social/useSocial.ts'
import type { CallController } from '../../../calls.ts'
import type { CallServerFrame, CallsFrom } from '../../../types/calls.ts'
import type { PlayerRef } from '../../../types/protocol.ts'
import { callStore } from './callState.ts'

let loading: Promise<CallController> | null = null
let ready: CallController | null = null
let listening = false

/** The controller, fetched on first use. */
export function loadCalls(): Promise<CallController> {
  // The tones come with the controller, so the Call and Answer taps can unlock sound in the same breath (iOS Safari insists).
  loading ??= Promise.all([import('../../../calls.ts'), import('./callTones.ts')]).then(([{ createCallController, browserCallsEnv }, tones]) => {
    const base = browserCallsEnv(sendFrame)
    const controller = createCallController({ ...base, unlockAudio: () => { base.unlockAudio?.(); tones.unlockCallAudio() } })
    callStore.view = controller.view
    controller.subscribe((next) => { callStore.view = next })
    // A tab that is closed or hidden for good must not leave the other side ringing or the microphone open; a device that
    // only rings, or only shows a call on another device, tells the server nothing (src/calls.ts pageHidden).
    window.addEventListener('pagehide', () => controller.pageHidden())
    ready = controller
    return controller
  })
  return loading
}
/** The controller if it has loaded already (a tap handler uses it so the browser still counts the tap). */
export const loadedCalls = (): CallController | null => ready

const SETTINGS: readonly CallsFrom[] = ['everyone', 'friends', 'nobody']
/** A `call-state` frame saying this player is ringing someone, or in a call, on another of their devices. */
export function startsElsewhere(frame: { type: string }): boolean {
  const state = frame as { type: string; elsewhere?: unknown; state?: unknown }
  return state.type === 'call-state' && state.elsewhere === true && (state.state === 'ringing' || state.state === 'accepted')
}
/** Start listening. Idempotent. */
export function startCalls(): void {
  if (listening) return
  listening = true
  // A page opened by a test run (the flag is set before the page loads) can place a call and read the state without going
  // through four panels. It gives a script nothing a player cannot already do with the Call button.
  try {
    if (window.localStorage.getItem('allworld:test-hooks') === '1') (window as unknown as { __allworldCalls?: unknown }).__allworldCalls = { call: async (peer: PlayerRef) => (await loadCalls()).call(peer), view: () => JSON.parse(JSON.stringify(callStore.view)) as unknown }
  } catch { /* storage is off: no hook */ }
  onCallFrame((frame) => {
    if (frame.type === 'call-settings') {
      const calls = (frame as { calls?: unknown }).calls
      const found = SETTINGS.find((item) => item === calls)
      if (found) callStore.accepting = found
      return
    }
    // Nothing is fetched for a frame about a call this page never saw; only an incoming call, or a call that began on
    // another device of this player, starts the controller.
    if (!ready && frame.type !== 'call-incoming' && !startsElsewhere(frame)) return
    void loadCalls().then((controller) => controller.handle(frame as CallServerFrame))
  })
  onSocketClose(() => { ready?.socketClosed() })
}
/** Ask for, or change, who may ring this player. The answer arrives as a `call-settings` frame. */
export function requestCallSetting(calls?: CallsFrom): boolean { return sendFrame(calls ? { type: 'call-settings', calls } : { type: 'call-settings' }) }
