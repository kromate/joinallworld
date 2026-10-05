/**
 * OWNER: world
 * The "no dead end" search: from a sampled state, a sensible player who only does what the rules let them do and what they can afford
 * plays on a virtual clock for up to MAX_HOURS, and we ask three things. Do their needs come back to NEEDS_OK? Did they earn
 * anything? And, if they are a visitor, did they get home? A state from which the answer to any of them is no is a dead end.
 * `nets: false` leaves the safety nets (src/game/relief.ts) out, which lists the dead ends the nets exist for.
 * Used by src/game/stuck.test.ts and scripts/dead-ends.ts; nothing in the game imports it.
 */
import { advanceLife, createLife, dispatch, viewLife } from '../life.ts';
import { DEFAULT_LOOK } from './content/traits.ts';
import { cityRules, linksFrom } from './cities/registry.ts';
import { jobFor, venuesFor } from './cities/runtime.ts';
import { arrive, blockReason, spotsOf } from './api.ts';
import { isReliefActivity } from './relief.ts';
import type { ActivityDefinition } from '../types/content.ts';
import type { LifeContextInit, LifeState } from '../types/life.ts';

export const NEEDS_OK = 25;
export const MAX_HOURS = 72;
const MAX_STEPS = 80;

export interface Sample {
  /** The city of the main home. */
  home: string;
  /** Where the player stands: the home city (a resident) or another (a visitor). */
  city: string;
  cash: number;
  hunger: number;
  energy: number;
  /** 'none', the starter job, or a career track held from the home city. */
  job: string | null;
  /** Server clock, ms. */
  now: number;
  /** Start somewhere else in the city than where a newcomer arrives (a venue id). */
  venue?: string;
  /** Start on a trip between cities with this many seconds left (a visitor mid-trip). */
  midTrip?: number;
}

export interface Outcome {
  sample: Sample;
  needsOk: boolean;
  earned: boolean;
  home: boolean;
  /** What the player did, for a failing state. */
  trail: string[];
}

export const stuck = (outcome: Outcome): boolean => !outcome.needsOk || !outcome.earned || !outcome.home;

// ---- building a life ------------------------------------------------------------------------------

const copy = (state: LifeState): LifeState => JSON.parse(JSON.stringify(state)) as LifeState;
const templates = new Map<string, LifeState>();
export const START_SAMPLE = Date.UTC(2026, 0, 5, 9);

function build(home: string, city: string): LifeState {
  const key = `${home}>${city}`;
  const known = templates.get(key);
  if (known) return copy(known);
  let now = START_SAMPLE;
  const at = (state?: LifeState): LifeContextInit => ({ cityId: state?.estate.city ?? home, now, seed: `stuck-${key}` });
  const state = createLife({ name: 'Wanderer' }, { ...at(), isNew: true, quickStart: true });
  const run = (type: string, payload: object = {}) => dispatch(state, { type, payload } as never, at(state));
  run('onboarding.quick-start', { look: DEFAULT_LOOK });
  run('onboarding.traits', { traits: ['clean-pikin', 'musical'] });
  run('onboarding.dream', { dream: 'afrobeats-star' });
  run('onboarding.lottery', {});
  const started = run('onboarding.home', { lga: cityRules(home)!.units[0]!.id, via: 'manual' });
  if (started.code !== 'life_started') throw new Error(`could not start a life in ${home}: ${started.code}`);
  if (city !== home) {
    state.cash = 1_000_000;
    const sent = run('estate.relocate', { to: city, mode: linksFrom(home).find((link) => link.to === city && link.mode === 'road')?.mode ?? linksFrom(home).find((link) => link.to === city)?.mode });
    if (sent.code !== 'departed') throw new Error(`no way from ${home} to ${city}: ${sent.code}`);
    now += ((state.activeAction?.remaining ?? 0) + 1) * 1000;
    advanceLife(state, (state.activeAction?.remaining ?? 0) + 1, at(state));
  }
  state.t = START_SAMPLE;
  templates.set(key, copy(state));
  return state;
}

// ---- playing it out -------------------------------------------------------------------------------

interface Candidate { venue: string; spot: string; def: ActivityDefinition; reward: number; cost: number; hunger: number; energy: number }

export function playOut(sample: Sample, { nets = true } = {}): Outcome {
  const state = build(sample.home, sample.city);
  let now = sample.now;
  state.t = now;
  state.cash = sample.cash;
  state.needs.hunger = sample.hunger;
  state.needs.energy = sample.energy;
  const trail: string[] = [];
  const at = (): LifeContextInit => ({ cityId: state.estate.city, now, seed: `play-${sample.cash}-${sample.now}` });
  const run = (type: string, payload: object = {}) => dispatch(state, { type, payload } as never, at());
  const wait = (seconds: number): void => { now += seconds * 1000; advanceLife(state, Math.max(1, seconds), at()); };
  if (sample.venue) arrive(state, sample.venue, { ...at(), cityId: state.estate.city } as never);
  if (sample.job) {
    state.job = sample.job as LifeState['job'];
    Object.assign(state.career, { city: sample.home, level: 1, performance: 50 });
  }
  if (sample.midTrip !== undefined && sample.city !== sample.home) {
    // A visitor on the way home with nothing left: the trip runs out and they arrive.
    state.activeAction = { kind: 'intercity', id: sample.home, duration: 40, remaining: sample.midTrip, mode: 'road', fare: 12000, from: sample.city };
    trail.push(`on a trip, ${sample.midTrip}s left`);
  }
  const visitor = sample.city !== sample.home;
  const start = state.cash;
  let earned = false, needsOk = state.needs.hunger >= NEEDS_OK && state.needs.energy >= NEEDS_OK, reachedHome = !visitor;
  const finished = (): boolean => needsOk && earned && reachedHome;

  const cheapestHome = (): number | null => {
    const fares = linksFrom(state.estate.city).filter((link) => link.to === state.estate.home && link.status !== 'coming').map((link) => link.fare);
    return fares.length ? Math.min(...fares) : null;
  };
  const candidates = (): Candidate[] => {
    const city = state.estate.city, found: Candidate[] = [];
    for (const venue of venuesFor(city)) {
      if (venue.id === 'home' && !state.estate.lga) continue;
      for (const spot of spotsOf(venue.id, city)) for (const def of spot.activities) {
        if (!nets && isReliefActivity(def)) continue;
        if (blockReason(state, def, venue.id, { ...at(), cityId: city } as never)) continue;
        found.push({ venue: venue.id, spot: spot.id, def, reward: def.reward ?? 0, cost: def.cost ?? 0, hunger: def.effects?.hunger ?? 0, energy: def.effects?.energy ?? 0 });
      }
    }
    return found;
  };
  /** Go to the place and do it; false when something stood in the way. */
  const perform = (item: Candidate): boolean => {
    if (state.location !== item.venue) {
      const trip = run('travel', { id: item.venue, mode: 'trek' });
      if (!trip.ok) { trail.push(`cannot reach ${item.venue}: ${trip.code}`); return false; }
      wait((state.activeAction?.remaining ?? 0) + 1);
    }
    if (state.spot !== item.spot) run('spot', { id: item.spot });
    const done = run('activity', { id: item.def.id });
    if (!done.ok) { trail.push(`${item.def.id}: ${done.code}`); return false; }
    wait((state.activeAction?.remaining ?? 0) + 1);
    trail.push(item.def.id);
    return true;
  };
  const look = (): void => {
    if (state.needs.hunger >= NEEDS_OK && state.needs.energy >= NEEDS_OK) needsOk = true;
    if (visitor && state.estate.city === sample.home) reachedHome = true;
  };

  const limit = now + MAX_HOURS * 3600 * 1000;
  for (let step = 0; step < MAX_STEPS && now < limit && !finished(); step++) {
    if (state.activeAction) { wait(state.activeAction.remaining + 1); look(); continue; }
    if (visitor && state.estate.city !== sample.home) {
      const fare = cheapestHome();
      const here = viewLife(state, at()).estate;
      if (fare !== null && state.cash >= fare && !here.ride.debt) {
        const link = linksFrom(state.estate.city).filter((item) => item.to === state.estate.home && item.fare === fare)[0]!;
        const sent = run('estate.relocate', { to: link.to, mode: link.mode });
        if (sent.ok) { trail.push(`paid ${fare} home`); continue; }
        trail.push(`fare home refused: ${sent.code}`);
      } else if (nets && here.ride.offer) {
        const sent = run('estate.relocate', { to: here.ride.offer.to, mode: here.ride.offer.mode, credit: true });
        if (sent.ok) { trail.push('ride home on credit'); continue; }
        trail.push(`credit refused: ${sent.code}`);
      }
    }
    const all = candidates();
    // Needs first: a free way, else the cheapest that is paid.
    const fix = (need: 'hunger' | 'energy'): boolean => {
      if (state.needs[need] >= 60) return false;
      const options = all.filter((item) => item[need] > 0 && item.cost <= state.cash && item.reward === 0).sort((a, b) => a.cost - b.cost || b[need] - a[need]);
      return options.length > 0 && perform(options[0]!);
    };
    if (state.needs.energy < 60 && !state.estate.lga && run('estate.lodge').ok) { trail.push('guest house'); look(); continue; }
    if (fix('hunger') || fix('energy')) { look(); continue; }
    // A job: a visitor holding one elsewhere moves it here; someone with none takes the starter job.
    if (state.job && state.career.city !== state.estate.city && jobFor(state.estate.city, state.job)) {
      if (run('apply-job', { id: state.job }).ok) trail.push('moved my job here');
    } else if (!state.job && jobFor(state.estate.city, 'community-helper') && run('apply-job', { id: 'community-helper' }).ok) trail.push('took the starter job');
    const paid = candidates().filter((item) => item.reward > 0 && item.cost < item.reward).sort((a, b) => b.reward - a.reward);
    if (paid.length) {
      const before = state.cash;
      if (perform(paid[0]!)) { if (state.cash > before || state.cash + 1 > before) earned = true; look(); continue; }
    }
    wait(3600);
    look();
  }
  look();
  if (state.cash > start || earned) earned = true;
  return { sample, needsOk, earned, home: reachedHome, trail: trail.slice(-12) };
}

// ---- sampling -------------------------------------------------------------------------------------

/** A small deterministic generator, so a failing sample can be named by its seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const CASH_LEVELS = [0, 50, 300, 1000, 2800, 4999, 8000, 20000];
export const NEED_LEVELS = [10, 15, 19, 25, 50, 100];

export function sampleOf(random: () => number, cities: readonly string[], homes: readonly string[]): Sample {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
  const home = pick(homes);
  const city = random() < 0.25 ? home : pick(cities);
  const jobs = [null, null, 'community-helper'] as (string | null)[];
  const track = jobFor(home, 'tech') ? 'tech' : null;
  if (track) jobs.push(track, 'retail', 'trading');
  const job = pick(jobs);
  const midTrip = city !== home && random() < 0.1 ? 1 + Math.floor(random() * 30) : undefined;
  const places = venuesFor(city).filter((venue) => venue.id !== 'home');
  const venue = midTrip === undefined && random() < 0.4 ? pick(places).id : undefined;
  return { home, city, cash: pick(CASH_LEVELS), hunger: pick(NEED_LEVELS), energy: pick(NEED_LEVELS), job: job && jobFor(home, job) ? job : null,
    now: START_SAMPLE + Math.floor(random() * 14 * 24) * 3600_000 + Math.floor(random() * 60) * 60_000, ...(midTrip !== undefined ? { midTrip } : {}), ...(venue ? { venue } : {}) };
}
