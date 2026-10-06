// What the page knows of the launch offer: one small public answer, kept for a minute and shared by every place that shows it.
import { reactive } from 'vue'
import type { BonusClaimResponse, BonusOfferResponse } from '../../../types/account.ts'
import type { FetchJson } from '../../types/client.ts'
import type { Offer } from './bonusModel.ts'

export const OFFER_FRESH_MS = 60000
export const bonus = reactive<{ offer: Offer | null; at: number }>({ offer: null, at: 0 })
let asking: Promise<void> | null = null

/** GET /api/world/bonus, at most once a minute. A failure leaves the line off: nothing is promised that was not read. */
export function loadOffer(fetchJson: FetchJson, now: number = Date.now()): Promise<void> {
  if (bonus.offer && now - bonus.at < OFFER_FRESH_MS) return Promise.resolve()
  asking ??= fetchJson<BonusOfferResponse>('/api/world/bonus')
    .then((answer) => { bonus.offer = { on: answer.on === true, amount: answer.amount, places: answer.places, left: answer.left }; bonus.at = now })
    .catch(() => { /* unreachable: no offer is shown */ })
    .finally(() => { asking = null })
  return asking
}
/** POST /api/account/bonus: claim, or ask what became of it. `seen` records that the moment was shown. Null when it cannot be asked. */
export async function askBonus(fetchJson: FetchJson, csrf: string | null, seen = false): Promise<BonusClaimResponse | null> {
  try { return await fetchJson<BonusClaimResponse>('/api/account/bonus', { method: 'POST', body: { csrf, ...(seen ? { seen: true } : {}) } }) } catch { return null }
}
