import { reactive } from 'vue'
import type { PreviewFocus } from '../../../scene/avatar-preview.ts'

const SPUN_KEY = 'joinallworld-spun'
function wasSpun(): boolean {
  try { return globalThis.localStorage?.getItem(SPUN_KEY) === '1' } catch { return false }
}
/**
 * One editor state for the page, as the existing module has: the open tab, the field changed last
 * (head and shoulders while hair, face or skin is being changed), a Face / Full body override from
 * the stage's switch, and whether the player has ever spun the preview (kept on the device).
 */
export const lookUi = reactive<{ section: string; lastField: string | null; zoomOverride: PreviewFocus | null; spun: boolean }>({ section: 'body', lastField: null, zoomOverride: null, spun: wasSpun() })
export function markSpun(): void {
  if (lookUi.spun) return
  lookUi.spun = true
  try { localStorage.setItem(SPUN_KEY, '1') } catch { /* private mode */ }
}
