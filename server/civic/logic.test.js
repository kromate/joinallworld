// OWNER: civic — tests for the pure civic rules: server/civic/*.js and src/game/systems/civic.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createLife, dispatch, advanceLife, viewLife, actionTypes } from '../../src/life.js';
import { makeContext } from '../../src/game/util.js';
import { lagosTime, lagosDayStart, isOpen, minutesUntilOpen } from '../../src/game/clock.js';
import { blockReason, spotsOf } from '../../src/game/api.js';
import { VENUES } from '../../src/game/content/venues.js';
import { systems } from '../../src/game/registry.js';
import { ELECTION, HUNT, RADIO, SEA_PLOTS, BILLBOARDS, AD_COLOURS, AD_ICONS } from '../../src/game/content/civic.js';
import civicSystem, { adSlot, gemsFor, searchForGem, claimHuntPrize, fileCandidacy, castVote, payForAd, payForShoutout, civicEligibility } from '../../src/game/systems/civic.js';
import { cleanLine } from './text.js';
import { cityOf, emptyCivic } from './data.js';
import { timeline, phaseAt, tally, winnerOf, governorAt, declare, declareBlock, vote, voteBlock, announce, announceBlock, govView, notices } from './elections.js';
import { validateCreative, rentBlock, rent, adsView } from './ads.js';
import { addShoutout, radioView, shoutBlock, validateSong } from './radio.js';
import { checkIn, counters, neighboursView, richListView, houseOf } from './residents.js';

const DAY = 86400000;
const MONDAY = lagosDayStart(4); // first Monday after the epoch, 00:00 Lagos time
const at = (now, seed = 't') => makeContext({ now, cityId: 'lagos', seed });
const city = () => cityOf(emptyCivic(), 'lagos');
const life = (now = MONDAY) => createLife(null, { now, cityId: 'lagos', isNew: true });

test('the weekly cycle: nominations Monday–Wednesday, voting Thursday–Saturday, results on Sunday', () => {
  const times = timeline(1);
  assert.equal(times.nominationsAt, MONDAY);
  assert.equal(times.votingAt, MONDAY + 3 * DAY);
  assert.equal(times.closesAt, MONDAY + 6 * DAY);
  assert.equal(times.termEndsAt, MONDAY + 13 * DAY);
  assert.equal(lagosTime(MONDAY).weekday, 1);
  for (const [offset, phase] of [[0, 'nominations'], [3 * DAY - 1, 'nominations'], [3 * DAY, 'voting'], [6 * DAY - 1, 'voting'], [6 * DAY, 'results'], [7 * DAY - 1, 'results'], [7 * DAY, 'nominations']]) {
    assert.equal(phaseAt(MONDAY + offset).phase, phase, String(offset));
  }
  assert.equal(phaseAt(MONDAY).endsAt, times.votingAt);
  assert.equal(phaseAt(MONDAY + 6 * DAY).endsAt, MONDAY + 7 * DAY);
  assert.equal(phaseAt(MONDAY + 7 * DAY).week, 2);
});

test('tally and winner: most votes, then earlier declaration, then smaller id; no votes means no winner', () => {
  const election = { candidates: { b: { name: 'Bola', slogan: 's', at: 20 }, a: { name: 'Ada', slogan: 's', at: 10 }, c: { name: 'Chidi', slogan: 's', at: 10 } }, votes: {} };
  assert.equal(winnerOf(election), null, 'nobody voted');
  assert.equal(winnerOf(undefined), null);
  election.votes = { v1: 'b', v2: 'a', v3: 'c' };
  assert.deepEqual(tally(election).map((item) => item.id), ['a', 'c', 'b'], 'three-way tie: earlier declaration first, then id');
  assert.equal(winnerOf(election).id, 'a');
  election.votes.v4 = 'b';
  assert.equal(winnerOf(election).id, 'b');
  election.votes.v5 = 'ghost';
  assert.equal(tally(election).reduce((sum, item) => sum + item.votes, 0), 4, 'a vote for a non-candidate is never counted');
});

test('an election end to end on the pure rules: gates name the phase, the term lasts a week', () => {
  const data = city(), ada = { id: 'ada', name: 'Ada' }, bola = { id: 'bola', name: 'Bola' };
  assert.equal(governorAt(data, MONDAY), null);
  assert.equal(voteBlock(data, MONDAY, 'ada', 'ada').code, 'polls_closed');
  assert.equal(declareBlock(data, MONDAY, 'ada'), null);
  declare(data, MONDAY, ada, 'Light for all');
  assert.equal(declareBlock(data, MONDAY + 1, 'ada').code, 'already_candidate');
  declare(data, MONDAY + 5, bola, 'Roads first');
  const thursday = MONDAY + 3 * DAY;
  assert.equal(declareBlock(data, thursday, 'chidi').code, 'nominations_closed');
  assert.match(declareBlock(data, thursday, 'chidi').reason, /Monday/);
  assert.equal(voteBlock(data, thursday, 'v1', 'nobody').code, 'unknown_candidate');
  assert.equal(voteBlock(data, thursday, 'v1', '__proto__').code, 'unknown_candidate');
  for (const [voter, candidate] of [['v1', 'bola'], ['v2', 'bola'], ['ada', 'ada']]) { assert.equal(voteBlock(data, thursday, voter, candidate), null); vote(data, thursday, voter, candidate); }
  assert.equal(voteBlock(data, thursday, 'v1', 'ada').code, 'already_voted');
  const live = govView(data, thursday, 'v1');
  assert.deepEqual(live.election.candidates.map((item) => [item.name, item.votes]), [['Bola', 2], ['Ada', 1]]);
  assert.equal(live.election.yourVote, 'bola'); assert.equal(live.governor, null, 'no Governor until the polls close');
  const sunday = MONDAY + 6 * DAY;
  assert.equal(governorAt(data, sunday - 1), null);
  const governor = governorAt(data, sunday);
  assert.equal(governor.id, 'bola'); assert.equal(governor.termEndsAt, sunday + 7 * DAY);
  assert.equal(governorAt(data, sunday + 7 * DAY - 1).id, 'bola');
  assert.equal(governorAt(data, sunday + 7 * DAY), null, 'the term ends when the next election closes with no winner');
  assert.equal(voteBlock(data, sunday, 'v9', 'bola').code, 'polls_closed');
  assert.equal(announceBlock(data, sunday, 'ada').code, 'not_governor');
  assert.equal(announceBlock(data, sunday, 'bola'), null);
  announce(data, sunday, bola, 'Sanitation day is Saturday', 'a1');
  assert.equal(announceBlock(data, sunday + 60000, 'bola').code, 'announcement_cooldown');
  announce(data, sunday + ELECTION.announcement.cooldownMs, bola, 'Two', 'a2'); announce(data, sunday + 2 * ELECTION.announcement.cooldownMs, bola, 'Three', 'a3');
  assert.equal(announceBlock(data, sunday + 3 * ELECTION.announcement.cooldownMs, 'bola').code, 'announcement_limit');
  assert.equal(announceBlock(data, sunday + DAY, 'bola'), null);
  const news = notices(data, sunday + 1, 'Lagos');
  assert.equal(news[0].kind, 'announcement'); assert.ok(news.some((item) => item.id === 'result-1' && /Bola is the new Governor of Lagos/.test(item.title)));
  for (let i = 0; i < 40; i++) announce(data, sunday + i, bola, `n${i}`, `x${i}`);
  assert.equal(data.gov.announcements.length, ELECTION.announcement.keep, 'announcements are capped');
  for (let week = 2; week < 14; week++) declare(data, MONDAY + (week - 1) * 7 * DAY, ada, 'Again');
  assert.ok(Object.keys(data.gov.elections).length <= ELECTION.keepElections, 'old elections are pruned');
});

test('player text: trimmed, control and invisible characters removed, length-limited, links refused', () => {
  assert.deepEqual(cleanLine('  Light \u0000for\u200b  all\n ', { max: 60 }), { ok: true, text: 'Light for all' });
  assert.equal(cleanLine('ab', { min: 3 }).code, 'text_too_short');
  assert.equal(cleanLine('\u202e\u200b', { min: 1 }).code, 'text_too_short');
  assert.equal(cleanLine('x'.repeat(61), { max: 60 }).code, 'text_too_long');
  assert.equal(cleanLine('x'.repeat(5000), { max: 60 }).code, 'text_too_long');
  for (const value of [5, null, undefined, {}, ['a']]) assert.equal(cleanLine(value).code, 'text_required');
  for (const link of ['visit https://evil.example', 'WWW.spam.ng now', 'buy at shop.com', 'bit.ly/x', 'listen at x.com', 'X.NG']) assert.equal(cleanLine(link).code, 'links_not_allowed', link);
  assert.equal(cleanLine('<img src=x onerror=alert(1)>').ok, true, 'markup is stored as text and escaped when rendered');
  assert.match(cleanLine('ab', { min: 3, what: 'Your slogan' }).reason, /Your slogan must be at least 3/);
});

test('ads: slots and prices come from content; creatives use the fixed palette only', () => {
  assert.deepEqual(adSlot('sea', 'sea-5-3'), { kind: 'sea', slot: 'sea-5-3', row: 5, col: 3, price: SEA_PLOTS.price, days: 30, label: 'Sea plot 6·4' });
  assert.equal(SEA_PLOTS.price, 100); assert.equal(SEA_PLOTS.days, 30);
  assert.equal(adSlot('sea', 'sea-0-0').price, SEA_PLOTS.shorePrice);
  for (const bad of ['sea-16-0', 'sea-0-16', 'sea-01-1', 'sea--1-1', 'sea-1', '__proto__', 5, null]) assert.equal(adSlot('sea', bad), null, String(bad));
  assert.equal(adSlot('billboard', 'bb-01').price, BILLBOARDS.price); assert.equal(adSlot('billboard', 'bb-99'), null); assert.equal(adSlot('image', 'bb-01'), null);
  assert.equal(validateCreative({ text: 'Mama Put', colour: 'green', icon: 'food' }).ok, true);
  assert.equal(validateCreative({ text: 'Mama Put', colour: '#ff0000', icon: 'food' }).code, 'invalid_colour');
  assert.equal(validateCreative({ text: 'Mama Put', colour: 'green', icon: '<svg>' }).code, 'invalid_icon');
  assert.equal(validateCreative({ text: 'see www.x.ng', colour: 'green', icon: 'food' }).code, 'links_not_allowed');
  assert.equal(validateCreative(null).code, 'text_required');
  assert.equal(new Set(AD_COLOURS.map((item) => item.id)).size, AD_COLOURS.length); assert.equal(new Set(AD_ICONS.map((item) => item.id)).size, AD_ICONS.length);

  const data = city(), ada = { id: 'ada', name: 'Ada' }, creative = { text: 'Hi', colour: 'gold', icon: 'star' };
  assert.equal(rentBlock(data, 0, 'ada', 'billboard', 'bb-99').code, 'invalid_slot');
  rent(data, 1000, ada, 'billboard', 'bb-01', creative);
  assert.equal(rentBlock(data, 2000, 'ada', 'billboard', 'bb-01').code, 'already_yours');
  assert.equal(rentBlock(data, 2000, 'bola', 'billboard', 'bb-01').code, 'slot_taken');
  rent(data, 1000, ada, 'billboard', 'bb-02', creative);
  assert.equal(rentBlock(data, 2000, 'ada', 'billboard', 'bb-03').code, 'ad_limit');
  const view = adsView(data, 2000, 'bola');
  assert.equal(view.billboards.slots.length, BILLBOARDS.slots.length);
  assert.deepEqual(view.billboards.slots[0].ad, { text: 'Hi', colour: 'gold', icon: 'star', by: ada, at: 1000, expiresAt: 1000 + 7 * DAY, mine: false, price: BILLBOARDS.price });
  assert.equal(rentBlock(data, 1000 + 7 * DAY, 'bola', 'billboard', 'bb-01'), null, 'an expired slot is free again');
  assert.equal(adsView(data, 1000 + 7 * DAY).billboards.slots[0].ad, null);
});

test('club radio: slots chain on server time, daily cap and full queue are refused with reasons', () => {
  const data = city(), ada = { id: 'ada', name: 'Ada' };
  assert.equal(shoutBlock(data, 0, 'ada', 'park').code, 'not_in_club');
  assert.equal(validateSong({ title: 'Water', artist: '' }).code, 'text_too_short');
  assert.equal(validateSong({ title: 'x'.repeat(41), artist: 'Tyla' }).code, 'text_too_long');
  const first = addShoutout(data, 1000, ada, 'library', { title: 'Water', artist: 'Tyla' }, 'r1');
  const second = addShoutout(data, 2000, ada, 'library', { title: 'Unavailable', artist: 'Davido' }, 'r2');
  assert.equal(first.startsAt, 1000); assert.equal(second.startsAt, first.endsAt); assert.equal(second.endsAt - second.startsAt, RADIO.slotSeconds * 1000);
  let view = radioView(data, 3000, 'library', 'ada');
  assert.equal(view.playing.title, 'Water'); assert.deepEqual(view.queue.map((entry) => entry.title), ['Unavailable']); assert.equal(view.usedToday, 2);
  assert.equal(JSON.stringify(view).includes('requestId'), false);
  view = radioView(data, first.endsAt, 'library');
  assert.equal(view.playing.title, 'Unavailable'); assert.equal(view.queue.length, 0);
  assert.equal(radioView(data, second.endsAt, 'library').playing, null);
  addShoutout(data, 3000, ada, 'library', { title: 'Three', artist: 'A' }, 'r3');
  assert.equal(shoutBlock(data, 4000, 'ada', 'library').code, 'shoutout_limit');
  assert.equal(shoutBlock(data, 4000 + DAY, 'ada', 'library'), null, 'the cap resets on the next Lagos day');
  const crowd = city();
  for (let i = 0; i < RADIO.queueMax; i++) addShoutout(crowd, 0, { id: `p${i}`, name: 'P' }, 'quilox', { title: 'T', artist: 'A' }, `q${i}`);
  assert.equal(shoutBlock(crowd, 0, 'new', 'quilox').code, 'queue_full');
  assert.equal(radioView(crowd, 0, 'park').club, false);
});

test('residents: counts are real, presence comes from the online check, opt-outs are hidden but counted', () => {
  const data = city(), ttl = 30 * DAY, online = (id) => id === 'ada';
  const rich = life(); rich.cash = 90000; rich.civic.week = { week: lagosTime(MONDAY).week, earned: 700 }; rich.civic.gems = 2;
  const poor = life(); poor.cash = 10; poor.property = { house: 'yaba' };
  assert.equal(houseOf(rich), 'yaba', 'in the merged game every life has a house; the default is the Yaba self-contain');
  delete rich.property; // a save from before houses existed has no district yet
  assert.equal(houseOf(poor), 'yaba'); assert.equal(houseOf(rich), null); assert.equal(houseOf({ property: { house: '__proto__' } }), null); assert.equal(houseOf(null), null);
  checkIn(data, MONDAY, { id: 'ada', name: 'Ada' }, rich, ttl);
  checkIn(data, MONDAY, { id: 'bola', name: 'Bola' }, poor, ttl);
  checkIn(data, MONDAY + 1000, { id: 'ada', name: 'Ada' }, rich, ttl);
  assert.deepEqual(counters(data, MONDAY + 1000, ttl, online), { players: 2, online: 1, visits: 2 });
  assert.equal(data.hunt.found, 2, 'gems are counted once however often the player checks in');
  checkIn(data, MONDAY + DAY, { id: 'ada', name: 'Ada' }, rich, ttl);
  assert.equal(data.visits, 3, 'a new Lagos day is a new visit');
  const hood = neighboursView(data, MONDAY + DAY, ttl, online, { bola: { directory: true } }, 'ada');
  assert.equal(hood.total, 2); assert.equal(hood.online, 1); assert.equal(hood.listed, 1);
  assert.deepEqual(hood.districts.find((group) => group.id === 'yaba'), { id: 'yaba', label: 'Yaba', count: 1, online: 0, homes: [] });
  assert.deepEqual(hood.districts.find((group) => group.id === 'unknown').homes, [{ id: 'ada', name: 'Ada', online: true, you: true }]);
  const list = richListView(data, MONDAY + DAY, ttl, {}, 'bola');
  assert.deepEqual(list.balances.map((entry) => [entry.rank, entry.name, entry.amount, entry.you]), [[1, 'Ada', 90000, false], [2, 'Bola', 10, true]]);
  assert.deepEqual(list.earners.map((entry) => entry.name), ['Ada']); assert.equal(list.you.balanceRank, 2); assert.equal(list.you.earnerRank, null);
  const hidden = richListView(data, MONDAY + DAY, ttl, { ada: { richList: true } }, 'ada');
  assert.deepEqual(hidden.balances.map((entry) => entry.name), ['Bola']); assert.equal(hidden.you.listed, false); assert.equal(hidden.you.cash, 90000);
  assert.equal(richListView(data, MONDAY + 8 * DAY, ttl, {}, null).earners.length, 0, 'last week’s earnings are not this week’s');
  assert.equal(counters(data, MONDAY + 40 * DAY, ttl, online).players, 0, 'expired residents are not counted');
  checkIn(data, MONDAY + 40 * DAY, { id: 'chidi', name: 'Chidi' }, life(MONDAY + 40 * DAY), ttl);
  assert.deepEqual(Object.keys(data.residents), ['chidi'], 'and are dropped on the next check-in');
});

test('a damaged civic collection is repaired instead of crashing a route', () => {
  for (const junk of [null, 'text', 7, [], { residents: [], gov: 'x', ads: { sea: 4 }, hunt: { found: -1, byDay: [] }, radio: null, seq: 'a' }]) {
    const civic = { cities: { lagos: junk } };
    const data = cityOf(civic, 'lagos');
    assert.deepEqual(Object.keys(data).sort(), ['ads', 'gov', 'hunt', 'prunedAt', 'radio', 'residents', 'seq', 'visits']);
    assert.equal(data.hunt.found, 0); assert.deepEqual(data.ads.sea, {}); assert.deepEqual(govView(data, MONDAY).election.candidates, []);
  }
});

test('civic life state: registered, no public actions, hostile saves are rebuilt', () => {
  const system = systems().find((item) => item.id === 'civic');
  assert.deepEqual(Object.keys(system.actions).sort(), ['civic.hunt-claim', 'civic.hunt-search', 'civic.news', 'civic.refresh', 'civic.rent-ad', 'civic.run', 'civic.shoutout', 'civic.vote']);
  assert.ok(Object.keys(system.actions).every((type) => actionTypes().includes(type)));
  // The four server-completed actions are declared serverOnly: a player's dispatch is refused whatever
  // the payload claims (including an `internal` or `grant` field), and nothing is charged.
  for (const type of ['civic.run', 'civic.vote', 'civic.rent-ad', 'civic.shoutout', 'civic.news']) {
    assert.equal(system.actions[type].serverOnly, true, type);
    for (const extra of [{}, { grant: true }, { grant: 'civic.server-grant' }, { internal: true }, { serverOnly: false }]) {
      const state = createLife({ t: MONDAY, location: 'library', civic: { since: 0 } }, at(MONDAY));
      const result = dispatch(state, { type, internal: true, payload: { kind: 'sea', slot: 'sea-5-5', ...extra } }, at(MONDAY));
      assert.equal(result.ok, false); assert.equal(result.code, 'server_only', type); assert.match(result.reason, /nothing was charged/); assert.equal(state.cash, 5000);
    }
  }
  // Only a context marked internal — which the route host's ctx.act builds — runs them.
  const granted = createLife({ t: MONDAY, civic: { since: 0 } }, at(MONDAY));
  assert.equal(dispatch(granted, { type: 'civic.rent-ad', payload: { kind: 'sea', slot: 'sea-5-5' } }, { ...at(MONDAY), internal: true }).code, 'rented'); assert.equal(granted.cash, 4900);
  assert.equal(dispatch(granted, { type: 'civic.refresh' }, at(MONDAY)).code, 'refreshed'); assert.equal(granted.cash, 4900); assert.equal(granted.civic.hunt.gems.length, 3);
  assert.equal(dispatch(granted, { type: 'civic.hunt-claim' }, at(MONDAY)).code, 'gems_missing');
  for (const junk of ['text', 7, [], null, { seed: -1, since: 'x', gems: -4, claims: 1.5, week: { week: 'a', earned: -1 }, hunt: { day: 3, claimed: true, gems: [{ venue: '__proto__', spot: null, kind: 'visit', found: true }] } },
    { hunt: { day: 3, gems: [{ venue: 'park', spot: 'nowhere', kind: 'visit' }] } }, { hunt: { day: 3, gems: new Array(50).fill({ venue: 'park', spot: null, kind: 'visit', found: true }) } }, { since: 9e15 }]) {
    const state = createLife({ t: MONDAY, civic: junk }, at(MONDAY));
    assert.notEqual(state.civic, junk);
    assert.equal(state.civic.hunt, null); assert.equal(state.civic.gems, 0); assert.equal(state.civic.claims, 0); assert.equal(state.civic.since, MONDAY);
    assert.ok(Number.isInteger(state.civic.seed) && state.civic.seed >= 0);
    assert.deepEqual(state.civic.week, { week: 0, earned: 0 });
  }
  const claimedEarly = createLife({ t: MONDAY, civic: { hunt: { day: 3, claimed: true, gems: [{ venue: 'park', spot: null, kind: 'visit', found: false }] } } }, at(MONDAY));
  assert.equal(claimedEarly.civic.hunt.claimed, false, 'a save cannot claim with gems unfound');
  const state = life();
  advanceLife(state, 1, at(MONDAY + 1000));
  assert.deepEqual(createLife(state, at(MONDAY + 1000)), state, 'a valid state round-trips unchanged');
  assert.deepEqual(createLife(JSON.parse(JSON.stringify(state))), state, 'and survives the client, which has no clock');
});

test('gem hunt: deterministic per player and day, found by searching and by activities, prize claimed exactly once', () => {
  assert.deepEqual(gemsFor(42, 'lagos', 100), gemsFor(42, 'lagos', 100));
  const spread = new Set(Array.from({ length: 40 }, (_, seed) => JSON.stringify(gemsFor(seed, 'lagos', 100))));
  assert.ok(spread.size > 5, 'different players get different hiding places');
  assert.ok(new Set(Array.from({ length: 20 }, (_, day) => JSON.stringify(gemsFor(42, 'lagos', day)))).size > 5, 'and they change by day');
  for (let seed = 0; seed < 40; seed++) {
    const gems = gemsFor(seed, 'lagos', 7);
    assert.equal(gems.length, HUNT.gemsPerDay);
    assert.ok(gems.every((gem) => gem.venue !== 'home' && !gem.found));
    assert.ok(new Set(gems.filter((gem) => gem.kind === 'activity').map((gem) => gem.venue)).size === gems.filter((gem) => gem.kind === 'activity').length);
  }

  const state = life();
  let now = MONDAY + 1000;
  advanceLife(state, 1, at(now));
  const hunt = state.civic.hunt;
  assert.equal(hunt.day, lagosTime(now).day);
  assert.equal(claimHuntPrize(state, {}, at(now)).code, 'gems_missing');
  assert.equal(state.cash, 5000);
  const shown = viewLife(state, at(now)).civic.hunt;
  assert.equal(shown.total, 3); assert.equal(JSON.stringify(shown).includes('"spot"'), false, 'clues name the venue, not the spot');
  const events = [];
  const listener = systems().find((item) => item.id === 'goals');
  listener.on = { ...listener.on, 'gem.found': (s, data) => events.push(['gem', data.prize, data.found]), 'hunt.claimed': (s, data) => events.push(['claim', data.prize]) };
  // The merged city has opening hours and trips of 4–18 seconds: take the gems whose venue is open
  // first, wait (within the same Lagos day) for the others to open, and give every trip time to end.
  const openNow = (gem) => isOpen(VENUES[gem.venue].hours, now);
  const settle = (seconds) => { now += seconds * 1000; advanceLife(state, seconds, at(now)); };
  /** A free activity with no requirements that can start here right now: [spotId, activityId]. */
  const anyActivity = (venue) => {
    for (const spot of spotsOf(venue)) for (const def of spot.activities) {
      if (def.cost || def.choices || def.requiresJob || def.requiresSkill || def.reward || blockReason(state, def, venue, at(now))) continue;
      return [spot.id, def.id];
    }
    return null;
  };
  for (let left = hunt.gems.filter((gem) => !gem.found); left.length; left = hunt.gems.filter((gem) => !gem.found)) {
    let gem = left.find(openNow);
    if (!gem) {
      gem = left.reduce((best, item) => (minutesUntilOpen(VENUES[item.venue].hours, now) < minutesUntilOpen(VENUES[best.venue].hours, now) ? item : best));
      const refused = dispatch(state, { type: 'travel', payload: { id: gem.venue, mode: 'trek' } }, at(now, 'closed'));
      assert.equal(refused.code, 'closed', 'a gem behind a closed door waits for opening time'); assert.match(refused.reason, /opens/);
      settle(minutesUntilOpen(VENUES[gem.venue].hours, now) * 60);
      assert.equal(lagosTime(now).day, hunt.day, 'every venue opens at some point of the same Lagos day');
    }
    if (state.location !== gem.venue) {
      assert.match(searchForGem(state, {}, at(now)).code, /nothing_here|wrong_spot|activity_needed/);
      assert.equal(dispatch(state, { type: 'travel', payload: { id: gem.venue, mode: 'trek' } }, at(now, `go${gem.venue}`)).ok, true);
      assert.equal(searchForGem(state, {}, at(now)).code, 'travelling');
      settle(20);
      assert.equal(state.location, gem.venue, 'the longest trek is 18 seconds');
    }
    if (gem.found) continue; // found on arrival
    if (gem.kind === 'activity') {
      assert.equal(searchForGem(state, {}, at(now)).code, 'activity_needed');
      const [spot, activity] = anyActivity(gem.venue);
      if (state.spot !== spot) assert.equal(dispatch(state, { type: 'spot', payload: { id: spot } }, at(now)).ok, true);
      assert.equal(dispatch(state, { type: 'activity', payload: { id: activity } }, at(now, activity)).ok, true);
      settle(60);
    } else {
      if (gem.spot && state.spot !== gem.spot) {
        const elsewhere = searchForGem(state, {}, at(now));
        if (!elsewhere.ok) assert.match(elsewhere.code, /wrong_spot|activity_needed/);
        assert.equal(dispatch(state, { type: 'spot', payload: { id: gem.spot } }, at(now)).ok, true);
      }
      if (!gem.found) assert.equal(searchForGem(state, {}, at(now)).code, 'found');
    }
    assert.equal(gem.found, true, JSON.stringify(gem));
  }
  assert.equal(state.civic.gems, 3);
  assert.equal(searchForGem(state, {}, at(now)).code, 'hunt_complete');
  assert.equal(viewLife(state, at(now)).civic.hunt.canClaim, true);
  const before = state.cash;
  assert.equal(claimHuntPrize(state, {}, at(now)).code, 'claimed');
  assert.equal(state.cash, before + 3000); assert.equal(state.ledger.at(-1).reason, 'Daily gem hunt prize');
  const again = claimHuntPrize(state, {}, at(now));
  assert.equal(again.code, 'already_claimed'); assert.ok(again.reason); assert.equal(state.cash, before + 3000);
  assert.equal(events.filter((event) => event[0] === 'gem').length, 3); assert.deepEqual(events.at(-1), ['claim', 3000]);
  assert.equal(state.civic.week.earned >= 3000, true, 'the prize counts towards this week’s earnings');
  // Next Lagos day: a new set, nothing carried over, lifetime counters kept.
  now += DAY; advanceLife(state, 86400, at(now));
  assert.equal(state.civic.hunt.day, hunt.day + 1); assert.equal(state.civic.hunt.claimed, false); assert.equal(state.civic.gems >= 3, true); assert.equal(state.civic.claims, 1);
  assert.equal(claimHuntPrize(state, {}, at(now)).ok, state.civic.hunt.gems.every((gem) => gem.found));
  delete listener.on['gem.found']; delete listener.on['hunt.claimed'];
});

test('civic payments: every refusal names what is missing and charges nothing', () => {
  const state = life();
  const fresh = civicEligibility(state, at(MONDAY));
  assert.equal(fresh.days, 0); assert.equal(fresh.run[0].met, false); assert.equal(fresh.run[1].met, true); assert.equal(fresh.pollingVenue, 'polling-unit');
  const early = fileCandidacy(state, {}, at(MONDAY));
  assert.equal(early.code, 'too_new'); assert.match(early.reason, /at least 2 Lagos days/); assert.equal(state.cash, 5000);
  assert.equal(castVote(state, {}, at(MONDAY)).code, 'too_new');
  // Age is not enough: the life must have been paid for work on two different Lagos days.
  const idle = castVote(state, {}, at(MONDAY + DAY));
  assert.equal(idle.code, 'work_days'); assert.match(idle.reason, /paid for work on at least 2 different Lagos days/); assert.match(idle.reason, /on 2 more days/);
  assert.equal(fileCandidacy(state, {}, at(MONDAY + 2 * DAY)).code, 'work_days'); assert.equal(state.cash, 5000, 'a refused candidacy charges nothing');
  state.civic.work = { days: 2, last: lagosTime(MONDAY).day };
  // The Polling Unit exists in the merged city, so a vote is cast there and nowhere else.
  const elsewhere = castVote(state, {}, at(MONDAY + DAY));
  assert.equal(elsewhere.code, 'wrong_place'); assert.match(elsewhere.reason, /Travel to Polling Unit/);
  state.location = 'polling-unit';
  assert.equal(castVote(state, {}, at(MONDAY + DAY)).code, 'voted');
  state.location = 'park';
  const later = at(MONDAY + 2 * DAY);
  assert.equal(fileCandidacy(state, {}, later).code, 'declared');
  assert.equal(state.cash, 5000 - ELECTION.filingFee); assert.equal(state.ledger.at(-1).reason, 'Governorship filing fee'); assert.equal(state.ledger.at(-1).amount, -ELECTION.filingFee);
  assert.equal(payForAd(state, { kind: 'billboard', slot: 'bb-01' }, later).code, 'rented'); assert.equal(state.cash, 1500);
  assert.equal(payForAd(state, { kind: 'billboard', slot: 'bb-02' }, later).code, 'rented'); assert.equal(state.cash, 0);
  const broke = payForAd(state, { kind: 'sea', slot: 'sea-9-9' }, later);
  assert.equal(broke.code, 'insufficient_funds'); assert.match(broke.reason, /costs ₦100 for 30 days; you have ₦0/); assert.equal(state.cash, 0);
  assert.equal(payForAd(state, { kind: 'sea', slot: 'sea-99-9' }, later).code, 'invalid_slot');
  assert.equal(payForAd(state, null, later).code, 'invalid_slot');
  const poor = fileCandidacy(state, {}, later);
  assert.equal(poor.code, 'insufficient_funds'); assert.match(poor.reason, /earn ₦2,000 more/);
  const outside = payForShoutout(state, {}, later);
  assert.equal(outside.code, 'not_in_club'); assert.match(outside.reason, /The Library/);
  state.location = 'library'; state.spot = null;
  assert.equal(payForShoutout(state, {}, later).code, 'insufficient_funds');
  state.cash = 600;
  assert.equal(payForShoutout(state, {}, later).code, 'queued'); assert.equal(state.cash, 100);
  assert.equal(state.civic.week.earned, 0, 'spending is not earning');
});

test('the civic rule modules stay portable: no Node-only imports, clocks or randomness', async () => {
  const files = (await readdir('server/civic')).filter((file) => file.endsWith('.js') && !file.endsWith('.test.js'));
  assert.ok(files.length >= 6);
  for (const file of files) {
    const code = (await readFile(`server/civic/${file}`, 'utf8')).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /from\s+['"](node:|ws['"]|fs['"]|path['"]|crypto['"]|http['"])|require\(|\bprocess\.|Date\.now\(|Math\.random\(/, file);
  }
});

test('work days: one per Lagos day with a paid activity, never from unpaid ones, and hostile saves are reset', () => {
  const state = life();
  const paid = { def: { id: 'x', reward: 300 }, tags: [] }, unpaid = { def: { id: 'y', reward: 0 }, tags: [] };
  const emitDone = (data, now) => civicSystem.on['activity.completed'](state, data, at(now));
  emitDone(unpaid, MONDAY); assert.deepEqual(state.civic.work, { days: 0, last: null });
  emitDone(paid, MONDAY); emitDone(paid, MONDAY + 3600000); emitDone(paid, MONDAY + 23 * 3600000 - 60000);
  assert.deepEqual(state.civic.work, { days: 1, last: lagosTime(MONDAY).day }, 'any number of paid activities in one day count once');
  assert.match(civicEligibility(state, at(MONDAY + 3600000)).vote.find((item) => item.id === 'work').detail, /on 1 more day \(today is already counted — come back tomorrow\)/);
  emitDone(paid, MONDAY + DAY);
  assert.equal(state.civic.work.days, 2); assert.equal(civicEligibility(state, at(MONDAY + DAY)).vote.find((item) => item.id === 'work').met, true);
  for (const work of [{ days: 99, last: null }, { days: 0, last: 5 }, { days: -1, last: 1 }, { days: 1e9, last: 1 }, 'x', [2, 3]]) {
    const rebuilt = createLife({ ...structuredClone(state), civic: { ...state.civic, work } }, at(MONDAY));
    assert.deepEqual(rebuilt.civic.work, { days: 0, last: null }, JSON.stringify(work));
  }
  assert.deepEqual(createLife(structuredClone(state), at(MONDAY + DAY)).civic.work, state.civic.work, 'a valid record survives a reload');
});
