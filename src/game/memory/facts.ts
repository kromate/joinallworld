/**
 * OWNER: social
 * One bounded fact shape shared by NPC memories, rumours and pending follow-ups. Only this small
 * cleaner is needed when a life is loaded; the rules and lines are deferred to host and People.
 */
import { isRecord, safeCount } from '../util.ts';
import type { MemoryFact } from '../../types/life.ts';

export const FACTS_KEPT = 8;
export const RUMOURS_KEPT = 8;
export const FOLLOW_UPS_KEPT = 5;

const short = (value: unknown): value is string => typeof value === 'string'
  && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value)
  && !/^[0-9a-f-]{36}$/.test(value);

/** Keep only short ids and valid Lagos days from a possibly old or malformed save. */
export const cleanMemory = (list: unknown, keep = FACTS_KEPT): MemoryFact[] => (Array.isArray(list) ? list : [])
  .filter((item): item is Record<string, unknown> & { k: string; day: number } => isRecord(item) && short(item.k) && safeCount(item.day))
  .slice(-keep)
  .map(({ k, v, day }) => short(v) ? { k, v, day } : { k, day });
