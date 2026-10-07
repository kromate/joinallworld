// The exchange bank, assembled, and what the page calls. This folder is a chunk of its own (vite.config.ts), fetched after the game is
// ready, so the lines never enter the startup bundle. The picker is pick.ts, the visit's pacing scheduler.ts.
import { MOMENT_BANK } from '../../moments/index.ts'
import type { Moment } from '../../moments/index.ts'
import { ANYWHERE_EXCHANGES, CITY_EXCHANGES, PLACE_EXCHANGES } from './lines.ts'
import { createChatter } from './scheduler.ts'
import type { Chatter } from './scheduler.ts'
import { BETA_CHATTER_LANGS } from './types.ts'
import type { Exchange } from './types.ts'

export { SLOT_MS, SPEAK_RATE, REPLY_DELAY_MS, SETTLE_MS, START_WINDOW_MS, VISIT_CAP, eligibleExchanges, exchangeAt, slotOf } from './pick.ts'
export { createChatter } from './scheduler.ts'
export type { Chatter } from './scheduler.ts'
export type { Chosen, ChatterContext, ChatterLang, ChatterPlace, Exchange, Regular, Spoken } from './types.ts'

const TWO_VOICES = /^“([^”]{2,80})” ?“([^”]{2,80})”$/
/** Words that mark a line as Pidgin: it is beta, like every Pidgin line of the banks. Over-marking is the safe side. */
const PIDGIN = /\b(dey|don|wetin|abeg|sef|abi|na|oga)\b/i

/**
 * The moment banks hold some lines that already are a short exchange: two spoken sentences and nothing else (“Oga, how much?” “For you,
 * special price.”). They are reused here as they are, with the place, city and band of the moment, so the two banks never drift apart.
 */
export function exchangesFromMoments(moments: readonly Moment[]): Exchange[] {
  const out: Exchange[] = []
  for (const moment of moments) {
    const spoken = TWO_VOICES.exec(moment.text)
    if (!spoken || moment.cond) continue
    const pidgin = PIDGIN.test(moment.text)
    const lang = moment.lang ?? (pidgin ? 'pcm' : 'en')
    out.push({
      id: `moment:${moment.id}`, lines: [spoken[1] as string, spoken[2] as string], weight: moment.weight, lang, beta: Boolean(moment.beta) || BETA_CHATTER_LANGS.includes(lang),
      ...(moment.placeKinds ? { placeKinds: moment.placeKinds } : {}), ...(moment.cityIds ? { cityIds: moment.cityIds } : {}), ...(moment.bands ? { bands: moment.bands } : {}),
    })
  }
  return out
}

/** Every exchange, all banks together. Ids are unique across it. */
export const EXCHANGE_BANK: readonly Exchange[] = Object.freeze([...ANYWHERE_EXCHANGES, ...PLACE_EXCHANGES, ...CITY_EXCHANGES, ...exchangesFromMoments(MOMENT_BANK)])

/** A visit's scheduler over the whole bank. */
export const newChatter = (): Chatter => createChatter(EXCHANGE_BANK)
