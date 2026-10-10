import { loadCityContent as preloadCityContent } from '../../src/game/cities/registry.ts';
await preloadCityContent('lagos');
// OWNER: civic — tests for the place boards (server/civic/boards.ts): the weekly tally, the ranking, the week turning,
// suppression of small places, paging and the cache. Plain civic data; no server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lagosDayStart } from '../../src/game/clock.ts';
import { createLife } from '../../src/life.ts';
import { cityCatalogue } from '../../src/game/cities/registry.ts';
import type { BoardMeasure, BoardScope, BoardsResponse } from '../../src/types/civic.ts';
import type { CivicCollection, ResidentRecord } from '../types.ts';
import { BOARD_MIN, BOARD_TTL_MS, addToTally, boardView, createBoards } from './boards.ts';
import { cityOf, emptyCivic } from './data.ts';
import { checkIn } from './residents.ts';

const DAY = 86400000;
const HOUR = 3600000;
const WEEK = 7 * DAY;
const MONDAY = lagosDayStart(4); // a Monday, 00:00 Nigerian time
const resident = (name: string, earned: number, week: number): ResidentRecord => ({ name, house: null, since: 0, lastSeen: 0, day: -1, cash: 0, week, earned, gems: 0, claims: 0 });
const weekOf = (at: number): number => Math.floor((Math.floor((at + 3600000) / DAY) + 3) / 7);

/** `people` residents of a city, each of whom has earned `each` this week and checked in. */
function populate(civic: CivicCollection, cityId: string, people: number, each: number, at = MONDAY + DAY, active = people): void {
  const city = cityOf(civic, cityId);
  for (let i = 0; i < people; i += 1) {
    const id = `${cityId}-${i}`, entry = city.residents[id] = resident(`Player ${id}`, i < active ? each : 0, weekOf(at));
    if (i < active) addToTally(city, entry, at);
  }
  // Residents that did not open the game this week are still residents.
}
const view = (civic: CivicCollection, now: number, scope: BoardScope = 'city', by: BoardMeasure = 'pride', home: string | null = null, after: string | null = null, limit = 25): BoardsResponse => {
  const found = boardView(createBoards().get(civic, now), scope, by, home, after, limit);
  assert.ok(found, 'a valid cursor');
  return found;
};

test('pride is naira received per resident: a small busy city beats a big one with more total earnings', () => {
  const civic = emptyCivic();
  populate(civic, 'kano', 5, 900);   // 4,500 in all, 900 each
  populate(civic, 'lagos', 50, 200); // 10,000 in all, 200 each
  const byPride = view(civic, MONDAY + 2 * DAY), byEarned = view(civic, MONDAY + 2 * DAY, 'city', 'earned');
  assert.deepEqual(byPride.rows.map((row) => [row.rank, row.id, row.pride, row.earned, row.residents, row.active]), [[1, 'kano', 900, 4500, 5, 5], [2, 'lagos', 200, 10000, 50, 50]]);
  assert.deepEqual(byEarned.rows.map((row) => row.id), ['lagos', 'kano']);
  // Residents who did not open the game dilute pride: taking part is what is rewarded.
  const quiet = emptyCivic();
  populate(quiet, 'kano', 10, 900, MONDAY + DAY, 5);
  assert.equal(view(quiet, MONDAY + 2 * DAY).rows[0]?.pride, 450);
});

test('equal places are ordered by id, and the same data always gives the same ranks', () => {
  const civic = emptyCivic();
  for (const id of ['ota', 'ibadan', 'kano', 'abuja']) populate(civic, id, 5, 100);
  const first = view(civic, MONDAY + DAY).rows.map((row) => [row.rank, row.id]);
  assert.deepEqual(first, [[1, 'abuja'], [2, 'ibadan'], [3, 'kano'], [4, 'ota']]);
  assert.deepEqual(view(civic, MONDAY + DAY).rows.map((row) => [row.rank, row.id]), first);
  assert.equal(view(civic, MONDAY + DAY, 'city', 'pride', 'ibadan').you?.behind?.amount, 0, 'level with the place above');
});

test('the viewer\'s place, its rank and what it lacks to match the place above', () => {
  const civic = emptyCivic();
  populate(civic, 'abuja', 6, 5000); populate(civic, 'ibadan', 6, 3800); populate(civic, 'kano', 6, 1000);
  const board = view(civic, MONDAY + DAY, 'city', 'pride', 'ibadan');
  assert.deepEqual(board.you, { id: 'ibadan', name: 'Ibadan', rank: 2, behind: { id: 'abuja', name: 'Abuja', amount: 1200 } });
  assert.deepEqual(board.rows.map((row) => row.you), [false, true, false]);
  assert.equal(view(civic, MONDAY + DAY, 'city', 'pride', 'abuja').you?.behind, null, 'the leader has no one above');
  assert.equal(view(civic, MONDAY + DAY, 'city', 'pride', null).you, null);
  assert.deepEqual(view(civic, MONDAY + DAY, 'state', 'pride', 'ibadan').you, { id: 'oyo', name: 'Oyo State', rank: 2, behind: { id: 'fct', name: 'Federal Capital Territory', amount: 1200 } });
});

test('states add their cities up; countries add their states; a foreign city has no state', () => {
  const civic = emptyCivic();
  populate(civic, 'ota', 3, 600); populate(civic, 'abeokuta', 3, 600); // Ogun: two cities, neither big enough alone
  populate(civic, 'accra', 5, 100);
  const cities = view(civic, MONDAY + DAY);
  assert.deepEqual(cities.rows.map((row) => row.id), ['accra'], 'a city needs its own residents');
  assert.equal(cities.unranked, 2);
  const states = view(civic, MONDAY + DAY, 'state');
  assert.deepEqual(states.rows.map((row) => [row.id, row.within, row.residents, row.pride]), [['ogun', 'Nigeria', 6, 600]]);
  assert.equal(view(civic, MONDAY + DAY, 'state', 'pride', 'accra').you, null, 'a placeholder district is not a state');
  const countries = view(civic, MONDAY + DAY, 'country');
  assert.deepEqual(countries.rows.map((row) => [row.id, row.name, row.within, row.pride]), [['ng', 'Nigeria', null, 600], ['gh', 'Ghana', null, 100]]);
});

test('a place with fewer than the minimum of residents or of active players is neither shown nor ranked', () => {
  const civic = emptyCivic();
  populate(civic, 'kano', BOARD_MIN - 1, 99999);                    // too few residents
  populate(civic, 'ibadan', BOARD_MIN + 5, 300, MONDAY + DAY, BOARD_MIN - 1); // enough residents, too few active
  populate(civic, 'abuja', BOARD_MIN, 10);
  const board = view(civic, MONDAY + DAY, 'city', 'pride', 'kano');
  assert.deepEqual(board.rows.map((row) => row.id), ['abuja']);
  assert.equal(board.unranked, 2); assert.equal(board.total, 1); assert.equal(board.min, BOARD_MIN);
  assert.deepEqual(board.you, { id: 'kano', name: 'Kano', rank: null, behind: null });
  const text = JSON.stringify(board);
  assert.ok(!text.includes('99999') && !text.includes('Player'), 'no figure of a small place and no player name leaves the server');
  // The same small places count in the state and country they belong to.
  assert.equal(view(civic, MONDAY + DAY, 'country').rows[0]?.residents, (BOARD_MIN - 1) + (BOARD_MIN + 5) + BOARD_MIN);
});

test('the week turns on Monday, Nigerian time: last week\'s winner is kept for the week after, then it is gone', () => {
  const civic = emptyCivic();
  populate(civic, 'kano', 5, 900, MONDAY + 2 * DAY); populate(civic, 'ibadan', 5, 100, MONDAY + 2 * DAY);
  const sunday = MONDAY + WEEK - 1, next = MONDAY + WEEK;
  assert.equal(view(civic, sunday).lastWeek.winner, null);
  assert.equal(view(civic, sunday).rows[0]?.id, 'kano');
  // The new week starts empty and shows the old one's winner, though nobody has checked in yet.
  const fresh = view(civic, next);
  assert.deepEqual(fresh.rows, []); assert.equal(fresh.total, 0);
  assert.deepEqual(fresh.lastWeek, { week: weekOf(MONDAY), winner: { id: 'kano', name: 'Kano' } });
  assert.deepEqual(view(civic, next, 'state').lastWeek.winner, { id: 'kano', name: 'Kano State' });
  assert.deepEqual(view(civic, next, 'country').lastWeek.winner, { id: 'ng', name: 'Nigeria' });
  // Check-ins of the new week roll the tally over and keep the old week beside it; the winner does not change.
  populate(civic, 'ibadan', 5, 7000, next + HOUR);
  const later = view(civic, next + 2 * HOUR);
  assert.deepEqual(later.rows.map((row) => [row.id, row.pride]), [['ibadan', 7000]]);
  assert.equal(later.lastWeek.winner?.id, 'kano');
  assert.equal(cityOf(civic, 'ibadan').pride?.prev?.earned, 500);
  // Two weeks on, the older week is no longer kept.
  assert.equal(view(civic, next + WEEK + HOUR).lastWeek.winner?.id, 'ibadan');
  assert.equal(view(civic, next + 2 * WEEK + HOUR).lastWeek.winner, null);
});

test('a repeated check-in adds a resident once and later ones only what they have earned since', () => {
  const civic = emptyCivic(), city = cityOf(civic, 'kano'), ttl = 30 * DAY;
  const player = { id: 'ada', name: 'Ada' };
  const life = createLife(null, { now: MONDAY, cityId: 'lagos', isNew: true });
  life.cash = 4000; life.civic.week = { week: weekOf(MONDAY), earned: 300 };
  checkIn(city, MONDAY + HOUR, player, life, ttl);
  checkIn(city, MONDAY + 2 * HOUR, player, life, ttl);
  assert.deepEqual(city.pride, { week: weekOf(MONDAY), active: 1, earned: 300 });
  life.civic.week.earned = 450;
  checkIn(city, MONDAY + 3 * HOUR, player, life, ttl);
  checkIn(city, MONDAY + 4 * HOUR, { id: 'bola', name: 'Bola' }, life, ttl);
  assert.deepEqual(city.pride, { week: weekOf(MONDAY), active: 2, earned: 900 });
  // A resident saved before the tally existed is added in full on the next check-in, not by a difference from nothing.
  const old = city.residents['ada'];
  assert.ok(old); delete old.tw; delete old.te; delete city.pride;
  checkIn(city, MONDAY + 5 * HOUR, player, life, ttl);
  assert.deepEqual(city.pride, { week: weekOf(MONDAY), active: 1, earned: 450 });
  // A new week: earnings of the old week are not carried.
  life.civic.week = { week: weekOf(MONDAY) + 1, earned: 20 };
  checkIn(city, MONDAY + WEEK + HOUR, player, life, ttl);
  assert.deepEqual(city.pride, { week: weekOf(MONDAY) + 1, active: 1, earned: 20, prev: { week: weekOf(MONDAY), active: 1, earned: 450, residents: 2 } });
});

test('paging: pages follow the ranks, the size is bounded, a bad cursor is refused', () => {
  const civic = emptyCivic();
  const ids = cityCatalogue().filter((entry) => entry.open && !entry.state.id.endsWith('-starter')).slice(0, 12).map((entry) => entry.id);
  ids.forEach((id, index) => populate(civic, id, 5, 1000 + index * 10));
  const built = createBoards().get(civic, MONDAY + DAY);
  const one = boardView(built, 'city', 'pride', null, null, 5), two = boardView(built, 'city', 'pride', null, one?.next ?? null, 5), three = boardView(built, 'city', 'pride', null, two?.next ?? null, 5);
  assert.deepEqual(one?.rows.map((row) => row.rank), [1, 2, 3, 4, 5]); assert.equal(one?.next, '5');
  assert.deepEqual(two?.rows.map((row) => row.rank), [6, 7, 8, 9, 10]);
  assert.deepEqual(three?.rows.map((row) => row.rank), [11, 12]); assert.equal(three?.next, null);
  assert.equal(one?.total, 12);
  assert.deepEqual(boardView(built, 'city', 'pride', null, '99', 5)?.rows, []);
  for (const bad of ['x', '-1', '1.5', '1e3', '1234567', '5:6', '']) assert.equal(boardView(built, 'city', 'pride', null, bad, 5), null, bad);
  assert.equal(boardView(built, 'city', 'pride', null, null, 1)?.rows.length, 1);
});

test('the boards are built from the tallies: a request reads no resident, and a build is reused until it is old', () => {
  const civic = emptyCivic();
  populate(civic, 'kano', 5, 100); populate(civic, 'abuja', 5, 200);
  // Any read of a resident's record would throw; counting the keys is all a build may do.
  let touched = 0;
  for (const id of ['kano', 'abuja']) {
    const city = cityOf(civic, id);
    city.residents = new Proxy(city.residents, { get(target, key) { touched += 1; return Reflect.get(target, key); }, ownKeys: (target) => Reflect.ownKeys(target) });
  }
  const boards = createBoards();
  const first = boards.get(civic, MONDAY + DAY);
  assert.equal(boards.stats.builds, 1);
  assert.equal(boardView(first, 'city', 'pride', 'kano', null, 25)?.rows.length, 2);
  assert.equal(touched, 0, 'no resident record was read');
  for (let i = 0; i < 50; i += 1) boards.get(civic, MONDAY + DAY + 1000 + i);
  assert.equal(boards.stats.builds, 1, 'fifty more requests, one build');
  boards.get(civic, MONDAY + DAY + BOARD_TTL_MS + 1);
  assert.equal(boards.stats.builds, 2, 'rebuilt once the build is old');
  boards.get(civic, MONDAY + WEEK + 1);
  assert.equal(boards.stats.builds, 3, 'and when the week turns');
  boards.get(civic, MONDAY);
  assert.equal(boards.stats.builds, 4, 'and when the clock goes back');
});

test('players who hid from the rich list are counted in the totals and named nowhere', () => {
  const civic = emptyCivic();
  populate(civic, 'kano', 6, 100);
  for (let i = 0; i < 3; i += 1) civic.prefs[`kano-${i}`] = { richList: true };
  const board = view(civic, MONDAY + DAY, 'city', 'pride', 'kano');
  assert.deepEqual([board.rows[0]?.residents, board.rows[0]?.active, board.rows[0]?.earned], [6, 6, 600]);
  assert.ok(!/Player|kano-\d/.test(JSON.stringify(board)));
});
