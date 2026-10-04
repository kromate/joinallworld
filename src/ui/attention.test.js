import test from 'node:test';
import assert from 'node:assert/strict';
import { nextStep, wayTo, needsBubble, COACH_GOALS, TAPER } from './attention.js';

const goal = (more = {}) => ({ kind: 'goal', step: 1, of: 7, title: 'Eat something', hint: 'Tap the cooler or stove', go: ['home', 'kitchen'], ...more });
const base = (more = {}) => ({
  state: { location: 'home', spot: 'bedroom', activeAction: null },
  view: { connected: true, goals: { chip: goal() }, activities: { spots: [{ id: 'kitchen', label: 'Kitchen' }] }, travel: {} },
  mode: 'venue', expanded: false, seen: {}, apps: (id) => ({ jobs: { placement: 'phone', title: 'Jobs' }, buy: { placement: 'nav', title: 'Buy' } })[id],
  ...more,
});

test('the next step for a goal: go there, pick the spot, pick an activity, then watch it finish', () => {
  assert.deepEqual(nextStep(base({ state: { location: 'park', spot: 'trees', activeAction: null } })), { id: 'goal', text: 'Go Home first: tap Home.', target: '[data-nav="home"]', bubble: true, title: 'Goal 1 of 7 · Eat something' });
  assert.equal(nextStep(base()).target, '[data-spot="kitchen"]');
  assert.equal(nextStep(base({ state: { location: 'home', spot: 'kitchen', activeAction: null }, expanded: true })).target, '.life-action:not(:disabled):not(.is-blocked)');
  const doing = nextStep(base({ state: { location: 'home', spot: 'kitchen', activeAction: { kind: 'activity', id: 'garri' } } }));
  assert.equal(doing.target, '.life-progress'); assert.match(doing.text, /finishes by itself/);
  const detour = nextStep(base({ state: { location: 'home', spot: 'bedroom', activeAction: { kind: 'activity', id: 'nap' } } }));
  assert.equal(detour.target, null); assert.match(detour.text, /not part of the goal/);
});

test('a goal that opens an app points at the Phone, or at its nav tab', () => {
  const view = (open) => ({ ...base().view, goals: { chip: goal({ go: null, open }) } });
  assert.deepEqual([nextStep(base({ view: view('jobs') })).target, nextStep(base({ view: view('jobs') })).app], ['[data-nav="phone"]', 'jobs']);
  assert.equal(nextStep(base({ view: view('buy') })).target, '[data-nav="buy"]');
  assert.equal(nextStep(base({ view: view('nowhere') })), null);
});

test('it tapers: later goals are ringed but not spelled out, and say nothing while an activity runs', () => {
  const later = { ...base().view, goals: { chip: goal({ step: COACH_GOALS + 1 }) } };
  const step = nextStep(base({ view: later }));
  assert.equal(step.bubble, false); assert.equal(step.target, '[data-spot="kitchen"]');
  assert.equal(nextStep(base({ view: later, state: { location: 'home', spot: 'kitchen', activeAction: { kind: 'activity', id: 'x' } } })), null);
  assert.equal(nextStep(base({ view: { ...base().view, goals: { chip: { kind: 'next', title: 'Explore' } } } })), null, 'the rolling next step after the starter goals is not coached');
});

test('silent when it should be: Hints off, Clean screen, not connected, creating a character, a sheet in front', () => {
  for (const off of [{ hintsOff: true }, { clean: true }, { view: { ...base().view, connected: false } }, { view: { ...base().view, onboarding: { required: true } } }, { mode: 'buy' }]) assert.equal(nextStep(base(off)), null, JSON.stringify(Object.keys(off)));
  assert.equal(nextStep(null), null);
});

test('on the map: Go after a place is picked, then where the trip card is — each only the first few times', () => {
  assert.equal(nextStep(base({ mode: 'map' })), null, 'nothing picked: nothing to point at');
  assert.deepEqual(nextStep(base({ mode: 'map', picked: true })), { id: 'go', text: 'Tap Go to travel there', target: '.map-go:not(:disabled)', bubble: true });
  assert.equal(nextStep(base({ mode: 'map', picked: true, sheet: 'panel' })), null);
  assert.equal(nextStep(base({ mode: 'map', picked: true, seen: { go: TAPER } })), null, 'retired after a few uses');
  const trip = { location: 'home', spot: null, activeAction: { kind: 'travel', id: 'park' } };
  assert.equal(nextStep(base({ mode: 'map', state: trip })).target, '.map-trip');
  assert.equal(nextStep(base({ mode: 'map', state: trip, seen: { trip: TAPER } })), null);
  assert.equal(nextStep(base({ mode: 'venue', state: trip })), null, 'a trip is shown on the map; the venue view says nothing');
});

test('a roadside prompt is pointed at before the goal, a few times, and never during an activity', () => {
  const view = { ...base().view, travel: { event: { id: 'boys', at: 1 } } };
  assert.deepEqual(nextStep(base({ view })), { id: 'roadside', text: 'Someone is waiting — tap to answer', target: '.map-event-chip', bubble: false });
  assert.equal(nextStep(base({ view, seen: { roadside: TAPER } })).id, 'goal');
  assert.equal(nextStep(base({ view, state: { location: 'home', spot: 'kitchen', activeAction: { kind: 'activity', id: 'x' } } })).id, 'goal');
});

test('which way, and whether a bubble is needed', () => {
  assert.equal(wayTo({ x: 0, y: 0 }, { x: 100, y: 0 }).arrow, '→');
  assert.equal(wayTo({ x: 0, y: 0 }, { x: 0, y: 100 }).arrow, '↓');
  assert.equal(wayTo({ x: 100, y: 100 }, { x: 0, y: 0 }).arrow, '↖');
  assert.equal(wayTo({ x: 0, y: 0 }, { x: -50, y: 0 }).arrow, '←');
  const screen = { width: 3440, height: 1440 };
  assert.equal(needsBubble({ x: 1700, y: 700 }, { left: 1650, right: 1790, top: 760, bottom: 804 }, screen), false, 'right beside the click: the ring is enough');
  assert.equal(needsBubble({ x: 2900, y: 400 }, { left: 940, right: 1260, top: 500, bottom: 548 }, screen), true, 'a long way across an ultra-wide screen');
  assert.equal(needsBubble({ x: 200, y: 400 }, { left: 20, right: 300, top: 900, bottom: 950 }, { width: 390, height: 844 }), true, 'off the bottom of a phone');
});
