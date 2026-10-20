/**
 * OWNER: news (docs/OPEN-SOURCE-PLAN.md, Phase 4)
 * THE TICKER'S ONE SHARED COPY: the observer (observer.ts) wrapped in a small timer and a reactive line that the Square, the top of the
 * screen (Ticker.vue) and the danfo radio (radio.ts) all read. It runs only while someone is looking: the first viewer starts it, the last one
 * to leave stops it, and a hidden page does nothing. No frames are asked for; no request is made of its own beyond the gist read the Square
 * already makes (refreshed at most once a minute here, through the gist store's own limit).
 *
 * Everything in src/news/ is imported by lazy chunks only; the page fetches this one ten seconds after the game is ready (src/app/features/gist/mountTicker.ts).
 */
import { reactive } from 'vue'
import { createObserver } from './observer.ts'
import type { GistItem, LifeSnapshot, Observation, Observer, Outage, Posted } from './observer.ts'
import type { Register } from './banks.ts'

/** How often the ticker looks. */
export const TICK_MS = 3000
/** How often it asks the gist store to read the route again (the store keeps its own, shorter, limit). */
export const REFRESH_EVERY_MS = 60000

/** What the page can tell the ticker. Everything is read at the moment of looking, never kept. */
export interface TickerSource {
  city(): string
  cityName(): string
  register(): Register
  now(): number
  gist(): readonly GistItem[]
  life(): LifeSnapshot | null
  outages(now: number): readonly Outage[]
  /** Ask the gist store to read the route if it is due. */
  refresh(now: number): void
}

/** The line on the board. `at` is when it was posted; `squares` counts the Square panels showing it (the top strip stays quiet then). */
export const ticker = reactive<{ line: string; topic: string; at: number; squares: number }>({ line: '', topic: '', at: 0, squares: 0 })

let observer: Observer = createObserver()
let viewers = 0
let timer: ReturnType<typeof setInterval> | null = null
let source: TickerSource | null = null
let city = ''
let refreshedAt = -Infinity

/** One look. Exposed so the tests (and a viewer that has just mounted) can drive it without a timer. */
export function look(from: TickerSource, random?: () => number): Posted | null {
  const now = from.now(), here = from.city()
  // A new city is a new board: nothing carries over, so a line about Lagos is never told in Kano.
  if (here !== city) { city = here; observer = createObserver(random); ticker.line = ''; ticker.topic = ''; ticker.at = 0 }
  if (now - refreshedAt >= REFRESH_EVERY_MS) { refreshedAt = now; from.refresh(now) }
  const view: Observation = { now, city: here, cityName: from.cityName(), register: from.register(), gist: from.gist(), life: from.life(), outages: from.outages(now) }
  const line = observer.observe(view)
  if (line) { ticker.line = line.text; ticker.topic = line.topic; ticker.at = line.at }
  return line
}

/** Start looking for a viewer; call the returned function when it leaves. */
export function watchTicker(from: TickerSource): () => void {
  viewers += 1
  source = from
  if (!timer) {
    const run = (): void => { if (source && !globalThis.document?.hidden) look(source) }
    timer = setInterval(run, TICK_MS)
    run()
  }
  let left = false
  return () => {
    if (left) return
    left = true
    viewers = Math.max(0, viewers - 1)
    if (!viewers && timer) { clearInterval(timer); timer = null; source = null }
  }
}

/** The city the board is for (empty before the first look). */
export const tickerCity = (): string => city

/** The lines posted in the last hour, newest first (the danfo radio's chatter). */
export const recentLines = (now: number): readonly Posted[] => observer.recent(now)

/** Forget everything: the tests start each case from a clean board. */
export function resetTicker(): void {
  if (timer) { clearInterval(timer); timer = null }
  viewers = 0; source = null; city = ''; refreshedAt = -Infinity; observer = createObserver()
  ticker.line = ''; ticker.topic = ''; ticker.at = 0; ticker.squares = 0
}
