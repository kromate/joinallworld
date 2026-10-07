/**
 * OWNER: social
 * REALISM R13: a regular who has seen two real players on separate visits offers to introduce them, and an accepted offer is an
 * ordinary friend request (service.friendRequest). Nothing here is shown to anyone who has not turned introductions on.
 *
 * What is kept, and only for a player who has the setting on: for each venue a small record of their visits (how many, when the current
 * one began and was last seen, and the span of the visit before it), at most VENUES_KEPT venues, and the players they were already
 * offered or turned down (INTRO_TOLD_KEPT, not offered again for TOLD_FOR_MS). Turning the setting off deletes the visit record.
 * Old saves have none of it and load unchanged. The record is self-contained: nothing else reads it and it reads nothing of the memory lane.
 *
 * What is revealed: the offer carries the other player's id and name, and only when that player is standing in the caller's own venue
 * room right now (their name is already in the venue's people list), has introductions on too, and was seen here on a visit that did not
 * overlap the caller's last one. Nobody who was not in that room is ever named.
 * Portable: no Node imports.
 */
import type { SocialPlayerRecord } from '../types.ts';

/** A gap this long in a player's presence at a venue makes the next sight of them a new visit. */
export const VISIT_GAP_MS = 20 * 60_000;
/** Venues a player's visit record covers. */
export const VENUES_KEPT = 24;
/** Players a player was already offered or turned down. */
export const INTRO_TOLD_KEPT = 20;
/** How long before the same pair is offered again. */
export const TOLD_FOR_MS = 7 * 86_400_000;
/** After a player answers an offer, no other is made to them for this long (one introduction a day, docs/REALISM.md item 13). */
export const ONE_A_DAY_MS = 86_400_000;

type Book = NonNullable<SocialPlayerRecord['introVisits']>;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The caller is in `key` (`cityId:venueId`) at `t`: count the visit. Only for a player who has introductions on. */
export function noteVisit(p: SocialPlayerRecord, key: string, t: number): void {
  if (p.introductions !== 'on') return;
  const book: Book = p.introVisits && typeof p.introVisits === 'object' ? p.introVisits : (p.introVisits = {});
  const had = book[key];
  if (!had || !finite(had.n) || !finite(had.at) || !finite(had.from)) book[key] = { n: 1, from: t, at: t };
  else if (t - had.at > VISIT_GAP_MS) book[key] = { n: Math.min(had.n + 1, 99), from: t, at: t, pf: had.from, pt: had.at };
  else had.at = Math.max(had.at, t);
  const keys = Object.keys(book);
  if (keys.length > VENUES_KEPT) for (const stale of keys.sort((a, b) => (book[a]?.at ?? 0) - (book[b]?.at ?? 0)).slice(0, keys.length - VENUES_KEPT)) delete book[stale];
}

/** The visit before the current one at `key`, as [from, to], or null when there was none. */
function earlier(p: SocialPlayerRecord, key: string): readonly [number, number] | null {
  const rec = p.introVisits?.[key];
  return rec && finite(rec.pf) && finite(rec.pt) ? [rec.pf, rec.pt] : null;
}

/** Whether the regulars of `key` saw these two on separate visits: each came before, and their last visits did not overlap. */
export function seenApart(a: SocialPlayerRecord, b: SocialPlayerRecord, key: string): boolean {
  const one = earlier(a, key), two = earlier(b, key);
  return Boolean(one && two && (one[1] < two[0] || two[1] < one[0]));
}

/** A candidate: someone in the caller's room who is not blocked, not already a friend and has no request open either way (the service filters those). */
export interface IntroCandidate { id: string; record: SocialPlayerRecord }

/** Whom, if anyone, the caller is offered an introduction to. The lowest id wins, so the offer does not flicker between polls. */
export function introductionFor(me: SocialPlayerRecord, candidates: readonly IntroCandidate[], key: string, t: number): string | null {
  if (me.introductions !== 'on') return null;
  const told = me.introTold ?? {};
  if (Object.values(told).some((at) => finite(at) && t - at < ONE_A_DAY_MS)) return null;
  for (const { id, record } of [...candidates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (record.introductions !== 'on') continue;
    const at = told[id];
    if (finite(at) && t - at < TOLD_FOR_MS) continue;
    if (seenApart(me, record, key)) return id;
  }
  return null;
}

/** The caller answered the offer about `other` (either way): it is not made again for TOLD_FOR_MS. */
export function markTold(p: SocialPlayerRecord, other: string, t: number): void {
  const told: Record<string, number> = p.introTold && typeof p.introTold === 'object' ? p.introTold : (p.introTold = {});
  told[other] = t;
  const ids = Object.keys(told);
  if (ids.length > INTRO_TOLD_KEPT) for (const stale of ids.sort((a, b) => (told[a] ?? 0) - (told[b] ?? 0)).slice(0, ids.length - INTRO_TOLD_KEPT)) delete told[stale];
}

/** The setting went off: the visit record is deleted. */
export function forgetVisits(p: SocialPlayerRecord): void {
  delete p.introVisits;
}
