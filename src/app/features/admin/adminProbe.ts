// Asks the server once whether this signed-in account is an admin (a guest cannot be one, so none is asked), and the keyboard shortcut.
import { useApp } from '../../state/app.ts'
import { useAccountLite } from '../account/useAccountLite.ts'

import { ADMIN_PANEL, adminGate } from './adminGate.ts'

let asked = false
export async function probeAdmin(): Promise<void> {
  if (asked) return
  const lite = useAccountLite()
  await lite.load()
  if (!lite.state.account) return
  asked = true
  try { await useApp().game.fetchJson('/api/admin/me'); adminGate.admin = true } catch { adminGate.admin = false }
}
/** Alt + Shift + A opens the admin app, only when the server has said this session is an admin. */
export async function adminKey(open: (id: string) => unknown): Promise<void> { await probeAdmin(); if (adminGate.admin) open(ADMIN_PANEL) }
