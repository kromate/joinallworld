import type { WalletHistoryEntry, WalletHistoryResponse } from '../../src/types/support.ts'
import type { Db } from '../types.ts'

export const WALLET_HISTORY_LIMIT = 50
export const WALLET_HISTORY_COVERAGE = Object.freeze({ kind: 'since-recording' as const, complete: false as const,
  label: 'Recorded since wallet history was enabled. Earlier balance changes are not included.' })

export function walletHistory(db: Db, publicId: string, after: number): WalletHistoryResponse {
  const count = WALLET_HISTORY_LIMIT + 1
  const rows = db.$store?.walletEffectsPage ? db.$store.walletEffectsPage(publicId, after, count) : (() => {
    const found: (NonNullable<Db['walletEffects']>[number] & { seq: number })[] = [], effects = db.walletEffects ?? []
    for (let index = Math.max(0, after); index < effects.length && found.length < count; index++) {
      const effect = effects[index]; if (effect?.publicId === publicId) found.push({ ...effect, seq: index + 1 })
    }
    return found
  })()
  const entries: WalletHistoryEntry[] = rows.slice(0, WALLET_HISTORY_LIMIT).map(row => ({ seq: row.seq, at: row.at, amount: row.amount,
    balanceAfter: row.balanceAfter, reason: row.reason, cityId: row.cityId, operationId: row.operationId, ...(row.transferId ? { transferId: row.transferId } : {}) }))
  return { ok: true, code: 'ok', entries, next: rows.length > WALLET_HISTORY_LIMIT ? entries.at(-1)?.seq ?? null : null, coverage: WALLET_HISTORY_COVERAGE }
}
