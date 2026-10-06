// The only part of the admin section the first download carries: whether the server says this session is an admin, so the Phone may list
// the entry. A request, once, for a signed-in account (a guest cannot be an admin, so none is made); anyone else just gets nothing.
// The app itself, and every string of it, is a lazily loaded chunk (AdminApp.vue).
import { reactive } from 'vue'
import { useApp } from '../../state/app.ts'
import { useAccountLite } from '../account/useAccountLite.ts'

export const ADMIN_PANEL = 'admin'
export const adminGate = reactive({ admin: false, asked: false })

export async function probeAdmin(): Promise<void> {
  if (adminGate.asked) return
  const lite = useAccountLite()
  await lite.load()
  if (!lite.state.account) return
  adminGate.asked = true
  try { await useApp().game.fetchJson('/api/admin/me'); adminGate.admin = true } catch { adminGate.admin = false }
}

/** Alt + Shift + A opens the admin app, only when the server has said this session is an admin. True when the key was used. */
export function adminKey(event: KeyboardEvent, open: (id: string) => unknown): boolean {
  if (!adminGate.admin || !event.altKey || !event.shiftKey || event.code !== 'KeyA') return false
  event.preventDefault(); open(ADMIN_PANEL)
  return true
}
