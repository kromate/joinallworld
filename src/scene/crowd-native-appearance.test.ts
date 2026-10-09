import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCityContent } from '../game/cities/registry.ts';
import { createLife, viewLife } from '../life.ts';
import { crowdList } from './crowd.ts';
import { normalizeLook } from './characters.ts';
await loadCityContent('lagos');

test('recorded regular appearances survive actual social serialization and keep NPC identities', () => {
  const state = createLife({ location: 'office' }, { now: Date.UTC(2026, 0, 5, 10), cityId: 'lagos' });
  const here = viewLife(state, { now: state.t, cityId: 'lagos' }).social.here;
  const list = crowdList({ npcs: JSON.parse(JSON.stringify(here)) });
  for (const [id, body, hair] of [['mrs-okafor', 'woman', 'afro'], ['dapo', 'man', 'lowcut']]) {
    const original = here.find((person) => person.id === id);
    const drawn = list.find((person) => person.id === `npc:${id}`);
    assert.ok(original && drawn);
    assert.deepEqual(drawn.look, original.look);
    assert.equal(drawn.seed, id);
    const look = normalizeLook(drawn.look, drawn.seed);
    assert.equal(look.body, body);
    assert.equal(look.hair, hair);
    assert.equal(look.outfit, 'office');
    assert.equal(look.fabric, 'plain');
    assert.deepEqual(look.accessories, []);
    assert.ok(original.actions.length > 0, 'regular still has its actual social actions');
    assert.ok(!('authority' in drawn) && !('resident' in drawn));
    assert.deepEqual(normalizeLook(JSON.parse(JSON.stringify(drawn.look)), drawn.seed), look);
  }
});

test('malformed NPC appearance cannot confer appearance fields or authority', () => {
  for (const look of [[], 1, 'woman', null]) {
    const [person] = crowdList({ npcs: [{ id: 'amaka', look, at: 'counter', resident: true }] });
    assert.ok(person);
    assert.ok(!('look' in person));
    assert.ok(!('resident' in person));
    assert.equal(person.seed, 'amaka');
  }
});
