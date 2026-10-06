// OWNER: admin - the dashboard's history (server/admin/history.ts) and the bulk route and the audit filters that came with it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lagosTime } from '../../src/game/clock.ts';
import { DAILY_KEYS, TICK_MS, citiesToday, fold, funnelOf, historyOf, recorder } from './history.ts';
import { admins, FOUNDER_ADDRESS } from './admin.test.ts';
import type { Db, RouteContext } from '../types.ts';

const NOW = Date.UTC(2026, 9, 6, 12, 0, 0), TODAY = lagosTime(NOW).day;
const dbOf = (extra: Record<string, unknown> = {}): Db => ({ sessions: {}, growth: { metrics: { cities: {
  lagos: { days: { [TODAY]: { new: 4, active: 9, 'active-untracked': 3, sessions: 12, 'funnel.onboarded': 4, 'funnel.settled': 2, 'funnel.shift': 1 }, [TODAY - 1]: { new: 6, active: 8, sessions: 10, 'funnel.onboarded': 6 }, [TODAY - 8]: { new: 100 } }, cohorts: { [TODAY - 1]: { size: 6, r: { 1: 2 } }, [TODAY - 2]: { size: 4, r: { 1: 1 } } }, lives: {} },
  abuja: { days: { [TODAY]: { new: 1, active: 2 } }, cohorts: { [TODAY - 1]: { size: 2, r: { 1: 1 } } }, lives: {} } } }, ...extra }, ...extra } as unknown as Db);

test('a sample is folded into the day: the highest of the busiest moments, the latest of the counts, and a number not measured stays -1', () => {
  const row: number[] = [];
  assert.equal(fold(row, { peakOnline: 5, accounts: 40, callsPlaced: 2 }), true);
  assert.equal(row.length, DAILY_KEYS.length); assert.equal(row[DAILY_KEYS.indexOf('peakOnline')], 5); assert.equal(row[DAILY_KEYS.indexOf('cash')], -1);
  assert.equal(fold(row, { peakOnline: 3, accounts: 41, callsPlaced: 1 }), true, 'accounts changed');
  assert.deepEqual([row[0], row[1], row[3]], [5, 41, 2], 'the peak and the calls only go up; accounts is the latest');
  assert.equal(fold(row, { peakOnline: 3, accounts: 41 }), false, 'nothing changed, so nothing would be written');
  assert.equal(fold(row, { peakOnline: -4, accounts: Number.NaN }), false, 'a bad number is ignored');
});

test('the history is read from the stored counters: exact days, gaps where nothing was sampled, and a start date', () => {
  const db = dbOf();
  (db as unknown as Record<string, unknown>)['adminDaily'] = { first: TODAY - 1, days: { [TODAY - 1]: [7, 50, 60, ...Array(10).fill(-1)], [TODAY]: [9, 52, 61, 3, 2, 1, 0, 11, 8, 2, 5, 1, 123456] } };
  const h = historyOf(db, NOW, 3);
  assert.equal(h.days.length, 3); assert.equal(h.days[2]!.new, 5, 'both cities are added'); assert.equal(h.days[2]!.seen, 14); assert.equal(h.days[2]!.sessions, 12); assert.equal(h.days[2]!.funnel['settled'], 2);
  assert.equal(h.days[0]!.daily, null, 'a day before recording started is a gap'); assert.equal(h.days[1]!.daily?.['peakOnline'], 7); assert.equal(h.days[1]!.daily?.['cash'], null, 'not measured that day'); assert.equal(h.days[2]!.daily?.['cash'], 123456);
  assert.equal(h.startedOn, new Date((TODAY - 1) * 86400000).toISOString().slice(0, 10));
  assert.equal(historyOf(dbOf(), NOW, 30).startedOn, null, 'nothing recorded yet');
  assert.equal(historyOf(dbOf(), NOW, 30).days.length, 30);
});

test('the funnel counts what happened in the period, says what it cannot count, and the next-day return only counts days whose next day has come', () => {
  const day = funnelOf(dbOf(), NOW, 1), week = funnelOf(dbOf(), NOW, 7);
  assert.equal(day.steps.find((step) => step.id === 'new')?.count, 5); assert.equal(week.steps.find((step) => step.id === 'new')?.count, 11, 'the week does not reach the lives of eight days ago');
  assert.equal(week.steps.find((step) => step.id === 'settled')?.count, 2);
  for (const id of ['landed', 'friend']) { const step = day.steps.find((item) => item.id === id); assert.equal(step?.count, null); assert.equal(step?.exact, false); }
  assert.deepEqual(day.returned, { size: 0, back: 0, rate: null }, 'today\'s lives have not had their next day yet');
  assert.deepEqual(week.returned, { size: 12, back: 4, rate: 33.3 });
  assert.deepEqual(citiesToday(dbOf(), NOW), { lagos: { new: 4, seen: 12 }, abuja: { new: 1, seen: 2 } });
});

test('the recorder samples at most every few minutes, writes only what changed, and keeps 400 days', async () => {
  let now = NOW, writes = 0;
  const db = dbOf() as unknown as Record<string, unknown>;
  const ctx = { now: () => now, store: { read: async (fn: (db: Db) => unknown) => fn(db as unknown as Db), transact: async (fn: (db: Db) => unknown) => { const before = JSON.stringify(db['adminDaily'] ?? null); const out = fn(db as unknown as Db); if (JSON.stringify(db['adminDaily'] ?? null) !== before) writes += 1; return out; } },
    collection: (target: Record<string, unknown>, name: string, initial: unknown) => (target[name] ??= initial) } as unknown as RouteContext;
  let online = 4;
  const recording = recorder(ctx, () => ({ peakOnline: online, accounts: 10 }));
  await recording.tick(); assert.equal(writes, 1);
  await recording.tick(); assert.equal(writes, 1, 'a second tick inside the interval samples nothing');
  now += TICK_MS + 1; await recording.tick(); assert.equal(writes, 1, 'a sample that changes nothing writes nothing');
  now += TICK_MS + 1; online = 9; await recording.tick(); assert.equal(writes, 2);
  const store = db['adminDaily'] as { first: number; days: Record<string, number[]> };
  assert.equal(store.days[String(TODAY)]![0], 9);
  for (let i = 1; i <= 405; i++) store.days[String(TODAY - i)] = Array(13).fill(1);
  now += TICK_MS + 1; online = 10; await recording.tick();
  assert.equal(Object.keys(store.days).length, 400); assert.ok(store.days[String(TODAY)], 'the newest are kept');
});

test('bulk: a message or a small credit to several players, with a token first, all or nothing, under the one-at-a-time limits', async (t) => {
  const a = await admins(t);
  const founder = await a.account(FOUNDER_ADDRESS, 'Founder'), ada = await a.ready('Ada'), bola = await a.ready('Bola'), ayo = await a.ready('Ayo');
  const before = [await a.life(ada.cookie), await a.life(bola.cookie)];
  const credit = { action: 'credit', amount: 700, reason: 'launch week', ids: [ada.id, bola.id] };
  const first = await a.admin('/api/admin/players/bulk', founder.cookie, credit);
  assert.equal(first.body.code, 'confirmation_required'); assert.equal(first.body.players, 2); assert.match(String(first.body.summary), /₦700 to 2 players \(₦1,400 in all\)/);
  assert.equal((await a.life(ada.cookie)).cash, before[0]!.cash, 'the first request changes nothing');
  const sent = await a.admin('/api/admin/players/bulk', founder.cookie, { ...credit, confirm: first.body.token });
  assert.equal(sent.status, 200, JSON.stringify(sent.body)); assert.equal(sent.body.count, 2);
  assert.equal((await a.life(ada.cookie)).cash, before[0]!.cash + 700); assert.equal((await a.life(bola.cookie)).cash, before[1]!.cash + 700);
  const log = (await a.admin('/api/admin/audit?action=credit', founder.cookie)).body.lines as { target: string; reason: string }[];
  assert.deepEqual(log.map((line) => line.target).sort(), [ada.id, bola.id].sort()); assert.ok(log.every((line) => line.reason === 'launch week'));
  // a token for one request is not good for another: other players, another amount
  const other = await a.admin('/api/admin/players/bulk', founder.cookie, { ...credit, ids: [ada.id, ayo.id], confirm: first.body.token });
  assert.equal(other.body.code, 'confirmation_required', 'the token is bound to these players');
  // limits: too many, over the per-player grant limit, no reason, an unknown action, an unknown player
  assert.equal((await a.admin('/api/admin/players/bulk', founder.cookie, { ...credit, ids: Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`) })).status, 400);
  assert.equal((await a.admin('/api/admin/players/bulk', founder.cookie, { ...credit, amount: 50_000 })).status, 409);
  assert.equal((await a.admin('/api/admin/players/bulk', founder.cookie, { ...credit, reason: '' })).status, 400);
  assert.equal((await a.admin('/api/admin/players/bulk', founder.cookie, { ...credit, action: 'ban' })).status, 400);
  const ghost = await a.admin('/api/admin/players/bulk', founder.cookie, { action: 'message', text: 'Hello all', ids: [ada.id, '00000000-0000-4000-8000-000000000000'] });
  assert.equal(ghost.body.code, 'confirmation_required'); const sentGhost = await a.admin('/api/admin/players/bulk', founder.cookie, { action: 'message', text: 'Hello all', ids: [ada.id, '00000000-0000-4000-8000-000000000000'], confirm: ghost.body.token });
  assert.ok(sentGhost.status >= 400 && sentGhost.body.ok !== true, `one player that is not there stops the whole send (${sentGhost.status})`); assert.equal(((await a.admin('/api/admin/audit?action=message', founder.cookie)).body.lines as unknown[]).length, 0, 'and nobody was messaged');
});

test('the audit log filters by player and by date, and the player list by saved filter and sort', async (t) => {
  const a = await admins(t);
  const founder = await a.account(FOUNDER_ADDRESS, 'Founder'), ada = await a.ready('Ada'), bola = await a.ready('Bola');
  await a.admin(`/api/admin/players/${ada.id}/act`, founder.cookie, { action: 'note', text: 'first' });
  a.f.advance(2 * 86400000);
  await a.admin(`/api/admin/players/${bola.id}/act`, founder.cookie, { action: 'note', text: 'second' });
  const all = (await a.admin('/api/admin/audit', founder.cookie)).body.lines as { at: number; target: string }[];
  assert.equal(all.length, 2);
  assert.equal(((await a.admin(`/api/admin/audit?target=${ada.id}`, founder.cookie)).body.lines as unknown[]).length, 1);
  const middle = all[1]!.at + 86400000;
  assert.equal(((await a.admin(`/api/admin/audit?from=${middle}`, founder.cookie)).body.lines as { target: string }[]).map((line) => line.target).join(), bola.id);
  assert.equal(((await a.admin(`/api/admin/audit?to=${middle}`, founder.cookie)).body.lines as { target: string }[]).map((line) => line.target).join(), ada.id);
  const list = async (query: string) => ((await a.admin(`/api/admin/players?${query}`, founder.cookie)).body as { rows: { name: string; cash: number }[]; pageSize: number });
  assert.equal((await list('size=15')).pageSize, 15); assert.equal((await list('size=7')).pageSize, 40, 'only the offered page sizes');
  const byName = (await list('sort=name&dir=asc')).rows.map((row) => row.name); assert.deepEqual(byName, [...byName].sort((x, y) => x.localeCompare(y)));
  assert.ok((await list('filter=today')).rows.length >= 0); assert.deepEqual((await list('filter=banned')).rows, []);
});
