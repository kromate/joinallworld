// OWNER: civic — the paged reads of the directory and the rich list (server/civic/residents.ts, docs/LISTS.md): cursors by name and by
// amount that stay put while residents come, go and change, opt-outs left out, a page size that is capped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NEIGHBOURS_PAGE, RICH_PAGE, neighboursPage, richListPage } from './residents.ts';
import type { CivicCityRecord, ResidentRecord } from '../types.ts';

const NOW = Date.parse('2026-10-05T12:00:00Z'), TTL = 86400000;
const resident = (name: string, house: string | null, cash: number): ResidentRecord => ({ name, house, since: NOW, lastSeen: NOW, day: 1, cash, week: 0, earned: 0, gems: 0, claims: 0 });
function city(count: number): CivicCityRecord {
  const residents: Record<string, ResidentRecord> = {};
  for (let i = 0; i < count; i++) residents[`p${String(i).padStart(4, '0')}`] = resident(`Neighbour ${String(i).padStart(4, '0')}`, i % 3 ? 'lekki' : null, 1000 + (i % 50) * 10);
  return { seq: 0, visits: 0, prunedAt: NOW, residents, gov: { elections: {}, announcements: [] }, ads: { billboard: {}, sea: {} }, hunt: { found: 0, claims: 0, byDay: {} }, radio: { queues: {}, daily: {} } };
}

test('a district is read by name a page at a time: no repeats and no gaps while residents arrive and leave', () => {
  const record = city(250), online = (id: string): boolean => id === 'p0001';
  const ids: string[] = [];
  let after: string | null = null, calls = 0;
  for (;;) {
    const page = neighboursPage('t1', record, NOW + calls, TTL, online, {}, 'p0001', 'lekki', after, 40);
    assert.ok(page);
    ids.push(...page.homes.map((home) => home.id)); calls += 1;
    if (calls === 1) { record.residents['p9999'] = resident('Aaa Late', 'lekki', 5); delete record.residents[ids[10]!]; }
    if (!page.next) break;
    after = page.next;
  }
  assert.equal(new Set(ids).size, ids.length);
  // The index is held between pages, so what came or went meanwhile is seen on the next index, never as a repeat or a gap.
  const fresh = neighboursPage('t1', record, NOW + 20000, TTL, online, {}, null, 'lekki', null, 100)!;
  assert.ok(fresh.homes.some((home) => home.id === 'p9999') && !fresh.homes.some((home) => home.id === ids[10]));
  assert.equal(neighboursPage('t1', record, NOW, TTL, online, {}, null, 'lekki', 'only-one-part', 40), null, 'a cursor that is not ours is refused');
  assert.equal(neighboursPage('t1', record, NOW, TTL, online, {}, null, 'lekki', null, 40)!.homes.length, 40);
  assert.ok(NEIGHBOURS_PAGE.max >= NEIGHBOURS_PAGE.size);
});

test('the directory page leaves out who hid themselves, except the reader; the rich list leaves out who opted out and ranks by place', () => {
  const record = city(60);
  const hidden = neighboursPage('t2', record, NOW, TTL, () => false, { p0004: { directory: true } }, null, 'lekki', null, 100)!;
  assert.equal(hidden.homes.some((home) => home.id === 'p0004'), false);
  assert.equal(neighboursPage('t2', record, NOW, TTL, () => false, { p0004: { directory: true } }, 'p0004', 'lekki', null, 100)!.homes.find((home) => home.id === 'p0004')?.you, true);
  const first = richListPage('t3', record, NOW, TTL, { p0049: { richList: true } }, 'p0048', 'balances', null, 20)!;
  assert.equal(first.rows.length, 20);
  assert.ok(first.rows.every((row, index) => index === 0 || row.rank > first.rows[index - 1]!.rank));
  assert.equal(first.rows.some((row) => row.id === 'p0049'), false);
  const walked: string[] = first.rows.map((row) => row.id);
  let next = first.next;
  while (next) { const page = richListPage('t3', record, NOW, TTL, { p0049: { richList: true } }, 'p0048', 'balances', next, RICH_PAGE.max)!; walked.push(...page.rows.map((row) => row.id)); next = page.next; }
  assert.equal(new Set(walked).size, walked.length);
  assert.equal(walked.length, 59, 'everyone with a balance but the one who opted out');
  assert.equal(richListPage('t3', record, NOW, TTL, {}, null, 'balances', 'x:y:z', 20), null);
  assert.equal(richListPage('t3', record, NOW, TTL, {}, null, 'earners', null, 20)!.rows.length, 0, 'nobody earned this week');
});
