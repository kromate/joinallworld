// OWNER: politics — the pure rules: quorum, decrees, treasuries, levies and parties (docs/POLITICS.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { lagosDayStart, lagosTime } from '../../src/game/clock.ts';
import { LEVERS, QUORUM, SALARY_SHARE, SEATS } from '../../src/game/content/politics.ts';
import { declare, governorAt, vote } from '../civic/elections.ts';
import { emptyPolitics, scopeRecord } from './data.ts';
import { credit, decreeBlock, drawSalary, found, foundBlock, join, joinBlock, leave, leverValue, levyOn, memberCount, partyOf, salaryBlock, salaryDue, setDecree, totalLevy } from './rules.ts';
import type { GovScope } from '../types.ts';

const DAY = 86400000;
/** Monday 00:00 Lagos time of week 1: nominations open; the election of week 1 closes on Saturday night and its term starts Sunday. */
const MONDAY = lagosDayStart(7 * 1 - 3);
const SUNDAY = MONDAY + 6 * DAY + 60000;
const ada = { id: 'ada', name: 'Ada' }, bola = { id: 'bola', name: 'Bola' };
const empty = (): GovScope => ({ gov: { elections: {}, announcements: [] } });
/** A ballot of week 1 where `candidate` gets `votes` votes. */
function ballot(votes: number, candidate = ada): GovScope {
  const scope = empty();
  declare(scope, MONDAY + 1000, candidate, 'Roads first');
  for (let index = 0; index < votes; index++) vote(scope, MONDAY + 3 * DAY + 1000, `voter-${index}`, candidate.id);
  return scope;
}

test('an election needs its quorum: below it nobody takes office, at it the winner does', () => {
  for (const tier of ['city', 'state', 'nation'] as const) {
    const quorum = QUORUM[tier];
    assert.equal(governorAt(ballot(quorum - 1), SUNDAY, quorum), null, `${tier}: ${quorum - 1} votes is not enough`);
    assert.equal(governorAt(ballot(quorum), SUNDAY, quorum)?.id, 'ada', `${tier}: ${quorum} votes is`);
  }
  assert.equal(governorAt(ballot(1), SUNDAY), null, 'one vote never elects, even for the city seat');
  assert.ok(QUORUM.city < QUORUM.state && QUORUM.state < QUORUM.nation, 'a wider seat needs more voters');
});

test('a term lasts a week, then the seat is empty until the next election counts', () => {
  const scope = ballot(QUORUM.state);
  assert.equal(governorAt(scope, SUNDAY, QUORUM.state)?.week, 1);
  assert.equal(governorAt(scope, SUNDAY + 6 * DAY, QUORUM.state)?.id, 'ada');
  assert.equal(governorAt(scope, SUNDAY + 7 * DAY, QUORUM.state), null);
});

test('decrees: only the officeholder, only this office’s levers, only inside the range, and they lapse with the term', () => {
  const gov = ballot(QUORUM.state), record = scopeRecord(emptyPolitics(), 'state:lagos');
  assert.equal(leverValue(record, gov, SUNDAY, 'salesTax'), 0, 'no decree: the base');
  assert.equal(decreeBlock(gov, SUNDAY, 'state', 'bola', 'salesTax', 5)?.code, 'not_in_office');
  assert.equal(decreeBlock(gov, SUNDAY, 'state', 'ada', 'marketLevy', 5)?.code, 'unknown_lever', 'a city lever is not a state one');
  assert.equal(decreeBlock(gov, SUNDAY, 'state', 'ada', 'nonsense', 5)?.code, 'unknown_lever');
  for (const value of [-1, LEVERS.salesTax.max + 1, 2.5, '5', null, NaN]) assert.equal(decreeBlock(gov, SUNDAY, 'state', 'ada', 'salesTax', value)?.code, 'out_of_range', String(value));
  assert.equal(decreeBlock(gov, SUNDAY, 'state', 'ada', 'salesTax', LEVERS.salesTax.max), null);
  setDecree(record, gov, SUNDAY, ada, 'salesTax', 6);
  assert.equal(leverValue(record, gov, SUNDAY + DAY, 'salesTax'), 6);
  assert.equal(record.decree?.by.id, 'ada');
  assert.equal(leverValue(record, gov, SUNDAY + 7 * DAY, 'salesTax'), 0, 'the next term starts from the base');
  const other = ballot(QUORUM.state, bola);
  assert.equal(leverValue(record, other, SUNDAY, 'salesTax'), 0, 'a decree made by someone else is not this officeholder’s');
});

test('treasury: levies in, a capped share out once per term', () => {
  const gov = ballot(QUORUM.nation), record = scopeRecord(emptyPolitics(), 'nation:ng');
  assert.equal(salaryBlock(record, gov, SUNDAY, 'nation', 'ada')?.code, 'treasury_empty');
  credit(record, SUNDAY, 'levy', 1000, 'VAT');
  credit(record, SUNDAY, 'levy', 0, 'ignored'); credit(record, SUNDAY, 'levy', -5, 'ignored'); credit(record, SUNDAY, 'levy', 2.5, 'ignored');
  assert.equal(record.treasury.balance, 1000); assert.equal(record.treasury.ledger.length, 1);
  assert.equal(salaryBlock(record, gov, SUNDAY, 'nation', 'bola')?.code, 'not_in_office');
  assert.equal(salaryDue(record, gov, SUNDAY, 'nation', 'ada'), Math.floor(1000 * SALARY_SHARE));
  assert.equal(drawSalary(record, gov, SUNDAY, 'nation', ada), 200);
  assert.equal(record.treasury.balance, 800);
  assert.equal(salaryBlock(record, gov, SUNDAY, 'nation', 'ada')?.code, 'already_drawn');
  credit(record, SUNDAY, 'levy', 10_000_000, 'a windfall');
  assert.equal(salaryDue(record, gov, SUNDAY + 7 * DAY, 'nation', 'ada'), 0, 'out of office: nothing');
  const next = ballot(QUORUM.nation, bola);
  delete record.drawn; // a later term, drawn by someone else
  assert.equal(salaryDue(record, next, SUNDAY, 'nation', 'bola'), SEATS.nation.salaryCap, 'a rich treasury pays the cap, not a fifth');
});

test('the ledger keeps only its newest lines', () => {
  const record = scopeRecord(emptyPolitics(), 'city:lagos');
  for (let index = 1; index <= 60; index++) credit(record, SUNDAY, 'levy', index, `line ${index}`);
  assert.equal(record.treasury.ledger.length, 40); assert.equal(record.treasury.ledger[0]?.amount, 21);
});

test('levies round down per office, so a small price pays nothing and a big one pays each office’s share', () => {
  assert.equal(levyOn(1200, 5), 60); assert.equal(levyOn(15, 5), 0); assert.equal(levyOn(1000, 0), 0);
  const levies = [{ scopeId: 'city:lagos', lever: 'marketLevy' as const, percent: 10, label: 'Market levy' }, { scopeId: 'nation:ng', lever: 'vat' as const, percent: 15, label: 'VAT' }];
  assert.equal(totalLevy(1000, levies), 250); assert.equal(totalLevy(1000, []), 0);
});

test('parties: one per founder, unique names, one membership each', () => {
  const politics = emptyPolitics();
  assert.equal(foundBlock(politics, ada, 'Green Hands'), null);
  const id = found(politics, SUNDAY, ada, 'Green Hands', 'Plant more', 'green');
  assert.equal(partyOf(politics, 'ada'), id);
  assert.equal(foundBlock(politics, bola, 'green hands')?.code, 'name_taken', 'names are unique whatever the case');
  assert.equal(foundBlock(politics, ada, 'Another')?.code, 'founder_limit');
  assert.equal(joinBlock(politics, 'bola', 'nope')?.code, 'unknown_party');
  assert.equal(joinBlock(politics, 'ada', id)?.code, 'already_member');
  assert.equal(joinBlock(politics, 'bola', id), null);
  join(politics, 'bola', id);
  assert.equal(memberCount(politics, id), 2);
  assert.equal(leave(politics, 'bola'), true); assert.equal(leave(politics, 'bola'), false);
  assert.equal(memberCount(politics, id), 1);
});

test('a candidate stands under a party, or as an independent', () => {
  const scope = empty();
  declare(scope, MONDAY + 1000, ada, 'Roads first', 'p1');
  declare(scope, MONDAY + 2000, bola, 'My own way');
  assert.equal(scope.gov.elections[1]?.candidates.ada?.party, 'p1');
  assert.equal(Object.hasOwn(scope.gov.elections[1]?.candidates.bola ?? {}, 'party'), false);
  assert.equal(lagosTime(MONDAY).week, 1);
});
