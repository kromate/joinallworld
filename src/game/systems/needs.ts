/**
 * OWNER: foundation (core — do not edit from a feature branch)
 * The six needs, background decay, moodlets and overall mood.
 *
 * State keys:
 *   needs     { hunger, energy, fun, social, hygiene, bladder } — satisfaction 0–100, higher is better
 *   decay     { [need]: fraction } — sub-point decay carried between settlements
 *   moodlets  [{ id, label, value, expiresAt|null }] — named, optionally timed mood modifiers
 * Use through api.ts: changeNeeds, addMoodlet, removeMoodlet, moodOf.
 *
 * BACKGROUND DECAY (original beta values)
 *   Each need loses NEED_DECAY_PER_HOUR points per real hour, in whole points, multiplied by
 *   modify('needs.decayRate', 1, { need }). At most OFFLINE_DECAY_CAP_SECONDS of decay is
 *   applied per settlement, so being away for a week costs no more than being away for four hours.
 *
 * NEEDS NEVER TRAP A PLAYER — the floor rule
 *   Background decay alone never takes a need below DECAY_FLOOR (10). Only a deliberate
 *   activity effect can push a need lower, to a minimum of 0. Content must keep the other half
 *   of the promise: Home is always reachable by a free trek, and Home always offers a free
 *   activity with no minimum needs for hunger, energy and hygiene (asserted in life.test.ts).
 *   Low needs lower mood and block activities that declare minimumNeeds; they never block
 *   travelling home, eating or resting.
 */
import { LEFT_OUT, PLAYS } from '../profile.ts';
import { modify } from '../registry.ts';
import { clamp, cleanText, finite, isId, isRecord } from '../util.ts';
import type { SystemDefinition } from '../../types/registry.ts';
import type { LifeContext, LifeState, Moodlet, NeedId, NeedMap } from '../../types/life.ts';
import type { Feeling, Mood } from '../../types/view.ts';

export const NEEDS = Object.freeze(['hunger', 'energy', 'fun', 'social', 'hygiene', 'bladder'] as const satisfies readonly NeedId[]);
export const STARTING_NEED = 50; // original beta value
export const NEED_DECAY_PER_HOUR = Object.freeze({ hunger: 6, energy: 4, fun: 5, social: 4, hygiene: 3, bladder: 8 } satisfies Record<NeedId, number>);
export const DECAY_FLOOR = 10;
export const OFFLINE_DECAY_CAP_SECONDS = 4 * 3600;
export const MAX_MOODLETS = 20;
export const LOW_NEED = 20;
/** Feelings shown automatically while a need is below LOW_NEED (original beta values). */
export const LOW_NEED_FEELINGS = Object.freeze({
  hunger: { id: 'hungry', label: 'Hungry', value: -10 },
  energy: { id: 'tired', label: 'Tired', value: -8 },
  fun: { id: 'bored', label: 'Bored', value: -6 },
  social: { id: 'lonely', label: 'Lonely', value: -6 },
  hygiene: { id: 'grubby', label: 'Grubby', value: -6 },
  bladder: { id: 'bursting', label: 'Bursting', value: -8 },
} satisfies Record<NeedId, Pick<Moodlet, 'id' | 'label' | 'value'>>);

/** A key the needs record holds (an unknown need is ignored). */
const hasNeed = (needs: Record<NeedId, number>, need: string): need is NeedId => Object.hasOwn(needs, need);

/** Apply need deltas ({ energy: 4, hunger: -5 }); unknown needs are ignored, results clamp to 0–100. */
export function changeNeeds(state: Pick<LifeState, 'needs'>, deltas: NeedMap | null | undefined): void {
  for (const [need, amount] of Object.entries(deltas || {})) {
    if (hasNeed(state.needs, need) && finite(amount)) state.needs[need] = clamp(state.needs[need] + amount);
  }
}

/** Add or replace a named moodlet. `duration` is seconds from ctx.now; omit for one that lasts until removed. */
export function addMoodlet(state: Pick<LifeState, 'moodlets' | 't'>, { id, label, value, duration }: { id: string; label?: string; value: number; duration?: number }, ctx?: Partial<Pick<LifeContext, 'now'>> | null): boolean {
  if (!isId(id) || !finite(value)) return false;
  removeMoodlet(state, id);
  if (state.moodlets.length >= MAX_MOODLETS) state.moodlets.shift();
  const now = finite(ctx?.now) ? ctx.now : state.t;
  state.moodlets.push({ id, label: cleanText(label, 40, id), value: clamp(Math.round(value), -100, 100),
    expiresAt: finite(duration) && duration > 0 ? now + duration * 1000 : null });
  return true;
}

export function removeMoodlet(state: Pick<LifeState, 'moodlets'>, id: string): void {
  state.moodlets = state.moodlets.filter((moodlet) => moodlet.id !== id);
}

/** Stored moodlets plus the automatic low-need feelings. */
export function feelingsOf(state: Pick<LifeState, 'needs' | 'moodlets'>): Feeling[] {
  const low = NEEDS.filter((need) => state.needs[need] < LOW_NEED).map((need) => ({ ...LOW_NEED_FEELINGS[need], expiresAt: null, need }));
  return [...low, ...state.moodlets];
}

/** Overall mood: average need plus every feeling, 0–100. */
export function moodOf(state: Pick<LifeState, 'needs' | 'moodlets'>): Mood {
  const average = NEEDS.reduce((sum, need) => sum + state.needs[need], 0) / NEEDS.length;
  const score = clamp(Math.round(average + feelingsOf(state).reduce((sum, feeling) => sum + feeling.value, 0)));
  const label = score >= 70 ? 'Happy' : score >= 45 ? 'Okay' : score >= 25 ? 'Uneasy' : 'Miserable';
  return { score, label, icon: score >= 70 ? '😄' : score >= 45 ? '🙂' : score >= 25 ? '😟' : '😣' };
}

/**
 * What only a host that plays the game runs: player actions, settling time and event listeners. The browser reads lives, it never plays them,
 * so its build leaves this out (PLAYS is false there: src/game/profile.ts).
 */
const play = PLAYS ? {
  actions: {},
  advance(state, dt, ctx) {
    const seconds = Math.min(dt, OFFLINE_DECAY_CAP_SECONDS);
    for (const need of NEEDS) {
      const rate = Math.max(0, modify(state, 'needs.decayRate', 1, { need }, ctx));
      const total = state.decay[need] + NEED_DECAY_PER_HOUR[need] * rate * seconds / 3600;
      // The epsilon keeps many small settlements equal to one large one despite float rounding.
      const whole = Math.floor(total + 1e-9);
      state.decay[need] = Math.max(0, total - whole);
      if (whole > 0 && state.needs[need] > DECAY_FLOOR) state.needs[need] = Math.max(DECAY_FLOOR, state.needs[need] - whole);
    }
    const now = finite(ctx?.now) ? ctx.now : state.t;
    if (state.moodlets.some((moodlet) => moodlet.expiresAt !== null && moodlet.expiresAt <= now)) {
      state.moodlets = state.moodlets.filter((moodlet) => moodlet.expiresAt === null || moodlet.expiresAt > now);
    }
  },
} satisfies Pick<SystemDefinition<'needs'>, 'actions' | 'advance'> : LEFT_OUT;

export default {
  id: 'needs',
  stateKeys: ['needs', 'decay', 'moodlets'],
  sanitize(input, state) {
    // Every need is set in the loop below.
    state.needs = {} as Record<NeedId, number>;
    state.decay = {} as Record<NeedId, number>;
    for (const need of NEEDS) {
      const value = isRecord(input.needs) ? input.needs[need] : undefined;
      state.needs[need] = finite(value) ? clamp(value) : STARTING_NEED;
      const carry = isRecord(input.decay) ? input.decay[need] : undefined;
      state.decay[need] = finite(carry) && carry >= 0 && carry < 1 ? carry : 0;
    }
    const saved: unknown[] = Array.isArray(input.moodlets) ? input.moodlets : [];
    state.moodlets = saved.slice(-MAX_MOODLETS)
      .filter((moodlet): moodlet is Record<string, unknown> & { id: string; value: number; expiresAt: number | null } => isRecord(moodlet) && isId(moodlet.id) && finite(moodlet.value) && (moodlet.expiresAt === null || finite(moodlet.expiresAt)))
      .map((moodlet) => ({ id: moodlet.id, label: cleanText(moodlet.label, 40, moodlet.id), value: clamp(Math.round(moodlet.value), -100, 100), expiresAt: moodlet.expiresAt }));
  },
  view(state) { return { order: NEEDS, low: LOW_NEED, mood: moodOf(state), feelings: feelingsOf(state) }; },
  ...play,
} satisfies SystemDefinition<'needs'>;
