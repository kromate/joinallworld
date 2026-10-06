// The only part of the admin section the first download carries: whether the server has said this session is an admin, so the Phone may list
// the entry. The probe and the shortcut are in adminProbe.ts, fetched when the Phone opens or the shortcut is pressed.
import { reactive } from 'vue'

export const ADMIN_PANEL = 'admin'
export const adminGate = reactive({ admin: false })
