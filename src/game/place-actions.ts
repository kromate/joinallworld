/**
 * OWNER: social
 * Which place actions (PLACE_ACTIONS in content/place-actions.ts) a regular offers: by the kind of place they stand in, by who they are, and
 * for the worship ones by the hour. Pure: it reads a regular, a scene kind and a time, never a life. Used by systems/social.ts only
 * once the dilemma kit is installed (src/game/features.ts); with no kit, no regular offers any.
 *
 *   placeKindOf(city, venue)            the kind of place: the venue's scene kind, with worship split into 'church' and 'mosque'
 *   isElder(npc)                        whether a regular is an elder (matched defensively on emoji, title and role: the cast is another lane's data)
 *   placeActionsFor(npc, kind, now)     the place actions this regular offers; `now` (ms) decides the after-service ones, null = ignore the hour
 *   isAfterService(kind, now)           whether a service of that faith has just ended
 */
import { venueFor } from './cities/runtime.ts';
import { lagosTime } from './clock.ts';
import { PLACE_ACTIONS } from './content/place-actions.ts';
import type { NpcDefinition, PlaceAction } from '../types/content.ts';

/** When services end, in Lagos time: weekday (0 = Sunday) and minute of the day. Original beta values. */
export const SERVICE_TIMES: Record<'church' | 'mosque', readonly { weekday: number; endMinute: number }[]> = {
  church: [{ weekday: 0, endMinute: 10 * 60 + 30 }, { weekday: 0, endMinute: 12 * 60 + 30 }],
  mosque: [{ weekday: 5, endMinute: 14 * 60 }],
};
/** How long after a service ends the after-service greeting is offered (minutes). */
export const AFTER_SERVICE_MINUTES = 60;

/** The kind of place a venue is, as place actions see it. A venue the city does not have has none. */
export function placeKindOf(cityId: string, venueId: string): string | null {
  const scene = venueFor(cityId, venueId)?.scene;
  if (!scene) return null;
  if (scene.kind !== 'worship') return scene.kind;
  const variant = String(scene.variant ?? '');
  return variant.includes('mosque') ? 'mosque' : 'church';
}

const ELDER_TITLE = /^(baba|papa|mama|iya|pa|alhaji|alhaja|mallam|chief|elder|grandpa|grandma)\b/i;
const ELDER_ROLE = /\b(elder|elderly|retired|veteran|grandfather|grandmother|matriarch|patriarch)\b/i;
/** True for an elder: an old-man or old-woman emoji, an elder's title before the name, or an elder in the role. */
export function isElder(npc: Pick<NpcDefinition, 'name' | 'role' | 'emoji'>): boolean {
  return /[\u{1F474}\u{1F475}\u{1F9D3}]/u.test(String(npc.emoji ?? '')) || ELDER_TITLE.test(String(npc.name ?? '').trim()) || ELDER_ROLE.test(String(npc.role ?? ''));
}

/** True when a service of this faith ended within the last AFTER_SERVICE_MINUTES (Lagos time). */
export function isAfterService(kind: string | null, now: number): boolean {
  if (kind !== 'church' && kind !== 'mosque') return false;
  const time = lagosTime(now);
  return SERVICE_TIMES[kind].some((service) => service.weekday === time.weekday && time.minuteOfDay >= service.endMinute && time.minuteOfDay < service.endMinute + AFTER_SERVICE_MINUTES);
}

/** A place action by id. */
export const placeActionById = (id: unknown): PlaceAction | undefined => PLACE_ACTIONS.find((item) => item.id === id);

/**
 * The place actions a regular offers, in PLACE_ACTIONS order and without repeats: those of the place they stand in, those for elders when
 * they are one, and any the regular names in `actions`. With `now` set, an after-service action is left out unless a service has just ended;
 * with `now` null it is kept (the activity catalogue lists it always, and the block modifier refuses it out of hours).
 */
export function placeActionsFor(npc: NpcDefinition, kind: string | null, now: number | null = null): PlaceAction[] {
  const named = npc.actions ?? [];
  return PLACE_ACTIONS.filter((action) => {
    const wanted = named.includes(action.id) || Boolean(action.elder && isElder(npc)) || Boolean(kind && action.places?.includes(kind));
    return wanted && (!action.afterService || now === null || isAfterService(kind, now));
  });
}
