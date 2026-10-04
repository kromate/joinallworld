import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, interact, updateNeeds, chooseJob, buyHome } from './game.js';

test('new games are independent and malformed saves recover safely', () => {
  const game = createGame();
  game.cash = 0;
  assert.equal(createGame().cash, 5000);
  for (const saved of [null, [], 'invalid', 42]) assert.equal(createGame(saved).cash, 5000);
  const restored = createGame({ cash: -3, deliveries: 0.5, job: 'paid', homeOwned: 'true',
    energy: NaN, hunger: Infinity, health: -20, message: {} });
  assert.deepEqual({ ...restored, message: null }, {
    cash: 5000, deliveries: 0, job: null, homeOwned: false,
    energy: 100, hunger: 100, health: 0, message: null,
  });
  const saved = { cash: 7000, deliveries: 2, job: 'dropoff', homeOwned: true, energy: 150, hunger: 44 };
  const valid = createGame(saved);
  assert.equal(valid.job, 'dropoff');
  assert.equal(valid.cash, 7000);
  assert.equal(valid.homeOwned, true);
  assert.equal(valid.energy, 100);
  assert.equal(valid.hunger, 44);
  assert.equal(saved.energy, 150);
});

test('delivery requires acceptance and pickup; each package pays exactly once', () => {
  const state = createGame();
  assert.equal(interact(state, 'office'), state);
  interact(state, 'market');
  assert.equal(state.cash, 5000);
  assert.equal(chooseJob(state), state);
  interact(state, 'office');
  assert.equal(state.job, 'pickup');
  interact(state, 'Market');
  chooseJob(state);
  interact(state, 'market');
  assert.equal(state.job, 'dropoff');
  interact(state, 'office');
  interact(state, 'office');
  assert.equal(state.cash, 6500);
  assert.equal(state.deliveries, 1);
  assert.equal(state.job, null);
  chooseJob(state);
  interact(state, 'market');
  interact(state, 'office');
  assert.equal(state.cash, 8000);
  assert.equal(state.deliveries, 2);
});

test('food and treatment charge only affordable services and clamp needs', () => {
  const state = createGame({ cash: 499, hunger: 10, energy: 90, health: 20 });
  interact(state, 'amala');
  assert.equal(state.cash, 499);
  assert.equal(state.hunger, 10);
  state.cash = 800;
  interact(state, 'amala');
  assert.equal(state.cash, 300);
  assert.equal(state.hunger, 100);
  assert.equal(state.energy, 100);
  interact(state, 'hospital');
  assert.equal(state.cash, 0);
  assert.equal(state.health, 100);
  interact(state, 'hospital');
  assert.equal(state.cash, 0);
  state.health = 50;
  interact(state, 'hospital');
  assert.equal(state.health, 50);
});

test('home purchase is affordable, permanent and cannot charge twice', () => {
  const state = createGame();
  buyHome(state);
  assert.equal(state.homeOwned, false);
  assert.equal(state.cash, 5000);
  state.cash = 12000;
  assert.equal(buyHome(state), state);
  assert.equal(state.homeOwned, true);
  assert.equal(state.cash, 0);
  buyHome(state);
  state.energy = 10;
  interact(state, 'home');
  assert.equal(state.cash, 0);
  assert.equal(state.energy, 100);
});

test('needs decay is bounded, rejects invalid time and is independent of frame size', () => {
  const state = createGame();
  for (const dt of [-1, NaN, Infinity, '10', null]) updateNeeds(state, dt);
  assert.equal(state.energy, 100);
  assert.equal(updateNeeds(state, 10), state);
  assert.equal(state.hunger, 98.8);
  assert.equal(state.energy, 99.2);
  const single = createGame({ hunger: 1, energy: 1 });
  const stepped = createGame({ hunger: 1, energy: 1 });
  updateNeeds(single, 100);
  for (let i = 0; i < 100; i++) updateNeeds(stepped, 1);
  assert.ok(Math.abs(single.health - stepped.health) < 1e-10);
  updateNeeds(state, 10000);
  assert.equal(state.energy, 0);
  assert.equal(state.hunger, 0);
  assert.equal(state.health, 0);
});

test('unknown venues are harmless', () => {
  const state = createGame();
  for (const venue of ['unknown', null, {}]) interact(state, venue);
  assert.equal(state.cash, 5000);
  assert.equal(state.job, null);
});
