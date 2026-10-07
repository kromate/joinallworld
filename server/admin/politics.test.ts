// OWNER: admin - the operator's government tools (server/admin/politics.ts): who may use them, that every undoing needs a reason, is audited
// and is written to the public record, and that the record's chain still holds afterwards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { QUORUM } from '../../src/game/content/politics.ts';
import { verifyChain } from '../../src/records/chain.ts';
import type { RecordsResponse } from '../../src/types/records.ts';
import { emptyPolitics } from '../politics/data.ts';
import { termOf } from '../politics/rules.ts';
import { admins, FOUNDER_ADDRESS } from './admin.test.ts';

type Json = Record<string, any>;

async function world(t: Parameters<typeof admins>[0]) {
  const a = await admins(t);
  const founder = await a.account(FOUNDER_ADDRESS, 'Founder'), holder = await a.player('Holder'), ada = await a.player('Ada'), officer = await a.player('Officer'), guest = await a.player('Guest');
  // A Governor of Lagos State seated last week, an offence and a sentence by Officer, an officer and a judge.
  await a.f.server.store.transact((db) => {
    const politics = (db.politics ||= emptyPolitics()), week = termOf(a.f.now());
    const record = (politics.scopes['state:lagos'] ||= { treasury: { balance: 2500, ledger: [] } });
    (record.gov ||= { elections: {}, announcements: [] }).elections[week] = { candidates: { [holder.id]: { name: 'Holder', slogan: 'Fair deal', at: a.f.now() - 8 * 86400000 } }, votes: Object.fromEntries(Array.from({ length: QUORUM.state }, (_, index) => [`voter-${index}`, holder.id])) };
    const justice = (politics.justice ||= { offences: {}, jail: {}, police: {}, judges: {}, lawyers: {}, cases: {}, fights: {}, pairs: {} });
    justice.offences.o1 = { id: 'o1', kind: 'assault', by: { id: ada.id, name: 'Ada' }, against: { id: guest.id, name: 'Guest' }, city: 'lagos', venue: 'park', at: a.f.now(), won: true, status: 'arrested' };
    justice.jail[ada.id] = { until: a.f.now() + 30 * 60000, at: a.f.now(), minutes: 30, offence: 'o1', by: { id: officer.id, name: 'Officer' }, tier: 'state', scope: 'state:lagos' };
    justice.police[officer.id] = { scope: 'state:lagos', tier: 'state', week, by: { id: holder.id, name: 'Holder' }, name: 'Officer', at: a.f.now() };
    justice.judges[guest.id] = { scope: 'state:lagos', tier: 'state', week, by: { id: holder.id, name: 'Holder' }, name: 'Guest', at: a.f.now() };
  });
  const act = (body: Json, cookie = founder.cookie) => a.admin('/api/admin/politics/act', cookie, body);
  const records = async (): Promise<RecordsResponse> => (await (await fetch(`${a.f.base}/api/world/records`)).json()) as RecordsResponse;
  return { a, founder, holder, ada, officer, guest, act, records };
}

test('only an admin can look at or act on the government', async (t) => {
  const { a, ada, act } = await world(t);
  assert.equal((await a.admin('/api/admin/politics', ada.cookie)).status, 404);
  assert.equal((await act({ action: 'release', player: ada.id, reason: 'Wrongly jailed, a mistake' }, ada.cookie)).status, 404);
  assert.equal((await a.admin('/api/admin/politics', '')).status, 404);
});

test('the overview shows each seat, who is jailed and who serves', async (t) => {
  const { a, founder, holder, ada } = await world(t);
  const view = (await a.admin('/api/admin/politics', founder.cookie)).body;
  const seat = (view.seats as Json[]).find((item) => item.scope === 'state:lagos');
  assert.deepEqual([seat?.title, seat?.holder?.name, seat?.holder?.id, seat?.treasury, seat?.officers, seat?.judges, seat?.petition], ['Governor', 'Holder', holder.id, 2500, 1, 1, { signed: 0, needed: QUORUM.state }]);
  assert.deepEqual((view.jailed as Json[]).map((item) => [item.id, item.name, item.minutes, item.by]), [[ada.id, 'Ada', 30, 'Officer']]);
  const counts = view as { police: unknown[]; judges: unknown[]; records: { count: number } };
  assert.deepEqual([counts.police.length, counts.judges.length, counts.records.count], [1, 1, 0]);
});

test('an undoing needs a reason, is audited, is written to the public record and leaves the chain sound', async (t) => {
  const { a, founder, holder, ada, officer, guest, act, records } = await world(t);
  // Refusals leave everything as it was.
  assert.equal((await act({ action: 'release', player: ada.id })).body.code, 'reason_required');
  assert.equal((await act({ action: 'release', player: ada.id, reason: 'too short' })).body.code, 'reason_required');
  assert.equal((await act({ action: 'remove-officeholder', scope: 'state:lagos', reason: 'Misused the treasury badly' })).body.code, 'confirmation_required');
  assert.equal((await act({ action: 'remove-officeholder', scope: 'state:lagos', typed: 'Somebody', reason: 'Misused the treasury badly' })).body.code, 'confirmation_required');
  assert.equal((await act({ action: 'remove-officeholder', scope: 'state:nowhere', typed: 'Holder', reason: 'Misused the treasury badly' })).body.code, 'unknown_seat');
  assert.equal((await act({ action: 'dismiss', role: 'judge', player: ada.id, reason: 'Not a judge at all' })).body.code, 'not_an_official');
  assert.equal((await act({ action: 'teleport', reason: 'Not a real action' })).body.code, 'unknown_action');
  assert.equal((await records()).count, 0, 'refusals write nothing');

  assert.equal((await act({ action: 'release', player: ada.id, reason: 'The sentence was a mistake' })).body.ok, true);
  assert.equal((await act({ action: 'release', player: ada.id, reason: 'The sentence was a mistake' })).body.code, 'not_jailed');
  assert.equal((await act({ action: 'dismiss', role: 'police', player: officer.id, reason: 'Arrested the wrong player' })).body.ok, true);
  assert.equal((await act({ action: 'dismiss', role: 'judge', player: guest.id, reason: 'Never sat on a case' })).body.ok, true);
  const removed = await act({ action: 'remove-officeholder', scope: 'state:lagos', typed: 'holder', reason: 'Misused the treasury badly' });
  assert.equal(removed.body.ok, true); assert.match(String(removed.body.summary), /Removed Governor Holder of Lagos State/);
  assert.equal((await act({ action: 'remove-officeholder', scope: 'state:lagos', typed: 'Holder', reason: 'Misused the treasury badly' })).body.code, 'empty_seat');

  // The seat is empty, nobody is jailed or enrolled, and the public record says what was done and why.
  const view = (await a.admin('/api/admin/politics', founder.cookie)).body;
  assert.deepEqual([(view.seats as Json[]).find((item) => item.scope === 'state:lagos')?.holder, view.jailed, view.police, view.judges], [null, [], [], []]);
  const record = await records();
  assert.deepEqual(record.entries.map((entry) => [entry.kind, entry.facts.action]).reverse(), [['operator', 'release'], ['operator', 'dismiss'], ['operator', 'dismiss'], ['operator', 'remove-officeholder']]);
  const first = record.entries[record.entries.length - 1]!;
  assert.equal(first.title, 'The operator released Ada from jail: The sentence was a mistake');
  assert.equal(record.entries[0]?.title, `The operator removed Governor Holder of Lagos State for the rest of the term: Misused the treasury badly`);
  assert.equal(verifyChain([...record.entries].reverse()).ok, true);
  const audit = JSON.stringify((await a.admin('/api/admin/audit', founder.cookie)).body);
  for (const action of ['politics-release', 'politics-dismiss', 'politics-remove-officeholder']) assert.ok(audit.includes(action), action);
  assert.ok(!JSON.stringify(record).includes(holder.cookie.slice(4)), 'no secret in the record');
});

test('the dashboard counts government', async (t) => {
  const { a, founder } = await world(t);
  const dash = (await a.admin('/api/admin/dashboard', founder.cookie)).body;
  assert.ok(JSON.stringify(dash).includes('Government'), 'a Government card');
  assert.ok(JSON.stringify(dash).includes('Seats held now'));
});
