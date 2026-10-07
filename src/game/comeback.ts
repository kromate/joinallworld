/**
 * OWNER: growth
 * Comeback mail, as pure functions: which things are worth an e-mail, and the one module that says how
 * often a player may be written to. No I/O, no clock of its own, no stored shape: the server
 * (server/growth/comeback.ts) gathers the facts, calls `decide`, claims the answer and sends it.
 * The design and the numbers are written down in docs/COMEBACK-MAIL.md.
 *
 *   triggers   needAlert · waitingPlan · nudgePlan · milestonePlan (with milestoneFacts) · eventPlan · awayPlan
 *   policy     decide(): the gates (preference, pause, recent activity, the stop after the final away mail, quiet hours, caps,
 *              back-off), then the choice by priority, then when to look again
 *
 * Nothing here reads a message body, a balance or a place. The facts carry first names of friends and counts.
 */
import { lagosDayStart, lagosTime } from './clock.ts';
import { shiftStatus } from './systems/career.ts';
import { DEPOSIT_TERMS } from './systems/economy.ts';
import { JOBS } from './content/jobs.ts';
import { HOUSE_TIERS } from './content/world.ts';
import { makeContext } from './util.ts';
import { PREF_OF } from './comeback-prefs.ts';
import type { ComebackType, LedgerType, PrefKey } from './comeback-prefs.ts';
import type { GoTarget } from './go-links.ts';
import type { LifeState, NeedId } from '../types/life.ts';

const HOUR = 3600000, DAY = 86400000;
/** `next` for a player who is not to be looked at again until something changes (a visit, a preference). */
export const NEVER = Number.MAX_SAFE_INTEGER;

export { COMEBACK_TYPES, PREF_KEYS, PREF_LABELS, PREF_OF } from './comeback-prefs.ts';
export type { ComebackType, LedgerType, PrefKey } from './comeback-prefs.ts';
/** Strongest first: the order in which one mail is chosen when several qualify. The weekly digest has its own schedule. */
const PRIORITY: readonly Exclude<ComebackType, 'week'>[] = ['waiting', 'nudge', 'need', 'milestone', 'event', 'away'];

export const COMEBACK = Object.freeze({
  /** Quiet hours, Lagos time: nothing from 21:00 until 08:00. */
  quietFrom: 21, quietTo: 8,
  /** Nothing is sent to a player who was active this recently. */
  activeHours: 12,
  /** At most this many mails in 24 hours and in 7 days, across every type (the weekly digest is one of them). */
  perDay: 1, perWeek: 3,
  /** After this many mails with no visit in between, at most one per `backoffDays`. */
  backoffAfter: 3, backoffDays: 14,
  /** However it came about, this many mails in a row with no visit end the run (the final away mail is always the last of them). */
  stopAfter: 5,
  /** A need alert needs this many hours away, and a need this low once the player is back (the game's own "low"). */
  needAwayHours: 24, needLow: 20,
  /** The needs that make a character say so in a mail. */
  needs: ['hunger', 'energy', 'social'] as readonly ('hunger' | 'energy' | 'social')[],
  /**
   * Away mails: days away, each once per absence. The last one is the last mail. It is 28, not 30: a saved life that has not been
   * visited for 30 days expires (SESSION_TTL_MS), so the goodbye has to arrive while the character still exists.
   */
  awaySteps: [3, 7, 28] as readonly number[],
  /** An event is mentioned when it starts within this many hours, to a player who has been away at least `eventAwayHours`. */
  eventAheadHours: 24, eventAwayHours: 24,
  /** Days before the same type may be sent again. */
  cooldownDays: { need: 3, waiting: 2, nudge: 2, milestone: 2, event: 3 } as Readonly<Record<'need' | 'waiting' | 'nudge' | 'milestone' | 'event', number>>,
  nudge: { awayDays: 2, perFriendDays: 7, keepDays: 7, perHour: 5, kept: 5 },
  /**
   * A friend who joined through the player's link is said soon, also to a player who was active a moment ago — but
   * `holdMinutes` after the join (so several joins are one mail), and never while the player is in the game, where
   * the notice is enough: they are looked at again every `recheckMinutes` until they have left or read it.
   */
  join: { holdMinutes: 10, recheckMinutes: 10 },
  /** How often a player who is waiting for nothing in particular is looked at again. */
  checkMs: HOUR,
  /** What a record remembers. */
  ledger: 12, keys: 20,
  pauseDays: 30,
});

const FINAL_STEP = Math.max(...COMEBACK.awaySteps);

// ---- facts and memory ----------------------------------------------------------------------------

/** Something waiting for the player, from a friend (named) or an anonymous friend request. Already filtered: no blocked or muted sender. */
export interface WaitingItem { kind: 'message' | 'gift' | 'request' | /** a friend came through the player's invite link */ 'joined'; /** A friend's first name, or null (a request is never named). */ from: string | null; at: number }
export interface NudgeItem { from: string; at: number }
export type MilestoneKind = 'elected' | 'house' | 'deposit' | 'table' | 'vote' | 'shift';
export interface Milestone { key: string; what: MilestoneKind; label: string }
export interface EventItem { key: string; title: string; venue: string; start: number }
/** Everything the rules look at, gathered by the server from stored state. */
export interface Facts {
  name: string
  /** The needs as stored (they were last settled at `needsAt`). */
  needs: Partial<Record<NeedId, number>> | null
  needsAt: number
  waiting: readonly WaitingItem[]
  nudges: readonly NudgeItem[]
  milestones: readonly Milestone[]
  events: readonly EventItem[]
}
/** What has been sent to this player and why nothing more is due: a bounded record the server keeps. */
export interface Memory {
  sent: readonly { at: number; type: LedgerType }[]
  last: Readonly<Partial<Record<ComebackType, number>>>
  away: Readonly<Partial<Record<'3' | '7' | '28', number>>>
  keys: readonly string[]
  waitingAt: number
  nudgeAt: number
}
export interface Prefs { on: boolean; pausedUntil: number; types: Readonly<Record<PrefKey, boolean>> }
export const defaultPrefs = (on = false): Prefs => ({ on, pausedUntil: 0, types: { needs: true, friends: true, milestones: true, events: true, away: true, week: true } });
export const emptyMemory = (): Memory => ({ sent: [], last: {}, away: {}, keys: [], waitingAt: 0, nudgeAt: 0 });

export type Plan =
  | { type: 'waiting'; key: string; names: string[]; messages: number; gifts: number; requests: number; /** Friends who joined through the player's link. */ joined?: number; newest: number; go: GoTarget }
  | { type: 'nudge'; key: string; names: string[]; newest: number; go: GoTarget }
  | { type: 'need'; key: string; need: 'hunger' | 'energy' | 'social'; go: GoTarget }
  | { type: 'milestone'; key: string; what: MilestoneKind; label: string; go: GoTarget }
  | { type: 'event'; key: string; title: string; venue: string; start: number; go: GoTarget }
  | { type: 'away'; key: string; step: number; go: GoTarget; /** Real facts about the world, filled in by the server. */ facts: string[] }

/** The first name of a player, short and plain. */
export const firstName = (name: unknown): string => String(name ?? '').trim().split(/\s+/)[0]?.slice(0, 24) || 'A friend';

// ---- triggers --------------------------------------------------------------------------------------

/**
 * What a need will be when the player is back. Settling a life that was away applies at most four hours of decay and never
 * takes a need under 10 (src/game/systems/needs.ts), so a stored need is only ever a few hours stale.
 */
const DECAY_PER_HOUR: Readonly<Record<'hunger' | 'energy' | 'social', number>> = { hunger: 6, energy: 4, social: 4 };
const DECAY_CAP_HOURS = 4, DECAY_FLOOR = 10;
export function projectNeed(need: 'hunger' | 'energy' | 'social', stored: number, storedAt: number, now: number): number {
  const hours = Math.max(0, Math.min(DECAY_CAP_HOURS, (now - storedAt) / HOUR));
  return stored > DECAY_FLOOR ? Math.max(DECAY_FLOOR, stored - Math.floor(DECAY_PER_HOUR[need] * hours)) : stored;
}

/** The one need to name: the lowest of hunger, energy and social, if it would be low and the player has been away long enough. */
export function needAlert(facts: Pick<Facts, 'needs' | 'needsAt'>, now: number, lastActive: number): { need: 'hunger' | 'energy' | 'social'; level: number } | null {
  if (!facts.needs || now - lastActive < COMEBACK.needAwayHours * HOUR) return null;
  let worst: { need: 'hunger' | 'energy' | 'social'; level: number } | null = null;
  for (const need of COMEBACK.needs) {
    const stored = facts.needs[need];
    if (typeof stored !== 'number' || !Number.isFinite(stored)) continue;
    const level = projectNeed(need, stored, facts.needsAt, now);
    if (level < COMEBACK.needLow && (!worst || level < worst.level)) worst = { need, level };
  }
  return worst;
}

const sortedUnique = (names: readonly (string | null)[]): string[] => [...new Set(names.filter((name): name is string => typeof name === 'string'))];

/** Messages, gifts and requests that arrived since the last "waiting" mail. */
export function waitingPlan(facts: Pick<Facts, 'waiting'>, memory: Pick<Memory, 'waitingAt'>): Extract<Plan, { type: 'waiting' }> | null {
  const fresh = facts.waiting.filter((item) => item.at > memory.waitingAt);
  if (!fresh.length) return null;
  const newest = Math.max(...fresh.map((item) => item.at));
  return { type: 'waiting', key: `waiting:${newest}`, names: sortedUnique(fresh.map((item) => item.from)).slice(0, 3),
    messages: fresh.filter((item) => item.kind === 'message').length, gifts: fresh.filter((item) => item.kind === 'gift').length, requests: fresh.filter((item) => item.kind === 'request').length, joined: fresh.filter((item) => item.kind === 'joined').length, newest, go: fresh.every((item) => item.kind === 'request' || item.kind === 'joined') ? 'people' : 'messages' };
}

/** A friend asked for the player back within the last week and it has not been mailed yet. */
export function nudgePlan(facts: Pick<Facts, 'nudges'>, memory: Pick<Memory, 'nudgeAt'>, now: number): Extract<Plan, { type: 'nudge' }> | null {
  const live = facts.nudges.filter((item) => item.at > memory.nudgeAt && now - item.at < COMEBACK.nudge.keepDays * DAY);
  if (!live.length) return null;
  const newest = Math.max(...live.map((item) => item.at));
  return { type: 'nudge', key: `nudge:${newest}`, names: sortedUnique(live.map((item) => item.from)).slice(0, 3), newest, go: 'people' };
}

/** The most meaningful thing that finished, not yet mailed. */
const MILESTONE_ORDER: readonly MilestoneKind[] = ['elected', 'house', 'deposit', 'table', 'vote', 'shift'];
const MILESTONE_GO: Readonly<Record<MilestoneKind, GoTarget>> = { elected: 'governor', house: 'houses', deposit: 'bank', table: 'tables', vote: 'governor', shift: 'career' };
export function milestonePlan(facts: Pick<Facts, 'milestones'>, memory: Pick<Memory, 'keys'>): Extract<Plan, { type: 'milestone' }> | null {
  const open = facts.milestones.filter((item) => !memory.keys.includes(item.key)).sort((a, b) => MILESTONE_ORDER.indexOf(a.what) - MILESTONE_ORDER.indexOf(b.what));
  const first = open[0];
  return first ? { type: 'milestone', key: first.key, what: first.what, label: first.label, go: MILESTONE_GO[first.what] } : null;
}

/** An event that starts within the next 24 hours, soonest first. */
export function eventPlan(facts: Pick<Facts, 'events'>, memory: Pick<Memory, 'keys'>, now: number): Extract<Plan, { type: 'event' }> | null {
  const soon = facts.events.filter((item) => item.start > now && item.start - now <= COMEBACK.eventAheadHours * HOUR && !memory.keys.includes(item.key)).sort((a, b) => a.start - b.start);
  const first = soon[0];
  return first ? { type: 'event', key: first.key, title: first.title, venue: first.venue, start: first.start, go: 'events' } : null;
}

/** The longest absence of 3, 7 and 28 days the player has reached whose mail has not been sent for this absence. */
export function awayPlan(memory: Pick<Memory, 'away'>, now: number, lastActive: number): Extract<Plan, { type: 'away' }> | null {
  const away = now - lastActive;
  const reached = COMEBACK.awaySteps.filter((days) => away >= days * DAY);
  const step = reached.at(-1);
  if (step === undefined) return null;
  if ((memory.away[String(step) as '3' | '7' | '28'] ?? 0) > lastActive) return null;
  return { type: 'away', key: `away:${step}:${lastActive}`, step, go: 'needs', facts: [] };
}

/** What finished in a life that a mail can celebrate. `civic` and `wins` come from the shared stores; the rest from the life itself. */
export interface MilestoneInput { now: number; cityId: string; /** Table wins not yet collected: [id, won]. */ wins: readonly { id: string; won: boolean }[]; /** Governor election: the week the player was elected (term started after they left), and the week voting opened today. */ civic: { elected: number | null; voting: number | null } }
export function milestoneFacts(state: LifeState, input: MilestoneInput): Milestone[] {
  const found: Milestone[] = [];
  const { now } = input;
  if (input.civic.elected !== null) found.push({ key: `elected:${input.civic.elected}`, what: 'elected', label: 'You were elected Chairman' });
  const up = state.estate?.upgrade;
  if (up && up.doneAt <= now) found.push({ key: `house:${up.doneAt}`, what: 'house', label: HOUSE_TIERS[up.to].label });
  for (const deposit of state.economy?.deposits ?? []) {
    const term = DEPOSIT_TERMS[deposit.term];
    if (term && deposit.openedAt + term.days * DAY <= now) found.push({ key: `deposit:${deposit.id}`, what: 'deposit', label: term.label });
  }
  for (const win of input.wins) if (win.won) found.push({ key: `table:${win.id}`, what: 'table', label: 'a table game' });
  if (input.civic.voting !== null) found.push({ key: `vote:${input.civic.voting}`, what: 'vote', label: 'the Chairman election' });
  const job = typeof state.job === 'string' && Object.hasOwn(JOBS, state.job) ? JOBS[state.job] : null;
  // A shift is a milestone only for a job with fixed work days (the starter job is open every day).
  if (job && 'track' in job && job.track && shiftStatus(state, makeContext({ now, cityId: input.cityId })).code === 'available') found.push({ key: `shift:${lagosTime(now).day}`, what: 'shift', label: job.label });
  return found;
}

// ---- policy ----------------------------------------------------------------------------------------

/** 08:00 Lagos time at or after `now`, when `now` is in quiet hours (otherwise `now`). */
export function nextOpen(now: number): number {
  const time = lagosTime(now);
  if (time.hour >= COMEBACK.quietFrom) return lagosDayStart(time.day + 1) + COMEBACK.quietTo * HOUR;
  if (time.hour < COMEBACK.quietTo) return lagosDayStart(time.day) + COMEBACK.quietTo * HOUR;
  return now;
}
export const quiet = (now: number): boolean => nextOpen(now) > now;

/** When the caps and the back-off let another mail go, or 0 when they do not hold it back. */
export function releaseAt(sent: Memory['sent'], now: number, lastActive: number): number {
  const times = sent.map((entry) => entry.at).filter((at) => at <= now).sort((a, b) => a - b);
  let until = 0;
  const day = times.filter((at) => now - at < DAY);
  if (day.length >= COMEBACK.perDay) until = Math.max(until, (day[day.length - COMEBACK.perDay] ?? 0) + DAY);
  const week = times.filter((at) => now - at < 7 * DAY);
  if (week.length >= COMEBACK.perWeek) until = Math.max(until, (week[week.length - COMEBACK.perWeek] ?? 0) + 7 * DAY);
  const unanswered = times.filter((at) => at > lastActive);
  if (unanswered.length >= COMEBACK.backoffAfter) until = Math.max(until, (unanswered.at(-1) ?? 0) + COMEBACK.backoffDays * DAY);
  return until;
}

export type Why = 'off' | 'paused' | 'active' | 'stopped' | 'quiet_hours' | 'capped' | 'nothing_due';
export interface Decision {
  plan: Plan | null
  /** When to look at this player again (ms; NEVER = not until a visit or a change of preference). */
  next: number
  why: Why | 'chosen'
  /** Types that qualified but were held back by the caps or the back-off. */
  suppressed: ComebackType[]
}
export interface DecideInput { now: number; lastActive: number; facts: Facts; memory: Memory; prefs: Prefs; /** The player is connected to the game right now. */ online?: boolean }

const cooled = (memory: Memory, type: keyof typeof COMEBACK.cooldownDays, now: number): boolean => { const at = memory.last[type]; return at === undefined || now - at >= COMEBACK.cooldownDays[type] * DAY; };

/** Every type that qualifies now, honouring the player's switches and each type's own cooldown. */
export function candidates({ now, lastActive, facts, memory, prefs }: DecideInput): Plan[] {
  const on = (type: ComebackType): boolean => prefs.types[PREF_OF[type]] === true;
  const found: Plan[] = [];
  if (on('waiting') && cooled(memory, 'waiting', now)) { const plan = waitingPlan(facts, memory); if (plan) found.push(plan); }
  if (on('nudge') && cooled(memory, 'nudge', now)) { const plan = nudgePlan(facts, memory, now); if (plan) found.push(plan); }
  if (on('need') && cooled(memory, 'need', now)) { const alert = needAlert(facts, now, lastActive); if (alert) found.push({ type: 'need', key: `need:${alert.need}:${lagosTime(now).day}`, need: alert.need, go: alert.need === 'social' ? 'people' : 'needs' }); }
  if (on('milestone') && cooled(memory, 'milestone', now)) { const plan = milestonePlan(facts, memory); if (plan) found.push(plan); }
  if (on('event') && cooled(memory, 'event', now) && now - lastActive >= COMEBACK.eventAwayHours * HOUR) { const plan = eventPlan(facts, memory, now); if (plan) found.push(plan); }
  if (on('away')) { const plan = awayPlan(memory, now, lastActive); if (plan) found.push(plan); }
  return found;
}

/** Decide whether this player is written to now, with what, and when to look again. */
export function decide(input: DecideInput): Decision {
  const { now, lastActive, memory, prefs } = input;
  const none = (why: Why, next: number, suppressed: ComebackType[] = []): Decision => ({ plan: null, next, why, suppressed });
  if (!prefs.on) return none('off', NEVER);
  if (prefs.pausedUntil > now) return none('paused', prefs.pausedUntil);
  // A mail that was sent after the player's last visit and was the final one ends the run until they come back.
  if ((memory.away['28'] ?? 0) > lastActive || memory.sent.filter((entry) => entry.at > lastActive).length >= COMEBACK.stopAfter) return none('stopped', NEVER);
  const quietUntil = activeUntil(lastActive), active = now < quietUntil;
  if (active) {
    // Only a friend who joined through the player's link is said this soon (COMEBACK.join), and nothing else rides along with it.
    const joinedAt = prefs.types.friends && cooled(memory, 'waiting', now) ? Math.max(0, ...input.facts.waiting.filter((item) => item.kind === 'joined' && item.at > memory.waitingAt).map((item) => item.at)) : 0;
    if (!joinedAt) return none('active', quietUntil);
    const ready = joinedAt + COMEBACK.join.holdMinutes * 60000;
    if (input.online === true || now < ready) return none('active', Math.min(quietUntil, input.online === true ? Math.max(ready, now + COMEBACK.join.recheckMinutes * 60000) : ready));
  }
  const options = candidates(input).filter((plan) => !active || plan.type === 'waiting');
  if (!options.length) return none('nothing_due', now + COMEBACK.checkMs);
  const opens = nextOpen(now);
  if (opens > now) return none('quiet_hours', opens);
  const release = releaseAt(memory.sent, now, lastActive);
  if (release > now) return none('capped', nextOpen(release), options.map((plan) => plan.type));
  // The final away mail (28 days) is never starved by a stronger reason: it is what ends the run.
  const final = options.find((plan) => plan.type === 'away' && plan.step >= FINAL_STEP);
  const chosen = final ?? PRIORITY.map((type) => options.find((plan) => plan.type === type)).find((plan): plan is Plan => plan !== undefined);
  if (!chosen) return none('nothing_due', now + COMEBACK.checkMs);
  // After this one, the earliest the next could go is a day on; the server sets `next` from the new ledger.
  return { plan: chosen, next: now + DAY, why: 'chosen', suppressed: options.filter((plan) => plan !== chosen).map((plan) => plan.type) };
}
const activeUntil = (lastActive: number): number => lastActive + COMEBACK.activeHours * HOUR;

/** The summary of a send for the record: what to remember so that the same thing is not sent twice. */
export function remember(memory: Memory, plan: Plan, now: number): Memory {
  const sent = [...memory.sent, { at: now, type: plan.type }].slice(-COMEBACK.ledger);
  const last = { ...memory.last, [plan.type]: now };
  const keys = plan.type === 'milestone' || plan.type === 'event' ? [...memory.keys, plan.key].slice(-COMEBACK.keys) : [...memory.keys];
  const away = plan.type === 'away' ? { ...memory.away, [String(plan.step) as '3' | '7' | '28']: now } : { ...memory.away };
  return { sent, last, keys, away, waitingAt: plan.type === 'waiting' ? plan.newest : memory.waitingAt, nudgeAt: plan.type === 'nudge' ? plan.newest : memory.nudgeAt };
}

/** The weekly digest asks the same caps: may one go out now? (It keeps its own window and its own switch.) */
export const digestAllowed = (memory: Pick<Memory, 'sent'>, now: number, lastActive: number): boolean => releaseAt(memory.sent, now, lastActive) <= now;
