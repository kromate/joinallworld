// OWNER: quick start — the pure client logic of the first minute (./model.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { joinIdFrom, joinBanner, linkParts, linkBanner, GIFT_LINE, NUDGE_CAP, NUDGE_QUIET_MS, nudgeMemory, nextNudge, nudged, funnelSnap, funnelEvents } from './model.ts';
import type { JoinBanner } from './model.ts';
import type { Look } from '../types/life.ts';
import { NAME_MOODS, NAME_STEMS, suggestName, nameProblem, starterLook, PRESETS, presetLook, shuffleLook, withBody, draftFrom } from './look-model.ts';
import { checkLook } from '../game/systems/onboarding.ts';
import { validateName } from '../../server/protocol.ts';
import { makeRng } from '../game/util.ts';
import { createLife, dispatch, advanceLife } from '../life.ts';

const ID = '36f5f5a1-493e-474f-b23c-3a2e503ada54';
/** A banner that must have been made. */
const shown = (banner: JoinBanner | null): JoinBanner => { assert.ok(banner, 'there is a banner'); return banner; };

test('every suggested name is one the server accepts, and the pre-check agrees with the server on length', () => {
  for (const mood of NAME_MOODS) for (const stem of NAME_STEMS) assert.equal(validateName(`${mood} ${stem}`), `${mood} ${stem}`);
  const random = makeRng('names');
  for (let i = 0; i < 50; i++) assert.equal(nameProblem(suggestName(random)), null);
  for (const bad of ['', 'ab', '  a  ', 'x'.repeat(25), 'tab\tname', null, 7]) {
    assert.ok(nameProblem(bad), JSON.stringify(bad));
    assert.throws(() => validateName(bad));
  }
  assert.equal(nameProblem('  Ada  '), null);
});

test('presets and shuffles are looks the server accepts for a new Sim; anything else is dropped, not sent', () => {
  assert.ok(PRESETS.length >= 4 && PRESETS.length <= 5);
  for (const preset of PRESETS) assert.ok(checkLook(presetLook(preset.id), { starter: true }).look, preset.id);
  assert.equal(presetLook('nope'), null);
  const random = makeRng('shuffle');
  const bodies = new Set();
  for (let i = 0; i < 400; i++) {
    const look = shuffleLook(random);
    const checked = checkLook(look, { starter: true });
    assert.ok(checked.look, `${JSON.stringify(look)}: ${checked.reason}`);
    bodies.add(look.body);
    const other = withBody(look, look.body === 'man' ? 'woman' : 'man');
    assert.ok(checkLook(other, { starter: true }).look, 'the other body is valid too');
    assert.equal(withBody(look, 'robot'), look);
  }
  assert.equal(bodies.size, 2);
  const good = presetLook('street');
  for (const bad of [null, 'x', {}, { ...good, body: 'robot' }, { ...good, hair: 'gele' }, { ...good, hair: 'twists' }, { ...good, outfit: 'agbada' }, { ...good, skin: '#fff' },
    { ...good, accessories: ['sunglasses'] }, { ...good, accessories: ['glasses', 'glasses'] }, { ...good, accessories: 'cap' }]) assert.equal(starterLook(bad), null, JSON.stringify(bad));
  assert.deepEqual(starterLook({ ...good, face: 'square', expression: 7, extra: '<b>' }), good, 'unknown optional parts fall back; unknown keys are dropped');
});

test('the draft is rebuilt from untrusted storage and is always ready to play', () => {
  const now = 5000, random = () => 0;
  const fresh = draftFrom(null, { random, now });
  assert.deepEqual([fresh.name, fresh.landedAt, fresh.nameEdited, fresh.shuffles, fresh.preset], ['Sunny Tobi', 5000, false, 0, 'street']);
  assert.ok(checkLook(fresh.look, { starter: true }).look);
  const kept = draftFrom({ name: ' Zee ', look: presetLook('owambe'), landedAt: 4000, nameEdited: true, shuffles: 3, preset: 'owambe' }, { random, now });
  assert.deepEqual([kept.name, kept.landedAt, kept.nameEdited, kept.shuffles, kept.preset, kept.look.hair], ['Zee', 4000, true, 3, 'owambe', 'gele']);
  // Hostile or stale storage: every part falls back by itself.
  const hostile = draftFrom({ name: 'x', look: { body: 'man', hair: '<script>' }, landedAt: 9e15, nameEdited: 'yes', shuffles: -1, preset: '__proto__' }, { random, now, name: 'Bola' });
  assert.deepEqual([hostile.name, hostile.landedAt, hostile.nameEdited, hostile.shuffles, hostile.preset], ['Bola', 5000, false, 0, 'street']);
  assert.equal(draftFrom('junk', { random, now, name: 'x' }).name, 'Sunny Tobi');
});

test('the landing hook reads /v/<id>, ?join=<id> and ?v=<id>, and nothing else', () => {
  assert.equal(joinIdFrom(`/v/${ID}`, ''), ID);
  assert.equal(joinIdFrom(`/v/${ID.toUpperCase()}/`, ''), ID);
  assert.equal(joinIdFrom('/', `?join=${ID}`), ID);
  assert.equal(joinIdFrom('/', `?utm=x&join=${ID}&y=1`), ID);
  assert.equal(joinIdFrom('/', `?v=${ID}`), ID);
  for (const [path, search] of [['/', ''], ['/v/nope', ''], [`/x/${ID}`, ''], ['/', `?joined=${ID}`], ['/', '?join=<script>'], [`/v/${ID}x`, ''], [null, undefined]]) assert.equal(joinIdFrom(path, search), null);
  const places: Record<string, string> = { park: 'Freedom Park' };
  const label = (id: string): string => places[id] ?? 'the city';
  assert.deepEqual(joinBanner({ ok: true, code: 'joined', host: { name: 'Ada' }, venue: 'park' }, label), { tone: 'good', title: 'You’re joining Ada', text: 'Ada is at Freedom Park right now — so are you. Look for their name tag.', knock: false });
  assert.equal(shown(joinBanner({ ok: true, code: 'at_home', host: { name: 'Ada' } }, label)).knock, true);
  for (const code of ['offline', 'out', 'reconnecting']) { const banner = shown(joinBanner({ ok: true, code, host: { name: 'Ada' } }, label)); assert.deepEqual([banner.tone, banner.title, banner.knock], ['info', 'You’re joining Ada', false]); }
  for (const none of [null, { ok: false, code: 'unknown_player' }, { ok: true, code: 'joined' }]) assert.equal(joinBanner(none, label), null);
});

const NOON = Date.UTC(2026, 0, 5, 11);
test('settling in is offered at natural moments, each once, never while busy and never past the cap', () => {
  let memory = nudgeMemory(null);
  const facts = (extra: Partial<Parameters<typeof nextNudge>[0]> = {}) => ({ guest: true, activities: 0, firstAt: null, busy: false, day: 10, at: NOON, ...extra });
  assert.equal(nextNudge(facts(), memory), null, 'nothing before the first reward');
  assert.equal(nextNudge(facts({ firstAt: 7, activities: 1, busy: true }), memory), null, 'not in the middle of something');
  assert.equal(nextNudge(facts({ firstAt: 7, activities: 1 }), memory), 'first-reward');
  memory = nudged(memory, 'first-reward', 10, NOON);
  const later = NOON + NUDGE_QUIET_MS;
  assert.equal(nextNudge(facts({ firstAt: 7, activities: 2, at: later }), memory), null);
  assert.equal(nextNudge(facts({ firstAt: 7, activities: 3, at: later }), memory), 'third-activity');
  memory = nudged(memory, 'third-activity', 10, later);
  assert.equal(nextNudge(facts({ firstAt: 7, activities: 9, at: later + NUDGE_QUIET_MS }), memory), null, 'not again the same day');
  assert.equal(nextNudge(facts({ firstAt: 7, activities: 9, day: 11, at: later + NUDGE_QUIET_MS }), memory), 'next-day');
  memory = nudged(memory, 'next-day', 11, later + NUDGE_QUIET_MS);
  assert.equal(memory.count, NUDGE_CAP);
  assert.equal(nextNudge(facts({ firstAt: 7, activities: 9, day: 12, at: later + 3 * NUDGE_QUIET_MS }), memory), null, 'capped');
  assert.equal(nextNudge(facts({ guest: false, firstAt: 7, activities: 9 }), nudgeMemory(null)), null, 'never for a settled life');
  assert.deepEqual(nudgeMemory({ count: -3, reasons: [1, 'x', {}], day: 'today', until: 'soon' }), { count: 0, reasons: ['x'], day: null, until: null });
  assert.deepEqual(nudgeMemory(JSON.parse(JSON.stringify(memory))), memory, 'survives storage');
});

test('Not now holds: an offer that was set aside stays quiet through a reload, a later moment the same day and a midnight, then comes back by the usual rules', () => {
  const at = Date.UTC(2026, 0, 5, 22, 58); // Lagos 23:58
  let memory = nudged(nudgeMemory(null), 'first-reward', 20458, at);
  assert.equal(memory.until, at + NUDGE_QUIET_MS);
  memory = nudgeMemory(JSON.parse(JSON.stringify(memory))); // a reload: only what storage kept
  const facts = (extra: Partial<Parameters<typeof nextNudge>[0]> = {}) => ({ guest: true, activities: 9, firstAt: 7, busy: false, day: 20458, at, ...extra });
  assert.equal(nextNudge(facts(), memory), null, 'right after the reload');
  assert.equal(nextNudge(facts({ at: at + 3 * 60000, day: 20459 }), memory), null, 'three minutes later, past midnight: the next-day rule does not fire inside the quiet period');
  assert.equal(nextNudge(facts({ at: at + NUDGE_QUIET_MS - 1, day: 20459 }), memory), null, 'one millisecond before it ends');
  assert.equal(nextNudge(facts({ at: at + NUDGE_QUIET_MS, day: 20459 }), memory), 'third-activity', 'when it ends the usual rules apply');
  assert.equal(nextNudge(facts({ at: at - 5 * NUDGE_QUIET_MS }), memory), 'third-activity', 'a remembered time further ahead than one quiet period is a moved clock, not a reason to stay quiet');
  assert.equal(nextNudge(facts({ guest: false }), memory), null);
});

test('funnel events come from the server state, once each', () => {
  const now = Date.UTC(2026, 0, 5, 9), at = (ms = 0, id = 'a') => ({ now: now + ms, cityId: 'lagos', actionId: id });
  const state = createLife(null, { ...at(), isNew: true, quickStart: true });
  const names: string[] = [];
  let before = funnelSnap(state);
  const step = () => { const after = funnelSnap(state); const events = funnelEvents(before, after); names.push(...events.map((event) => event.name)); before = after; assert.deepEqual(funnelEvents(after, after), [], 'nothing twice'); return events; };
  const look = presetLook('street');
  assert.ok(look, 'the street preset exists');
  // look-model.js is not typed yet: its Look is the loose string shape, and presetLook only returns looks the server accepts.
  dispatch(state, { type: 'onboarding.quick-start', payload: { look: look as Look } }, at(1000, 'q'));
  assert.deepEqual(step(), [{ name: 'arrived', props: { venue: 'park' } }]);
  dispatch(state, { type: 'activity', payload: { id: 'play-ayo' } }, at(2000, 'p'));
  assert.deepEqual(step(), [{ name: 'first_activity_started', props: { activity: 'play-ayo', venue: 'park' } }]);
  advanceLife(state, 7, at(9000));
  assert.deepEqual(step(), [{ name: 'first_activity_completed', props: { venue: 'park' } }]);
  dispatch(state, { type: 'activity', payload: { id: 'chill' } }, at(10000, 'c'));
  assert.deepEqual(step(), [], 'a second activity is not a first one');
  advanceLife(state, 11, at(21000));
  dispatch(state, { type: 'onboarding.traits', payload: { traits: ['hustler', 'foodie'] } }, at(22000, 't')); step();
  dispatch(state, { type: 'onboarding.dream', payload: { dream: 'lekki-landlord' } }, at(23000, 'd')); step();
  dispatch(state, { type: 'onboarding.lottery', payload: {} }, at(24000, 'l')); step();
  assert.ok(state.onboarding.lottery, 'the lottery was rolled');
  const house = state.onboarding.lottery.id === 'ajebutter' ? 'lekki' : 'mushin';
  assert.equal(dispatch(state, { type: 'onboarding.home', payload: { house, stay: true } }, at(25000, 'h')).code, 'life_started'); step();
  assert.deepEqual(names, ['arrived', 'first_activity_started', 'first_activity_completed', 'settle_traits_done', 'settle_dream_done', 'settle_lottery_done', 'save_character_done']);
  assert.deepEqual(funnelEvents(funnelSnap(null), funnelSnap(undefined)), []);
});

test('one landing: a link’s share code and table are read by shape, and the referral rides in the one banner', () => {
  const host = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(linkParts('/', `?join=${host}&ref=abcdef0123&table=buka-corner`), { ref: 'abcdef0123', table: 'buka-corner' });
  assert.deepEqual(linkParts('/s/abcdef0123', ''), { ref: 'abcdef0123', table: null }, 'a host that serves the game for /s/<code> still lands the code');
  assert.deepEqual(linkParts('/', '?s=abcdef0123'), { ref: 'abcdef0123', table: null }, 'the older query form');
  for (const search of ['?ref=<script>', '?ref=ABCDEF0123', '?ref=short', '?table=../../etc', '?table=Buka', `?table=${'a'.repeat(41)}`, '?ref=abcdef0123x-']) {
    assert.deepEqual(linkParts('/', search), { ref: null, table: null }, search);
  }
  assert.equal(joinIdFrom('/', `?join=${host}&ref=abcdef0123&table=buka-corner`), host, 'the same link still names the player to join');
  const label = () => 'Amala Shitta', joined = { ok: true, code: 'joined', host: { name: 'Ada' }, venue: 'amala-shitta' };
  const plain = shown(joinBanner(joined, label)), gift = shown(joinBanner(joined, label, { gift: true }));
  assert.equal(plain.title, 'You’re joining Ada'); assert.equal(gift.title, plain.title);
  assert.equal(gift.text, `${plain.text} ${GIFT_LINE}`, 'one banner: where they are, and what the link is worth');
  assert.match(GIFT_LINE, /paid shift/, 'the gift is promised only for real work');
  assert.equal(joinBanner({ ok: false }, label, { gift: true }), null);
  assert.deepEqual(linkBanner('Ada'), { tone: 'good', title: 'You came through Ada’s link', text: GIFT_LINE, knock: false });
});
