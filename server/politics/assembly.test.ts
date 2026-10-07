// OWNER: politics — the assemblies: who sits, the two roads a bill can take to become law, and what a veto or a new term does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lagosDayStart } from '../../src/game/clock.ts';
import { ASSEMBLY, QUORUM } from '../../src/game/content/politics.ts';
import { declare, timeline, vote } from '../civic/elections.ts';
import { emptyPolitics, scopeRecord } from './data.ts';
import { assemblyOf, billsOf, castVote, count, enact, leverBlock, majority, needed, propose, proposeBlock, settle, signBlock, signOrVeto, supermajority, voteBlock } from './assembly.ts';
import { leverValue, setDecree, termOf } from './rules.ts';
import type { GovScope } from '../types.ts';

const DAY = 86400000, WEEK = 1;
const MONDAY = lagosDayStart(7 * WEEK - 3), SUNDAY = MONDAY + 6 * DAY + 60000;
const ada = { id: 'ada', name: 'Ada' };
/** An election of week 1 where Ada wins with `top` votes, then each runner-up gets the votes listed. */
function election(top: number, rivals: number[] = []): GovScope {
  const gov: GovScope = { gov: { elections: {}, announcements: [] } };
  declare(gov, MONDAY + 1000, ada, 'Roads first');
  rivals.forEach((_, index) => declare(gov, MONDAY + 2000 + index, { id: `m${index}`, name: `Member ${index}` }, 'My plan'));
  for (let index = 0; index < top; index++) vote(gov, MONDAY + 3 * DAY, `a-${index}`, ada.id);
  rivals.forEach((votes, rival) => { for (let index = 0; index < votes; index++) vote(gov, MONDAY + 3 * DAY, `r${rival}-${index}`, `m${rival}`); });
  return gov;
}
const state = QUORUM.state;

test('the runners-up of the election, with at least one vote each, are the assembly, up to the seat’s size', () => {
  const full = assemblyOf(election(state, [6, 5, 4, 3, 2, 1]), SUNDAY, 'state');
  assert.deepEqual([full.executive?.id, full.members.map((member) => member.id)], ['ada', ['m0', 'm1', 'm2', 'm3']], 'four seats for a state');
  assert.equal(assemblyOf(election(state, [6, 5, 4, 3, 2, 1]), SUNDAY, 'city').members.length, ASSEMBLY.seats.city);
  assert.equal(assemblyOf(election(state, [6, 5, 4, 3, 2, 1]), SUNDAY, 'nation').members.length, 6, 'six seats for the nation, and six runners-up to fill them');
  assert.deepEqual(assemblyOf(election(state, [3, 0]), SUNDAY, 'state').members.map((member) => member.id), ['m0'], 'a runner-up with no vote has no seat');
  assert.deepEqual(assemblyOf(election(state), SUNDAY, 'state').members, [], 'a seat won with nobody else standing has no assembly: its officeholder decrees directly');
});

test('no assembly before the polls close, none when the election did not count, and it outlives a removed officeholder', () => {
  assert.deepEqual(assemblyOf(election(state, [3]), MONDAY + 3 * DAY, 'state').members, [], 'before the polls close');
  assert.deepEqual(assemblyOf(election(5, [3]), SUNDAY, 'state').members, [], 'void election: eight votes are fewer than the ten a state needs');
  const removed = election(state, [3, 2]);
  removed.gov.elections[WEEK]!.removedAt = SUNDAY - 1000;
  const after = assemblyOf(removed, SUNDAY, 'state');
  assert.deepEqual([after.executive, after.members.length], [null, 2]);
  assert.deepEqual(assemblyOf(election(state, [3]), timeline(WEEK).termEndsAt + 1000, 'state').members, [], 'a new term has none until its election');
});

test('the numbers a bill needs follow the size of the assembly', () => {
  assert.deepEqual([1, 2, 3, 4, 6].map(majority), [1, 2, 2, 3, 4]);
  assert.deepEqual([1, 2, 3, 4, 6].map(supermajority), [2, 2, 2, 3, 4], 'two thirds, and never fewer than two members');
});

function sitting(sizes: number[] = [3, 2, 1, 1]) {
  const gov = election(state, sizes), scope = scopeRecord(emptyPolitics(), 'state:lagos'), assembly = assemblyOf(gov, SUNDAY, 'state');
  return { gov, scope, assembly, size: assembly.members.length };
}

test('only the officeholder and members can propose, within the lever’s range, a few bills a term, one open bill per lever', () => {
  const { scope, assembly } = sitting();
  assert.equal(assembly.members.length, 4);
  assert.equal(proposeBlock(scope, assembly, SUNDAY, 'stranger')?.code, 'not_a_legislator');
  assert.equal(proposeBlock(scope, assembly, SUNDAY, 'ada'), null); assert.equal(proposeBlock(scope, assembly, SUNDAY, 'm0'), null);
  assert.equal(proposeBlock(scope, { ...assembly, members: [] }, SUNDAY, 'ada')?.code, 'no_assembly');
  assert.equal(leverBlock('state', 'salesTax', 5), null);
  assert.equal(leverBlock('state', 'salesTax', 11)?.code, 'out_of_range'); assert.equal(leverBlock('state', 'vat', 5)?.code, 'unknown_lever'); assert.equal(leverBlock('state', 'salesTax', 2.5)?.code, 'out_of_range');
  const first = propose(scope, assembly, SUNDAY, ada, 'salesTax', 5), again = propose(scope, assembly, SUNDAY + 1000, { id: 'm0', name: 'Member 0' }, 'salesTax', 3);
  assert.deepEqual([first.id, first.byOffice, first.status, again.id, again.byOffice, again.status], ['b1', true, 'failed', 'b2', false, 'open'], 'the newer proposal replaces the open one');
  for (let index = 0; index < ASSEMBLY.billsPerTerm; index++) propose(scope, assembly, SUNDAY, ada, 'stateSentence', 10 + index);
  assert.equal(proposeBlock(scope, assembly, SUNDAY, 'ada')?.code, 'bill_limit');
  assert.equal(billsOf(scope, SUNDAY + 7 * DAY).length, 0, 'a new term starts clean');
});

test('the officeholder’s bill passes with a majority of the assembly; the members who vote no can stop it', () => {
  const { scope, assembly, size } = sitting();
  const bill = propose(scope, assembly, SUNDAY, ada, 'salesTax', 5);
  assert.equal(needed(bill, size), majority(size));
  assert.equal(voteBlock(bill, assembly, 'ada')?.code, 'not_a_member', 'the officeholder is not a member');
  assert.equal(castVote(bill, size, 'm0', true), null); assert.equal(castVote(bill, size, 'm1', true), null);
  assert.equal(voteBlock(bill, assembly, 'm0')?.code, 'already_voted');
  assert.equal(castVote(bill, size, 'm2', true)?.via, 'majority');
  assert.deepEqual([bill.status, bill.via, count(bill)], ['passed', 'majority', { yes: 3, no: 0 }]);
  assert.equal(voteBlock(bill, assembly, 'm3')?.code, 'no_such_bill', 'a decided bill takes no more votes');

  const doomed = propose(scope, assembly, SUNDAY, ada, 'stateSentence', 30);
  assert.equal(castVote(doomed, size, 'm0', false), null, 'one against: three can still vote yes');
  assert.equal(castVote(doomed, size, 'm1', false)?.status, 'failed', 'two against four: a majority of three is out of reach');
  assert.equal(doomed.status, 'failed');
});

test('a member’s bill passes by two thirds on its own, or by a majority with the officeholder’s signature; a veto kills it', () => {
  const alone = sitting(), bill = propose(alone.scope, alone.assembly, SUNDAY, { id: 'm0', name: 'Member 0' }, 'salesTax', 4);
  assert.equal(needed(bill, alone.size), supermajority(alone.size));
  assert.equal(signBlock(bill, alone.assembly, 'm0')?.code, 'not_in_office');
  castVote(bill, alone.size, 'm0', true); castVote(bill, alone.size, 'm1', true);
  assert.equal(bill.status, 'open', 'a majority of four is three: two is not enough, with no signature');
  castVote(bill, alone.size, 'm2', true);
  assert.deepEqual([bill.status, bill.via], ['passed', 'supermajority'], 'three of four is two thirds');

  const signed = sitting(), second = propose(signed.scope, signed.assembly, SUNDAY, { id: 'm0', name: 'Member 0' }, 'stateSentence', 40);
  castVote(second, signed.size, 'm0', true); castVote(second, signed.size, 'm1', true);
  assert.equal(signBlock(second, signed.assembly, 'ada'), null);
  assert.equal(signOrVeto(second, signed.size, true), null, 'signed, but two of four is not yet a majority');
  assert.equal(castVote(second, signed.size, 'm2', true)?.via, 'supermajority', 'the third vote is also two thirds');
  assert.equal(signBlock(second, signed.assembly, 'ada')?.code, 'no_such_bill');

  const mid = sitting([3, 2, 1]), third = propose(mid.scope, mid.assembly, SUNDAY, { id: 'm1', name: 'Member 1' }, 'salesTax', 2);
  assert.equal(mid.size, 3); assert.equal(supermajority(3), 2);
  castVote(third, 3, 'm0', true);
  assert.equal(signOrVeto(third, 3, true), null, 'one vote of three with a signature: not a majority');
  assert.equal(castVote(third, 3, 'm1', true)?.via, 'supermajority');

  const vetoed = sitting(), fourth = propose(vetoed.scope, vetoed.assembly, SUNDAY, { id: 'm0', name: 'Member 0' }, 'salesTax', 3);
  castVote(fourth, vetoed.size, 'm0', true);
  signOrVeto(fourth, vetoed.size, false);
  assert.equal(fourth.status, 'vetoed');
  assert.equal(voteBlock(fourth, vetoed.assembly, 'm1')?.code, 'no_such_bill');
  assert.equal(signBlock(propose(vetoed.scope, vetoed.assembly, SUNDAY, ada, 'stateSentence', 12), vetoed.assembly, 'ada')?.code, 'own_bill');
});

test('a lone member cannot pass a law: with an assembly of one a bill needs the officeholder’s signature', () => {
  const one = sitting([3]);
  assert.equal(one.size, 1); assert.equal(supermajority(1), 2, 'never fewer than two members');
  const bill = propose(one.scope, one.assembly, SUNDAY, { id: 'm0', name: 'Member 0' }, 'salesTax', 9);
  assert.equal(castVote(bill, 1, 'm0', true), null, 'the one member voting yes is not two members');
  assert.equal(signOrVeto(bill, 1, true)?.via, 'signature');
  const theirs = propose(one.scope, one.assembly, SUNDAY, ada, 'stateSentence', 20);
  assert.equal(castVote(theirs, 1, 'm0', false)?.status, 'failed', 'and the one member can stop the officeholder’s bill');
});

test('a law holds for the term, overrides a decree, and ends with the term', () => {
  const { gov, scope, assembly, size } = sitting();
  assert.equal(settle(propose(scope, assembly, SUNDAY, ada, 'salesTax', 5), size), null, 'a bill nobody has voted on is undecided');
  const bill = propose(scope, assembly, SUNDAY, ada, 'salesTax', 6);
  castVote(bill, size, 'm0', true); castVote(bill, size, 'm1', true); castVote(bill, size, 'm2', true);
  setDecree(scope, gov, SUNDAY, ada, 'salesTax', 2);
  assert.equal(leverValue(scope, gov, SUNDAY, 'salesTax'), 2, 'a decree before any law');
  enact(scope, SUNDAY, bill);
  assert.deepEqual([leverValue(scope, gov, SUNDAY + 1000, 'salesTax'), scope.laws?.week], [6, termOf(SUNDAY)]);
  gov.gov.elections[WEEK]!.removedAt = SUNDAY + 500;
  assert.equal(leverValue(scope, gov, SUNDAY + 1000, 'salesTax'), 6, 'the law outlives the officeholder');
  assert.equal(leverValue(scope, gov, SUNDAY + 7 * DAY, 'salesTax'), 0, 'and ends with the term');
});
