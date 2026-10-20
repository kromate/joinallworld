/**
 * OWNER: news (docs/OPEN-SOURCE-PLAN.md, Phase 4)
 * THE CITY NEWS OBSERVER: a pure watcher with no Vue, no DOM and no clock of its own. The caller hands it what it can see now (the gist lines
 * the page already has, a few life numbers, the districts that have just lost light, the time) and it answers with the line to post, or nothing.
 *
 *   - RATE LIMIT. After a line, the ticker is quiet for 7 seconds plus the line's weight, so a heavy story holds the board longer (COOLDOWN_S,
 *     banks.ts WEIGHT). A story that cannot be told yet waits in a short queue until it is stale, then is dropped: the ticker is never a backlog.
 *   - ORDINALS. Rolling counts per hour of the city clock (the Lagos hour, as everywhere in the game) give "the 3rd food stall opened in Yaba
 *     Market this hour". Every stall the page sees is counted, even one too old to announce.
 *   - NO REPEAT. The same words are not posted twice within an hour, a bank line is not reused within an hour while another is free, and the
 *     life, outage and quiet-hour topics post at most once per hour each (the plan's one-line-per-hour-per-kind rule).
 *   - AMBIENT. A time-of-day line only when nothing else is happening: nothing queued and nothing posted for a while.
 *   - OUTAGE. A district that has just lost light is told once (the scene's lamps and generators are src/scene's and the conditions code's).
 *
 * Nothing here talks to the server or stores anything: lines come from data that is already public (docs/GIST.md) or from the player's own
 * numbers, and a line never holds a name, a price or an amount.
 */
import { timeBand } from '../game/world-time.ts'
import { WEIGHT, bankOf, fill, ordinal } from './banks.ts'
import type { Register, Topic } from './banks.ts'

/** The quiet after any line, before its weight is added (the plan: 7 s + a weight). */
export const COOLDOWN_S = 7
/** A gist line older than this is counted for ordinals but not announced; a queued story older than this is dropped. */
export const FRESH_MS = 30 * 60000
/** A district that lost light longer ago than this is no longer news. */
export const OUTAGE_NEWS_MS = 20 * 60000
/** A life change (money, level, goal) that cannot be told within this is dropped. */
export const LIFE_NEWS_MS = 60000
/** How long nothing may have been posted before the board fills a quiet hour with colour. */
export const QUIET_MS = 90000
export const HOUR_MS = 3600000
/** The money jump that counts as news: at least this share of what was held and at least this many units (whatever the currency). */
export const CASH_JUMP = { share: 0.2, least: 1000 } as const
/** The most lines kept for the radio. */
export const RECENT_MAX = 8

export interface GistItem { n: number; at: number; kind: string; text: string }
export interface LifeSnapshot { cash: number; level: number; goals: number }
export interface Outage { district: string; from: number }

/** What the caller sees at one moment. */
export interface Observation {
  now: number
  city: string
  /** How the city is called in a line ("Lagos"). */
  cityName: string
  register: Register
  gist: readonly GistItem[]
  life: LifeSnapshot | null
  /** Districts that have no light now, the player's own first. */
  outages: readonly Outage[]
}

export interface Posted { text: string; topic: Topic; weight: number; at: number; key: string }

interface Candidate { key: string; topic: Topic; values: Record<string, string | number>; at: number; until: number; once: boolean }

export interface Observer {
  /** Look once. The line to show now, or null (too soon, nothing new, or nothing fit to repeat). */
  observe(view: Observation): Posted | null
  /** The lines posted in the last hour, newest first (the danfo radio reads them). */
  recent(now: number): readonly Posted[]
  /** The last line posted, or null. */
  readonly last: Posted | null
}

/** The hour of the city clock a moment falls in, counted from the start of time: it changes on the hour. */
export const hourIndex = (ms: number): number => Math.floor((ms + 3600000) / HOUR_MS)

const STALL = / opened an? (.+?) in (.+)$/i
const trimEnd = (text: string): string => text.replace(/[\s.!?]+$/, '')
const TOPIC_OF_KIND: Readonly<Record<string, Topic>> = { election: 'news', law: 'news', party: 'news', removal: 'news', jail: 'arrest', busy: 'crowd', event: 'crowd' }

export function createObserver(random: () => number = Math.random): Observer {
  let lastN = 0
  let cooldownUntil = 0, lastPostAt = -Infinity, lastAmbientHour = -1
  let base: LifeSnapshot | null = null
  let last: Posted | null = null
  let queue: Candidate[] = []
  const counts = new Map<string, number>()
  const postedText = new Map<string, number>()
  const usedLine = new Map<string, number>()
  const topicHours = new Set<string>()
  const outageSeen = new Set<string>()
  const recent: Posted[] = []

  function count(hour: number, key: string): number {
    const id = `${hour}|${key}`
    const next = (counts.get(id) ?? 0) + 1
    counts.set(id, next)
    return next
  }

  function ingest(view: Observation): void {
    const fresh = [...view.gist].filter((item) => item.n > lastN).sort((a, b) => a.n - b.n)
    for (const item of fresh) {
      lastN = Math.max(lastN, item.n)
      const stall = item.kind === 'business' ? STALL.exec(item.text) : null
      const values: Record<string, string | number> = {}
      let topic: Topic
      if (stall) {
        const what = stall[1] ?? 'stall', where = stall[2] ?? view.cityName
        const nth = count(hourIndex(item.at), `${what}|${where}`)
        values.what = what; values.where = trimEnd(where); values.ord = ordinal(nth)
        topic = nth > 1 ? 'stall-nth' : 'stall-first'
      } else {
        values.text = trimEnd(item.text)
        topic = TOPIC_OF_KIND[item.kind] ?? 'plain'
      }
      if (view.now - item.at > FRESH_MS || item.at > view.now + HOUR_MS) continue
      queue.push({ key: `gist:${item.n}`, topic, values, at: item.at, until: item.at + FRESH_MS, once: false })
    }
  }

  function watchLife(view: Observation): void {
    const life = view.life
    if (!life) { base = null; return }
    const before = base
    base = { ...life }
    if (!before) return
    const found: { topic: Topic; key: string }[] = []
    if (life.level > before.level) found.push({ topic: 'level', key: `life:level:${life.level}` })
    if (life.goals > before.goals) found.push({ topic: 'goal', key: `life:goal:${life.goals}` })
    const rise = life.cash - before.cash
    if (rise >= CASH_JUMP.least && rise >= before.cash * CASH_JUMP.share) found.push({ topic: 'cash', key: `life:cash:${view.now}` })
    for (const item of found) queue.push({ key: item.key, topic: item.topic, values: { city: view.cityName }, at: view.now, until: view.now + LIFE_NEWS_MS, once: true })
  }

  function watchOutages(view: Observation): void {
    for (const outage of view.outages) {
      const key = `outage:${outage.district}|${outage.from}`
      if (outageSeen.has(key) || outage.from > view.now) continue
      // Light that went long ago is not news; it is remembered all the same, so it is never told later either.
      outageSeen.add(key)
      if (view.now - outage.from > OUTAGE_NEWS_MS) continue
      queue.push({ key, topic: 'outage', values: { district: outage.district, city: view.cityName }, at: outage.from, until: outage.from + OUTAGE_NEWS_MS, once: true })
    }
  }

  /** A bank line for the topic that has not been used in the last hour, when one is left. */
  function chooseLine(register: Register, topic: Topic, now: number): { index: number; template: string } {
    const lines = bankOf(register)[topic]
    const free = lines.map((template, index) => ({ template, index })).filter(({ index }) => now - (usedLine.get(`${register}|${topic}|${index}`) ?? -Infinity) >= HOUR_MS)
    const from = free.length ? free : lines.map((template, index) => ({ template, index }))
    return from[Math.min(from.length - 1, Math.floor(random() * from.length))]!
  }

  function post(view: Observation, item: Candidate): Posted | null {
    const hour = hourIndex(view.now)
    const slot = `${item.topic}|${hour}`
    if (item.once && topicHours.has(slot)) return null
    const { index, template } = chooseLine(view.register, item.topic, view.now)
    const text = fill(template, item.values)
    if (view.now - (postedText.get(text) ?? -Infinity) < HOUR_MS) return null
    const weight = WEIGHT[item.topic]
    const line: Posted = { text, topic: item.topic, weight, at: view.now, key: item.key }
    postedText.set(text, view.now)
    usedLine.set(`${view.register}|${item.topic}|${index}`, view.now)
    if (item.once || item.topic === 'dawn' || item.topic === 'morning' || item.topic === 'afternoon' || item.topic === 'evening' || item.topic === 'night') topicHours.add(slot)
    cooldownUntil = view.now + (COOLDOWN_S + weight) * 1000
    lastPostAt = view.now
    last = line
    recent.unshift(line)
    recent.length = Math.min(recent.length, RECENT_MAX)
    return line
  }

  function forget(now: number): void {
    for (const [text, at] of postedText) if (now - at >= HOUR_MS) postedText.delete(text)
    for (const [line, at] of usedLine) if (now - at >= HOUR_MS) usedLine.delete(line)
    const hour = hourIndex(now)
    for (const id of counts.keys()) if (Number(id.slice(0, id.indexOf('|'))) < hour - 1) counts.delete(id)
    for (const slot of topicHours) if (Number(slot.slice(slot.indexOf('|') + 1)) < hour) topicHours.delete(slot)
  }

  return {
    observe(view) {
      ingest(view); watchLife(view); watchOutages(view)
      forget(view.now)
      queue = queue.filter((item) => item.until > view.now).slice(-12)
      if (view.now < cooldownUntil) return null
      // The heaviest story first; equal stories in the order they happened.
      const order = [...queue].sort((a, b) => WEIGHT[b.topic] - WEIGHT[a.topic] || a.at - b.at)
      for (const item of order) {
        queue = queue.filter((other) => other !== item)
        const line = post(view, item)
        if (line) return line
      }
      // Quiet: a line of colour once an hour, when nothing has been said for a while.
      const hour = hourIndex(view.now)
      if (!queue.length && hour !== lastAmbientHour && view.now - lastPostAt >= QUIET_MS) {
        lastAmbientHour = hour
        const band = timeBand(view.now)
        return post(view, { key: `ambient:${hour}`, topic: band, values: { city: view.cityName }, at: view.now, until: view.now, once: true })
      }
      return null
    },
    recent: (now) => recent.filter((line) => now - line.at < HOUR_MS),
    get last() { return last },
  }
}
