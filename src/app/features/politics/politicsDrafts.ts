// What the Politics app keeps while its sheet is closed: the picked tab, what was typed and the ids of requests kept for a retry.
import { reactive } from 'vue'
import type { LeverId } from '../../../types/politics.ts'
import type { TabId } from './politicsModel.ts'
import { requestSlot } from '../civic/civicCore.ts'

export const politicsUi = reactive<{ tab: TabId; slogan: string; levers: Partial<Record<LeverId, number>>; party: { name: string; motto: string; colour: string }; court: { statement: string; counsel: string; argument: string; note: string }; grant: { amount: number | undefined; purpose: string } }>({
  tab: 'city', slogan: '', levers: {}, party: { name: '', motto: '', colour: 'green' }, court: { statement: '', counsel: '', argument: '', note: '' }, grant: { amount: undefined, purpose: '' },
})
export const runRequest = requestSlot()
export const salaryRequest = requestSlot()
export const partyRequest = requestSlot()
export const fightRequest = requestSlot()
export const arrestRequest = requestSlot()
export const appealRequest = requestSlot()
export const escalateRequest = requestSlot()
export const bailRequest = requestSlot()
export const grantRequest = requestSlot()
