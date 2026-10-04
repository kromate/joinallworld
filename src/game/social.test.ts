// OWNER: social — tests for src/game/systems/social.js, content/npcs.js and the client-side message model.
// Pattern and rules: see "HOW TO TEST" at the top of src/game/registry.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLife, dispatch, advanceLife, viewLife, hasAction, actionTypes, spotsOf, VENUES } from '../life.ts';
import { registerSystem } from './registry.ts';
import { rebuildCatalogue } from './systems/activities.ts';
import { makeContext } from './util.ts';
import { serverOp, activityId, tierOf, jokeChance } from './systems/social.ts';
import { NPCS, NPC_ACTIONS, PLAYER_ACTIONS, TIERS, BAE_UNLOCK, DAILY_INTERACTIONS, FAMILY, FAMILY_CALL, TRANSFER_LIMITS } from './content/npcs.ts';

const NOW = Date.UTC(2026, 0, 5, 9);
const DAY = 86400000;
const ctxAt = (now = NOW, seed = 'social-test') => makeContext({ now, cityId: 'lagos', seed });
const PLAYER = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-2222-4333-8444-555555555555';

// A probe system records the events and applies an optional gain bonus, the way a perk would.
const probe = { events: [], gain: 1, chance: null };
registerSystem({
  id: 'social-probe', stateKeys: [], sanitize() {},
  on: Object.fromEntries(['npc.greeted', 'npc.interacted', 'friend.made', 'relationship.changed', 'transfer.sent', 'transfer.received'].map((name) => [name, (state, data) => probe.events.push([name, data])])),
  modifiers: { 'social.gain': (value) => value * probe.gain, 'social.success': (value) => probe.chance ?? value },
});
rebuildCatalogue();
const reset = () => { probe.events = []; probe.gain = 1; probe.chance = null; };
const names = () => probe.events.map(([name]) => name);

function atPeople(saved = {}) {
  const state = createLife({ location: 'park', spot: 'people', ...saved }, ctxAt());
  state.t = NOW;
  return state;
}
/** Start an activity and let it finish. Returns the start result. */
function run(state, id, now = NOW, seed = 'run') {
  const started = dispatch(state, { type: 'activity', payload: { id } }, ctxAt(now, seed));
  if (started.ok) advanceLife(state, 60, ctxAt(now + 60000, seed));
  return started;
}

test('content: every venue id has a cast, actions follow the observed list, provenance is marked', () => {
  const venues = ['park', 'library', 'amala-shitta', 'cchub', 'shrine', 'viewing-centre', 'market', 'i-fitness', 'office', 'quilox', 'canopy-walk', 'palms', 'beach', 'hospital', 'salon', 'rooftop', 'police', 'church', 'mosque', 'radio', 'polling-unit', 'state-house', 'airport', 'refinery'];
  for (const venue of venues) assert.ok(Object.values(NPCS).filter((npc) => npc.venue === venue).length >= 2, venue);
  assert.ok(!Object.values(NPCS).some((npc) => npc.venue === 'home'));
  for (const npc of Object.values(NPCS)) { assert.ok(npc.name && npc.role && npc.quotes.length >= 2, npc.id); assert.ok(npc.beta || npc.note, `${npc.id} provenance`); }
  assert.deepEqual(NPC_ACTIONS.map((action) => action.label), ['Say Hello', 'Gist', 'Crack Joke', 'Compliment Their Fit', 'Buy Them a Drink']);
  assert.deepEqual(NPC_ACTIONS[0].effects, { social: 12, fun: 2 });
  assert.equal(NPC_ACTIONS.find((action) => action.id === 'drink').cost, 300);
  assert.equal(NPC_ACTIONS.find((action) => action.id === 'joke').success.base, 60);
  assert.deepEqual(PLAYER_ACTIONS.map((action) => action.label), ['Say Hello', 'Gist', 'Crack Joke', 'Throw Shade']);
  assert.equal(BAE_UNLOCK, 40);
  assert.deepEqual(TIERS.map((tier) => tier.id), ['stranger', 'acquaintance', 'friend', 'paddy']);
  for (const item of [...NPC_ACTIONS, ...PLAYER_ACTIONS, ...TIERS, ...Object.values(FAMILY), FAMILY_CALL, TRANSFER_LIMITS]) assert.ok(item.beta || item.note, `${item.id ?? 'entry'} provenance`);
  assert.equal(FAMILY.mummy.contact, true);
});

test('actions are namespaced; server-only operations cannot be reached from a request payload', () => {
  assert.deepEqual(actionTypes().filter((type) => type.startsWith('social')).sort(), ['social.call', 'social.server', 'social.sync']);
  const state = createLife({ cash: 9000, social: { earned: 9000 } }, ctxAt());
  // 'social.server' is declared serverOnly in the registry: nothing a request body carries can run it.
  for (const payload of [{ op: 'transfer-in', from: PLAYER, name: 'x', amount: 5000 }, { op: 'transfer-in', from: PLAYER, amount: 5000, internal: true, serverOnly: false, 'Symbol(social.server)': true }]) {
    const refused = dispatch(state, { type: 'social.server', internal: true, payload }, ctxAt());
    assert.equal(refused.code, 'server_only'); assert.ok(refused.reason); assert.equal(state.cash, 9000);
    assert.equal(dispatch(state, { type: 'social.server', payload }, { now: NOW, cityId: 'lagos' }).code, 'server_only', 'also without a prepared context (the worker path)');
  }
  const allowed = dispatch(state, { type: 'social.server', payload: { op: 'transfer-in', from: PLAYER, name: 'Bola', amount: 500 } }, { ...ctxAt(), internal: true });
  assert.equal(allowed.code, 'received'); assert.equal(state.cash, 9500);
  assert.equal(dispatch(state, { type: 'social.sync' }, ctxAt()).code, 'synced');
});

test('NPC interactions are activities at the People spot of every public venue', () => {
  assert.equal(hasAction('social.call'), true);
  const people = spotsOf('park').find((spot) => spot.id === 'people');
  assert.deepEqual(people.activities.map((def) => def.id).filter((id) => id.includes('kunle')), NPC_ACTIONS.map((action) => activityId('kunle', action.id)));
  assert.equal(spotsOf('park')[0].id, Object.keys(VENUES.park.spots)[0], 'the arrival spot is unchanged');
  for (const venue of Object.keys(VENUES).filter((id) => id !== 'home')) {
    const locals = Object.values(NPCS).filter((npc) => npc.venue === venue);
    assert.equal(locals.length, 2, `${venue} has two regulars`);
    const spot = spotsOf(venue).find((item) => item.id === 'people');
    assert.equal(spot.activities.length, locals.length * NPC_ACTIONS.length, `${venue}: every regular offers every interaction`);
    const view = viewLife(createLife({ location: venue }, ctxAt()), ctxAt()).social;
    assert.deepEqual(view.here.map((npc) => npc.id), locals.map((npc) => npc.id)); assert.ok(view.here.every((npc) => npc.blocked === null && typeof npc.at === 'string'));
  }
  assert.equal(spotsOf('home').some((spot) => spot.id === 'people'), false, 'nobody lives in your home but you');
  assert.deepEqual(viewLife(createLife({ location: 'home' }, ctxAt()), ctxAt()).social.here, []);
});

test('Say Hello: observed needs, charisma XP, closeness, events; nothing on cancel', () => {
  reset();
  const state = atPeople();
  const before = { ...state.needs };
  assert.equal(dispatch(state, { type: 'activity', payload: { id: 'npc-kunle-hello' } }, ctxAt()).code, 'started');
  assert.equal(dispatch(state, { type: 'cancel' }, ctxAt()).code, 'cancelled');
  assert.deepEqual(state.social.rel, {}); assert.deepEqual(names(), []);
  assert.equal(run(state, 'npc-kunle-hello').ok, true);
  assert.equal(state.needs.social, before.social + 12); assert.equal(state.needs.fun, before.fun + 2);
  assert.equal(state.skills.charisma, 5);
  assert.equal(state.social.rel.kunle.p, 2); assert.equal(state.social.rel.kunle.npc, true);
  assert.deepEqual(names(), ['relationship.changed', 'npc.greeted', 'npc.interacted']);
  assert.deepEqual(probe.events[0][1], { id: 'kunle', value: 2, tier: 'stranger' });
  assert.deepEqual(probe.events[2][1], { npc: 'kunle', action: 'hello', success: true });
  assert.match(state.message, /^Kunle: “/);
  const view = viewLife(state, ctxAt(NOW + 60000)).social;
  const kunle = view.here.find((npc) => npc.id === 'kunle');
  assert.equal(kunle.points, 2); assert.equal(kunle.left, DAILY_INTERACTIONS - 1); assert.equal(kunle.next.label, 'Acquaintance');
  assert.deepEqual(view.friends, [], 'one hello does not make a friend');
});

test('social.gain modifies every closeness gain; crossing the friend tier emits friend.made once', () => {
  reset(); probe.gain = 1.15;
  const state = atPeople({ social: { rel: { kunle: { p: 18, npc: true } } } });
  run(state, 'npc-kunle-hello');
  assert.equal(state.social.rel.kunle.p, 20.3);
  assert.deepEqual(probe.events.find(([name]) => name === 'friend.made')[1], { id: 'kunle', npc: true });
  assert.equal(tierOf(state.social.rel.kunle.p).id, 'friend');
  probe.events = [];
  run(state, 'npc-kunle-gist');
  assert.ok(!names().includes('friend.made'));
  assert.equal(viewLife(state, ctxAt(NOW + 120000)).social.friends[0].id, 'kunle');
});

test('per-NPC daily limit blocks with a reason and resets the next Lagos day', () => {
  reset();
  const state = atPeople();
  for (const action of ['hello', 'gist', 'compliment', 'hello']) assert.equal(run(state, activityId('kunle', action)).ok, true, action);
  const blocked = dispatch(state, { type: 'activity', payload: { id: 'npc-kunle-gist' } }, ctxAt(NOW + 300000));
  assert.equal(blocked.ok, false); assert.equal(blocked.code, 'npc_daily_limit'); assert.match(blocked.reason, /Kunle has heard enough from you today/);
  const card = viewLife(state, ctxAt(NOW + 300000)).activities.cards.find((item) => item.id === 'npc-kunle-gist');
  assert.equal(card.blocked.code, 'npc_daily_limit');
  assert.equal(run(state, 'npc-mama-ronke-hello', NOW + 300000).ok, true, 'another NPC is unaffected');
  const points = state.social.rel.kunle.p;
  assert.equal(run(state, 'npc-kunle-gist', NOW + DAY).ok, true);
  assert.ok(state.social.rel.kunle.p > points);
});

test('Buy Them a Drink charges 300 once on completion and is refused without the cash', () => {
  reset();
  const state = atPeople();
  run(state, 'npc-kunle-drink');
  assert.equal(state.cash, 4700);
  assert.deepEqual(state.ledger.at(-1).amount, -300);
  assert.equal(state.social.rel.kunle.p, 6);
  const broke = atPeople({ cash: 100 });
  const refused = dispatch(broke, { type: 'activity', payload: { id: 'npc-kunle-drink' } }, ctxAt());
  assert.equal(refused.code, 'insufficient_funds'); assert.match(refused.reason, /₦300/);
});

test('Crack Joke: 60% base chance, deterministic outcome, a flop gives no closeness', () => {
  reset();
  const fresh = atPeople();
  const joke = NPC_ACTIONS.find((action) => action.id === 'joke');
  assert.equal(jokeChance(fresh, 'kunle', joke, true, ctxAt()), 60);
  assert.equal(viewLife(fresh, ctxAt()).social.here[0].actions.find((action) => action.id === 'joke').chance, 60);
  assert.equal(jokeChance(atPeople({ social: { rel: { kunle: { p: 40, npc: true } } }, skills: { charisma: 300 } }), 'kunle', joke, true, ctxAt()), 80);
  const outcome = (seed) => { const state = atPeople(); run(state, 'npc-kunle-joke', NOW, seed); return [state.social.rel.kunle.p, state.needs.fun, state.message]; };
  assert.deepEqual(outcome('same'), outcome('same'));
  probe.chance = 0;
  const flop = atPeople(); run(flop, 'npc-kunle-joke');
  assert.equal(flop.social.rel.kunle.p, 0); assert.equal(flop.social.rel.kunle.n, 1, 'a flop still uses one of the day’s interactions');
  assert.equal(flop.needs.fun, 52); assert.match(flop.message, /did not land/);
  assert.deepEqual(probe.events.at(-1), ['npc.interacted', { npc: 'kunle', action: 'joke', success: false }]);
  probe.chance = 100;
  const hit = atPeople(); run(hit, 'npc-kunle-joke');
  assert.equal(hit.social.rel.kunle.p, 5); assert.equal(hit.needs.fun, 60); assert.equal(hit.needs.social, 58);
});

test('family calls work anywhere: first call of the day checks in, repeats give little, streak counts days', () => {
  reset();
  const state = createLife({ location: 'library' }, ctxAt()); state.t = NOW;
  const call = (id, now = NOW) => { const result = dispatch(state, { type: 'social.call', payload: { id } }, ctxAt(now)); if (result.ok) advanceLife(state, 30, ctxAt(now + 30000)); return result; };
  assert.equal(dispatch(state, { type: 'social.call', payload: { id: 'kunle' } }, ctxAt()).code, 'invalid_contact');
  assert.equal(dispatch(state, { type: 'social.call', payload: { id: '__proto__' } }, ctxAt()).code, 'invalid_contact');
  assert.equal(dispatch(state, { type: 'social.call', payload: { id: 'mummy' } }, ctxAt()).code, 'calling');
  assert.equal(viewLife(state, ctxAt()).social.calling, 'mummy');
  assert.equal(dispatch(state, { type: 'social.call', payload: { id: 'daddy' } }, ctxAt()).code, 'busy');
  assert.equal(dispatch(state, { type: 'cancel' }, ctxAt()).code, 'cancelled');
  assert.equal(state.needs.social, 50, 'a cancelled call gives nothing');
  assert.equal(call('mummy').ok, true);
  assert.equal(state.needs.social, 60); assert.equal(state.activeAction, null);
  assert.ok(state.moodlets.some((moodlet) => moodlet.id === 'family-checkin' && moodlet.value === 5));
  assert.match(state.message, /^Mummy: “/);
  assert.deepEqual(probe.events.at(-1), ['npc.interacted', { npc: 'mummy', action: 'call', success: true }]);
  let view = viewLife(state, ctxAt(NOW + 60000)).social;
  assert.equal(view.family.find((member) => member.id === 'mummy').calledToday, true); assert.equal(view.streak, 1);
  call('mummy', NOW + 120000);
  assert.equal(state.needs.social, 62, 'a second call the same day is only a quick hello');
  call('daddy', NOW + DAY);
  view = viewLife(state, ctxAt(NOW + DAY + 60000)).social;
  assert.equal(view.streak, 2); assert.equal(view.family.find((member) => member.id === 'mummy').calledToday, false);
  assert.equal(viewLife(state, ctxAt(NOW + 4 * DAY)).social.streak, 0, 'a missed day ends the streak');
  // A call in progress survives a reload; a forged one does not.
  dispatch(state, { type: 'social.call', payload: { id: 'tobi' } }, ctxAt(NOW + 2 * DAY));
  assert.equal(createLife(JSON.parse(JSON.stringify(state)), ctxAt()).activeAction.id, 'tobi');
  assert.equal(createLife({ activeAction: { kind: 'call', id: 'ghost', duration: 8, remaining: 4 } }, ctxAt()).activeAction, null);
  assert.equal(createLife({ activeAction: { kind: 'call', id: 'mummy', duration: 800, remaining: 4 } }, ctxAt()).activeAction, null);
});

test('transfers: only money earned from work can be given, within daily and per-gift caps, logged in both ledgers', () => {
  reset();
  const sender = createLife({ cash: 50000 }, ctxAt()); sender.t = NOW;
  const send = (amount, now = NOW) => serverOp(sender, 'transfer-out', { to: PLAYER, name: 'Bola', amount }, ctxAt(now));
  let result = send(500);
  assert.equal(result.code, 'earn_first'); assert.match(result.reason, /Earn at least ₦1,000 from paid work/); assert.equal(sender.cash, 50000);
  // Earnings are counted from paid activities, not from cash on hand.
  const worker = createLife({ job: 'community-helper', location: 'park', spot: 'work' }, ctxAt()); worker.t = NOW;
  run(worker, 'helper-shift');
  assert.equal(worker.social.earned, 300);
  sender.social.earned = 7000;
  assert.equal(send(50).code, 'amount_too_small'); assert.equal(send(5001).code, 'amount_too_large'); assert.equal(send(2.5).code, 'amount_too_small');
  assert.equal(serverOp(sender, 'transfer-out', { to: 'nobody', name: 'x', amount: 500 }, ctxAt()).code, 'invalid_transfer');
  assert.equal(serverOp(sender, 'transfer-check', { to: PLAYER, amount: 500 }, ctxAt()).code, 'allowed'); assert.equal(sender.cash, 50000);
  result = send(4000);
  assert.equal(result.code, 'sent'); assert.equal(sender.cash, 46000);
  assert.deepEqual({ amount: sender.ledger.at(-1).amount, reason: sender.ledger.at(-1).reason }, { amount: -4000, reason: 'Transfer to Bola' });
  assert.deepEqual(probe.events.at(-1), ['transfer.sent', { to: PLAYER, amount: 4000 }]);
  result = send(4000);
  assert.equal(result.code, 'gift_exceeds_earned'); assert.match(result.reason, /You can still give ₦3,000/);
  assert.equal(send(1000).code, 'sent'); assert.equal(send(1000).code, 'sent');
  result = send(500);
  assert.equal(result.code, 'daily_transfer_limit'); assert.match(result.reason, /3 gifts today/);
  assert.equal(send(500, NOW + DAY).code, 'sent', 'the daily count resets');
  sender.social.earned = 100000;
  assert.equal(send(5000, NOW + 2 * DAY).code, 'sent'); assert.equal(send(5000, NOW + 2 * DAY).code, 'sent');
  assert.match(send(500, NOW + 2 * DAY).reason, /₦0 is left today|3 gifts today/);
  const poor = createLife({ cash: 200 }, ctxAt()); poor.social.earned = 5000;
  assert.equal(serverOp(poor, 'transfer-out', { to: PLAYER, name: 'Bola', amount: 500 }, ctxAt()).code, 'insufficient_funds');

  const receiver = createLife(null, ctxAt());
  result = serverOp(receiver, 'transfer-in', { from: OTHER, name: 'Ada', amount: 4000 }, ctxAt());
  assert.equal(result.code, 'received'); assert.equal(receiver.cash, 9000);
  assert.equal(receiver.ledger.at(-1).reason, 'Transfer from Ada');
  assert.deepEqual(probe.events.at(-1), ['transfer.received', { from: OTHER, amount: 4000 }]);
  assert.equal(receiver.social.earned, 0, 'a gift is not earnings, so it cannot be passed on');
  assert.deepEqual(receiver.social.notices, [], 'the gift is announced once, by the server’s update to the recipient — not a second time by the life');
  const full = createLife({ cash: Number.MAX_SAFE_INTEGER }, ctxAt());
  assert.equal(serverOp(full, 'transfer-in', { from: OTHER, name: 'Ada', amount: 100 }, ctxAt()).code, 'balance_limit');
  for (const amount of [-5, 0, 1.5, '100', null]) assert.equal(serverOp(receiver, 'transfer-in', { from: OTHER, name: 'Ada', amount }, ctxAt()).code, 'invalid_transfer');
  assert.equal(serverOp(receiver, 'no-such-op', {}, ctxAt()).code, 'invalid_operation');
  assert.equal(serverOp(receiver, 'constructor', {}, ctxAt()).code, 'invalid_operation');
});

test('player friendships, interactions and Bae are recorded only through server operations', () => {
  reset();
  const state = createLife(null, ctxAt()); state.t = NOW;
  assert.equal(serverOp(state, 'friend', { id: PLAYER, name: 'Bola' }, ctxAt()).code, 'friend_made');
  assert.deepEqual(probe.events[0], ['friend.made', { id: PLAYER, npc: false }]);
  assert.equal(serverOp(state, 'friend', { id: PLAYER, name: 'Bola' }, ctxAt()).code, 'already_friends');
  assert.equal(names().filter((name) => name === 'friend.made').length, 1);
  assert.equal(serverOp(state, 'friend', { id: 'kunle', name: 'x' }, ctxAt()).code, 'invalid_friend');
  let check = serverOp(state, 'bae-check', { id: PLAYER }, ctxAt());
  assert.equal(check.code, 'closeness_required'); assert.match(check.reason, /0\/40/);
  for (let i = 0; i < DAILY_INTERACTIONS; i++) assert.equal(serverOp(state, 'interact', { id: PLAYER, name: 'Bola', action: 'gist' }, ctxAt(NOW, `g${i}`)).code, 'interacted');
  assert.equal(state.social.rel[PLAYER].p, 12); assert.equal(state.needs.social, 82); assert.equal(state.skills.charisma, 24);
  const limited = serverOp(state, 'interact', { id: PLAYER, name: 'Bola', action: 'hello' }, ctxAt());
  assert.equal(limited.code, 'daily_limit'); assert.match(limited.reason, /4 interactions today/);
  assert.equal(serverOp(state, 'interact', { id: PLAYER, name: 'Bola', action: 'drink' }, ctxAt(NOW + DAY)).code, 'invalid_interaction');
  state.social.rel[PLAYER].p = 40;
  assert.equal(serverOp(state, 'bae-check', { id: PLAYER }, ctxAt()).code, 'allowed');
  assert.equal(serverOp(state, 'bae', { id: PLAYER, name: 'Bola' }, ctxAt()).code, 'bae');
  assert.equal(serverOp(state, 'bae', { id: OTHER, name: 'Chi' }, ctxAt()).code, 'already_have_bae');
  const view = viewLife(state, ctxAt()).social;
  assert.equal(view.bae, PLAYER); assert.equal(view.relationships[0].tierLabel, 'Bae'); assert.equal(view.friends[0].name, 'Bola'); assert.equal(view.paddyCount, 1);
  serverOp(state, 'unfriend', { id: PLAYER }, ctxAt());
  assert.equal(state.social.bae, null); assert.equal(viewLife(state, ctxAt()).social.friends.length, 0);
});

test('sanitize rebuilds the slice from hostile saves and keeps a valid one unchanged', () => {
  for (const junk of ['text', 7, [], null, { rel: 'x', bae: {}, family: [1], streak: 9, earned: -5, transfer: 'no', notices: {} }]) {
    const state = createLife({ social: junk }, ctxAt());
    assert.deepEqual(state.social, { rel: {}, bae: null, family: {}, streak: { day: 0, count: 0 }, earned: 0, transfer: { day: 0, sent: 0, count: 0, total: 0 }, notices: [] });
  }
  const hostile = createLife({ social: {
    rel: { kunle: { p: 1e9, npc: true, n: 999, d: -1 }, ghost: { p: 5, npc: true }, [PLAYER]: { p: 12, npc: false, name: 'A\u0000da<script>'.repeat(9), friend: 'yes' }, __proto__: { p: 1 }, 'not a uuid': { p: 3, npc: false }, [OTHER]: { p: 'lots' } },
    bae: 'kunle', family: { mummy: 5, stranger: 5, daddy: -1 }, streak: { day: 1, count: 1e99 }, earned: 1e308, transfer: { day: 3, sent: -1, count: 2.5, total: 10 },
    notices: [{ id: 1, at: 5, text: 'ok\u0007' }, { id: 'x', at: 5, text: 'bad' }, 'nope'],
  } }, ctxAt());
  assert.deepEqual(Object.keys(hostile.social.rel).sort(), [PLAYER, 'kunle'].sort());
  assert.deepEqual(hostile.social.rel.kunle, { p: 100, d: 0, n: DAILY_INTERACTIONS, npc: true, at: 0 });
  assert.equal(hostile.social.rel[PLAYER].name.length, 24); assert.ok(!hostile.social.rel[PLAYER].name.includes('\u0000')); assert.equal(hostile.social.rel[PLAYER].friend, undefined);
  assert.equal(hostile.social.bae, null);
  assert.deepEqual(hostile.social.family, { mummy: 5 });
  assert.deepEqual(hostile.social.streak, { day: 0, count: 0 });
  assert.equal(hostile.social.earned, 0);
  assert.deepEqual(hostile.social.transfer, { day: 3, sent: 0, count: 0, total: 10 });
  assert.deepEqual(hostile.social.notices, [{ id: 1, kind: 'notice', text: 'ok', at: 5 }]);
  const valid = atPeople(); run(valid, 'npc-kunle-hello');
  assert.deepEqual(createLife(JSON.parse(JSON.stringify(valid)), ctxAt()).social, valid.social);
  assert.equal(typeof viewLife(hostile, ctxAt()).social, 'object');
});

test('any system can post a notice for the Updates tab', async () => {
  const { emit } = await import('./registry.ts');
  const state = createLife(null, ctxAt());
  emit(state, 'notice.posted', { kind: 'rent', text: 'Rent of ₦6,000 is due on Friday.' }, ctxAt());
  emit(state, 'notice.posted', 'junk', ctxAt());
  for (let i = 0; i < 30; i++) emit(state, 'notice.posted', { text: `n${i}` }, ctxAt());
  assert.equal(state.social.notices.length, 20);
  assert.equal(viewLife(state, ctxAt()).social.notices[0].text, 'n29');
});

test('outbox: pending → sent or failed, retry keeps the client id, a confirmed message never shows twice', async () => {
  const { createOutbox, mergeMessages, presenceText, roomSummary, inviteIdFrom, SEND_TIMEOUT_MS, FAILURE_TEXT } = await import('./social-model.ts');
  const outbox = createOutbox();
  const first = outbox.add('dm.a.b', 'How far?', 'c-00000001', 1000);
  assert.deepEqual([first.status, first.tries], ['pending', 1]);
  assert.deepEqual(outbox.thread('dm.a.b', []).map((item) => [item.body, item.status]), [['How far?', 'pending']]);
  assert.deepEqual(outbox.thread('dm.other', []), []);
  // No answer: it fails visibly instead of stalling, and can be retried under the same id.
  assert.equal(outbox.expire(1000 + SEND_TIMEOUT_MS - 1), false);
  assert.equal(outbox.expire(1000 + SEND_TIMEOUT_MS), true);
  assert.deepEqual([first.status, first.reason, first.code], ['failed', FAILURE_TEXT, 'timeout']);
  assert.equal(outbox.retry('c-unknown', 0), null);
  const again = outbox.retry('c-00000001', 20000);
  assert.deepEqual([again.clientId, again.status, again.tries], ['c-00000001', 'pending', 2]);
  assert.equal(outbox.retry('c-00000001', 20001), null, 'a pending message cannot be sent a second time');
  // The server shows the message (even if our own reply was lost): the local copy goes away.
  const server = [{ seq: 1, body: 'How far?', clientId: 'c-00000001' }];
  assert.deepEqual(outbox.thread('dm.a.b', server), server); assert.equal(outbox.size(), 0);
  // A refusal keeps the text with its reason.
  outbox.add('dm.a.b', 'again', 'c-00000002', 30000);
  outbox.fail('c-00000002', 'Bola has not replied yet.', 'awaiting_reply');
  assert.deepEqual(outbox.thread('dm.a.b', server).map((item) => item.status ?? 'sent'), ['sent', 'failed']);
  outbox.add('to:x', 'new chat', 'c-00000003', 40000); outbox.rekey('to:x', 'dm.a.x');
  assert.equal(outbox.thread('dm.a.x', []).length, 1);
  assert.deepEqual(mergeMessages([{ seq: 2, body: 'b' }, { seq: 1, body: 'a' }], [{ seq: 2, body: 'b' }, { seq: 3, body: 'c' }, null, { seq: 'x' }]).map((item) => item.seq), [1, 2, 3]);

  assert.equal(presenceText({ status: 'online', venue: 'park' }, () => 'Freedom Park'), 'Online · Freedom Park');
  assert.equal(presenceText({ status: 'online', venue: 'home' }), 'Online · at home');
  assert.deepEqual(['away', 'reconnecting', 'offline', 'nonsense'].map((status) => presenceText({ status })), ['Away', 'Reconnecting…', 'Offline', 'Offline']);
  // An offline listing that carries `seenAt` says when; reconnecting stays its own word; without a clock nothing is invented.
  const minute = 60000, seen = 1_000_000_000;
  assert.deepEqual([20000, 5 * minute, 3 * 60 * minute, 26 * 60 * minute, 49 * 60 * minute].map((ago) => presenceText({ status: 'offline', seenAt: seen }, undefined, seen + ago)),
    ['Offline · last seen just now', 'Offline · last seen 5 min ago', 'Offline · last seen 3 h ago', 'Offline · last seen 1 day ago', 'Offline · last seen 2 days ago']);
  assert.equal(presenceText({ status: 'reconnecting', seenAt: seen }, undefined, seen + minute), 'Reconnecting…');
  assert.equal(presenceText({ status: 'offline', seenAt: seen }), 'Offline');
  assert.equal(presenceText({ status: 'offline' }, undefined, seen), 'Offline');
  assert.equal(presenceText({ status: 'online', venue: 'park', seenAt: seen }, () => 'Freedom Park', seen + minute), 'Online · Freedom Park');
  assert.match(roomSummary({ venue: 'park', self: 'not_joined', count: 0 }, 'Freedom Park'), /cannot see you here yet/);
  assert.match(roomSummary({ venue: 'park', self: 'joined', count: 1 }, 'Freedom Park'), /^1 other player here/);
  assert.match(roomSummary(null, 'x'), /Checking/);
  assert.equal(inviteIdFrom(`https://example.test/v/${PLAYER}`), PLAYER); assert.equal(inviteIdFrom(`/?v=${PLAYER}&x=1`), PLAYER); assert.equal(inviteIdFrom(PLAYER.toUpperCase()), PLAYER);
  for (const junk of ['', 'javascript:alert(1)', '/v/not-an-id', `${PLAYER}0`, null]) assert.equal(inviteIdFrom(junk), null);
});

test('a changed device session starts from a blank social state: nothing of the previous identity is left to show', async () => {
  const { freshSocial, createOutbox } = await import('./social-model.ts');
  // What a browser holds after playing as one identity…
  const S = { api: {}, socket: 'open', linkHost: null, ...freshSocial() };
  Object.assign(S, { me: { name: 'Ada', friends: [{ id: 'bola' }], requests: { in: [{ id: 'x' }] }, conversations: [{ id: 'c1', unread: 2 }] }, people: { players: [{ id: 'bola' }] }, peopleAt: 5, error: 'old', openConv: 'c1',
    knock: { host: 'bola', status: 'knocking' }, houseRoom: { host: 'bola', members: [] } });
  S.threads.set('c1', { messages: [{ body: 'secret' }], loaded: true }); S.profiles.set('bola', { name: 'Bola' });
  const outbox = createOutbox();
  outbox.add('c1', 'unsent words', 'client-1', 1);
  // …is all gone when the session changes (src/ui/panels/social-client.js resetSocial does exactly this).
  Object.assign(S, freshSocial()); outbox.clear();
  assert.deepEqual([S.me, S.people, S.peopleAt, S.error, S.openConv, S.knock, S.houseRoom, S.loading, S.peopleLoading], [null, null, 0, null, null, null, null, false, false]);
  assert.deepEqual([S.threads.size, S.profiles.size, outbox.get('client-1'), outbox.thread('c1', []).length], [0, 0, null, 0]);
  assert.notEqual(freshSocial().threads, freshSocial().threads, 'each reset gets its own maps');
  const source = (await import('node:fs')).readFileSync(new URL('../ui/panels/social-client.js', import.meta.url), 'utf8');
  assert.match(source, /export function resetSocial\(\) \{\n  Object\.assign\(S, freshSocial\(\)\);\n  outbox\.clear\(\);/);
  const main = (await import('node:fs')).readFileSync(new URL('../life-main.js', import.meta.url), 'utf8');
  assert.match(main, /onSession\(session, isNew\) \{ sessionChanged\(/, 'the entry resets on every session the client reports');
  assert.match(main, /onSessionExpired\(\) \{[^\n]*sessionChanged\(null\)/, 'and when the saved life is gone');
});
