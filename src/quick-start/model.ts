/**
 * OWNER: quick start
 * The quick start's first-download logic, as pure functions: no DOM, no storage, no clock, no network —
 * link parsing, when to offer settling in, and the funnel. Landing banner helpers remain re-exported for compatibility, but their
 * implementation is fetched with the landing feature. The names, the looks and the draft of the landing
 * screen are ./look-model.js, fetched with that screen (src/ui/panels/groups/landing.js).
 * Everything here takes plain data and returns plain data, so it runs under `node --test`
 * (./model.test.ts). The DOM side is ./entry.js (storage and
 * the funnel events) and the two panels (src/ui/panels/quick-start.js, onboarding.js).
 *
 * The server stays the authority for everything: the name is validated by POST /api/session, the
 * look by the 'onboarding.quick-start' action, each settle-in step by its own action. What is here
 * only decides what to SHOW and when.
 */
import type { ActiveAction, DreamId, Look, OnboardingState, TraitId } from '../types/life.ts';
import { isRecord, safeCount } from '../game/util.ts';

/** The draft of the landing screen (./look-model.js draftFrom): rebuilt from storage, always ready to play. */
/** What the creator's later steps have so far: the two traits, the dream and the chosen area (empty until chosen). */
export interface DraftArea { lga: string; via: 'device' | 'manual' }
export interface Draft { name: string; look: Look; landedAt: number; nameEdited: boolean; shuffles: number; preset: string | null; traits: TraitId[]; dream: DreamId | null; area: DraftArea | null }
/** `until`: server time (ms) before which settling in is not offered by itself, because it was offered and set aside. */
export interface NudgeMemory { count: number; reasons: string[]; day: number | null; until: number | null }
export interface FunnelSnap { guest: boolean; required: boolean; done: boolean; step: number; activities: number; firstAt: number | null; active: string | null; location: string }
/** What the funnel reads of a life's state: the parts of a LifeState it may hold, each possibly missing. */
export type FunnelSource = { onboarding?: Partial<Pick<OnboardingState, 'stage' | 'done' | 'required' | 'step' | 'activities' | 'firstAt'>>; activeAction?: ActiveAction | null; location?: string } | null | undefined;
export interface FunnelEvent { name: string; props: Record<string, unknown> }
/** Link banner helpers stay exported here for existing quick-start consumers. The app's landing loader imports their implementation only on demand. */
export { GIFT_LINE, joinBanner, linkBanner } from './landingBanners.ts'
export type { JoinAnswer, JoinBanner } from './landingBanners.ts'
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
// ---- when to offer settling in ---------------------------------------------------------------
/** The most times the "Make this life yours" sheet opens by itself for one life. Tapping Home, Buy or the goal is not counted. */
export const NUDGE_CAP = 3;
/** How long an offer that was set aside (Not now, or closed) stays quiet, however the player left it: through the rest of the session, a reload and the next visit that day. */
export const NUDGE_QUIET_MS = 12 * 3600000;
export function nudgeMemory(saved: unknown): NudgeMemory {
  const kept: Record<string, unknown> = isRecord(saved) ? saved : {};
  return { count: safeCount(kept.count) ? Math.min(kept.count, 99) : 0,
    reasons: Array.isArray(kept.reasons) ? kept.reasons.filter((item): item is string => typeof item === 'string').slice(0, 12) : [],
    day: typeof kept.day === 'number' && Number.isSafeInteger(kept.day) ? kept.day : null,
    until: typeof kept.until === 'number' && Number.isSafeInteger(kept.until) && kept.until > 0 ? kept.until : null };
}
/**
 * Should the settle-in sheet be offered now, and why? Never while something is running, never
 * past the cap, each reason once:
 *   'first-reward'    the first activity has just paid
 *   'third-activity'  three activities done and still a guest
 *   'next-day'        a later Lagos day than the last offer
 * An offer that was shown is then quiet for NUDGE_QUIET_MS (the memory is kept on the device, so a reload does not bring it
 * back). `at` is server time. A remembered `until` further away than one quiet period is not believed (a clock that moved).
 * Tapping Home, Buy or the goal opens the sheet directly and never asks this.
 */
export function nextNudge(facts: { guest: boolean; activities: number; firstAt: number | null; busy: boolean; day: number; at: number }, memory: NudgeMemory): string | null {
  if (!facts.guest || facts.busy || memory.count >= NUDGE_CAP) return null;
  if (memory.until !== null && facts.at < memory.until && memory.until - facts.at <= NUDGE_QUIET_MS) return null;
  const fresh = (reason: string): boolean => !memory.reasons.includes(reason);
  if (facts.firstAt !== null && fresh('first-reward')) return 'first-reward';
  if (facts.activities >= 3 && fresh('third-activity')) return 'third-activity';
  if (memory.day !== null && facts.day > memory.day && fresh(`day-${facts.day}`) && memory.reasons.includes('first-reward')) return 'next-day';
  return null;
}
/** The memory after an offer was shown. */
export const nudged = (memory: NudgeMemory, reason: string, day: number | null, at: number): NudgeMemory => ({ count: memory.count + 1, reasons: [...memory.reasons, reason === 'next-day' ? `day-${day}` : reason].slice(-12), day, until: at + NUDGE_QUIET_MS });

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
