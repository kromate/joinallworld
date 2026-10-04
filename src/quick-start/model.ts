/**
 * OWNER: quick start
 * The quick start's client logic that the FIRST DOWNLOAD needs, as pure functions: no DOM, no storage, no clock, no network —
 * the landing of a link, when to offer settling in, and the funnel. The names, the looks and the draft of the landing
 * screen are ./look-model.js, fetched with that screen (src/ui/panels/groups/landing.js).
 * Everything here takes plain data and returns plain data, so it runs under `node --test`
 * (./model.test.ts). The DOM side is ./entry.js (storage and
 * the funnel events) and the two panels (src/ui/panels/quick-start.js, onboarding.js).
 *
 * The server stays the authority for everything: the name is validated by POST /api/session, the
 * look by the 'onboarding.quick-start' action, each settle-in step by its own action. What is here
 * only decides what to SHOW and when.
 */
import type { ActiveAction, Look, OnboardingState } from '../types/life.ts';
import { isRecord, safeCount } from '../game/util.ts';

/** The draft of the landing screen (./look-model.js draftFrom): rebuilt from storage, always ready to play. */
export interface Draft { name: string; look: Look; landedAt: number; nameEdited: boolean; shuffles: number; preset: string | null }
export interface NudgeMemory { count: number; reasons: string[]; day: number | null }
export interface FunnelSnap { guest: boolean; required: boolean; done: boolean; step: number; activities: number; firstAt: number | null; active: string | null; location: string }
/** The answer of POST /api/social/join as far as the banner reads it (untrusted: every part may be missing). */
export interface JoinAnswer { ok?: boolean; code?: string; host?: { name?: string }; venue?: string }
/** What the funnel reads of a life's state: the parts of a LifeState it may hold, each possibly missing. */
export type FunnelSource = { onboarding?: Partial<Pick<OnboardingState, 'stage' | 'done' | 'required' | 'step' | 'activities' | 'firstAt'>>; activeAction?: ActiveAction | null; location?: string } | null | undefined;
export interface FunnelEvent { name: string; props: Record<string, unknown> }
export interface JoinBanner { tone: 'good' | 'info'; title: string; text: string; knock: boolean }

// ---- the invite landing --------------------------------------------------------------------
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
/**
 * THE LANDING HOOK. The public id of the player a link points at, or null:
 *   /v/<publicId>        a house link (what Phone → Invite shows)
 *   ?join=<publicId>     the generic form, for any link that should land a visitor beside a player
 *                        (share cards, referral links, venue links — add it to whatever the link carries)
 *   ?v=<publicId>        the older query form of a house link
 */
export function joinIdFrom(pathname: unknown, search: unknown): string | null {
  const match = new RegExp(`^/v/(${UUID})(?:[/?#]|$)`, 'i').exec(String(pathname ?? '')) ?? new RegExp(`[?&](?:join|v)=(${UUID})(?:[&#]|$)`, 'i').exec(String(search ?? ''));
  return match?.[1] ? match[1].toLowerCase() : null;
}
/**
 * The other two things a link may carry: a share code (`?ref=<code>`, the older `?s=<code>`, or the path `/s/<code>` on a
 * host that serves the game for it) and a table id (`?table=<id>`). Shapes only — the server decides what they mean.
 */
export function linkParts(pathname: unknown, search: unknown): { ref: string | null; table: string | null } {
  const ref = /^\/s\/([a-z0-9]{8,16})(?:[/?#]|$)/.exec(String(pathname ?? '')) ?? /[?&](?:ref|s)=([a-z0-9]{8,16})(?:[&#]|$)/.exec(String(search ?? ''));
  const table = /[?&]table=([a-z0-9-]{1,40})(?:[&#]|$)/.exec(String(search ?? ''));
  return { ref: ref?.[1] ?? null, table: table?.[1] ?? null };
}
/**
 * What the banner says for an answer of POST /api/social/join. `gift`: the visitor's life was attached to the sharer's link as a referral just now.
 */
export function joinBanner(answer: JoinAnswer | null, venueLabel: (venueId: string) => string, { gift = false }: { gift?: boolean } = {}): JoinBanner | null {
  const banner = joinWords(answer, venueLabel);
  // The referral rides in the same banner: one message says who was joined and what the link is worth.
  return banner && gift ? { ...banner, text: `${banner.text} ${GIFT_LINE}` } : banner;
}
/** What a visitor who came through a friend's link is told about the gift: it is paid only after real work. */
export const GIFT_LINE = 'Work a paid shift and you both get a gift.';
/** The banner for a share link whose owner could not be joined (no `join` answer): it still says whose link it was. */
export const linkBanner = (name: string): JoinBanner => ({ tone: 'good', title: `You came through ${name}’s link`, text: GIFT_LINE, knock: false });
function joinWords(answer: JoinAnswer | null, venueLabel: (venueId: string) => string): JoinBanner | null {
  const name = typeof answer?.host?.name === 'string' && answer.host.name ? answer.host.name : null;
  if (!answer?.ok || !name) return null;
  const title = `You’re joining ${name}`;
  switch (answer.code) {
    case 'joined': case 'here': return { tone: 'good', title, text: `${name} is at ${venueLabel(answer.venue ?? '')} right now — so are you. Look for their name tag.`, knock: false };
    case 'at_home': return { tone: 'good', title, text: `${name} is at home. Knock, and they can let you in.`, knock: true };
    case 'reconnecting': return { tone: 'info', title, text: `${name} is reconnecting. Have a look around; you can knock from Phone → Invite in a moment.`, knock: false };
    case 'out': return { tone: 'info', title, text: `${name} is out in the city right now. Have a look around; add them from Phone → People and you will see when they are near.`, knock: false };
    default: return { tone: 'info', title, text: `${name} is offline right now. Have a look around — their link still works when they are back.`, knock: false };
  }
}

// ---- when to offer settling in ---------------------------------------------------------------
/** The most times the "Make this life yours" sheet opens by itself for one life. Tapping Home, Buy or the goal is not counted. */
export const NUDGE_CAP = 3;
export function nudgeMemory(saved: unknown): NudgeMemory {
  const kept: Record<string, unknown> = isRecord(saved) ? saved : {};
  return { count: safeCount(kept.count) ? Math.min(kept.count, 99) : 0,
    reasons: Array.isArray(kept.reasons) ? kept.reasons.filter((item): item is string => typeof item === 'string').slice(0, 12) : [],
    day: typeof kept.day === 'number' && Number.isSafeInteger(kept.day) ? kept.day : null };
}
/**
 * Should the settle-in sheet be offered now, and why? Never while something is running, never
 * past the cap, each reason once:
 *   'first-reward'    the first activity has just paid
 *   'third-activity'  three activities done and still a guest
 *   'next-day'        a later Lagos day than the last offer
 */
export function nextNudge(facts: { guest: boolean; activities: number; firstAt: number | null; busy: boolean; day: number }, memory: NudgeMemory): string | null {
  if (!facts.guest || facts.busy || memory.count >= NUDGE_CAP) return null;
  const fresh = (reason: string): boolean => !memory.reasons.includes(reason);
  if (facts.firstAt !== null && fresh('first-reward')) return 'first-reward';
  if (facts.activities >= 3 && fresh('third-activity')) return 'third-activity';
  if (memory.day !== null && facts.day > memory.day && fresh(`day-${facts.day}`) && memory.reasons.includes('first-reward')) return 'next-day';
  return null;
}
/** The memory after an offer was shown. */
export const nudged = (memory: NudgeMemory, reason: string, day: number | null): NudgeMemory => ({ count: memory.count + 1, reasons: [...memory.reasons, reason === 'next-day' ? `day-${day}` : reason].slice(-12), day });

// ---- the funnel ----------------------------------------------------------------------------
export const funnelSnap = (state: FunnelSource): FunnelSnap => ({ guest: state?.onboarding?.stage === 'guest' && !state.onboarding.done, required: state?.onboarding?.required === true, done: state?.onboarding?.done === true,
  step: state?.onboarding?.step ?? 0, activities: state?.onboarding?.activities ?? 0, firstAt: state?.onboarding?.firstAt ?? null,
  active: state?.activeAction?.kind === 'activity' ? state.activeAction.id : null, location: state?.location ?? '' });
const STEP_EVENTS: Record<number, string> = { 2: 'settle_traits_done', 3: 'settle_dream_done', 4: 'settle_lottery_done' };
/**
 * The funnel events a change of server state amounts to. Compared snapshot to snapshot, so an
 * event is reported once, when it happens, however often the state is polled.
 */
export function funnelEvents(before: FunnelSnap, after: FunnelSnap): FunnelEvent[] {
  const events: FunnelEvent[] = [];
  if (before.required && !after.required && after.guest) events.push({ name: 'arrived', props: { venue: after.location } });
  if (after.guest && after.activities === 0 && after.active && before.active !== after.active) events.push({ name: 'first_activity_started', props: { activity: after.active, venue: after.location } });
  if (before.firstAt === null && after.firstAt !== null) events.push({ name: 'first_activity_completed', props: { venue: after.location } });
  if (before.guest) for (let step = before.step + 1; step <= Math.min(after.step, 4); step++) { const name = STEP_EVENTS[step]; if (name) events.push({ name, props: {} }); }
  if (before.guest && after.done) events.push({ name: 'save_character_done', props: { activities: after.activities } });
  return events;
}
