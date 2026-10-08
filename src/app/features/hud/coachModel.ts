import { ref } from 'vue'

import { HINTS_KEY as COACH_KEY } from '../sim/settingsModel.ts'
export { COACH_KEY }
function initialHints(): boolean {
  try { return globalThis.localStorage?.getItem(COACH_KEY) !== '1' } catch { return true }
}
/** One tab's live preference; storage only determines its initial value. */
export const coachHints = ref(initialHints())
