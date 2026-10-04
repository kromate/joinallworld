/**
 * OWNER: growth
 * The words of a message to a player who is away, as pure functions. Two uses:
 *   - the "While you were away" card shown IN the game when a player returns;
 *   - the weekly digest, composed exactly as it WOULD be sent. Nothing in this build sends
 *     anything outside the game: no push, no e-mail, no chat message. The digest is rendered
 *     into the in-game inbox as a preview (delivery: 'dry-run') so the owner and the player can
 *     read precisely what a later, approved channel would carry.
 *
 * TONE. A message states a fact and an opening. It never says the player lost something by being
 * away, never counts down to a threat, and never guilts ("we miss you").
 *
 * PRIORITY (strongest first, the order a line may lead a message): a person, an invitation,
 * your Sim, progress. At most DIGEST.maxLines lines; the rest are counted, not listed.
 */
import type { CalendarOccurrence, Digest } from '../types/growth.ts';
import type { MissionRow, MissionsView } from '../types/view.ts';

/** What a line of a message is about, strongest first. */
export type LineGroup = 'person' | 'invite' | 'sim' | 'progress';
/** A line as callers hand it in. */
export interface DigestLineInput {
  id?: string
  text: string
  at?: number
  app?: string
  group?: string
  params?: object
}
/** A line as kept: text clipped, group and time always set. */
export interface DigestLine extends DigestLineInput {
  text: string
  group: LineGroup
  at: number
}
/** The parts of a calendar occurrence the messages read. */
type DigestEvent = Pick<CalendarOccurrence, 'title' | 'venueLabel' | 'start'>;

export const DIGEST = Object.freeze({
  maxLines: 5, tasks: 3,
  /** Hours with nothing heard before a return is greeted with the card. */
  awayAfterHours: 3,
  /** Frequency caps a real channel would have to honour (carried over from the first Allworld's come-back rules). */
  caps: { perDay: 1, perWeek: 3, settleMinutes: 30, quietFrom: 22, quietTo: 7, backoffDays: [1, 3, 7], maxPerAbsence: 4 },
});
export const LINE_GROUPS: readonly LineGroup[] = Object.freeze(['person', 'invite', 'sim', 'progress']);
const GROUP_NAMES: readonly string[] = LINE_GROUPS;
const isGroup = (value: unknown): value is LineGroup => typeof value === 'string' && GROUP_NAMES.includes(value);

const APP_GROUP: Record<string, LineGroup> = { invite: 'person', people: 'person', messages: 'person', contacts: 'person', events: 'invite', tables: 'invite', governor: 'invite',
  health: 'sim', bank: 'sim', jobs: 'progress', missions: 'progress', statement: 'progress' };
const rank = (group: LineGroup): number => { const index = LINE_GROUPS.indexOf(group); return index < 0 ? LINE_GROUPS.length : index; };
const clip = (text: unknown, max = 120): string => { const value = String(text ?? '').replace(/\s+/g, ' ').trim(); return value.length > max ? `${value.slice(0, max - 1)}…` : value; };

/**
 * Order lines by priority, then newest first, and keep the first few.
 */
export function topLines(lines: DigestLineInput[], max: number = DIGEST.maxLines): { lines: DigestLine[]; more: number } {
  const seen = new Set<string>(), clean: DigestLine[] = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    const text = clip(line?.text);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    clean.push({ ...line, text, group: isGroup(line.group) ? line.group : (line.app === undefined ? undefined : APP_GROUP[line.app]) ?? 'progress', at: typeof line.at === 'number' && Number.isFinite(line.at) ? line.at : 0 });
  }
  clean.sort((a, b) => rank(a.group) - rank(b.group) || b.at - a.at);
  return { lines: clean.slice(0, max), more: Math.max(0, clean.length - max) };
}

const hoursWord = (hours: number): string => (hours >= 48 ? `${Math.floor(hours / 24)} days` : hours >= 24 ? 'a day' : `${Math.max(1, Math.floor(hours))} hour${Math.floor(hours) === 1 ? '' : 's'}`);

/** The inputs of `awayCard`. */
export interface AwayCardInput {
  hoursAway: number
  lines: DigestLineInput[]
  missions: { claimable?: MissionsView['claimable']; daily?: Pick<MissionRow, 'done'>[] } | null
  events: (Pick<CalendarOccurrence, 'key' | 'title' | 'venueLabel' | 'start'> & { live?: boolean })[]
}
export interface AwayCard {
  title: string
  sub: string
  lines: DigestLine[]
  more: number
}
/** The card for a returning player, or null when there is nothing worth a card. */
export function awayCard({ hoursAway, lines = [], missions = null, events = [] }: Partial<AwayCardInput> = {}): AwayCard | null {
  if (typeof hoursAway !== 'number' || !Number.isFinite(hoursAway) || hoursAway < DIGEST.awayAfterHours) return null;
  const all: DigestLineInput[] = [...lines];
  for (const event of events) if (event?.live) all.push({ id: `event:${event.key}`, text: `On now: ${event.title} at ${event.venueLabel}`, app: 'events', group: 'invite', at: event.start });
  if (missions?.claimable) all.push({ id: 'missions:claim', text: `${missions.claimable} finished mission${missions.claimable === 1 ? '' : 's'} to collect`, app: 'missions', group: 'progress', at: 0 });
  else if (missions?.daily?.length) all.push({ id: 'missions:new', text: `${missions.daily.filter((item) => !item.done).length} missions for today`, app: 'missions', group: 'progress', at: 0 });
  const top = topLines(all);
  if (!top.lines.length) return null;
  return { title: 'While you were away', sub: `You were gone for ${hoursWord(hoursAway)}. Nothing was taken from you.`, lines: top.lines, more: top.more };
}

/** The inputs of `composeDigest`. */
export interface DigestInput {
  name: string
  city: string
  missions: {
    stamps: Pick<MissionsView['stamps'], 'days' | 'paid'>
    title?: string | null
    weekly?: Pick<MissionRow, 'done' | 'label' | 'n' | 'count' | 'open'>[]
    daily?: Pick<MissionRow, 'done' | 'label' | 'open'>[]
  } | null
  events: DigestEvent[]
  referral: { counted?: number; waiting?: number } | null
  lines: DigestLineInput[]
}
/** The weekly digest as it would be sent: a subject, a few lines and up to three tasks. */
export function composeDigest({ name, city = 'Lagos', missions = null, events = [], referral = null, lines = [] }: Partial<DigestInput> = {}): Digest {
  const all: DigestLineInput[] = [...lines];
  if (referral?.counted) all.push({ text: `${referral.counted} friend${referral.counted === 1 ? '' : 's'} you invited ${referral.counted === 1 ? 'is' : 'are'} playing`, group: 'person' });
  if (referral?.waiting) all.push({ text: `${referral.waiting} friend${referral.waiting === 1 ? '' : 's'} came through your link and ${referral.waiting === 1 ? 'has' : 'have'} not started work yet`, group: 'person' });
  for (const event of (Array.isArray(events) ? events : []).slice(0, 3)) all.push({ text: `${event.title} at ${event.venueLabel}`, group: 'invite', at: -event.start, app: 'events' });
  if (missions) {
    all.push({ text: `${missions.stamps.days} of 7 days played this week${missions.stamps.paid ? ' · stamp card complete' : ''}`, group: 'progress' });
    if (missions.title) all.push({ text: `Your title: ${missions.title}`, group: 'progress' });
  }
  const top = topLines(all);
  const tasks: Digest['tasks'] = [];
  for (const mission of missions?.weekly ?? []) if (!mission.done && tasks.length < DIGEST.tasks) tasks.push({ text: `${mission.label} (${mission.n}/${mission.count})`, app: mission.open ?? 'missions' });
  for (const mission of missions?.daily ?? []) if (!mission.done && tasks.length < DIGEST.tasks) tasks.push({ text: mission.label, app: mission.open ?? 'missions' });
  if (!tasks.length) tasks.push({ text: 'Open Missions and pick one thing for today', app: 'missions' });
  return {
    subject: `Your week in ${city}, ${clip(name, 24) || 'Lagosian'}`,
    greeting: `Here is what is waiting in ${city}.`,
    lines: top.lines.map((line) => line.text), more: top.more, tasks,
    footer: 'You get this at most once a week, only if you asked for it. One tap stops it.',
    caps: DIGEST.caps,
  };
}
