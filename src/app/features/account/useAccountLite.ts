// The one account state of the first download, wired to the application. Created on first use.
import { useApp } from '../../state/app.ts'
import { createAccountLite } from './accountLite.ts'
import type { AccountLite } from './accountLite.ts'

let shared: AccountLite | null = null
export function useAccountLite(): AccountLite {
  if (shared) return shared
  const { game } = useApp()
  shared = createAccountLite(game.fetchJson)
  return shared
}
