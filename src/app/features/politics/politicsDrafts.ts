// What the Politics app keeps while its sheet is closed: the picked tab, what was typed and the ids of requests kept for a retry.
import { reactive } from 'vue'
import type { LeverId } from '../../../types/politics.ts'
import type { TabId } from './politicsModel.ts'
import { requestSlot } from '../civic/civicCore.ts'
import { actorDraft } from '../civic/civicDrafts.ts'

export const politicsUi = actorDraft(() => reactive<{ tab: TabId; slogan: string; levers: Partial<Record<LeverId, number>>; party: { name: string; motto: string; colour: string }; court: { statement: string; counsel: string; argument: string; note: string }; grant: { amount: number | undefined; purpose: string } }>({
  tab: 'city', slogan: '', levers: {}, party: { name: '', motto: '', colour: 'green' }, court: { statement: '', counsel: '', argument: '', note: '' }, grant: { amount: undefined, purpose: '' },
}))
export const runRequest = actorDraft(requestSlot)
export const salaryRequest = actorDraft(requestSlot)
export const partyRequest = actorDraft(requestSlot)
export const fightRequest = actorDraft(requestSlot)
export const arrestRequest = actorDraft(requestSlot)
export const appealRequest = actorDraft(requestSlot)
export const escalateRequest = actorDraft(requestSlot)
export const bailRequest = actorDraft(requestSlot)
export const grantRequest = actorDraft(requestSlot)
