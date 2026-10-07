// OWNER: politics — the public record: each finished term written once, entries chained, and the pages that read it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lagosDayStart } from '../../src/game/clock.ts';
import { QUORUM } from '../../src/game/content/politics.ts';
import { GENESIS, verifyChain } from '../../src/records/chain.ts';
import { declare, timeline, vote } from '../civic/elections.ts';
import { emptyPolitics } from '../politics/data.ts';
import type { GovScope } from '../types.ts';
import { archiveTerms, termsPending } from './archive.ts';
import type { SeatToArchive } from './archive.ts';
import { append, emptyRecords, keyOf, page } from './store.ts';

const DAY = 86400000;
const WEEK = 1;
const MONDAY = lagosDayStart(7 * WEEK - 3);
const AFTER = timeline(WEEK).termEndsAt + 1000;
const ada = { id: 'ada', name: 'Ada' }, bola = { id: 'bola', name: 'Bola' };
const empty = (): GovScope => ({ gov: { elections: {}, announcements: [] } });
/** A seat with an election of week 1 where Ada got `votes` and Bola `rival`. */
function seatWith(votes: number, rival = 0, tier: 'city' | 'state' | 'nation' = 'state'): SeatToArchive {
  const gov = empty();
  declare(gov, MONDAY + 1000, ada, 'Roads first', 'p1');
  if (rival) declare(gov, MONDAY + 2000, bola, 'Light');
  for (let index = 0; index < votes; index++) vote(gov, MONDAY + 3 * DAY, `a-${index}`, ada.id);
  for (let index = 0; index < rival; index++) vote(gov, MONDAY + 3 * DAY, `b-${index}`, bola.id);
  return { tier, id: tier === 'city' ? 'city:lagos' : tier === 'state' ? 'state:lagos' : 'nation:ng', name: tier === 'city' ? 'Lagos' : tier === 'state' ? 'Lagos State' : 'Nigeria', title: tier === 'city' ? 'Chairman' : tier === 'state' ? 'Governor' : 'President', gov };
}
const politics = (() => { const value = emptyPolitics(); value.parties.p1 = { id: 'p1', name: 'Green Hands', motto: 'Plant more', colour: 'green', founder: ada, at: 1 }; return value; })();

test('a finished term is written once, with who won, how many voted and the party', () => {
  const records = emptyRecords(), seats = [seatWith(QUORUM.state + 2, 3)];
  assert.equal(termsPending(records, seats, MONDAY + 3 * DAY), false, 'not while the term is running');
  assert.equal(termsPending(records, seats, AFTER), true);
  assert.equal(archiveTerms(records, politics, seats, AFTER), 1);
  const entry = records.entries[keyOf(1)];
  assert.deepEqual([entry?.kind, entry?.scope, entry?.week, entry?.facts.winner, entry?.facts.votes, entry?.facts.total, entry?.facts.candidates, entry?.facts.void, entry?.facts.party], ['term', 'state:lagos', 1, 'Ada', QUORUM.state + 2, QUORUM.state + 5, 2, false, 'Green Hands']);
  assert.match(entry?.title ?? '', /^Governor Ada \(Green Hands\) held Lagos State for the week of \d{4}-\d{2}-\d{2}, elected with 12 of 15 votes\.$/);
  assert.equal(termsPending(records, seats, AFTER), false);
  assert.equal(archiveTerms(records, politics, seats, AFTER + DAY), 0, 'written once');
  assert.deepEqual([records.seq, records.terms[`state:lagos|${WEEK}`]], [1, 1]);
});

test('a void election, an unopposed independent and an empty ballot are each told as they were', () => {
  const void_ = emptyRecords();
  archiveTerms(void_, politics, [seatWith(QUORUM.state - 1)], AFTER);
  assert.equal(void_.entries[keyOf(1)]?.facts.void, true);
  assert.match(void_.entries[keyOf(1)]?.title ?? '', /had no Governor.*9 votes cast and 10 needed, so the election did not count/);
  const none = emptyRecords();
  const quiet = seatWith(0); quiet.gov.gov.elections[WEEK]!.votes = {};
  archiveTerms(none, politics, [quiet], AFTER);
  assert.match(none.entries[keyOf(1)]?.title ?? '', /^Nobody voted for Governor of Lagos State/);
  const loner = seatWith(QUORUM.city, 0, 'city'); delete loner.gov.gov.elections[WEEK]!.candidates.ada!.party;
  const solo = emptyRecords();
  archiveTerms(solo, politics, [loner], AFTER);
  assert.match(solo.entries[keyOf(1)]?.title ?? '', /^Chairman Ada \(independent\) held Lagos/);
  assert.equal(archiveTerms(emptyRecords(), politics, [{ ...seatWith(0), gov: empty() }], AFTER), 0, 'a seat nobody stood for has nothing to write');
});

test('an impeached term says so, and the facts never hold a voter', () => {
  const seat = seatWith(QUORUM.state);
  seat.gov.gov.elections[WEEK]!.removedAt = timeline(WEEK).closesAt + 2 * DAY;
  const records = emptyRecords();
  archiveTerms(records, politics, [seat], AFTER);
  assert.match(records.entries[keyOf(1)]?.title ?? '', /Removed by petition after 2 days\.$/);
  assert.equal(records.entries[keyOf(1)]?.facts.removed, true);
  assert.ok(!JSON.stringify(records).includes('a-0'), 'who voted is not in the record');
});

test('entries chain from the start, can be paged newest first by scope and kind, and any edit breaks the chain', () => {
  const records = emptyRecords();
  for (let n = 1; n <= 8; n++) append(records, n * 1000, { kind: n % 2 ? 'term' : 'ruling', scope: n % 3 ? 'state:lagos' : 'city:lagos', scopeName: 'S', week: n, title: `Entry ${n}`, facts: { n } });
  assert.equal(records.entries[keyOf(1)]?.prev, GENESIS);
  assert.equal(records.head, records.entries[keyOf(8)]?.hash);
  const all = Object.values(records.entries);
  assert.equal(verifyChain(all).ok, true);
  const first = page(records, { limit: 3 });
  assert.deepEqual([first.entries.map((entry) => entry.n), first.before], [[8, 7, 6], 6]);
  const second = page(records, { limit: 3, before: first.before ?? 0 });
  assert.deepEqual(second.entries.map((entry) => entry.n), [5, 4, 3]);
  assert.deepEqual(page(records, { limit: 10, before: 3 }).before, null, 'the start');
  assert.deepEqual(page(records, { limit: 10, scope: 'city:lagos' }).entries.map((entry) => entry.n), [6, 3]);
  assert.deepEqual(page(records, { limit: 10, kind: 'ruling' }).entries.map((entry) => entry.n), [8, 6, 4, 2]);
  records.entries[keyOf(4)]!.title = 'Rewritten';
  assert.equal(verifyChain(Object.values(records.entries)).brokenAt, 4);
});

test('long text and many facts are cut down, so an entry stays small', () => {
  const records = emptyRecords();
  const written = append(records, 1, { kind: 'party', scope: 'world', scopeName: 'N'.repeat(200), week: null, title: 'x'.repeat(1000), facts: Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`k${index}`, 'v'.repeat(500)])) });
  assert.ok(written.title.length <= 280 && written.scopeName.length <= 60 && Object.keys(written.facts).length === 12 && Object.values(written.facts).every((value) => String(value).length <= 160));
  assert.equal(verifyChain([written]).ok, true);
});
