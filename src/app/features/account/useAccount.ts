// The one account store of the page, wired to the application. Created on first use.
import { useApp } from '../../state/app.ts'
import { STORAGE_KEY } from '../../../client.ts'
import { createAccount } from './accountStore.ts'
import { useAccountLite } from './useAccountLite.ts'
import type { Account } from './accountStore.ts'

let shared: Account | null = null
export function useAccount(): Account {
  if (shared) return shared
  const { game } = useApp()
  shared = createAccount({
    fetchJson: game.fetchJson,
    // The provider's code is its own file, fetched when a sign-in is first sent.
    loadProvider: () => import('./identityProvider.ts'),
    origin: () => globalThis.location.origin,
    forgetLife() { try { globalThis.localStorage?.removeItem(STORAGE_KEY) } catch { /* nothing was kept */ } },
    reload() { globalThis.location.reload() },
  }, useAccountLite())
  return shared
}
