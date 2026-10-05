// The always-loaded part of calls: it listens to the social socket and loads the controller
// (src/calls.ts) and the screens only when there is something to show: the first call the player
// places, or the first `call-incoming` frame. Until then calls cost this one small file.
import { onCallFrame, onSocketClose, sendFrame } from '../social/useSocial.ts'
import type { CallController } from '../../../calls.ts'
import type { CallServerFrame, CallsFrom } from '../../../types/calls.ts'
import { callStore } from './callState.ts'

let loading: Promise<CallController> | null = null
let ready: CallController | null = null
let listening = false

/** The controller, fetched on first use. */
export function loadCalls(): Promise<CallController> {
  loading ??= import('../../../calls.ts').then(({ createCallController, browserCallsEnv }) => {
    const controller = createCallController(browserCallsEnv(sendFrame))
    callStore.view = controller.view
    controller.subscribe((next) => { callStore.view = next })
    // A tab that is closed or hidden for good must not leave the other side ringing or the microphone open.
    window.addEventListener('pagehide', () => controller.hangup())
    ready = controller
    return controller
  })
  return loading
}
/** The controller if it has loaded already (a tap handler uses it so the browser still counts the tap). */
export const loadedCalls = (): CallController | null => ready

const SETTINGS: readonly CallsFrom[] = ['everyone', 'friends', 'nobody']
/** Start listening. Idempotent. */
export function startCalls(): void {
  if (listening) return
  listening = true
  onCallFrame((frame) => {
    if (frame.type === 'call-settings') {
      const calls = (frame as { calls?: unknown }).calls
      const found = SETTINGS.find((item) => item === calls)
      if (found) callStore.accepting = found
      return
    }
    // Nothing is fetched for a frame about a call this page never saw; only an incoming call starts the controller.
    if (!ready && frame.type !== 'call-incoming') return
    void loadCalls().then((controller) => controller.handle(frame as CallServerFrame))
  })
  onSocketClose(() => { ready?.socketClosed() })
}
/** Ask for, or change, who may ring this player. The answer arrives as a `call-settings` frame. */
export function requestCallSetting(calls?: CallsFrom): boolean { return sendFrame(calls ? { type: 'call-settings', calls } : { type: 'call-settings' }) }
