import type { WalletHistoryEntry, WalletHistoryResponse } from '../../../types/support.ts'

export interface StatementHistoryState { entries: WalletHistoryEntry[]; next: number | null; coverage: string; loading: boolean; loaded: boolean; error: string }
export function createStatementHistory(fetchPage: (after: number) => Promise<WalletHistoryResponse>, changed: () => void = () => {}) {
  const state: StatementHistoryState = { entries: [], next: 0, coverage: 'Recorded history starts when wallet recording was enabled.', loading: false, loaded: false, error: '' }
  let owner = '', generation = 0, destroyed = false
  const reset = (): void => { Object.assign(state, { entries: [], next: 0, coverage: 'Recorded history starts when wallet recording was enabled.', loading: false, loaded: false, error: '' }); changed() }
  return {
    state,
    setIdentity(next: string) { if (next === owner) return; owner = next; generation += 1; reset() },
    async load(after: number): Promise<boolean> {
      if (destroyed || !owner || state.loading) return false
      const mine = ++generation, mineOwner = owner; state.loading = true; state.error = ''; changed()
      try {
        const reply = await fetchPage(after)
        if (destroyed || mine !== generation || mineOwner !== owner) return false
        state.entries = reply.entries.slice(0, 50); state.next = reply.next; state.coverage = reply.coverage.label; state.loaded = true; return true
      } catch (error) {
        if (destroyed || mine !== generation || mineOwner !== owner) return false
        state.error = error instanceof Error ? error.message : 'Recorded history could not be loaded.'; return false
      } finally { if (!destroyed && mine === generation && mineOwner === owner) { state.loading = false; changed() } }
    },
    destroy() { destroyed = true; generation += 1 },
  }
}
