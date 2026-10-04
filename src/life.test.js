import test from 'node:test';
import assert from 'node:assert/strict';
import { createLife, VENUES, TRAVEL_OPTIONS, PREVIEW_TRAVEL_DURATION, startActivity, cancelActivity, advanceLife, startTravel } from './life.js';

test('preview seed is independent; saved needs and cash override seed safely', () => {
  const state = createLife();
  assert.equal(state.cash, 5000);
  assert.equal(state.location, 'park');
  assert.equal(state.spot, 'amphitheatre');
  assert.equal(state.activeAction, null);
  assert.deepEqual(state.needs, { hunger: 50, energy: 50, fun: 50, social: 50, hygiene: 50, bladder: 50 });
  state.needs.fun = 0;
  assert.equal(createLife().needs.fun, 50);
  const saved = createLife({ cash: 7200, needs: { hunger: 24, energy: 74, fun: 0, social: 87, hygiene: 31, bladder: 12 } });
  assert.equal(saved.cash, 7200);
  assert.deepEqual(saved.needs, { hunger: 24, energy: 74, fun: 0, social: 87, hygiene: 31, bladder: 12 });
  const legacy = createLife({ cash: 9500, hunger: 23, energy: 71, name: 'Ada', homeOwned: true });
  assert.equal(legacy.cash, 9500);
  assert.equal(legacy.needs.hunger, 23);
  assert.equal(legacy.needs.energy, 71);
  assert.equal(legacy.name, 'Ada');
  assert.equal(legacy.homeOwned, true);
  assert.deepEqual(createLife({ cash: -3, needs: { fun: Infinity, energy: 300 }, location: 'bad', activeAction: {} }).needs,
    { hunger: 50, energy: 100, fun: 50, social: 50, hygiene: 50, bladder: 50 });
});

test('Chill finishes after 11 seconds, awards observed effects once and clamps needs', () => {
  const state = createLife({ spot: 'trees', needs: { energy: 98, fun: 95 } });
  assert.deepEqual(startActivity(state, 'chill'), { ok: true, code: 'started', state });
  assert.deepEqual(state.activeAction, { kind: 'activity', id: 'chill', duration: 11, remaining: 11 });
  advanceLife(state, 10);
  assert.equal(state.needs.fun, 95);
  assert.equal(state.activeAction.remaining, 1);
  advanceLife(state, 1);
  assert.equal(state.activeAction, null);
  assert.equal(state.needs.energy, 100);
  assert.equal(state.needs.fun, 100);
  advanceLife(state, 100);
  assert.equal(state.cash, 5000);
  const exact = createLife({ spot: 'trees' });
  startActivity(exact, 'chill');
  advanceLife(exact, 50);
  advanceLife(exact, 50);
  assert.equal(exact.needs.energy, 54);
  assert.equal(exact.needs.fun, 60);
});

test('cancelled actions have no effects; overlapping and invalid time are harmless', () => {
  const state = createLife({ spot: 'trees' });
  startActivity(state, 'chill');
  const active = state.activeAction;
  startTravel(state, 'library', 'cab');
  startActivity(state, 'chill');
  assert.equal(state.activeAction, active);
  assert.equal(state.cash, 5000);
  for (const dt of [NaN, Infinity, -1, '11']) advanceLife(state, dt);
  assert.equal(active.remaining, 11);
  advanceLife(state, 4);
  cancelActivity(state);
  advanceLife(state, 100);
  assert.equal(state.needs.energy, 50);
  assert.equal(state.needs.fun, 50);
});

test('unknown outcomes and skill-locked actions are catalogued but unavailable', () => {
  assert.ok(VENUES.park.spots.trees.actions.some((action) => action.id === 'play-ayo'));
  assert.equal(VENUES.park.district, 'Lagos Island');
  assert.equal(VENUES.library.district, 'Victoria Island');
  const state = createLife();
  for (const spot of Object.values(VENUES.park.spots)) {
    state.spot = spot.id;
    for (const action of spot.actions.filter((item) => item.id !== 'chill')) {
      assert.equal(action.unavailable, true);
      assert.equal(action.effects, undefined);
      assert.ok(action.source);
      assert.equal(action.placeholder, true);
      assert.equal(startActivity(state, action.id).code, 'unavailable');
      assert.equal(state.activeAction, null);
      assert.equal(state.cash, 5000);
    }
  }
  state.spot = 'amphitheatre';
  startActivity(state, 'chill');
  assert.equal(state.activeAction, null);
});

test('travel charges each fare once and settles location only on completion', () => {
  assert.equal(PREVIEW_TRAVEL_DURATION, 5);
  assert.deepEqual(TRAVEL_OPTIONS, { trek: 0, keke: 150, danfo: 150, okada: 200, cab: 400 });
  for (const [mode, fare] of Object.entries(TRAVEL_OPTIONS)) {
    const state = createLife();
    startTravel(state, 'library', mode);
    assert.equal(state.cash, 5000 - fare);
    startTravel(state, 'library', mode);
    assert.equal(state.cash, 5000 - fare);
    advanceLife(state, 4);
    assert.equal(state.location, 'park');
    advanceLife(state, 1);
    advanceLife(state, 10);
    assert.equal(state.location, 'library');
    assert.equal(state.spot, null);
    assert.equal(state.cash, 5000 - fare);
    startTravel(state, 'park', 'trek');
    advanceLife(state, 5);
    assert.equal(state.spot, 'amphitheatre');
  }
});

test('unaffordable, invalid or redundant travel does not charge or start', () => {
  const state = createLife({ cash: 149 });
  assert.equal(startTravel(state, 'library', 'keke').code, 'insufficient_funds');
  for (const [destination, mode] of [['library', 'keke'], ['library', 'cab'], ['park', 'cab'], ['unknown', 'trek'], ['library', 'unknown']]) {
    startTravel(state, destination, mode);
    assert.equal(state.cash, 149);
    assert.equal(state.activeAction, null);
  }
  startTravel(state, 'library', 'trek');
  cancelActivity(state);
  advanceLife(state, 5);
  assert.equal(state.location, 'park');
});

test('saved in-progress travel resumes without charging again', () => {
  const state = createLife();
  startTravel(state, 'library', 'cab');
  advanceLife(state, 2);
  const restored = createLife(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.cash, 4600);
  assert.equal(restored.activeAction.remaining, 3);
  advanceLife(restored, 3);
  assert.equal(restored.location, 'library');
  assert.equal(restored.cash, 4600);
  assert.equal(createLife({ activeAction: { kind: 'activity', id: 'comedy', duration: 11, remaining: 3 } }).activeAction, null);
});

test('reload mid activity pauses offline and completion cannot award again after reload', () => {
  const state = createLife({ spot: 'trees' });
  startActivity(state, 'chill');
  advanceLife(state, 4);
  const restored = createLife(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.activeAction.remaining, 7);
  assert.equal(advanceLife(restored, 7).code, 'completed');
  const completed = createLife(JSON.parse(JSON.stringify(restored)));
  assert.equal(advanceLife(completed, 100).code, 'idle');
  assert.equal(completed.needs.fun, 60);
  assert.equal(completed.needs.energy, 54);
  const cancelledTravel = createLife();
  startTravel(cancelledTravel, 'library', 'cab');
  cancelActivity(cancelledTravel);
  assert.equal(cancelledTravel.cash, 4600);
  assert.equal(cancelledTravel.location, 'park');
});
