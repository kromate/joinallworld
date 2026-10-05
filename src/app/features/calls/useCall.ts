// The Call button's logic, shared by every place a player card appears:
//
//   const { reason, request, busy } = useCall()
//   reason(card)         why Call cannot be pressed (null when it can)
//   request(peer)        the first call on a device shows the one line about network addresses and waits for a tap;
//                        every later one rings at once
// Only the invite is sent: no microphone is touched until the other player has answered.
import { computed } from 'vue'
import type { PlayerRef } from '../../../types/protocol.ts'
import { acknowledgeDisclosure, callActive, callStore, disclosureAcknowledged } from './callState.ts'
import { loadCalls } from './callsLoader.ts'

interface CallableCard { status?: string; blocked?: boolean; self?: boolean }

/** Why this person cannot be called right now, in plain words, or null. */
export function callReason(card: CallableCard, connected: boolean, supported = true): string | null {
  if (card.self) return 'This is you.'
  if (!connected) return 'Not connected.'
  if (card.blocked) return 'Unblock this player to call.'
  if (!supported) return 'Calls need a supported browser on HTTPS.'
  if (callStore.view.phase === 'elsewhere') return 'You are on a call on another device.'
  if (callActive()) return 'You are already in a call.'
  if (card.status === 'offline' || card.status === 'reconnecting') return 'They are offline.'
  return null
}

async function place(peer: PlayerRef): Promise<void> { (await loadCalls()).call(peer) }

/** Ring after the player has read the line (or had read it before). */
export async function confirmCall(): Promise<void> {
  const peer = callStore.confirm
  callStore.confirm = null
  acknowledgeDisclosure()
  if (peer) await place(peer)
}
export function cancelConfirm(): void { callStore.confirm = null }

/** Ring `peer`; true when it rang (or is about to), false when the line is waiting to be read first. */
export async function requestCall(peer: PlayerRef): Promise<boolean> {
  if (callActive()) return false
  if (!disclosureAcknowledged()) { callStore.confirm = { id: peer.id, name: peer.name }; return false }
  await place(peer)
  return true
}

export function useCall() {
  return { view: computed(() => callStore.view), busy: computed(() => callActive()), reason: callReason, request: requestCall, confirm: confirmCall, cancelConfirm }
}
