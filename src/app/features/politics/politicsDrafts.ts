// What the Politics app keeps while its sheet is closed: the picked tab, what was typed and the ids of requests kept for a retry.
import { reactive } from 'vue'
import type { LeverId, TierId } from '../../../types/politics.ts'
import { requestSlot } from '../civic/civicCore.ts'

export const politicsUi = reactive<{ tab: TierId | 'parties'; slogan: string; levers: Partial<Record<LeverId, number>>; party: { name: string; motto: string; colour: string } }>({
  tab: 'city', slogan: '', levers: {}, party: { name: '', motto: '', colour: 'green' },
})
export const runRequest = requestSlot()
export const salaryRequest = requestSlot()
export const partyRequest = requestSlot()
