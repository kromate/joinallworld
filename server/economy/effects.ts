import type { MoneyEffect } from '../../src/types/life.ts'
import type { CityId } from '../../src/types/protocol.ts'
import type { SessionRecord } from '../types.ts'

/** Exact player-wallet mutation. Government treasuries and real-money commerce are separate audit scopes. */
export interface StoredWalletEffect extends MoneyEffect { publicId: string; cityId: CityId; operationId: string | null; ordinal: number; transferId?: string }
interface PendingEffects { effects: StoredWalletEffect[]; ordinals: Map<string, number> }
const pending = new WeakMap<SessionRecord, PendingEffects>()
const TRANSFER_ID = /^peer\|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\|\d{1,16}:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export const peerTransferId = (senderPublicId: string, clientId: string): string => `peer|${senderPublicId}|${clientId}`
export const isPeerTransferId = (value: unknown): value is string => typeof value === 'string' && TRANSFER_ID.test(value)
export function walletEffectSink(session: SessionRecord, cityId: CityId, operationId: string | null, transferId?: string): (effect: MoneyEffect) => void {
  return (effect) => {
    if (!Number.isSafeInteger(effect.at) || !Number.isSafeInteger(effect.amount) || effect.amount === 0 || !Number.isSafeInteger(effect.balanceAfter)
      || effect.balanceAfter < 0 || typeof effect.reason !== 'string' || !effect.reason) throw new Error('Invalid wallet effect')
    const held = pending.get(session) ?? { effects: [], ordinals: new Map<string, number>() }
    const key = `${cityId}\u0000${operationId ?? ''}`, ordinal = held.ordinals.get(key) ?? 0
    held.effects.push({ publicId: session.publicId, cityId, operationId, ordinal, ...(transferId ? { transferId } : {}), ...effect })
    held.ordinals.set(key, ordinal + 1); pending.set(session, held)
  }
}
export function drainWalletEffects(sessions: Iterable<unknown>): StoredWalletEffect[] {
  const effects: StoredWalletEffect[] = [], seen = new Set<object>()
  for (const value of sessions) {
    if (!value || typeof value !== 'object' || seen.has(value)) continue
    seen.add(value); const held = pending.get(value as SessionRecord)
    if (!held) continue
    pending.delete(value as SessionRecord); effects.push(...held.effects)
  }
  return effects
}
