// What the page knows about calls, kept in the entry bundle on purpose: it is tiny, and it lets the
// Call button, the host and the lazily loaded controller and screens agree without loading either
// early. The controller itself (src/calls.ts) and the screens are fetched on the first call or the
// first incoming call (callsLoader.ts).
import { reactive } from 'vue'
import type { CallView } from '../../../calls.ts'
import type { CallsFrom } from '../../../types/calls.ts'
import type { PlayerRef } from '../../../types/protocol.ts'

export const idleView = (): CallView => ({ phase: 'idle', peer: null, role: null, callId: '', expiresAt: null, startedAt: null, muted: false, notice: null, error: null, playBlocked: false, devices: null, selectedDevice: '', outcome: null, duration: null, mic: 'none', micProblem: null, micLevel: 0, quality: null, path: null, relay: null, outputs: null, selectedOutput: '', awake: null })

export const callStore = reactive({
  view: idleView(),
  /** The player whose first call waits for the player to read the one line about network addresses. */
  confirm: null as PlayerRef | null,
  /** Who may ring this player, once the server has said. */
  accepting: null as CallsFrom | null,
})

/** The one line shown before the first call or answer on a device. */
export const DISCLOSURE = 'Calls connect your device directly to theirs, which can reveal your network address to them.'
const ACK_KEY = 'allworld:calls-ack'
function storage(): Storage | null { try { return window.localStorage } catch { return null } }
export function disclosureAcknowledged(): boolean { return storage()?.getItem(ACK_KEY) === '1' }
export function acknowledgeDisclosure(): void { try { storage()?.setItem(ACK_KEY, '1') } catch { /* it will be shown again */ } }

/** A call is in progress or being set up (the bar or the banner is showing). */
export const callActive = (view: CallView = callStore.view): boolean => view.phase !== 'idle' && view.phase !== 'ended'
/** Anything of calls is on screen: the host mounts the screens only then. */
export const callVisible = (): boolean => callStore.view.phase !== 'idle' || callStore.confirm !== null
