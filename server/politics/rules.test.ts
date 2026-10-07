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

import { AUDIT, GRANTS } from '../../src/game/content/politics.ts';
import { auditBlock, auditFlags, grantBlock, grantRoom, impeachBlock, payGrant, runAudit, signPetition, signaturesNeeded, termAccounts, termOf } from './rules.ts';

const seat = () => scopeRecord(emptyPolitics(), 'state:lagos');
const STATE = QUORUM.state;

test('a term’s accounts count what came in, what the salary took and what was granted, and start again each term', () => {
  const record = seat(), gov = ballot(STATE);
  credit(record, SUNDAY, 'levy', 1000, 'VAT'); credit(record, SUNDAY, 'fee', 500, 'Fee');
  drawSalary(record, gov, SUNDAY, 'state', ada);
  payGrant(record, gov, SUNDAY, 'state', bola, 100, 'School desks', null);
  assert.deepEqual([record.term?.income, record.term?.salary, record.term?.granted, record.treasury.balance], [1500, 300, 100, 1100]);
  assert.equal(record.treasury.ledger.at(-1)?.kind, 'grant'); assert.equal(record.treasury.ledger.at(-1)?.amount, -100);
  assert.equal(termAccounts(record, SUNDAY + 7 * DAY).income, 0, 'a new term starts clean');
  assert.equal(termOf(SUNDAY), 1);
});

test('grants: only the officeholder, within a share of the treasury, a few a term, once to each player', () => {
  const record = seat(), gov = ballot(STATE);
  credit(record, SUNDAY, 'levy', 10000, 'VAT');
  assert.equal(grantRoom(record, 'state'), 3000, '30% of the treasury');
  assert.equal(grantBlock(record, gov, SUNDAY, 'state', 'bola', 'chi', 100)?.code, 'not_in_office');
  assert.equal(grantBlock(record, gov, SUNDAY, 'state', 'ada', 'ada', 100)?.code, 'self');
  for (const amount of [0, -5, 2.5, '100', undefined]) assert.equal(grantBlock(record, gov, SUNDAY, 'state', 'ada', 'chi', amount)?.code, 'invalid_amount', String(amount));
  assert.equal(grantBlock(record, gov, SUNDAY, 'state', 'ada', 'chi', 3001)?.code, 'over_limit');
  assert.equal(grantBlock(record, gov, SUNDAY, 'state', 'ada', 'chi', 3000), null);
  payGrant(record, gov, SUNDAY, 'state', { id: 'chi', name: 'Chi' }, 1000, 'Clinic roof', null);
  assert.equal(grantBlock(record, gov, SUNDAY, 'state', 'ada', 'chi', 100)?.code, 'already_granted');
  for (let index = 0; index < GRANTS.perTerm - 1; index++) payGrant(record, gov, SUNDAY, 'state', { id: `p${index}`, name: 'P' }, 10, 'Small job', null);
  assert.equal(grantBlock(record, gov, SUNDAY, 'state', 'ada', 'late', 10)?.code, 'grant_limit');
  assert.equal(grantRoom(seat(), 'state'), 0); assert.equal(grantBlock(seat(), gov, SUNDAY, 'state', 'ada', 'chi', 1)?.code, 'over_limit');
  const rich = seat(); credit(rich, SUNDAY, 'levy', 10_000_000, 'A windfall');
  assert.equal(grantRoom(rich, 'state'), SEATS.state.salaryCap, 'never above the seat’s own limit');
});

test('an audit warns about concentration, favouring one’s own party, and a drained treasury, and says nothing for an honest term', () => {
  const grant = (id: string, amount: number, party: string | null) => ({ to: { id }, amount, party });
  assert.deepEqual(auditFlags({ income: 10000, salary: 1000, granted: 1000 }, [grant('a', 500, null), grant('b', 500, null)], null), []);
  assert.deepEqual(auditFlags({ income: 10000, salary: 0, granted: 900 }, [grant('a', 800, null), grant('b', 100, null)], null), ['concentration']);
  assert.deepEqual(auditFlags({ income: 10000, salary: 0, granted: 1000 }, [grant('a', 500, 'p1'), grant('b', 500, 'p1')], 'p1'), ['party_favour']);
  assert.deepEqual(auditFlags({ income: 10000, salary: 2000, granted: 0 }, [], null), [], 'a salary alone is within the rules');
  assert.deepEqual(auditFlags({ income: 10000, salary: 2000, granted: 7100 }, [grant('a', 3550, null), grant('b', 3550, null)], null), ['drained']);
  assert.deepEqual(auditFlags({ income: AUDIT.minIncome - 1, salary: AUDIT.minIncome, granted: 0 }, [], null), [], 'too little came in to judge');
  assert.deepEqual(auditFlags({ income: 10000, salary: 0, granted: 800 }, [grant('a', 800, 'p1')], 'p1'), [], 'one grant is not a pattern');
});

test('an audit is recorded for the term, can be asked for every few minutes, and needs someone in the seat', () => {
  const record = seat(), gov = ballot(STATE);
  assert.equal(auditBlock(record, empty(), SUNDAY, 'state')?.code, 'empty_seat');
  assert.equal(auditBlock(record, gov, SUNDAY, 'state'), null);
  credit(record, SUNDAY, 'levy', 5000, 'VAT');
  const report = runAudit(record, gov, SUNDAY, 'state', bola, null);
  assert.deepEqual([report.week, report.income, report.grants, report.flags, report.by.name], [1, 5000, 0, [], 'Bola']);
  assert.equal(auditBlock(record, gov, SUNDAY + 60000, 'state')?.code, 'audit_cooldown');
  assert.equal(auditBlock(record, gov, SUNDAY + AUDIT.cooldownMs + 1, 'state'), null);
});

test('impeachment needs an audit that found something, then more than half the votes the officeholder won', () => {
  assert.equal(signaturesNeeded('state', 10), 10, 'never below the quorum');
  assert.equal(signaturesNeeded('state', 40), 21, 'more than half of the votes won');
  assert.equal(signaturesNeeded('city', 5), 3);
  const record = seat(), gov = ballot(20);
  assert.equal(impeachBlock(record, empty(), SUNDAY, 'state', 'x')?.code, 'empty_seat');
  assert.equal(impeachBlock(record, gov, SUNDAY, 'state', 'x')?.code, 'no_grounds', 'nothing to go on');
  credit(record, SUNDAY, 'levy', 5000, 'VAT');
  payGrant(record, gov, SUNDAY, 'state', { id: 'a', name: 'A' }, 800, 'A', null); payGrant(record, gov, SUNDAY, 'state', { id: 'b', name: 'B' }, 100, 'B', null);
  runAudit(record, gov, SUNDAY, 'state', bola, null);
  assert.equal(impeachBlock(record, gov, SUNDAY, 'state', 'x'), null);
  assert.equal(impeachBlock(record, gov, SUNDAY, 'state', 'ada')?.code, 'self');
  const needed = signaturesNeeded('state', 20);
  assert.equal(needed, 11);
  for (let index = 0; index < needed - 1; index++) assert.deepEqual(signPetition(record, gov, SUNDAY, 'state', `s${index}`, 1).removed, false);
  assert.equal(impeachBlock(record, gov, SUNDAY, 'state', 's0')?.code, 'already_signed');
  assert.equal(governorAt(gov, SUNDAY, STATE)?.id, 'ada', 'one signature short');
  const last = signPetition(record, gov, SUNDAY, 'state', 'last', 1);
  assert.deepEqual([last.signed, last.needed, last.removed], [11, 11, true]);
  assert.equal(governorAt(gov, SUNDAY + 1, STATE), null, 'removed');
  assert.equal(leverValue(record, gov, SUNDAY + 1, 'salesTax'), 0, 'their decrees lapse with them');
  assert.equal(salaryDue(record, gov, SUNDAY + 1, 'state', 'ada'), 0, 'and their salary');
});

test('an audit from an earlier term is no grounds for this term, and a petition starts again each term', () => {
  const record = seat(), gov = ballot(STATE);
  credit(record, SUNDAY, 'levy', 5000, 'VAT');
  payGrant(record, gov, SUNDAY, 'state', { id: 'a', name: 'A' }, 800, 'A', null); payGrant(record, gov, SUNDAY, 'state', { id: 'b', name: 'B' }, 100, 'B', null);
  runAudit(record, gov, SUNDAY, 'state', bola, null);
  signPetition(record, gov, SUNDAY, 'state', 's0', 1);
  const next = empty();
  declare(next, MONDAY + 7 * DAY + 1000, ada, 'Again'); for (let index = 0; index < STATE; index++) vote(next, MONDAY + 10 * DAY + 1000, `v${index}`, ada.id);
  const later = SUNDAY + 7 * DAY;
  assert.equal(governorAt(next, later, STATE)?.week, 2);
  assert.equal(impeachBlock(record, next, later, 'state', 'x')?.code, 'no_grounds', 'last term’s audit does not carry over');
  assert.equal(signPetition(record, next, later, 'state', 'x', 2).signed, 1, 'a petition of an earlier term is dropped');
});
