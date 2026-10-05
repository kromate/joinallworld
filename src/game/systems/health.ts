/**
 * OWNER: world
 * Weather and illness.
 *
 * WEATHER  A pure function of the clock and the city (weatherAt): the same block of time is wet
 *   or dry for everyone, on the server and in the browser. It is seeded from the block index
 *   with util.makeRng, not from ctx.rng, because it must not depend on which request asks.
 *   Arriving by an exposed mode (trek, okada) while it rains adds the "Soaked by Rain" feeling.
 *
 * ILLNESS  Two fair, visible causes (numbers in content/health.ts, all original beta values):
 *   - neglect: Hygiene or Hunger kept very low for a long stretch of play. The Health app and
 *     a HUD chip warn from half-way, and washing or eating reverses it.
 *   - rain: a small ctx.rng chance each time you are soaked.
 *   Being sick adds the "Very Sick" feeling and makes a trek cost a little more. It blocks
 *   nothing: you can always travel, eat, rest and work.
 *   Cures: the hospital doctor (paid, quick), the hospital's free clinic (free, slow, always
 *   open), roadside agbo (which always finds a sick trekker), or waiting it out. So a player
 *   with no cash is never stuck being sick.
 *
 * STATE  state.health = { sick, cause, since, strain, immuneUntil }
 *   strain  seconds of neglect accumulated toward falling sick (0 … illness.neglectSeconds)
 *
 * EVENTS EMITTED     'illness.started' { cause }   'illness.cured' { by }   'weather.soaked' { mode }
 *                    'notice.posted' { kind: 'illness' | 'recovered', text }   a line for the Updates feed
 * EVENTS LISTENED    'travel.arrived' { mode }, 'activity.completed' (tags 'cure', 'checkup',
 *                    'immunity'), 'health.treat' { by }
 * MODIFIERS          'activity.block' — `requiresIllness: true` activities need you to be sick
 *                    'travel.needCost' — a sick trek costs 2 more Energy and Hygiene
 */
import { LEFT_OUT, PLAYS } from '../profile.ts';
import { emit } from '../registry.ts';
import { finite, isRecord, makeRng } from '../util.ts';
import { addMoodlet, removeMoodlet, feelingsOf } from '../api.ts';
import { HEALTH } from '../content/health.ts';
import { isCityId, cityRules } from '../cities/registry.ts';
import { ALL_MODES } from '../content/travel.ts';
import type { SystemDefinition } from '../../types/registry.ts';
import type { IllnessCause, LifeContext, LifeState, NeedId } from '../../types/life.ts';
import type { HealthView } from '../../types/view.ts';

const { feelings, illness, weather } = HEALTH;
const CAUSES = ['neglect', 'rain'] as const satisfies readonly IllnessCause[];
const isCause = (value: unknown): value is IllnessCause => CAUSES.some((cause) => cause === value);

/** The sky over a city at a moment. Deterministic; identical for every player and every caller. */
export function weatherAt(now: unknown, cityId: string) {
  if (!isCityId(cityId)) throw new TypeError(`Unknown city weather: ${cityId}`);
  const blockMs = weather.blockMinutes * 60000;
  const block = Math.floor((finite(now) ? now : 0) / blockMs);
  const climate = cityRules(cityId)?.climate;
  const month = climate ? new Date(block * blockMs + 3600000).getUTCMonth() : 0;
  const raining = makeRng(`weather|${cityId}|${block}`)() < (climate?.rainChanceByMonth[month] ?? weather.rainChance);
  const kind = weather.kinds[raining ? 'rain' : 'clear'];
  const local = climate ? raining ? { text: 'It is raining. Exposed travel can leave you soaked.' } : { label: climate.harmattan?.months.includes(month + 1) ? climate.harmattan.label : climate.clearLabel } : {};
  return { ...kind, ...local, raining, until: (block + 1) * blockMs };
}

const nowOf = (state: LifeState, ctx: LifeContext): number => (finite(ctx?.now) ? ctx.now : state.t);
const immune = (state: LifeState, now: number): boolean => state.health.immuneUntil > now;
const hasFeeling = (state: LifeState, id: string): boolean => state.moodlets.some((moodlet) => moodlet.id === id);

function fallSick(state: LifeState, cause: IllnessCause, ctx: LifeContext): boolean {
  if (state.health.sick) return false;
  state.health.sick = true;
  state.health.cause = cause;
  state.health.since = nowOf(state, ctx);
  state.health.strain = 0;
  addMoodlet(state, feelings.sick, ctx);
  emit(state, 'illness.started', { cause }, ctx);
  emit(state, 'notice.posted', { kind: 'illness', text: cause === 'rain' ? 'You caught something in the rain and are very sick. See the doctor or the free clinic at the General Hospital.'
    : 'You fell sick from going hungry and unwashed for too long. See the doctor or the free clinic at the General Hospital.' }, ctx);
  return true;
}

function cure(state: LifeState, by: string, seconds: number, ctx: LifeContext): boolean {
  const now = nowOf(state, ctx);
  const wasSick = state.health.sick;
  state.health.sick = false;
  state.health.cause = null;
  state.health.since = null;
  state.health.strain = 0;
  state.health.immuneUntil = Math.max(state.health.immuneUntil, now + seconds * 1000);
  if (!wasSick) return false;
  removeMoodlet(state, feelings.sick.id);
  addMoodlet(state, feelings.recovered, ctx);
  emit(state, 'illness.cured', { by }, ctx);
  emit(state, 'notice.posted', { kind: 'recovered', text: 'You are well again.' }, ctx);
  return true;
}

function view(state: LifeState, ctx: LifeContext): HealthView {
  const now = nowOf(state, ctx), health = state.health;
  const sky = weatherAt(now, state.estate.city);
  const strain = Math.min(1, health.strain / illness.neglectSeconds);
  const low = illness.neglectNeeds.filter((need) => state.needs[need] < illness.neglectBelow);
  const rundown = !health.sick && strain >= illness.warnAt;
  const soaked = hasFeeling(state, feelings.soaked.id);
  const warning: HealthView['warning'] = health.sick ? { level: 'sick', icon: '🤒', text: 'Very sick · see a doctor' }
    : rundown ? { level: 'rundown', icon: '🧼', text: 'Run down · wash and eat' }
      : sky.raining ? { level: 'rain', icon: sky.icon, text: 'Raining · trekkers get soaked' } : null;
  const advice: string[] = [];
  if (health.sick) advice.push('Go to the General Hospital. The doctor is quick; the free clinic costs nothing but takes longer.', 'Trekking while sick costs more Energy and Hygiene — and the agbo seller will find you on the way.', 'It will also pass by itself in about six hours.');
  else {
    if (low.length) advice.push(`Your ${low.join(' and ')} ${low.length > 1 ? 'are' : 'is'} very low. Keep ${low.length > 1 ? 'them' : 'it'} above ${illness.neglectBelow} or you will slowly fall sick. Home has free food and a free bath.`);
    else if (strain > 0) advice.push('You are recovering from a rough patch. Stay fed and clean and the risk fades.');
    if (sky.raining) advice.push(cityRules(state.estate.city)?.climate ? 'It is raining. Choose covered travel to stay dry — a soaking has a small chance of making you sick.' : 'It is raining. Take a keke, danfo or cab to stay dry — a soaking has a small chance of making you sick.');
    if (!advice.length) advice.push('You are in good health. Eat, wash and stay out of the rain to keep it that way.');
  }
  return {
    sick: health.sick, cause: health.cause, since: health.since, strain, rundown, low, soaked,
    immune: immune(state, now), immuneMinutes: Math.max(0, Math.ceil((health.immuneUntil - now) / 60000)),
    healsInMinutes: health.sick ? Math.max(0, Math.ceil(((health.since ?? 0) + illness.selfHealSeconds * 1000 - now) / 60000)) : null,
    status: health.sick ? feelings.sick.label : rundown ? 'Run down' : 'Healthy',
    weather: { id: sky.id, label: sky.label, icon: sky.icon, text: sky.text, raining: sky.raining, minutesLeft: Math.max(1, Math.ceil((sky.until - now) / 60000)) },
    warning, advice, cures: HEALTH.cures,
    feelings: feelingsOf(state).filter((feeling) => [feelings.sick.id, feelings.soaked.id, feelings.recovered.id].includes(feeling.id)),
  };
}

/**
 * What only a host that plays the game runs: player actions, settling time and event listeners. The browser reads lives, it never plays them,
 * so its build leaves this out (PLAYS is false there: src/game/profile.ts).
 */
const play = PLAYS ? {
  actions: {},
  advance(state, dt, ctx) {
    const now = nowOf(state, ctx), health = state.health;
    if (health.sick) {
      if (!hasFeeling(state, feelings.sick.id)) addMoodlet(state, feelings.sick, ctx);
      if (now - (health.since ?? 0) >= illness.selfHealSeconds * 1000) { cure(state, 'rest', illness.immunitySeconds.cure, ctx); state.message = 'The sickness has passed. You feel like yourself again.'; }
      return;
    }
    const step = Math.min(Math.max(0, dt), illness.maxStepSeconds);
    const neglected = illness.neglectNeeds.some((need) => state.needs[need] < illness.neglectBelow);
    health.strain = Math.min(illness.neglectSeconds, Math.max(0, health.strain + (neglected ? step : -2 * step)));
    if (health.strain >= illness.neglectSeconds && !immune(state, now) && fallSick(state, 'neglect', ctx)) {
      state.message = 'You have fallen sick from going hungry and unwashed for too long. Go to the General Hospital — the free clinic costs nothing.';
    }
  },
  on: {
    'travel.arrived': (state, data, ctx) => {
      const mode = data.mode === null || data.mode === 'campus-shuttle' ? undefined : ALL_MODES[data.mode];
      const now = nowOf(state, ctx);
      if (!mode?.exposed || !weatherAt(now, state.estate.city).raining) return;
      addMoodlet(state, feelings.soaked, ctx);
      state.message = `${state.message} The rain soaked you on the way.`.trim();
      emit(state, 'weather.soaked', { mode: mode.id }, ctx);
      if (!state.health.sick && !immune(state, now) && ctx.rng() < illness.soakedChance && fallSick(state, 'rain', ctx)) {
        state.message += ' You have caught something — see a doctor at the General Hospital.';
      }
    },
    'activity.completed': (state, data, ctx) => {
      const tags = data.tags || [];
      if (tags.includes('cure') && cure(state, data.id, illness.immunitySeconds.cure, ctx)) state.message = 'You have been treated and you are well again.';
      if (tags.includes('checkup')) { state.health.strain = 0; state.message = state.health.sick ? 'Check-up done: you are sick. See the doctor or queue at the free clinic.' : 'Check-up done: a clean bill of health.'; }
      if (tags.includes('immunity')) { const now = nowOf(state, ctx); state.health.immuneUntil = Math.max(state.health.immuneUntil, now + illness.immunitySeconds.vitamins * 1000); state.message = 'Vitamins taken. You are protected from falling sick for a while.'; }
    },
    'health.treat': (state, data, ctx) => { cure(state, typeof data.by === 'string' ? data.by : 'remedy', illness.immunitySeconds.agbo, ctx); },
  },
} satisfies Pick<SystemDefinition<'health'>, 'actions' | 'advance' | 'on'> : LEFT_OUT;

export default {
  id: 'health',
  stateKeys: ['health'],
  sanitize(input, state, ctx) {
    const saved = isRecord(input.health) ? input.health : {};
    const now = nowOf(state, ctx);
    const sick = saved.sick === true;
    state.health = {
      sick,
      cause: sick && isCause(saved.cause) ? saved.cause : sick ? 'neglect' : null,
      since: sick ? (finite(saved.since) && saved.since <= now ? saved.since : now) : null,
      strain: finite(saved.strain) ? Math.min(illness.neglectSeconds, Math.max(0, saved.strain)) : 0,
      // Immunity can never outlast the longest one the rules grant.
      immuneUntil: finite(saved.immuneUntil) && saved.immuneUntil > 0 ? Math.min(saved.immuneUntil, now + Math.max(...Object.values(illness.immunitySeconds)) * 1000) : 0,
    };
  },
  view,
  modifiers: {
    'activity.block': (value, state, data) => value || (data?.def?.requiresIllness && !state.health.sick
      ? { code: 'not_sick', reason: 'You are not sick, so there is nothing to treat. Come back if you fall ill.' } : null),
    'travel.needCost': (value, state, data) => {
      if (!state.health.sick || data?.mode !== 'trek' || !isRecord(value)) return value;
      const next = { ...value };
      // The keys of the sick-trek table are need ids.
      for (const [need, amount] of Object.entries(HEALTH.sickTrek) as [NeedId, number][]) next[need] = (next[need] || 0) + amount;
      return next;
    },
  },
  ...play,
} satisfies SystemDefinition<'health'>;
