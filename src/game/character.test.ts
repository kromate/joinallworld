// OWNER: character — tests for this owner's systems and content.
// Pattern and rules: see "HOW TO TEST" at the top of src/game/registry.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLife, dispatch, advanceLife, viewLife } from '../life.ts';
import { systems, emit, modify } from './registry.ts';
import { makeContext } from './util.ts';
import { APPEARANCE, TRAITS, DREAMS, LOTTERY, START_HOMES, START_NEEDS, MOODS, BOUTIQUE_PRICES, DREAM_REWARD, DREAM_TARGETS } from './content/traits.ts';
import { STARTER_GOALS, STARTER_INTRO, WISHES, PERKS, WISH_REROLLS_PER_DAY } from './content/goals.ts';
import { fixture } from '../../server/test-fixture.ts';
import type { ActionBody } from '../types/actions.ts';
import type { LifeContext, LifeState, LotteryId, SkillId } from '../types/life.ts';
import type { EngineEvent, EngineEventMap, ModifierKey, ModifierMap } from '../types/registry.ts';

const START = Date.UTC(2026, 0, 5, 8); // Monday 9 AM in Lagos
let tick = 0;
const at = (now = START, seed = `t${tick++}`) => makeContext({ now, cityId: 'lagos', seed });
const ctx = at(START, 'character-test');
/** What every test sees of a result: dispatch's union, with the optional failure reason readable on both arms. */
type Outcome = { ok: boolean; code: string; state: LifeState; reason?: string };
/** Send one action. The type and payload are loose on purpose: several tests send malformed ones to see them refused. */
const act = (state: LifeState, type: string, payload: Record<string, unknown> = {}, context: LifeContext = at()): Outcome => dispatch(state, { type, payload } as ActionBody, context);
/** Emit an event with deliberately partial, wrong or unknown data (listeners must tolerate it, and these tests prove they do). */
const emitLoose = (state: LifeState, event: string, data: unknown, context: LifeContext) => emit(state, event as EngineEvent, data as unknown as EngineEventMap[EngineEvent], context);
/** Ask for a modifier with deliberately partial or missing data (the cast is the point: listeners must tolerate it). */
const modifyLoose = <K extends ModifierKey>(state: LifeState, key: K, base: ModifierMap[K]['base'], data: object | undefined, context: LifeContext) => modify(state, key, base, data as ModifierMap[K]['data'], context);
/** The fields a test reads off a goal chip, whichever kind it is. */
type ChipFields = { kind: string; title: string; hint: string; reward?: string; go?: readonly (string | undefined)[]; open?: string; params?: Record<string, unknown> };
/** Narrow a value a test has just made sure exists. */
function need<T>(value: T | null | undefined, label = 'value'): T {
  assert.ok(value !== null && value !== undefined, `${label} exists`);
  return value;
}
const LOOK = { body: 'man', hair: 'afro', outfit: 'hoodie', fabric: 'ankara', skin: 'skin-6', hairColor: 'auburn', outfitColor: 'teal', bottomsColor: 'cream' };

/** Roll with fresh seeds until the wanted outcome comes up (the roll is random by design). */
function rollTo(state: LifeState, outcome: string) {
  for (let i = 0; i < 500; i++) {
    const trial = structuredClone(state);
    act(trial, 'onboarding.lottery', {}, at(START + i, `roll-${outcome}-${i}`));
    if (need(trial.onboarding.lottery).id === outcome) return trial;
  }
  throw new Error(`No ${outcome} roll in 500 tries`);
}

/** A life that has finished character creation. */
function started({ outcome = 'lapo-baby', house = 'yaba', traits = ['hustler', 'foodie'], dream = 'yaba-unicorn', look = LOOK } = {}) {
  let state = createLife(null, at());
  assert.equal(act(state, 'onboarding.look', { look }).code, 'look_saved');
  assert.equal(act(state, 'onboarding.traits', { traits }).code, 'traits_saved');
  assert.equal(act(state, 'onboarding.dream', { dream }).code, 'dream_saved');
  state = rollTo(state, outcome);
  const result = act(state, 'onboarding.home', { house });
  assert.equal(result.code, 'life_started', result.reason);
  return state;
}

test('character systems are registered and survive hostile saves', () => {
  for (const id of ['onboarding', 'goals']) {
    const system = systems().find(item => item.id === id);
    assert.ok(system, id);
    for (const junk of ['text', 7, [], { nested: { deep: true } }]) {
      const state = createLife({ [id]: junk }, ctx);
      for (const key of system.stateKeys) assert.notEqual(Reflect.get(state, key), junk, `${id}.${key} must be rebuilt, not copied`);
    }
  }
  const state = createLife(null, ctx);
  assert.equal(advanceLife(state, 60, { ...ctx, now: ctx.now + 60000 }).ok, true);
  assert.equal(typeof viewLife(state, ctx), 'object');
  assert.equal(typeof dispatch, 'function');
});

test('hostile onboarding and goals slices are rebuilt field by field', () => {
  const hostile = createLife({
    onboarding: { done: false, step: 99, look: { body: 'robot', hair: '<script>' }, traits: ['hustler', 'hustler', 'nope', 7], dream: 'be-rich', lottery: { id: 'jackpot' }, house: 'ikoyi',
      seed: -5, wardrobe: { hair: ['gele', 'wig', 5], outfit: 'all', fabric: null } },
    goals: { started: 'yes', chain: 99, seen: ['eat', 'nope'], stars: 1e12, perks: ['odogwu', 'odogwu', 'free-money'], wishes: [{ id: 'nope' }, { id: 'earn-15k', n: -4 }, 5, { id: 'earn-15k' }],
      rerolls: { day: 'x', used: -1 }, dream: 'nope', dreamDone: true, stats: { friends: -1, best: 'many', level: 1e9, assets: NaN, funded: 'yes' }, seq: 2, feed: [{ n: 9, text: 'x' }, { n: 1, text: 5 }, 'x'] },
  }, ctx);
  const o = hostile.onboarding, g = hostile.goals;
  assert.equal(o.done, false); assert.equal(o.step, 1, 'the step cannot be ahead of the choices actually made');
  assert.equal(o.look.body, 'woman'); assert.deepEqual(o.traits, ['hustler']); assert.equal(o.dream, null); assert.equal(o.lottery, null); assert.equal(o.house, null);
  assert.deepEqual(o.wardrobe, { hair: ['low-cut'], outfit: ['casual'], fabric: ['plain'] }, 'nothing but the basics is owned before moving in');
  assert.equal(g.started, false); assert.equal(g.chain, STARTER_GOALS.length); assert.deepEqual(g.seen, []); assert.equal(g.stars, 1000000);
  assert.deepEqual(g.perks, ['odogwu']); assert.equal(g.wishes.length, 3); assert.equal(g.wishes[0]?.id, 'earn-15k'); assert.equal(g.wishes[0]?.n, 0);
  assert.equal(g.dream, null); assert.equal(g.dreamDone, false); assert.deepEqual(g.feed, []);
  assert.deepEqual(g.stats, { friends: 0, best: 0, level: 100, levelCap: 0, assets: 0, debt: 0, cchub: false, funded: false });
  assert.deepEqual(createLife(structuredClone(hostile), ctx), hostile, 'sanitizing a valid state is a no-op');
});

test('observed content: appearance lists, ten traits, five dreams, three homes, LAPO Baby', () => {
  assert.deepEqual(APPEARANCE.bodies.map(body => body.label), ['Woman', 'Man']);
  assert.deepEqual(APPEARANCE.hair.woman.map(id => APPEARANCE.labels[id]), ['Braids', 'Afro', 'Bun', 'Ponytail', 'Long', 'Locs', 'Low cut', 'Gele', 'Classic']);
  assert.deepEqual(APPEARANCE.hair.man.map(id => APPEARANCE.labels[id]), ['Low cut', 'Bald', 'Curls', 'Afro', 'Locs', 'Braids', 'Classic']);
  assert.deepEqual(APPEARANCE.outfits.woman.map(id => APPEARANCE.labels[id]), ['Casual', 'Office', 'Owambe', 'Site work']);
  assert.deepEqual(APPEARANCE.outfits.man.map(id => APPEARANCE.labels[id]), ['Casual', 'Hoodie', 'Office', 'Chill', 'Site work']);
  assert.deepEqual(APPEARANCE.fabrics.map(id => APPEARANCE.labels[id]), ['Plain', 'Ankara', 'Adire', 'Aso-oke']);
  assert.deepEqual([APPEARANCE.skin.length, APPEARANCE.hairColours.length, APPEARANCE.outfitColours.length], [7, 7, 10]);
  assert.deepEqual(APPEARANCE.outfitColours.map(swatch => swatch.id), ['blue', 'green', 'red', 'orange', 'violet', 'pink', 'teal', 'navy', 'cream', 'gold']);
  for (const kind of ['hair', 'outfit', 'fabric'] as const) {
    const ids = kind === 'hair' ? [...APPEARANCE.hair.woman, ...APPEARANCE.hair.man] : kind === 'outfit' ? [...APPEARANCE.outfits.woman, ...APPEARANCE.outfits.man] : APPEARANCE.fabrics;
    for (const id of ids) assert.ok(Number.isSafeInteger(Reflect.get(BOUTIQUE_PRICES[kind], id)), `${kind} ${id} has a price`);
  }
  assert.deepEqual(Object.values(TRAITS).map(trait => trait.label), ['Hustler', 'Foodie', 'Owambe Spirit', 'Gym Rat', 'Smooth Talker', 'Lazy Bone', 'Clean Pikin', 'Night Crawler', 'Tech Bro or Sis', 'Musical']);
  for (const trait of Object.values(TRAITS)) { assert.ok(Object.keys(trait.fx).length > 0, `${trait.id} has a gameplay effect`); assert.equal(trait.beta, true); assert.ok(trait.effects.length); }
  assert.deepEqual(Object.values(DREAMS).map(dream => dream.label), ['Oga at the Top', 'Lekki Landlord', 'Afrobeats Star', "Everybody's Padi", 'Yaba Unicorn']);
  assert.deepEqual(Object.values(START_HOMES).map(home => [home.id, home.rent, home.tag]), [['mushin', 2400, 'Hard start'], ['yaba', 6000, 'Balanced'], ['lekki', 17000, 'Big spender']]);
  const lapo = LOTTERY['lapo-baby'];
  assert.deepEqual(lapo.startCash, { mushin: 76000, yaba: 96000 }); assert.deepEqual(lapo.loan, { principal: 60000, weekly: 12000, owed: 72000 });
  assert.deepEqual(lapo.skills, { hustle: 2 }); assert.deepEqual(lapo.fx, { xp: { all: 1.25 } }); assert.ok(lapo.locked.lekki); assert.equal(lapo.beta, undefined);
  const others = Object.values(LOTTERY).filter(outcome => outcome.id !== 'lapo-baby');
  assert.ok(others.length >= 2 && others.length <= 3); assert.ok(others.every(outcome => outcome.beta === true && outcome.bullets.length === 4));
  assert.equal(Object.values(LOTTERY).reduce((sum, outcome) => sum + outcome.odds, 0), 100);
  assert.ok(others.some(outcome => (outcome.startCash.lekki ?? NaN) > (lapo.startCash.yaba ?? NaN)), 'a richer outcome exists');
  assert.ok(others.some(outcome => (outcome.startCash.yaba ?? NaN) < (lapo.startCash.mushin ?? NaN) && !outcome.loan), 'a poorer, debt-free outcome exists');
  assert.deepEqual(MOODS.map(mood => mood.word), ['Very Happy', 'Happy', 'Fine', 'Uneasy', 'Miserable']);
});

test('a new life is offered onboarding; a save from before it existed is treated as onboarded and loses nothing', () => {
  const fresh = createLife(null, ctx);
  assert.equal(fresh.onboarding.done, false); assert.equal(fresh.onboarding.step, 0); assert.equal(fresh.onboarding.seed, fresh.cash);
  assert.equal(viewLife(fresh, ctx).goals.chip.open, 'onboarding');
  assert.deepEqual(createLife(structuredClone(fresh), ctx), fresh);
  // Offered, not enforced: a new life can still act straight away.
  assert.equal(act(fresh, 'apply-job', { id: 'community-helper' }).ok, true);

  for (const old of [{ cash: 4321, job: 'community-helper', completedShifts: 3, needs: { hunger: 33 } }, { cash: 4321, job: 'community-helper', onboarding: {}, goals: {} }]) {
    const legacy = createLife(old, ctx);
    assert.equal(legacy.onboarding.done, true); assert.equal(legacy.onboarding.legacy, true); assert.equal(legacy.onboarding.step, 5);
    assert.equal(legacy.cash, 4321); assert.equal(legacy.job, 'community-helper'); assert.deepEqual(legacy.ledger, []);
    assert.equal(legacy.goals.started, false, 'no tutorial rewards are handed to an existing life');
    const refused = act(legacy, 'onboarding.look', { look: LOOK });
    assert.equal(refused.code, 'already_onboarded'); assert.match(refused.reason ?? '', /Profile/);
    assert.notEqual(viewLife(legacy, ctx).goals.chip.kind, 'create');
    // It may still edit its look: colours and skin are free, unowned styles are not.
    assert.equal(act(legacy, 'onboarding.set-look', { look: { ...legacy.onboarding.look, body: 'man', outfitColor: 'gold', skin: 'skin-1' } }).code, 'look_saved');
    assert.equal(legacy.onboarding.look.outfitColor, 'gold'); assert.equal(legacy.cash, 4321);
    assert.deepEqual(createLife(structuredClone(legacy), ctx), legacy);
  }
});

test('onboarding runs five validated steps in order and names what is missing', () => {
  const state = createLife(null, at());
  const early_steps: [string, Record<string, unknown>][] = [['onboarding.traits', { traits: ['hustler', 'foodie'] }], ['onboarding.dream', { dream: 'afrobeats-star' }], ['onboarding.lottery', {}], ['onboarding.home', { house: 'yaba' }]];
  for (const [type, payload] of early_steps) {
    const early = act(state, type, payload);
    assert.equal(early.code, 'step_required'); assert.match(early.reason ?? '', /Look step first/);
  }
  assert.equal(act(state, 'onboarding.set-look', { look: LOOK }).code, 'onboarding_required');
  assert.equal(act(state, 'onboarding.boutique-buy', { kind: 'hair', id: 'afro' }).code, 'onboarding_required');

  // Look: lists differ by body, every field is checked.
  const gele = act(state, 'onboarding.look', { look: { ...LOOK, hair: 'gele' } });
  assert.equal(gele.code, 'invalid_look'); assert.match(gele.reason ?? '', /hairstyle for the man body: Low cut, Bald, Curls, Afro, Locs, Braids, Classic/);
  assert.match(act(state, 'onboarding.look', { look: { ...LOOK, body: 'woman', outfit: 'hoodie' } }).reason ?? '', /outfit for the woman body: Casual, Office, Owambe, Site work/);
  assert.match(act(state, 'onboarding.look', { look: { ...LOOK, bottomsColor: '#fff' } }).reason ?? '', /bottoms colour/);
  assert.match(act(state, 'onboarding.look', { look: 'pretty' }).reason ?? '', /Choose a look/);
  assert.equal(act(state, 'onboarding.look', {}).code, 'invalid_look'); assert.equal(state.onboarding.step, 0);
  const shuffled = act(state, 'onboarding.look', { shuffle: true }, at(START, 'shuffle-a'));
  assert.equal(shuffled.code, 'shuffled'); assert.equal(state.onboarding.step, 0);
  const again = createLife(null, at()); act(again, 'onboarding.look', { shuffle: true }, at(START, 'shuffle-a'));
  assert.deepEqual(again.onboarding.look, state.onboarding.look, 'shuffle is deterministic for one action id');
  assert.equal(act(state, 'onboarding.look', { look: state.onboarding.look }).code, 'look_saved', 'a shuffled look is always valid');
  assert.equal(act(state, 'onboarding.look', { look: { ...LOOK, extra: 'dropped' } }).code, 'look_saved');
  assert.deepEqual(state.onboarding.look, LOOK); assert.equal(state.onboarding.step, 1);

  // Personality: exactly two different traits.
  for (const traits of [[], ['hustler'], ['hustler', 'hustler'], ['hustler', 'foodie', 'musical'], ['hustler', 'nope'], 'hustler']) {
    const bad = act(state, 'onboarding.traits', { traits });
    assert.equal(bad.code, 'invalid_traits'); assert.match(bad.reason ?? '', /exactly 2 different traits/);
  }
  assert.equal(act(state, 'onboarding.traits', { traits: ['lazy-bone', 'musical'] }).code, 'traits_saved');
  assert.equal(act(state, 'onboarding.home', { house: 'yaba' }).code, 'step_required');

  const noDream = act(state, 'onboarding.dream', { dream: 'win-lotto' });
  assert.equal(noDream.code, 'invalid_dream'); assert.match(noDream.reason ?? '', /Oga at the Top, Lekki Landlord, Afrobeats Star, Everybody's Padi, Yaba Unicorn/);
  assert.equal(act(state, 'onboarding.dream', { dream: 'afrobeats-star' }).code, 'dream_saved');
  assert.match(act(state, 'onboarding.home', { house: 'yaba' }).reason ?? '', /Birth lottery step first/);
  // Earlier steps may be redone before moving in.
  assert.equal(act(state, 'onboarding.traits', { traits: ['hustler', 'foodie'] }).code, 'traits_saved'); assert.equal(state.onboarding.step, 3);

  assert.equal(act(state, 'onboarding.lottery', {}).code, 'rolled'); assert.equal(state.onboarding.step, 4);
  assert.match(act(state, 'onboarding.home', { house: 'ikoyi' }).reason ?? '', /Face-me-I-face-you \(Mushin\), Self-contain \(Yaba\), Mini-flat \(Lekki Phase 1\)/);
  assert.equal(state.onboarding.done, false); assert.equal(state.cash, 5000);
});

test('the birth lottery is rolled once, is deterministic, covers every outcome and survives a new life', () => {
  const base = createLife(null, at());
  act(base, 'onboarding.look', { look: LOOK }); act(base, 'onboarding.traits', { traits: ['hustler', 'foodie'] }); act(base, 'onboarding.dream', { dream: 'lekki-landlord' });
  const a = structuredClone(base), b = structuredClone(base);
  assert.equal(act(a, 'onboarding.lottery', {}, at(START, 'same')).code, 'rolled');
  act(b, 'onboarding.lottery', {}, at(START, 'same'));
  assert.deepEqual(a.onboarding.lottery, b.onboarding.lottery); assert.equal(need(a.onboarding.lottery).at, START);
  const first = need(a.onboarding.lottery).id;
  for (let i = 0; i < 20; i++) assert.equal(act(a, 'onboarding.lottery', {}, at(START + i, `again-${i}`)).code, 'already_rolled');
  assert.equal(need(a.onboarding.lottery).id, first);

  const tally: Record<string, number> = {};
  for (let i = 0; i < 2000; i++) { const trial = structuredClone(base); act(trial, 'onboarding.lottery', {}, at(START + i * 977, `spread-${i}`)); tally[need(trial.onboarding.lottery).id] = (tally[need(trial.onboarding.lottery).id] ?? 0) + 1; }
  for (const outcome of Object.values(LOTTERY)) {
    const share = (tally[outcome.id] ?? 0) / 20;
    assert.ok(Math.abs(share - outcome.odds) < 5, `${outcome.id}: ${share}% rolled against ${outcome.odds}% odds`);
  }
  // The same action id at a different server time gives an independent roll, so an id cannot be chosen in advance.
  const byTime = new Set(Array.from({ length: 40 }, (_, i) => { const trial = structuredClone(base); act(trial, 'onboarding.lottery', {}, at(START + i, 'fixed-id')); return need(trial.onboarding.lottery).id; }));
  assert.ok(byTime.size > 1);

  // New life: seeding the replacement with the old roll keeps it; everything else starts over.
  const done = started({ outcome: 'ajebutter', house: 'lekki' });
  const reborn = createLife({ name: 'Ada', onboarding: { ...done.onboarding }, goals: done.goals, cash: 999999 }, { ...at(), isNew: true });
  assert.deepEqual(reborn.onboarding.lottery, done.onboarding.lottery);
  assert.equal(reborn.onboarding.done, false); assert.equal(reborn.onboarding.step, 0); assert.deepEqual(reborn.onboarding.traits, []); assert.equal(reborn.onboarding.house, null);
  act(reborn, 'onboarding.look', { look: LOOK }); act(reborn, 'onboarding.traits', { traits: ['musical', 'gym-rat'] }); act(reborn, 'onboarding.dream', { dream: 'afrobeats-star' });
  assert.equal(act(reborn, 'onboarding.lottery', {}).code, 'already_rolled'); assert.equal(need(reborn.onboarding.lottery).id, 'ajebutter');
  assert.equal(createLife({ onboarding: { lottery: { id: 'jackpot', at: 1 } } }, { ...at(), isNew: true }).onboarding.lottery, null);
});

test('moving in: LAPO Baby exactly as observed, life.started once, start cash through the ledger', () => {
  const heard: unknown[] = [];
  const probe = systems().find(system => system.id === 'onboarding');
  assert.ok(probe?.modifiers?.['skills.xpRate']);
  const state = createLife(null, at());
  act(state, 'onboarding.look', { look: LOOK }); act(state, 'onboarding.traits', { traits: ['clean-pikin', 'musical'] }); act(state, 'onboarding.dream', { dream: 'yaba-unicorn' });
  const rolled = rollTo(state, 'lapo-baby');
  const view = viewLife(rolled, at()).onboarding;
  assert.deepEqual(view.homes.map(home => [home.id, home.startCash, home.rent, home.tag, Boolean(home.locked)]),
    [['mushin', 76000, 2400, 'Hard start', false], ['yaba', 96000, 6000, 'Balanced', false], ['lekki', null, 17000, 'Big spender', true]]);
  assert.equal(need(view.lottery).bullets.length, 4);
  const locked = act(rolled, 'onboarding.home', { house: 'lekki' });
  assert.equal(locked.code, 'house_locked'); assert.match(locked.reason ?? '', /Locked for LAPO Baby/); assert.equal(rolled.onboarding.done, false); assert.equal(rolled.cash, 5000);

  // Listen the way another owner's system would: through the goals system's own reaction plus a wallet check.
  const mushin = structuredClone(rolled), yaba = structuredClone(rolled);
  assert.equal(act(mushin, 'onboarding.home', { house: 'mushin' }).code, 'life_started'); assert.equal(mushin.cash, 76000);
  const moving = act(yaba, 'onboarding.home', { house: 'yaba' }, at(START + 5000));
  assert.equal(moving.code, 'life_started');
  assert.equal(yaba.cash, 96000);
  assert.deepEqual(yaba.ledger.map(entry => [entry.amount, entry.reason, entry.balance]), [[91000, 'Start cash · Self-contain, Yaba (includes ₦60,000 LAPO loan)', 96000]]);
  assert.deepEqual(yaba.needs, START_NEEDS);
  const skills = viewLife(yaba, at()).skills;
  assert.equal(skills.hustle.level, 2); assert.ok(Object.entries(skills).every(([skill, info]) => skill === 'hustle' || info.level === 0));
  assert.equal(yaba.location, 'home'); assert.equal(yaba.onboarding.house, 'yaba'); assert.equal(yaba.onboarding.completedAt, START + 5000);
  assert.deepEqual(yaba.onboarding.wardrobe, { hair: ['low-cut', 'afro'], outfit: ['casual', 'hoodie'], fabric: ['plain', 'ankara'] });
  assert.equal(yaba.goals.started, true); assert.equal(yaba.goals.dream, 'yaba-unicorn'); assert.equal(yaba.goals.stats.debt, 72000);
  assert.equal(viewLife(yaba, at()).onboarding.mood.word, 'Happy');
  assert.equal(modifyLoose(yaba, 'skills.xpRate', 1, { skill: 'cooking' }, at()), 1.25, 'LAPO: every skill 25% faster');
  // Exactly once: a repeat is refused and nothing is paid again.
  const repeat = act(yaba, 'onboarding.home', { house: 'mushin' });
  assert.equal(repeat.code, 'already_onboarded'); assert.equal(yaba.cash, 96000); assert.equal(yaba.ledger.length, 1); assert.equal(yaba.onboarding.house, 'yaba');
  void heard;

  // A busy Sim cannot move in, and cash earned before finishing creation is kept on top of the grant.
  const busy = structuredClone(rolled);
  assert.equal(act(busy, 'travel', { id: 'library', mode: 'cab' }).code, 'started'); assert.equal(busy.cash, 4600);
  assert.equal(act(busy, 'onboarding.home', { house: 'yaba' }).code, 'busy');
  advanceLife(busy, 10, at(START + 10000));
  assert.equal(act(busy, 'onboarding.home', { house: 'yaba' }).code, 'life_started'); assert.equal(busy.cash, 4600 + 91000);
});

test('life.started carries the agreed payload and the other outcomes pay their own start cash', () => {
  const state = createLife(null, at());
  act(state, 'onboarding.look', { look: LOOK }); act(state, 'onboarding.traits', { traits: ['hustler', 'night-crawler'] }); act(state, 'onboarding.dream', { dream: 'lekki-landlord' });
  for (const outcome of Object.values(LOTTERY)) {
    for (const home of Object.values(START_HOMES)) {
      const life = rollTo(state, outcome.id);
      const result = act(life, 'onboarding.home', { house: home.id });
      if (outcome.locked[home.id]) { assert.equal(result.code, 'house_locked'); assert.match(result.reason ?? '', new RegExp(`Locked for ${outcome.label}`)); continue; }
      assert.equal(result.code, 'life_started');
      assert.equal(life.cash, outcome.startCash[home.id]);
      assert.equal(life.ledger.length, 1); assert.match(life.ledger[0]?.reason ?? '', /^Start cash · /);
      assert.equal(life.goals.stats.debt, outcome.loan?.owed ?? 0);
      for (const [skill, level] of Object.entries(outcome.skills)) assert.equal(need(viewLife(life, at()).skills[skill as SkillId]).level, level);
    }
  }
  // The event itself, seen by a listener registered the same way every system is.
  const seen: EngineEventMap['life.started'][] = [];
  const goals = need(systems().find(system => system.id === 'goals'));
  const goalsOn = need(goals.on);
  const original = need(goalsOn['life.started']);
  goalsOn['life.started'] = (s, data, c) => { seen.push(data); original(s, data, c); };
  try {
    const life = rollTo(state, 'lapo-baby');
    act(life, 'onboarding.home', { house: 'mushin' });
    act(life, 'onboarding.home', { house: 'mushin' });
    assert.equal(seen.length, 1);
    const { body, traits, dream, lottery, house, look, loan, rent, startCash } = need(seen[0]);
    assert.deepEqual({ body, traits, dream, lottery, house }, { body: 'man', traits: ['hustler', 'night-crawler'], dream: 'lekki-landlord', lottery: 'lapo-baby', house: 'mushin' });
    assert.deepEqual(look, LOOK); assert.deepEqual(loan, { principal: 60000, weekly: 12000, owed: 72000 }); assert.equal(rent, 2400); assert.equal(startCash, 76000);
  } finally { goalsOn['life.started'] = original; }
});

test('traits and lottery outcomes change play through the modifier keys', () => {
  const day = at(Date.UTC(2026, 0, 5, 11)), night = at(Date.UTC(2026, 0, 5, 22)); // noon and 11 PM in Lagos
  const plain = createLife({ cash: 100 }, ctx);
  for (const key of ['needs.decayRate', 'skills.xpRate', 'travel.fare', 'shop.price', 'social.gain', 'career.performance'] as const) assert.equal(modifyLoose(plain, key, 1, {}, day), 1, key);
  const unfinished = createLife(null, at());
  act(unfinished, 'onboarding.look', { look: LOOK }); act(unfinished, 'onboarding.traits', { traits: ['hustler', 'clean-pikin'] });
  assert.equal(modifyLoose(unfinished, 'skills.xpRate', 1, { skill: 'hustle' }, day), 1, 'traits do nothing until the life has moved in');

  const near = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} ≠ ${expected}`);
  const a = started({ outcome: 'civil-servant', traits: ['hustler', 'lazy-bone'] });
  near(modifyLoose(a, 'skills.xpRate', 1, { skill: 'hustle' }, day), 1.25, 'hustler hustle xp');
  near(modifyLoose(a, 'skills.xpRate', 1, { skill: 'music' }, day), 1, 'hustler other xp');
  near(modifyLoose(a, 'career.performance', 10, {}, day), 10 * 1.15 * 0.9, 'hustler × lazy bone performance');
  assert.equal(modifyLoose(a, 'career.performance', -10, {}, day), -10, 'a penalty is not multiplied');
  near(modifyLoose(a, 'needs.decayRate', 1, { need: 'energy' }, day), 0.8, 'lazy bone energy');
  near(modifyLoose(a, 'needs.decayRate', 1, { need: 'hunger' }, day), 1, 'lazy bone hunger');

  const b = started({ outcome: 'lapo-baby', traits: ['smooth-talker', 'night-crawler'] });
  near(modifyLoose(b, 'skills.xpRate', 1, { skill: 'charisma' }, day), 1.25 * 1.25, 'smooth talker × LAPO');
  near(modifyLoose(b, 'social.gain', 12, {}, day), 13.8, 'smooth talker social gain');
  near(modifyLoose(b, 'needs.decayRate', 1, { need: 'energy' }, day), 1, 'night crawler by day');
  near(modifyLoose(b, 'needs.decayRate', 1, { need: 'energy' }, night), 0.75, 'night crawler by night');
  near(modifyLoose(b, 'activity.cost', 1000, { def: { tags: ['nightlife'] } }, day), 900, 'night crawler nightlife price');
  near(modifyLoose(b, 'activity.cost', 1000, { def: { tags: ['food'] } }, day), 1000, 'other prices unchanged');
  assert.equal(modifyLoose(b, 'activity.cost', 1000, undefined, day), 1000, 'missing data is tolerated');

  const c = started({ outcome: 'ajebutter', house: 'lekki', traits: ['owambe-spirit', 'clean-pikin'] });
  near(modifyLoose(c, 'needs.decayRate', 1, { need: 'fun' }, day), 1.15 * 1.15, 'owambe × ajebutter fun decay');
  near(modifyLoose(c, 'needs.decayRate', 1, { need: 'hygiene' }, day), 0.75, 'clean pikin');
  near(modifyLoose(c, 'skills.xpRate', 1, { skill: 'dance' }, day), 1.25 * 0.9, 'owambe dance × ajebutter');
  const d = started({ outcome: 'street-smart', house: 'mushin', traits: ['tech-bro-or-sis', 'musical'] });
  near(modifyLoose(d, 'needs.decayRate', 1, { need: 'hunger' }, day), 0.85, 'street smart hunger');
  near(modifyLoose(d, 'skills.xpRate', 1, { skill: 'coding' }, day), 1.25, 'tech'); near(modifyLoose(d, 'skills.xpRate', 1, { skill: 'music' }, day), 1.25, 'musical');

  // The decay modifier really slows the needs system down: same hour, slower hygiene loss.
  const slow = started({ outcome: 'civil-servant', traits: ['clean-pikin', 'musical'] }), normal = started({ outcome: 'civil-servant', traits: ['tech-bro-or-sis', 'musical'] });
  advanceLife(slow, 4 * 3600, at(START + 4 * 3600000)); advanceLife(normal, 4 * 3600, at(START + 4 * 3600000));
  assert.equal(START_NEEDS.hygiene - normal.needs.hygiene, 12); assert.equal(START_NEEDS.hygiene - slow.needs.hygiene, 9);

  // Completion bonuses: a Foodie enjoys a meal, once per meal even if both events fire.
  const foodie = started({ outcome: 'civil-servant', traits: ['foodie', 'gym-rat'] });
  const fun = foodie.needs.fun, when = at(START + 60000);
  emitLoose(foodie, 'activity.completed', { id: 'x', def: {}, tags: ['food'], choice: null }, when); assert.equal(foodie.needs.fun, fun + 5);
  emitLoose(foodie, 'meal.eaten', { id: 'x', source: 'stove' }, when); assert.equal(foodie.needs.fun, fun + 5, 'the same meal is not counted twice');
  emitLoose(foodie, 'meal.eaten', { id: 'y', source: 'cooler' }, at(START + 120000)); assert.equal(foodie.needs.fun, fun + 10);
  emitLoose(foodie, 'activity.completed', { id: 'gym', def: {}, tags: ['workout'], choice: null }, at(START + 180000)); assert.equal(foodie.needs.fun, fun + 16);
  emitLoose(foodie, 'activity.completed', { id: 'walk', def: {}, tags: [], choice: null }, at(START + 240000)); assert.equal(foodie.needs.fun, fun + 16);
});

test('starter goals pay the observed rewards from events, once each, with a ledger line and a toast', () => {
  // The three opening goals belong to the quick start (a guest plays them in public, before there is a home);
  // a life that was never a guest starts at the first home goal, with the observed rewards unchanged.
  assert.equal(STARTER_INTRO, 3);
  assert.deepEqual(STARTER_GOALS.slice(0, STARTER_INTRO).map(goal => [goal.id, goal.cash, goal.stars, goal.beta]), [['first-fun', 500, 1, true], ['say-hello', 500, 1, true], ['settle-in', 1000, 1, true]]);
  assert.deepEqual(STARTER_GOALS.slice(STARTER_INTRO).map(goal => [goal.title, goal.hint, goal.cash, goal.stars]), [
    ['Eat something', 'Tap the cooler or stove', 500, 1], ['Freshen up', 'Tap the bucket or shower', 500, 1], ['Get a job', 'Open Phone → Jobs', 1000, 1],
    ['Buy something new', 'Open Buy and place an item', 1000, 1], ['Visit the buka', 'Open Map → Amala Shitta', 1500, 1], ['Make a new friend', 'Tap someone at a venue', 1500, 1],
    ['Work a shift', 'Leave for work on time', 2000, 1]]);
  assert.deepEqual(STARTER_GOALS.filter(goal => goal.betaFields).map(goal => goal.id), ['visit-buka', 'work-a-shift']);

  const state = started();
  const chip = (): ChipFields => viewLife(state, at()).goals.chip;
  assert.deepEqual([chip().kind, chip().title, chip().hint, chip().reward], ['goal', 'Eat something', 'Tap the cooler or stove', '+₦500 +1✨']);
  assert.deepEqual(chip().go, ['home', 'kitchen']);

  // 1: a real meal at home. Cancelling pays nothing; completing pays once.
  assert.equal(act(state, 'activity', { id: 'garri' }).code, 'started');
  act(state, 'cancel'); assert.equal(state.goals.chain, STARTER_INTRO); assert.equal(state.cash, 96000);
  act(state, 'activity', { id: 'garri' }); advanceLife(state, 5, at(START + 5000));
  assert.equal(state.cash, 96500); assert.equal(state.goals.stars, 1); assert.equal(state.goals.chain, STARTER_INTRO + 1);
  assert.deepEqual([need(state.ledger.at(-1)).amount, need(state.ledger.at(-1)).reason], [500, 'Goal: Eat something']);
  assert.equal(need(state.goals.feed.at(-1)).text, 'Goal complete: Eat something · +₦500 +1✨');
  act(state, 'activity', { id: 'garri' }); advanceLife(state, 5, at(START + 10000));
  assert.equal(state.cash, 96500, 'eating again pays nothing'); assert.equal(chip().title, 'Freshen up');

  // 2: a real bath.
  act(state, 'spot', { id: 'bathroom' }); act(state, 'activity', { id: 'bath' }); advanceLife(state, 6, at(START + 16000));
  assert.equal(state.cash, 97000); assert.equal(state.needs.hygiene, 100); assert.equal(viewLife(state, at()).onboarding.mood.word, 'Very Happy');
  assert.equal(need(state.goals.feed.at(-1)).text, 'Goal complete: Freshen up · +₦500 +1✨');
  // 3: applying for a job (the real career action).
  assert.equal(chip().open, 'jobs');
  act(state, 'apply-job', { id: 'community-helper' }); assert.equal(state.cash, 98000); assert.equal(state.goals.stars, 3);
  // 4–6: events other owners emit.
  assert.equal(chip().title, 'Buy something new');
  emitLoose(state, 'item.bought', { id: 'plastic-chair', price: 500 }, at()); assert.equal(state.cash, 99000); assert.equal(state.goals.stats.assets, 500);
  assert.deepEqual([chip().title, chip().open, chip().params], ['Visit the buka', 'map', { destination: 'amala-shitta' }]);
  emitLoose(state, 'travel.arrived', { venue: 'library', mode: 'danfo' }, at()); assert.equal(state.cash, 99000);
  emitLoose(state, 'travel.arrived', { venue: 'amala-shitta', mode: 'danfo' }, at()); assert.equal(state.cash, 100500);
  emitLoose(state, 'venue.visited', { venue: 'amala-shitta' }, at()); assert.equal(state.cash, 100500, 'arriving and visiting are one goal');
  emitLoose(state, 'npc.greeted', { npc: 'amaka' }, at()); assert.equal(state.cash, 102000);
  emitLoose(state, 'friend.made', { id: 'f1', npc: 'amaka' }, at()); assert.equal(state.cash, 102000);
  assert.equal(state.goals.stars, 6, 'six goals, six stars'); assert.equal(chip().title, 'Work a shift');
  assert.deepEqual(chip().go, ['park', 'work']);
  // 7: a shift.
  emitLoose(state, 'shift.completed', { job: 'community-helper', pay: 300, level: 1 }, at());
  assert.equal(state.cash, 104000); assert.equal(state.goals.chain, STARTER_GOALS.length);
  assert.equal(need(state.goals.feed.at(-1)).text, 'Goal complete: Work a shift · +₦2,000 +1✨');
  const paid = state.ledger.filter(entry => entry.reason.startsWith('Goal: '));
  assert.deepEqual(paid.map(entry => entry.amount), [500, 500, 1000, 1000, 1500, 1500, 2000]);
  // Replaying every trigger after the chain pays nothing more.
  const replays: [string, object][] = [['meal.eaten', {}], ['job.applied', { job: 'x' }], ['item.bought', { id: 'y', price: 1 }], ['travel.arrived', { venue: 'amala-shitta' }], ['npc.greeted', {}], ['shift.completed', {}]];
  for (const [event, data] of replays) emitLoose(state, event, data, at());
  assert.equal(state.ledger.filter(entry => entry.reason.startsWith('Goal: ')).length, 7);
  assert.equal(viewLife(state, at()).goals.chain.finished, true);
  assert.deepEqual(createLife(structuredClone(state), at()), state);
});

test('goals done early are paid as the chain reaches them; unknown events and bad data are harmless', () => {
  const state = started();
  // Applied for a job and made a friend before eating anything.
  act(state, 'apply-job', { id: 'community-helper' }); emitLoose(state, 'friend.made', { id: 'f1', npc: 'tunde' }, at());
  assert.equal(state.goals.chain, STARTER_INTRO); assert.equal(state.cash, 96000); assert.deepEqual(state.goals.seen, ['get-a-job']);
  emitLoose(state, 'meal.eaten', { id: 'garri', source: 'cooler' }, at());
  assert.equal(state.goals.chain, STARTER_INTRO + 1); assert.equal(state.cash, 96500);
  emitLoose(state, 'activity.completed', { id: 'bath', def: {}, tags: ['hygiene'], choice: null }, at());
  assert.equal(state.goals.chain, STARTER_INTRO + 3, 'the job goal pays straight after, because the Sim is already employed'); assert.equal(state.cash, 98000);
  emitLoose(state, 'item.bought', { id: 'chair', price: 500 }, at()); emitLoose(state, 'venue.visited', { venue: 'amala-shitta' }, at());
  // "Make a new friend" counts only once it is the current goal (the hello of the quick start must not pay it too).
  assert.equal(state.goals.chain, STARTER_INTRO + 5, 'the friend made before the goal came up does not count'); assert.equal(state.cash, 100500);
  emitLoose(state, 'friend.made', { id: 'f2', npc: 'amaka' }, at());
  assert.equal(state.goals.chain, STARTER_INTRO + 6); assert.equal(state.cash, 102000); assert.equal(state.goals.stars, 6);
  assert.deepEqual(state.goals.seen, []);
  for (const event of ['house.moved', 'car.bought', 'rent.paid', 'loan.paid', 'promotion', 'skill.levelup', 'wallet.changed', 'made.up']) {
    for (const data of [undefined, null, 5, 'x', { amount: 'lots', level: -3, left: NaN, venue: 7, price: 1e400 }]) emitLoose(state, event, data, at());
  }
  assert.equal(state.cash, 102000); assert.deepEqual(createLife(structuredClone(state), at()), state);
});

test('after the chain the chip is a rolling next step that is always attainable', () => {
  const state = started();
  state.goals.chain = STARTER_GOALS.length;
  const chip = (): ChipFields => viewLife(state, at()).goals.chip;
  assert.deepEqual([chip().kind, chip().title, chip().open], ['guide', 'Find a job', 'jobs']);
  act(state, 'apply-job', { id: 'community-helper' });
  assert.equal(chip().title, 'Make ₦15,000 today'); assert.match(chip().hint, /\+3✨/);
  state.goals.stars = 6;
  assert.deepEqual([chip().title, chip().open], ['Spend your stars', 'goals']); assert.match(chip().hint, /Steel Bladder costs 6✨/);
  state.needs.energy = 12; state.needs.hunger = 20;
  assert.deepEqual([chip().title, chip().hint, chip().go], ['Get some rest', 'Home → Bedroom → Sleep', ['home', 'bedroom']]);
  state.needs.energy = 90;
  assert.deepEqual([chip().title, chip().go], ['Eat something', ['home', 'kitchen']]);
  state.needs.hunger = 90; state.needs.social = 5;
  // The city's regulars can be greeted for free, and Say Hello raises Social the most, so the guide points at a person.
  assert.deepEqual([chip().title, chip().hint, chip().go], ['Talk to someone', 'Freedom Park → People → Say Hello · Kunle', ['park', 'people']]);
});

test('wishes: three active, +3 stars each, replaced when granted, re-rolls limited per day with a reason', () => {
  assert.deepEqual(WISHES.slice(0, 3).map(wish => wish.label), ['Make ₦15,000 today', 'See art at Freedom Park', 'See a movie at The Palms']);
  assert.ok(WISHES.slice(0, 3).every(wish => !wish.beta) && WISHES.slice(3).every(wish => wish.beta === true));
  const state = started();
  const wishes = () => viewLife(state, at()).goals.wishes;
  assert.equal(wishes().length, 3); assert.ok(wishes().every(wish => wish.stars === 3));
  // Every venue is on the map now, so a new life starts with the three observed wishes.
  assert.deepEqual(state.goals.wishes.map(wish => wish.id), ['earn-15k', 'park-art', 'palms-movie']);

  // A real activity grants one: see the exhibition in the Freedom Park gallery (trek from Home, 18 s).
  state.goals.chain = STARTER_GOALS.length;
  act(state, 'travel', { id: 'park', mode: 'trek' }, at(START)); advanceLife(state, 18, at(START + 18000));
  assert.equal(state.location, 'park');
  act(state, 'spot', { id: 'art' }); assert.equal(act(state, 'activity', { id: 'see-art' }, at(START + 18000)).code, 'started'); advanceLife(state, 10, at(START + 28000));
  assert.equal(state.goals.stars, 3); assert.equal(state.goals.granted, 1); assert.equal(need(state.goals.feed.at(-1)).text, 'Wish granted: See art at Freedom Park · +3✨');
  assert.equal(wishes().length, 3); assert.ok(!state.goals.wishes.some(wish => wish.id === 'park-art'), 'a granted wish is replaced by a different one');
  assert.equal(new Set(state.goals.wishes.map(wish => wish.id)).size, 3);

  // Counted wishes and the daily earnings wish.
  state.goals.wishes = [{ id: 'earn-15k', n: 0, day: 0 }, { id: 'greet-three', n: 0, day: 0 }, { id: 'work-shift', n: 0, day: 0 }];
  emitLoose(state, 'npc.greeted', { npc: 'a' }, at()); emitLoose(state, 'npc.greeted', { npc: 'b' }, at());
  assert.equal(need(wishes().find(wish => wish.id === 'greet-three')).progress, 2); assert.equal(state.goals.stars, 3);
  emitLoose(state, 'npc.greeted', { npc: 'c' }, at()); assert.equal(state.goals.stars, 6);
  const cash = state.cash;
  emitLoose(state, 'wallet.changed', { amount: 9000, reason: 'Shift', balance: 1 }, at(START));
  emitLoose(state, 'wallet.changed', { amount: -500, reason: 'Fare', balance: 1 }, at(START));
  emitLoose(state, 'wallet.changed', { amount: 20000, reason: 'Refund: Meal', balance: 1 }, at(START));
  assert.equal(need(wishes().find(wish => wish.id === 'earn-15k')).progress, 9000);
  emitLoose(state, 'wallet.changed', { amount: 5000, reason: 'Shift', balance: 1 }, at(START + 86400000));
  assert.equal(need(state.goals.wishes.find(wish => wish.id === 'earn-15k')).n, 5000, 'yesterday’s earnings do not count towards today');
  emitLoose(state, 'wallet.changed', { amount: 10000, reason: 'Shift', balance: 1 }, at(START + 86400000));
  assert.equal(state.goals.stars, 9); assert.equal(state.cash, cash, 'wishes pay stars, not cash');

  // Re-rolls.
  const before = state.goals.wishes[0]?.id;
  const rolled = act(state, 'goals.reroll-wish', { slot: 0 }, at(START));
  assert.equal(rolled.code, 'rerolled'); assert.notEqual(state.goals.wishes[0]?.id, before); assert.equal(new Set(state.goals.wishes.map(wish => wish.id)).size, 3);
  for (let i = 1; i < WISH_REROLLS_PER_DAY; i++) assert.equal(act(state, 'goals.reroll-wish', { slot: i % 3 }, at(START)).code, 'rerolled');
  const spent = act(state, 'goals.reroll-wish', { slot: 0 }, at(START));
  assert.equal(spent.code, 'no_rerolls'); assert.match(spent.reason ?? '', /all 3 wish re-rolls for today.*midnight/);
  assert.match(need(viewLife(state, at(START)).goals.rerolls.blocked), /No re-rolls left today/);
  assert.equal(viewLife(state, at(START + 86400000)).goals.rerolls.left, 3);
  assert.equal(act(state, 'goals.reroll-wish', { slot: 0 }, at(START + 86400000)).code, 'rerolled');
  for (const slot of [-1, 3, 1.5, '0', undefined]) assert.equal(act(state, 'goals.reroll-wish', { slot }, at(START + 86400000)).code, 'invalid_wish');
  assert.deepEqual(createLife(structuredClone(state), at()), state);
});

test('perks: the eight observed ones, original ones up to 25 stars, bought once with stars and applied as modifiers', () => {
  assert.deepEqual(PERKS.slice(0, 8).map(perk => [perk.label, perk.cost]), [['Steel Bladder', 6], ['Iron Belle', 8], ['Early Bird', 8], ['Never Dull', 8], ['Sweet Mouth', 10], ['Connected', 10], ['Hustle Juice', 12], ['Fast Learner', 14]]);
  assert.ok(PERKS.slice(0, 8).every(perk => !perk.beta) && PERKS.slice(8).every(perk => perk.beta === true));
  assert.equal(Math.max(...PERKS.map(perk => perk.cost)), 25); assert.equal(Math.min(...PERKS.map(perk => perk.cost)), 6);
  assert.equal(new Set(PERKS.map(perk => perk.id)).size, PERKS.length);

  const state = started({ outcome: 'civil-servant', traits: ['musical', 'tech-bro-or-sis'] });
  const poor = act(state, 'goals.buy-perk', { id: 'steel-bladder' });
  assert.equal(poor.code, 'insufficient_stars'); assert.match(poor.reason ?? '', /Steel Bladder costs 6✨; you have 0✨/);
  assert.match(need(need(viewLife(state, at()).goals.perks[0]).blocked), /Needs 6✨ — you have 0✨ \(6 more\)/);
  assert.equal(act(state, 'goals.buy-perk', { id: 'free-money' }).code, 'invalid_perk'); assert.equal(act(state, 'goals.buy-perk', {}).code, 'invalid_perk');

  state.goals.stars = PERKS.reduce((sum, perk) => sum + perk.cost, 0);
  const day = at(Date.UTC(2026, 0, 5, 11)), night = at(Date.UTC(2026, 0, 5, 23));
  const near = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} ≠ ${expected}`);
  const buy = (id: string) => assert.equal(act(state, 'goals.buy-perk', { id }).code, 'perk_bought', id);
  buy('steel-bladder'); near(modifyLoose(state, 'needs.decayRate', 1, { need: 'bladder' }, day), 0.7, 'steel bladder');
  assert.equal(act(state, 'goals.buy-perk', { id: 'steel-bladder' }).code, 'already_owned');
  buy('iron-belle'); near(modifyLoose(state, 'needs.decayRate', 1, { need: 'hunger' }, day), 0.75, 'iron belle');
  buy('early-bird'); near(modifyLoose(state, 'needs.decayRate', 1, { need: 'energy' }, day), 0.75, 'early bird');
  buy('never-dull'); near(modifyLoose(state, 'needs.decayRate', 1, { need: 'fun' }, day), 0.75, 'never dull');
  buy('sweet-mouth'); near(modifyLoose(state, 'social.gain', 100, {}, day), 115, 'sweet mouth');
  buy('connected'); near(modifyLoose(state, 'shop.price', 500, { item: {}, kind: 'furniture' }, day), 450, 'connected: furniture');
  near(modifyLoose(state, 'shop.price', 600, { item: {}, kind: 'grocery' }, day), 540, 'connected: groceries');
  near(modifyLoose(state, 'shop.price', 350000, { item: {}, kind: 'car' }, day), 350000, 'connected never discounts a car');
  near(modifyLoose(state, 'shop.price', 500, { item: {} }, day), 500, 'no discount without a known purchase kind');
  buy('hustle-juice'); near(modifyLoose(state, 'career.performance', 4, {}, day), 5, 'hustle juice');
  buy('fast-learner'); near(modifyLoose(state, 'skills.xpRate', 1, { skill: 'dance' }, day), 1.2, 'fast learner');
  near(modifyLoose(state, 'skills.xpRate', 1, { skill: 'music' }, day), 1.2 * 1.25, 'fast learner stacks with a trait');
  buy('area-sabi'); near(modifyLoose(state, 'travel.fare', 400, { mode: 'cab', destination: 'library' }, day), 320, 'area sabi');
  buy('buka-regular'); near(modifyLoose(state, 'activity.cost', 550, { def: { tags: ['food'] } }, day), 495, 'buka regular');
  buy('ogas-favourite'); near(modifyLoose(state, 'activity.reward', 300, { def: { tags: ['work'] } }, day), 330, 'oga’s favourite');
  near(modifyLoose(state, 'activity.reward', 300, { def: { tags: ['fun'] } }, day), 300, 'only work pays more');
  buy('second-wind'); near(modifyLoose(state, 'needs.decayRate', 1, { need: 'energy' }, night), 0.75 * 0.7, 'second wind at night');
  buy('stay-fresh'); buy('people-person'); buy('odogwu');
  near(modifyLoose(state, 'needs.decayRate', 1, { need: 'hygiene' }, day), 0.75 * 0.85, 'stay fresh × odogwu');
  near(modifyLoose(state, 'needs.decayRate', 1, { need: 'social' }, day), 0.75 * 0.85, 'people person × odogwu');
  buy('lucky-star');
  assert.equal(state.goals.stars, 0); assert.equal(state.goals.perks.length, PERKS.length);
  assert.ok(viewLife(state, at()).goals.perks.every(perk => perk.owned && perk.blocked === 'Owned'));
  // Real effects: the cab to the library is 20% cheaper and a wish gives 4 stars.
  // Home (Yaba) → The Library crosses the lagoon, so the cab is the ₦550 far-band fare before the discount.
  act(state, 'travel', { id: 'library', mode: 'cab' }); assert.equal(need(state.ledger.at(-1)).amount, -440);
  state.goals.wishes = [{ id: 'new-item', n: 0, day: 0 }, { id: 'earn-15k', n: 0, day: 0 }, { id: 'work-shift', n: 0, day: 0 }];
  emitLoose(state, 'item.bought', { id: 'x', price: 100 }, at()); assert.equal(state.goals.stars, 4);
  assert.deepEqual(createLife(structuredClone(state), at()), state);
});

test('the lifetime dream has measurable progress and pays its reward once', () => {
  const percent = (state: LifeState) => need(viewLife(state, at()).goals.dream).percent;
  const oga = started({ outcome: 'civil-servant', dream: 'oga-at-the-top' });
  assert.equal(percent(oga), 0);
  // The career system reports the ladder size (maxLevel) with every shift and promotion.
  emitLoose(oga, 'shift.completed', { job: 'tech', pay: 3600, level: 1, maxLevel: 6 }, at()); assert.equal(percent(oga), 16);
  emitLoose(oga, 'promotion', { job: 'tech', level: 3, role: 'Developer', maxLevel: 6, top: false }, at()); assert.equal(percent(oga), 50);
  assert.equal(oga.goals.dreamDone, false);
  emitLoose(oga, 'promotion', { job: 'tech', level: 6, role: 'CTO', maxLevel: 6, top: true }, at());
  assert.equal(percent(oga), 100); assert.equal(oga.goals.dreamDone, true);
  assert.equal(need(oga.goals.feed.at(-1)).text, `Dream achieved: Oga at the Top · +₦50,000 +${DREAM_REWARD.stars}✨`);
  const cash = oga.cash, stars = oga.goals.stars;
  emitLoose(oga, 'promotion', { job: 'tech', level: 6, role: 'CTO', maxLevel: 6, top: true }, at()); advanceLife(oga, 60, at(START + 60000));
  assert.equal(oga.cash, cash); assert.equal(oga.goals.stars, stars); assert.equal(oga.ledger.filter(entry => entry.reason.startsWith('Dream achieved')).length, 1);

  const landlord = started({ outcome: 'lapo-baby', dream: 'lekki-landlord' });
  assert.equal(percent(landlord), 2, '(96,000 cash − 72,000 owed) of 1,000,000');
  emitLoose(landlord, 'loan.paid', { amount: 12000, left: 60000 }, at()); assert.equal(percent(landlord), 3);
  emitLoose(landlord, 'item.bought', { id: 'sofa', price: 464000 }, at()); assert.equal(landlord.goals.stats.assets, 464000);
  assert.equal(percent(landlord), 50, 'cash 97,000 after the buy-goal? no: goal 4 is not current, so 96,000 + 464,000 − 60,000');

  const star = started({ outcome: 'civil-servant', dream: 'afrobeats-star' });
  star.skills.music = 300; assert.equal(percent(star), 20);
  star.skills.music = 450; assert.equal(percent(star), 25);
  star.skills.music = 5500; advanceLife(star, 1, at(START + 1000)); assert.equal(star.goals.dreamDone, true);

  const padi = started({ outcome: 'civil-servant', dream: 'everybodys-padi' });
  for (let i = 0; i < 6; i++) emitLoose(padi, 'friend.made', { id: `f${i}`, npc: `n${i}` }, at());
  assert.equal(percent(padi), 50, 'friends beyond four add nothing');
  for (let i = 0; i < 3; i++) emitLoose(padi, 'friend.best', { id: `f${i}`, npc: `n${i}` }, at());
  assert.equal(percent(padi), 87); assert.equal(padi.goals.dreamDone, false);
  // The same best friend reported again, in either shape, is not counted twice.
  emitLoose(padi, 'friend.best', { id: 'f2', npc: 'n2' }, at()); assert.equal(padi.goals.stats.best, 3);
  emitLoose(padi, 'friend.best', { id: 'f3', npc: 'n3' }, at()); assert.equal(padi.goals.dreamDone, true);
  // Both shapes the social system may use are understood: friend.made { best: true } and friend.best.
  const both = started({ outcome: 'civil-servant', dream: 'everybodys-padi' });
  emitLoose(both, 'friend.made', { id: 'amaka', best: true }, at()); emitLoose(both, 'friend.best', { id: 'amaka' }, at());
  assert.deepEqual([both.goals.stats.friends, both.goals.stats.best, both.goals.besties], [1, 1, ['amaka']]);
  emitLoose(both, 'friend.best', { id: 'tunde' }, at()); emitLoose(both, 'friend.made', { best: true }, at());
  assert.deepEqual([both.goals.stats.friends, both.goals.stats.best], [2, 3]);
  assert.deepEqual(createLife(structuredClone(both), at()), both);

  const unicorn = started({ outcome: 'lapo-baby', dream: 'yaba-unicorn' });
  assert.equal(percent(unicorn), 8, 'Hustle 2 of 5 is 8%');
  emitLoose(unicorn, 'travel.arrived', { venue: 'cchub', mode: 'danfo' }, at()); assert.equal(percent(unicorn), 13);
  unicorn.skills.coding = 3600; unicorn.skills.hustle = 1500; assert.equal(percent(unicorn), 85);
  const before = unicorn.cash;
  emitLoose(unicorn, 'activity.completed', { id: 'dream-startup-pitch', def: {}, tags: ['startup-pitch'], choice: null }, at());
  assert.equal(unicorn.goals.stats.funded, true); assert.equal(unicorn.goals.dreamDone, true);
  assert.equal(unicorn.cash, before + DREAM_TARGETS.funding + DREAM_REWARD.cash);
  emitLoose(unicorn, 'activity.completed', { id: 'dream-startup-pitch', def: {}, tags: ['startup-pitch'], choice: null }, at());
  assert.equal(unicorn.cash, before + DREAM_TARGETS.funding + DREAM_REWARD.cash, 'funding is paid once');
  const veto = modifyLoose(unicorn, 'activity.block', null, { def: { tags: ['startup-pitch'] } }, at());
  assert.equal(need(veto).code, 'already_funded'); assert.ok(need(veto).reason);
  const novice = started({ outcome: 'civil-servant', dream: 'yaba-unicorn' });
  assert.match(need(modifyLoose(novice, 'activity.block', null, { def: { tags: ['startup-pitch'] } }, at())).reason ?? '', /Requires Hustle level 5 \(yours is 0\)/);
  assert.equal(modifyLoose(novice, 'activity.block', null, { def: { tags: ['food'] } }, at()), null);

  // A life from before dreams existed may pick one, once.
  const legacy = createLife({ cash: 2000 }, ctx);
  assert.equal(viewLife(legacy, ctx).goals.dream, null); assert.equal(viewLife(legacy, ctx).goals.dreams.length, 5);
  assert.equal(act(legacy, 'goals.set-dream', { dream: 'nope' }).code, 'invalid_dream');
  assert.equal(act(legacy, 'goals.set-dream', { dream: 'lekki-landlord' }).code, 'dream_saved');
  const twice = act(legacy, 'goals.set-dream', { dream: 'afrobeats-star' });
  assert.equal(twice.code, 'dream_already_chosen'); assert.match(twice.reason ?? '', /Lekki Landlord/);
  assert.equal(act(landlord, 'goals.set-dream', { dream: 'afrobeats-star' }).code, 'dream_already_chosen');
});

test('boutique and look editing: styles cost cash, colours are free, every refusal says why', () => {
  const state = started({ outcome: 'civil-servant', house: 'yaba', look: LOOK });
  const cash = state.cash;
  const shop = () => viewLife(state, at()).onboarding.boutique;
  assert.deepEqual(shop().filter(item => item.kind === 'hair').map(item => item.id), [...APPEARANCE.hair.man, ...APPEARANCE.extra.hair.man], 'the shop lists styles for the current body');
  assert.deepEqual(shop().filter(item => item.owned && item.kind !== 'accessories').map(item => item.id), ['low-cut', 'afro', 'casual', 'hoodie', 'plain', 'ankara']);
  const locs = act(state, 'onboarding.boutique-buy', { kind: 'hair', id: 'locs' });
  assert.equal(locs.code, 'bought'); assert.equal(state.cash, cash - need(BOUTIQUE_PRICES.hair.locs)); assert.equal(state.onboarding.look.hair, 'locs');
  assert.deepEqual([need(state.ledger.at(-1)).amount, need(state.ledger.at(-1)).reason], [-4500, 'Boutique: Locs hairstyle']);
  const again = act(state, 'onboarding.boutique-buy', { kind: 'hair', id: 'locs' });
  assert.equal(again.code, 'already_owned'); assert.match(again.reason ?? '', /already own Locs/); assert.equal(state.cash, cash - 4500);
  const gele = act(state, 'onboarding.boutique-buy', { kind: 'hair', id: 'gele' });
  assert.equal(gele.code, 'wrong_body'); assert.match(gele.reason ?? '', /not made for the man body/);
  for (const payload of [{}, { kind: 'shoes', id: 'locs' }, { kind: 'hair', id: 'mohawk' }, { kind: 'hair', id: 'constructor' }, { kind: 'constructor', id: 'x' }]) assert.equal(act(state, 'onboarding.boutique-buy', payload).code, 'invalid_item');

  // Switching back to an owned style and changing colours is free.
  assert.equal(act(state, 'onboarding.set-look', { look: { ...state.onboarding.look, hair: 'afro', hairColor: 'purple', skin: 'skin-2' } }).code, 'look_saved');
  assert.equal(state.cash, cash - 4500); assert.equal(state.onboarding.look.hairColor, 'purple');
  assert.equal(act(state, 'onboarding.set-look', { look: state.onboarding.look }).code, 'unchanged');
  const unowned = act(state, 'onboarding.set-look', { look: { ...state.onboarding.look, outfit: 'office' } });
  assert.equal(unowned.code, 'not_owned'); assert.match(unowned.reason ?? '', /do not own the Office outfit yet.*Boutique for ₦8,000/);
  assert.equal(act(state, 'onboarding.set-look', { look: { ...state.onboarding.look, hair: 'gele' } }).code, 'invalid_look');
  // Changing body keeps only what the new body can wear.
  assert.equal(act(state, 'onboarding.set-look', { look: { ...state.onboarding.look, body: 'woman', outfit: 'casual' } }).code, 'look_saved');
  assert.equal(act(state, 'onboarding.boutique-buy', { kind: 'hair', id: 'gele' }).code, 'bought');

  const broke = started({ outcome: 'street-smart', house: 'mushin' });
  broke.cash = 1000;
  const dear = act(broke, 'onboarding.boutique-buy', { kind: 'fabric', id: 'aso-oke' });
  assert.equal(dear.code, 'insufficient_funds'); assert.match(dear.reason ?? '', /Aso-oke costs ₦12,000; you have ₦1,000/); assert.equal(broke.cash, 1000);
  assert.match(need(need(viewLife(broke, at()).onboarding.boutique.find(item => item.id === 'aso-oke')).blocked), /Costs ₦12,000; you have ₦1,000/);
  assert.deepEqual(createLife(structuredClone(state), at()), state);
});

test('needs view: the five mood words with their thresholds, and feelings with signed modifiers and a line each', () => {
  const word = (needs: Record<string, number>, moodlets: unknown[] = []) => viewLife(createLife({ needs, moodlets }, ctx), ctx).onboarding.mood.word;
  const all = (value: number) => ({ hunger: value, energy: value, fun: value, social: value, hygiene: value, bladder: value });
  assert.equal(word({ hunger: 80, energy: 85, fun: 70, social: 60, hygiene: 75, bladder: 70 }), 'Happy');
  assert.equal(word({ hunger: 100, energy: 85, fun: 70, social: 60, hygiene: 100, bladder: 70 }), 'Very Happy');
  assert.deepEqual([78, 77, 62, 61, 45, 44, 25, 24].map(value => word(all(value))), ['Very Happy', 'Happy', 'Happy', 'Fine', 'Fine', 'Uneasy', 'Uneasy', 'Miserable']);
  assert.equal(word(all(70), [{ id: 'very-sick', label: 'Very Sick', value: -35, expiresAt: null }]), 'Uneasy');
  const feelings = viewLife(createLife({ needs: { ...all(60), energy: 12 }, moodlets: [{ id: 'party-jollof', label: 'Party Jollof', value: 6, expiresAt: null }] }, ctx), ctx).onboarding.feelings;
  assert.deepEqual(feelings.map(feeling => [feeling.label, feeling.value, feeling.line.length > 0]), [['Tired', -8, true], ['Party Jollof', 6, false]]);
});

test('server end to end: onboarding, goal rewards and perks are authoritative and idempotent', async t => {
  const f = await fixture(t); const a = await f.device('Ada');
  const first = await (await f.request('/api/life?city=lagos', null, a.cookie)).json();
  assert.equal(first.state.onboarding.done, false); assert.equal(first.state.cash, 5000);
  assert.equal((await f.action(a.cookie, { type: 'onboarding.look', payload: { look: LOOK } })).code, 'look_saved');
  assert.equal((await f.action(a.cookie, { type: 'onboarding.traits', payload: { traits: ['hustler'] } })).code, 'invalid_traits');
  assert.equal((await f.action(a.cookie, { type: 'onboarding.traits', payload: { traits: ['hustler', 'foodie'] } })).code, 'traits_saved');
  assert.equal((await f.action(a.cookie, { type: 'onboarding.dream', payload: { dream: 'lekki-landlord' } })).code, 'dream_saved');
  const roll = { actionId: `100000:${crypto.randomUUID()}`, type: 'onboarding.lottery', payload: {} };
  const rolled = await f.action(a.cookie, roll);
  assert.equal(rolled.code, 'rolled');
  const outcome = LOTTERY[rolled.state.onboarding.lottery.id as LotteryId];
  const replay = await f.action(a.cookie, roll);
  assert.equal(replay.duplicate, true); assert.deepEqual(replay.state.onboarding.lottery, rolled.state.onboarding.lottery);
  assert.equal((await f.action(a.cookie, { type: 'onboarding.lottery', payload: {} })).code, 'already_rolled');
  const move = { actionId: `100000:${crypto.randomUUID()}`, type: 'onboarding.home', payload: { house: 'yaba' } };
  const moved = await f.action(a.cookie, move);
  assert.equal(moved.code, 'life_started'); assert.equal(moved.state.cash, outcome.startCash.yaba); assert.equal(moved.state.location, 'home');
  const moveAgain = await f.action(a.cookie, move);
  assert.equal(moveAgain.duplicate, true); assert.equal(moveAgain.state.cash, outcome.startCash.yaba); assert.equal(moveAgain.state.ledger.length, 1);
  assert.equal((await f.action(a.cookie, { type: 'onboarding.home', payload: { house: 'mushin' } })).code, 'already_onboarded');
  // Goal 1 through the real activity, settled by server time; a reload neither loses nor repeats it.
  assert.equal((await f.action(a.cookie, { type: 'activity', id: 'garri' })).code, 'started'); f.advance(6000);
  const after = (await (await f.request('/api/life?city=lagos', null, a.cookie)).json()).state;
  assert.equal(after.cash, need(outcome.startCash.yaba) + 500); assert.equal(after.goals.stars, 1); assert.equal(after.goals.chain, STARTER_INTRO + 1);
  f.advance(60000);
  const later = (await (await f.request('/api/life?city=lagos', null, a.cookie)).json()).state;
  assert.equal(later.cash, need(outcome.startCash.yaba) + 500); assert.deepEqual(later.onboarding, after.onboarding);
  const perk = await f.action(a.cookie, { type: 'goals.buy-perk', payload: { id: 'steel-bladder' } });
  assert.equal(perk.ok, false); assert.equal(perk.code, 'insufficient_stars'); assert.match(perk.state.message, /costs 6✨; you have 1✨/);
  // Another device has its own life and its own onboarding.
  const b = await f.device('Bola');
  assert.equal((await (await f.request('/api/life?city=lagos', null, b.cookie)).json()).state.onboarding.done, false);
});
