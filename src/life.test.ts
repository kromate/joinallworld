import test from 'node:test';
import assert from 'node:assert/strict';
import { createLife, VENUES, TRAVEL_OPTIONS, PREVIEW_TRAVEL_DURATION, startActivity, cancelActivity, advanceLife, startTravel, applyJob } from './life.ts';

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
  assert.ok(VENUES.park.spots.trees.activities.some((action) => action.id === 'play-ayo'));
  assert.equal(VENUES.park.district, 'Lagos Island');
  assert.equal(VENUES.library.district, 'Victoria Island');
  const state = createLife();
  for (const spot of Object.values(VENUES.park.spots)) {
    state.spot = spot.id;
    for (const action of spot.activities.filter((item) => item.id !== 'chill' && !item.beta)) {
      assert.equal(action.unavailable, true);
      assert.equal(action.effects, undefined);
      assert.ok(action.note);

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
  assert.equal(PREVIEW_TRAVEL_DURATION, 5, 'legacy flat trip time, still carried by old saves');
  assert.deepEqual(TRAVEL_OPTIONS, { trek: 0, keke: 150, danfo: 150, okada: 200, cab: 400 });
  // Freedom Park → The Library is an across-town trip: each mode has its own trip time.
  const seconds = { trek: 12, keke: 9, danfo: 8, okada: 5, cab: 6 };
  for (const [mode, fare] of Object.entries(TRAVEL_OPTIONS)) {
    const state = createLife();
    startTravel(state, 'library', mode);
    assert.equal(state.cash, 5000 - fare);
    assert.equal(state.activeAction.duration, seconds[mode], mode);
    startTravel(state, 'library', mode);
    assert.equal(state.cash, 5000 - fare);
    advanceLife(state, seconds[mode] - 1);
    assert.equal(state.location, 'park');
    advanceLife(state, 1);
    advanceLife(state, 10);
    assert.equal(state.location, 'library');
    assert.equal(state.spot, 'bookcase', 'arrival stands at the venue’s first spot');
    assert.equal(state.cash, 5000 - fare);
    startTravel(state, 'park', 'trek');
    advanceLife(state, seconds.trek);
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
  assert.equal(restored.activeAction.remaining, 4, 'a cab across town takes 6 seconds');
  advanceLife(restored, 4);
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

test('home is reachable by every mode: a paid ride needs its fare, trek is free, and each is charged once', () => {
  const state = createLife({ cash: 0 });
  assert.equal(state.location, 'park');
  assert.equal(VENUES.home.hours, undefined, 'home never closes');
  for (const mode of ['keke', 'danfo', 'okada', 'cab']) {
    assert.equal(startTravel(state, 'home', mode).code, 'insufficient_funds', mode);
    assert.equal(state.cash, 0); assert.equal(state.activeAction, null);
  }
  assert.equal(startTravel(state, 'home', 'trek').code, 'started');
  assert.equal(state.activeAction.duration, 18, 'Freedom Park → Home (Yaba) crosses the lagoon');
  advanceLife(state, 17);
  assert.equal(state.location, 'park');
  advanceLife(state, 1);
  assert.equal(state.location, 'home');
  assert.equal(state.spot, 'kitchen');
  assert.equal(state.cash, 0);
  const rider = createLife();
  assert.equal(startTravel(rider, 'home', 'cab').code, 'started');
  assert.equal(rider.cash, 5000 - 550);
  startTravel(rider, 'home', 'cab');
  advanceLife(rider, 9);
  assert.equal(rider.location, 'home'); assert.equal(rider.cash, 5000 - 550);
});

test('Garri and Bath award once only on completion and cap needs', () => {
  for (const [id, spot, need, duration, gain] of [
    ['garri', 'kitchen', 'hunger', 5, 20], ['bath', 'bathroom', 'hygiene', 6, 25],
  ]) {
    const state = createLife({ location: 'home', spot });
    assert.equal(startActivity(state, id).code, 'started');
    advanceLife(state, duration - 1);
    assert.equal(state.needs[need], 50);
    const restored = createLife(JSON.parse(JSON.stringify(state)));
    assert.equal(restored.activeAction.remaining, 1);
    advanceLife(restored, 1);
    advanceLife(restored, 100);
    assert.equal(restored.needs[need], 50 + gain);
    const completed = createLife(JSON.parse(JSON.stringify(restored)));
    advanceLife(completed, 100);
    assert.equal(completed.needs[need], 50 + gain);
    state.activeAction = null;
    state.needs[need] = 95;
    startActivity(state, id);
    advanceLife(state, duration);
    assert.equal(state.needs[need], 100);
    startActivity(state, id);
    advanceLife(state, duration - 1);
    state.needs[need] = 50;
    cancelActivity(state);
    advanceLife(state, 100);
    assert.equal(state.needs[need], 50);
    assert.equal(state.cash, 5000);
  }
});

test('Nap accrues only elapsed energy, resumes after reload and cancellation keeps progress', () => {
  const state = createLife({ location: 'home', spot: 'bedroom', needs: { energy: 40 } });
  startActivity(state, 'nap');
  advanceLife(state, 4);
  assert.equal(state.needs.energy, 48);
  const restored = createLife(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.activeAction.remaining, 11);
  assert.equal(restored.needs.energy, 48);
  advanceLife(restored, 3);
  assert.equal(restored.needs.energy, 54);
  cancelActivity(restored);
  advanceLife(restored, 100);
  assert.equal(restored.needs.energy, 54);
  advanceLife(state, 100);
  assert.equal(state.needs.energy, 70);
  const completed = createLife(JSON.parse(JSON.stringify(state)));
  advanceLife(completed, 100);
  assert.equal(completed.needs.energy, 70);
  startActivity(completed, 'nap');
  advanceLife(completed, 100);
  assert.equal(completed.needs.energy, 100);
});

test('Nap is deterministic across frame sizes and invalid saved timers never replay gains', () => {
  const single = createLife({ location: 'home', spot: 'bedroom', needs: { energy: 20 } });
  const stepped = createLife(single);
  startActivity(single, 'nap');
  startActivity(stepped, 'nap');
  advanceLife(single, 15);
  for (let i = 0; i < 60; i++) advanceLife(stepped, 0.25);
  assert.equal(single.needs.energy, stepped.needs.energy);
  for (const remaining of [0, -1, 16, Infinity]) {
    const restored = createLife({ location: 'home', needs: { energy: 35 },
      activeAction: { kind: 'activity', id: 'nap', duration: 15, remaining } });
    assert.equal(restored.activeAction, null);
    advanceLife(restored, 100);
    assert.equal(restored.needs.energy, 35);
  }
});

test('Community helper application is beta, persistent, free and rejects unknown jobs', () => {
  const state = createLife();
  assert.equal(state.job, null);
  assert.equal(state.completedShifts, 0);
  assert.equal(applyJob(state, 'tech-intern').code, 'invalid_job');
  assert.equal(applyJob(state, 'community-helper').code, 'applied');
  assert.equal(applyJob(state, 'community-helper').code, 'already_employed');
  assert.equal(state.cash, 5000);
  assert.equal(createLife(state).job, 'community-helper');
  assert.equal(VENUES.park.spots.work.beta, true);
  const corrupt = createLife({ job: 'dropoff', completedShifts: -1 });
  assert.equal(corrupt.job, null);
  assert.equal(corrupt.completedShifts, 0);
});

test('shift requires application and both needs; overlapping work and travel do not start', () => {
  const state = createLife({ spot: 'work', needs: { energy: 19, hunger: 20 } });
  assert.equal(startActivity(state, 'helper-shift').code, 'job_required');
  applyJob(state, 'community-helper');
  assert.equal(startActivity(state, 'helper-shift').code, 'needs_required');
  state.needs.energy = 20;
  state.needs.hunger = 19;
  assert.equal(startActivity(state, 'helper-shift').code, 'needs_required');
  assert.equal(state.activeAction, null);
  state.needs.hunger = 20;
  assert.equal(startActivity(state, 'helper-shift').code, 'started');
  const active = state.activeAction;
  assert.equal(startActivity(state, 'helper-shift').code, 'busy');
  assert.equal(startTravel(state, 'home', 'trek').code, 'busy');
  assert.equal(applyJob(state, 'community-helper').code, 'busy');
  assert.equal(state.activeAction, active);
  assert.equal(state.cash, 5000);
});

test('cancelled shift grants no reward or need costs', () => {
  const state = createLife({ spot: 'work', job: 'community-helper' });
  startActivity(state, 'helper-shift');
  advanceLife(state, 19);
  assert.equal(state.cash, 5000);
  cancelActivity(state);
  advanceLife(state, 100);
  assert.equal(state.cash, 5000);
  assert.equal(state.completedShifts, 0);
  assert.equal(state.needs.energy, 50);
  assert.equal(state.needs.hunger, 50);
});

test('midshift reload completes reward and costs exactly once; completed saves cannot replay', () => {
  const state = createLife({ spot: 'work', job: 'community-helper' });
  startActivity(state, 'helper-shift');
  advanceLife(state, 7);
  const restored = createLife(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.activeAction.remaining, 13);
  advanceLife(restored, 13);
  advanceLife(restored, 100);
  assert.equal(restored.cash, 5300);
  assert.equal(restored.needs.energy, 40);
  assert.equal(restored.needs.hunger, 45);
  assert.equal(restored.completedShifts, 1);
  const completed = createLife(JSON.parse(JSON.stringify(restored)));
  advanceLife(completed, 100);
  assert.equal(completed.cash, 5300);
  assert.equal(completed.completedShifts, 1);
  // The starter shift has a four-hour break: an immediate second shift is refused and changes nothing.
  assert.equal(startActivity(completed, 'helper-shift').code, 'cooldown');
  assert.equal(completed.activeAction, null); assert.equal(completed.cash, 5300);
  advanceLife(completed, 4 * 3600);
  assert.equal(startActivity(completed, 'helper-shift').code, 'started');
  advanceLife(completed, 20);
  assert.equal(completed.cash, 5600);
  assert.equal(completed.completedShifts, 2);
  assert.equal(createLife({ ...state, job: null }).activeAction, null);
});

test('shift rejects unsafe reward balances and preserves counters when blocked', () => {
  for (const saved of [{ cash: Number.MAX_SAFE_INTEGER }, { completedShifts: Number.MAX_SAFE_INTEGER }]) {
    const state = createLife({ ...saved, spot: 'work', job: 'community-helper' });
    assert.equal(startActivity(state, 'helper-shift').code, 'balance_limit');
    assert.equal(state.activeAction, null);
  }
});
