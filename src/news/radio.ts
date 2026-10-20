/**
 * OWNER: news (docs/OPEN-SOURCE-PLAN.md, Phase 4)
 * THE DANFO RADIO: the same lines the ticker posts, read out between stops (src/app/features/danfo/DanfoRun.vue). A line the ticker posted in
 * the last hour in this city is read in turn; with none, the radio says something about the hour, in the register of the city. Text only: no
 * voice, no sound. Fetched with the first run's first quiet stretch, never with the first page.
 */
import { timeBand } from '../game/world-time.ts'
import { cityRules } from '../game/cities/registry.ts'
import { bankOf, fill, registerFor } from './banks.ts'
import { recentLines, tickerCity } from './ticker.ts'

/** The `n`-th radio line for a city at a moment. The ticker's own recent lines come first, newest first, one after another. */
export function radioLine(city: string, now: number, n: number): string {
  const recent = tickerCity() === city ? recentLines(now) : []
  if (recent.length) return recent[Math.abs(n) % recent.length]!.text
  const bank = bankOf(registerFor(city, cityRules(city)?.country?.id))[timeBand(now)]
  return fill(bank[Math.abs(n) % bank.length]!, { city: cityRules(city)?.name ?? 'the city' })
}
