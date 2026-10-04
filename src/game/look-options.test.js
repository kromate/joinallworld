// OWNER: character — the beta look options: extra hairstyles and outfits, accessories, face and expression.
// They are add-only: a look or a wardrobe that uses none of them is stored exactly as it always was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLife, dispatch, viewLife } from '../life.js';
import { makeContext } from './util.js';
import { checkLook } from './systems/onboarding.js';
import { APPEARANCE, BOUTIQUE_PRICES, ACCESSORY_BASICS, DEFAULT_LOOK } from './content/traits.js';
import { LOOK_OPTIONS, ACCESSORY_SLOTS, normalizeLook } from '../scene/characters.ts';

const START = Date.UTC(2026, 0, 5, 8);
let tick = 0;
const at = (now = START, seed = `look-${tick++}`) => makeContext({ now, cityId: 'lagos', seed });
const act = (state, type, payload, context = at()) => dispatch(state, { type, payload }, context);
const LOOK = { body: 'man', hair: 'afro', outfit: 'hoodie', fabric: 'ankara', skin: 'skin-6', hairColor: 'auburn', outfitColor: 'teal', bottomsColor: 'cream' };

function started(look = LOOK, house = 'yaba') {
  let state = createLife(null, at());
  assert.equal(act(state, 'onboarding.look', { look }).code, 'look_saved');
  act(state, 'onboarding.traits', { traits: ['hustler', 'foodie'] }); act(state, 'onboarding.dream', { dream: 'yaba-unicorn' });
  for (let i = 0; i < 500; i++) {
    const trial = structuredClone(state);
    act(trial, 'onboarding.lottery', {}, at(START + i, `look-roll-${i}`));
    if (trial.onboarding.lottery.id === 'civil-servant') { state = trial; break; }
  }
  assert.equal(act(state, 'onboarding.home', { house }).code, 'life_started');
  return state;
}

test('the beta options are add-only, priced, labelled and known to the scene', () => {
  const ids = (list) => list.map((item) => item.id);
  for (const body of ids(APPEARANCE.bodies)) {
    for (const [kind, base, extra] of [['hair', APPEARANCE.hair[body], APPEARANCE.extra.hair[body]], ['outfit', APPEARANCE.outfits[body], APPEARANCE.extra.outfits[body]]]) {
      assert.ok(extra.length >= 2, `${body} has at least two more ${kind} options`);
      assert.equal(new Set([...base, ...extra]).size, base.length + extra.length, 'no id is offered twice');
      for (const id of extra) {
        assert.ok(Number.isSafeInteger(BOUTIQUE_PRICES[kind][id]) && BOUTIQUE_PRICES[kind][id] > 0, `${id} has a price`);
        assert.ok(APPEARANCE.labels[id], `${id} has a label`);
        assert.ok(LOOK_OPTIONS[kind][body].includes(id.replace(/[^a-z0-9]/g, '')), `the scene can draw ${id}`);
      }
    }
  }
  assert.ok(APPEARANCE.accessories.length >= 9);
  for (const { id, slot } of APPEARANCE.accessories) {
    assert.ok(Number.isSafeInteger(BOUTIQUE_PRICES.accessories[id]) && APPEARANCE.labels[id], id);
    assert.equal(ACCESSORY_SLOTS[id], slot, `the scene agrees on the slot of ${id}`);
    assert.equal(BOUTIQUE_PRICES.accessories[id] === 0, ACCESSORY_BASICS.includes(id), `${id}: free exactly when it is a starter`);
    assert.equal(APPEARANCE.boutiqueOnly.accessories.includes(id), !ACCESSORY_BASICS.includes(id), `${id}: a starter or sold in the Boutique`);
  }
  assert.deepEqual([APPEARANCE.faces, APPEARANCE.expressions], [LOOK_OPTIONS.face, LOOK_OPTIONS.expression]);
  for (const [kind, list] of Object.entries(APPEARANCE.boutiqueOnly)) for (const id of list) assert.ok(BOUTIQUE_PRICES[kind][id] > 0, `${id} is for sale`);
});

test('a look without the optional fields is the eight fields it always was; with them, only what is set is stored', () => {
  assert.deepEqual(checkLook(LOOK).look, LOOK);
  assert.deepEqual(checkLook({ ...LOOK, accessories: [], face: 'oval', expression: 'smile' }).look, LOOK, 'defaults are not stored');
  assert.deepEqual(checkLook({ ...LOOK, accessories: null, face: null }).look, LOOK);
  assert.deepEqual(checkLook({ ...LOOK, accessories: ['glasses', 'cap'], face: 'round', expression: 'grin' }).look, { ...LOOK, accessories: ['glasses', 'cap'], face: 'round', expression: 'grin' });
  assert.deepEqual(checkLook(DEFAULT_LOOK).look, DEFAULT_LOOK);
  for (const [bad, why] of [
    [{ accessories: 'glasses' }, /must be a list/], [{ accessories: ['monocle'] }, /from the list: Glasses, Sunglasses/], [{ accessories: [7] }, /from the list/],
    [{ accessories: ['constructor'] }, /from the list/], [{ accessories: ['glasses', 'glasses'] }, /Glasses is listed twice/],
    [{ accessories: ['glasses', 'sunglasses'] }, /Glasses and Sunglasses cannot be worn together/], [{ accessories: ['cap', 'fila'] }, /cannot be worn together/],
    [{ accessories: ['glasses', 'cap', 'earrings', 'chain', 'watch', 'beads'] }, /at most 5 accessories/],
    [{ face: 'heart' }, /face shape: Oval, Round, Long/], [{ expression: 7 }, /expression: Smile, Calm, Grin/],
  ]) {
    const result = checkLook({ ...LOOK, ...bad });
    assert.equal(result.look, undefined, JSON.stringify(bad)); assert.match(result.reason, why);
  }
  assert.equal(checkLook({ ...LOOK, accessories: ['glasses', 'cap', 'earrings', 'chain', 'watch'] }).look.accessories.length, 5);
  assert.equal(checkLook({ ...LOOK, body: 'woman', hair: 'afro', outfit: 'agbada' }).look, undefined, 'the agbada is not offered for the woman body');
  assert.equal(checkLook({ ...LOOK, hair: 'bantu-knots' }).look, undefined);
});

test('character creation offers the free starters, refuses what the Boutique sells, and shuffles only what a new Sim may wear', () => {
  const state = createLife(null, at());
  for (const [extra, name] of [[{ hair: 'twists' }, 'Twists'], [{ outfit: 'agbada' }, 'Agbada'], [{ outfit: 'kaftan' }, 'Kaftan'], [{ accessories: ['sunglasses'] }, 'Sunglasses'], [{ accessories: ['glasses', 'backpack'] }, 'Backpack']]) {
    const refused = act(state, 'onboarding.look', { look: { ...LOOK, ...extra } });
    assert.equal(refused.code, 'invalid_look'); assert.match(refused.reason, new RegExp(`${name} is sold in the Boutique`));
  }
  assert.equal(state.onboarding.step, 0);
  for (let i = 0; i < 300; i++) {
    const trial = createLife(null, at());
    act(trial, 'onboarding.look', { shuffle: true }, at(START, `shuffle-${i}`));
    const look = trial.onboarding.look;
    assert.ok(!APPEARANCE.boutiqueOnly.hair.includes(look.hair) && !APPEARANCE.boutiqueOnly.outfit.includes(look.outfit), JSON.stringify(look));
    assert.equal(look.accessories, undefined);
    assert.equal(act(trial, 'onboarding.look', { look }).code, 'look_saved', 'a shuffled look can always be saved');
  }
  const free = { ...LOOK, hair: 'fade', outfit: 'jersey', accessories: ['glasses', 'cap', 'watch'], face: 'long' };
  assert.equal(act(state, 'onboarding.look', { look: free }).code, 'look_saved');
  assert.deepEqual(state.onboarding.look, free);
  assert.deepEqual(state.onboarding.wardrobe, { hair: ['low-cut'], outfit: ['casual'], fabric: ['plain'] }, 'nothing but the basics is owned before moving in');
});

test('lives saved before these options, and damaged saves, load unchanged or tidied — never reset', () => {
  const old = started();
  assert.deepEqual(old.onboarding.look, LOOK);
  assert.deepEqual(Object.keys(old.onboarding.wardrobe), ['hair', 'outfit', 'fabric'], 'a wardrobe with no bought accessories has no accessories list');
  assert.deepEqual(createLife(structuredClone(old), at()), old, 'reloading changes nothing');
  assert.deepEqual(viewLife(old, at()).onboarding.wardrobe.accessories, ACCESSORY_BASICS, 'the free accessories are owned by everyone');
  assert.deepEqual(viewLife(old, at()).onboarding.look, LOOK);
  const legacy = createLife({ cash: 4321, name: 'Old Timer' }, at());
  assert.deepEqual(legacy.onboarding.look, DEFAULT_LOOK);
  assert.equal(act(legacy, 'onboarding.set-look', { look: { ...DEFAULT_LOOK, accessories: ['glasses'], expression: 'grin' } }).code, 'look_saved', 'a legacy life may wear the free accessories');

  const damaged = structuredClone(old);
  damaged.onboarding.look = { ...LOOK, accessories: ['glasses', 'monocle', 'sunglasses', 7, 'chain', 'chain'], face: 'heart', expression: 'grin' };
  damaged.onboarding.wardrobe.accessories = ['chain', 'wig', 'glasses', 'chain', {}];
  const loaded = createLife(damaged, at());
  assert.deepEqual(loaded.onboarding.look, { ...LOOK, accessories: ['glasses', 'chain'], expression: 'grin' }, 'the look survives; what is unknown or clashes is dropped');
  assert.deepEqual(loaded.onboarding.wardrobe.accessories, ['chain']);
  for (const junk of ['text', 7, { length: 3 }]) {
    const state = structuredClone(old); state.onboarding.look = { ...LOOK, accessories: junk }; state.onboarding.wardrobe.accessories = junk;
    assert.deepEqual(createLife(state, at()).onboarding, old.onboarding);
  }
  assert.deepEqual(normalizeLook(LOOK, 'x').accessories, [], 'a recorded look without accessories wears none in a scene');
});

test('the Boutique sells accessories and the new styles; ownership persists and every refusal says why', () => {
  const state = started();
  const cash = state.cash, shop = () => viewLife(state, at()).onboarding.boutique, item = (id) => shop().find((entry) => entry.id === id);
  assert.deepEqual(shop().filter((entry) => entry.kind === 'accessories').map((entry) => entry.id), APPEARANCE.accessories.map((entry) => entry.id));
  assert.deepEqual([item('glasses').owned, item('glasses').price, item('chain').owned, item('chain').price, item('chain').slot], [true, 0, false, 6000, 'neck']);
  assert.ok(shop().some((entry) => entry.kind === 'outfit' && entry.id === 'agbada') && !shop().some((entry) => entry.id === 'gown'), 'styles for the current body only');

  const unowned = act(state, 'onboarding.set-look', { look: { ...LOOK, accessories: ['glasses', 'chain'] } });
  assert.equal(unowned.code, 'not_owned'); assert.match(unowned.reason, /do not own the Chain yet.*Boutique for ₦6,000/);
  assert.equal(act(state, 'onboarding.set-look', { look: { ...LOOK, accessories: ['glasses', 'watch'] } }).code, 'look_saved', 'the free accessories can be worn without buying');
  assert.equal(act(state, 'onboarding.set-look', { look: { ...LOOK, accessories: ['watch', 'glasses'] } }).code, 'unchanged', 'the order does not matter');

  const chain = act(state, 'onboarding.boutique-buy', { kind: 'accessories', id: 'chain' });
  assert.equal(chain.code, 'bought'); assert.equal(state.cash, cash - 6000);
  assert.deepEqual([state.ledger.at(-1).amount, state.ledger.at(-1).reason], [-6000, 'Boutique: Chain accessory']);
  assert.deepEqual(state.onboarding.look.accessories, ['glasses', 'watch', 'chain'], 'bought and put on');
  assert.deepEqual(state.onboarding.wardrobe.accessories, ['chain']);
  assert.deepEqual([item('chain').owned, item('chain').wearing], [true, true]);
  assert.equal(act(state, 'onboarding.boutique-buy', { kind: 'accessories', id: 'chain' }).code, 'already_owned');
  assert.equal(act(state, 'onboarding.boutique-buy', { kind: 'accessories', id: 'glasses' }).code, 'already_owned', 'a free starter is never sold');
  assert.equal(act(state, 'onboarding.boutique-buy', { kind: 'accessories', id: 'sunglasses' }).code, 'bought');
  assert.deepEqual(state.onboarding.look.accessories, ['watch', 'chain', 'sunglasses'], 'sunglasses take the place of the glasses');
  for (const payload of [{ kind: 'accessories', id: 'monocle' }, { kind: 'accessories', id: 'constructor' }, { kind: 'accessories' }]) assert.equal(act(state, 'onboarding.boutique-buy', payload).code, 'invalid_item');

  // Taking everything off stores a plain look again; what was bought stays owned.
  assert.equal(act(state, 'onboarding.set-look', { look: { ...LOOK, accessories: [] } }).code, 'look_saved');
  assert.deepEqual(state.onboarding.look, LOOK);
  assert.equal(act(state, 'onboarding.set-look', { look: { ...LOOK, accessories: ['sunglasses', 'chain'] } }).code, 'look_saved');

  state.cash = 100000;
  const agbada = act(state, 'onboarding.boutique-buy', { kind: 'outfit', id: 'agbada' });
  assert.equal(agbada.code, 'bought'); assert.equal(state.cash, 75000); assert.equal(state.onboarding.look.outfit, 'agbada');
  assert.equal(act(state, 'onboarding.boutique-buy', { kind: 'outfit', id: 'gown' }).code, 'wrong_body');
  assert.equal(act(state, 'onboarding.boutique-buy', { kind: 'hair', id: 'twists' }).code, 'bought');
  assert.equal(act(state, 'onboarding.boutique-buy', { kind: 'accessories', id: 'fila' }).code, 'bought');
  state.cash = 10;
  const dear = act(state, 'onboarding.boutique-buy', { kind: 'accessories', id: 'handbag' });
  assert.equal(dear.code, 'insufficient_funds'); assert.match(dear.reason, /Handbag costs ₦7,000; you have ₦10/);
  assert.match(item('handbag').blocked, /Costs ₦7,000/);
  // At the limit the oldest gives way.
  state.cash = 100000;
  for (const id of ['beads', 'backpack']) assert.equal(act(state, 'onboarding.boutique-buy', { kind: 'accessories', id }).code, 'bought');
  assert.deepEqual(state.onboarding.look.accessories, ['sunglasses', 'chain', 'fila', 'beads', 'backpack'], 'five are worn');
  assert.equal(act(state, 'onboarding.boutique-buy', { kind: 'accessories', id: 'handbag' }).code, 'bought');
  assert.deepEqual(state.onboarding.look.accessories, ['sunglasses', 'chain', 'fila', 'beads', 'handbag'], 'the handbag replaces the backpack');
  assert.equal(act(state, 'onboarding.set-look', { look: { ...state.onboarding.look, accessories: ['sunglasses', 'chain', 'fila', 'beads', 'backpack', 'watch'] } }).code, 'invalid_look');
  assert.deepEqual(createLife(structuredClone(state), at()), state, 'everything bought and worn survives a reload');
  assert.deepEqual(state.onboarding.wardrobe.accessories, ['chain', 'sunglasses', 'fila', 'beads', 'backpack', 'handbag']);
});
