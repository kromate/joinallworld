// OWNER: politics — assemblies on the Node host: who sits, how a bill becomes law, what a law does to a stall purchase, the public record of it,
// and that a seat without an assembly still decrees directly. The pure rules are in server/politics/assembly.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCityContent } from '../src/game/cities/registry.ts';
import { ASSEMBLY, QUORUM } from '../src/game/content/politics.ts';
import { DAY, harness } from './testing/politicsHarness.ts';
import type { Device } from './testing/politicsHarness.ts';

await Promise.all(['lagos', 'ibadan'].map(loadCityContent));

async function scene(t: Parameters<typeof harness>[0]) {
  const h = await harness(t);
  const { f, post, overview, player, elect } = h;
  const bill = (by: Device, lever: string, value: number, tier = 'state') => post('/api/politics/bill', { cityId: 'lagos', tier, lever, value }, by);
  const vote = (by: Device, id: string, yes: boolean, tier = 'state') => post('/api/politics/bill/vote', { cityId: 'lagos', tier, bill: id, yes }, by);
  const sign = (by: Device, id: string, signIt: boolean, tier = 'state') => post('/api/politics/bill/sign', { cityId: 'lagos', tier, bill: id, sign: signIt }, by);
  const seat = async (by?: Device) => (await overview(by)).seats[1]!;
  const lever = async (by: Device, id: string) => (await seat(by)).levers.find((item) => item.id === id)?.value;
  /** A Governor of Lagos State and three members (3, 2 and 2 votes behind them). */
  async function parliament() {
    const governor = await player('Governor'), m1 = await player('Mara'), m2 = await player('Mide'), m3 = await player('Mola'), stranger = await player('Stranger');
    await elect(governor, 'state:lagos', QUORUM.state, [[m1, 3], [m2, 2], [m3, 2]]);
    return { governor, m1, m2, m3, stranger };
  }
  return { ...h, bill, vote, sign, seat, lever, parliament, f };
}

test('the runners-up sit in the assembly, and a seat with none still decrees directly', { timeout: 60000 }, async (t) => {
  const { post, seat, parliament, player, elect, overview } = await scene(t);
  const { governor, m1, m2, m3, stranger } = await parliament();
  const view = await seat(stranger);
  assert.deepEqual([view.assembly.seats, view.assembly.members.map((member) => member.name), view.assembly.bills, view.assembly.you], [ASSEMBLY.seats.state, ['Mara', 'Mide', 'Mola'], [], { member: false, canPropose: false }]);
  assert.deepEqual([(await seat(governor)).assembly.you, (await seat(m1)).assembly.you], [{ member: false, canPropose: true }, { member: true, canPropose: true }]);
  assert.equal((await post('/api/politics/decree', { cityId: 'lagos', tier: 'state', lever: 'salesTax', value: 5 }, governor)).code, 'needs_assembly', 'with an assembly a decree is a bill');
  void m2; void m3;

  // The city seat of the same player has no runners-up: it decrees directly, exactly as before.
  const mayor = await player('Mayor');
  await elect(mayor, 'city:lagos', QUORUM.city);
  assert.deepEqual((await overview(mayor)).seats[0]?.assembly.members, []);
  assert.equal((await post('/api/politics/decree', { cityId: 'lagos', tier: 'city', lever: 'marketLevy', value: 4 }, mayor)).code, 'decreed');
});

test('a bill goes through proposal, votes and the law, and the law changes what a buyer pays and is on the public record', { timeout: 90000 }, async (t) => {
  const { f, post, get, player, bill, vote, seat, lever, parliament } = await scene(t);
  const { governor, m1, m2, m3, stranger } = await parliament();
  assert.equal((await bill(stranger, 'salesTax', 5)).code, 'not_a_legislator');
  assert.equal((await bill(governor, 'salesTax', 11)).code, 'out_of_range');
  assert.equal((await bill(governor, 'vat', 5)).code, 'unknown_lever');
  assert.equal((await bill(governor, 'salesTax', 5)).code, 'proposed');
  const open = (await seat(m1)).assembly.bills;
  assert.deepEqual(open.map((item) => [item.id, item.lever, item.value, item.byOffice, item.status, item.yes, item.no, item.needed]), [['b1', 'salesTax', 5, true, 'open', 0, 0, 2]]);
  assert.ok((await get('/api/life?city=lagos', m1)).state?.social.notices.some((notice) => notice.text.includes('A bill awaits your vote in Lagos State')), 'a member is told');

  assert.equal((await vote(stranger, 'b1', true)).code, 'not_a_member');
  assert.equal((await vote(governor, 'b1', true)).code, 'not_a_member', 'the officeholder does not vote on their own bill');
  assert.equal((await vote(m1, 'b1', true)).code, 'voted');
  assert.equal((await vote(m1, 'b1', true)).code, 'already_voted');
  assert.equal(await lever(stranger, 'salesTax'), 0, 'not a law yet');
  assert.equal((await vote(m2, 'b1', true)).code, 'passed', 'two of three is a majority');
  assert.equal(await lever(stranger, 'salesTax'), 5);
  assert.equal((await seat(m3)).assembly.bills[0]?.status, 'passed');
  assert.equal((await vote(m3, 'b1', true)).code, 'no_such_bill', 'a decided bill takes no more votes');

  // On the record, for anyone.
  const laws = (await (await fetch(`${f.base}/api/world/records?kind=law`)).json()) as { entries: { title: string; facts: Record<string, unknown> }[] };
  assert.deepEqual(laws.entries.map((entry) => [entry.facts.lever, entry.facts.value, entry.facts.yes, entry.facts.size, entry.facts.via]), [['salesTax', 5, 2, 3, 'majority']]);
  assert.match(laws.entries[0]?.title ?? '', /^The Lagos State assembly passed a law: Sales tax is 5% for the week \(2 of 3 votes\)\.$/);

  // The law is applied where money moves.
  const owner = await player('Owner'), buyer = await player('Buyer');
  assert.equal((await post('/api/business/open', { cityId: 'lagos', venue: 'market', type: 'food', name: 'Mama Put', colour: 'gold', icon: '🍲', requestId: f.id() }, owner)).code, 'opened');
  assert.equal((await post('/api/business/stock', { cityId: 'lagos', items: { jollof: 5 }, requestId: f.id() }, owner)).code, 'stocked');
  const before = (await get('/api/life?city=lagos', buyer)).state?.cash ?? 0;
  const bought = await post('/api/business/buy', { cityId: 'lagos', shop: owner.id, product: 'jollof', units: 1, requestId: f.id() }, buyer);
  assert.equal(bought.code, 'bought');
  assert.equal(before - (bought.state?.cash ?? 0), (bought.amount ?? 0) + Math.floor((bought.amount ?? 0) * 5 / 100), 'the buyer pays the price and the law’s tax');

  // The law ends with the week.
  f.advance(8 * DAY);
  assert.equal(await lever(stranger, 'salesTax'), 0);
});

test('a member’s bill: two thirds pass it alone, a majority needs the officeholder’s signature, and a veto ends it', { timeout: 90000 }, async (t) => {
  const { bill, vote, sign, seat, lever, parliament } = await scene(t);
  const { governor, m1, m2, m3, stranger } = await parliament();
  // Two thirds of three is two: a member's bill with two votes passes.
  assert.equal((await bill(m3, 'stateSentence', 40)).code, 'proposed');
  assert.equal((await seat(m3)).assembly.bills[0]?.byOffice, false);
  assert.equal((await vote(m3, 'b1', true)).code, 'voted');
  assert.equal((await vote(m1, 'b1', true)).code, 'passed');
  assert.equal(await lever(stranger, 'stateSentence'), 40);
  assert.equal((await seat(m3)).assembly.bills[0]?.via, 'supermajority');

  // A veto ends a bill, and only the officeholder can sign or veto, and only a member's bill.
  assert.equal((await bill(m2, 'stateBail', 2000)).code, 'proposed');
  assert.equal((await sign(m1, 'b2', true)).code, 'not_in_office');
  assert.equal((await vote(m2, 'b2', true)).code, 'voted');
  assert.equal((await sign(governor, 'b2', false)).code, 'vetoed');
  assert.equal((await vote(m1, 'b2', true)).code, 'no_such_bill');
  assert.equal(await lever(stranger, 'stateBail'), 0);
  assert.equal((await bill(governor, 'salesTax', 3)).code, 'proposed');
  assert.equal((await sign(governor, 'b3', true)).code, 'own_bill');

  // A newer bill on a lever replaces the open one; a bill that cannot pass any more fails at once.
  assert.equal((await bill(m1, 'stateBail', 1500)).code, 'proposed');
  assert.equal((await bill(m1, 'stateBail', 1000)).code, 'proposed');
  assert.deepEqual((await seat(m1)).assembly.bills.filter((item) => item.lever === 'stateBail').map((item) => [item.id, item.status]), [['b5', 'open'], ['b4', 'failed'], ['b2', 'vetoed']]);
  assert.equal((await vote(m2, 'b3', false)).code, 'voted');
  assert.equal((await vote(m3, 'b3', false)).code, 'failed', 'two against three: a majority of two is out of reach');
  assert.equal((await seat(m1)).assembly.bills.find((item) => item.id === 'b3')?.status, 'failed');
});

test('the bills of a term are limited, and a new term starts without them', { timeout: 90000 }, async (t) => {
  const { f, bill, seat, parliament } = await scene(t);
  const { governor, stranger } = await parliament();
  for (let index = 0; index < ASSEMBLY.billsPerTerm; index++) assert.equal((await bill(governor, 'stateSentence', 10 + index)).code, 'proposed', String(index));
  assert.equal((await bill(governor, 'salesTax', 2)).code, 'bill_limit');
  f.advance(8 * DAY);
  assert.deepEqual([(await seat(stranger)).assembly.bills.length, (await seat(stranger)).assembly.members.length], [0, 0], 'a new term has neither bills nor an assembly until its election');
});
