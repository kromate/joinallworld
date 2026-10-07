/**
 * OWNER: social
 * Pure, deterministic rules for what regulars remember, hear, bring up and do next time.
 */
import type { MemoryFact } from '../../types/life.ts';
import { FACTS_KEPT, FOLLOW_UPS_KEPT, RUMOURS_KEPT } from './facts.ts';

export const RECENT_DAYS = 7;
export const CITY_DAYS = 3;
export const RUMOUR_DAYS = 14;
export const AWAY_DAYS = 7;
export const FAVOUR_AFTER = 2;
export const TEASE_AFTER = 1;
export const MAX_SWAY = 0.1;
export const FAVOUR_NEEDS = { fun: 8, social: 6 } as const;
export const DEED_POINTS = 2;

const SALIENCE: Readonly<Record<string, number>> = { deed: 7, treat: 6, flop: 5, laugh: 4, place: 3, praise: 2, job: 2, met: 1 };
const weight = (item: MemoryFact): number => SALIENCE[item.k] ?? 0;
const WARM = ['treat', 'laugh', 'shift', 'haggle'];
const COLD = ['shade'];

/** Work dilemma tags that are bad news when a workplace regular hears about them. */
export const BAD_DEEDS: readonly string[] = [
  'audit-flag', 'bad-reaction', 'called-out', 'caught-copying', 'client-injury', 'complaint', 'cracked-voice', 'difficult', 'discount-abuse', 'false-alarm',
  'food-complaint', 'gossip', 'greedy', 'investigated', 'lost-client', 'lost-customer', 'overpriced', 'phone-thief', 'pushy-photographer', 'pushy-seller',
  'reprimanded', 'safety-fine', 'seized-goods', 'sloppy', 'undercooked', 'unpaid',
];
export const isBadDeed = (tag: string): boolean => BAD_DEEDS.includes(tag);

const same = (a: MemoryFact, b: MemoryFact): boolean => a.k === b.k && a.v === b.v;
const fact = (k: string, v: string | undefined, day: number): MemoryFact => (v ? { k, v, day } : { k, day });

/** Replace an older copy of a fact; once over capacity, forget the least telling, then oldest. */
export function remember(facts: readonly MemoryFact[] | undefined, k: string, v: string | undefined, day: number): MemoryFact[] {
  const next = fact(k, v, day), list = [...(facts ?? []).filter((item) => !same(item, next)), next];
  while (list.length > FACTS_KEPT) {
    const drop = list.reduce((low, item, index) => (weight(item) < weight(list[low]!) ? index : low), 0);
    list.splice(drop, 1);
  }
  return list;
}

export const knows = (facts: readonly MemoryFact[] | undefined, k: string, v?: string): boolean => Boolean(facts?.some((item) => item.k === k && item.v === v));

/** The player's own actions and venue only; never store another player as the subject of gossip. */
export function startRumour(rumours: readonly MemoryFact[] | undefined, k: string, venue: string, day: number): MemoryFact[] {
  const next = fact(k, venue, day);
  return [...(rumours ?? []).filter((item) => !(same(item, next) && item.day === day)), next].slice(-RUMOURS_KEPT);
}

export type DistrictOf = (venue: string) => string | undefined;

export function hears(rumour: MemoryFact, district: string | undefined, districtOf: DistrictOf, today: number): boolean {
  const age = today - rumour.day;
  if (age < 1 || age > RUMOUR_DAYS || ![...WARM, ...COLD].includes(rumour.k)) return false;
  if (age >= CITY_DAYS) return true;
  const from = rumour.v ? districtOf(rumour.v) : undefined;
  return Boolean(district && from === district);
}

/** District reputation fades by half each week and changes earned closeness by at most ten percent. */
export function reputation(rumours: readonly MemoryFact[] | undefined, district: string | undefined, districtOf: DistrictOf, today: number): Record<string, number> {
  const score: Record<string, number> = {};
  for (const rumour of rumours ?? []) {
    if (hears(rumour, district, districtOf, today)) score[rumour.k] = (score[rumour.k] ?? 0) + 0.5 ** ((today - rumour.day) / 7);
  }
  return score;
}

export function gainFactor(score: Readonly<Record<string, number>>): number {
  const sum = (kinds: readonly string[]): number => kinds.reduce((total, kind) => total + (score[kind] ?? 0), 0);
  const sway = Math.max(-MAX_SWAY, Math.min(MAX_SWAY, sum(WARM) * 0.02 - sum(COLD) * 0.04));
  return Math.round((1 + sway) * 100) / 100;
}

export interface Recollection { from: 'fact' | 'rumour'; fact: MemoryFact }

/** A recent personal fact wins; otherwise bring up the newest rumour the regular has heard. */
export function recall(facts: readonly MemoryFact[] | undefined, rumours: readonly MemoryFact[] | undefined, district: string | undefined, districtOf: DistrictOf, today: number): Recollection | null {
  const recent = (facts ?? []).filter((item) => today - item.day >= 1 && today - item.day <= RECENT_DAYS && weight(item) > 0);
  const best = recent.reduce<MemoryFact | null>((top, item) => (!top || weight(item) > weight(top) || (weight(item) === weight(top) && item.day >= top.day) ? item : top), null);
  if (best) return { from: 'fact', fact: best };
  const heard = (rumours ?? []).filter((item) => hears(item, district, districtOf, today)).at(-1);
  return heard ? { from: 'rumour', fact: heard } : null;
}

/** Keep one pending follow-up of each kind per regular; discard the soonest due if over capacity. */
export function schedule(followUps: readonly MemoryFact[] | undefined, k: string, npc: string, due: number): MemoryFact[] {
  const next = fact(k, npc, due);
  return [...(followUps ?? []).filter((item) => !same(item, next)), next].sort((a, b) => a.day - b.day).slice(-FOLLOW_UPS_KEPT);
}

/** Consume due follow-ups for this regular exactly once at the next meeting. */
export function settle(followUps: readonly MemoryFact[] | undefined, npc: string, today: number): { due: MemoryFact[]; rest: MemoryFact[] } {
  const due: MemoryFact[] = [], rest: MemoryFact[] = [];
  for (const item of followUps ?? []) (item.v === npc && item.day <= today ? due : rest).push(item);
  return { due, rest };
}
