// OWNER: politics — grants, audits and impeachment on the Node host. The pure rules are in server/politics/rules.test.ts.
// Design: docs/POLITICS.md section 4.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCityContent } from '../src/game/cities/registry.ts';
import { AUDIT, GRANTS, QUORUM } from '../src/game/content/politics.ts';
import type { GovResponse } from '../src/types/civic.ts';
import type { PoliticsResponse } from '../src/types/politics.ts';
import { harness } from './testing/politicsHarness.ts';
import type { Device } from './testing/politicsHarness.ts';
import { credit } from './politics/rules.ts';
import { emptyPolitics, scopeRecord } from './politics/data.ts';

await Promise.all(['lagos', 'ibadan'].map(loadCityContent));

/** Letters only: a name cannot hold digits. */
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const nameOf = (prefix: string, index: number): string => `${prefix}${LETTERS[index % 26]}${LETTERS[Math.floor(index / 26)]}`;

async function scene(t: Parameters<typeof harness>[0]) {
  const h = await harness(t);
  const { f, post, get, player, elect, overview, edit } = h;
  /** Put naira in the state treasury, as levies would. */
  const fund = (amount: number) => f.server.store.transact((db) => { credit(scopeRecord(db.politics ||= emptyPolitics(), 'state:lagos'), f.now(), 'levy', amount, 'Test levies'); });
  const grant = (by: Device, to: Device, amount: number, purpose = 'Clinic roof') => post('/api/politics/grant', { cityId: 'lagos', tier: 'state', player: to.id, amount, purpose, requestId: f.id() }, by);
  const audit = (by: Device) => post('/api/politics/audit', { cityId: 'lagos', tier: 'state' }, by);
  const impeach = (by: Device) => post('/api/politics/impeach', { cityId: 'lagos', tier: 'state' }, by);
  const state = async (by?: Device) => (await overview(by)).seats[1]!;
  const cash = async (device: Device) => (await get('/api/life?city=lagos', device)).state?.cash ?? 0;
  return { ...h, fund, grant, audit, impeach, state, cash, edit, elect, player, f };
}

test('grants: paid out of the treasury within its limits, in the open, to a real resident, once each', { timeout: 90000 }, async (t) => {
  const { f, player, elect, fund, grant, state, cash, edit, get } = await scene(t);
  const governor = await player('Governor'), bola = await player('Bola'), chi = await player('Chi'), newcomer = await player('Newcomer');
  await elect(governor, 'state:lagos', QUORUM.state);
  await fund(10000);
  assert.equal((await state(governor)).you?.grantRoom, 3000);
  assert.equal((await grant(bola, chi, 100)).code, 'not_in_office');
  assert.equal((await grant(governor, governor, 100)).code, 'self');
  assert.equal((await grant(governor, bola, 3001)).code, 'over_limit');
  assert.equal((await grant(governor, bola, 0)).code, 'invalid_amount');
  const unknown = await f.request('/api/politics/grant', { cityId: 'lagos', tier: 'state', player: '00000000-0000-4000-8000-000000000000', amount: 100, purpose: 'Nothing', requestId: f.id() }, governor.cookie).then((response) => response.json() as Promise<{ code?: string }>);
  assert.equal(unknown.code, 'unknown_player');
  await edit(newcomer, (life) => { life.civic.since = f.now(); });
  assert.equal((await grant(governor, newcomer, 100)).code, 'too_new');
  assert.equal((await grant(governor, bola, 500, 'ab')).code, 'text_too_short');

  const before = await cash(bola);
  const paid = await grant(governor, bola, 2000);
  assert.equal(paid.code, 'granted');
  assert.equal((await cash(bola)) - before, 2000);
  assert.ok((await get('/api/life?city=lagos', bola)).state?.social.notices.some((notice) => notice.text.includes('paid you 2,000 naira') && notice.text.includes('Clinic roof')));
  const seat = await state(chi);
  assert.deepEqual([seat.treasury.balance, seat.accounts.income, seat.accounts.granted], [8000, 10000, 2000]);
  assert.deepEqual(seat.grants.map((item) => [item.to.name, item.amount, item.purpose]), [['Bola', 2000, 'Clinic roof']], 'public to everyone');
  assert.equal(seat.treasury.ledger[0]?.kind, 'grant');
  assert.equal((await grant(governor, bola, 100)).code, 'already_granted');
  for (let index = 0; index < GRANTS.perTerm - 1; index++) assert.equal((await grant(governor, await player(nameOf('Rita', index)), 10, 'Small job')).code, 'granted');
  assert.equal((await grant(governor, chi, 10)).code, 'grant_limit');
});

test('an audit shows the term’s numbers and warns when they look wrong; it can be asked for every few minutes by anyone', { timeout: 90000 }, async (t) => {
  const { f, player, elect, fund, grant, audit, state } = await scene(t);
  const governor = await player('Governor'), bola = await player('Bola'), chi = await player('Chi'), asker = await player('Asker');
  assert.equal((await audit(asker)).code, 'empty_seat', 'nobody holds the seat');
  await elect(governor, 'state:lagos', QUORUM.state);
  await fund(10000);
  assert.equal((await audit(asker)).code, 'audited');
  assert.deepEqual([(await state(chi)).audit?.flags, (await state(chi)).audit?.income, (await state(chi)).audit?.by.name], [[], 10000, 'Asker'], 'an honest term');
  assert.equal((await audit(chi)).code, 'audit_cooldown');
  await grant(governor, bola, 2000); await grant(governor, chi, 100);
  f.advance(AUDIT.cooldownMs + 1000);
  assert.equal((await audit(chi)).code, 'audited');
  const report = (await state(asker)).audit;
  assert.deepEqual([report?.flags, report?.granted, report?.grants], [['concentration'], 2100, 2], 'most of it went to one person');
});

test('impeachment: needs an audit that found something, then more than half the votes the officeholder won, from residents who have worked', { timeout: 120000 }, async (t) => {
  const { f, post, get, player, elect, fund, grant, audit, impeach, state, edit } = await scene(t);
  const governor = await player('Governor'), bola = await player('Bola'), chi = await player('Chi'), newcomer = await player('Newcomer');
  await elect(governor, 'state:lagos', QUORUM.state);
  await fund(10000);
  assert.equal((await post('/api/politics/decree', { cityId: 'lagos', tier: 'state', lever: 'salesTax', value: 5 }, governor)).code, 'decreed');
  assert.equal((await impeach(bola)).code, 'no_grounds', 'no audit yet');
  await grant(governor, bola, 2000); await grant(governor, chi, 100);
  assert.equal((await impeach(bola)).code, 'no_grounds', 'an audit that found nothing is not grounds');
  f.advance(AUDIT.cooldownMs + 1000);
  await audit(bola);
  assert.equal((await state(bola)).petition?.open, true);
  assert.equal((await impeach(governor)).code, 'self');
  await edit(newcomer, (life) => { life.civic.work = { days: 0, last: null }; });
  assert.equal((await impeach(newcomer)).code, 'not_eligible');
  const needed = (await state(bola)).petition?.needed ?? 0;
  assert.equal(needed, QUORUM.state, 'a quorum’s worth: more than half of ten votes is six, and the quorum is ten');
  assert.equal((await impeach(bola)).code, 'signed');
  assert.equal((await impeach(bola)).code, 'already_signed');
  const signers: Device[] = [chi];
  for (let index = 0; index < needed - 3; index++) signers.push(await player(nameOf('Sade', index)));
  for (const device of signers) assert.equal((await impeach(device)).code, 'signed');
  assert.deepEqual([(await state(bola)).petition?.signed, (await state(bola)).petition?.mine], [needed - 1, true]);
  assert.equal(((await get('/api/civic/gov?city=lagos&tier=state', bola)) as unknown as GovResponse).governor?.id, governor.id, 'one signature short');
  const last = await player('Last');
  assert.equal((await impeach(last)).code, 'removed');

  const after = (await get('/api/civic/gov?city=lagos&tier=state', bola)) as unknown as GovResponse;
  assert.equal(after.governor, null, 'the seat is empty');
  const seat = await state(bola);
  assert.deepEqual([seat.levers.find((lever) => lever.id === 'salesTax')?.value, seat.you?.isOfficeholder, seat.petition], [0, false, null], 'their decree lapsed with them');
  assert.equal((await post('/api/politics/decree', { cityId: 'lagos', tier: 'state', lever: 'salesTax', value: 5 }, governor)).code, 'not_in_office');
  assert.equal((await grant(governor, newcomer, 100)).code, 'not_in_office');
  assert.equal((await post('/api/politics/salary', { cityId: 'lagos', tier: 'state', requestId: f.id() }, governor)).code, 'not_in_office');
  assert.equal((await impeach(last)).code, 'empty_seat');
  f.advance(8 * 86400000);
  assert.equal((await state(bola)).accounts.granted, 0, 'the next term starts clean');
});
