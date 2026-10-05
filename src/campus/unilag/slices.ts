/**
 * What a life that has never used the UNILAG campus holds for it, and the stand-ins the browser registers until the campus
 * rules are fetched (register.ts). The rules (student.ts, games.ts, shuttle.ts) build their fresh slices from these functions,
 * so there is one definition of "never used".
 *
 * A stand-in owns the same state keys as its system and rebuilds ONLY a slice that equals the fresh one (or is absent). Any other
 * input — a programme, a club, a ride, a running campus action — is a life that needs the real sanitize(): the stand-in throws
 * (CampusNotLoaded) instead of rebuilding it, so nothing is ever dropped or changed by code that does not know the rules.
 * src/game/campus-gate.ts fetches the campus rules before such a life reaches createLife.
 */
import type { SystemDefinition } from '../../types/registry.ts';
import { STUDENT_REQUIRED_BLOCK, VOLUNTEER_ACTIVITY } from './volunteer.ts';
import type { UnilagCommunityState, UnilagShuttleState, UnilagStudentState } from '../../types/campus.ts';

export function freshStudent(): UnilagStudentState {
  return {
    status: 'none', programme: null, studentId: null, admittedDay: null, applicationCount: 0,
    term: null, records: [],
    hostel: { allocations: [], storage: {} },
    lifetime: { scholarshipPaid: false, campusJobDays: [] },
  };
}

export function freshCommunity(): UnilagCommunityState {
  return { clubs: [], discoveries: [], trail: [], days: [], quiz: null, elections: { nominated: [], voted: [] } };
}

export const freshShuttle = (): UnilagShuttleState => ({ rides: 0 });

/** The three campus slices, by state key. */
export const FRESH_SLICES = { unilagStudent: freshStudent, unilagCommunity: freshCommunity, unilagShuttle: freshShuttle } as const;
export type CampusSlice = keyof typeof FRESH_SLICES;
export const CAMPUS_SLICES = Object.keys(FRESH_SLICES) as CampusSlice[];
/** The kinds of timed action the campus registers. */
export const CAMPUS_ACTIVE_KINDS: readonly string[] = ['campus-study', 'campus-game', 'campus-shuttle'];

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.hasOwn(b, key) && same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

/** True when `saved` is what the campus slice `key` holds for a life that never used it: absent, or exactly the fresh slice. */
export const isFreshSlice = (key: CampusSlice, saved: unknown): boolean => saved === undefined || saved === null || same(saved, FRESH_SLICES[key]());

/**
 * Does a raw life (a saved copy or a server answer) need the campus rules to be read? Yes when any campus slice holds more than
 * the fresh slice, the player stands on the campus, or a campus timed action is running.
 */
export function needsCampusRules(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const life = raw as Record<string, unknown>;
  if (CAMPUS_SLICES.some((key) => !isFreshSlice(key, life[key]))) return true;
  if (life.location === 'unilag') return true;
  const action = life.activeAction;
  const kind = typeof action === 'object' && action !== null ? (action as Record<string, unknown>).kind : null;
  return typeof kind === 'string' && CAMPUS_ACTIVE_KINDS.includes(kind);
}

export class CampusNotLoaded extends Error {
  constructor(key: string) { super(`The life holds campus state (${key}) and the campus rules are not loaded: they must be fetched first (src/game/campus-gate.ts).`); this.name = 'CampusNotLoaded'; }
}

function standIn<K extends CampusSlice>(key: K): SystemDefinition<K> {
  return {
    // What the campus puts in a catalogue of every life, as the full system does for a life that is not a student (the only kind a stand-in rebuilds).
    ...(key === 'unilagCommunity' ? {
      activities: [VOLUNTEER_ACTIVITY],
      modifiers: { 'activity.block': (value: unknown, _state: unknown, data: { def?: { id?: string } }) => (value || data?.def?.id !== VOLUNTEER_ACTIVITY.id ? value : STUDENT_REQUIRED_BLOCK) },
    } : {}),
    id: key,
    stateKeys: [key],
    sanitize(input, state) {
      if (!isFreshSlice(key, input[key])) throw new CampusNotLoaded(key);
      (state as unknown as Record<string, unknown>)[key] = FRESH_SLICES[key]();
    },
  } as SystemDefinition<K>;
}

/** In registration order (src/game/systems/index.ts). */
export const CAMPUS_STAND_INS: SystemDefinition<string>[] = [standIn('unilagStudent'), standIn('unilagCommunity'), standIn('unilagShuttle')];
