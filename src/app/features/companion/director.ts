// The director: a small rules engine that decides WHEN the companion speaks up unprompted, and what it says. Pure.
//
// Hard limits, so it is never spam:
//   - lively: at most one unprompted nudge every MIN_GAP_MS (3 minutes); quiet: no speech at all, only a dot on the button for something important; off: nothing.
//   - ignored twice in a row (dismissed, or left until it faded) and the gap doubles each time, up to MAX_GAP_MS; any tap on a nudge resets it.
//   - never while the player is typing, in a call, in a modal or sheet, confirming a trip skip, mid-tour, in a hidden tab, or in the middle of an activity.
//   - a moment of celebration may come sooner (MOMENT_GAP_MS) because it answers something the player just did; each happens once for ever.
//   - every nudge has "Not now". The same idle suggestion is not repeated within IDLE_REPEAT_MS.
import { nextStep } from './answers.ts'
import type { CompanionMode, PlayerMemory } from './memory.ts'
import type { CompanionAction, CompanionContext, CompanionReply, TourId } from './types.ts'

export const MIN_GAP_MS = 3 * 60_000
export const MAX_GAP_MS = 30 * 60_000
export const MOMENT_GAP_MS = 45_000
export const IDLE_AFTER_MS = 75_000
export const IDLE_REPEAT_MS = 20 * 60_000
export const BACKOFF_AFTER = 2

export interface Quiet { typing: boolean; inCall: boolean; modal: boolean; confirming: boolean; tour: boolean; hidden: boolean }
export type NudgeKind = 'moment' | 'warning' | 'social' | 'offer' | 'daily' | 'idle'
export interface Nudge { id: string; kind: NudgeKind; text: string; actions: CompanionAction[]; mood: NonNullable<CompanionReply['mood']>; /** Shown as a dot only, never spoken (quiet mode). */ dot?: boolean }

/** Something that just happened, worked out from two snapshots (detectEvents). */
export type GameEvent =
  | 'first-job' | 'first-friend' | 'first-trip' | 'promoted' | 'debt-repaid' | 'first-sale' | 'broke' | 'new-city' | 'friend-online' | 'map-opened' | 'joined' | 'ping'

export function detectEvents(before: CompanionContext | null, now: CompanionContext, cityIsNew: boolean): GameEvent[] {
  if (!before) return []
  const found: GameEvent[] = []
  if (!before.employed && now.employed) found.push('first-job')
  if (before.friendCount === 0 && now.friendCount > 0) found.push('first-friend')
  if (now.trips > before.trips && now.trips === 1) found.push('first-trip')
  if (now.jobLevel > before.jobLevel && before.employed && now.employed) found.push('promoted')
  if (before.rideDebt > 0 && now.rideDebt === 0) found.push('debt-repaid')
  if (before.sales === 0 && now.sales > 0) found.push('first-sale')
  if (!before.stuck && now.stuck) found.push('broke')
  if (before.cityId !== now.cityId && cityIsNew) found.push('new-city')
  const onlineNow = now.friends.filter((friend) => friend.online && !friend.founder), onlineThen = before.friends.filter((friend) => friend.online && !friend.founder)
  if (onlineNow.some((friend) => !onlineThen.some((was) => was.id === friend.id))) found.push('friend-online')
  if (before.mode !== 'map' && now.mode === 'map') found.push('map-opened')
  if (now.joined > before.joined) found.push('joined')
  if (now.pingsWaiting > before.pingsWaiting) found.push('ping')
  return found
}

const first = (name: string): string => name.trim().split(/\s+/)[0] ?? ''
const naira = (value: number): string => `₦${Math.round(value).toLocaleString('en-NG')}`
const offer = (id: TourId, label: string): CompanionAction => ({ kind: 'tour', tour: id, label })

/** What an event says. `null` when it has nothing to add. */
export function momentFor(event: GameEvent, ctx: CompanionContext, memory: PlayerMemory): Nudge | null {
  const name = first(ctx.name)
  const once = (key: string): boolean => !memory.milestones.includes(key)
  switch (event) {
    case 'first-job': return once('first-job') ? { id: 'moment:first-job', kind: 'moment', mood: 'celebrate', text: `You got a job, ${name}! Every shift pays, and Career shows the way up.`, actions: [{ kind: 'open', id: 'career', label: 'See Career' }] } : null
    case 'first-friend': return once('first-friend') ? { id: 'moment:first-friend', kind: 'moment', mood: 'celebrate', text: 'Your first friend! Things are better with people. Say hello?', actions: [{ kind: 'open', id: 'messages', label: 'Open Messages' }] } : null
    case 'first-trip': return once('first-trip') ? { id: 'moment:first-trip', kind: 'moment', mood: 'celebrate', text: 'Your first trip! Your home stays yours while you explore.', actions: [] } : null
    case 'promoted': return { id: `moment:promoted:${ctx.jobLevel}`, kind: 'moment', mood: 'celebrate', text: `Promotion! You moved up to level ${ctx.jobLevel}${ctx.jobRole ? ` as ${ctx.jobRole}` : ''}.`, actions: [{ kind: 'open', id: 'career', label: 'See Career' }] }
    case 'debt-repaid': return once('debt-repaid') ? { id: 'moment:debt-repaid', kind: 'moment', mood: 'celebrate', text: 'Ride debt cleared. Fresh start!', actions: [] } : null
    case 'first-sale': return once('first-sale') ? { id: 'moment:first-sale', kind: 'moment', mood: 'celebrate', text: 'Your first sale! The cash box is yours to collect.', actions: [{ kind: 'open', id: 'business', label: 'Open Business' }] } : null
    case 'broke': return once('broke') ? { id: 'offer:broke', kind: 'offer', mood: 'nod', text: 'Money is short right now, but there is a way through. Want me to show you?', actions: [{ kind: 'relief', label: 'Show me' }, offer('money', 'Money and work tour')] } : null
    case 'new-city': return once(`city:${ctx.cityId}`) ? { id: `offer:new-city:${ctx.cityId}`, kind: 'offer', mood: 'wave', text: `Welcome to ${ctx.cityName}! Want to see what is around?`, actions: [{ kind: 'open', id: 'map', label: 'Open the Map' }, offer('travel', 'Travel tour')] } : null
    case 'friend-online': {
      const friend = ctx.friends.find((item) => item.online && !item.founder)
      return friend ? { id: `social:online:${friend.id}`, kind: 'social', mood: 'wave', text: `${friend.name} just came online. Say hi?`, actions: [{ kind: 'chat', friend: friend.id, name: friend.name, label: 'Chat' }, { kind: 'call', friend: friend.id, name: friend.name, label: 'Call' }] } : null
    }
    case 'map-opened': return once('offer:travel') && ctx.cities.some((city) => city.open && !city.here) ? { id: 'offer:travel', kind: 'offer', mood: 'point', text: 'First time on the Map. Want a quick look at how travel works?', actions: [offer('travel', 'Show me')] } : null
    case 'joined': return { id: `social:joined:${ctx.joined}`, kind: 'social', mood: 'celebrate', text: 'Someone joined through your link. Nice work bringing a friend in!', actions: [{ kind: 'open', id: 'messages', label: 'See who' }] }
    case 'ping': return { id: `social:ping:${ctx.pingsWaiting}`, kind: 'social', mood: 'wave', text: 'A friend pinged you. They would love you to join them.', actions: [{ kind: 'open', id: 'people', label: 'See the ping' }] }
  }
}

/** A kind warning before trouble, or null. */
export function warningFor(ctx: CompanionContext): Nudge | null {
  const name = first(ctx.name)
  if (ctx.needs.hunger < 20) return { id: 'warn:hunger', kind: 'warning', mood: 'nod', text: `You are getting very hungry, ${name}. A meal soon keeps your mood up.`, actions: [{ kind: 'ask', text: 'I want to eat', label: 'Where can I eat?' }] }
  if (ctx.needs.energy < 15) return { id: 'warn:energy', kind: 'warning', mood: 'nod', text: 'Your energy is nearly gone. Some rest would do you good.', actions: [{ kind: 'ask', text: 'how do i rest', label: 'Where can I rest?' }] }
  if (ctx.rentDueSoon && ctx.cash >= 0) return { id: 'warn:rent', kind: 'warning', mood: 'think', text: 'Rent is due soon. A little in the Bank early avoids the late fee.', actions: [{ kind: 'open', id: 'bank', label: 'Open Bank' }] }
  if (ctx.stallAlert) return { id: 'warn:stall', kind: 'warning', mood: 'think', text: `About your stall: ${ctx.stallAlert}`, actions: [{ kind: 'open', id: 'business', label: 'Open Business' }] }
  if (ctx.stallsOpened > 0 && ctx.marketCloseHour !== null && ctx.hour === ctx.marketCloseHour - 1) return { id: 'warn:market', kind: 'warning', mood: 'point', text: 'The market closes within the hour. Stock your stall and collect the cash box before then.', actions: [{ kind: 'open', id: 'business', label: 'Open Business' }] }
  return null
}

/** "Three things for today", the first time the game is opened on a new day. */
export function dailyThree(ctx: CompanionContext): Nudge | null {
  const lines: string[] = []
  if (ctx.missions.claimable) lines.push(`Collect ${ctx.missions.claimable} finished mission${ctx.missions.claimable > 1 ? 's' : ''}`)
  for (const mission of ctx.missions.open.slice(0, 2)) lines.push(mission.label)
  if (ctx.goal && lines.length < 3) lines.push(ctx.goal.title)
  if (!ctx.employed && ctx.cash < 5000 && lines.length < 3 && !ctx.guest) lines.push('Find a job in Jobs')
  if (lines.length < 3 && ctx.friends.some((friend) => friend.online && !friend.founder)) lines.push('Say hi to a friend who is online')
  if (lines.length < 3) lines.push(`Explore somewhere new in ${ctx.cityName}`)
  if (lines.length < 3 && ctx.cash > 0) lines.push(`Check on your ${naira(ctx.cash)} in the Bank`)
  const picked = lines.slice(0, 3)
  return { id: 'daily', kind: 'daily', mood: 'wave', text: `Good ${ctx.hour < 12 ? 'morning' : ctx.hour < 17 ? 'afternoon' : 'evening'}, ${first(ctx.name)}! Three things for today: ${picked.map((line, at) => `${at + 1}) ${line}`).join(', ')}.`, actions: [{ kind: 'ask', text: 'what should i do now', label: 'Start with the first' }] }
}

export interface DirectorFacts {
  now: number
  /** Lagos date key, e.g. 2026-10-06, for "today". */
  day: string
  mode: CompanionMode
  ctx: CompanionContext
  quiet: Quiet
  /** Milliseconds since the player last did anything. */
  idleMs: number
  events: readonly GameEvent[]
  memory: PlayerMemory
  /** A nudge is on screen right now. */
  showing: boolean
  /** The game has been open this long (the daily list waits a few seconds). */
  openMs: number
}

export const isQuiet = (quiet: Quiet): boolean => quiet.typing || quiet.inCall || quiet.modal || quiet.confirming || quiet.tour || quiet.hidden
/** The gap now required between unprompted nudges, after the ones that were ignored. */
export function gapFor(ignored: number): number {
  if (ignored < BACKOFF_AFTER) return MIN_GAP_MS
  return Math.min(MAX_GAP_MS, MIN_GAP_MS * 2 ** (ignored - BACKOFF_AFTER + 1))
}

/** What to say now, or null. Called every few seconds and on events; it changes nothing (the caller records what it showed). */
export function decide(facts: DirectorFacts): Nudge | null {
  const { mode, ctx, memory, now } = facts
  if (mode === 'off' || facts.showing || isQuiet(facts.quiet) || ctx.guest && ctx.newPlayer && ctx.activities === 0 && facts.openMs < 20_000) return null
  const since = now - memory.nudge.lastAt
  const spoken = (nudge: Nudge): Nudge | null => (mode === 'quiet' ? (nudge.kind === 'warning' || nudge.kind === 'social' ? { ...nudge, dot: true } : null) : nudge)
  const recent = (id: string, ms: number): boolean => now - (memory.nudge.seen[id] ?? -Infinity) < ms
  // 1. Something just happened: celebrate it, offer the tour that fits, or point out the social chance.
  if (since >= MOMENT_GAP_MS) {
    for (const event of facts.events) {
      const moment = momentFor(event, ctx, memory)
      if (moment && !recent(moment.id, 6 * 3_600_000)) return spoken(moment)
    }
  }
  if (ctx.busy || ctx.travelling) return null
  const gap = gapFor(memory.nudge.ignored)
  if (since < gap) return null
  // 2. Kind warnings before trouble: each at most once an hour.
  const warning = warningFor(ctx)
  if (warning && !recent(warning.id, 3_600_000)) return spoken(warning)
  // 3. Three things for today, once a day.
  if (memory.dailyDay !== facts.day && facts.openMs >= 8_000 && !ctx.guest) { const daily = dailyThree(ctx); if (daily) return spoken(daily) }
  // 4. Idle for a while with nothing queued: one concrete suggestion for the moment.
  if (facts.idleMs >= IDLE_AFTER_MS) {
    const step = nextStep(ctx, Math.floor(now / 60_000))
    const id = `idle:${step.text.slice(0, 40)}`
    if (!recent(id, IDLE_REPEAT_MS)) return spoken({ id, kind: 'idle', text: step.text, actions: step.actions.slice(0, 2), mood: step.mood ?? 'point' })
  }
  return null
}

/** The new memory after a nudge was shown, answered, or ignored. */
export function afterShown(memory: PlayerMemory, nudge: Nudge, now: number, day: string): PlayerMemory['nudge'] {
  const same = memory.nudge.day === day
  return { ...memory.nudge, lastAt: now, day, shownToday: (same ? memory.nudge.shownToday : 0) + 1, seen: { ...Object.fromEntries(Object.entries(memory.nudge.seen).filter(([, at]) => now - at < 24 * 3_600_000)), [nudge.id]: now } }
}
export const afterIgnored = (memory: PlayerMemory): PlayerMemory['nudge'] => ({ ...memory.nudge, ignored: memory.nudge.ignored + 1 })
export const afterEngaged = (memory: PlayerMemory): PlayerMemory['nudge'] => ({ ...memory.nudge, ignored: 0 })
